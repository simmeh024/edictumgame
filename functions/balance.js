// The balance page of the admin portal: the game as it is actually played, counted from the rows functions/stats.js
// builds for the Statistics page. No database and no packages, so it can be tested on its own (test/admin-portal.test.mjs).
/* The game as it is actually played, for whoever tunes it: how big nations are at each age, how far along the long road
   they get, which buildings are ever built, how each edict is answered and which laws stay in force. It reads the same
   ten-minute gather the Statistics page uses, so opening it beside Statistics costs nothing extra. */
const BAL_AGES = [[0, 1, 'First day'], [1, 3, 'Days 1–3'], [3, 7, 'Days 3–7'], [7, 14, 'Weeks 1–2'], [14, 30, 'Weeks 2–4'], [30, 90, 'Months 1–3'], [90, Infinity, 'Over 3 months']];
const share = (a, b) => b ? Math.round(1000 * a / b) / 10 : 0;
const mid = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2); };
const quart = (a, q) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q * a.length))] : 0;
/* the counting itself, over the rows as functions/stats.js builds them: no database, so it can be tested on its own */
export function balanceOf(rows, at) {
  const now = at || Date.now(), day = 86400000;
  const ages = BAL_AGES.map(([from, to, label]) => {
    const R = rows.filter(r => r.founded && (now - r.founded) / day >= from && (now - r.founded) / day < to);
    const pops = R.map(r => Number(r.pop) || 0);
    return { label, n: R.length, pop: mid(pops), lo: quart(pops, .25), hi: quart(pops, .75),
      cities: mid(R.map(r => r.cities || 0)), claims: mid(R.map(r => r.claims || 0)), ruled: mid(R.map(r => r.dec || 0)) };
  });
  const tally = pick => { const o = {}; for (const r of rows) for (const k of pick(r) || []) o[k] = (o[k] || 0) + 1; return o; };
  const sorted = (o, keep = 200) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, keep).map(([k, n]) => ({ k, n, pct: share(n, rows.length) }));
  /* every edict answered within the fortnight the rows keep, and how its options were picked */
  const E = new Map();
  for (const r of rows) for (const a of r.ans || []) {
    const eid = a[1], o = a[2], e = E.get(eid) || { k: eid, n: 0, skip: 0, opts: [] };
    e.n++;
    if (o < 0) e.skip++; else e.opts[o] = (e.opts[o] || 0) + 1;
    E.set(eid, e);
  }
  const edicts = [...E.values()].map(e => ({ k: e.k, n: e.n, skip: e.skip, opts: Array.from(e.opts, v => v || 0) }))
    .sort((a, b) => b.n - a.n).slice(0, 400);
  return { at: now, nations: rows.length, ages, edicts,
    reach: sorted(tally(r => [...new Set((r.f || []).concat(r.f2 || []))])),
    ach: sorted(tally(r => r.ach), 400), laws: sorted(tally(r => r.pol), 400),
    built: sorted(tally(r => [...new Set((r.bld || []).map(b => b[0]))])) };
}
