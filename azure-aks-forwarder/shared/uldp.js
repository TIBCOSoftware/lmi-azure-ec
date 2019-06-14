/*
 * Copyright © 2019. TIBCO Software Inc.
 * This file is subject to the license terms contained
 * in the license file that is distributed with this file.
 */

'use strict';

let net = require('net');
let ip = require('ip');
const tls = require('tls');
const zlib = require('zlib');

const ULDP_HELLO_MAGIC = 0x50444c55; // 'ULDP'
const ULDP_MESSAGE_MAGIC = 0xcafe;

const ULDP_MIN_VERSION = 1;
const ULDP_MAX_VERSION = 3;

// message types
const ULDP_LOG_MESSAGE = 0x1;
const ULDP_FLUSH_REQUEST = 0x2;
const ULDP_FLUSH_ACK = 0x3;

// log message types
const ULDP_LOG_TYPE_SYSLOG = 0x1;
const ULDP_LOG_TYPE_WINSNARE = 0x3;

// log messages elements type
const ULDP_MSG_RAW_DATASTRING = 0x0;
const ULDP_MSG_ORIGIN_DATE = 0x1;

const DEFAULT_ACK_PENDING_QUEUE_SIZE = 500 * 1024;

const ULDP_SESSION_FLAG_COMPRESSED = 1;

function UldpSender({host, port, collectorDomain, ackPendingQueueSize, tlsOptions, useCompression}) {
    this.client = null;
    this.version = 0;
    this.flagHigh = 0;
    this.flagLow = 0;
    this.negotiated = false;
    this.seqHigh = 0;
    this.seqLow = 0;
    this.lastSeqAckHigh = 0;
    this.lastSeqAckLow = -1;
    this._host = host;
    this._port = port === undefined ? 5516 : port;
    this._pendingSend = [];
    this._pendingAck = new Map();
    this._pendingAckBytes = 0;
    this.useCompression = useCompression;
    this.counter = 0;
    this.flushRequestSent = false;
    this.domainBytes = collectorDomain === undefined ? Buffer.alloc(0) : Buffer.from(collectorDomain);
    this.ackPendingQueueSize = ackPendingQueueSize === 0 ? DEFAULT_ACK_PENDING_QUEUE_SIZE : ackPendingQueueSize;
    this.closingTimeout = 15000;
    this.expectingEnd = false;
    this.connectionClosed = false;
    if (tlsOptions !== undefined && tlsOptions !== null) {
        this.tlsOptions = tlsOptions;
    } else {
        this.tlsOptions = undefined;
    }
    if (useCompression) {
        this.deflate = zlib.createDeflate();
    }
}

module.exports = UldpSender;

UldpSender.prototype.connect = function (connectionCallback) {
    let me = this;
    this._connectCallback = connectionCallback;
    let options = {
        port: this._port,
        host: this._host,
    };

    let startHandshake = function () {
        const buf = Buffer.alloc(8);
        buf.writeUInt32LE(ULDP_HELLO_MAGIC, 0);
        buf.writeUInt16LE(ULDP_MIN_VERSION, 4);
        buf.writeUInt16LE(ULDP_MAX_VERSION, 6);
        let canSendMore = me.client.write(buf);
    };

    if (this.debug) {
        console.log('Connecting to ' + me._host + ":" + me._port + "...");
    }
    if (me.tlsOptions === undefined) {
        this.client = new net.Socket();
        this.client.connect(options, function () {
            if (me.debug) {
                console.log('Connected to ' + me.client.remoteAddress + ":" + me.client.remotePort + " (clear)");
            }
            startHandshake();
        });
    } else {
        this.tlsOptions.port = options.port;
        this.tlsOptions.host = options.host;
        this.tlsOptions.servername = me._host;
        if (this.tlsOptions.noCheckServerIdentity === true) {
            this.tlsOptions.checkServerIdentity = function () {
                return undefined;
            };
        }
        this.client = tls.connect(this.tlsOptions, function () {
            if (me.debug) {
                console.log('Connected to ' + me.client.remoteAddress + ":" + me.client.remotePort + " (" + me.client.getProtocol() + ")");
            }
            if (me.client.authorized === false) {
                me.onError("TLS NOT AUTHORIZED: " + me.client.authorizationError);
                //   throw "Not Authorized " + me.client.authorizationError;
            }
            startHandshake();
        });
    }

    this.client.on('data', function (data) {
        if (me.version === 0) {
            me._receiveVersionAnswer(data);
        } else if (!me.negotiated) {
            me._receiveNegotiateAnswer(data);
        } else {
            me._receiveAck(data);
        }
    });

    this.client.on('close', function () {
        if (me.debug) {
            console.log('Connection closed');
        }
        me.connectionClosed = true;
        me.onClose();
    });

    this.client.on('error', function (error) {
        console.log('SOCKET ERROR: ' + error);
        me.connectionClosed = true;
        me.onError(error);
    });

    this.client.on('end', function () {
        if (!me.expectingEnd) {
            console.log('Unexpected end of connection !');
            me.connectionClosed = true;
            me.onError("Unexpected end of connection !");
            return;
        } else if (me.debug) {
            console.log('Expected end of connection');
        }
        me.negotiated = false;
        me.client = null;
        me.version = 0;
    });

    this.client.on('drain', function () {
        if (me.debug) {
            console.log('DRAIN: ');
        }
        me._sendPendingMessages();
    });

    this.client.on('timeout', function (error) {
        console.log('TIMEOUT: ' + error);
        me.connectionClosed = true;
        me.close();
    });
};

UldpSender.prototype._receiveVersionAnswer = function (data) {
    let errorCode = data.readInt16LE(0);
    if (errorCode !== 0) {
        throw "Error returned by ULDP server during negotiate: " + errorCode;
    }
    this.version = data.readInt16LE(2);
    if (this.version < 1 || this.version > 3) {
        throw "Error negotiated version is not supported: " + this.version;
    }
    let flags = 0x0;
    let buf;
    let offset = 0;
    if (this.version === 3) {
        buf = Buffer.alloc(8 + 2 + this.domainBytes.length);
        buf.writeUInt16LE(this.domainBytes.length, 0);
        offset += 2;
        this.domainBytes.copy(buf, offset, 0, this.domainBytes.length);
        offset += this.domainBytes.length;
    } else {
        buf = Buffer.alloc(8);
    }

    if (this.useCompression) {
        flags |= ULDP_SESSION_FLAG_COMPRESSED;
    }
    buf.writeUInt32LE(flags, offset);
    offset += 4;
    buf.writeUInt32LE(0, offset);
    offset += 4;

    let canSendMore = this.client.write(buf);
};

UldpSender.prototype._receiveNegotiateAnswer = function (data) {
    this.flagLow = data.readUInt32LE(0);
    this.flagHigh = data.readUInt32LE(4);
    this.negotiated = true;
    if (this.useCompression) {
        if ((this.flagLow & ULDP_SESSION_FLAG_COMPRESSED) === 0) {
            throw "Compression flag not honored by peer"
        }
        // check compression flag is there
        this.deflate.pipe(this.client);
    }
    this._sendPendingMessages();
    if (this._connectCallback !== undefined) {
        this._connectCallback();
        this._connectCallback = undefined;
    }
};

UldpSender.prototype._sendPendingMessages = function () {
    if (!this.negotiated) {
        return;
    }
    let toSend = this._pendingSend;
    this._pendingSend = [];
    if (toSend.length !== 0) {
        for (let v of toSend) {
            this._sendMessage(v);
            // in case of failure the message will be placed back in the pendingResend queue
        }
    }
};

function writeDateToBuffer(buffer, date, offset) {
    buffer.writeInt16LE(date.getTimezoneOffset(), offset);
    offset += 2;
    buffer.writeUInt32LE(date.valueOf() / 1000, offset);
    offset += 4;
    buffer.writeUInt32LE((date.valueOf() % 1000) * 1000, offset);
    return offset + 4;
}

UldpSender.prototype._sendBuf = function (buf) {
    if (!this.negotiated) {
        throw "Connection not ready yet !";
    }
    if (this.useCompression) {
        const d = this.deflate;
        const sf = zlib.Z_SYNC_FLUSH;
        let canSendMore = this.deflate.write(buf, function () {
            d.flush(sf, {});
        });
    } else {
        let canSendMore = this.client.write(buf);
    }
};

UldpSender.createSyslogMessage = function (date, originInetAddress, rawString) {
    return {
        type: ULDP_LOG_TYPE_SYSLOG,
        date: date,
        origin: originInetAddress,
        rawBuf: Buffer.from(rawString),
        length: function () {
            return this.rawBuf.length + 8;
        },
        putToBuffer: function (buf, offset) {
            buf.writeUInt16LE(ULDP_MSG_RAW_DATASTRING, offset);
            offset += 2;
            buf.writeUInt16LE(0x0, offset);
            offset += 2;
            buf.writeUInt32LE(this.rawBuf.length, offset);
            offset += 4;
            this.rawBuf.copy(buf, offset, 0, this.rawBuf.length);
            return offset;
        },
    };
};

UldpSender.createWinSnareMessage = function (date, originInetAddress, rawString) {
    return {
        type: ULDP_LOG_TYPE_WINSNARE,
        date: date,
        origin: originInetAddress,
        rawBuf: Buffer.from(rawString),
        length: function () {
            return this.rawBuf.length + 8 + 12 + 8;
        },
        putToBuffer: function (buf, offset) {
            buf.writeUInt16LE(ULDP_MSG_ORIGIN_DATE, offset);
            offset += 2;
            buf.writeUInt16LE(0x0, offset); // reserved
            offset += 2;
            buf.writeUInt32LE(0xc, offset); // length : 2 + 2 + 4 + 4
            offset += 4;
            buf.writeInt16LE(0, offset); // reserved
            offset += 2;
            offset = writeDateToBuffer(buf, date, offset);
            buf.writeUInt16LE(ULDP_MSG_RAW_DATASTRING, offset);
            offset += 2;
            buf.writeUInt16LE(0x0, offset); // reserved
            offset += 2;
            buf.writeUInt32LE(this.rawBuf.length, offset);
            offset += 4;
            this.rawBuf.copy(buf, offset, 0, this.rawBuf.length);
            return offset;
        },
    };
};

UldpSender.prototype.sendMessage = function (logMessage) {
    this._pendingSend.push(logMessage);
    this._sendPendingMessages();
};

UldpSender.prototype.flush = function () {
    if (!this.flushRequestSent) {
        this._sendFlushRequest();
    }
};

UldpSender.prototype._sendMessage = function (logMessage) {
    if (this.negotiated) {
        // Make sure we have some room left for a new message
        if (this._pendingAckBytes > this.ackPendingQueueSize) {
            this.flush();
        } else {
            // TODO send stuff in reset queue if needed
            let msgBuf = this._logMessageToBuffer(logMessage);
            this._sendBuf(msgBuf);
            this._pendingAck.set(this.seqLow, logMessage);
            this._pendingAckBytes += msgBuf.length;
            this._checkNeedsFlushRequest();
            return true;
        }
    }
    this._pendingSend.push(logMessage);
    return false;
};

UldpSender.prototype._logMessageToBuffer = function (logMessage, flags) {
    let ret = Buffer.alloc(48 + logMessage.length());
    let offset = 0;

    ret.writeUInt16LE(ULDP_MESSAGE_MAGIC, offset);
    offset += 2;
    ret.writeUInt16LE(ULDP_LOG_MESSAGE, offset);
    offset += 2;
    ret.writeUInt16LE(flags, offset);
    offset += 2;
    offset = writeDateToBuffer(ret, logMessage.date, offset);

    let originAddress = logMessage.origin;
    if (originAddress === null) {
        originAddress = ip.address();
    }

    if (this.version === 3) {
        // must send IPv6
        if (ip.isV4Format(originAddress)) {
            ret.writeUInt32BE(0, offset);
            ret.writeUInt32BE(0, offset + 4);
            ret.writeUInt32BE(0xffff, offset + 8);
            ip.toBuffer(originAddress, ret, offset + 12);
        } else {
            ip.toBuffer(originAddress, ret, offset);
        }
        offset += 16;
    } else {
        if (!ip.isV4Format(originAddress)) {
            originAddress = ip.address();
        }
        ip.toBuffer(originAddress, ret, offset);
        offset += 4;
    }

    this._getNextSeq();
    ret.writeUInt32LE(this.seqHigh, offset);
    ret.writeUInt32LE(this.seqLow, offset + 4);
    offset += 8;
    ret.writeUInt32LE(logMessage.type, offset);
    offset += 4;
    ret.writeUInt32LE(logMessage.length(), offset);
    offset += 4;

    logMessage.putToBuffer(ret, offset);

    return ret;
};

UldpSender.prototype._receiveAck = function (data) {
    if (this.debug) {
        console.log("ReceiveAck!" + data.length);
    }
    let offset = 0;
    while (offset < data.length) {
        let magic = data.readUInt16LE(offset);
        offset += 2;
        if (magic !== ULDP_MESSAGE_MAGIC) {
            this.onError("Unexpected message magic : " + magic);
        }
        let msgType = data.readUInt16LE(offset);
        offset += 2;
        if (msgType !== ULDP_FLUSH_ACK) {
            this.onError("ULDP protocol error: unexpected message type instead of ULDP_FLUSH_ACK : " + msgType);
        }
        let newLastSeqAckHigh = data.readUInt32LE(offset);
        let newLastSeqAckLow = data.readUInt32LE(offset + 4);
        offset += 8;
        if (newLastSeqAckLow > this.lastSeqAckLow) {
            for (let i = this.lastSeqAckLow + 1; i <= newLastSeqAckLow; i++) {
                let removed = this._pendingAck.get(i);
                if (removed === undefined) {
                    console.log("Cannot find a message sent with ID " + i + " as seen in ack !");
                } else {
                    this._pendingAckBytes -= removed.length;
                    this._pendingAck.delete(i);
                }
            }
            this.lastSeqAckHigh = newLastSeqAckHigh;
            this.lastSeqAckLow = newLastSeqAckLow;
        }
        if (this.flushRequestSent) {
            this.flushRequestSent = false;
        }
    }
};

UldpSender.prototype._getNextSeq = function () {
    this.seqHigh = Date.now() / 1000;
    this.seqLow = this.counter++;
};

UldpSender.prototype.close = function (callback) {
    let error;

    if (this.expectingEnd) {
        return;
    }

    if (callback !== undefined) {
        this._closeCallback = callback;
    }

    if (!this.connectionClosed && this._pendingSend.length !== 0) {
        this._sendPendingMessages();
        this.closingTimeout -= 100;
        if (this.closingTimeout > 0) {
            if (this.debug) {
                console.log("Have pending messages not sent, delaying close... ");
            }
            setTimeout(function (me) {
                me.close();
            }, 100, this);
            return;
        }
    }

    if (this._pendingAck.size !== 0) {
        if (!this.connectionClosed) {
            this.closingTimeout -= 100;
            if (this.closingTimeout > 0) {
                this._sendFlushRequest();
                if (this.debug) {
                    console.log("Have pending acks not received, delaying close... ");
                }
                setTimeout(function (me) {
                    me.close();
                }, 100, this);
                return;
            }
        }
        let notAckCount = this._pendingAck.size;
        for (let [key, val] of this._pendingAck.entries()) {
            this._pendingSend.push(val);
        }
        this._pendingAck = new Map();
        this.pendingAckBytes = 0;

        error = "Warning: " + notAckCount + " events have not been acknowledged";
    }

    if (this.debug) {
        console.log("Ending client connection");
    }
    this.expectingEnd = true;
    this.client.end();
};

UldpSender.prototype._checkNeedsFlushRequest = function () {
    if (!this.flushRequestSent && (this._pendingAckBytes > (this.ackPendingQueueSize / 2) || (this._getAckDelayTime() > 1000))) {
        this._sendFlushRequest();
    }
};

UldpSender.prototype._sendFlushRequest = function () {
    let buf = Buffer.alloc(4);
    let offset = 0;
    buf.writeUInt16LE(ULDP_MESSAGE_MAGIC, offset);
    offset += 2;
    buf.writeUInt16LE(ULDP_FLUSH_REQUEST, offset);
    offset += 2;
    this._sendBuf(buf);
    this.flushRequestSent = true;
    if (this.debug) {
        console.log("Flush request sent:" + this._pendingAckBytes);
    }
};

UldpSender.prototype._getAckDelayTime = function () {
    if (this.lastSeqAckHigh === 0) {
        return 0;
    }
    return this.seqHigh - this.lastSeqAckHigh;
};

UldpSender.prototype.onError = function (err) {
    if (this._connectCallback !== undefined) {
        this._connectCallback(err);
        this._connectCallback = undefined;
    } else if (this._closeCallback !== undefined) {
        this._closeCallback(err);
        this._closeCallback = undefined;
    }
    else {
        throw err;
    }
};

UldpSender.prototype.onClose = function () {
    if (this._closeCallback !== undefined) {
        this._closeCallback();
        this._closeCallback = undefined;
    }
};

UldpSender.prototype.promiseConnect = function (data) {
    let me = this;
    return new Promise((resolve, reject) => {
        me.connect(function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
};

UldpSender.prototype.promiseClose = function (data) {
    let me = this;
    return new Promise((resolve, reject) => {
        me.close(function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
};