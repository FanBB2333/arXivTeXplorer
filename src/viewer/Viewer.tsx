import { useState, useEffect, useCallback, useRef } from 'react'
import { unzipSync, strFromU8, gunzipSync } from 'fflate'
import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import './Viewer.css'

// Configure Monaco to use local bundled version
loader.config({ monaco })

// Register LaTeX language for syntax highlighting
monaco.languages.register({ id: 'latex' })
monaco.languages.setMonarchTokensProvider('latex', {
  defaultToken: '',
  tokenPostfix: '.tex',

  brackets: [
    { open: '{', close: '}', token: 'delimiter.curly' },
    { open: '[', close: ']', token: 'delimiter.bracket' },
    { open: '(', close: ')', token: 'delimiter.parenthesis' }
  ],

  tokenizer: {
    root: [
      // Comments
      [/%.*$/, 'comment'],

      // Math mode
      [/\$\$/, { token: 'string.math', next: '@mathDouble' }],
      [/\$/, { token: 'string.math', next: '@mathSingle' }],
      [/\\\[/, { token: 'string.math', next: '@mathDisplay' }],
      [/\\\(/, { token: 'string.math', next: '@mathInline' }],

      // Commands with arguments
      [/\\(begin|end)(\{)([a-zA-Z*]+)(\})/, ['keyword', 'delimiter.curly', 'variable.environment', 'delimiter.curly']],
      [/\\(documentclass|usepackage|input|include|bibliography|bibliographystyle)(\[?)/, ['keyword.control', 'delimiter.bracket']],
      [/\\(section|subsection|subsubsection|paragraph|chapter|part)(\*?)(\{)/, ['keyword.section', 'keyword.section', 'delimiter.curly']],
      [/\\(label|ref|cite|eqref|pageref|autoref|cref)(\{)/, ['keyword.reference', 'delimiter.curly']],
      [/\\(textbf|textit|texttt|textrm|textsf|textsc|emph|underline)(\{)/, ['keyword.style', 'delimiter.curly']],
      [/\\(newcommand|renewcommand|providecommand|DeclareMathOperator)(\*?)(\{)/, ['keyword.definition', 'keyword.definition', 'delimiter.curly']],

      // General commands
      [/\\[a-zA-Z@]+\*?/, 'keyword'],

      // Special characters
      [/\\[\\{}$&#%_^~]/, 'string.escape'],

      // Brackets
      [/[{}]/, 'delimiter.curly'],
      [/[\[\]]/, 'delimiter.bracket'],

      // Numbers
      [/\d+/, 'number'],
    ],

    mathDouble: [
      [/\$\$/, { token: 'string.math', next: '@pop' }],
      [/\\[a-zA-Z]+/, 'keyword.math'],
      [/[^$\\]+/, 'string.math'],
      [/./, 'string.math']
    ],

    mathSingle: [
      [/\$/, { token: 'string.math', next: '@pop' }],
      [/\\[a-zA-Z]+/, 'keyword.math'],
      [/[^$\\]+/, 'string.math'],
      [/./, 'string.math']
    ],

    mathDisplay: [
      [/\\\]/, { token: 'string.math', next: '@pop' }],
      [/\\[a-zA-Z]+/, 'keyword.math'],
      [/[^\]\\]+/, 'string.math'],
      [/./, 'string.math']
    ],

    mathInline: [
      [/\\\)/, { token: 'string.math', next: '@pop' }],
      [/\\[a-zA-Z]+/, 'keyword.math'],
      [/[^)\\]+/, 'string.math'],
      [/./, 'string.math']
    ]
  }
})

// Define LaTeX theme colors
monaco.editor.defineTheme('latex-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6A9955' },
    { token: 'keyword', foreground: '569CD6' },
    { token: 'keyword.control', foreground: 'C586C0' },
    { token: 'keyword.section', foreground: 'DCDCAA' },
    { token: 'keyword.reference', foreground: '4EC9B0' },
    { token: 'keyword.style', foreground: '9CDCFE' },
    { token: 'keyword.definition', foreground: 'C586C0' },
    { token: 'keyword.math', foreground: '569CD6' },
    { token: 'string.math', foreground: 'CE9178' },
    { token: 'string.escape', foreground: 'D7BA7D' },
    { token: 'variable.environment', foreground: '4EC9B0' },
    { token: 'delimiter.curly', foreground: 'FFD700' },
    { token: 'delimiter.bracket', foreground: 'DA70D6' },
    { token: 'number', foreground: 'B5CEA8' },
  ],
  colors: {}
})

// Register BibTeX language
monaco.languages.register({ id: 'bibtex' })
monaco.languages.setMonarchTokensProvider('bibtex', {
  defaultToken: '',
  tokenPostfix: '.bib',

  tokenizer: {
    root: [
      // Comments
      [/%.*$/, 'comment'],

      // Entry types
      [/@(article|book|inproceedings|proceedings|incollection|inbook|phdthesis|mastersthesis|techreport|manual|misc|unpublished|booklet|conference)\b/i, 'keyword.entry'],
      [/@(string|preamble|comment)\b/i, 'keyword.special'],

      // Field names
      [/\b(author|title|journal|booktitle|year|volume|number|pages|month|note|publisher|editor|series|address|edition|howpublished|organization|school|institution|doi|url|isbn|issn|abstract|keywords)\s*=/i, 'variable.field'],

      // Strings
      [/"[^"]*"/, 'string'],
      [/\{/, { token: 'delimiter.curly', next: '@braceString' }],

      // Numbers
      [/\d+/, 'number'],

      // Citation keys
      [/[a-zA-Z_][a-zA-Z0-9_:-]*/, 'identifier'],
    ],

    braceString: [
      [/\{/, { token: 'delimiter.curly', next: '@braceString' }],
      [/\}/, { token: 'delimiter.curly', next: '@pop' }],
      [/[^{}]+/, 'string']
    ]
  }
})

interface FileEntry {
  name: string
  content: string
  isTeX: boolean
  isBinary: boolean
  binaryData?: Uint8Array
  mimeType?: string
}

interface DownloadProgress {
  phase: 'downloading' | 'extracting' | 'done'
  loaded: number
  total: number
  percent: number
}

interface SearchResult {
  file: FileEntry
  line: number
  lineContent: string
  matchStart: number
  matchEnd: number
}

interface TreeNode {
  name: string
  path: string
  isFolder: boolean
  children: TreeNode[]
  file?: FileEntry
}

function buildFileTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode[] = []

  for (const file of files) {
    const parts = file.name.split('/')
    let currentLevel = root
    let currentPath = ''

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const isLastPart = i === parts.length - 1

      let existing = currentLevel.find(node => node.name === part)

      if (!existing) {
        const newNode: TreeNode = {
          name: part,
          path: currentPath,
          isFolder: !isLastPart,
          children: [],
          file: isLastPart ? file : undefined
        }
        currentLevel.push(newNode)
        existing = newNode
      }

      if (!isLastPart) {
        currentLevel = existing.children
      }
    }
  }

  // Sort: folders first, then files, alphabetically within each group
  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1
      if (!a.isFolder && b.isFolder) return 1
      // TeX files first among files
      if (!a.isFolder && !b.isFolder) {
        const aIsTex = a.file?.isTeX || false
        const bIsTex = b.file?.isTeX || false
        if (aIsTex && !bIsTex) return -1
        if (!aIsTex && bIsTex) return 1
      }
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortNodes(node.children)
      }
    }
    return nodes
  }

  return sortNodes(root)
}

// VS Code style flat file icons
function FileIcon({ filename, className }: { filename: string; className?: string }) {
  const ext = filename.split('.').pop()?.toLowerCase()
  const cls = className || 'file-icon-svg'

  // TeX file - green
  if (ext === 'tex' || ext === 'ltx' || ext === 'dtx') {
    return (
      <svg className={cls} viewBox="0 0 16 16" fill="none">
        <path d="M13 1H5L3 3v10l2 2h8l2-2V3l-2-2z" fill="#4a9c5d"/>
        <text x="8" y="11" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold" fontFamily="sans-serif">TeX</text>
      </svg>
    )
  }

  // BibTeX file - orange
  if (ext === 'bib' || ext === 'bst') {
    return (
      <svg className={cls} viewBox="0 0 16 16" fill="none">
        <path d="M13 1H5L3 3v10l2 2h8l2-2V3l-2-2z" fill="#cc7832"/>
        <text x="8" y="11" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold" fontFamily="sans-serif">BIB</text>
      </svg>
    )
  }

  // Style file - purple
  if (ext === 'sty' || ext === 'cls') {
    return (
      <svg className={cls} viewBox="0 0 16 16" fill="none">
        <path d="M13 1H5L3 3v10l2 2h8l2-2V3l-2-2z" fill="#9876aa"/>
        <text x="8" y="11" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold" fontFamily="sans-serif">STY</text>
      </svg>
    )
  }

  // PDF file - red
  if (ext === 'pdf') {
    return (
      <svg className={cls} viewBox="0 0 16 16" fill="none">
        <path d="M13 1H5L3 3v10l2 2h8l2-2V3l-2-2z" fill="#e74c3c"/>
        <text x="8" y="11" textAnchor="middle" fill="white" fontSize="4.5" fontWeight="bold" fontFamily="sans-serif">PDF</text>
      </svg>
    )
  }

  // EPS file - teal
  if (ext === 'eps') {
    return (
      <svg className={cls} viewBox="0 0 16 16" fill="none">
        <path d="M13 1H5L3 3v10l2 2h8l2-2V3l-2-2z" fill="#16a085"/>
        <text x="8" y="11" textAnchor="middle" fill="white" fontSize="4.5" fontWeight="bold" fontFamily="sans-serif">EPS</text>
      </svg>
    )
  }

  // Image files - blue
  if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext || '')) {
    return (
      <svg className={cls} viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="1" fill="#3498db"/>
        <circle cx="5.5" cy="5.5" r="1.5" fill="white"/>
        <path d="M3 12l3-4 2 2 3-3 2 3v2H3z" fill="white" opacity="0.9"/>
      </svg>
    )
  }

  // Default file icon - gray
  return (
    <svg className={cls} viewBox="0 0 16 16" fill="none">
      <path d="M10 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V4l-3-3z" fill="#6b7280"/>
      <path d="M10 1v3h3" fill="#9ca3af"/>
      <path d="M5 7h6M5 9h6M5 11h4" stroke="white" strokeWidth="0.8" opacity="0.7"/>
    </svg>
  )
}

// Folder icons
function FolderIcon({ isOpen, className }: { isOpen: boolean; className?: string }) {
  const cls = className || 'file-icon-svg'

  if (isOpen) {
    return (
      <svg className={cls} viewBox="0 0 16 16" fill="none">
        <path d="M1.5 3A1.5 1.5 0 013 1.5h3.293a1 1 0 01.707.293L8.5 3.5H13A1.5 1.5 0 0114.5 5v1h-13V3z" fill="#dcb67a"/>
        <path d="M1 6h14l-1.5 8H2.5L1 6z" fill="#e8c77b"/>
      </svg>
    )
  }

  return (
    <svg className={cls} viewBox="0 0 16 16" fill="none">
      <path d="M1.5 3A1.5 1.5 0 013 1.5h3.293a1 1 0 01.707.293L8.5 3.5H13A1.5 1.5 0 0114.5 5v8a1.5 1.5 0 01-1.5 1.5H3A1.5 1.5 0 011.5 13V3z" fill="#dcb67a"/>
    </svg>
  )
}

function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'tex':
    case 'sty':
    case 'cls':
    case 'ltx':
    case 'dtx':
      return 'latex'
    case 'bib':
    case 'bst':
      return 'bibtex'
    case 'json':
      return 'json'
    case 'xml':
      return 'xml'
    case 'py':
      return 'python'
    case 'js':
      return 'javascript'
    case 'ts':
      return 'typescript'
    case 'css':
      return 'css'
    case 'html':
      return 'html'
    case 'md':
      return 'markdown'
    case 'yaml':
    case 'yml':
      return 'yaml'
    default:
      return 'plaintext'
  }
}

function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'svg':
      return 'image/svg+xml'
    case 'pdf':
      return 'application/pdf'
    case 'eps':
      return 'application/postscript'
    default:
      return 'application/octet-stream'
  }
}

function isTextFile(filename: string): boolean {
  const textExtensions = [
    'tex', 'bib', 'sty', 'cls', 'bst', 'txt', 'md', 'cfg', 'def', 'fd', 'ins', 'dtx', 'ltx', 'bbx', 'cbx', 'lbx'
  ]
  const ext = filename.split('.').pop()?.toLowerCase()
  return ext ? textExtensions.includes(ext) : false
}

function isImageFile(filename: string): boolean {
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg']
  const ext = filename.split('.').pop()?.toLowerCase()
  return ext ? imageExtensions.includes(ext) : false
}

function isPdfFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.pdf')
}

async function fetchAndExtractTexSource(
  arxivId: string,
  onProgress: (progress: DownloadProgress) => void
): Promise<FileEntry[]> {
  const sourceUrl = `https://arxiv.org/src/${arxivId}`

  const response = await fetch(sourceUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch TeX source: ${response.status} ${response.statusText}`)
  }

  const contentLength = response.headers.get('content-length')
  const total = contentLength ? parseInt(contentLength, 10) : 0

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Failed to get response reader')
  }

  const chunks: Uint8Array[] = []
  let loaded = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    chunks.push(value)
    loaded += value.length

    onProgress({
      phase: 'downloading',
      loaded,
      total: total || loaded,
      percent: total ? Math.round((loaded / total) * 100) : 0
    })
  }

  const data = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.length
  }

  onProgress({
    phase: 'extracting',
    loaded,
    total: loaded,
    percent: 100
  })

  const contentType = response.headers.get('content-type') || ''
  const files: FileEntry[] = []

  if (data[0] === 0x1f && data[1] === 0x8b) {
    try {
      const decompressed = gunzipSync(data)

      if (isTarArchive(decompressed)) {
        const tarFiles = extractTar(decompressed)
        files.push(...tarFiles)
      } else {
        const content = strFromU8(decompressed)
        files.push({
          name: `${arxivId.replace(/\//g, '_')}.tex`,
          content,
          isTeX: true,
          isBinary: false
        })
      }
    } catch {
      const content = new TextDecoder().decode(data)
      files.push({
        name: `${arxivId.replace(/\//g, '_')}.tex`,
        content,
        isTeX: true,
        isBinary: false
      })
    }
  } else if (contentType.includes('application/x-eprint-tar') || contentType.includes('application/x-tar')) {
    const tarFiles = extractTar(data)
    files.push(...tarFiles)
  } else if (contentType.includes('text/') || contentType.includes('application/x-tex')) {
    const content = new TextDecoder().decode(data)
    files.push({
      name: `${arxivId.replace(/\//g, '_')}.tex`,
      content,
      isTeX: true,
      isBinary: false
    })
  } else {
    try {
      const unzipped = unzipSync(data)
      for (const [filename, fileData] of Object.entries(unzipped)) {
        if (isTextFile(filename)) {
          files.push({
            name: filename,
            content: strFromU8(fileData),
            isTeX: filename.endsWith('.tex'),
            isBinary: false
          })
        } else {
          files.push({
            name: filename,
            content: '',
            isTeX: false,
            isBinary: true,
            binaryData: fileData,
            mimeType: getMimeType(filename)
          })
        }
      }
    } catch {
      const content = new TextDecoder().decode(data)
      files.push({
        name: `${arxivId.replace(/\//g, '_')}.tex`,
        content,
        isTeX: true,
        isBinary: false
      })
    }
  }

  files.sort((a, b) => {
    if (a.isTeX && !b.isTeX) return -1
    if (!a.isTeX && b.isTeX) return 1
    return a.name.localeCompare(b.name)
  })

  onProgress({
    phase: 'done',
    loaded,
    total: loaded,
    percent: 100
  })

  return files
}

function isTarArchive(data: Uint8Array): boolean {
  if (data.length < 263) return false
  const magic = new TextDecoder().decode(data.slice(257, 262))
  return magic === 'ustar' || magic.startsWith('ustar')
}

function extractTar(data: Uint8Array): FileEntry[] {
  const files: FileEntry[] = []
  let offset = 0

  while (offset < data.length - 512) {
    const nameBytes = data.slice(offset, offset + 100)
    const name = new TextDecoder().decode(nameBytes).replace(/\0/g, '').trim()

    if (!name) break

    const sizeBytes = data.slice(offset + 124, offset + 136)
    const sizeStr = new TextDecoder().decode(sizeBytes).replace(/\0/g, '').trim()
    const size = parseInt(sizeStr, 8) || 0

    const typeFlag = data[offset + 156]
    const contentOffset = offset + 512

    if ((typeFlag === 0 || typeFlag === 48) && size > 0) {
      const contentBytes = data.slice(contentOffset, contentOffset + size)

      if (isTextFile(name)) {
        try {
          const content = new TextDecoder().decode(contentBytes)
          files.push({
            name,
            content,
            isTeX: name.endsWith('.tex'),
            isBinary: false
          })
        } catch {
          files.push({
            name,
            content: '',
            isTeX: false,
            isBinary: true,
            binaryData: new Uint8Array(contentBytes),
            mimeType: getMimeType(name)
          })
        }
      } else {
        files.push({
          name,
          content: '',
          isTeX: false,
          isBinary: true,
          binaryData: new Uint8Array(contentBytes),
          mimeType: getMimeType(name)
        })
      }
    }

    const blocks = Math.ceil(size / 512)
    offset = contentOffset + blocks * 512
  }

  return files
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function ImageViewer({ file }: { file: FileEntry }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  useEffect(() => {
    if (file.binaryData && file.mimeType) {
      const blob = new Blob([file.binaryData.buffer as ArrayBuffer], { type: file.mimeType })
      const url = URL.createObjectURL(blob)
      setImageUrl(url)
      return () => URL.revokeObjectURL(url)
    }
  }, [file])

  if (!imageUrl) {
    return (
      <div className="binary-viewer">
        <div className="binary-icon">🖼️</div>
        <div className="binary-name">{file.name}</div>
        <div className="binary-info">Loading image...</div>
      </div>
    )
  }

  return (
    <div className="image-viewer">
      <div className="image-container">
        <img src={imageUrl} alt={file.name} />
      </div>
      <div className="image-info">
        <span>{file.name}</span>
        <span>{file.binaryData ? formatBytes(file.binaryData.length) : ''}</span>
      </div>
    </div>
  )
}

function PdfViewer({ file }: { file: FileEntry }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)

  useEffect(() => {
    if (file.binaryData) {
      const blob = new Blob([file.binaryData.buffer as ArrayBuffer], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      setPdfUrl(url)
      return () => URL.revokeObjectURL(url)
    }
  }, [file])

  if (!pdfUrl) {
    return (
      <div className="binary-viewer">
        <div className="binary-icon">📑</div>
        <div className="binary-name">{file.name}</div>
        <div className="binary-info">Loading PDF...</div>
      </div>
    )
  }

  return (
    <div className="pdf-viewer">
      <iframe src={pdfUrl} title={file.name} />
    </div>
  )
}

function BinaryViewer({ file }: { file: FileEntry }) {
  return (
    <div className="binary-viewer">
      <div className="binary-icon">
        <FileIcon filename={file.name} className="binary-icon-svg" />
      </div>
      <div className="binary-name">{file.name}</div>
      <div className="binary-info">
        Binary file • {file.binaryData ? formatBytes(file.binaryData.length) : 'Unknown size'}
      </div>
      <div className="binary-hint">This file type cannot be previewed</div>
    </div>
  )
}

function FileTreeNode({
  node,
  depth,
  selectedFile,
  expandedFolders,
  onFileClick,
  onToggleFolder
}: {
  node: TreeNode
  depth: number
  selectedFile: FileEntry | null
  expandedFolders: Set<string>
  onFileClick: (file: FileEntry) => void
  onToggleFolder: (path: string) => void
}) {
  const isExpanded = expandedFolders.has(node.path)
  const isSelected = !node.isFolder && selectedFile?.name === node.file?.name

  const handleClick = () => {
    if (node.isFolder) {
      onToggleFolder(node.path)
    } else if (node.file) {
      onFileClick(node.file)
    }
  }

  return (
    <>
      <div
        className={`tree-item ${isSelected ? 'active' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
      >
        {node.isFolder ? (
          <span className="tree-chevron">
            {isExpanded ? (
              <svg viewBox="0 0 16 16" fill="currentColor">
                <path d="M5.7 13.7L5 13l4.6-4.6L5 3.7l.7-.7 5.3 5.4-5.3 5.3z" transform="rotate(90 8 8)" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="currentColor">
                <path d="M5.7 13.7L5 13l4.6-4.6L5 3.7l.7-.7 5.3 5.4-5.3 5.3z" />
              </svg>
            )}
          </span>
        ) : (
          <span className="tree-chevron-placeholder" />
        )}
        <span className="tree-icon">
          {node.isFolder ? (
            <FolderIcon isOpen={isExpanded} />
          ) : (
            <FileIcon filename={node.name} />
          )}
        </span>
        <span className="tree-name">{node.name}</span>
      </div>
      {node.isFolder && isExpanded && node.children.map(child => (
        <FileTreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedFile={selectedFile}
          expandedFolders={expandedFolders}
          onFileClick={onFileClick}
          onToggleFolder={onToggleFolder}
        />
      ))}
    </>
  )
}

function SearchPanel({ files, onResultClick, onClose }: {
  files: FileEntry[]
  onResultClick: (file: FileEntry, line: number) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }

    const searchResults: SearchResult[] = []
    const lowerQuery = query.toLowerCase()

    for (const file of files) {
      if (file.isBinary) continue

      const lines = file.content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const lowerLine = line.toLowerCase()
        const matchIndex = lowerLine.indexOf(lowerQuery)

        if (matchIndex !== -1) {
          searchResults.push({
            file,
            line: i + 1,
            lineContent: line,
            matchStart: matchIndex,
            matchEnd: matchIndex + query.length
          })
        }
      }
    }

    setResults(searchResults.slice(0, 100))
  }, [query, files])

  return (
    <div className="search-panel">
      <div className="search-header">
        <div className="search-input-container">
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Search in files..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="search-clear" onClick={() => setQuery('')}>×</button>
          )}
        </div>
        <button className="search-close" onClick={onClose}>×</button>
      </div>
      <div className="search-results">
        {query && results.length === 0 && (
          <div className="search-no-results">No results found</div>
        )}
        {results.map((result, index) => (
          <div
            key={`${result.file.name}-${result.line}-${index}`}
            className="search-result"
            onClick={() => onResultClick(result.file, result.line)}
          >
            <div className="result-file">
              <span className="result-file-icon"><FileIcon filename={result.file.name} /></span>
              <span className="result-file-name">{result.file.name}</span>
              <span className="result-line-number">:{result.line}</span>
            </div>
            <div className="result-content">
              <span>{result.lineContent.substring(0, result.matchStart)}</span>
              <mark>{result.lineContent.substring(result.matchStart, result.matchEnd)}</mark>
              <span>{result.lineContent.substring(result.matchEnd)}</span>
            </div>
          </div>
        ))}
        {results.length >= 100 && (
          <div className="search-limit-notice">Showing first 100 results</div>
        )}
      </div>
    </div>
  )
}

export default function Viewer() {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null)
  const [openTabs, setOpenTabs] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [arxivId, setArxivId] = useState<string>('')
  const [title, setTitle] = useState<string>('')
  const [progress, setProgress] = useState<DownloadProgress>({
    phase: 'downloading',
    loaded: 0,
    total: 0,
    percent: 0
  })
  const [showSearch, setShowSearch] = useState(false)
  const [goToLine, setGoToLine] = useState<number | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const editorRef = useRef<any>(null)

  const fileTree = buildFileTree(files)

  const handleToggleFolder = useCallback((path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

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

    fetchAndExtractTexSource(id, setProgress)
      .then((extractedFiles) => {
        setFiles(extractedFiles)
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault()
        setShowSearch(prev => !prev)
      }
      if (e.key === 'Escape') {
        setShowSearch(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Jump to line when goToLine changes
  useEffect(() => {
    if (goToLine && editorRef.current) {
      editorRef.current.revealLineInCenter(goToLine)
      editorRef.current.setPosition({ lineNumber: goToLine, column: 1 })
      setGoToLine(null)
    }
  }, [goToLine, selectedFile])

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

  const handleSearchResultClick = useCallback((file: FileEntry, line: number) => {
    handleFileClick(file)
    setGoToLine(line)
  }, [handleFileClick])

  const handleEditorMount = (editor: any) => {
    editorRef.current = editor
  }

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-content">
          <div className="loading-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
          </div>
          <div className="loading-title">
            {progress.phase === 'downloading' ? 'Downloading TeX Source' : 'Extracting Files'}
          </div>
          <div className="loading-arxiv-id">{arxivId}</div>

          <div className="progress-container">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="progress-info">
              {progress.phase === 'downloading' ? (
                <>
                  <span>{formatBytes(progress.loaded)}</span>
                  {progress.total > 0 && (
                    <span> / {formatBytes(progress.total)}</span>
                  )}
                  <span className="progress-percent"> ({progress.percent}%)</span>
                </>
              ) : (
                <span>Processing archive...</span>
              )}
            </div>
          </div>
        </div>
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

  const renderFileContent = () => {
    if (!selectedFile) {
      return (
        <div className="welcome-container">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
          </svg>
          <div className="welcome-text">Select a file to view its content</div>
        </div>
      )
    }

    if (selectedFile.isBinary) {
      if (isImageFile(selectedFile.name)) {
        return <ImageViewer file={selectedFile} />
      }
      if (isPdfFile(selectedFile.name)) {
        return <PdfViewer file={selectedFile} />
      }
      return <BinaryViewer file={selectedFile} />
    }

    return (
      <Editor
        height="100%"
        language={getLanguage(selectedFile.name)}
        value={selectedFile.content}
        theme="latex-dark"
        onMount={handleEditorMount}
        options={{
          readOnly: true,
          minimap: { enabled: true },
          fontSize: 14,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'off',
          automaticLayout: true,
          folding: true,
          renderLineHighlight: 'all',
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
        }}
      />
    )
  }

  return (
    <div className="viewer-container">
      {/* Activity Bar */}
      <div className="activity-bar">
        <button
          className={`activity-button ${!showSearch ? 'active' : ''}`}
          onClick={() => setShowSearch(false)}
          title="Explorer"
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.5 0h-9L7 1.5V6H2.5L1 7.5v15.07L2.5 24h12.07L16 22.57V18h4.7l1.3-1.43V4.5L17.5 0zm0 2.12l2.38 2.38H17.5V2.12zm-3 20.38h-12v-15H7v9.07L8.5 18h6v4.5zm6-6h-12v-15H16V6h4.5v10.5z"/>
          </svg>
        </button>
        <button
          className={`activity-button ${showSearch ? 'active' : ''}`}
          onClick={() => setShowSearch(true)}
          title="Search (Ctrl+Shift+F)"
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.25 0a8.25 8.25 0 0 0-6.18 13.72L1 22.88l1.12 1.12 8.05-9.12A8.251 8.251 0 1 0 15.25.01V0zm0 15a6.75 6.75 0 1 1 0-13.5 6.75 6.75 0 0 1 0 13.5z"/>
          </svg>
        </button>
      </div>

      {/* Sidebar */}
      <div className="sidebar" style={{ display: showSearch ? 'none' : 'flex' }}>
        <div className="sidebar-header">
          <span className="sidebar-title">EXPLORER</span>
        </div>
        <div className="sidebar-section">
          <div className="section-header">
            <span className="section-title">{title}</span>
            <span className="file-count">{files.length} files</span>
          </div>
          <div className="file-tree">
            {fileTree.map(node => (
              <FileTreeNode
                key={node.path}
                node={node}
                depth={0}
                selectedFile={selectedFile}
                expandedFolders={expandedFolders}
                onFileClick={handleFileClick}
                onToggleFolder={handleToggleFolder}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Search Panel */}
      {showSearch && (
        <SearchPanel
          files={files}
          onResultClick={handleSearchResultClick}
          onClose={() => setShowSearch(false)}
        />
      )}

      {/* Editor Area */}
      <div className="editor-area">
        {openTabs.length > 0 && (
          <div className="editor-tabs">
            {openTabs.map((tab) => (
              <div
                key={tab.name}
                className={`editor-tab ${selectedFile?.name === tab.name ? 'active' : ''}`}
                onClick={() => setSelectedFile(tab)}
              >
                <span className="tab-icon"><FileIcon filename={tab.name} /></span>
                <span className="tab-name">{tab.name}</span>
                <span
                  className="tab-close"
                  onClick={(e) => handleCloseTab(tab, e)}
                >
                  ×
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="editor-content">
          {renderFileContent()}
        </div>

        {/* Status Bar */}
        <div className="status-bar">
          <div className="status-left">
            <span className="status-item">{arxivId}</span>
          </div>
          <div className="status-right">
            {selectedFile && !selectedFile.isBinary && (
              <>
                <span className="status-item">
                  {selectedFile.content.split('\n').length} lines
                </span>
                <span className="status-item">
                  {getLanguage(selectedFile.name).toUpperCase()}
                </span>
              </>
            )}
            <span className="status-item">UTF-8</span>
          </div>
        </div>
      </div>
    </div>
  )
}
