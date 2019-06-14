# Azure function for collecting Azure AKS (Kubernetes) logs from control plane

This Azure function can be used to collect Azure AKS (Kubernetes) logs from control plane and send them to an LMI appliance, usually in the cloud.
This uses Azure Event Hub for buffering of the messages and Azure function to periodically poll and forward those logs to an LMI using the ULDP protocol.


# Step 1: Enable Monitor logs

Source https://docs.microsoft.com/en-us/azure/aks/view-master-logs

Create an Event Hub in the same region as the AKS

Select the resource group for your AKS cluster, such as myResourceGroup. Don't select the resource group that contains your individual AKS cluster resources, such as MC_myResourceGroup_myAKSCluster_eastus.

On the left-hand side, choose Diagnostic settings.

Select your AKS cluster, such as myAKSCluster, then choose to Turn on diagnostics.

Enter a name, such as myAKSClusterLogs, then select the option to Stream to an event hub

Choose to Configure event hub, select the just created event hub

In the list of available logs, select the logs you wish to enable. By default, the kube-apiserver, kube-controller-manager, and kube-scheduler logs are enabled. You can enable additional logs, such as kube-audit and cluster-autoscaler. You can return and change the collected logs once Log Analytics workspaces are enabled.

When ready, select Save to enable collection of the selected logs.


#Step 2: Collecting AKS monitor logs using an Azure function


Create the function app

```
export APP_NAME=xxx
az functionapp create -g ${GROUP_NAME} --consumption-plan-location ${GROUP_LOCATION} -n ${APP_NAME} --storage-account ${SA_NAME} --runtime node


Then set the required app settings

az functionapp config appsettings set --name ${APP_NAME} -g ${GROUP_NAME} --settings WEBSITE_NODE_DEFAULT_VERSION=8.11.1
export EH_CNX_STRING=<the event hub connection string>
az functionapp config appsettings set --name ${APP_NAME} -g ${GROUP_NAME} --settings EVENT_HUB_CONNECTION_STRING=${EH_CNX_STRING}
export ULDP_HOST=<the uldp host name or IP address>
az functionapp config appsettings set --name ${APP_NAME} -g ${GROUP_NAME} --settings ULDP_HOST=${ULDP_HOST}
export ULDP_COLLECTOR_DOMAIN=<the ULDP collector domain>
az functionapp config appsettings set --name ${APP_NAME} -g ${GROUP_NAME} --settings ULDP_COLLECTOR_DOMAIN=${ULDP_COLLECTOR_DOMAIN}
az functionapp config appsettings set --name ${APP_NAME} -g ${GROUP_NAME} --settings FLATTEN=true
```

Now the last command is to actually deploy the sources and configuration zip for the newly created function app:

```
export APP_ZIP_PATH=xxxx
az functionapp deployment source config-zip -g ${GROUP_NAME} -n ${APP_NAME} --src ${APP_ZIP_PATH}
```

#Development,
You need to run in top directory (this is done for you if you run the maven build):

```
npm install

func extensions install
```

First is to install the Node.JS dependencies, the second is to install the Azure Functions dependencies. (cf. https://docs.microsoft.com/en-us/azure/azure-functions/functions-triggers-bindings#local-development-azure-functions-core-tools)

to get the func tool, look at: https://code.visualstudio.com/tutorials/functions-extension/getting-started