// A nation founded before the page's first read, settled while its first save is on the way, whose save lands but
// whose answer is lost (emulators). On CI (flag-designs2, PR #466 on 19 Nov and PR #498 on 21 Nov 2026) such a nation went
// back to unsettled inside the running page: no capital, no city, the founding edict back on the desk, and the page then
// said Synced. Firestore ran the save's transaction again, which found the record one revision on and refused the save
// as another device's; the page took that record (its own first save, from before the settling) and, since the founding
// counted as carried, replayed nothing onto it. Now the save knows its own permit on the record (src/shim.js, saveNation)
// and a conflict with this page's own save replays what came after it (game/edictum.html, rebaseActs).
// Both ways of saving: the server's save in one trip (functions/civic.js, serverSave), whose answer is lost on the way
// back, so the page asks again under the same name and the server follows its own save; and the game's own transaction
// (EDICTUM_SAVE_V1), whose commit's answer is lost.
//   python3 build.py
//   npx firebase emulators:exec --project demo-edictum --only auth,firestore,functions,hosting "node test/save-answer-lost-e2e.mjs"
import { check, finish, until, player, open, found, sleep } from './lib.mjs';

async function scenario(mode) {
  const server = mode === 'server', A = await player('save answer lost (' + mode + ')');
  if (!server) await A.ctx.addInitScript(() => { window.EDICTUM_SAVE_V1 = true; });
  const settled = () => A.evaluate(() => !!(window.G && G.S.nation && G.S.nation.loc != null));

  /* the page's first read waits a moment (connect asks for a fresh token first, user.isOwner): founding comes before it,
     as it did on CI, where the functions start cold */
  let tokens = 0;
  await A.route(/:9099\/securetoken\.googleapis\.com\//, async route => { if (!tokens++) await sleep(3000); return route.continue(); });

  /* what the nation's first save carries: the nation before it settled. The server's save is held until the nation is
     settled, then sent on to the emulator, which writes it; its answer never comes back (a connection that dropped) */
  let firstSave = null, lost = 0, heldFor = 0;
  const sids = [];
  await A.route(/:5001\/.*\/civic$/, async route => {
    let d = {};
    try { d = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) {}
    if (d.op === (server ? 'save' : 'authorizeSave') && !firstSave) firstSave = { unsettled: /"loc":null/.test(String(d.record && d.record.j)), rev: d.rev };
    if (!server || d.op !== 'save') return route.continue();
    sids.push({ sid: d.sid, rev: d.rev });
    if (lost) return route.continue();
    lost++; const t0 = Date.now();
    await until(settled, 40000, 100);
    heldFor = Date.now() - t0;
    const r = await route.fetch();
    if (r.status() !== 200) { lost = -r.status(); return route.fulfill({ response: r }); }
    return route.abort('connectionreset');
  });
  /* the game's own transaction: its commit held until the nation is settled, committed, its answer lost */
  if (!server) await A.route(/:8080\/.*documents:commit/, async route => {
    const body = route.request().postData() || '';
    if (lost || !/\/documents\/nations\//.test(body) || !/"update"/.test(body)) return route.continue();
    lost++; const t0 = Date.now();
    await until(settled, 40000, 100);
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

  await open(A); await found(A, server ? 'Peakland' : 'Peakmoor');
  const tag = s => s + (server ? '' : ' (the game\'s own transaction)');
  check(tag('the nation was founded before the page\'s first read of its record'), await A.evaluate(() => window.__foundMode !== 'world'), String(await A.evaluate(() => window.__foundMode)));
  check(tag('its first save went out with the nation from before it settled'), await until(() => firstSave, 40000) && firstSave.unsettled && firstSave.rev === 0, JSON.stringify(firstSave));
  check(tag('and was written once it had settled, its answer lost'), await until(() => lost === 1, 40000) && lost === 1, JSON.stringify({ lost, heldFor }));
  if (server) check('the page asked again under the same name, from the same revision', await until(() => sids.length >= 2, 20000) && sids[1].sid === sids[0].sid && sids[1].rev === sids[0].rev, JSON.stringify(sids));
  check(tag('and the page saves again and says Synced'), await until(() => A.evaluate(() => window.__edictum.syncStatus === 'synced' && G.S.nation && !G.S.nation._dirty), 40000));
  await sleep(800);

  const st = await A.evaluate(async () => {
    const n = G.S.nation, db = await window.claude.use('db'), s = await db.doc('nations/' + G.S.uid).get(), d = s.exists ? s.data() : null;
    return { loc: n.loc, cities: n.cities.length, inbox: n.inbox.map(x => x.id), rev: n._rev, lostLoc: window.__lostLoc,
      server: d && { loc: d.loc, cities: (d.cities || []).length, inbox: (d.inbox || []).map(x => x.id), rev: d._rev },
      health: window.__edictum.saveHealth, kept: !!localStorage.getItem('edictum.unsaved.' + G.S.uid) };
  });
  check(tag('the nation is still settled in the page: its capital, its city, the founding edict answered'), st.loc != null && st.cities >= 1 && !st.inbox.includes('fd-settle') && !st.lostLoc.length, JSON.stringify(st));
  check(tag('and so is its record on the server'), !!st.server && st.server.loc != null && st.server.cities >= 1 && !st.server.inbox.includes('fd-settle') && st.server.rev === st.rev, JSON.stringify(st.server));
  check(tag('the save that lost its answer counted as landed: no conflict, no copy set aside for the account menu'), st.health && st.health.conflicts === 0 && !st.kept, JSON.stringify({ health: st.health, kept: st.kept }));
  await A.ctx.close();
}

/* The lighter save (functions/civic.js, serverSave up: 1; src/shim.js, upDeflate/upHash): once a save's answer says
   the server takes it, the page sends the text deflated and an unchanged private half by its fingerprint, in a real
   browser (CompressionStream, crypto.subtle), and the server saves the same nation from it. */
async function lighter() {
  const A = await player('lighter save'), saves = [];
  const half = (d, k) => typeof d[k] === 'string' ? 'text' : typeof d[k + 'z'] === 'string' ? 'deflated' : typeof d[k + 'h'] === 'string' ? 'fingerprint' : '';
  await A.route(/\/civic$/, route => {
    let d = {};
    try { d = JSON.parse(route.request().postData() || '{}').data || {}; } catch (e) {}
    if (d.op === 'save') saves.push({ bytes: (route.request().postData() || '').length, j: typeof d.record?.j === 'string', jz: typeof d.record?.jz === 'string', x: half(d, 'x'), o: half(d, 'o') });
    return route.continue();
  });
  await open(A); await found(A, 'Lightfoot');
  const synced = () => A.evaluate(() => window.__edictum.syncStatus === 'synced' && !!G.S.nation && !G.S.nation._dirty && G.S.nation._rev > 0);
  check('a new nation saves and says Synced', await until(synced, 40000));
  const first = saves.length;
  for (const motto of ['Lightly', 'More lightly']) {
    const rev = await A.evaluate(() => G.S.nation._rev);
    await A.evaluate(m => { const n = G.clone(G.S.nation); n.motto = m; G.commit(n); }, motto);
    await until(async () => (await synced()) && (await A.evaluate(r => G.S.nation._rev > r, rev)), 30000);
  }
  const later = saves.slice(first), plainFirst = saves[0];
  check('its first save went as plain text', !!plainFirst && plainFirst.j && !plainFirst.jz && plainFirst.x === 'text', JSON.stringify(plainFirst));
  check('later saves send the text deflated', later.length >= 2 && later.every(s => s.jz && !s.j), JSON.stringify(later));
  check('and a private half unchanged since the last save by its fingerprint', later.some(s => s.x === 'fingerprint' || s.o === 'fingerprint'), JSON.stringify(later));
  const st = await A.evaluate(async () => { const db = await window.claude.use('db'), s = await db.doc('nations/' + G.S.uid).get(), d = s.exists ? s.data() : null;
    return { motto: d && d.motto, rev: d && d._rev, page: G.S.nation._rev, health: window.__edictum.saveHealth }; });
  check('the server holds the nation the lighter saves sent', st.motto === 'More lightly' && st.rev === st.page && st.health.conflicts === 0 && !st.health.error, JSON.stringify(st));
  await A.ctx.close();
}

await scenario('server');
await scenario('client');
await lighter();
await finish();
