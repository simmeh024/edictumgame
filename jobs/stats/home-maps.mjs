// The front page's region maps (game/edictum.html, "the front page"): for every region with player nations, who holds
// each hex and where each capital stands, written to home/map-<region>. Worked out by the game itself, in a headless
// browser (Playwright): the built site is opened offline in the region (no sign-in, no Firestore), handed the region's
// records as its players read them, and asked with its own territory() (hmBake), so the front page shows the land as
// it is in the game and the job keeps no copy of the rules. The page draws it on the region's baked terrain.
//
//   python build.py && npm ci && npx playwright install chromium && npm ci --prefix jobs/stats
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/key.json node jobs/stats/home-maps.mjs --project <id>
//   node jobs/stats/home-maps.mjs --project demo-edictum            # the emulators, with FIRESTORE_EMULATOR_HOST set
//   ... --dry [--out <dir>]     works the maps out and writes them as JSON files in <dir> (or prints a report) instead
//   ... --site <dir>            the built site to open (default: public/, served here on a free port)
//
// .github/workflows/home-maps.yml runs it once a night. Reads: every nations/ record once (their shared half, as
// every player of a region reads it), the moderators' marks (mod/) and the bans. Writes one document per region.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { recordOf } from '../../functions/home.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const projectId = opt('--project') || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
if (!projectId) { console.error('home-maps.mjs: name the project with --project <id>'); process.exit(2); }
const dry = args.includes('--dry'), outDir = opt('--out'), site = path.resolve(opt('--site') || path.join(ROOT, 'public'));
const only = opt('--only');
/* playwright is the repository's own (the root package's), not the job's */
const { chromium } = createRequire(path.join(ROOT, 'package.json'))('playwright');

const emulated = !!process.env.FIRESTORE_EMULATOR_HOST;
if (emulated) process.env.METADATA_SERVER_DETECTION = 'none';
initializeApp(emulated ? { projectId } : { projectId, credential: applicationDefault() });
const db = getFirestore();
const ms = v => v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : 0;

/* the built site, served from here: the page plays offline (no /__/firebase/init.json) */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.map': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname), f = path.join(site, u === '/' ? 'index.html' : u);
    if (!f.startsWith(site)) throw new Error('outside');
    const body = await readFile(f);
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port + '/';

const t0 = Date.now();
const [nat, mod, bans] = await Promise.all([
  db.collection('nations').select('j', 'z', 'reg', 'ts', 'pop', 'army', 'cl', 'rev').get(),
  db.collection('mod').get(),
  db.collection('bans').select().get(),
]);
const hidden = new Set(mod.docs.filter(d => d.get('hidden') || d.get('removed')).map(d => d.id).concat(bans.docs.map(d => d.id)));
/* each region's records, as src/shim.js hands them to the game (decode): the record with the server's stamps */
const byReg = new Map();
for (const d of nat.docs) {
  const rec = recordOf(d);
  if (!rec) continue;
  const reg = typeof rec.reg === 'string' && rec.reg ? rec.reg : d.get('reg') || 'meridian';
  Object.assign(rec, { _ts: ms(d.get('ts')), _pop: typeof d.get('pop') === 'number' ? d.get('pop') : undefined, _army: typeof d.get('army') === 'number' ? d.get('army') : undefined,
    _cl: typeof d.get('cl') === 'number' ? d.get('cl') : undefined, _rev: Number.isSafeInteger(d.get('rev')) && d.get('rev') >= 0 ? d.get('rev') : 0, _dirty: false });
  if (!byReg.has(reg)) byReg.set(reg, {});
  byReg.get(reg)[d.id] = rec;
}
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const report = { at: new Date(t0).toISOString(), records: nat.size, regions: {}, dry };
try {
  for (const [reg, raws] of [...byReg].sort()) {
    if (only && reg !== only) continue;
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    await ctx.addInitScript(r => {
      try { localStorage.clear(); localStorage.setItem('statehood.region', r); localStorage.setItem('edictum.analytics', 'n'); } catch (e) {}
      window.EDICTUM_PROBE = g => { window.G = g; };
    }, reg);
    await ctx.route('**/__/firebase/init.json', r => r.fulfill({ status: 404, body: '' }));
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e && e.message || e).slice(0, 200)));
    try {
      await page.goto(base, { waitUntil: 'load' });
      await page.waitForFunction(r => window.G && window.G.HMB && window.G.HMB().REG.id === r, reg, { timeout: 60000 });
      const doc = await page.evaluate(([raws, hidden]) => window.G.HMB().hmBake(raws, hidden), [raws, [...hidden].filter(id => raws[id])]);
      const names = doc.ns.filter(x => !x.npc && x.nm).length;
      report.regions[reg] = { players: doc.players, named: names, holders: doc.ns.length, bytes: JSON.stringify(doc).length, errors: errs.length };
      if (!doc.players) continue;
      const out = { v: doc.v, at: Date.now(), c: doc.c, r: doc.r, o: doc.o, ns: doc.ns };
      if (outDir) { await mkdir(outDir, { recursive: true }); await writeFile(path.join(outDir, 'map-' + reg + '.json'), JSON.stringify(out)); }
      if (!dry) await db.doc('home/map-' + reg).set(out);
    } catch (e) {
      report.regions[reg] = { error: String(e && e.message || e).slice(0, 300), errors: errs };
      process.exitCode = 1;
    } finally { await ctx.close(); }
  }
} finally { await browser.close(); server.close(); }
report.ms = Date.now() - t0;
console.log(JSON.stringify(report, null, 1));
