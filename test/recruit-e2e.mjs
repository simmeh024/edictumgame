// Recruit a player. Region › Invite is the home of recruiting: the player's own link (with their region), share buttons,
// an invitation card with a QR code, what both sides get, what recruits earn, and the recruits themselves with their
// progress; Settings › Account keeps the link and points there. A visitor who opens the link is welcomed on the founding
// page by the recruiter's name, starts in the recruiter's region with the advisors' pins near the recruiter's capital,
// and is on the admins' funnel (recruitTrail). Once they have founded a nation and linked a sign-in account the server
// files recruits/<uid>, and both sides get 15 goods, oil, timber and iron plus 3 land credits; a Guest Nation sees the
// two steps on its Nation page. A week of play (and a second city) pays both sides again, once. The recruiter hears of it
// in the bell and the menu, and as sponsor may send a new recruit one more Supply Cache a day. A nation founded before
// the link was opened never counts; the claim is filed once, never for oneself, and only the recruiter lists recruits.
import { BASE, OUT, player, open, found, until, check, finish, text, nav, restListAdmin, clearEmulators, sleep, register, localNation } from './lib.mjs';
import fs from 'node:fs';
await clearEmulators();
const RES = ['goods', 'oil', 'timber', 'iron'];
const stock = p => p.evaluate(() => { const n = G.S.nation; return Object.fromEntries(['goods', 'oil', 'timber', 'iron', 'food'].map(r => [r, Math.floor(G.RC().stock(n, Date.now())[r] || 0)])); });
const credits = p => p.evaluate(() => G.RC().land(G.S.nation));
const saved = p => until(async () => { const n = await localNation(p); return n && n._rev > 0 && !n._dirty; }, 20000);
const trail = async id => { const d = (await restListAdmin('recruitTrail')).find(x => x.id === id); return d ? { r: d.fields.r?.stringValue, o: !!d.fields.o, f: !!d.fields.f, l: !!d.fields.l } : null; };
const rec = async id => { const d = (await restListAdmin('recruits')).find(x => x.id === id); return d ? { r: d.fields.r?.stringValue, m: Number(d.fields.m?.integerValue || d.fields.m?.doubleValue || 0) } : null; };
const bell = p => p.evaluate(() => G.NEWS.bell(Date.now()).ev.filter(e => e.k === 'recruit').map(e => e.txt));
const badge = p => p.evaluate(() => { const b = document.querySelector('.nav [data-v="region"] .badge'); return b && !b.hidden && b.offsetParent ? b.textContent : ''; });

const A = await player('recruiter');
const uidA = await open(A); await found(A, 'Recruitland');
/* a recruiter's nation is long saved by the time anyone follows the link: here, save it now */
await A.evaluate(() => G.PG.saveSoon()); await until(async () => { const n = await localNation(A); return n && n._rev > 0 && !n._dirty && !!n.loc; }, 30000);
const reg = await A.evaluate(() => G.S.nation.reg || 'meridian');

// Settings › Account: the link, with the region, and a way to Region › Invite
await nav(A, 'settings'); await A.click('#sg-tab-account');
await A.waitForSelector('#rc-link');
const link = await A.$eval('#rc-link', i => i.value);
check('Settings keeps the player\'s own link, naming their region', link.endsWith('/?recruit=' + uidA + '&rg=' + reg), link);
const shares = await A.$$eval('#set-social .rc-share a', as => as.map(a => a.textContent + ' ' + a.href));
check('share links for Facebook, X, Mastodon, WhatsApp and others', ['Facebook', 'X', 'Mastodon', 'WhatsApp', 'Bluesky', 'Telegram', 'Reddit', 'Email'].every(k => shares.some(s => s.startsWith(k + ' '))) && shares.every(s => s.includes(encodeURIComponent(link)) || s.includes(encodeURIComponent(link).replace(/%20/g, '+'))), JSON.stringify(shares));
check('the section says no one has joined yet', /No one has founded a nation through your link yet/.test(await text(A, '#set-social')));
await A.click('#set-social [data-act="rgn-invite"]');
check('and points to the Region page’s Invite tab', await until(() => A.evaluate(() => G.S.view === 'region' && document.getElementById('rgn')?.dataset.tab === 'invite')));
const aBefore = await stock(A);

// Region › Invite
check('the Invite tab has the same link', await until(async () => (await A.$eval('#rgn-p-invite #rc-link', i => i.value).catch(() => '')) === link));
check('it says what both sides get, step by step', /15 goods, oil, timber and iron · 3 land credits/.test(await text(A, '.rc-rw')) && /played a week/.test(await text(A, '.rc-rw')) && /founded a second city/.test(await text(A, '.rc-rw')), await text(A, '.rc-rw'));
check('and what recruits earn: a title, a stamp, a frame and a charge', (await A.$$eval('.rc-ul li', l => l.map(x => x.querySelector('.rc-ul-k').textContent))).join() === '1 recruit,3 recruits,10 recruits,25 recruits' && /the Welcoming/i.test(await text(A, '.rc-ul')) && /Clasped hands/.test(await text(A, '.rc-ul')), await text(A, '.rc-ul'));
/* the card: drawn, and its QR code is the link's (each module read off the canvas) */
check('the invitation card is drawn', await until(() => A.evaluate(() => document.getElementById('rc-card')?.dataset.drawn === '1'), 10000));
await sleep(1200);
const qr = await A.evaluate(lk => { const c = document.getElementById('rc-card'), g = c.getContext('2d'), M = G.RC().qr(lk), N = M.length, q = 4, u = Math.floor(300 / (N + 2 * q)), side = u * (N + 2 * q), x0 = 1200 - 80 - side, y0 = 96;
  const d = g.getImageData(0, 0, c.width, c.height).data; let bad = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const px = Math.floor(x0 + (x + q + .5) * u), py = Math.floor(y0 + (y + q + .5) * u), i = (py * c.width + px) * 4; if ((d[i] < 128) !== M[y][x]) bad++; }
  return { N, bad }; }, link);
check('the card’s QR code is the link’s, module for module', qr.N >= 21 && qr.bad === 0, JSON.stringify(qr));
const png = await A.evaluate(() => new Promise(r => document.getElementById('rc-card').toBlob(b => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }, 'image/png')));
fs.writeFileSync(OUT + '/recruit-card.png', Buffer.from(png.split(',')[1], 'base64'));
await A.screenshot({ path: OUT + '/recruit-invite-desktop.png', fullPage: true });
await A.click('#rgn-tab-overview');
check('while land is free, the overview invites a neighbour', /Invite a neighbour/.test(await text(A, '#rgn-p-overview .rgn-inv')) && /of the land in .* is still unclaimed/.test(await text(A, '#rgn-p-overview .rgn-inv')), await text(A, '#rgn-p-overview .rgn-inv'));
check('the Invite pane shows when its tab is chosen', await A.evaluate(() => { document.getElementById('rgn-tab-invite').click(); const p = document.getElementById('rgn-p-invite'); return getComputedStyle(p).display !== 'none' && p.getBoundingClientRect().height > 200; }));

// the visitor: welcomed, started beside the recruiter, and on the funnel
const B = await player('recruit');
await open(B, BASE + '/?recruit=' + uidA + '&rg=' + reg);
check('the link is taken out of the address bar', !B.url().includes('recruit='), B.url());
check('and kept on the device until the nation is founded, with the region', await B.evaluate(() => G.RC().pending()) === uidA && await B.evaluate(() => JSON.parse(localStorage.getItem('edictum.recruitBy.v1')).g) === reg);
const uidB = await B.evaluate(() => window.claude.use('user').then(u => u.id()));
check('the founding page names the recruiter, and their region', await until(async () => /Recruitland invited you to Edictum/.test(await text(B, '#rc-wel')) && /pins on the map are near Recruitland/.test(await text(B, '#rc-wel')), 20000), await text(B, '#rc-wel').catch(() => ''));
await B.screenshot({ path: OUT + '/recruit-welcome.png' });
check('the visit is on the admins’ funnel', await until(async () => (await trail(uidB))?.o === true, 20000), JSON.stringify(await trail(uidB)));
await found(B, 'Newland', { newPlayer: true });
/* the advisors' three pins: nearer the recruiter's capital than they would be without the link */
const dists = () => B.evaluate(() => { const T = G.XP().territory(), xa = G.allNations().find(x => x.n.name === 'Recruitland'), cap = T.list[T.byId[xa.id]].cap;
  const cells = G.LAND().fdSites(G.S.nation, T), M = G.MAP, d = new Map([[cap, 0]]), q = [cap];
  while (q.length) { const c = q.shift(), k = d.get(c); if (k >= 60) continue; for (let i = 0; i < 6; i++) { const nb = M.nbr[c * 6 + i]; if (nb >= 0 && !d.has(nb)) { d.set(nb, k + 1); q.push(nb); } } }
  return cells.filter(c => c >= 0).map(c => d.get(c) ?? 99); });
const near = await dists();
const keep = await B.evaluate(() => { const o = localStorage.getItem('edictum.recruitBy.v1'); localStorage.removeItem('edictum.recruitBy.v1'); G.S.fdSites = null; return o; });
const unsteered = await dists();
await B.evaluate(o => { localStorage.setItem('edictum.recruitBy.v1', o); G.S.fdSites = null; }, keep);
const mean = a => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
/* Recruiting biases the available legal sites toward the recruiter; occupied land, terrain and capital spacing
   can leave no legal site within 20 hexes. Both the closest pin and the overall set must improve on the control. */
check('the advisors’ pins are nearer the recruiter’s capital than the unsteered sites', near.length >= 2 && unsteered.length >= 2 && Math.min(...near) < Math.min(...unsteered) && mean(near) < mean(unsteered), JSON.stringify({ near, unsteered }));
check('a Guest Nation sees the two steps on its Nation page', await until(async () => { await nav(B, 'nation'); return /Recruitland invited you/.test(await text(B, '.rc-gc').catch(() => '')) && /Link a sign-in account/.test(await text(B, '.rc-gc').catch(() => '')); }, 30000));
await B.screenshot({ path: OUT + '/recruit-guest-steps.png' });
check('and keeps the link, unpaid', await B.evaluate(() => G.RC().pending()) === uidA && await B.evaluate(() => !G.S.nation.rcb) && (await restListAdmin('recruits')).length === 0);
check('the funnel has the founding, before an account is linked', await until(async () => (await trail(uidB))?.f === true, 15000), JSON.stringify(await trail(uidB)));
await register(B);
check('the recruit gets the bonus once the account is linked', await until(() => B.evaluate(() => !!G.S.nation.rcb), 30000), await B.evaluate(() => JSON.stringify(G.S.nation.rcb || null)));
const bStock = await stock(B);
check('15 goods, oil, timber and iron for the recruit', RES.every(r => bStock[r] >= 15), JSON.stringify(bStock));
check('and 3 land credits', await credits(B) === 3);
check('the pending link is forgotten, and the steps card with it', await B.evaluate(() => G.RC().pending()) === '' && await until(async () => { await nav(B, 'nation'); return !(await B.$('.rc-gc')); }));
const docs = (await restListAdmin('recruits'));
check('recruits/<uid> names the recruiter', docs.length === 1 && docs[0].id === uidB && docs[0].fields.r.stringValue === uidA);
check('and the funnel has the link', (await trail(uidB))?.l === true);

// a second claim is not paid again
check('a second claim finds the first', await B.evaluate(r => Promise.resolve(window.claude.use('recruit')).then(a => a.claim(r)), uidA) === 'done');
await nav(B, 'region'); await B.click('#rgn-tab-invite');
check('the recruit’s Invite tab says whose link it came through, with its steps', await until(async () => /You joined through Recruitland’s link/.test(await text(B, '.rc-me').catch(() => '')) && /✓Founded/.test((await text(B, '.rc-me').catch(() => '')).replace(/\s/g, ''))), await text(B, '#rc-panel').catch(() => ''));

// the recruiter's side
await A.evaluate(() => G.RC().poll(true));
check('the recruiter is paid for the new recruit', await until(() => A.evaluate(() => (G.S.nation.rcp || []).length === 1), 15000));
const aAfter = await stock(A);
check('15 goods, oil, timber and iron for the recruiter', RES.every(r => aAfter[r] - aBefore[r] >= 14), JSON.stringify([aBefore, aAfter]));
check('and 3 land credits', await credits(A) === 3);
await A.evaluate(() => G.RC().poll(true)); await sleep(1500);
check('polling again pays nothing more', await A.evaluate(() => G.S.nation.rcp.length) === 1 && await credits(A) === 3);
check('the bell tells of the recruit', (await bell(A)).some(t => /Newland founded a nation through your recruiting link/.test(t)), JSON.stringify(await bell(A)));
await nav(A, 'nation');
check('and the menu counts it on Region', await until(async () => +(await badge(A)) >= 1, 8000), await badge(A));
await nav(A, 'region'); await A.click('#rgn-tab-invite');
check('the Invite tab lists the recruit, as sponsor, with Write and Send buttons', await until(async () => /Newland/.test(await text(A, '.rc-list').catch(() => '')) && /Sponsor until/.test(await text(A, '.rc-list').catch(() => '')) && !!(await A.$(`.rc-list [data-act="rc-write"][data-id="${uidB}"]`)) && !!(await A.$(`.rc-list [data-act="sc-send-open"][data-id="${uidB}"]`)), 20000), await text(A, '#rc-panel').catch(() => ''));
check('opening it clears the menu’s count', await until(async () => !(await badge(A)) && await A.evaluate(() => !G.S.nation.log.some(l => (l.k === 'recruit' || l.k === 'rcstep') && l.t > (G.S.nation.rcv || 0))), 8000), await badge(A));
await nav(A, 'nation'); await nav(A, 'settings'); await A.click('#sg-tab-account');
check('Settings counts the recruit', await until(async () => /One player has founded a nation through your link, earning you 3 land credits/.test(await text(A, '#set-social'))), await text(A, '#set-social'));
check('Word of Mouth is earned', await until(() => A.evaluate(() => !!(G.S.nation.ach && G.S.nation.ach['dip-rc1'])), 15000));
check('and the first recruit earns the title the Welcoming', await until(() => A.evaluate(() => G.UX.unlocksOf(G.S.nation).has('t-welcoming')), 15000));

// a week of play: the server reads it from the saved nation, and both sides are paid once
const bs0 = await stock(B);
await B.evaluate(() => { const n = G.clone(G.S.nation); n.founded = Date.now() - 8 * 864e5; G.commit(n); G.PG.saveSoon(); });
await saved(B); await sleep(1500);
await B.evaluate(() => { G.RC().state.stepAt = 0; G.RC().step(); });
check('the server marks the recruit’s week of play', await until(async () => (await rec(uidB))?.m === 2, 20000), JSON.stringify(await rec(uidB)));
check('and the recruit is paid for it: 10 of each and 2 land credits', await until(() => B.evaluate(() => (G.S.nation.rcb.m | 0) === 2), 15000) && await credits(B) === 5 && (await stock(B)).goods - bs0.goods >= 9, JSON.stringify([bs0, await stock(B), await credits(B)]));
await B.evaluate(() => { G.RC().state.stepAt = 0; G.RC().step(); }); await sleep(2500);
check('asking again pays nothing more', await credits(B) === 5);
await A.evaluate(() => G.RC().poll(true));
check('the recruiter is paid for it too', await until(() => A.evaluate(id => ((G.S.nation.rcm || {})[id] | 0) === 2, uidB), 15000) && await credits(A) === 5, await credits(A));
check('the bell tells of the step', (await bell(A)).some(t => /Newland played a week/.test(t)), JSON.stringify(await bell(A)));
await nav(A, 'region'); await A.click('#rgn-tab-invite');
check('and the list ticks it', await until(async () => /✓Aweekofplay/.test((await text(A, '.rc-list').catch(() => '')).replace(/\s/g, ''))), await text(A, '.rc-list').catch(() => ''));
await A.screenshot({ path: OUT + '/recruit-invite-list.png', fullPage: true });

// abuse: no self-recruiting, and nobody else lists A's recruits
const C = await player('other');
await open(C, BASE + '/?recruit=' + uidA); await found(C, 'Otherland', { newPlayer: true });
const uidC = await C.evaluate(() => window.claude.use('user').then(u => u.id()));
await register(C);
check('a player cannot file a claim naming themself', await C.evaluate(id => Promise.resolve(window.claude.use('recruit')).then(a => a.claim(id)), uidC) === 'bad');
check('C was recruited by A too, through a link from before links named a region', await until(() => C.evaluate(() => !!G.S.nation.rcb), 30000));
const listed = await C.evaluate(id => Promise.resolve(window.claude.use('recruit')).then(a => a.mine()).then(l => l.map(x => x.id)), uidA);
check('a player lists only recruits naming them', Array.isArray(listed) && listed.length === 0, JSON.stringify(listed));
await A.evaluate(() => G.RC().poll(true));
check('the recruiter is paid for the second recruit', await until(() => A.evaluate(() => (G.S.nation.rcp || []).length === 2), 15000) && await credits(A) === 8, await credits(A));

// a player whose nation was founded before the link was opened is no recruit
const D = await player('veteran');
await open(D); await found(D, 'Oldland', { newPlayer: true }); await register(D);
await D.evaluate(r => { localStorage.setItem('edictum.recruitBy.v1', JSON.stringify({ r, t: Date.now() + 3600e3 })); G.RC().claim(); }, uidA);
check('a nation founded before the link was opened forgets it, unpaid', await until(() => D.evaluate(() => G.RC().pending() === ''), 8000) && await D.evaluate(() => !G.S.nation.rcb));
const uidD = await D.evaluate(() => window.claude.use('user').then(u => u.id()));
check('and files nothing', !(await restListAdmin('recruits')).some(d => d.id === uidD));

// the sponsor: one more Supply Cache a day for a new recruit (the recruiter linked, and old enough to send caches)
await register(A, { old: true });
check('the recruiter is linked and may send caches', await until(() => A.evaluate(() => G.SC().linked()), 20000));
await until(() => A.evaluate(id => G.allNations().some(x => x.id === id), uidD), 30000);
const visit = (p, id) => p.evaluate(id => { G.S.visit = id; G.S.view = 'visit'; G.render(); }, id);
const sendOne = async (to) => { await visit(A, to); await A.click(`[data-act="sc-send-open"][data-id="${to}"]`); await A.waitForSelector('#sc-dlg'); await A.fill('#sc-q-food', '1'); await A.click('#sc-send'); await until(() => A.evaluate(() => !document.getElementById('sc-dlg')), 30000); };
const filed = async () => (await restListAdmin('supply')).filter(d => d.fields.f?.stringValue === uidA).map(d => d.fields.to?.stringValue);
for (let i = 0; i < 3; i++) await sendOne(uidD);
/* sent back to back, a cache can wait for the save before it: the game asks again after 20 s, then 40 s */
check('three caches to a neighbour', await until(async () => (await filed()).length === 3, 100000), JSON.stringify(await filed()));
const why = id => A.evaluate(id => G.SC().scWhyNot(id, Date.now()), id);
check('a fourth to the neighbour waits for tomorrow', /You have sent 3 Supply Caches today/.test(await why(uidD)), await why(uidD));
check('but the new recruit may have one more', await why(uidB) === '' && await A.evaluate(id => G.RC().sponsoring(id), uidB), await why(uidB));
await sendOne(uidB);
check('the server files the sponsor’s fourth', await until(async () => (await filed()).filter(t => t === uidB).length === 1, 100000), JSON.stringify(await filed()));
check('and then no more today', /You have sent 4 Supply Caches today/.test(await why(uidB)), await why(uidB));

// the phone. The page's width is watched every frame, not only at the end: the Invite tab's badge (a new recruit)
// lies past the edge of the tab row until the row scrolls to it, and its screen-reader words, absolutely placed, once
// widened the page by 65 px for about a second, which a single look after a pause caught only on a slow machine (and
// waiting for the page to settle would hide). The widest frame names what sticks out past the right edge.
await A.setViewportSize({ width: 390, height: 844 });
await A.evaluate(() => {
  const out = () => [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > window.innerWidth + 1 && getComputedStyle(e).position !== 'fixed'; }).slice(0, 6).map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '') + ' ' + Math.round(e.getBoundingClientRect().right));
  window.__wide = { px: 0, sw: document.documentElement.scrollWidth, w: window.innerWidth, out: [] };
  const look = () => { const sw = document.documentElement.scrollWidth, w = window.innerWidth; if (sw - w > window.__wide.px) window.__wide = { px: sw - w, sw, w, out: out() }; window.__wideRaf = requestAnimationFrame(look); };
  look();
});
await nav(A, 'region'); await A.click('#rgn-tab-invite'); await sleep(800);
const wider = await A.evaluate(() => { cancelAnimationFrame(window.__wideRaf); return window.__wide; });
check('on a phone the Invite tab fits without scrolling sideways', wider.px <= 1 && await A.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), JSON.stringify(wider));
await A.screenshot({ path: OUT + '/recruit-invite-phone.png', fullPage: true });

await finish();
