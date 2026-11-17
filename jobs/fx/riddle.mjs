// The riddle of the week: every Monday at 08:00 UTC each region gets a riddle that points at one hex of its map, and
// last week's riddle gets its answer (functions/riddle-rules.js has the data's shape; functions/riddles.js takes the
// guesses). The map is the game's own, generated here with the build's map baker from game/edictum.html, so a riddle
// speaks of the same ground, landmasses and computer capitals the players see.
//
//   node riddle.mjs --project <project id>                 # every region; a region that has this week's is skipped
//   node riddle.mjs --project demo-edictum --region meridian --now <ms>
//
// .github/workflows/riddle.yml runs it every Monday. It prints a JSON report and exits 1 if a region failed.
//
// A riddle counts hexes from the capital of one of the region's computer nations, names a direction and the ground,
// and adds what it must until exactly one hex fits: how many neighbours are of some ground, a seam of iron. Only what
// the map keeps for good is used (no borders, no coast, which reclaimed land can move). The direction is read
// generously: the answer lies within 12° of the line it names, and no other hex within 34° fits every line.
import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { mapKit } from '../../scripts/bake-maps.mjs';
import { loadWorld } from './world.mjs';
import { RD_DIRS, RD_TRIES, RD_WEEK, rdWeek, rdId } from '../../functions/riddle-rules.js';

const GAME = new URL('../../game/edictum.html', import.meta.url);
const line = (src, re, what) => { const m = src.match(re); if (!m) throw new Error('jobs/fx/riddle.mjs: the game no longer has ' + what); return m[0]; };
const RING = [3, 8], NEAR = 12, WIDE = 34;

/* the map of a region as the game draws it, with the words the game uses for its ground */
export function regionGeo(src, reg) {
  const kit = mapKit(src, reg, {}, true), M = kit.generate();
  const hexDist = new Function('MAP', line(src, /^function hexDist\(a,b\)\{[^\n]+/m, 'function hexDist') + ';return hexDist;')(M);
  const BIOME_NAME = new Function(line(src, /^const BIOME_NAME=\[[^\n]+\];/m, 'BIOME_NAME') + ';return BIOME_NAME;')();
  const TERRAIN = new Function(line(src, /^const TERRAIN=\[[^\n]+\];/m, 'TERRAIN') + ';return TERRAIN;')();
  const terr = c => (M.T[c] >= 2 ? BIOME_NAME[kit.BIOME[c]] : '') || TERRAIN[M.T[c]];
  const land = c => { const k = M.comp[c]; return k >= 0 && M.comps[k] && M.comps[k].name ? M.comps[k].name : ''; };
  return { M, hexDist, terr, land, iron: c => kit.IRON_DEP[c] > 0 };
}
/* the bearing from a to b in degrees, anticlockwise from east, north up, across the map's seam the short way */
export function bearing(M, a, b) {
  let dx = M.cx[b] - M.cx[a]; const dy = M.cy[b] - M.cy[a];
  if (dx > M.W / 2) dx -= M.W; else if (dx < -M.W / 2) dx += M.W;
  return (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360;
}
const off = (deg, i) => { const d = Math.abs(deg - i * 45) % 360; return Math.min(d, 360 - d); };
/* the hexes at exactly r steps from a */
function ring(M, a, r) {
  let front = [a]; const seen = new Set([a]);
  for (let d = 0; d < r; d++) { const nx = []; for (const c of front) for (let k = 0; k < 6; k++) { const j = M.nbr[c * 6 + k]; if (j >= 0 && !seen.has(j)) { seen.add(j); nx.push(j); } } front = nx; }
  return front;
}
const around = (M, c) => { const o = []; for (let k = 0; k < 6; k++) { const j = M.nbr[c * 6 + k]; if (j >= 0) o.push(j); } return o; };
const art = w => /^[aeiou]/i.test(w) ? 'an' : 'a';

/* one riddle for a region: {c (the answer), cap, r, dir, lines}, or null if none could be made. rng(n) gives 0..n-1. */
export function makeRiddle(geo, npcs, rng = n => randomInt(n)) {
  const { M, terr, land, iron } = geo, isLand = c => M.T[c] >= 2;
  const caps = npcs.map(x => ({ id: x.id, name: x.name, c: M.npcLoc && M.npcLoc[x.id] })).filter(x => Number.isInteger(x.c) && x.c >= 0);
  if (!caps.length) return null;
  for (let tries = 0; tries < 3000; tries++) {
    const cap = caps[rng(caps.length)], r = RING[0] + rng(RING[1] - RING[0] + 1), cells = ring(M, cap.c, r).filter(isLand);
    const near = cells.filter(c => { const b = bearing(M, cap.c, c), i = Math.round(b / 45) % 8; return off(b, i) <= NEAR; });
    if (!near.length) continue;
    const c = near[rng(near.length)], b = bearing(M, cap.c, c), di = Math.round(b / 45) % 8;
    /* every hex a generous reader might take for "r hexes to the <dir>", then each line in turn */
    let S = cells.filter(x => off(bearing(M, cap.c, x), di) <= WIDE);
    const t = terr(c); S = S.filter(x => terr(x) === t);
    const extra = [];
    if (S.length > 1) {
      /* how many of its neighbours are of some ground: the count that leaves the fewest */
      let best = null;
      for (const g of new Set(around(M, c).map(terr))) {
        if (!g || g === 'Reclaimed land' || g === 'Ocean' || g === 'Shallow sea') continue;
        const k = around(M, c).filter(x => terr(x) === g).length, T = S.filter(x => around(M, x).filter(y => terr(y) === g).length === k);
        if (!best || T.length < best.S.length) best = { g, k, S: T };
      }
      if (best && best.S.length < S.length) { S = best.S; extra.push({ nb: best.g, k: best.k }); }
    }
    if (S.length > 1) { const fe = iron(c); const T = S.filter(x => iron(x) === fe); if (T.length < S.length) { S = T; extra.push({ iron: fe }); } }
    if (S.length !== 1 || S[0] !== c) continue;
    const lm = land(c), lines = [`From the capital of ${cap.name}, count ${r} hexes to the ${RD_DIRS[di]}.`,
      `My ground is ${t.toLowerCase()}${lm ? `, on ${lm}` : ''}.`];
    for (const x of extra) {
      if (x.nb) lines.push(x.k === 0 ? `Not one of my six neighbours is ${x.nb.toLowerCase()}.` : x.k === 6 ? `All six of my neighbours are ${x.nb.toLowerCase()}.` : `${['', 'One', 'Two', 'Three', 'Four', 'Five'][x.k]} of my six neighbours ${x.k === 1 ? 'is' : 'are'} ${x.nb.toLowerCase()}.`);
      if ('iron' in x) lines.push(x.iron ? 'A great seam of iron runs beneath me.' : 'No great seam of iron runs beneath me.');
    }
    return { c, cap: cap.id, r, dir: RD_DIRS[di], lines };
  }
  return null;
}
/* the hexes that fit a riddle's lines as a reader would take them (the tests check there is exactly one) */
export function solve(geo, npcs, R) {
  const { M, terr, iron } = geo, cap = M.npcLoc[R.cap], di = RD_DIRS.indexOf(R.dir);
  const g = R.lines.map(l => /^My ground is (.+?)(?:, on .+)?\.$/.exec(l)).find(Boolean), t = g ? g[1] : '';
  return ring(M, cap, R.r).filter(x => M.T[x] >= 2 && off(bearing(M, cap, x), di) <= WIDE && terr(x).toLowerCase() === t && R.lines.every(l => {
    let m = /^(Not one|All six|One|Two|Three|Four|Five) of my (?:six )?neighbours (?:is|are) (.+)\.$/.exec(l);
    if (m) { const k = { 'Not one': 0, 'All six': 6, One: 1, Two: 2, Three: 3, Four: 4, Five: 5 }[m[1]]; return around(M, x).filter(y => terr(y).toLowerCase() === m[2]).length === k; }
    if (/^A great seam of iron/.test(l)) return iron(x);
    if (/^No great seam of iron/.test(l)) return !iron(x);
    return true;
  }));
}

/* this week's riddle for each region that has none yet, and last week's answer for each that has not been told */
export async function publish(db, { now = Date.now(), regions, src = readFileSync(GAME, 'utf8'), rng } = {}) {
  const { Timestamp } = await import('firebase-admin/firestore');
  const W = loadWorld(src), want = regions && regions.length ? new Set(regions) : null, wk = rdWeek(now), reports = [];
  for (const R of W.regions) {
    if (want && !want.has(R.id)) continue;
    const id = rdId(R.id, now), prev = rdId(R.id, wk - 1), rep = { region: R.id, id };
    try {
      const [cur, last, lastKey] = await db.getAll(db.doc('riddles/' + id), db.doc('riddles/' + prev), db.doc('riddleKeys/' + prev));
      if (last.exists && lastKey.exists && !Number.isInteger(last.get('a'))) { await last.ref.update({ a: lastKey.get('c') }); rep.revealed = prev; }
      if (cur.exists) { rep.skipped = 'already set'; reports.push(rep); continue; }
      const geo = regionGeo(src, R.id), Q = makeRiddle(geo, R.npcs || [], rng);
      if (!Q) throw new Error('no riddle could be made');
      const b = db.batch(), d = new Date(wk);
      b.create(db.doc('riddles/' + id), { reg: R.id, wk: d.toISOString().slice(0, 10), t: wk, x: wk + RD_WEEK, q: Q.lines, cap: Q.cap, n: 0, top: [], tu: [], tries: RD_TRIES, v: 1 });
      b.create(db.doc('riddleKeys/' + id), { c: Q.c, cap: Q.cap, r: Q.r, dir: Q.dir, t: Timestamp.fromMillis(now) });
      await b.commit();
      rep.made = Q.lines.length;
    } catch (e) { rep.error = e && e.message; }
    reports.push(rep);
  }
  return { at: now, week: new Date(wk).toISOString(), reports };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const projectId = opt('--project') || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
  if (!projectId) { console.error('riddle.mjs: name the project with --project <id>'); process.exit(2); }
  const regions = args.flatMap((a, i) => (a === '--region' ? [args[i + 1]] : []));
  const emulated = !!process.env.FIRESTORE_EMULATOR_HOST;
  if (emulated) process.env.METADATA_SERVER_DETECTION = 'none';
  initializeApp(emulated ? { projectId } : { projectId, credential: applicationDefault() });
  const report = await publish(getFirestore(), { now: Number(opt('--now')) || Date.now(), regions });
  console.log(JSON.stringify(report, null, 1));
  process.exit(report.reports.some(r => r.error) ? 1 : 0);
}
