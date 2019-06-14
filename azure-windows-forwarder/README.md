# Azure function for collecting Windows VM events

This Azure function can be used to collect Windows Events from Windows VMs running on Azure, and send them to an LMI appliance, usually in the cloud.

It uses Azure Agent for event collection on the VMs, Azure Storage for storing those events, and Azure Functions to periodically poll and forward those events to an LMI using the ULDP protocol.

## Step 1: Configure Azure Agent on the Windows VM

In the Azure portal, select the Windows VM.

Go to Monitoring/Diagnostics Settings

Click on "Enable guest-level monitoring"

Logs tab: Choose the event logs and levels you would like to collect by checking the relevant boxes

Agent tab: take note of the storage account which has been created. Optionally you can change this to another existing storage account.

Select the minimum log level to store and forward

Click on Save (top left), once settings are made.


## Step 2: Gather Azure Storage account access key
Go to Storage Accounts and select the storage account used at the first step.

Choose "access keys"

Then copy the content of either Key1 or Key2, you will need this in the next step.

## Step 3: Create Azure function
#### Deploy through the Azure portal
Unzip the package locally

In the portal, click on the + (Create a resource, top left), then compute in the left column, and Function App in the right column

Choose an App Name, Windows OS, and the same location as the VM you are collecting from.

Then click on the Create button.

You are now presented with the Function App main panel, click on Application Settings (under Configured features)

In the Application Settings list, you need to add three entries:

STORAGE_CONNECTION_STRING : this should contain the connection strings for the storage account you copied previously

ULDP_HOST : the host/IP address of the LMI instance
ULDP_COLLECTOR_DOMAIN : the collector domain to use (this is usefull to identify your log source, as the source IP address of the Windows host will not be available)
Then save,
Now you need to create the Function content, this will be triggered by a timer.
Click on the plus sign next to the Functions label.
Choose TimerTrigger, then enter the name of the new function.
Then select that function and click on "View Files" at the right of the edit buffer.
Click the upload button, then navigate to the place where you unziped the package, and select all the file within the TimerTriggerJS directory.
The files should appear, check their content.
Then click on Console at the bottom of the edit buffer
at them prompt, type: npm install
That will download and install the dependencies of the function
The function is now ready and will be running every minute.
The Schedule can be adjusted in the Integrate panel. The schedule string conforms to the Unix CRON format.
You can use the Monitor panel to check the outcome of each function execution, and while clicking on one entry, you get the logs for that run.

### Deploy using Azure CLI

Many other forms of deployment are possible based on the same package, to directly deploy the ZIP file, please read:

https://docs.microsoft.com/en-us/azure/azure-functions/deployment-zip-push

You need to create the function in the portal or using the CLI as described below and create the application settings, as well.

The first step creates the function app in a resource group.

```
export GROUP_LOCATION=westus2
export GROUP_NAME=xxxx
export APP_NAME=xxxx
export STORAGE_ACCOUNT=xxxx

az functionapp create -g ${GROUP_NAME} --consumption-plan-location ${GROUP_LOCATION} -n ${APP_NAME} -s ${STORAGE_ACCOUNT} --runtime node
```

You also need to set the applicaiton settings, and set WEBSITE_NODE_DEFAULT_VERSION to 8.11.1
```
az functionapp config appsettings set --name ${APP_NAME} -g ${GROUP_NAME} --settings WEBSITE_NODE_DEFAULT_VERSION=8.11.1

az functionapp config appsettings set --name ${APP_NAME} -g ${GROUP_NAME} --settings "STORAGE_CONNECTION_STRING=<storage connection string>"

az functionapp config appsettings set --name ${APP_NAME} -g ${GROUP_NAME} --settings ULDP_HOST=<host or ip>

az functionapp config appsettings set --name ${APP_NAME} -g ${GROUP_NAME} --settings ULDP_COLLECTOR_DOMAIN=<collector domain>
```

Now the last command to actualy deploy the package in the newly created function app:

```
az functionapp deployment source config-zip -g ${GROUP_NAME} -n ${APP_NAME} --src <zip package path>
```


# Developement

You need to run in top directory (this is done for you if you run the maven build):

```
npm install

func extensions install
```

First is to install the Node.JS dependencies, the second is to install the Azure Functions dependencies. (cf. https://docs.microsoft.com/en-us/azure/azure-functions/functions-triggers-bindings#local-development-azure-functions-core-tools)

to get the func tool, look at: https://code.visualstudio.com/tutorials/functions-extension/getting-started




