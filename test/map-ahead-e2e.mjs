// A nation saved on a newer map (game/edictum.html, mapAhead and mapStaleStop; src/shim.js, newerMap and mv). The emulator's
// owner writes records as the next map's build would (cv and the capital's map one higher, every hex renumbered, mv beside
// them), as Lévice's was on 19 Nov 2026 when a tab still on the map before read it as lost land and saved that over it.
// Another nation's newer-map record is left out of an open tab's region, which plays and saves on. The player's own, with
// the tab open and the player typing: the tab saves nothing, says so, and reloads once the typing is done; with nothing
// typed it reloads at once, and a page that keeps coming back on the old build stops reloading after two tries and says so.
// The record is never touched. Run with: npm run test:map-ahead
import { PROJECT, FS_HOST, OUT, check, finish, until, sleep, player, open, found, restGet, fieldsText, clearEmulators } from './lib.mjs';

const DOCS = `http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;
const doc = async uid => {
  const r = await restGet('nations/' + uid);
  if (r.status !== 200) return null;
  const f = r.body.fields;
  return { f, rev: Number(f.rev.integerValue), mv: f.mv ? Number(f.mv.integerValue) : undefined, text: fieldsText(f), rec: JSON.parse(fieldsText(f)) };
};
/* wait until the game's own saves have stopped (same revision for 3 s): a write while it saves gets a 409 */
async function quiet(uid) {
  let last = -1, same = 0;
  await until(async () => { const s = await doc(uid); const r = s ? s.rev : -1; same = r === last ? same + 1 : 0; last = r; return same >= 6; }, 40000, 500);
}
/* the record as the next map's build saves it: every hex renumbered for its wider rows, the map named one higher */
async function writeAhead(uid) {
  for (let i = 0; i < 6; i++) {
    if (i) await sleep(700);
    const s = await doc(uid), f = s.f, rec = s.rec, mv = rec.cv + 1, wide = c => Number.isInteger(c) ? c + Math.floor(c / 100) * 7 : c;
    rec.cv = mv;
    if (rec.loc) rec.loc = { ...rec.loc, c: rec.loc.c + 3, m: mv };
    rec.cities = (rec.cities || []).map(c => ({ ...c, c: wide(c.c) }));
    rec.claims = (rec.claims || []).map(e => ({ ...e, c: wide(e.c) }));
    rec.motto = 'Saved on the next map';
    rec.updatedAt = Date.now();
    delete f.z; f.v = { integerValue: '1' }; f.j = { stringValue: JSON.stringify(rec) };
    f.rev = { integerValue: String(s.rev + 1) }; f.mv = { integerValue: String(mv) }; f.updatedAt = { integerValue: String(rec.updatedAt) };
    const w = await fetch(`${DOCS}/nations/${uid}`, { method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields: f }) });
    if (w.ok) { const d = await doc(uid); return { rev: d.rev, text: d.text, rec: d.rec, mv }; }
  }
  throw new Error('the newer save could not be written');
}
const reloaded = p => p.evaluate(() => !window.__mapMark).catch(() => false);
const mark = p => p.evaluate(() => { window.__mapMark = 1; });

await clearEmulators();
const A = await player('ahead'), B = await player('ahead-b');
const uidA = await open(A); await found(A, 'Levicia');
const uidB = await open(B); await found(B, 'Borderia');
await quiet(uidA); await quiet(uidB);
const mapVer = await A.evaluate(() => G.S.nation.cv);
const a0 = await doc(uidA);
check('a save names the map its page is on (mv)', a0 && a0.mv === mapVer && a0.rec.cv === mapVer, JSON.stringify({ mv: a0 && a0.mv, mapVer }));

/* 1. another nation's record from a newer map: left out of this tab's region; the tab plays and saves on */
check('B is in A\'s region to begin with', !!(await until(() => A.evaluate(id => !!G.S.world[id], uidB), 15000)));
await B.ctx.close();
await mark(A);
const b1 = await writeAhead(uidB);
check('A leaves the newer map\'s nation out of its region and map', !!(await until(() => A.evaluate(id => !G.S.world[id] && !!G.S.worldAll[id], uidB), 15000)));
await sleep(1500);
check('A is not reloaded by another nation\'s record (the server\'s version.json says no new build)', !(await reloaded(A)));
const revA = (await doc(uidA)).rev;
await A.evaluate(() => { const n = G.clone(G.S.nation); n.motto = 'Still playing here'; G.commit(n); G.PG.saveSoon(); });
check('and A still saves', !!(await until(async () => { const s = await doc(uidA); return s.rev > revA && s.rec.motto === 'Still playing here' && s.mv === mapVer; }, 20000)));
const b2 = await doc(uidB);
check('B\'s newer record is untouched', b2.rev === b1.rev && b2.text === b1.text);
await quiet(uidA);

/* 2. A's own record from a newer map while A is typing: read-only, says so, reloads once the typing is done. The account
   dialog holds the reload too (newerMap's busy): the guest's recovery code, which opens a few seconds after founding, is
   closed first */
await until(async () => { const r = A.locator('[data-ed="recovery-saved"]'); if (await r.isVisible()) await r.click(); return !(await A.evaluate(() => !!document.querySelector('dialog[open]'))); }, 15000, 500);
check('no dialog is open before the newer save arrives', !(await A.evaluate(() => !!document.querySelector('dialog[open]'))));
await A.evaluate(() => { const i = document.createElement('input'); i.id = 'zz-draft'; document.body.appendChild(i); i.focus(); i.value = 'Half a letter'; });
const a1 = await writeAhead(uidA);
check('A is told, and stays while the player types', !!(await until(() => A.evaluate(() => { const e = document.getElementById('ed-map-stale'); return !!e && /finished typing/.test(e.textContent) && !!window.__mapMark; }), 15000)));
await A.screenshot({ path: OUT + '/map-ahead-typing.png' });
check('the sync label says read-only', /Read-only/.test(await A.evaluate(() => (document.querySelector('.ed-sync') || {}).textContent || '')));
check('the page never took the newer record in: it keeps its own map\'s nation', await A.evaluate(([v, m]) => G.S.nation.cv === v && G.S.nation.motto !== m, [mapVer, a1.rec.motto]));
await A.evaluate(() => { const n = G.clone(G.S.nation); n.motto = 'Should never land'; G.commit(n); G.PG.saveSoon(); });
await sleep(5000);
const a2 = await doc(uidA);
check('nothing is saved over the newer record', a2.rev === a1.rev && a2.text === a1.text, JSON.stringify({ rev: a2.rev, want: a1.rev }));
const local = await A.evaluate(() => JSON.parse(localStorage.getItem('statehood.nation.v1') || 'null'));
check('nor over this browser\'s copy, which is still this map\'s', !!local && local.cv === mapVer && local.motto !== 'Should never land');
await A.evaluate(() => document.getElementById('zz-draft').remove());
const why = await A.evaluate(() => ({ active: document.activeElement && document.activeElement.tagName, dlg: !!(document.querySelector('dialog[open]')),
  typed: [...document.querySelectorAll('textarea, input')].filter(el => !/^(button|submit|reset|image|checkbox|radio|range|color|file|hidden)$/.test(el.type) && el.value !== el.defaultValue).map(el => el.id || el.name || el.className),
  drafts: window.__edictum.drafts() })).catch(e => String(e));
check('once the typing is done, the tab reloads', !!(await until(() => reloaded(A), 10000)), JSON.stringify(why));

/* 3. the reload brings the same build here (there is no newer one to load): it stops again at the first read and reloads
   at once, then, coming back on the old build a second time, stays read-only and says so */
const stuck = await until(() => A.evaluate(() => { const e = document.getElementById('ed-map-stale'); return !!e && /keeps loading the old one/.test(e.textContent); }), 40000);
check('a page that keeps coming back on the old build stops reloading and says so', !!stuck);
await A.screenshot({ path: OUT + '/map-ahead-stuck.png' });
check('and the last reload\'s "the new version has loaded" is not left beside it', !/has loaded the new version/.test(await A.evaluate(() => [...document.querySelectorAll('.ed-toast')].map(t => t.textContent).join(' ')).catch(() => 'x')));
await A.evaluate(() => { try { const n = G.clone(G.S.nation); n.motto = 'Should never land'; G.commit(n); G.PG.saveSoon(); } catch (e) {} });
await sleep(4000);
const a3 = await doc(uidA);
check('the newer record is still exactly as it was written', a3.rev === a1.rev && a3.text === a1.text && a3.mv === a1.mv && a3.rec.cv === mapVer + 1 && a3.rec.loc.m === mapVer + 1);
await finish();
