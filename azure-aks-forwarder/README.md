# LMI Event Collector for Microsoft Azure - Azure Function for Collecting Azure AKS (Kubernetes) Logs from the Control Plane

This Azure function can be used to collect Azure Kubernetes Service (AKS) logs from the control plane and send them to a TIBCO LogLogic® Log Management Intelligence (LMI) appliance, usually in the cloud.
This uses Azure Event Hub for buffering of the messages and Azure function to periodically poll and forward those logs to LMI using the ULDP protocol.


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


# Step 2: Collecting AKS monitor logs using an Azure function


Create the function app

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
export ULDP_COLLECTOR_DOMAIN="<collector domain name>"
export ZIP_PACKAGE_PATH="<zip package path>"

az functionapp config appsettings set --name ${APP_NAME} -g ${GROUP_NAME} --settings WEBSITE_NODE_DEFAULT_VERSION=8.11.1

az functionapp config appsettings set --name ${APP_NAME} -g ${GROUP_NAME} --settings "EVENT_HUB_CONNECTION_STRING=${EVENT_HUB_CONNECTION_STRING}"

az functionapp config appsettings set --name ${APP_NAME} -g ${GROUP_NAME} --settings "ULDP_HOST=${ULDP_HOST}"

az functionapp config appsettings set --name ${APP_NAME} -g ${GROUP_NAME} --settings "ULDP_COLLECTOR_DOMAIN=${ULDP_COLLECTOR_DOMAIN}"
```

Now the last command to actualy deploy the package in the newly created function app:

```
az functionapp deployment source config-zip -g ${GROUP_NAME} -n ${APP_NAME} --src ${ZIP_PACKAGE_PATH}
```

# Using Secure ULDP (TLS encryption)

In order to use Secure ULDP, your LMI instance should be configured with Secure ULDP enabled, and certificates installed. You will need the CA certificate, and a client certificate with its associated private Key.

In order to configure the Azure function, you need to define the following set of configuration properties for the function app:

Property | mandatory | value
---|---|---
TLS_CA | Yes | The CA certificate, for LMI certificate validation. Put a base64 encoded payload representing the certificate (base64 ca.crt)
TLS_CERT | Yes | The client certificate, must be signed by the CA defined on the LMI. Put a base64 encoded payload representing the certificate (base64 client.crt) 
TLS_KEY | Yes | The private key of the client certificate. Put a base64 encoded payload representing the private key ( base64 client.key )
TLS_KEY_PASSPHRASE | Yes | The passphrase protecting the client key
TLS_CHECK_NAM | No, default is true | If true, the certificate CN or alternative name(s) will be checked against the hostname/IP. 

# Developement

You need to run those commands first (this is done for you if you run the maven build):

```
npm install

func extensions install
```

First is to install the Node.JS dependencies, the second is to install the Azure Functions dependencies. (cf. https://docs.microsoft.com/en-us/azure/azure-functions/functions-triggers-bindings#local-development-azure-functions-core-tools)

to get the func tool, look at: https://code.visualstudio.com/tutorials/functions-extension/getting-started


