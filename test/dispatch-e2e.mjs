// The region's newspaper, round two (emulators): the bar under the masthead and the stars that always include the
// reader; the address of an edition; classified advertisements in sections, with a preview, Reply by letter, Report to
// the moderators, a removal the whole region follows and a Club box the server vouches for; the press office pushing a
// story up the paper for every reader; an edition filed in the archive (papers/) and read back from it; the
// Delegate's name and motto (press/); the phone layout; and the press achievements.
//   npm run test:dispatch
import { check, finish, sleep, until, player, open, found, nav, text, errors, clearEmulators, FS_HOST, PROJECT, OUT, nationDoc } from './lib.mjs';
const shot = (p, name) => p.screenshot({ path: OUT + '/dispatch-' + name + '.png' }).catch(() => {});
const owner = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const docUrl = path => `http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;
const put = (path, fields) => fetch(docUrl(path), { method: 'PATCH', headers: owner, body: JSON.stringify({ fields }) });
const getDoc = async path => { const r = await fetch(docUrl(path), { headers: owner }); return r.status === 200 ? r.json() : null; };
const S = v => ({ stringValue: v }), I = v => ({ integerValue: String(v) });
const EPOCH = Date.UTC(2026, 0, 1), today = () => Math.floor((Date.now() - EPOCH) / 86400000) + 1;
await clearEmulators();

const A = await player('dsp-a', { vp: { width: 1366, height: 900 } }), B = await player('dsp-b', { vp: { width: 1366, height: 900 } });
const ua = await open(A); await found(A, 'Inkhaven');
const ub = await open(B); await found(B, 'Brightquill');
const paper = async p => { await nav(p, 'dispatch'); await p.waitForSelector('.dsp-bar'); };
const ads = p => p.$$eval('.dsp-ad', l => l.map(a => ({ x: a.querySelector('.dsp-ad-x')?.textContent || '', c: a.querySelector('.dsp-ad-c')?.textContent || '', boxed: a.classList.contains('boxed'), off: a.classList.contains('off'), reply: !!a.querySelector('[data-act="dsp-reply"]'), report: !!a.querySelector('[data-act="dsp-report"]') }))).catch(() => []);
const AD = 'WANTED: a second-hand lighthouse, any colour. Will collect.';

/* ── 1. the bar, the stars and the address ── */
await paper(A);
const bar = await A.$$eval('.dsp-bar-b', b => b.map(x => x.childNodes[0].textContent.trim()));
check('the bar under the masthead names every part of the paper', ['Front page', 'Features', 'Classifieds', 'Letters'].every(l => bar.includes(l)), JSON.stringify(bar));
await A.click('.dsp-bar-b[data-to="dsp-cls"]');
check('a part of the paper is a click away', await until(async () => await A.evaluate(() => { const e = document.getElementById('dsp-cls'), r = e.getBoundingClientRect(); return document.activeElement === e && r.top >= 0 && r.top < innerHeight - 100; }), 3000));
check('the stars always read the reader’s own horoscope', /Inkhaven/.test(await text(A, '#dsp-p-stars')));
await A.click(`.dsp-ed[data-no="${today() - 1}"]`);
check('an edition lives in the address', await A.evaluate(() => location.hash) === '#dispatch/' + (today() - 1));
await A.reload(); await A.waitForSelector('.dsp-bar'); const TA = Date.now();
check('and a reload opens that edition', await A.$eval('.dsp-ed.on', b => +b.dataset.no) === today() - 1);
await A.click(`.dsp-ed[data-no="${today()}"]`);
check('today’s is plain #dispatch', await A.evaluate(() => location.hash) === '#dispatch');

/* ── 2. classified advertisements ── */
check('the form waits behind a button', !(await A.$('#dsp-ad-form')) && !!(await A.$('[data-act="dsp-adopen"]')));
await A.click('[data-act="dsp-adopen"]');
await A.click('.dsp-adc-o:has(input[value="want"])');
await A.fill('#dsp-ad', AD);
check('the preview shows the advertisement as readers will see it, in its section', await text(A, '#dsp-ad-pv-x') === AD && await text(A, '#dsp-ad-pv .dsp-ad-c') === 'Wanted');
check('a reader who is not in the Club is told about the box', /Members of the Chancery Club can print theirs boxed/.test(await text(A, '#dsp-ad-form')));
await shot(A, 'ad-form');
const goods0 = await A.evaluate(() => G.S.nation.stock && G.S.nation.stock.goods);
await A.click('#dsp-ad-form button[type="submit"]');
await until(() => A.evaluate(() => (G.S.nation.dsp?.ads || []).length === 1));
const myAd = await A.evaluate(() => G.S.nation.dsp.ads[0]);
check('the advertisement is placed in its section, for six goods', myAd && myAd.c === 'want' && myAd.x === AD, JSON.stringify(myAd));
check('and the section chips count it', /Wanted\s*1/.test(await text(A, '.dsp-cats')), await text(A, '.dsp-cats'), goods0);
await until(async () => { const d = await nationDoc(ua); return d && d.rec && (d.rec.dsp?.ads || []).length === 1; }, 15000);
await paper(B);
check('another reader sees it under Wanted, with Reply and Report', await until(async () => (await ads(B)).some(a => a.x === AD && a.c === 'Wanted' && a.reply && a.report), 20000), JSON.stringify(await ads(B)));
await B.click('[data-act="dsp-cat"][data-c="want"]');
check('a section chip shows that section alone', (await ads(B)).every(a => a.c === 'Wanted'));
await B.click('[data-act="dsp-cat"][data-c=""]');
await B.click(`.dsp-ad:has-text("lighthouse") [data-act="dsp-report"]`);
await B.waitForSelector('dialog.ed-dlg[open]');
await B.click('input[name="ed-reason"][value="spam"]');
await B.click('[data-ed="report-yes"]');
const rep = await until(async () => { const r = await fetch(docUrl('reports') + '?pageSize=50', { headers: owner }); const b = await r.json(); return (b.documents || []).find(d => d.fields.post && d.fields.post.stringValue === `ad:meridian:${ua}:${myAd.i}`); }, 10000);
check('Report sends the advertisement to the moderators’ queue', !!rep && rep.fields.kind.stringValue === 'post' && rep.fields.target.stringValue === ua && /lighthouse/.test(rep.fields.x.stringValue));
await B.click(`.dsp-ad:has-text("lighthouse") [data-act="dsp-reply"]`);
check('Reply starts a letter to the advertiser, quoting the advertisement', await until(async () => await B.evaluate(() => G.S.view) === 'messages' && /^About your advertisement in The Daily Dispatch: “WANTED: a second-hand lighthouse/.test(await B.$eval('#dm-text', t => t.value).catch(() => ''))));
await B.evaluate(() => { G.S.msgDraft = ''; });
/* the Club box: only what the server vouches for (finery bx) */
await A.evaluate(() => { const n = G.clone(G.S.nation); n.dsp.ads[0].bx = 1; G.commit(n); G.PG.saveSoon(); });
await until(async () => { const d = await nationDoc(ua); return d && d.rec && d.rec.dsp?.ads?.[0]?.bx === 1; }, 15000);
await paper(B); await sleep(500);
check('a box nobody vouches for is printed plain', (await ads(B)).some(a => a.x === AD && !a.boxed));
await put('finery/' + ua, { c: { arrayValue: { values: [] } }, reg: S('meridian'), bx: I(Date.now() + 30 * 86400000) });
check('a Club member’s box shows once the server vouches for it', await until(async () => (await ads(B)).some(a => a.x === AD && a.boxed), 10000));
await shot(B, 'boxed');
/* the moderators strike it out (functions/admin.js writes press/<region>.x) */
await put('press/meridian', { x: { mapValue: { fields: { [ua + '_' + myAd.i]: I(Date.now()) } } } });
await B.evaluate(() => G.DSP().pressLoad(true)); await A.evaluate(() => G.DSP().pressLoad(true));
check('a removed advertisement goes from every reader’s paper', await until(async () => !(await ads(B)).some(a => a.x === AD), 8000));
await paper(A);
check('and its advertiser is told the moderators removed it', await until(async () => (await ads(A)).some(a => a.x === AD && a.off), 8000) && /The moderators removed this advertisement/.test(await text(A, '.dsp-cls')));
check('a removed advertisement no longer counts as running', /0 of 2 running/.test(await text(A, '.dsp-adopen')));

/* ── 3. the press office ── */
await paper(A);
check('the press office lists today’s stories about the reader', await until(async () => (await A.$$('.dsp-po [data-act="dsp-po"][data-k="u"]')).length > 0, 5000), await text(A, '.dsp-po'));
const key = await A.evaluate(() => { const b = [...document.querySelectorAll('.dsp-po [data-act="dsp-po"][data-k="u"]')].find(b => !b.disabled); return b ? b.dataset.key : ''; });
const md0 = await A.evaluate(() => G.GV().md(G.S.nation, Date.now()));
await A.click(`.dsp-po [data-act="dsp-po"][data-k="u"][data-key="${key}"]`);
check('a push costs mandate and is kept in the record', await until(() => A.evaluate(k => (G.S.nation.dsp.p || []).some(e => e[1] === 'u' && e[2] === k), key)) && md0 - await A.evaluate(() => G.GV().md(G.S.nation, Date.now())) > 1.9);
check('the pushed story leads the paper', await A.evaluate(k => G.DSP().dspEdition(G.DSP().dspNoOf(Date.now()), Date.now()).lead?.k === k, key));
check('the office waits until tomorrow', /again tomorrow/.test(await text(A, '.dsp-po')) && !(await A.$('.dsp-po [data-act="dsp-po"]')));
await until(async () => { const d = await nationDoc(ua); return d && d.rec && (d.rec.dsp?.p || []).length > 0; }, 15000);
check('every reader gets the same lead', await until(() => B.evaluate(k => G.DSP().dspEdition(G.DSP().dspNoOf(Date.now()), Date.now()).lead?.k === k, key), 15000));

/* ── 4. the paper's name (functions/civic.js, paper, writes press/<region>) ── */
await put('press/meridian', { nm: S('The Meridian Messenger'), mo: S('Wet ink, dry wit'), by: S(ua), bn: S('Inkhaven'), t: I(Date.now()), x: { mapValue: { fields: { [ua + '_' + myAd.i]: I(Date.now()) } } } });
await B.evaluate(() => G.DSP().pressLoad(true)); await paper(B);
check('the Delegate’s name and motto head the paper', await until(async () => await text(B, '#dsp-title') === 'The Meridian Messenger' && /Wet ink, dry wit/.test(await text(B, '.dsp-motto')), 8000));
check('signed by the Delegate who chose them', /Named by Inkhaven, Delegate of the Regional Assembly/.test(await text(B, '.dsp-named')));
check('and the bell says so too', await B.evaluate(() => G.DSP().dspTitle()) === 'The Meridian Messenger');
await shot(B, 'named');

/* ── 5. the archive ── */
const no = new Date().getUTCHours() >= 1 ? today() - 1 : today() - 2;
const wait = 47000 - (Date.now() - TA); if (wait > 0) await sleep(wait);
/* reader A read the press doc before it was named (it rereads it every 5 minutes): let it hear the name first, as
   in the hour after midnight UTC it is A that files the edition, the one before yesterday's */
await until(() => A.evaluate(() => { const D = G.DSP(); if (D.dspTitle() !== 'The Meridian Messenger') D.pressLoad(true); return D.dspTitle() === 'The Meridian Messenger'; }), 8000);
await paper(A); await A.click(`.dsp-ed[data-no="${no}"]`);
const filed = await until(() => getDoc(`papers/meridian_${no}`), 30000, 500);
let packed = null; try { packed = filed && JSON.parse(filed.fields.j.stringValue); } catch (e) {}
check('a closed edition is filed in the archive by its first reader', !!filed && [ua, ub].includes(filed.fields.by.stringValue) && +filed.fields.no.integerValue === no && packed && packed.v === 1, filed ? '' : JSON.stringify(await A.evaluate(no => { const D = G.DSP(), n = G.S.nation; return { no, st: D.dspPaperState(no), can: D.dspCanFreeze(no, Date.now()), mode: G.S.mode, reg: n.reg, cb: [D.DSP_CB.reg, D.DSP_CB.at], papers: [...D.PAPERS].map(([k, v]) => [k, v.st, v.tried]) }; }, no)));
check('the filed copy keeps the paper’s name and its stories, not the advertisements', !!packed && packed.title === 'The Meridian Messenger' && Array.isArray(packed.secs) && !('ads' in packed));
await paper(B); await B.click(`.dsp-ed[data-no="${no}"]`);
check('another reader reads that edition from the archive', await until(async () => /from the archive/.test(await text(B, '.dsp-live')), 15000), await text(B, '.dsp-live'));
await B.selectOption('#dsp-bk', String(today() - 30));
check('a back issue nobody filed says so', await until(async () => /was not kept/.test(await text(B, '.dsp-arch')), 8000));
check('and the address follows', await B.evaluate(() => location.hash) === '#dispatch/' + (today() - 30));

/* ── 6. a phone ── */
await B.setViewportSize({ width: 390, height: 844 }); await B.click(`.dsp-ed[data-no="${today()}"]`); await sleep(400);
const secs = await B.$$eval('.dsp-sec', l => l.map(s => s.classList.contains('shut')));
check('on a phone the sections fold, the first one open', secs.length > 1 && !secs[0] && secs.slice(1).every(Boolean), JSON.stringify(secs));
check('and the features are tabs', !!(await B.$('.dsp-tabs [role="tab"]')) && await B.$$eval('#dsp-side .dsp-box', l => l.filter(b => getComputedStyle(b).display !== 'none').length) === 1);
const folded = await B.$$eval('.dsp-sec.shut [data-act="dsp-sec"]', l => l.map(b => b.dataset.k));
if (folded.length) { await B.click(`.dsp-bar-b[data-to="dsp-s-${folded[0]}"]`);
  check('the bar opens a folded section on the way', await B.$eval(`#dsp-s-${folded[0]}`, h => !h.closest('.dsp-sec').classList.contains('shut'))); }
check('nothing on the page is wider than the phone', await B.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await shot(B, 'phone');

/* ── 7. the press achievements ── */
check('placing an advertisement and pushing a story earn their achievements', await until(() => A.evaluate(() => !!(G.S.nation.ach && G.S.nation.ach['press-ad'] && G.S.nation.ach['press-spin'])), 15000));
check('the achievements page has a section for the press', await A.evaluate(() => { location.hash = '#achievements'; return true; }) && await until(async () => /The press/.test(await text(A, 'main')), 5000));

await finish();
