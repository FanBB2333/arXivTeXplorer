import * as monaco from 'monaco-editor'

// Types
export interface FileEntry {
  name: string
  content: string
  isTeX: boolean
  isBinary: boolean
  binaryData?: Uint8Array
  mimeType?: string
}

export interface LabelDefinition {
  name: string
  file: string
  line: number
  column: number // 1-based
}

export interface CitationEntry {
  key: string
  file: string
  line: number
  title?: string
  author?: string
}

export interface SectionInfo {
  title: string
  level: number // 0=part, 1=chapter, 2=section, etc.
  line: number
  file: string
  id: string // Unique ID for key
}

// Helper to find line number from index
function getLineNumber(content: string, index: number): number {
  return content.substring(0, index).split('\n').length
}

// Helper to find column number from index
function getColumnNumber(content: string, index: number): number {
  const lines = content.substring(0, index).split('\n')
  return lines[lines.length - 1].length + 1
}

// --- Parsing Functions ---

export function collectLabels(files: FileEntry[]): Map<string, LabelDefinition> {
  const labels = new Map<string, LabelDefinition>()

  for (const file of files) {
    if (!file.isTeX) continue

    const regex = /\\label\{([^}]+)\}/g
    let match
    while ((match = regex.exec(file.content)) !== null) {
      const labelName = match[1]
      labels.set(labelName, {
        name: labelName,
        file: file.name,
        line: getLineNumber(file.content, match.index),
        column: getColumnNumber(file.content, match.index)
      })
    }
  }

  return labels
}

export function collectCitations(files: FileEntry[]): Map<string, CitationEntry> {
  const citations = new Map<string, CitationEntry>()

  for (const file of files) {
    // Check .bib files
    if (file.name.endsWith('.bib')) {
      // Regex for BibTeX entries: @type{key,
      const regex = /@\w+\s*\{\s*([^,]+),/g
      let match
      while ((match = regex.exec(file.content)) !== null) {
        const key = match[1].trim()
        
        // Try to extract title and author for context (simplified)
        const entryEndIndex = file.content.indexOf('}', match.index)
        const entryContent = file.content.substring(match.index, entryEndIndex !== -1 ? entryEndIndex : undefined)
        
        const titleMatch = /title\s*=\s*[\"{](.+?)[\"}]/i.exec(entryContent)
        const authorMatch = /author\s*=\s*[\"{](.+?)[\"}]/i.exec(entryContent)
        
        citations.set(key, {
          key,
          file: file.name,
          line: getLineNumber(file.content, match.index),
          title: titleMatch ? titleMatch[1] : undefined,
          author: authorMatch ? authorMatch[1] : undefined
        })
      }
    }
  }

  return citations
}

export function parseDocumentOutline(files: FileEntry[], rootFile?: FileEntry): SectionInfo[] {
  // Simple approach: parse all TeX files.
  // Ideally we should follow \input structure starting from root, but looking at all files is a robust fallback.
  // We sort files to try to put root first or follow typical naming.
  
  const sections: SectionInfo[] = []
  
  // Weights for sorting files to approximation order
  const getFileWeight = (name: string) => {
    if (name === rootFile?.name) return -100
    if (name.includes('main') || name.includes('root')) return -50
    if (name.includes('intro')) return -40
    if (name.includes('abstract')) return -45
    return 0
  }

  const sortedFiles = [...files]
    .filter(f => f.isTeX)
    .sort((a, b) => getFileWeight(a.name) - getFileWeight(b.name) || a.name.localeCompare(b.name))

  for (const file of sortedFiles) {
    const regex = /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\{([^}]+)\}/g
    let match
    while ((match = regex.exec(file.content)) !== null) {
      const type = match[1]
      const title = match[2]
      
      let level = 2 // default section
      if (type === 'part') level = 0
      if (type === 'chapter') level = 1
      if (type === 'section') level = 2
      if (type === 'subsection') level = 3
      if (type === 'subsubsection') level = 4
      if (type === 'paragraph') level = 5

      sections.push({
        title,
        level,
        line: getLineNumber(file.content, match.index),
        file: file.name,
        id: `${file.name}-${match.index}`
      })
    }
  }

  return sections
}

// --- Monaco Provider Factories ---

export function createDefinitionProvider(getAllFiles: () => FileEntry[]): monaco.languages.DefinitionProvider {
  return {
    provideDefinition: (model, position, token) => {
      const files = getAllFiles()
      const lineContent = model.getLineContent(position.lineNumber)
      
      // Check for \ref{...} / \eqref{...} / \autoref{...}
      // We look for the command around the cursor position
      // Simple regex check on the line suitable for most cases
      const refMatch = /\\(ref|eqref|autoref|cref|Cref)\{([^}]+)\}/.exec(lineContent)
      if (refMatch) {
        // Ensure cursor includes the match (simplified check)
        const startIndex = lineContent.indexOf(refMatch[0])
        if (position.column >= startIndex + 1 && position.column <= startIndex + refMatch[0].length + 1) {
          const label = refMatch[2]
          // Find label definition
          const labels = collectLabels(files)
          const def = labels.get(label)
          
          if (def) {
            const targetFile = files.find(f => f.name === def.file)
            if (targetFile) {
              // If target is in another file, we might need logic to open it. 
              // Monaco's definition provider typically jumps within models. 
              // Since we might not have models for all files, we rely on the editor app to handle model switching if needed.
              // For now, return the location. The Viewer component needs to ensure the model exists or handle the URI.
              return {
                uri: monaco.Uri.parse(`file:///${def.file}`), // Virtual URI scheme
                range: new monaco.Range(def.line, 1, def.line, 1)
              }
            }
          }
        }
      }

      // Check for \cite{...}
      const citeMatch = /\\(cite|citep|citet)\{([^}]+)\}/.exec(lineContent)
      if (citeMatch) {
         const startIndex = lineContent.indexOf(citeMatch[0])
         if (position.column >= startIndex + 1 && position.column <= startIndex + citeMatch[0].length + 1) {
            const keyString = citeMatch[2]
            // Handle multiple citations \cite{key1,key2} - find the one under cursor
            // This is tricky without exact offset. Let's just try to match the full string or first valid key for now.
            // A better parser would find exact token under cursor.
            
            // Assume single key for simplicity or first key found
            const keys = keyString.split(',').map(k => k.trim())
            const citations = collectCitations(files)
            
            for (const key of keys) {
                const def = citations.get(key)
                if (def) {
                    return {
                        uri: monaco.Uri.parse(`file:///${def.file}`),
                        range: new monaco.Range(def.line, 1, def.line, 1)
                    }
                }
            }
         }
      }
      
      // Check for \input{...} / \include{...}
      const inputMatch = /\\(input|include)\{([^}]+)\}/.exec(lineContent)
      if (inputMatch) {
        const startIndex = lineContent.indexOf(inputMatch[0])
        if (position.column >= startIndex + 1 && position.column <= startIndex + inputMatch[0].length + 1) {
            let filename = inputMatch[2]
            if (!filename.endsWith('.tex')) filename += '.tex'
            
            const targetFile = files.find(f => f.name === filename)
            if (targetFile) {
                // Return range 1,1 of that file
                return {
                    uri: monaco.Uri.parse(`file:///${targetFile.name}`),
                    range: new monaco.Range(1, 1, 1, 1)
                }
            }
        }
      }

      return []
    }
  }
}

export function createCompletionProvider(getAllFiles: () => FileEntry[]): monaco.languages.CompletionItemProvider {
  return {
    triggerCharacters: ['\\', '{', '{', ','],
    provideCompletionItems: (model, position) => {
      const textUntilPosition = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      })

      const suggestions: monaco.languages.CompletionItem[] = []

      // 1. Command completion (starts with \)
      if (textUntilPosition.endsWith('\\')) {
        const commands = [
          'begin', 'end', 'section', 'subsection', 'subsubsection', 'paragraph', 'chapter',
          'label', 'ref', 'cite', 'usepackage', 'input', 'include',
          'alpha', 'beta', 'gamma', 'delta', 'frac', 'sum', 'prod', 'int', 'infty'
        ]
        
        suggestions.push(...commands.map(cmd => ({
          label: `\\${cmd}`,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: cmd,
          range: {
             startLineNumber: position.lineNumber,
             startColumn: position.column, // cursor is after \
             endLineNumber: position.lineNumber, 
             endColumn: position.column
          }
        })))
      }

      // 2. Reference completion (inside \ref{ or \cite{)
      const refMatch = /\\(ref|eqref|autoref|cref)\{[^}]*$/.exec(textUntilPosition)
      if (refMatch) {
          const files = getAllFiles()
          const labels = collectLabels(files)
          for (const [name, def] of labels) {
              suggestions.push({
                  label: name,
                  kind: monaco.languages.CompletionItemKind.Reference,
                  insertText: name,
                  detail: `${def.file}:${def.line}`,
                  range: {
                    startLineNumber: position.lineNumber,
                    startColumn: position.column,
                    endLineNumber: position.lineNumber, 
                    endColumn: position.column
                  }
              })
          }
      }

      const citeMatch = /\\(cite|citet|citep)\{[^}]*$/.exec(textUntilPosition)
      if (citeMatch) {
          const files = getAllFiles()
          const citations = collectCitations(files)
          for (const [key, def] of citations) {
              suggestions.push({
                  label: key,
                  kind: monaco.languages.CompletionItemKind.Reference,
                  insertText: key,
                  detail: def.title ? `${def.title} (${def.author || 'Unknown'})` : def.file,
                  range: {
                    startLineNumber: position.lineNumber,
                    startColumn: position.column,
                    endLineNumber: position.lineNumber, 
                    endColumn: position.column
                  }
              })
          }
      }
      
      // 3. Environment completion (inside \begin{ or \end{)
      const envMatch = /\\(begin|end)\{[^}]*$/.exec(textUntilPosition)
      if (envMatch) {
          const envs = [
              'document', 'figure', 'table', 'tabular', 'itemize', 'enumerate', 'description',
              'equation', 'align', 'center', 'minipage', 'abstract'
          ]
          suggestions.push(...envs.map(env => ({
              label: env,
              kind: monaco.languages.CompletionItemKind.Module,
              insertText: env,
              range: {
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: position.lineNumber, 
                endColumn: position.column
              }
          })))
      }
      
      // 4. Input file completion
      const inputMatch = /\\(input|include)\{[^}]*$/.exec(textUntilPosition)
      if (inputMatch) {
          const files = getAllFiles()
          const texFiles = files.filter(f => f.isTeX && f.name !== model.uri.path.split('/').pop())
          
          suggestions.push(...texFiles.map(f => ({
              label: f.name.replace('.tex', ''), // usually input is without extension
              kind: monaco.languages.CompletionItemKind.File,
              insertText: f.name.replace('.tex', ''),
              detail: f.name,
              range: {
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: position.lineNumber, 
                endColumn: position.column
              }
          })))
      }

      return { suggestions }
    }
  }
}
