console.log('arXivTeXplorer background service worker running')

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('arXivTeXplorer installed')
  } else if (details.reason === 'update') {
    console.log('arXivTeXplorer updated to version', chrome.runtime.getManifest().version)
  }
})
