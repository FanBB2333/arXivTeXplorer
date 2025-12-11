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
  const button = document.createElement('a')
  button.className = 'abs-button download-eprint arxiv-texplorer-btn'
  button.style.cssText = `
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white !important;
    border: none;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.2s ease;
  `
  button.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
    View TeX Source
  `

  button.addEventListener('mouseenter', () => {
    button.style.transform = 'translateY(-1px)'
    button.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)'
  })

  button.addEventListener('mouseleave', () => {
    button.style.transform = 'translateY(0)'
    button.style.boxShadow = 'none'
  })

  button.addEventListener('click', (e) => {
    e.preventDefault()
    const title = encodeURIComponent(getPaperTitle())
    const viewerUrl = chrome.runtime.getURL(`viewer.html?id=${arxivId}&title=${title}`)
    window.open(viewerUrl, '_blank')
  })

  return button
}

function injectButton(): void {
  const arxivId = getArxivId()
  if (!arxivId) {
    console.log('arXivTeXplorer: Not an arXiv abstract page')
    return
  }

  // Check if button already exists
  if (document.querySelector('.arxiv-texplorer-btn')) {
    return
  }

  // Find the TeX Source link
  const texSourceLink = document.querySelector('a.download-eprint[href*="/src/"]')

  if (texSourceLink && texSourceLink.parentElement) {
    const listItem = document.createElement('li')
    const button = createViewerButton(arxivId)
    listItem.appendChild(button)

    // Insert after the TeX Source link
    const parentLi = texSourceLink.closest('li')
    if (parentLi && parentLi.parentElement) {
      parentLi.parentElement.insertBefore(listItem, parentLi.nextSibling)
    }
  } else {
    // Fallback: try to find the full-text section
    const fullTextSection = document.querySelector('.full-text ul')
    if (fullTextSection) {
      const listItem = document.createElement('li')
      const button = createViewerButton(arxivId)
      listItem.appendChild(button)
      fullTextSection.appendChild(listItem)
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
