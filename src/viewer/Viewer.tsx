import { useState, useEffect, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import { unzipSync, strFromU8, gunzipSync } from 'fflate'
import './Viewer.css'

interface FileEntry {
  name: string
  content: string
  isTeX: boolean
}

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'tex':
      return '📄'
    case 'bib':
      return '📚'
    case 'sty':
      return '🎨'
    case 'cls':
      return '📋'
    case 'bst':
      return '📖'
    case 'eps':
    case 'pdf':
    case 'png':
    case 'jpg':
    case 'jpeg':
      return '🖼️'
    default:
      return '📝'
  }
}

function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'tex':
    case 'sty':
    case 'cls':
      return 'latex'
    case 'bib':
    case 'bst':
      return 'bibtex'
    case 'txt':
    case 'md':
      return 'plaintext'
    default:
      return 'plaintext'
  }
}

function isTextFile(filename: string): boolean {
  const textExtensions = [
    'tex', 'bib', 'sty', 'cls', 'bst', 'txt', 'md', 'cfg', 'def', 'fd', 'ins', 'dtx', 'ltx'
  ]
  const ext = filename.split('.').pop()?.toLowerCase()
  return ext ? textExtensions.includes(ext) : false
}

async function fetchAndExtractTexSource(arxivId: string): Promise<FileEntry[]> {
  const sourceUrl = `https://arxiv.org/src/${arxivId}`

  const response = await fetch(sourceUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch TeX source: ${response.status} ${response.statusText}`)
  }

  const contentType = response.headers.get('content-type') || ''
  const arrayBuffer = await response.arrayBuffer()
  const data = new Uint8Array(arrayBuffer)

  const files: FileEntry[] = []

  // Check if it's a gzipped file (single .tex file)
  if (data[0] === 0x1f && data[1] === 0x8b) {
    try {
      // Try to decompress as gzip (could be single file or tar.gz)
      const decompressed = gunzipSync(data)

      // Check if it's a tar archive (starts with file header)
      if (isTarArchive(decompressed)) {
        const tarFiles = extractTar(decompressed)
        files.push(...tarFiles)
      } else {
        // Single file
        const content = strFromU8(decompressed)
        files.push({
          name: `${arxivId}.tex`,
          content,
          isTeX: true
        })
      }
    } catch {
      // Maybe it's plain text that starts with those bytes
      const content = new TextDecoder().decode(data)
      files.push({
        name: `${arxivId}.tex`,
        content,
        isTeX: true
      })
    }
  } else if (contentType.includes('application/x-eprint-tar') || contentType.includes('application/x-tar')) {
    // Plain tar file
    const tarFiles = extractTar(data)
    files.push(...tarFiles)
  } else if (contentType.includes('text/') || contentType.includes('application/x-tex')) {
    // Plain text file
    const content = new TextDecoder().decode(data)
    files.push({
      name: `${arxivId}.tex`,
      content,
      isTeX: true
    })
  } else {
    // Try to decompress as zip
    try {
      const unzipped = unzipSync(data)
      for (const [filename, fileData] of Object.entries(unzipped)) {
        if (isTextFile(filename)) {
          files.push({
            name: filename,
            content: strFromU8(fileData),
            isTeX: filename.endsWith('.tex')
          })
        } else {
          files.push({
            name: filename,
            content: `[Binary file: ${filename}]`,
            isTeX: false
          })
        }
      }
    } catch {
      // Try as plain text
      const content = new TextDecoder().decode(data)
      files.push({
        name: `${arxivId}.tex`,
        content,
        isTeX: true
      })
    }
  }

  // Sort files: .tex files first, then alphabetically
  files.sort((a, b) => {
    if (a.isTeX && !b.isTeX) return -1
    if (!a.isTeX && b.isTeX) return 1
    return a.name.localeCompare(b.name)
  })

  return files
}

function isTarArchive(data: Uint8Array): boolean {
  // Check for tar magic number at offset 257
  if (data.length < 263) return false
  const magic = new TextDecoder().decode(data.slice(257, 262))
  return magic === 'ustar' || magic.startsWith('ustar')
}

function extractTar(data: Uint8Array): FileEntry[] {
  const files: FileEntry[] = []
  let offset = 0

  while (offset < data.length - 512) {
    // Read file name (first 100 bytes)
    const nameBytes = data.slice(offset, offset + 100)
    const name = new TextDecoder().decode(nameBytes).replace(/\0/g, '').trim()

    if (!name) break

    // Read file size (bytes 124-135, octal)
    const sizeBytes = data.slice(offset + 124, offset + 136)
    const sizeStr = new TextDecoder().decode(sizeBytes).replace(/\0/g, '').trim()
    const size = parseInt(sizeStr, 8) || 0

    // Read file type (byte 156)
    const typeFlag = data[offset + 156]

    // Skip to file content (after 512-byte header)
    const contentOffset = offset + 512

    // Type 0 or '0' is regular file, also check for empty type (old tar format)
    if ((typeFlag === 0 || typeFlag === 48) && size > 0) {
      const contentBytes = data.slice(contentOffset, contentOffset + size)

      if (isTextFile(name)) {
        try {
          const content = new TextDecoder().decode(contentBytes)
          files.push({
            name,
            content,
            isTeX: name.endsWith('.tex')
          })
        } catch {
          files.push({
            name,
            content: `[Binary file: ${name}]`,
            isTeX: false
          })
        }
      } else {
        files.push({
          name,
          content: `[Binary file: ${name}]`,
          isTeX: false
        })
      }
    }

    // Move to next file (content is padded to 512-byte blocks)
    const blocks = Math.ceil(size / 512)
    offset = contentOffset + blocks * 512
  }

  return files
}

export default function Viewer() {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null)
  const [openTabs, setOpenTabs] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [arxivId, setArxivId] = useState<string>('')
  const [title, setTitle] = useState<string>('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('id') || ''
    const paperTitle = params.get('title') || 'arXiv Paper'

    setArxivId(id)
    setTitle(decodeURIComponent(paperTitle))

    if (!id) {
      setError('No arXiv ID provided')
      setLoading(false)
      return
    }

    fetchAndExtractTexSource(id)
      .then((extractedFiles) => {
        setFiles(extractedFiles)
        // Auto-open the first .tex file
        const firstTeX = extractedFiles.find(f => f.isTeX)
        if (firstTeX) {
          setSelectedFile(firstTeX)
          setOpenTabs([firstTeX])
        }
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message || 'Failed to load TeX source')
        setLoading(false)
      })
  }, [])

  const handleFileClick = useCallback((file: FileEntry) => {
    setSelectedFile(file)
    if (!openTabs.find(t => t.name === file.name)) {
      setOpenTabs(prev => [...prev, file])
    }
  }, [openTabs])

  const handleCloseTab = useCallback((file: FileEntry, e: React.MouseEvent) => {
    e.stopPropagation()
    setOpenTabs(prev => {
      const newTabs = prev.filter(t => t.name !== file.name)
      if (selectedFile?.name === file.name) {
        setSelectedFile(newTabs[newTabs.length - 1] || null)
      }
      return newTabs
    })
  }, [selectedFile])

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner" />
        <div className="loading-text">Loading TeX source for {arxivId}...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="error-container">
        <div className="error-icon">⚠️</div>
        <div className="error-message">{error}</div>
        <div className="error-details">
          Make sure the paper ID is correct and the source is available.
        </div>
      </div>
    )
  }

  return (
    <div className="viewer-container">
      <div className="sidebar">
        <div className="sidebar-header">
          <h1>{title}</h1>
          <span className="arxiv-id">{arxivId}</span>
        </div>
        <div className="file-list">
          {files.map((file) => (
            <div
              key={file.name}
              className={`file-item ${selectedFile?.name === file.name ? 'active' : ''}`}
              onClick={() => handleFileClick(file)}
            >
              <span className="file-icon">{getFileIcon(file.name)}</span>
              <span className="file-name">{file.name}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="editor-container">
        {openTabs.length > 0 && (
          <div className="editor-tabs">
            {openTabs.map((tab) => (
              <div
                key={tab.name}
                className={`editor-tab ${selectedFile?.name === tab.name ? 'active' : ''}`}
                onClick={() => setSelectedFile(tab)}
              >
                <span>{tab.name}</span>
                <span
                  className="close-btn"
                  onClick={(e) => handleCloseTab(tab, e)}
                >
                  ×
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="editor-content">
          {selectedFile ? (
            <Editor
              height="100%"
              language={getLanguage(selectedFile.name)}
              value={selectedFile.content}
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: true },
                fontSize: 14,
                wordWrap: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          ) : (
            <div className="welcome-container">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
              </svg>
              <div className="welcome-text">Select a file to view its content</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
