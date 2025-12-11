# arXivTeXplorer

A Chrome extension to view arXiv paper TeX source in a VS Code-like interface.

## Features

- View TeX source files directly from arXiv abstract pages
- VS Code-like interface with Monaco Editor
- Syntax highlighting for LaTeX, BibTeX, and other TeX-related files
- Support for gzipped and tar archives
- File tree navigation for multi-file papers

## Installation

### From Source

1. Make sure you have Node.js >= 18 installed
2. Clone this repository
3. Run `npm install` to install dependencies
4. Run `npm run build` to build the extension
5. Open Chrome and go to `chrome://extensions/`
6. Enable "Developer mode" in the top right
7. Click "Load unpacked" and select the `build` folder

## Usage

1. Go to any arXiv paper page (e.g., `https://arxiv.org/abs/1706.03762`)
2. Find the **"View TeX Source"** button next to "TeX Source" in the sidebar
3. Click the button to open the TeX viewer in a new tab
4. Browse and view all TeX files in the paper

## Development

```shell
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### Loading in Chrome

1. Enable Developer Mode in `chrome://extensions/`
2. Click "Load unpacked" and select the `build` folder
3. The extension will be active on arXiv.org

## Tech Stack

- React 18
- TypeScript
- Vite
- Monaco Editor (VS Code's editor)
- fflate (for gzip/zip decompression)
- Chrome Extension Manifest V3

## License

MIT
