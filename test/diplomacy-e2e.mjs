// The Diplomacy page in five tabs and alliances kept by the server (emulators): what waits for the player with its own
// buttons; an alliance founded from the page with a type, a banner and a map colour; a request with a note, approved
// by the leader; an officer; the members' channel; a pledge to the treasury credited once the nation saves, and a
// project built from it; the Relations tab with the reasons goodwill moved; a gift; the charter edited; the Diplomacy
// and Alliances map lenses; the public alliance page and the Region's ranking; a call to arms answered and shown in
// the war room; the leader leaving and the officer taking over; tabs that live in the address.
import { check, finish, sleep, until, player, open, found, nav, text, errors, clearEmulators, ready, register, nationDoc, restGet, FS_HOST, PROJECT, OUT } from './lib.mjs';
const shot = (p, name) => p.screenshot({ path: OUT + '/diplomacy-' + name + '.png', fullPage: true }).catch(() => {});
await clearEmulators();
const shown = (p, sel) => p.locator(sel).first().isVisible().catch(() => false);
const tab = p => p.evaluate(() => document.getElementById('dp')?.dataset.tab || '');
const owner = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const docUrl = path => `http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;
async function adminGet(path) { const r = await fetch(docUrl(path), { headers: owner }); return r.status === 200 ? r.json() : null; }
/* a nation of 12 million, so it may found an alliance: the record and the saved figure the server checks */
async function grow(p, uid) {
  /* a save of the smaller nation still on its way can land after the saved figure is raised, and the rules then
     refuse the jump: raise it again until the record that says 12 million is in */
  for (let i = 0; i < 5; i++) {
    await fetch(docUrl('nations/' + uid) + '?updateMask.fieldPaths=pop', { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: { pop: { doubleValue: 12 } } }) });
    await p.evaluate(() => { const n = G.clone(G.S.nation); n.pop = 12; n.popAt = Date.now(); G.commit(n); });
    if (await until(async () => { const d = await nationDoc(uid); return d && d.rec && d.rec.pop >= 11.9; }, 8000)) return true;
  }
  return false;
}
const clickAct = (p, act, extra = '') => p.click(`[data-act="${act}"]${extra}`);
const alDoc = async aid => { const d = await adminGet('alliances/' + aid); return d ? d.fields : null; };

const A = await player('dip-a', { vp: { width: 1366, height: 900 } }), B = await player('dip-b', { vp: { width: 1366, height: 900 } });
const ua = await open(A); await found(A, 'Concordia');
const ub = await open(B); await found(B, 'Bramblemoor');
await register(A, { old: true }); await register(B, { old: true });
check('the first nation reaches 12 million', await grow(A, ua));

// the page: five tabs, the Overview first, nothing waiting, the spy die gone to Intelligence
await nav(A, 'diplomacy'); await A.waitForSelector('#dp');
check('Diplomacy has five tabs', JSON.stringify(await A.$$eval('.dp-tab', b => b.map(x => x.childNodes[0].textContent.trim()))) === JSON.stringify(['Overview', 'Alliance', 'Relations', 'Wars', 'Gifts']));
check('it opens on the Overview, one pane at a time', await tab(A) === 'overview' && await shown(A, '#dp-p-overview .dp-cards') && !await shown(A, '#dp-p-relations .dp-rel-top'));
check('the strip says nothing is waiting', /Nothing is waiting for you/.test(await text(A, '.dp-wait')));
check('the spy die is no longer on this page', !await A.$('#dp #spy-form'));
await shot(A, 'overview');
check('the how-alliances-work box opens and closes', await (async () => { await clickAct(A, 'dp-how'); const o = /longest-serving/.test(await text(A, '.dp-how')); await clickAct(A, 'dp-how'); return o && !/longest-serving/.test(await text(A, '.dp-how')); })());

// founding: a name, a motto, a type, who may join, a banner and a map colour
await A.click('#dp-tab-alliance');
check('the Alliance tab shows its pane and the address says so', await tab(A) === 'alliance' && await A.evaluate(() => location.hash) === '#diplomacy/alliance');
await A.fill('#al-f-name', 'The Test Concord'); await A.fill('#al-f-mo', 'Strength in numbers');
await A.click('[data-act="dp-ty"][data-pre="f"][data-v="trade"]');
await A.click('[data-act="dp-acc"][data-pre="f"][data-v="apply"]');
await A.selectOption('#al-f-p', 'tri-h'); await A.click('[data-act="dp-col"][data-pre="al-f"]:nth-of-type(3)');
check('the banner preview is drawn', await shown(A, '.al-ban-pv svg'));
await A.click('#al-form button[type="submit"]');
await shot(A, 'found-form');
check('the alliance is founded on the server, and its leader sees it', await until(() => shown(A, '.al-head .al-name'), 15000) && /The Test Concord/.test(await text(A, '.al-head')));
const aid = await A.evaluate(() => G.ALX().alMine().id);
const D0 = await alDoc(aid);
check('the record holds the charter: leader, type, access, motto', D0 && D0.ld.stringValue === ua && D0.ty.stringValue === 'trade' && D0.acc.stringValue === 'apply' && D0.mo.stringValue === 'Strength in numbers');
check('the index names the alliance for the referee', (await adminGet('allyOf/' + ua))?.fields?.a?.stringValue === aid);
check('the leader’s record marks the alliance, and its log the founding', await until(async () => { const d = await nationDoc(ua); return d && d.rec.alm === aid && d.rec.log.some(l => l.k === 'alfound'); }, 25000));
check('the head shows the level, the renown and the places', /Level 1/.test(await text(A, '.al-head')) && /of 15 places/.test(await text(A, '.al-head')));

// a request with a note, from the other nation's Alliance tab
await nav(B, 'diplomacy'); await B.click('#dp-tab-alliance');
check('the other player sees the alliance in the list', await until(async () => /The Test Concord/.test(await text(B, '.al-cards2'))));
await B.click(`[data-act="dp-ask"][data-id="${aid}"]`); await B.fill(`#al-note-${aid}`, 'We share a river.');
await B.click(`.al-ask [data-act="dp-join"][data-id="${aid}"]`);
check('the request is sent', await until(async () => /Request sent/.test(await text(B, '.al-cards2'))));
await shot(B, 'browser');
check('the leader’s strip shows the request, with its note', await until(async () => /asks to join The Test Concord: “We share a river.”/.test(await text(A, '.dp-wait')), 10000));
check('the menu counts it on Diplomacy', await until(async () => (await text(A, '.nav [data-v="diplomacy"] .badge')) === '1', 8000));
await shot(A, 'waiting');
await A.click(`.dp-wait [data-act="dp-approve"][data-id="${ub}"]`);
check('approved, the nation is a member', await until(async () => (await alDoc(aid))?.mem?.mapValue?.fields?.[ub] !== undefined, 10000));
check('the new member sees its alliance', await until(() => shown(B, '.al-head .al-name'), 10000) && /Your alliance · Member/.test(await text(B, '.al-head')));

// roles: an officer
await A.click('[data-act="dp-sub"][data-v="members"]');
await A.click(`[data-act="dp-role"][data-id="${ub}"][data-r="o"]`);
check('the leader makes the member an officer', await until(async () => (await alDoc(aid))?.mem?.mapValue?.fields?.[ub]?.mapValue?.fields?.r?.stringValue === 'o', 10000));
check('the member list says so', await until(async () => /Officer/.test(await text(A, '.al-mems'))));

// the channel: only members read it
await A.click('[data-act="dp-sub"][data-v="channel"]');
await A.fill('#al-chat-x', 'Hello, allies.'); await A.click('#al-chat-form button[type="submit"]');
check('a message reaches the channel', await until(async () => /Hello, allies\./.test(await text(A, '#al-chat')), 10000));
check('the other member is told of it', await until(async () => /new message/.test(await text(B, '.dp-wait')) || /Channel\s*1/.test(await text(B, '.al-subs')), 10000));
await B.click('[data-act="dp-sub"][data-v="channel"]');
check('and reads it there', /Hello, allies\./.test(await text(B, '#al-chat')));
await shot(B, 'channel');
check('a stranger cannot read the channel', (await restGet(`alliances/${aid}/chat`)).status === 403);

// the treasury: a pledge taken from the stock, credited once the nation has saved; then a project
await A.click('[data-act="dp-sub"][data-v="treasury"]');
const before = await A.evaluate(() => G.RC().stock(G.S.nation).timber);
await A.selectOption('#al-give-k', 'timber'); await A.fill('#al-give-q', '40'); await A.click('#al-give button[type="submit"]');
check('the pledge comes out of the stock at once', Math.abs((await A.evaluate(() => G.RC().stock(G.S.nation).timber)) - (before - 40)) < 1.5 && await A.evaluate(() => (G.S.nation.alp || []).some(p => p.k === 'timber' && p.q === 40)));
await A.selectOption('#al-give-k', 'goods'); await A.fill('#al-give-q', '30'); await A.click('#al-give button[type="submit"]');
check('the treasury counts both once the nation has saved', await until(async () => { const d = await alDoc(aid); const tr = d?.tr?.mapValue?.fields || {}; return Number(tr.timber?.integerValue ?? tr.timber?.doubleValue) === 40 && Number(tr.goods?.integerValue ?? tr.goods?.doubleValue) === 30; }, 60000, 1000));
/* 10 for the member admitted, 7 for the 70 given (one for every 10) */
check('and earns the alliance renown', await until(async () => Number((await alDoc(aid))?.xp?.integerValue) === 17 && /17 renown/.test(await text(A, '.al-head')), 10000));
await until(() => shown(A, '[data-act="dp-build"][data-v="hall"]:not([disabled])'), 10000);
await A.click('[data-act="dp-build"][data-v="hall"]');
await shot(A, 'treasury');
check('the Alliance Hall is built, and adds two places', await until(async () => /of 17 places/.test(await text(A, '.al-head')), 10000) && Number((await alDoc(aid))?.pj?.mapValue?.fields?.hall?.integerValue) === 1);
check('the later buildings are listed, each waiting for its alliance level', await until(async () => { const t = await text(A, '.al-pjs'); return /Beacon Towers[\s\S]*needs alliance level 2/.test(t) && /Alliance Academy[\s\S]*needs alliance level 3/.test(t) && /Hall of Chronicles[\s\S]*needs alliance level 2/.test(t); }, 10000)
  && await A.evaluate(() => ['beacon', 'academy', 'chronicle'].every(k => document.querySelector(`[data-act="dp-build"][data-v="${k}"]`)?.disabled)));

// relations: the ally, with the reasons goodwill moved; a gift from the Relations tab
await A.click('#dp-tab-relations');
check('the Relations tab lists the ally', await until(async () => /Bramblemoor/.test(await text(A, '.dp-rels')) && /Ally/.test(await text(A, '.dp-rels'))));
await A.click(`[data-act="dp-relf"][data-v="allies"]`);
check('the Allies filter keeps it', /Bramblemoor/.test(await text(A, '.dp-rels')));
await A.click(`[data-act="dp-gift"][data-id="${ub}"]`);
check('Gift opens the Gifts tab with the form for that nation', await until(async () => await tab(A) === 'gifts' && await shown(A, '.gf-send')));
await A.click('[data-act="gf-send"]');
check('the gift is sent', await until(() => A.evaluate(ub => (G.S.nation.gft || []).some(g => g.to === ub), ub)));
await A.click('#dp-tab-relations'); await A.click(`[data-act="dp-why"][data-id="${ub}"]`);
check('Why? says the gift raised goodwill', await until(async () => /\+3\s*You sent them a gift/.test(await text(A, '.dp-rel.open'))));
await shot(A, 'relations');
check('the other player is asked to answer the gift', await until(async () => /sent you/.test(await text(B, '.dp-wait')), 10000));

// the charter: a new motto, a new type
await A.click('#dp-tab-alliance'); await A.click('[data-act="dp-sub"][data-v="charter"]');
await A.fill('#al-ed-mo', 'One for all'); await A.click('[data-act="dp-ty"][data-pre="ed"][data-v="def"]');
await A.click('#al-charter button[type="submit"]');
await shot(A, 'charter');
check('the charter is saved and shown', await until(async () => /One for all/.test(await text(A, '.al-head')) && /Defence pact/.test(await text(A, '.al-head')), 10000));
check('a defence pact makes members’ land harder to take', await A.evaluate(ub => G.ALX().alFx(ub).def === 0.1, ub));

// the map lenses
await A.click('#dp-tab-relations'); await A.click('#dp-p-relations [data-act="dp-lens"][data-v="dip"]');
check('Show on the map opens the Diplomacy lens with its key', await until(async () => (await A.evaluate(() => G.S.view)) === 'map' && /Your allies/.test(await text(A, '#ml-sheet'))));
await sleep(800); await shot(A, 'lens');
await A.selectOption('select[data-lens]', 'ally').catch(() => {});
check('the Alliances lens names the alliance in its key', await until(async () => /The Test Concord/.test(await text(A, '#ml-sheet')), 5000));
await A.selectOption('select[data-lens]', 'pol').catch(() => {});

// the public page and the Region's ranking
await nav(B, 'diplomacy'); await B.click('#dp-tab-alliance'); await B.click(`.al-links [data-act="al-page"]`);
check('the public page opens at its own address', await until(async () => (await B.evaluate(() => location.hash)) === '#alliance/' + aid && /Concordia/.test(await text(B, '.alp'))));
await shot(B, 'public');
check('with its members and its history', /Bramblemoor/.test(await text(B, '.alp')) && /founded The Test Concord/.test(await text(B, '.al-log')));
await nav(B, 'region');
check('the Region page ranks the alliance', await until(async () => /Alliances of/.test(await text(B, '.al-rank')) && /The Test Concord/.test(await text(B, '.al-rank'))));

// a call to arms: a computer nation declares war on the officer; the leader answers
const npc = await B.evaluate(() => G.allNations().find(x => x.npc && !G.ALX().politics().of.get(x.id))?.id);
await B.evaluate(id => { const n = G.clone(G.S.nation); n.wars = { ...(n.wars || {}), [id]: { t: Date.now(), by: 1 } }; G.commit(n); }, npc);
await nav(A, 'diplomacy');
check('the leader gets a call to arms in the strip', await until(async () => /Call to arms\./.test(await text(A, '.dp-wait')), 20000));
await A.click('.dp-wait [data-act="dp-cta"]');
check('answering opens the war map and goes on record', await until(async () => (await A.evaluate(() => G.S.view)) === 'map') && await A.evaluate(ub => (G.S.nation.cta || []).some(c => c.w === ub) && G.S.nation.log.some(l => l.k === 'cta'), ub));
await nav(A, 'diplomacy'); await A.click('#dp-tab-wars');
await shot(A, 'warroom');
check('the war room says who answered', await until(async () => /attacked Bramblemoor/.test(await text(A, '.dp-wr')) && /You answered/.test(await text(A, '.dp-wr'))));
check('Stood Together is earned', await until(() => A.evaluate(() => !!(G.S.nation.ach && G.S.nation.ach['dip-cta'])), 15000));
await B.evaluate(id => { const n = G.clone(G.S.nation); n.peace = { ...(n.peace || {}), [id]: Date.now() }; G.commit(n); }, npc);

// the leader leaves; the officer leads
await A.click('#dp-tab-alliance'); await A.click('[data-act="dp-sub"][data-v="members"]');
await A.click('[data-act="al-leave-ask"]');
check('leaving names who takes over', /Bramblemoor takes over/.test(await text(A, '.war-box')));
await A.click('[data-act="al-leave"]');
check('the officer becomes the leader', await until(async () => (await alDoc(aid))?.ld?.stringValue === ub, 10000));
check('the old leader is no longer a member, on the page or in the index', await until(async () => /Found an alliance/.test(await text(A, '#dp-p-alliance'))) && !(await adminGet('allyOf/' + ua)));
check('the new leader sees the role', await until(async () => { await nav(B, 'diplomacy'); await B.click('#dp-tab-alliance'); return /Your alliance · Leader/.test(await text(B, '.al-head')); }, 10000));

// the address opens a tab after a reload
await A.evaluate(() => { location.hash = '#diplomacy/relations'; }); await A.reload(); await ready(A); await A.waitForSelector('#dp');
check('#diplomacy/relations opens the Relations tab after a reload', await tab(A) === 'relations' && await shown(A, '.dp-rel-top'));
await A.setViewportSize({ width: 390, height: 844 }); await sleep(300);
await shot(A, 'phone');
check('on a phone the page does not scroll sideways', await A.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

check('no page errors', !errors.length, errors.slice(0, 5).join(' | '));
await finish();
