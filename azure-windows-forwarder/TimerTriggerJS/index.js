/*
 * Copyright © 2019. TIBCO Software Inc.
 * This file is subject to the license terms contained
 * in the license file that is distributed with this file.
 */

'use strict';

const azure = require('azure-storage');
const parseString = require('xml2js').parseString;
const uldp = require('./uldp');
const moment = require('moment');

const debug = false;

const LEVELS = {
    '1': 'Critical',
    '2': 'Error',
    '3': 'Warning',
    '4': 'Information',
    '5': 'Verbose',
};

const KEYWORDS = {
    '0x8010000000000000': 'audit failure',
    '0x8020000000000000': 'audit success',
};


const storageConnectionString = process.env['STORAGE_CONNECTION_STRING'];
const srcIP = process.env.SOURCE_IP === undefined ? "0.0.0.0" : process.env.SOURCE_IP === "auto" ? null : process.env.SOURCE_IP;

const uldpConfig = {
    host: process.env['ULDP_HOST'],
    collectorDomain: process.env['ULDP_COLLECTOR_DOMAIN'],
};

module.exports = async function (context, myTimer) {
    const tableSvc = azure.createTableService(storageConnectionString);
    const entGen = azure.TableUtilities.entityGenerator;

    let resultCount = 0;

    let uldpSender = new uldp(uldpConfig);
    if (debug) {
        context.log('Connecting to LMI ' + uldpConfig.host);
    }
    await uldpSender.promiseConnect();
    context.log('connected to LMI ' + uldpConfig.host);
    const exists = await isCheckpointTableCreated();
    let lastEventTickCount = null;
    if (exists) {
        lastEventTickCount = await retrieveCheckpoint();
    } else {
        await createCheckpointTable();
    }
    if (lastEventTickCount === null) {
        lastEventTickCount = entGen.String((((new Date()).getTime() * 10000) + 621355968000000000));
        await recordCheckpoint(lastEventTickCount);
    }
    let query = new azure.TableQuery().where('PartitionKey gt ?string? and EventTickCount gt ?int64?', 
        '0' + lastEventTickCount._, lastEventTickCount._);
    await processResults(query, lastEventTickCount, 0);
    await uldpSender.promiseClose();
    context.log('Function terminated, resultCount=' + resultCount);

    async function isCheckpointTableCreated() {
        return new Promise((resolve, reject) => {
            tableSvc.doesTableExist('checkpoint', (err, data) => {
                if (err) {
                    context.log('Error accessing checkpoint table');
                    reject(err);
                    return;
                }
                resolve(data.exists);
            });
        });
    }

    async function recordCheckpoint(lastEventTickCount) {
        let entityDescriptor = {
            PartitionKey: 'single',
            RowKey: 'EventTickCount',
            EventTickCount: lastEventTickCount
        };
        return new Promise((resolve, reject) => {
            if (debug) {
                context.log('Writing into checkpoint table:' + lastEventTickCount._);
            }
            tableSvc.insertOrReplaceEntity('checkpoint', entityDescriptor, function (err) {
                if (err) {
                    context.log('Error while inserting checkpoint row: ' + err);
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }

    async function retrieveCheckpoint() {
        return new Promise((resolve, reject) => {
            tableSvc.retrieveEntity('checkpoint', 'single', 'EventTickCount', function (error, result, response) {
                if (error && error.statusCode !== 404) {
                    context.log('Cannot retrieve checkpoint value: error=' + error + ' response=' + response);
                    reject(error);
                }
                if (result !== null && result.EventTickCount !== undefined) {
                    context.log('Checkpoint read: ' + result.EventTickCount._);
                    resolve(result.EventTickCount);
                } else {
                    context.log('Checkpoint row not found in table');
                    resolve(null);
                }
            });
        });
    }

    async function createCheckpointTable() {
        return new Promise((resolve, reject) => {
            tableSvc.createTableIfNotExists('checkpoint', function (error) {
                if (error) {
                    // Table exists or created
                    reject(error);
                    return;
                }
                context.log('Checkpoint table created');
                resolve();
            });
        });
    }

    async function queryEventTable(query, continuationToken) {
        return new Promise((resolve, reject) => {
            tableSvc.queryEntities('WADWindowsEventLogsTable', query, continuationToken, (error, result) => {
                if (error !== null) {
                    reject(error);
                    return;
                }
                resolve(result);
            });
        });
    }

    async function processResults(query, checkpoint) {
        let continuationToken = null;
        do {
            let promises = [];
            let oldCheckpoint = checkpoint;

            const result = await queryEventTable(query, continuationToken);
            continuationToken = result.continuationToken;

            for (let row of result.entries) {
                resultCount++;
                if (oldCheckpoint._ > row.EventTickCount._) {
                    context.log('Unexpected event time SMALLER than previous checkpoint ! ' + checkpoint._ + '>' + row.EventTickCount._);
                    continue;
                }
                if (checkpoint._ < row.EventTickCount._) {
                    checkpoint = row.EventTickCount;
                }

                const prom = processRow(row);
                promises.push(prom);
            }
            await Promise.all(promises);

            if (oldCheckpoint._ !== checkpoint._) {
                await recordCheckpoint(checkpoint);
            }

            if (debug && continuationToken != null && !myTimer.isPastDue) {
                context.log('Have continuation token and ' + result.entries.length + ' new results, resultCount=' + resultCount);
            }
        } while (continuationToken != null && !myTimer.isPastDue);
        if (myTimer.isPastDue) {
            context.log('Function is running late, bailing out after collecting ' + resultCount + ' results.');
        }
    }

    async function parseXMLEvent(row) {
        return new Promise((resolve, reject) => {
            parseString(row.RawXml._, (err, result) => {
                if (err !== null) {
                    reject(err);
                }
                resolve(result);
            });
        });
    }

    async function processRow(row) {
        const parsed = await parseXMLEvent(row);
        const system = parsed.Event.System[0];
        const criticality = row.Level._;
        const sourceName = row.Channel._;
        const snareEventCounter = '0'; // TODO
        const dateTimeRaw = moment(row.PreciseTimeStamp._);
        const dateTime = dateTimeRaw.format('ddd MMM DD HH:mm:ss YYYY');
        const syslogDateTime = dateTimeRaw.format('MMM DD HH:mm:ss');
        const eventId = row.EventId._;
        const sourceName2 = system.Provider[0].$.Name;
        const userName = 'N/A';
        const sidType = 'N/A';
        const keywords = system.Keywords[0];
        const eventLogType = keywords in KEYWORDS ? KEYWORDS[keywords] :
            criticality in LEVELS ? LEVELS[criticality] : keywords;       
        const computerName = system.Computer[0];
        const categoryString = 'unknown';
        const dataString = '';
        const expendedString = row.Description._.replace(/\t/g, '   ').replace(/\n/g, ' ');
        const checksum = '1234';
        const eventDate = row.PreciseTimeStamp._;
        const originIP = srcIP;
        const snareMessage = '<47>' + syslogDateTime + ' ' + computerName + ' ' + 'MSWinEventLog\t'
            + criticality + '\t' + sourceName + '\t' + snareEventCounter + '\t'
            + dateTime + '\t' + eventId + '\t' + sourceName2 + '\t' + userName + '\t' + sidType + '\t' + eventLogType +
            '\t' + computerName + '\t' + categoryString + '\t' + dataString + '\t' + expendedString + '\t' + checksum;
        if (debug) {
            context.log(snareMessage);
        }
        uldpSender.sendMessage(uldp.createSyslogMessage(eventDate, originIP, snareMessage));
    }
};