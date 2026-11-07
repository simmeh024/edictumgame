// The Region page in five tabs (emulators): it opens on the Overview with its cards (the newcomers with a welcome
// letter each, the Great Statue, the census leaders, the region's wars); tabs that live in the address and answer the
// arrow keys; the Nations tab's search, filters, paging and quick look; a welcome letter begun from the Overview;
// the message board's replies and reactions, kept by the server, and the bell's notice of a reply; the Alliances
// tab's joining column, and joining an open alliance from it.
import { check, finish, sleep, until, player, open, ready, found, nav, text, errors, clearEmulators, register, restGet, restList, regionTab, FS_HOST, PROJECT, OUT, nationDoc } from './lib.mjs';
const shot = (p, name) => p.screenshot({ path: OUT + '/region-' + name + '.png', fullPage: true }).catch(() => {});
await clearEmulators();
const shown = (p, sel) => p.locator(sel).first().isVisible().catch(() => false);
const tab = p => p.evaluate(() => document.getElementById('rgn')?.dataset.tab || '');
const rows = p => p.$$eval('.rgn-tbl tbody tr.rgn-row', r => r.map(x => x.dataset.id)).catch(() => []);
const owner = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const docUrl = path => `http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;
/* a nation of 12 million, so it may found an alliance (as in diplomacy-e2e) */
async function grow(p, uid) {
  for (let i = 0; i < 5; i++) {
    await fetch(docUrl('nations/' + uid) + '?updateMask.fieldPaths=pop', { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: { pop: { doubleValue: 12 } } }) });
    await p.evaluate(() => { const n = G.clone(G.S.nation); n.pop = 12; n.popAt = Date.now(); G.commit(n); });
    if (await until(async () => { const d = await nationDoc(uid); return d && d.rec && d.rec.pop >= 11.9; }, 8000)) return true;
  }
  return false;
}

const A = await player('rgn-a', { vp: { width: 1366, height: 900 } }), B = await player('rgn-b', { vp: { width: 1366, height: 900 } });
const ua = await open(A); await found(A, 'Aldmere');
const ub = await open(B); await found(B, 'Brackwater');
await register(A, { old: true }); await register(B, { old: true });

/* ── 1. the tabs, and the Overview ── */
await nav(A, 'region'); await A.waitForSelector('#rgn');
check('the Region page has five tabs', JSON.stringify(await A.$$eval('.rgn-tab', b => b.map(x => x.childNodes[0].textContent.trim()))) === JSON.stringify(['Overview', 'Nations', 'Happenings', 'Board', 'Alliances']));
check('it opens on the Overview, one pane at a time', await tab(A) === 'overview' && await shown(A, '#rgn-p-overview .rgn-cards') && !await shown(A, '#rgn-p-nations .rgn-tbl'));
check('the Overview lists the newest nations, with a welcome for each', await until(async () => /Brackwater/.test(await text(A, '.rgn-new')) && !!await A.$(`.rgn-new [data-act="rgn-welcome"][data-id="${ub}"]`), 15000));
check('but not the reader’s own nation', !/Aldmere/.test(await text(A, '.rgn-new')));
check('the Great Statue card shows its phase and how far it has risen', /Phase 1 of \d+/.test(await text(A, '#rgn-p-overview')) && !!await A.$('#rgn-p-overview .rgn-bar[role="progressbar"]'));
check('the census leaders are named', /Most people/.test(await text(A, '#rgn-p-overview')) && /Every ranking in the Census/.test(await text(A, '#rgn-p-overview')));
check('and the war office finds the region at peace', /is at peace/.test(await text(A, '#rgn-p-overview')));
await shot(A, 'overview');
await A.click('#rgn-tab-nations');
check('a tab shows its pane, and the address says which', await tab(A) === 'nations' && await A.evaluate(() => location.hash) === '#region/nations' && await shown(A, '.rgn-tbl'));
await A.focus('#rgn-tab-nations'); await A.keyboard.press('ArrowRight');
check('the arrow keys move along the tabs', await tab(A) === 'happenings' && await A.evaluate(() => document.activeElement?.id) === 'rgn-tab-happenings');
await A.keyboard.press('End'); const atEnd = await tab(A); await A.keyboard.press('Home');
check('End and Home go to the last and the first', atEnd === 'alliances' && await tab(A) === 'overview' && await A.evaluate(() => location.hash) === '#region');
await A.evaluate(() => { location.hash = '#region/board'; }); await A.reload(); await ready(A);
check('a reload at #region/board opens the Board', await until(async () => await tab(A) === 'board' && await shown(A, '#rmb-form')));

/* ── 2. the Nations tab: search, filters, paging, quick look ── */
await A.click('#rgn-tab-nations');
const all0 = (await rows(A)).length;
check('the table lists the region’s nations', all0 >= 8 && (await rows(A)).includes(ua) && (await rows(A)).includes(ub), all0);
check('each filter says how many it holds, and one with none is left out', /Players 2/.test(await text(A, '.rgn-chips')) && /New this week 2/.test(await text(A, '.rgn-chips')) && !/At war with you/.test(await text(A, '.rgn-chips')));
await A.fill('#rgn-q', 'brack');
check('the search finds a nation as it is typed, and keeps the focus', await until(async () => JSON.stringify(await rows(A)) === JSON.stringify([ub])) && await A.evaluate(() => document.activeElement?.id) === 'rgn-q');
check('and says how many match', /^1 of \d+ nations/.test(await text(A, '#rgn-count')));
await A.fill('#rgn-q', 'zzqx');
check('no match says so, with a way back', await until(async () => /No nation matches “zzqx”/.test(await text(A, '#rgn-list'))));
/* with nothing else drawn in between, the page is back as it was first drawn: it must be drawn again all the same */
await A.click('[data-act="rgn-clear"]');
check('which shows every nation again', (await rows(A)).length === all0 && (await A.inputValue('#rgn-q')) === '');
await A.fill('#rgn-q', 'brack'); await until(async () => (await rows(A)).length === 1);
await A.click(`#rgn-pkb-${ub}`); await A.click(`#rgn-pkb-${ub}`); await A.fill('#rgn-q', '');
check('a search typed and wiped again, quick look opened and shut, leaves the full table', await until(async () => (await rows(A)).length === all0) && !await A.$('.rgn-pk-row'));
await A.click('[data-act="rgn-filter"][data-v="players"]');
check('Players keeps the two players', await until(async () => { const r = await rows(A); return r.length === 2 && r.includes(ua) && r.includes(ub); }) && (await A.getAttribute('[data-act="rgn-filter"][data-v="players"]', 'aria-pressed')) === 'true');
await A.click('[data-act="rgn-filter"][data-v="computer"]');
check('Computer the rest', await until(async () => { const r = await rows(A); return r.length === all0 - 2 && r.every(id => id.startsWith('npc-')); }));
await A.fill('#rgn-q', 'aldmere');
check('a search inside a filter can come up empty', await until(async () => /No nation matches “aldmere” in this list/.test(await text(A, '#rgn-list'))));
await A.click('[data-act="rgn-clear"]');
await A.evaluate(() => { G.RGNX().RGN.n = 3; G.render(); });
check('a long list shows a page at a time', (await rows(A)).length === 3 && /showing the first 3/.test(await text(A, '#rgn-count')) && !!await A.$('[data-act="rgn-more"]'));
await A.click('[data-act="rgn-more"]');
check('and Show more brings the rest', (await rows(A)).length === all0 && !await A.$('[data-act="rgn-more"]'));
await A.evaluate(() => { G.RGNX().RGN.n = G.RGNX().RGN_PAGE; G.render(); });
await A.click(`#rgn-pkb-${ub}`);
check('the arrow beside a flag opens a quick look under its row', await until(() => shown(A, `#rgn-pk-${ub} .rgn-pk`)) && /Brackwater/.test(await text(A, `#rgn-pk-${ub}`)) && (await A.getAttribute(`#rgn-pkb-${ub}`, 'aria-expanded')) === 'true');
check('it says what the nation is and how it stands with you', /Population/.test(await text(A, `#rgn-pk-${ub}`)) && /With you/.test(await text(A, `#rgn-pk-${ub}`)) && /Assembly/.test(await text(A, `#rgn-pk-${ub}`)));
const acts = await A.$$eval(`#rgn-pk-${ub} .rgn-pk-a [data-act]`, b => b.map(x => x.dataset.act));
check('and offers a visit, the map, a letter and a trade', ['visit', 'map-open', 'dm-open', 'trade-go'].every(a => acts.includes(a)), acts.join(','));
await shot(A, 'quick-look');
await A.click(`#rgn-pkb-${ub}`);
check('the arrow closes it again, keeping the focus', !await A.$(`#rgn-pk-${ub}`) && (await A.getAttribute(`#rgn-pkb-${ub}`, 'aria-expanded')) === 'false' && await A.evaluate(id => document.activeElement?.id === 'rgn-pkb-' + id, ub));
await A.click(`tr.rgn-row[data-id="${ub}"] td.c-pop >> nth=0`);
check('a click on the row itself opens it too', await until(() => shown(A, `#rgn-pk-${ub}`)));
await A.click(`#rgn-pk-${ub} [data-act="visit"]`);
check('and Visit opens the nation’s page', await until(() => A.evaluate(id => G.S.view === 'visit' && G.S.visit === id, ub)));

/* ── 3. a welcome letter, begun from the Overview ── */
await regionTab(A, 'overview');
await A.click(`[data-act="rgn-welcome"][data-id="${ub}"]`);
check('Send a welcome opens a letter to the newcomer, already begun', await until(() => A.evaluate(id => G.S.view === 'messages' && G.S.msgPeer === id, ub)) && /^Welcome to the Meridian Reach, Brackwater!/.test(await A.inputValue('#dm-text')));
await A.click('#dm-form button[type="submit"]');
await sleep(500);
await regionTab(A, 'overview');
check('once it has gone, the card says so', await until(async () => /Letter sent/.test(await text(A, '.rgn-new')), 15000));

/* ── 4. the board: a reply, the bell's notice of it, and reactions ── */
await regionTab(A, 'board');
await A.fill('#rmb-text', 'Who wants to trade timber?'); await A.click('#rmb-form button[type="submit"]');
const pidA = await until(async () => { const l = await restList('boards/meridian/posts'); const d = l.find(x => /trade timber/.test(x.fields.x.stringValue)); return d ? d.id : null; }, 15000);
check('A posts a message', !!pidA);
await regionTab(B, 'board');
await until(() => B.$(`[data-act="rmb-reply"][data-p="${pidA}"]`), 15000);
await B.click(`[data-act="rmb-reply"][data-p="${pidA}"]`);
check('Reply opens a box under the message, ready to type', await shown(B, '#rmb-re-form') && await B.evaluate(() => document.activeElement?.id) === 'rmb-re-text' && /Reply to Aldmere/.test(await text(B, '#rmb-re-form')));
await B.fill('#rmb-re-text', 'We do. Iron for timber?'); await B.click('#rmb-re-form button[type="submit"]');
check('the reply is kept on the server as an answer to the message', await until(async () => (await restList('boards/meridian/posts')).some(d => d.fields.re?.stringValue === pidA && /Iron for timber/.test(d.fields.x.stringValue)), 15000));
check('and shows under it, for both players', await until(async () => /Iron for timber/.test(await text(A, `#rmb-${pidA} .rmb-replies`)) && /Iron for timber/.test(await text(B, `#rmb-${pidA} .rmb-replies`)), 15000));
check('the box closes once it is posted', !await B.$('#rmb-re-form'));
check('a reply has no Reply button of its own', !await B.$(`#rmb-${pidA} .rmb-replies [data-act="rmb-reply"]`));
await shot(B, 'board');
await nav(A, 'nation');
await A.click('.bell');
check('A’s bell says Brackwater replied', await until(async () => /Brackwater replied to your message on the board/.test(await text(A, '.notif-pop')), 10000));
await A.click('.notif-pop .nt:has-text("replied to your message")');
check('and opens the Board', await until(async () => await A.evaluate(() => G.S.view) === 'region' && await tab(A) === 'board'));
await B.click(`[data-act="rmb-pick"][data-p="${pidA}"]`);
check('Add a reaction offers the four', (await B.$$(`#rmb-${pidA} > .post-f [data-act="rmb-rx"]`)).length === 4);
await B.click(`#rmb-${pidA} > .post-f [data-act="rmb-rx"][data-v="heart"]`);
const rvOf = async (pid, uid) => (await restGet('boards/meridian/posts/' + pid)).body?.fields?.rv?.mapValue?.fields?.[uid]?.stringValue || '';
check('a reaction is kept on the server', await until(async () => await rvOf(pidA, ub) === 'heart', 15000));
check('the other player sees it, counted, with who reacted', await until(async () => /1/.test(await text(A, `#rmb-${pidA} > .post-f [data-act="rmb-rx"][data-v="heart"]`)) && /Brackwater/.test(await A.getAttribute(`#rmb-${pidA} > .post-f [data-act="rmb-rx"][data-v="heart"]`, 'title') || '')));
await B.click(`#rmb-${pidA} > .post-f [data-act="rmb-rx"][data-v="heart"]`);
check('a second click takes it back', await until(async () => await rvOf(pidA, ub) === '', 15000) && await until(async () => !await A.$(`#rmb-${pidA} > .post-f [data-act="rmb-rx"][data-v="heart"]`)));

/* ── 5. the Alliances tab: who takes members, and joining an open alliance from it ── */
await regionTab(B, 'alliances');
check('with no alliance yet, the tab says so', /No player has founded an alliance/.test(await text(B, '#rgn-p-alliances')));
check('A grows to 12 million', await grow(A, ua));
await nav(A, 'diplomacy'); await A.click('#dp-tab-alliance');
await A.fill('#al-f-name', 'The Open Hand');
await A.click('[data-act="dp-acc"][data-pre="f"][data-v="open"]');
await A.click('#al-form button[type="submit"]');
check('A founds an open alliance', await until(() => shown(A, '.al-head .al-name'), 15000));
await regionTab(B, 'alliances');
check('the ranking says it is open, with places left', await until(async () => /The Open Hand/.test(await text(B, '.al-rank tbody')) && /Open/.test(await text(B, '.al-rank .al-acc')) && /1 of 6/.test(await text(B, '.al-rank tbody')), 15000));
check('and a nation in no alliance has a Join button', !!await B.$('.al-rank [data-act="dp-join"]'));
await B.click('.al-rank [data-act="dp-join"]');
check('Join takes it in at once, and its row says so', await until(async () => /Yours/.test(await text(B, '.al-rank tbody')) && /2 of 6/.test(await text(B, '.al-rank tbody')), 15000));
check('with no Join button left', !await B.$('.al-rank [data-act="dp-join"]'));
await shot(B, 'alliances');
await regionTab(B, 'nations');
await until(() => B.$('[data-act="rgn-filter"][data-v="ally"]'), 8000);
await B.click('[data-act="rgn-filter"][data-v="ally"]');
check('the Nations tab’s My alliance filter lists both members', await until(async () => { const r = await rows(B); return r.length === 2 && r.includes(ua) && r.includes(ub); }));

/* ── 6. a phone: the tabs scroll on their own and the page never scrolls sideways ── */
await B.setViewportSize({ width: 390, height: 844 });
await B.click('[data-act="rgn-filter"][data-v="all"]'); await B.click(`#rgn-pkb-${ua}`);
const wide = () => B.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('on a phone the Nations tab, quick look open, fits the screen', await until(() => shown(B, `#rgn-pk-${ua}`)) && await wide() <= 1, await wide());
await shot(B, 'phone-nations');
for (const t of ['overview', 'board', 'alliances']) { await B.click('#rgn-tab-' + t); await sleep(150); }
check('and so do the Overview, the Board and the Alliances', await wide() <= 1, await wide());
await B.click('#rgn-tab-overview'); await shot(B, 'phone-overview');

check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
await finish();
