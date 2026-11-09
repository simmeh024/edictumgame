// Player view: an admin sees one player's game as that player does (game/edictum.html, PV), their nation, menu
// layout and pages, in their region, and can do nothing in it: no save reaches the server or either browser.
import { OUT, FS_HOST, PROJECT, player, open, ready, found, localNation, nationDoc, until, check, finish, setClaims, text, clearEmulators, nav, sleep } from './lib.mjs';
await clearEmulators();
const A = await player('admin'), B = await player('frost player');
const uidA = await open(A); await found(A, 'Adminland');
const uidB = await open(B);
await B.evaluate(() => localStorage.setItem('statehood.region', 'frostmarch'));
await B.reload(); await ready(B); await found(B, 'Frostia');
const saved = p => until(async () => { const n = await localNation(p); return n?._rev > 0 && !n._dirty; }, 20000);
check('the player founds in the Frostmarch', await until(async () => (await nationDoc(uidB))?.reg === 'frostmarch', 15000) && await saved(B));
await setClaims(uidA, { admin: true }); await A.reload(); await ready(A); await A.waitForSelector('.side-who .adm-pill');
check('the admin’s nation is saved', await saved(A));
const doc = path => fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } }).then(r => r.json());
const stamp = async uid => { const [s, x, p] = await Promise.all([doc('nations/' + uid), doc('nationx/' + uid), doc('nationp/' + uid)]); return JSON.stringify([s.updateTime, x.updateTime, p.updateTime]); };
const rawA = () => A.evaluate(() => localStorage.getItem('statehood.nation.v1'));

await A.click('.side-who .adm-pill'); await A.click('.adm-nav [data-v="admin-players"]');
await A.fill('#admin-q', 'Frostia'); await A.click('#admin-search button:not([type])');
await until(async () => !!await A.$(`[data-act="admin-inspect"][data-id="${uidB}"]`), 15000);
await A.click(`[data-act="admin-inspect"][data-id="${uidB}"]`);
check('the player page offers View as player', await until(async () => !!await A.$(`.adm-detail [data-act="pv-go"][data-id="${uidB}"]`), 15000));
await Promise.all([A.waitForEvent('load'), A.click(`.adm-detail [data-act="pv-go"][data-id="${uidB}"]`)]); await ready(A);
check('a bar names the player, read-only, with the way out', await until(async () => /Viewing as Frostia/.test(await text(A, '.pv-bar')) && /Leave player view/.test(await text(A, '.pv-bar')), 20000), await text(A, '.pv-bar'));
check('the page is the player’s own nation, in their region, read-only', await until(async () => await A.evaluate(id => G.S.uid === id && G.S.nation.name === 'Frostia' && G.S.mode === 'readonly' && G.S.view === 'nation' && document.querySelector('.brand-sub')?.textContent.includes('Frostmarch'), uidB) && await text(A, '.side-nm') === 'Frostia', 20000));
const navA = await A.$$eval('.nav [data-v]', els => els.length), navB = await B.$$eval('.nav [data-v]', els => els.length);
check('with the player’s full menu, as they see it', navA === navB && navA > 9, navA + ' vs ' + navB);
await A.screenshot({ path: OUT + '/player-view.png', fullPage: true });
const beforeA = await rawA(), serverA = await stamp(uidA);
for (const v of ['issues', 'cities', 'settings', 'customise', 'map']) { await nav(A, v);
  check(`their ${v} page draws`, await until(async () => await A.evaluate(x => G.S.view === x, v) && !/could not be drawn/.test(await text(A, '.main')))); }
const tries = await A.evaluate(async uid => {
  const db = await window.claude.use('db'), civic = await window.claude.use('civic'), code = p => p.then(() => 'sent', e => e.code);
  const n = structuredClone(G.S.nation); n.name = 'Hijacked'; G.commit(n);
  return [G.S.nation.name, await code(db.doc('nations/' + uid).set({ name: 'Overwritten', reg: 'frostmarch' })), await code(db.post('frostmarch', 'hi', { as: 'team' })),
    await code(civic.request({ op: 'vote' })), await code(db.doc('staff/' + uid).set({ x: 1 }))].join(',');
}, uidB);
check('nothing can be done: commit is ignored and the adapter refuses every write', tries === 'Frostia,read_only,read_only,read_only,read_only', tries);
await sleep(11000);
check('the admin’s own record is untouched, on the server and in this browser', await stamp(uidA) === serverA && await rawA() === beforeA, [await stamp(uidA), serverA].join(' '));
check('the player’s record still carries their own name', (await nationDoc(uidB))?.name === 'Frostia');
await Promise.all([A.waitForEvent('load'), A.click('.pv-bar [data-act="pv-exit"]')]); await ready(A);
check('Leave player view goes back to the admin portal with the admin’s own nation', await until(async () => !await A.$('.pv-bar') && await A.evaluate(() => G.S.nation?.name === 'Adminland' && G.S.uid !== G.S.nation?.x && location.hash === '#admin' && G.S.mode === 'world' && !sessionStorage.getItem('edictum.pview')), 20000), await A.evaluate(() => JSON.stringify([document.querySelector('.side-nm')?.textContent, G.S.mode, sessionStorage.getItem('edictum.pview'), !!document.querySelector('.pv-bar')])));
await B.evaluate(id => sessionStorage.setItem('edictum.pview', id + '|meridian'), uidA); await B.reload();
check('a player who is not an admin is sent back to their own nation', await until(async () => await text(B, '.side-nm') === 'Frostia' && !await B.$('.pv-bar') && await B.evaluate(() => !sessionStorage.getItem('edictum.pview') && G.S.mode === 'world'), 20000));
await finish();
