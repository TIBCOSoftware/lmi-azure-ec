/*
 * Copyright © 2019. TIBCO Software Inc.
 * This file is subject to the license terms contained
 * in the license file that is distributed with this file.
 */
'use strict';

const uldp = require('./uldp');
const util = require('./util.js');

const uldpConfig = {
    host: process.env['ULDP_HOST'],
    collectorDomain: process.env['ULDP_COLLECTOR_DOMAIN'],
};

const srcIP = process.env['ULDP_SOURCE_IP'] === undefined ? "0.0.0.0" : process.env['ULDP_SOURCE_IP'] === "auto" ? null : process.env['ULDP_SOURCE_IP'];
const flatten = process.env['FLATTEN'] === "false" ? false : true;
const debug = process.env['DEBUG'] === "true" ? true : false;

let tlsOptions = null;
const tls_key_passphrase = process.env['TLS_KEY_PASSPHRASE']
const tls_ca = process.env['TLS_CA']
const tls_cert = process.env['TLS_CERT']
const tls_key = process.env['TLS_KEY']
const tls_check_name = process.env['TLS_CHECK_NAME']

function readTlsOptions() {
    let ca_data = (new Buffer(tls_ca, 'base64')).toString('ascii');
    let cert_data = (new Buffer(tls_cert, 'base64')).toString('ascii');
    let key_data = (new Buffer(tls_key, 'base64')).toString('ascii');

    tlsOptions = {
        "ca": ca_data,
        "cert": cert_data,
        "key": key_data,
        "passphrase": tls_key_passphrase,
        "noCheckServerIdentity": tls_check_name && tls_check_name.toLowerCase() === "false",
    }
    return tlsOptions
}

module.exports = async function (context, eventHubMessages) {
    if ( tls_ca && tls_cert && tls_key) {
        if (tlsOptions == null) {
            tlsOptions = readTlsOptions()
        }
        uldpConfig.tlsOptions = tlsOptions
        if (uldpConfig.port === undefined) {
            uldpConfig.port = 5515
        }
        context.log('Connecting to LMI ' + uldpConfig.host + " with TLS");
    } else {
        context.log('Connecting to LMI ' + uldpConfig.host);
    }
    var resultCount = 0;
    let uldpSender = new uldp(uldpConfig);
    if (debug) {
        context.log(JSON.stringify(eventHubMessages));
    }
    await uldpSender.promiseConnect();
    if (debug) {
        context.log('connected to LMI' + uldpConfig.host);
    }

    eventHubMessages.forEach((message, index) => {
        message.records.forEach((record, idx) => {
            let msg = typeof record === 'object' ? JSON.stringify(record) : record;
            if (debug) {
                context.log(`Processed message ${msg}`);
            }
            let eventDate = new Date(record.time);
            if (flatten && typeof record === 'object') {
                msg = util.toFlatText(record);
            }
            resultCount++;
            uldpSender.sendMessage(uldp.createSyslogMessage(eventDate, srcIP, "MSAzureAD " + msg));
        })
    });

    await uldpSender.promiseClose();
    context.log('Function terminated, resultCount=' + resultCount);
};
