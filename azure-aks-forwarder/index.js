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

module.exports = async function (context, eventHubMessages) {
    context.log('Connecting to LMI ' + uldpConfig.host);
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
            let msg = JSON.stringify(record);
            let eventDate = new Date(record.time);
            if ( flatten ) {
                msg = util.toFlatText(msg);
            }
            resultCount++;
            uldpSender.sendMessage(uldp.createSyslogMessage(eventDate, srcIP, "AKSmonitor " + msg));
        })
    });

    await uldpSender.promiseClose();
    context.log('Function terminated, resultCount=' + resultCount);
};
