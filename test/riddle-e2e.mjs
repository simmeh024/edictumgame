// The riddle of the week (game/edictum.html, "the riddle of the week"; jobs/fx/riddle.mjs; functions/riddles.js): the
// weekly job sets the region's riddle and tells last week's answer; the Dispatch prints both; on the map a hex's panel
// takes a guess, the server says right or wrong (never where), a wrong guess is crossed on the map, and the first to find
// it is named and earns the Sharp-Eyed. The answer stays where no player can read it.
//   npm run test:riddle
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { player, open, found, until, check, finish, text, nav, sleep, clearEmulators, errors, OUT, FS_HOST, PROJECT } from './lib.mjs';
await clearEmulators();

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const job = (reg, now) => JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'jobs', 'fx', 'riddle.mjs'), '--project', PROJECT, '--region', reg, '--now', String(now)], { env: process.env, encoding: 'utf8', cwd: ROOT }));
const admin = async doc => { const r = await fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${doc}`, { headers: { authorization: 'Bearer owner' } }); return r.ok ? (await r.json()).fields : null; };
const watch = p => p.ctx.addInitScript(() => { window.__toasts = []; addEventListener('DOMContentLoaded', () => new MutationObserver(() => { const t = document.getElementById('toast'); if (t && !t.hidden) window.__toasts.push(t.textContent); }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })); });
const toastHas = (p, re) => until(() => p.evaluate(src => (window.__toasts || []).some(t => new RegExp(src).test(t)), re.source), 30000);
/* a screenshot of an element the page may draw again meanwhile (the paper refreshes itself): try again on a fresh copy */
const shot = async (loc, file) => { for (let i = 0; ; i++) { try { return await loc.screenshot({ path: file }); } catch (e) { if (i >= 4 || !/not attached|not visible|stable/i.test(e.message)) throw e; await sleep(500); } } };
const panelOn = (p, c) => p.evaluate(c => { G.S.mapSel = null; G.S.mapTarget = null; G.S.mapCell = c; G.RVN().updateMapPanel(); }, c);

const A = await player('riddler');
await watch(A);
const uid = await open(A);
await found(A, 'Riddleton');
const reg = await A.evaluate(() => G.S.nation.reg), now = Date.now(), WEEK = 7 * 86400000;

/* last week's riddle, then this week's, which tells last week's answer */
const r1 = job(reg, now - WEEK), r2 = job(reg, now);
const lastId = r1.reports[0].id, id = r2.reports[0].id;
check('the job sets a riddle for the region each week', r1.reports[0].made > 0 && r2.reports[0].made > 0 && lastId !== id, JSON.stringify([r1, r2]));
check('and tells last week’s answer when it sets the new one', r2.reports[0].revealed === lastId, JSON.stringify(r2));
check('run again in the same week, it changes nothing', job(reg, now).reports[0].skipped === 'already set');
const R = await admin('riddles/' + id), K = await admin('riddleKeys/' + id), LK = await admin('riddleKeys/' + lastId);
const lines = R.q.arrayValue.values.map(v => v.stringValue), answer = Number(K.c.integerValue), lastAnswer = Number(LK.c.integerValue);
check('the riddle has its lines and no answer in it', lines.length >= 2 && !('a' in R) && !('c' in R), JSON.stringify(lines));
check('last week’s riddle now carries its answer', Number((await admin('riddles/' + lastId)).a.integerValue) === lastAnswer);
const keyRead = await A.evaluate(async id => { try { const db = G.S.db || firebase.firestore(); await db.doc('riddleKeys/' + id).get(); return 'read'; } catch (e) { return String(e.code || e.message); } }, id);
check('the answer is out of a player’s reach', /permission|not_granted/i.test(keyRead), keyRead);
check('the game has this week’s riddle and last week’s', await until(() => A.evaluate(id => G.RD().RD.cur?.id === id && G.RD().RD.prev?.a >= 0, id), 20000));

/* the Dispatch: the riddle, the guesses left, last week's answer */
await nav(A, 'dispatch'); await A.waitForSelector('#dsp-p-riddle', { timeout: 15000 });
const box = await text(A, '#dsp-p-riddle');
check('the Dispatch prints the riddle in its features', box.includes(lines[0]) && /Riddle of the week/.test(box), box.slice(0, 300));
check('with the guesses left', /You have 3 of 3 guesses/.test(box));
check('and last week’s answer', /Last week’s answer/.test(box) && /Nobody found it/.test(box));
await shot(A.locator('#dsp-p-riddle'), path.join(OUT, 'riddle-dispatch.png'));

/* a wrong guess: the computer nation's capital itself is never the answer */
await A.click('[data-act="rd-map"]'); await sleep(400);
check('Look on the map opens the map', await A.evaluate(() => G.S.view === 'map'));
const wrong = await A.evaluate(() => { const T = G.territory(), x = T.list.find(y => y.id === G.RD().RD.cur.cap); return x.cap; });
await panelOn(A, wrong);
await A.click('#map-panel [data-act="rd-ask"]');
check('the panel asks before it spends a guess', /Answer the riddle of the week with this hex\?/.test(await text(A, '#map-panel')));
await A.click('#map-panel [data-act="rd-guess"]');
check('a wrong guess is told so, with the guesses left', await toastHas(A, /Not this hex\. 2 guesses left/));
check('and is kept, and marked on the hex', await until(() => A.evaluate(c => (G.RD().RD.mine?.g || []).includes(c), wrong), 10000) && /It was not the one/.test(await text(A, '#map-panel')));

/* the answer */
await panelOn(A, answer);
await A.click('#map-panel [data-act="rd-ask"]'); await A.click('#map-panel [data-act="rd-guess"]');
check('the right hex is found, the first in the region', await toastHas(A, /You found it! You are the 1st/));
const doc = await until(async () => { const d = await admin('riddles/' + id); return Number(d.n?.integerValue) === 1 ? d : null; }, 10000);
check('the riddle counts it and names the nation', doc && doc.top.arrayValue.values[0].mapValue.fields.nm.stringValue === 'Riddleton');
check('counted once, among the first ten and the very first', await until(() => A.evaluate(() => { const t = G.S.nation.tly || {}; return t.rdl === 1 && t.rdlt === 1 && t.rdl1 === 1; }), 10000));
const ach = await until(() => A.evaluate(() => { const a = G.S.nation.ach || {}; return a['rdl-1'] && a['rdl-top'] && a['rdl-first'] ? 'yes' : ''; }), 15000);
check('the achievements follow', ach === 'yes', await A.evaluate(() => JSON.stringify(Object.keys(G.S.nation.ach || {}).filter(k => k.startsWith('rdl')))));
const un = await A.evaluate(() => { try { return G.UX.unlocksOf(G.S.nation).has('t-sharp') ? 'yes' : 'no'; } catch (e) { return 'err ' + e.message; } });
check('and the Sharp-Eyed title is earned', un === 'yes', un);
check('the panel no longer offers a guess', !(await A.$('#map-panel [data-act="rd-ask"]')));
await A.evaluate(c => { G.MD.centerMain(c, 9); G.render(); }, answer); await sleep(600);
await shot(A.locator('canvas[data-map="main"]'), path.join(OUT, 'riddle-map.png'));
await nav(A, 'dispatch'); await A.waitForSelector('#dsp-p-riddle');
check('the Dispatch says it was found, and by whom', /You found it: the 1st/.test(await text(A, '#dsp-p-riddle')) && /first Riddleton/.test(await text(A, '#dsp-p-riddle')));
check('no page errors', !errors.length, JSON.stringify(errors));
void uid;
await finish();
