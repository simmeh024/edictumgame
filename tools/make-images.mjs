// Renders src/og.html to src/og.png (1200 x 630) and src/favicon.svg to src/apple-touch-icon.png (180 x 180).
// The PNGs are committed, so the site build does not need this. Run it after changing the designs:
//   npm install --no-save playwright && npx playwright install chromium && node tools/make-images.mjs
// (set PLAYWRIGHT_MODULE and CHROMIUM_PATH to use an existing Playwright install instead)
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pw = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await pw.chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL(path.join(root, 'src/og.html')).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(root, 'src/og.png') });
await page.setViewportSize({ width: 180, height: 180 });
const svg = fs.readFileSync(path.join(root, 'src/favicon.svg'), 'utf8');
await page.setContent(`<body style="margin:0;background:#e8eeeb;display:grid;place-items:center;width:180px;height:180px">
  <img width="150" height="150" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body>`);
await page.screenshot({ path: path.join(root, 'src/apple-touch-icon.png') });
await browser.close();
console.log('wrote src/og.png and src/apple-touch-icon.png');
