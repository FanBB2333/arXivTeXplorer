// arXivTeXplorer Content Script
// Adds a button to arXiv abstract pages to view TeX source

function getArxivId(): string | null {
  const url = window.location.href
  const match = url.match(/arxiv\.org\/abs\/([^/?#]+)/)
  return match ? match[1] : null
}

function getPaperTitle(): string {
  const titleElement = document.querySelector('h1.title')
  if (titleElement) {
    // Remove "Title:" prefix if present
    return titleElement.textContent?.replace(/^Title:\s*/i, '').trim() || 'arXiv Paper'
  }
  return document.title || 'arXiv Paper'
}

function createViewerButton(arxivId: string): HTMLElement {
  const link = document.createElement('a')
  link.className = 'abs-button download-eprint arxiv-texplorer-btn'
  link.textContent = 'View TeX Source'
  link.target = '_blank'
  link.rel = 'noopener noreferrer'

  const title = encodeURIComponent(getPaperTitle())
  link.href = chrome.runtime.getURL(`viewer.html?id=${arxivId}&title=${title}`)

  return link
}

function createDownloadPdfLink(arxivId: string): HTMLElement {
  const link = document.createElement('a')
  link.className = 'abs-button download-pdf arxiv-texplorer-download-pdf'
  link.textContent = 'Download PDF'
  link.href = `https://arxiv.org/pdf/${arxivId}.pdf`

  link.addEventListener('click', (e) => {
    e.preventDefault()
    chrome.runtime.sendMessage({
      type: 'arxiv-texplorer:download-pdf',
      arxivId,
      url: link.href,
      title: getPaperTitle(),
    })
  })

  return link
}

function injectButton(): void {
  const arxivId = getArxivId()
  if (!arxivId) {
    console.log('arXivTeXplorer: Not an arXiv abstract page')
    return
  }

  // Check if button already exists
  const hasViewSource = Boolean(document.querySelector('.arxiv-texplorer-btn'))
  const hasDownloadPdf = Boolean(document.querySelector('.arxiv-texplorer-download-pdf'))
  if (hasViewSource && hasDownloadPdf) {
    return
  }

  // Find the TeX Source link
  const texSourceLink = document.querySelector('a.download-eprint[href*="/src/"]')

  if (texSourceLink && texSourceLink.parentElement) {
    const viewSourceItem = hasViewSource ? null : document.createElement('li')
    if (viewSourceItem) {
      viewSourceItem.appendChild(createViewerButton(arxivId))
    }

    const downloadPdfItem = hasDownloadPdf ? null : document.createElement('li')
    if (downloadPdfItem) {
      downloadPdfItem.appendChild(createDownloadPdfLink(arxivId))
    }

    // Insert after the TeX Source link
    const parentLi = texSourceLink.closest('li')
    if (parentLi && parentLi.parentElement) {
      let insertAfter: ChildNode | null = parentLi.nextSibling

      if (viewSourceItem) {
        parentLi.parentElement.insertBefore(viewSourceItem, insertAfter)
        insertAfter = viewSourceItem.nextSibling
      }

      if (downloadPdfItem) {
        parentLi.parentElement.insertBefore(downloadPdfItem, insertAfter)
      }
    }
  } else {
    // Fallback: try to find the full-text section
    const fullTextSection = document.querySelector('.full-text ul')
    if (fullTextSection) {
      if (!hasViewSource) {
        const viewSourceItem = document.createElement('li')
        viewSourceItem.appendChild(createViewerButton(arxivId))
        fullTextSection.appendChild(viewSourceItem)
      }

      if (!hasDownloadPdf) {
        const downloadPdfItem = document.createElement('li')
        downloadPdfItem.appendChild(createDownloadPdfLink(arxivId))
        fullTextSection.appendChild(downloadPdfItem)
      }
    }
  }

  console.log('arXivTeXplorer: Button injected for', arxivId)
}

// Wait for page to load, then inject button
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectButton)
} else {
  injectButton()
}

// Also observe for dynamic changes (SPA navigation)
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      // Check if we need to re-inject the button
      if (!document.querySelector('.arxiv-texplorer-btn')) {
        injectButton()
      }
    }
  }
})

observer.observe(document.body, { childList: true, subtree: true })
