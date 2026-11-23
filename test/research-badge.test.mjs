// The Research Lab's badge (game/edictum.html, "the badge: what has finished since the player last looked"): which
// entries of the scientific record it tells of, in what words the bell does, and the pieces wired in (the menu's
// count, the tick, the tab flip, the bell, Settings › Notifications, the bell's link).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
const SEC = cut('/* ── the badge: what has finished since the player last looked', "/* ── the admin's Statistics › Research tab");

function load() {
  const ctx = {
    S: { nation: null, view: 'nation' }, OBS: false, DAY: 864e5, NOTIF_SOURCES: [], NTF_GROUPS: [], NVX: { ver: 0 }, RSU: { tab: 'overview' },
    RS: [{ n: 'Domestic Markets', h: 0 }, { n: 'Steam Power', h: 6 }],
    RS_LAB: [['Foundations and infrastructure'], ['The main building'], ['Laboratories'], ['The library'], ['The inauguration']],
    RS_INST: [[0, 0, 0], ['x', 20, 3]], RS_CH: { accel: { n: 'The Great Accelerator', st: 5 } },
    rsInstName: (n, l) => l === 1 ? 'the Selenian Research Institute' : 'the laboratory', rsFxLine: r => 'Goods +1%.',
    rsOf: n => n && n.nrp || null, rsPlaced: n => !!(n && n.nrp && n.nrp.c >= 0),
    nvxCompute: () => ({}), nvxGet: () => ({}), rsShow: () => {}, dlPlan: () => null, nvxSeen: () => ctx.seen, nvxSave() {}, render() {},
    seen: { t0: 0, p: {} }, document: { querySelector: () => null }, Date, Math
  };
  vm.createContext(ctx);
  vm.runInContext(SEC.replace(/^const /gm, 'var '), ctx);
  return ctx;
}

test('it tells of a study ended and a stage finished, not of a technology bought outright', () => {
  const G = load(), t = Date.now();
  assert.equal(G.rsbTold([t, 'd', 1, 50]), true, 'a study (Tier V on) ended');
  assert.equal(G.rsbTold([t, 'd', 0, 2]), false, 'a technology bought outright');
  for (const k of ['b', 'x', 'cs']) assert.equal(G.rsbTold([t, k, 0, 1]), true, k);
  for (const k of ['s', 'i', 'c', 'g', 'p', 'f', 'a', 'l', 'lc', 'm']) assert.equal(G.rsbTold([t, k, 0, 1]), false, k);
});

test('the bell, in the toasts’ words; what opens something is left to the history’s own notices', () => {
  const G = load(), n = { name: 'Selenia', nrp: {} }, t = Date.now();
  assert.deepEqual([...G.rsbBell(n, [t, 'd', 1, 50])], ['rsd', 'Discovery: Steam Power. Goods +1%.']);
  assert.deepEqual([...G.rsbBell(n, [t, 'b', 0, 0])], ['rsw', 'Foundations and infrastructure is finished. Next: the main building.']);
  assert.equal(G.rsbBell(n, [t, 'b', 4, 0]), null, 'the fifth stage is the inauguration (rsi)');
  assert.deepEqual([...G.rsbBell(n, [t, 'x', 1, 2])], ['rsw', 'A stage of the Selenian Research Institute is finished (2 of 3).']);
  assert.equal(G.rsbBell(n, [t, 'x', 1, 3]), null, 'the last stage opens the institution (rsx)');
  assert.deepEqual([...G.rsbBell(n, [t, 'cs', 'accel', 4])], ['rsw', 'The Great Accelerator: stage 4 of 5 is finished.']);
  assert.equal(G.rsbBell(n, [t, 'cs', 'accel', 5]), null, 'the last stage completes it (rsc)');
  /* the bell's source: the last fortnight, a link to the tab */
  n.nrx = { h: [[t - 1000, 'd', 1, 50], [t - 2000, 'd', 0, 2], [t - 3000, 'b', 0, 0], [t - 20 * 864e5, 'b', 1, 0]] };
  const ev = G.NOTIF_SOURCES[0](n);
  assert.deepEqual([...ev].map(x => [x.k, x.go, x.dl, x.kl]), [['rsd', 'research', 'rs:overview', 'National Research'], ['rsw', 'research', 'rs:lab', 'National Research']]);
});

test('the menu counts each since its tab was last open, and the site still to choose', () => {
  const G = load(), t = Date.now();
  G.seen = { t0: t - 10 * 864e5, p: { 'rs.overview': t - 5000, 'rs.lab': t - 1500 } };
  const n = { nrp: {}, nrx: { h: [[t - 1000, 'd', 1, 50], [t - 2000, 'b', 0, 0], [t - 3000, 'd', 1, 50], [t - 4000, 'd', 0, 2], [t - 9000, 'd', 1, 50]] } };
  G.S.nation = n;
  const o = G.nvxCompute(n, t).research;
  /* two studies since the Overview was open (not the one bought, not the older one); the stage came before the Laboratory was */
  assert.equal(o.k, 3, JSON.stringify(o));
  assert.deepEqual([...o.w], ['a site to choose for the laboratory', '2 new discoveries']);
  assert.deepEqual([...o.at].map(a => a.sel), ['#rs-tab-lab', '#rs-tab-overview']);
  /* placed: the site no longer counts; destroyed: it is to be rebuilt */
  n.nrp.c = 4;
  assert.equal(G.nvxCompute(n, t).research.k, 2);
  delete n.nrp.c; n.nrp.rz = t;
  assert.deepEqual([...G.nvxCompute(n, t).research.w].slice(0, 1), ['the laboratory to rebuild']);
});

test('wired in: the tick, the tab flip, the page, Settings › Notifications and the bell’s link', () => {
  assert.match(SEC, /nvxCompute=\(f=>function\(n,now\)/);
  assert.match(SEC, /nvxGet=\(f=>function\(n\)\{try\{if\(n&&n===S\.nation\)rsbTouch\(Date\.now\(\)\);/);
  assert.match(SEC, /rsShow=\(f=>function\(t\)/);
  assert.match(SEC, /dlPlan=\(f=>function\(spec\)\{const m=typeof spec==='string'&&\/\^rs:\(overview\|lab\)\$\/\.exec\(spec\)/);
  assert.match(src, /VIEWS_EXT\.research=now=>\{try\{rsbTouch\(now\|\|Date\.now\(\)\);\}catch\(e\)\{\}return rsView\(now\);\};/);
  assert.match(src, /\['research','Research: discoveries and finished works',\['rsd','rsw','rsi','rsx','rsc'\]\]\];/, 'in NTF_GROUPS itself, so a muted Research is kept at load');
  assert.match(src, /<section class="section rs-box" id="rs-recent"><h2 class="h2">Recent discoveries<\/h2>/);
  assert.match(src, /e\[0\]>fr&&rsbTold\(e\)\?' <span class="cz-new rs-new">New<\/span>'/);
  /* before the military buildings' section, which its test runs on its own */
  assert.ok(src.indexOf('/* ── the badge: what has finished') < src.indexOf('/* ───────── military buildings (22 November 2026)'));
});
