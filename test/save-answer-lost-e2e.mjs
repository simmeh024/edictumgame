// A nation founded before the page's first read, settled while its first save is on the way, whose save lands but
// whose answer is lost (emulators). On CI (flag-designs2, PR #466 on 19 Nov and PR #498 on 21 Nov 2026) such a nation went
// back to unsettled inside the running page: no capital, no city, the founding edict back on the desk, and the page then
// said Synced. Firestore ran the save's transaction again, which found the record one revision on and refused the save
// as another device's; the page took that record (its own first save, from before the settling) and, since the founding
// counted as carried, replayed nothing onto it. Now the save knows its own permit on the record (src/shim.js, saveNation)
// and a conflict with this page's own save replays what came after it (game/edictum.html, rebaseActs).
//   python3 build.py
//   npx firebase emulators:exec --project demo-edictum --only auth,firestore,functions,hosting "node test/save-answer-lost-e2e.mjs"
import { check, finish, until, player, open, found, sleep } from './lib.mjs';
const A = await player('save answer lost');

/* the page's first read waits a moment (connect asks for a fresh token first, user.isOwner): founding comes before it,
   as it did on CI, where the functions start cold */
let tokens = 0;
await A.route(/:9099\/securetoken\.googleapis\.com\//, async route => { if (!tokens++) await sleep(3000); return route.continue(); });

/* what the nation's first save carries: the nation before it settled (its record goes to the referee for a permit first) */
let firstSave = null;
await A.route(/:5001\/.*\/civic$/, route => { try { const d = JSON.parse(route.request().postData() || '{}').data || {};
  if (d.op === 'authorizeSave' && !firstSave) firstSave = { unsettled: /"loc":null/.test(String(d.record && d.record.j)), rev: d.rev }; } catch (e) {} return route.continue(); });
/* the nation's first save: held until the nation is settled, then sent on to the emulator, which commits it; its answer
   never comes back (a connection that dropped) */
let lost = 0, heldFor = 0;
await A.route(/:8080\/.*documents:commit/, async route => {
  const body = route.request().postData() || '';
  if (lost || !/\/documents\/nations\//.test(body) || !/"update"/.test(body)) return route.continue();
  lost++; const t0 = Date.now();
  await until(() => A.evaluate(() => !!(window.G && G.S.nation && G.S.nation.loc != null)), 40000, 100);
  heldFor = Date.now() - t0;
  const r = await route.fetch();
  if (r.status() !== 200) { lost = -r.status(); return route.fulfill({ response: r }); }
  return route.abort('connectionreset');
});
/* the mode the page was in when the nation was founded, and any time it went back to unsettled */
await A.addInitScript(() => {
  window.__lostLoc = [];
  const hook = () => { if (!window.G || !window.G.S) return setTimeout(hook, 5); const S = window.G.S; let cur = S.nation;
    Object.defineProperty(S, 'nation', { configurable: true, enumerable: true, get() { return cur; }, set(v) { const was = cur; cur = v;
      if (!was && v && window.__foundMode === undefined) window.__foundMode = S.mode;
      if (was && v && was.loc != null && v.loc == null) window.__lostLoc.push({ rev: v._rev, dirty: !!v._dirty, stack: new Error().stack.split('\n').slice(2, 8).join(' | ') }); } }); };
  hook();
});

await open(A); await found(A, 'Peakland');
check('the nation was founded before the page\'s first read of its record', await A.evaluate(() => window.__foundMode !== 'world'), String(await A.evaluate(() => window.__foundMode)));
check('its first save went out with the nation from before it settled', await until(() => firstSave, 40000) && firstSave.unsettled && firstSave.rev === 0, JSON.stringify(firstSave));
check('and was committed once it had settled, its answer lost', await until(() => lost === 1, 40000) && lost === 1, JSON.stringify({ lost, heldFor }));
check('and the page saves again and says Synced', await until(() => A.evaluate(() => window.__edictum.syncStatus === 'synced' && G.S.nation && !G.S.nation._dirty), 40000));
await sleep(800);

const st = await A.evaluate(async () => {
  const n = G.S.nation, db = await window.claude.use('db'), s = await db.doc('nations/' + G.S.uid).get(), d = s.exists ? s.data() : null;
  return { loc: n.loc, cities: n.cities.length, inbox: n.inbox.map(x => x.id), rev: n._rev, lostLoc: window.__lostLoc,
    server: d && { loc: d.loc, cities: (d.cities || []).length, inbox: (d.inbox || []).map(x => x.id), rev: d._rev },
    health: window.__edictum.saveHealth, kept: !!localStorage.getItem('edictum.unsaved.' + G.S.uid) };
});
check('the nation is still settled in the page: its capital, its city, the founding edict answered', st.loc != null && st.cities >= 1 && !st.inbox.includes('fd-settle') && !st.lostLoc.length, JSON.stringify(st));
check('and so is its record on the server', !!st.server && st.server.loc != null && st.server.cities >= 1 && !st.server.inbox.includes('fd-settle') && st.server.rev === st.rev, JSON.stringify(st.server));
check('the save that lost its answer counted as landed: no conflict, no copy set aside for the account menu', st.health && st.health.conflicts === 0 && !st.kept, JSON.stringify({ health: st.health, kept: st.kept }));
await finish();
