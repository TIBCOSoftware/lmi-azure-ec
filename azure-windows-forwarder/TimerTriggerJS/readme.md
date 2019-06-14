# TimerTrigger - JavaScript

The `TimerTrigger` makes it incredibly easy to have your functions executed on a schedule. This sample demonstrates a simple use case of calling your function every 5 minutes.

## How it works

For a `TimerTrigger` to work, you provide a schedule in the form of a [cron expression](https://en.wikipedia.org/wiki/Cron#CRON_expression)(See the link for full details). A cron expression is a string with 6 separate expressions which represent a given schedule via patterns. The pattern we use to represent every 5 minutes is `0 */5 * * * *`. This, in plain text, means: "When seconds is equal to 0, minutes is divisible by 5, for any hour, day of the month, month, day of the week, or year".

## ULDP forwarding of Windows events

This function when triggered will issue a query on the Azure storage containing Windows events.
The connection string for this storage container should be defined as the variable
STORAGE_CONNECTION_STRING in the application settings for this function app.
Also must be defined:
ULDP_HOST as IP/hostname of the target LMI instance
ULDP_COLLECTOR_DOMAIN the collector domain to use

source IP address will be 0.0.0.0, unless defined in the SOURCE_IP variable.