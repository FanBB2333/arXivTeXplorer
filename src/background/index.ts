console.log('arXivTeXplorer background service worker running')

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('arXivTeXplorer installed')
  } else if (details.reason === 'update') {
    console.log('arXivTeXplorer updated to version', chrome.runtime.getManifest().version)
  }
})

function sanitizeFilenameSegment(input: string): string {
  return input
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== 'arxiv-texplorer:download-pdf') {
    return
  }

  const url = typeof message.url === 'string' ? message.url : ''
  const arxivId = typeof message.arxivId === 'string' ? message.arxivId : 'arxiv'
  const title = typeof message.title === 'string' ? message.title : ''

  if (!url) {
    return
  }

  const safeTitle = title ? sanitizeFilenameSegment(title) : ''
  const filename = safeTitle ? `${arxivId} - ${safeTitle}.pdf` : `${arxivId}.pdf`

  chrome.downloads.download({
    url,
    filename,
    conflictAction: 'uniquify',
    saveAs: false,
  })
})
