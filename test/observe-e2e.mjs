// Observer mode: an admin opens another region read-only (game/edictum.html, OBS), walks its map, Region page,
// Census and nations, and comes back with their own nation untouched, in this browser and on the server.
// A player who is not an admin is sent straight back to their own nation.
import { OUT, FS_HOST, PROJECT, player, open, ready, found, localNation, nationDoc, until, check, finish, setClaims, text, restGet, clearEmulators, nav, sleep, regionTab } from './lib.mjs';
await clearEmulators();
const A = await player('admin'), B = await player('frost player');
const uidA = await open(A); await found(A, 'Adminland');
const uidB = await open(B);
await B.evaluate(() => localStorage.setItem('statehood.region', 'frostmarch'));
await B.reload(); await ready(B); await found(B, 'Frostia');
const saved = p => until(async () => { const n = await localNation(p); return n?._rev > 0 && !n._dirty; }, 20000);
check('the player founds in the Frostmarch', await until(async () => (await nationDoc(uidB))?.reg === 'frostmarch', 15000) && await saved(B));
await setClaims(uidA, { admin: true }); await A.reload(); await ready(A);
await A.waitForSelector('.side-who .adm-pill');
check('the admin’s own nation is saved in the Meridian Reach', await saved(A) && (await nationDoc(uidA))?.reg === 'meridian');

// What must not change: this browser's copy, byte for byte, and both halves of the server's record (read past the
// rules: the private half is the owner's alone).
const raw = p => p.evaluate(() => localStorage.getItem('statehood.nation.v1'));
const doc = path => fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } }).then(r => r.json());
const stamp = async uid => { const [s, x] = await Promise.all([doc('nations/' + uid), doc('nationx/' + uid)]); return JSON.stringify([s.updateTime, s.fields?.rev, x.updateTime]); };
/* which fields of two stored copies differ, to say what changed when a check fails */
const changed = (a, b) => { try { const x = JSON.parse(a || '{}'), y = JSON.parse(b || '{}'); return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(k => JSON.stringify(x[k]) !== JSON.stringify(y[k])).join(',') || 'none'; } catch (e) { return 'unreadable'; } };

// In from Region control
await A.click('.side-who .adm-pill'); await A.click('.adm-nav [data-v="admin-regions"]');
check('Region control offers to observe another region, not the admin’s own', await until(async () => !!await A.$('[data-act="obs-go"][data-id="frostmarch"]')) && !await A.$('[data-act="obs-go"][data-id="meridian"]'));
const beforeRev = (await localNation(A))._rev, beforeServer = await stamp(uidA);
check('both halves of the record are on the server', !/undefined|null/.test(beforeServer), beforeServer);
await Promise.all([A.waitForEvent('load'), A.click('[data-act="obs-go"][data-id="frostmarch"]')]); await ready(A);
/* The page that was left may still have kept a change of its own as it closed (a commit not yet sent; obsEnter only
   sends a pending save). From here on, observing, nothing may write this browser's copy, which is still the admin's own
   nation at the same revision, not the stand-in. */
const before = await raw(A), kept = JSON.parse(before || 'null');
check('this browser still keeps the admin’s own nation, at the same revision', kept?.name === 'Adminland' && kept?._rev === beforeRev, JSON.stringify([kept?.name, kept?._rev, beforeRev]));
const bar = () => text(A, '.obs-bar');
check('a bar says which region is observed, read-only, with the way back', await until(async () => /Observing Frostmarch — read-only/.test(await bar()) && /Return to my nation/.test(await bar()), 15000), await bar());
check('the page is the Frostmarch’s, opened on its map', await until(async () => await A.evaluate(() => G.S.view === 'map' && G.MAP && document.querySelector('.brand-sub')?.textContent.includes('Frostmarch'))));
const standIn = () => A.evaluate(() => JSON.stringify([G.S.nation.name, G.S.nation.loc ?? null, G.S.mode, G.S.obsOn, document.querySelector('.side-nm')?.textContent]));
check('the admin’s own nation is nowhere in the page: a stand-in without land takes its place', await until(async () => await standIn() === JSON.stringify(['Observer', null, 'readonly', true, 'Frostmarch'])), await standIn());
check('the map shows the region’s player nations', await until(async () => await A.evaluate(() => G.territory().list.some(x => x.n.name === 'Frostia')), 15000));
check('its panel selects nations rather than offering a place to settle', /Select a nation on the map/.test(await text(A, '#map-panel')) && !await A.$('[data-act="map-suggest"]'));
const navs = await A.$$eval('.nav [data-v]', els => [...new Set(els.map(e => e.dataset.v))].sort().join(','));
check('the menu holds only the pages there are to observe', navs === 'assembly,census,community,dispatch,games,map,region,wonder,world', navs);
await A.screenshot({ path: OUT + '/observe-map.png', fullPage: true });

// The region's Assembly, Great Statue, Games and alliances, with their members' channel, as a player there sees them.
{ const uidF = uidB, now = Date.now(), put = (path, fields) => fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ fields }) });
  await put('alliances/al-frost', { reg: { stringValue: 'frostmarch' }, name: { stringValue: 'Frost Pact' }, mem: { mapValue: { fields: { [uidF]: { mapValue: { fields: { t: { integerValue: String(now) }, r: { stringValue: 'o' } } } } } } } });
  await put('alliances/al-frost/chat/m1', { a: { stringValue: uidF }, nm: { stringValue: 'Frostia' }, x: { stringValue: 'Shall we raid the Meridian herring fleet?' }, t: { integerValue: String(now) } });
  await nav(A, 'assembly');
  check('the Assembly opens with the region’s seats, read-only', await until(async () => /The Frostmarch Assembly/.test(await text(A, '.main')) && /one run by a player/.test(await text(A, '.main')) && /You are observing/.test(await text(A, '.main')), 20000), (await text(A, '.main')).slice(0, 300));
  await nav(A, 'wonder');
  check('the Great Statue shows its phase without a form to give', await until(async () => /The Great Statue of the Frostmarch/.test(await text(A, '.main'))) && !/Give to this phase/.test(await text(A, '.main')));
  await nav(A, 'games');
  check('the Games show the region’s events without a team to send', await until(async () => /The Frostmarch Games/.test(await text(A, '.main'))) && !await A.$('[data-act="g-enter"]') && !await A.$('[data-act="g-focus"]') && !await A.$('#g-cabinet'));
  await nav(A, 'region'); await regionTab(A, 'alliances');
  check('the Region page lists the region’s alliances', await until(async () => !!await A.$('[data-act="al-page"]'), 20000));
  await A.click('[data-act="al-page"]');
  check('an alliance’s page opens with its members’ channel, read-only', await until(async () => /Frost Pact/.test(await text(A, '.main')) && /Shall we raid the Meridian herring fleet\?/.test(await text(A, '.obs-chan')), 20000) && !await A.$('#al-chat-form'));
  await A.screenshot({ path: OUT + '/observe-alliance.png', fullPage: true }); }
await nav(A, 'region'); await regionTab(A);
check('the Region page lists the region’s nations, with no “You”', await until(async () => /Frostia/.test(await text(A, '.tbl')) && !/Adminland/.test(await text(A, '.tbl')) && !await A.$('.tbl .chip.you')));
check('and its board, with a form that posts only as the Edictum team', /Message board/.test(await text(A, '#rgn-p-board')) && !!await A.$('#rmb-form #rmb-as-team:checked') && !await A.$('#rmb-as-nat'));
await A.click(`.tbl [data-act="visit"][data-id="${uidB}"]`);
check('a nation’s page opens', await until(async () => await A.evaluate(() => G.S.view === 'visit') && /Frostia/.test(await text(A, '.main'))));
const acts = await A.$$eval('.visit-acts [data-act]', els => els.map(e => e.dataset.act).join(','));
check('with nothing to do to it but look: no trade, spy, message or war', acts === 'map-open,st-open,admin-inspect', acts);
await A.screenshot({ path: OUT + '/observe-nation.png', fullPage: true });
await nav(A, 'census');
check('the Census ranks the region’s nations, leaders first, with nobody as “me”', await until(async () => /How the \d+ nations of Frostmarch measure up/.test(await text(A, '.vh')) && /Led by/.test(await text(A, '.census')) && /Frostia/.test(await text(A, '#board')) && !await A.$('.br.me')));
await A.evaluate(() => G.S.view = 'issues'); await A.evaluate(() => G.render());
check('a page of one’s own nation is not drawn while observing', await A.evaluate(() => G.S.view) === 'map');
await A.click('.side-who .adm-pill');
check('the bar stays on the admin portal', await until(async () => !!await A.$('.adm') && /Observing Frostmarch/.test(await bar())));

// Nothing can be saved: the adapter refuses whatever the page might still send.
const tries = await A.evaluate(async uid => {
  const db = await window.claude.use('db'), civic = await window.claude.use('civic'), code = p => p.then(() => 'sent', e => e.code);
  return [await code(db.doc('nations/' + uid).set({ name: 'Overwritten', reg: 'frostmarch' })), await code(db.post('frostmarch', 'Hello from an observer')),
    await code(civic.request({ op: 'state' })), await code(db.doc('chron/' + uid + '/m/2026-11').merge({ d: {} }))].join(',');
}, uidA);
check('the save adapter refuses a nation save, a board post, the Assembly and other writes', tries === 'read_only,read_only,read_only,read_only', tries);
await sleep(11000); // a clock tick or two
{ const now = await raw(A); check('this browser’s copy of the admin’s nation is untouched while observing', now === before, changed(before, now)); }
check('and so is the server’s record', await stamp(uidA) === beforeServer, await stamp(uidA));
check('nothing was posted on the region’s board', (await restGet('boards/frostmarch/posts')).body?.documents == null);

// ...but the admin may address the region as the Edictum team, and remove what is posted there
await A.evaluate(() => { G.S.view = 'region'; G.render(); });
await regionTab(A, 'board');
await A.fill('#rmb-text', 'Welcome to the Frostmarch, from the team.'); await A.click('#rmb-form button[type="submit"]');
check('an observing admin posts on the region’s board as the Edictum team', await until(async () => /Welcome to the Frostmarch/.test(await text(A, '.posts')) && /Edictum team/.test(await text(A, '.posts .post-h'))));
const team = ((await restGet('boards/frostmarch/posts')).body?.documents || []).map(d => d.fields);
check('the server keeps it as the team’s, signed, staff-marked and by the admin', team.length === 1 && team[0].of?.booleanValue === true && team[0].nm?.stringValue === 'Edictum team' && team[0].st?.stringValue === 'admin' && team[0].a?.stringValue === uidA, JSON.stringify(team));
await nav(B, 'region');
check('the region’s players see it with the team’s initial and staff badge, and nothing to report', await until(async () => /Welcome to the Frostmarch/.test(await text(B, '.posts'))) && !!await B.$('.post.rmb-team .rmb-av') && !!await B.$('.post.rmb-team .staff-pill') && !await B.$('.post.rmb-team [data-act="report-post"]'));
check('the admin’s nation, which is elsewhere, is not named on it', !/Adminland/.test(await text(B, '.posts')));
await A.click('.post.rmb-team [data-act="del-post"]'); await A.click('[data-act="del-post-yes"]');
check('the observing admin removes a message from the board', await until(async () => (await restGet('boards/frostmarch/posts')).body?.documents == null && !/Welcome to the Frostmarch/.test(await text(B, '#rgn-p-board'))));
{ const now = await raw(A), st = await stamp(uidA); check('and the admin’s nation is still untouched', now === before && st === beforeServer, changed(before, now) + ' ' + st); }
await A.screenshot({ path: OUT + '/observe-portal.png', fullPage: true });

// Back home
await Promise.all([A.waitForEvent('load'), A.click('.obs-bar [data-act="obs-exit"]')]); await ready(A);
check('Return to my nation brings the admin’s nation back as it was saved', await until(async () => await text(A, '.side-nm') === 'Adminland' && !await A.$('.obs-bar') && await A.evaluate(() => G.S.view === 'nation' && G.S.mode === 'world')));
check('at the same revision, in its own region', await A.evaluate(r => G.S.nation._rev === r && G.S.nation.reg === 'meridian' && !G.S.nation._dirty, beforeRev) && await A.evaluate(() => !sessionStorage.getItem('edictum.observe')));
check('with the server’s record untouched by the visit', await stamp(uidA) === beforeServer);

// Straight to a nation of another region, from Player search
await A.click('.side-who .adm-pill'); await A.click('.adm-nav [data-v="admin-players"]');
await A.fill('#admin-q', 'Frostia'); await A.click('#admin-search button:not([type])');
await until(async () => !!await A.$(`[data-act="admin-inspect"][data-id="${uidB}"]`), 15000);
await A.click(`[data-act="admin-inspect"][data-id="${uidB}"]`);
await until(async () => !!await A.$(`.adm-detail [data-act="obs-go"][data-visit="${uidB}"]`), 15000);
await Promise.all([A.waitForEvent('load'), A.click(`.adm-detail [data-act="obs-go"][data-visit="${uidB}"]`)]); await ready(A);
check('a player of another region opens on their nation’s page, observing that region', await until(async () => /Observing Frostmarch/.test(await bar()) && await A.evaluate(id => G.S.view === 'visit' && G.S.visit === id, uidB) && /Frostia/.test(await text(A, '.main')), 15000));
await nav(A, 'world');
check('the World page offers the way home instead of a move', await until(async () => /You are observing the Frostmarch/.test(await text(A, '.vh'))) && !await A.$('.wr-status'));
await Promise.all([A.waitForEvent('load'), A.click('.obs-bar [data-act="obs-exit"]')]); await ready(A);
check('and back again', await until(async () => await text(A, '.side-nm') === 'Adminland' && !await A.$('.obs-bar')));

// The admin's own region is theirs to play, not to observe
await A.evaluate(() => sessionStorage.setItem('edictum.observe', 'meridian')); await A.reload(); await ready(A);
check('observing the admin’s own region is simply playing it', await until(async () => await text(A, '.side-nm') === 'Adminland') && !await A.$('.obs-bar') && await A.evaluate(() => !sessionStorage.getItem('edictum.observe')));

// A player who is not an admin
const beforeB = await localNation(B), serverB = await stamp(uidB);
await B.evaluate(() => sessionStorage.setItem('edictum.observe', 'meridian'));
await B.reload();
check('a player who is not an admin is sent back to their own nation', await until(async () => await text(B, '.side-nm') === 'Frostia' && !await B.$('.obs-bar') && await B.evaluate(() => !sessionStorage.getItem('edictum.observe') && G.S.mode === 'world'), 20000));
const afterB = await localNation(B);
check('with their nation as it was', afterB._rev === beforeB._rev && afterB.reg === 'frostmarch' && JSON.stringify(afterB.loc) === JSON.stringify(beforeB.loc) && JSON.stringify(afterB.claims) === JSON.stringify(beforeB.claims) && await stamp(uidB) === serverB);
await finish();
