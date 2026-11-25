import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))), pub = path.join(root, 'public');
const server = http.createServer((req, res) => {
  const file = path.join(pub, decodeURIComponent(new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(pub) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type }); fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const pw = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await pw.chromium.launch(process.env.CHROME_EXEC ? { executablePath: process.env.CHROME_EXEC } : {});
try {
  for (const viewport of [{ width: 1280, height: 860 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { Date.now = () => Date.UTC(2026, 10, 27, 12); window.EDICTUM_PROBE = g => { window.__game = g; }; });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.fill('#d-name', 'Anniversaria'); await page.click('#found-btn');
    await page.waitForFunction(() => window.__game && window.__game.S.nation && window.EDICTUM_PROBE.ann);
    await page.evaluate(() => window.EDICTUM_PROBE.ann.show());
    assert.equal(await page.locator('#anniversary [data-ann-box]').count(), 5);
    for (const i of [0, 1, 2, 3]) await page.locator(`[data-ann-box="${i}"]`).click();
    assert.equal(await page.evaluate(() => window.EDICTUM_PROBE.ann.bits(window.__game.S.nation)), 15);
    assert.equal(await page.locator('#anniversary .ann-box.open').count(), 4);
    const overflow = await page.locator('.ann-dialog').evaluate(el => el.scrollWidth > el.clientWidth);
    assert.equal(overflow, false, 'dialog fits the viewport');
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
