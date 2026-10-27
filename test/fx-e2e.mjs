// The national currency and the Foreign Exchange Bureau in the built game, on the emulators. The daily job
// runs as in production (jobs/fx/run.mjs, the Admin SDK; `npm ci --prefix jobs/fx` once) to publish four days.
//   python3 build.py
//   npx firebase emulators:exec --project demo-edictum --only auth,firestore,hosting "node test/fx-e2e.mjs"
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OUT, PROJECT, FS_HOST, check, finish, sleep, until, player, open, found, nav, text, localNation, nationDoc, restGet, clearEmulators, errors } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), DAY = 864e5;
const job = now => JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'jobs/fx/run.mjs'), '--project', PROJECT, '--region', 'meridian'].concat(now ? ['--now', String(now)] : []),
  { env: Object.assign({}, process.env, { FIRESTORE_EMULATOR_HOST: FS_HOST }), encoding: 'utf8' }));
const noScroll = p => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const fxDoc = async () => { const r = await restGet('fx/meridian'); return r.status === 200 ? JSON.parse(r.body.fields.j.stringValue) : null; };
const tryWrite = (p, docPath, data) => p.evaluate(async ([docPath, data]) => {
  const db = await window.claude.use('db');
  try { await db.doc(docPath).set(data); return 'ok'; } catch (e) { return e.code; }
}, [docPath, data]);

await clearEmulators();

/* ── a nation and its currency, before the Bureau has published anything ── */
const A = await player('FX-A');
const uidA = await open(A);
await found(A, 'Aldoria');
await until(() => nationDoc(uidA));
await nav(A, 'exchange');
check('the Bureau is in the menu, under its own address', /#exchange$/.test(A.url()) && (await text(A, '.vh h1')) === 'Foreign Exchange Bureau');
check('before the first publication it says so, and offers the designer', /No rates have been published yet|Fetching/.test(await text(A, '.cu-empty')) && !!(await A.$('.cu-empty [data-v="customise"]')));
await nav(A, 'nation');
check('a new nation has a currency at once (Aldorian Crown, ALC)', /Aldorian Crown/.test(await text(A, '.cu-nsec')) && /ALC/.test(await text(A, '.cu-nsec')) && /next publication/.test(await text(A, '.cu-nsec')));

/* ── four days of the job ── */
const now = Date.now();
const reps = [3, 2, 1, 0].map(k => job(k ? now - k * DAY : 0));
check('the job publishes Meridian four days running', reps.every(r => r.reports[0].reg === 'meridian' && r.reports[0].currencies >= 9), JSON.stringify(reps.map(r => r.reports[0])));
check('and a second run the same day does nothing', job(0).reports[0].skipped === 'done');
const fx = await fxDoc();
check('the published document has Aldoria and the computer-run nations', fx && fx.n[uidA] && fx.n['npc-vellmark'] && Object.keys(fx.n).length === 9);

/* ── the Bureau ── */
await open(A);
await nav(A, 'exchange');
await until(async () => !!(await A.$('.cu-yours .cu-big')));
check('your currency: its value in the standard unit', /^1 ALC = [\d.,]+ Meridian Reach standard units$/.test(await text(A, '.cu-yours .cu-big')), await text(A, '.cu-yours .cu-big'));
check('and, apart from it, its prestige with a classification and a rank', /most trusted of 9/.test(await text(A, '.cu-pre')) && /(Fragile|Vulnerable|Established|Trusted|Highly Trusted)/.test(await text(A, '.cu-pre .cu-pb')));
check('with why, in words', /The Aldorian Crown/.test(await text(A, '.cu-val .cu-why')) && /The Aldorian Crown is/.test(await text(A, '.cu-pre .cu-why')));
const rankP = await A.$$eval('.cu-rank li .cu-pb b', els => els.map(e => +e.textContent));
check('the ranking lists all nine, by prestige', rankP.length === 9 && rankP.every((v, i) => !i || rankP[i - 1] >= v), rankP.join(','));
check('the directory lists every currency, computer-run ones included', (await A.$$('.cu-tbl tbody tr')).length === 9 && /Vellmarker Mark/.test(await text(A, '.cu-tbl')));

/* converter */
await A.selectOption('#cu-to', 'npc-vellmark'); await sleep(200);
await A.fill('#cu-amt', '250'); await sleep(150);
const out = await text(A, '#cu-out');
const r = fx.n[uidA].v / fx.n['npc-vellmark'].v, shown = await A.$eval('.cu-rates', el => el.textContent);
const m = /1 ALC = ([\d,.]+) VLM/.exec(shown), got = m ? +m[1].replace(/,/g, '') : NaN;
check('the converter converts as you type', /250\.00/.test(out) && /Vellmarker Marks?/.test(out), out);
check('at the published rate, V(A) ÷ V(B), both ways', Math.abs(got / r - 1) < 0.005 && /1 VLM = /.test(shown), shown + ' vs ' + r);
check('and compares their prestige', (await A.$$('#cu-out .cu-pb')).length === 2 && (await text(A, '#cu-out .cu-why')).length > 10);
await A.click('[data-act="cu-swap"]'); await sleep(200);
check('the swap button swaps them', (await A.$eval('#cu-from', s => s.value)) === 'npc-vellmark' && (await A.$eval('#cu-to', s => s.value)) === uidA);
await A.fill('#cu-amt', '1.234,5'); await sleep(150);
check('an amount in another format is understood', /1,234\.50|1\.234,50|1 234,50|1’234\.50/.test(await text(A, '#cu-out .cu-res-a')), await text(A, '#cu-out .cu-res-a'));

/* sorting */
await A.click('.cu-th[data-k="prestige"]'); await sleep(200);
const byP = await A.$$eval('.cu-tbl tbody tr .cu-pb b', els => els.map(e => +e.textContent));
check('the directory sorts by prestige', byP.every((v, i) => !i || byP[i - 1] >= v), byP.join(','));
await A.click('.cu-th[data-k="name"]'); await sleep(200);
const names = await A.$$eval('.cu-tbl tbody tr .cu-dn > :first-child', els => els.map(e => e.textContent.trim().toLowerCase()));
check('and by name', names.join('|') === names.slice().sort().join('|'));

/* history */
await A.click('[data-act="cu-range"][data-v="all"]'); await sleep(300);
await until(async () => !!(await A.$('.cu-chart.rate path.cu-line')));
check('the rate history is charted from the days that exist', !!(await A.$('.cu-chart.rate path.cu-line')) && /4 days/.test(await text(A, '.cu-chart-sum')), await text(A, '.cu-hist'));
const box = await A.$('.cu-chart'); const bb = await box.boundingBox();
await A.mouse.move(bb.x + bb.width * 0.5, bb.y + bb.height * 0.5); await sleep(100);
check('with a tip on hover', /=/.test(await text(A, '.cu-tip')));
await A.click('[data-act="cu-mode"][data-v="pres"]'); await sleep(300);
check('and the prestige history beside it', !!(await A.$('.cu-chart.pres path.cu-line')) && /Currency Prestige of the/.test(await text(A, '.cu-chart-t')));
await A.screenshot({ path: path.join(OUT, 'exchange-1280.png'), fullPage: true });

/* ── no player writes a rate ── */
check('a player cannot write the published rates (not_granted)', (await tryWrite(A, 'fx/meridian', { v: 1, day: 'x', t: 1, j: '{}' })) === 'not_granted');
check('nor a currency’s history', (await tryWrite(A, 'fxh/' + uidA, { d: { '2099-01-01': [999, 100] } })) === 'not_granted');

/* ── designing the currency ── */
await nav(A, 'customise');
await A.click('[data-act="cz-jump"][data-id="cz-sec-c"]');
check('Customise has a Currency section with a live banknote and coin', !!(await A.$('#cz-sec-c .cu-note')) && !!(await A.$('#cz-sec-c .cu-coin')));
await A.fill('#cu-f-nm', 'Aldorian Thaler'); await A.fill('#cu-f-cd', 'ald'); await A.fill('#cu-f-sy', '₮');
await sleep(150);
check('the preview follows as you type', /Aldorian Thaler/.test(await text(A, '#cu-prev')));
await A.click('[data-act="cu-set"][data-f="note.pat"][data-v="waves"]'); await sleep(150);
await A.click('[data-act="cu-set"][data-f="coin.met"][data-v="gold"]'); await sleep(150);
await A.click('[data-act="cu-set"][data-f="note.den"][data-v="500"]'); await sleep(150);
await A.click('#cu-form button[type="submit"]'); await sleep(400);
const na = await localNation(A);
check('saving keeps only what changed, cleaned', na.cur && na.cur.nm === 'Aldorian Thaler' && na.cur.cd === 'ALD' && na.cur.sy === '₮' && na.cur.note.pat === 'waves' && na.cur.note.den === 500 && na.cur.coin.met === 'gold' && !('su' in na.cur), JSON.stringify(na.cur));
check('and the rename goes into the nation’s history', na.log.some(l => l.k === 'cur' && l.a === 'Aldorian Crown' && l.b === 'Aldorian Thaler'));
check('it reaches Firestore with the nation', await until(async () => { const d = await nationDoc(uidA); return d && d.shared && d.shared.cur && d.shared.cur.cd === 'ALD'; }, 10000));
await A.screenshot({ path: path.join(OUT, 'customise-currency-1280.png'), fullPage: false });
await nav(A, 'nation');
check('the nation page shows the currency, its rate and prestige', /Aldorian Thaler/.test(await text(A, '.cu-nsec')) && /ALD/.test(await text(A, '.cu-nsec')) && /Currency prestige/.test(await text(A, '.cu-nsec')) && /1 ALD = /.test(await text(A, '.cu-nsec')));
const before = (await fxDoc()).n[uidA];
check('renaming changed neither the value nor the prestige', before.v === fx.n[uidA].v && before.p === fx.n[uidA].p);
await nav(A, 'census');
check('the Census shows the Bureau’s indicators apart from its scales', /Currency Prestige Rating/.test(await text(A, '.cu-census')) && /Calculated by the Foreign Exchange Bureau/.test(await text(A, '.cu-census')));
await nav(A, 'region'); await sleep(200);
check('the region’s happenings record the rename', /renamed its national currency/.test(await text(A, '#main')));
await A.evaluate(() => document.querySelector('.tbl button.linkish[data-id="npc-vellmark"]').click()); await sleep(300);
check('a computer-run nation’s page shows its currency against yours', /Vellmarker Mark/.test(await text(A, '.cu-nsec-v')) && /1 VLM = [\d.,]+ ALD/.test(await text(A, '.cu-nsec-v')), await text(A, '.cu-nsec-v'));
await A.click('.cu-nsec-v [data-act="cu-open"]'); await sleep(300);
check('and opens the Bureau with the pair chosen', (await A.$eval('#cu-from', s => s.value)) === 'npc-vellmark');
await A.ctx.close();

/* ── on a phone, in the dark ── */
const B = await player('FX-B', { vp: { width: 390, height: 844 }, dark: true });
await open(B); await found(B, 'Bvland');
job(now + DAY);
await B.evaluate(() => localStorage.removeItem('edictum.fx.v1')); // the test publishes tomorrow's rates today
await open(B);
await nav(B, 'exchange');
await until(async () => !!(await B.$('.cu-tbl')));
check('the Bureau fits a phone without sideways scroll', (await noScroll(B)) <= 0);
check('it lists the region’s other player as soon as the region arrives', await until(async () => /Aldorian Thaler/.test(await text(B, '.cu-tbl'))));
check('and a newly founded nation is rated the next day', /Bvlander Crown/.test(await text(B, '.cu-yours')) && !!(await B.$('.cu-yours .cu-big')));
const tgt = await B.$$eval('#main button, #main select, #main input', els => els.filter(e => e.offsetParent && !e.closest('.cz-sr')).map(e => { const r = e.getBoundingClientRect(); return [e.className, Math.round(r.width), Math.round(r.height)]; }).filter(([c, w, h]) => /seg-b|cu-swap|input|btn/.test(c) && Math.min(w, h) < 24));
check('its controls are large enough to touch', !tgt.length, JSON.stringify(tgt.slice(0, 5)));
check('the chart, controls and prestige badges carry text, not only colour', (await B.$$('.cu-pb .cu-pb-t')).length >= 9 && !!(await B.$('[aria-label="Swap the two currencies"]')));
await B.screenshot({ path: path.join(OUT, 'exchange-390.png'), fullPage: true });
await nav(B, 'customise');
await B.click('[data-act="cz-jump"][data-id="cz-sec-c"]'); await sleep(200);
check('so does the currency designer', (await noScroll(B)) <= 0);
await B.screenshot({ path: path.join(OUT, 'customise-currency-390.png') });
await B.ctx.close();

check('no page errors', !errors.length, errors.join(' | '));
await finish();
