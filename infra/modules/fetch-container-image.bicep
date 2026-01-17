param exists bool
param name string

resource existingApp 'Microsoft.App/containerApps@2023-05-02-preview' existing = if (exists) {
  name: name
}

// Safely access containers - return empty array if the app doesn't exist or is in failed state
output containers array = (exists && existingApp.properties.?provisioningState == 'Succeeded')
  ? existingApp.properties.template.containers
  : []
