/* Renders the war mock-ups to PNGs, light and dark, so the design can be looked at before the game is touched.
   Run: node tools/mockups/render-war.mjs [tools/mockups/built] */
import {chromium} from 'playwright';
import path from 'node:path';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ''));
const out = path.resolve(process.argv[2] || path.join(here, 'built'));
mkdirSync(out, {recursive: true});

const jobs = [
  ['war-office', 'war-office.html', 'light', 1280, 900],
  ['war-office-dark', 'war-office.html', 'dark', 1280, 900],
  ['war-office-mobile', 'war-office.html', 'light', 390, 844],
  ['battle-die', 'battle-die.html', 'light', 1420, 980],
  ['battle-die-dark', 'battle-die.html', 'dark', 1420, 980],
  ['dip-wars', 'dip-wars.html', 'light', 1280, 900],
  ['dip-wars-dark', 'dip-wars.html', 'dark', 1280, 900],
  ['dip-wars-mobile', 'dip-wars.html', 'light', 390, 844],
];

const b = await chromium.launch();
for (const [name, file, theme, width, height] of jobs) {
  const page = await b.newPage({viewport: {width, height}, deviceScaleFactor: 2});
  await page.goto(pathToFileURL(path.join(here, file)).href);
  await page.evaluate(t => {document.documentElement.dataset.theme = t;}, theme);
  try {await page.waitForFunction(() => document.fonts.status === 'loaded', {timeout: 8000});}
  catch (e) {console.log(name + ': the web fonts did not load, so the type is a fallback');}
  await page.waitForTimeout(400);
  await page.screenshot({path: path.join(out, name + '.png'), fullPage: true});
  console.log(name + ' → ' + path.join(out, name + '.png'));
  await page.close();
}
await b.close();
