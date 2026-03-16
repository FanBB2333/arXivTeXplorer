const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

async function run() {
    const extensionPath = path.join(__dirname, '..', 'build');

    if (!fs.existsSync(extensionPath)) {
        console.error(`Extension build directory not found at ${extensionPath}. Please run 'npm run build' first.`);
        process.exit(1);
    }

    console.log('Launching browser with extension...');
    const browser = await puppeteer.launch({
        headless: false, // Must be false to load extensions
        defaultViewport: {
            width: 1280,
            height: 800
        },
        args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`
        ]
    });

    const page = await browser.newPage();
    const targetUrl = 'https://arxiv.org/abs/1706.03762';

    console.log(`Navigating to ${targetUrl}...`);
    await page.goto(targetUrl, { waitUntil: 'networkidle0' });

    console.log('Waiting for extension button to be injected...');
    // The content script adds a button with class 'arxiv-texplorer-btn'
    try {
        const buttonSelector = '.arxiv-texplorer-btn';
        await page.waitForSelector(buttonSelector, { timeout: 10000 });

        // Give it a moment to render properly
        await new Promise(r => setTimeout(r, 1000));

        console.log('Taking screenshot of arXiv page...');
        const imgDir = path.join(__dirname, '..', 'public', 'img');
        if (!fs.existsSync(imgDir)) {
            fs.mkdirSync(imgDir, { recursive: true });
        }

        const arxivScreenshotPath = path.join(imgDir, 'store_arxiv_page.png');
        await page.screenshot({ path: arxivScreenshotPath });
        console.log(`Saved arXiv page screenshot to ${arxivScreenshotPath}`);

        console.log('Clicking the View TeX Source button...');

        // Click might open a new tab, so we need to wait for it
        const newPagePromise = new Promise(x => browser.once('targetcreated', target => x(target.page())));

        // Get the href to know what to expect, or just click it
        await page.click(buttonSelector);

        console.log('Waiting for viewer tab to open...');
        const viewerPage = await newPagePromise;

        if (viewerPage) {
            // Set viewport for viewer too
            await viewerPage.setViewport({ width: 1280, height: 800 });

            console.log('Waiting for viewer to load...');
            // Wait for Monaco editor or file tree to appear
            await viewerPage.waitForSelector('.monaco-editor', { timeout: 15000 }).catch(() => console.log('Timeout waiting for monaco-editor, taking screenshot anyway'));
            await viewerPage.waitForSelector('.file-tree', { timeout: 15000 }).catch(() => console.log('Timeout waiting for file-tree'));

            // Wait extra time for syntax highlighting and rendering to complete
            await new Promise(r => setTimeout(r, 5000));

            console.log('Taking screenshot of viewer page...');
            const viewerScreenshotPath = path.join(imgDir, 'store_viewer_page.png');
            await viewerPage.screenshot({ path: viewerScreenshotPath });
            console.log(`Saved viewer page screenshot to ${viewerScreenshotPath}`);
        } else {
            console.error('Failed to get the new viewer tab.');
        }

    } catch (error) {
        console.error('Error during automation:', error);
    } finally {
        console.log('Closing browser...');
        await browser.close();
    }
}

run();
