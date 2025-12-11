import './Popup.css'

export const Popup = () => {
  return (
    <main>
      <div className="header">
        <div className="logo">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </div>
        <h1>arXivTeXplorer</h1>
      </div>
      <p className="description">
        View arXiv paper TeX source in a VS Code-like interface
      </p>
      <div className="instructions">
        <h2>How to use:</h2>
        <ol>
          <li>Go to any arXiv paper page</li>
          <li>Find the <strong>"View TeX Source"</strong> button</li>
          <li>Click to open the TeX viewer</li>
        </ol>
      </div>
      <div className="footer">
        <a href="https://arxiv.org" target="_blank" rel="noopener noreferrer">
          Visit arXiv.org
        </a>
      </div>
    </main>
  )
}

export default Popup
