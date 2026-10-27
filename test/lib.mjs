// Shared helpers for the browser tests (test/e2e.mjs, test/smoke.mjs). They drive the built
// site in public/ as served by the Hosting emulator, against the Auth and Firestore emulators.
//
// Playwright is a pinned dev dependency (npm ci); its browser is installed once with
//   npx playwright install chromium
// or point at an existing install: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chromium
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const pw = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
export const BASE = (process.env.BASE_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
export const PROJECT = process.env.GCLOUD_PROJECT || 'demo-edictum';
export const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
export const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
export const OUT = process.env.TEST_OUT || path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
fs.mkdirSync(OUT, { recursive: true });
export const CONFIG = { apiKey: 'fake-api-key', projectId: PROJECT, authDomain: PROJECT + '.firebaseapp.com' };
export const EMULATORS = { firestore: FS_HOST, auth: 'http://' + AUTH_HOST };

export const browser = await pw.chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
export const errors = [];
const results = [];
export function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  return !!ok;
}
export async function finish() {
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} checks passed; page errors ${JSON.stringify(errors)}`);
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function until(fn, ms = 8000, step = 150) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch (e) { /* try again */ } await sleep(step); }
  return v;
}

// A player is a browser profile of its own (own storage, so its own anonymous account).
// opts: vp {width,height}, dark, inject (default true: config and emulators set by the test),
//       block (a RegExp of requests to fail), tag (a name for error reports),
//       cap (players per region before founding steers elsewhere; the game's default otherwise)
// Saves reach Firestore after 1.5 s instead of the game's 15 s, so the tests need not wait.
export async function player(tag, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.vp || { width: 1280, height: 900 }, colorScheme: opts.dark ? 'dark' : 'light', acceptDownloads: true, storageState: opts.storageState });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  if (opts.block) await ctx.route(opts.block, r => r.abort());
  await ctx.addInitScript(cap => { window.EDICTUM_SAVE_GAP = 1500; if (cap) window.EDICTUM_REGION_CAP = cap; }, opts.cap || 0);
  if (opts.inject !== false) await ctx.addInitScript(([c, e]) => { window.EDICTUM_FIREBASE_CONFIG = c; window.EDICTUM_EMULATORS = e; }, [CONFIG, EMULATORS]);
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(tag + ' PAGEERROR ' + e.message));
  p.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|ERR_FAILED|fonts\.g/.test(t)) return; // blocked fonts, or Firebase blocked on purpose
    errors.push(tag + ' console: ' + t.slice(0, 300));
  });
  p.ctx = ctx; p.tag = tag;
  return p;
}
export async function open(p, url = BASE + '/') {
  await p.goto(url);
  return ready(p);
}
// wait until the runtime has settled; returns the uid, or null in browser-only mode
export function ready(p) { return p.evaluate(() => window.claude.use('user').then(u => u ? u.id() : null)); }
export async function found(p, name) {
  await p.waitForSelector('#d-name');
  await p.fill('#d-name', name);
  await p.click('[data-act="found-suggest"]');
  await p.click('#found-btn');
  await p.waitForSelector('.layout', { timeout: 10000 });
  await sleep(400);
}
export const nav = async (p, v) => { await p.evaluate(v => document.querySelector(`.nav [data-v="${v}"]`).click(), v); await sleep(250); };
export const text = (p, sel) => p.$eval(sel, el => el.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
export const sideName = p => text(p, '.side-nm');
export const localNation = p => p.evaluate(() => JSON.parse(localStorage.getItem('statehood.nation.v1') || 'null'));

// Firestore over REST with no sign-in at all (as a stranger on the internet)
export async function restGet(docPath) {
  const r = await fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${docPath}`);
  return { status: r.status, body: await r.json().catch(() => null) };
}
export async function restPatch(docPath, fields) {
  const r = await fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${docPath}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields }) });
  return r.status;
}
// the documents of a collection (one page is plenty here), as {id, fields}
export async function restList(colPath) {
  const r = await restGet(colPath + '?pageSize=300');
  return r.status === 200 ? (r.body.documents || []).map(d => ({ id: d.name.split('/').pop(), fields: d.fields || {} })) : [];
}
// the same, past the rules (the Firestore emulator takes "Bearer owner" as an admin credential)
export async function restListAdmin(colPath) {
  const r = await fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${colPath}?pageSize=300`, { headers: { authorization: 'Bearer owner' } });
  const b = await r.json().catch(() => ({}));
  return r.status === 200 ? (b.documents || []).map(d => ({ id: d.name.split('/').pop(), fields: d.fields || {} })) : [];
}
// whether the Auth emulator still has an account
export async function accountExists(uid) {
  const r = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId: [uid] })
  });
  const b = await r.json().catch(() => ({}));
  return Array.isArray(b.users) && b.users.length > 0;
}
// a nation's stored envelope: rec is the whole record (the shared half in nations/ joined with the private
// half in nationx/, as src/shim.js joins them), shared the shared half alone
export async function nationDoc(uid) {
  const [r, x] = await Promise.all([restGet('nations/' + uid), restGet('nationx/' + uid)]);
  if (r.status !== 200) return null;
  const f = r.body.fields || {}, shared = f.j ? JSON.parse(f.j.stringValue) : null;
  const ext = x.status === 200 && x.body.fields && x.body.fields.j ? JSON.parse(x.body.fields.j.stringValue) : null;
  let rec = shared;
  if (shared && ext) { rec = Object.assign({}, ext, shared); if (ext.pp && shared.pp) rec.pp = Object.assign({}, ext.pp, shared.pp); }
  return { v: f.v && Number(f.v.integerValue), name: f.name && f.name.stringValue, reg: f.reg && f.reg.stringValue, rec, shared, keys: Object.keys(f).sort() };
}
export async function clearEmulators() {
  await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}
// the Auth emulator accepts "Bearer owner" as an admin credential
export async function setClaims(uid, claims) {
  const r = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify(claims) })
  });
  return r.status;
}
// The Auth emulator's stand-in for Google's sign-in window: pick an account by email, or add it.
export async function googlePopup(p, clickSelector, email) {
  const [pop] = await Promise.all([p.waitForEvent('popup'), p.click(clickSelector)]);
  await pop.waitForLoadState();
  await pop.waitForSelector('#accounts-list, #add-user');
  const existing = pop.locator('li.js-reuse-account', { hasText: email });
  if (await existing.count()) await existing.first().click();
  else {
    await pop.click('#add-account-button button');
    await pop.fill('#email-input', email);
    await pop.fill('#display-name-input', email.split('@')[0]);
    await pop.click('#sign-in');
  }
  await pop.waitForEvent('close', { timeout: 10000 }).catch(() => {});
}
export const openAccount = async p => { await p.click('.ed-acct-b'); await p.waitForSelector('dialog.ed-dlg[open]'); };
