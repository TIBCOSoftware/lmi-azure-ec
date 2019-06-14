# Azure function for collecting Azure Directory logs and/or Azure Activity logs

This Azure function can be used to collect Azure Directory events (sign-ins and uadits), as well as Azure Activity logs, and send them to an LMI appliance, usually in the cloud.
This uses Azure Event Hub for buffering of the messages and Azure function to periodically poll and forward those logs to an LMI using the ULDP protocol.

# Step 1: Creating Event Hub Namespace
First, you need to create an Event Hub Namespace where the Azure AD logs will be forwarded to.

Click on+ (create a resource), then type in Event Hubs in the search bar, then click on Event Hubs

Choose a name, the Basic pricing tier may work if there is just one collection.

# Step 2: Initiating forwarding of the events to Event Hub
## Sending Azure AD audits+signin logs to Event Hub
*N.B. : this requires an Azure AD Premium P1 or P2*

Select Azure AD service

Then go to diagnostics settings entry in the left pane.

click +add diagnostics settings

Give a name and check "stream to an event hub"

Choose the event hub namespace, leave the event hub name unchanged.

Click on audit logs and signin logs

## Sending Azure Activity logs to Event Hub
Click on "all services", then search for "activity", and click on "activity.log"

Then click on "export to event hub"

You must choose the subscription to use. Select "all regions", as per Azure doc: If you select anything other than All regions, you'll miss key events that you expect to receive. The Activity Log is a global (non-regional) log, so most events do not have a region associated with them.

Then click on "export to an event hub", then select the event hub and policy, then OK

Save the changes.

Reference: https://docs.microsoft.com/en-us/azure/monitoring-and-diagnostics/monitoring-stream-activity-logs-event-hubs

# Step 3: Setup collection from Event Hub with Azure functions
You need to create an Azure function which is triggered by an EventHub message.
You've got two options:

## create the function in the portal
Unzip the package locally

In the portal, click on the + (Create a resource, top left), then compute in the left column, and Function App in the right column

Choose an App Name, Windows OS, and the same location as the VM you are collecting from, choose Javascript as the runtime stack.

Then click on the Create button.

You are now presented with the Function App main panel, click on Application Settings (under Configured features)

In the Application Settings list, you need to add three entries:

EVENT_HUB_CONNECTION_STRING : this should contain the connection strings for the storage account you copied previously

ULDP_HOST : the host/IP address of the LMI instance

ULDP_COLLECTOR_DOMAIN : the collector domain to use (this is usefull to identify your log source, as the source IP address of the Windows host will not be available)
Then save,
Now you need to create the Function content, this will be triggered by the event Hub (for the Azure AD signin)
Click on the plus sign next to the Functions label.
Choose "in portal", then "continue"
Choose "more templates", then click on "finish and view templates"
Type "event" in the search bar, then locate and select "Azure Event Hub Trigger", click on install the extension (this takes a few minutes as a background process).
Then enter the name of the new function, select EVENT_HUB_CONNECTION_STRING as the Event Hub Connection, Event Hub Name should be insights-logs-signinlogs
Then click on the 'create' button

Then select that function and click on "View Files" at the right of the edit buffer.
Click the upload button, then navigate to the place where you unziped the package, and select all the file within the SigninLogsTrigger directory (except function.json).
The files should appear after some time, you may need to reload the page, check their content.
Then click on Console at the bottom of the edit buffer
at them prompt, type: npm install
That will download and install the dependencies of the function
The function is now ready and will be listening for new event in the event hub.
You can use the Monitor panel to check the outcome of each function execution, and while clicking on one entry, you get the logs for that run.
If you also want to track audit logs, you need to follow that same procedure, and put an event hub name of insights-logs-auditlogs, and the files should be coming from the AuditLogsTrigger directory
If you also want to track activity logs, you need to follow that same procedure, and put an event hub name of insights-operational-logs, and the files should be coming from the ActivityLogsTrigger directory

## create the function using Azure CLI
Many other forms of deployment are possible based on the same package, to directly deploy the ZIP file, please read:

https://docs.microsoft.com/en-us/azure/azure-functions/deployment-zip-push

You need to create the Azure Function app in the portal or using the CLI as described below and create the application settings, as well.

```
export GROUP_LOCATION=westus2
export GROUP_NAME="<name of the resource group to use>"
export APP_NAME="<name of the function app to create>"
export APP_STORAGE_ACCOUNT="<storage account for the function app logs>"

az functionapp create -g ${GROUP_NAME} --consumption-plan-location ${GROUP_LOCATION} -n ${APP_NAME} -s ${APP_STORAGE_ACCOUNT} --runtime node
```

You also need to set the applicaiton settings, and set WEBSITE_NODE_DEFAULT_VERSION to 8.11.1
```
export EVENT_HUB_CONNECTION_STRING="<event hub connection string from step 2>"
export ULDP_HOST="<host or ip of LMI instance>"
export ULDP_CONNECTION_STRING="<collector domain name>"
export ZIP_PACKAGE_PATH="<zip package path>"

az functionapp config appsettings set --name ${APP_NAME} -g ${GROUP_NAME} --settings WEBSITE_NODE_DEFAULT_VERSION=8.11.1

az functionapp config appsettings set --name ${APP_NAME} -g ${GROUP_NAME} --settings "EVENT_HUB_CONNECTION_STRING=${EVENT_HUB_CONNECTION_STRING}"

az functionapp config appsettings set --name ${APP_NAME} -g ${GROUP_NAME} --settings "ULDP_HOST=${ULDP_HOST}"

az functionapp config appsettings set --name ${APP_NAME} -g ${GROUP_NAME} --settings "ULDP_COLLECTOR_DOMAIN=${ULDP_CONNECTION_STRING}"
```

Now the last command to actualy deploy the package in the newly created function app:

```
az functionapp deployment source config-zip -g ${GROUP_NAME} -n ${APP_NAME} --src <zip package path>
```

# Developement

You need to run those commands first (this is done for you if you run the maven build):

```
npm install

func extensions install
```

First is to install the Node.JS dependencies, the second is to install the Azure Functions dependencies. (cf. https://docs.microsoft.com/en-us/azure/azure-functions/functions-triggers-bindings#local-development-azure-functions-core-tools)

to get the func tool, look at: https://code.visualstudio.com/tutorials/functions-extension/getting-started





