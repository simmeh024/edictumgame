/* The National Research Programme (game/edictum.html, "the National Research Programme"): what the server holds a
   nation's research to. The game keeps the same tables (RS_RULES and the catalogue RS_DATA it is built from), and
   test/research.test.mjs checks that the two copies agree.

   A nation's research lives in the shared record as n.nrp (docs/research.md has every field). The parts that matter
   here:
     k   the technologies researched, a bitset of 360 (index = track * 120 + (tier - 1) * 5 + slot, slot 0 the tier's
         milestone), as 60 characters of base64url
     re  Research Credits earned in all, rs spent in all (the balance is re - rs), ra the time they were counted to,
         i   the laboratory's inauguration (credits accrue from then), l the institution's level (0 to 8)
     q   studies under way [[index, start, end, paid, halved]], one per track, for technologies of tier V and above
     ap  credits pledged to an alliance's research project [{t, a, q}]
     gr  the one-off grants received ('f': the Founding Research Grant)
   Field Notes (the outfitters' Field naturalists refitted at tier II, 2026-11-23) add credits for each first find a save
   adds (rsFieldNotes), as many as the line's tier II blocks.
   functions/civic.js (permit) calls rsSettle on every save before it approves it, by the server's clock:
     - research is never lost: a technology, study or credit the saved record held stays;
     - credits earned grow no faster than the most the record's own figures allow (rsRateMax: its Science &
       Technology, its institution, its technologies, and the most international cooperation can add), from the
       time they were last counted to the server's time; a new grant counts once;
     - a new technology must follow its prerequisites and its tier's gates, and be paid for: credits spent must grow
       by at least its price less the most any discount allows (RS_DISC_MAX); one of tier V or above must come from a
       study the saved record already held, finished by the server's time;
     - a study must start no earlier than the saved record, last at least RS_Q_MIN of its full time (emergency funding
       halves what is left of it, and the research edicts make studies shorter or longer: RS_Q_MIN and RS_Q_MAX bound
       what all of them together may do), and be paid for when it starts; a study held may end sooner or later within
       those bounds, never before RS_Q_MIN of its full time from its start;
     - the institution rises one level at a time, and only as far as the research allows.
   What the save asked that the rules do not allow is taken back, and rsSettle says what it kept: the game takes that
   back too (edictum:saved, detail.rs). */
export const DAY = 86400000, HOUR = 3600000;
export const RS_TRACKS = ['t', 'g', 'w'];
export const RS_TIERS = 24, RS_PER = 5, RS_TRACK_N = 120, RS_N = 360;
/* the average price of a technology in each tier, and tier I's five */
export const RS_AVG = [5, 8, 12, 18, 25, 35, 48, 65, 85, 110, 140, 175, 220, 275, 340, 420, 480, 550, 630, 720, 820, 930, 1050, 1200];
export const RS_T1 = [10, 2, 3, 4, 6];
/* a tier's four supporting technologies at these shares of its average; the milestone (slot 0) takes the rest */
export const RS_MUL = [0, 0.7, 0.85, 1, 1.05];
/* studies: hours a technology of each era takes once paid for (tiers I to IV at once), half as long again for a milestone */
export const RS_ERA_HOURS = [0, 2, 6, 12, 24, 36];
/* the most every international discount together takes off a price, and the most international cooperation adds to
   the credits earned */
export const RS_DISC_MAX = 0.25, RS_INTL_MAX = 0.3;
/* daily credits each institution adds (the National Research Laboratory first), and its name's level */
export const RS_INST_BONUS = [0, 10, 20, 35, 50, 75, 110, 155, 230];
/* one-off grants, each received once: f the Founding Research Grant at the inauguration, a to d answers to Letters from the
   Laboratory (the game's RS_GRANTS) */
export const RS_GRANTS = { f: 12, a: 15, b: 20, c: 30, d: 40 };
/* Field Notes: credits for each first find a save adds (n.disc entries marked f, beyond the saved record's), as many as
   the line's tier II blocks (n.xl.nat 'notes', n.x2.nat 1 to 5), for at most RS_FN_MAX finds in one save */
export const RS_FN_MAX = 3;
export function rsFieldNotes(n, before) {
  if (!n || !n.xl || n.xl.nat !== 'notes') return 0;
  const b = Math.max(0, Math.min(5, Math.floor(num(n.x2 && n.x2.nat))));
  if (!b) return 0;
  const firsts = d => (Array.isArray(d && d.disc) ? d.disc : []).filter(e => e && e.f && (e.o === 'found' || e.o === 'great')).length;
  return b * Math.max(0, Math.min(RS_FN_MAX, firsts(n) - firsts(before)));
}
/* what a save's clock may be ahead of the server's, and what rounding may leave over */
export const RS_SKEW = 120000, RS_EPS = 0.5;
/* technologies of another track a technology needs (lower tiers only), the Grand Challenge one needs, and the
   catalogue's credits a day and readiness (generated from the game's RS_DATA; the test checks them) */
export const RS_X = { 50: [135], 91: [190], 155: [255], 160: [16], 170: [28], 255: [125], 265: [15], 290: [48], 295: [48], 305: [175] };
export const RS_C = { 90: 'accel', 105: 'finctr', 200: 'infra', 205: 'medctr', 215: 'unicity', 235: 'heritage', 320: 'infra', 330: 'accel' };
export const RS_RC = { 48: 1, 50: 1, 51: 1, 91: 2, 115: 3, 117: 2, 171: 1, 190: 1, 191: 1, 210: 2, 211: 1, 214: 1, 235: 3 };
export const RS_READY = { 241: 0.01, 244: 0.005, 252: 0.01, 254: 0.005, 262: 0.005, 263: 0.005, 266: 0.005, 268: 0.01, 270: 0.01, 273: 0.005, 274: 0.005, 282: 0.005, 292: 0.005, 295: 0.01, 297: 0.005, 301: 0.005, 304: 0.005, 306: 0.005, 310: 0.01, 313: 0.005, 327: 0.005, 330: 0.01, 333: 0.005, 339: 0.005, 343: 0.005, 344: 0.005, 348: 0.005, 357: 0.01 };
export const RS_RMAX = { 335: 1 };
export const RS_CHALLENGES = ['accel', 'medctr', 'infra', 'acad', 'unicity', 'finctr', 'heritage', 'legacy'];

export const num = v => typeof v === 'number' && isFinite(v) ? v : 0;
export const rsIdx = (k, tier, slot) => k * RS_TRACK_N + (tier - 1) * RS_PER + slot;
export const rsTrack = i => Math.floor(i / RS_TRACK_N);
export const rsTier = i => Math.floor((i % RS_TRACK_N) / RS_PER) + 1;
export const rsSlot = i => i % RS_PER;
export const rsEra = tier => Math.floor((tier - 1) / 4);
/* a technology's price before discounts */
export function rsCost(i) {
  const t = rsTier(i), s = rsSlot(i);
  if (t === 1) return RS_T1[s];
  const a = RS_AVG[t - 1];
  if (s > 0) return Math.round(a * RS_MUL[s]);
  let rest = 5 * a;
  for (let j = 1; j < RS_PER; j++) rest -= Math.round(a * RS_MUL[j]);
  return rest;
}
/* the hours its study takes once paid for (0: at once) */
export const rsHours = i => { const h = RS_ERA_HOURS[rsEra(rsTier(i))]; return rsSlot(i) === 0 ? h * 1.5 : h; };
/* the least that may be paid for it: its price less the most every discount allows */
export const rsMinPay = i => rsCost(i) * (1 - RS_DISC_MAX);

/* the bitset of technologies researched: 45 bytes as 60 characters of base64url */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function rsBits(s) {
  const b = new Uint8Array(45);
  if (typeof s !== 'string' || s.length !== 60) return b;
  for (let q = 0; q < 15; q++) {
    let v = 0;
    for (let j = 0; j < 4; j++) { const c = B64.indexOf(s[q * 4 + j]); if (c < 0) return new Uint8Array(45); v = v * 64 + c; }
    b[q * 3] = (v >> 16) & 255; b[q * 3 + 1] = (v >> 8) & 255; b[q * 3 + 2] = v & 255;
  }
  return b;
}
export function rsEnc(b) {
  let s = '';
  for (let q = 0; q < 15; q++) { const v = (b[q * 3] << 16) | (b[q * 3 + 1] << 8) | b[q * 3 + 2]; s += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63]; }
  return s;
}
export const rsHas = (b, i) => !!(b[i >> 3] & (1 << (i & 7)));
export const rsPut = (b, i) => { b[i >> 3] |= 1 << (i & 7); };
export function rsList(b) { const o = []; for (let i = 0; i < RS_N; i++) if (rsHas(b, i)) o.push(i); return o; }
/* how many of each tier of each track are researched: done[k][tier] (tier 1 to 24) */
export function rsDone(b) {
  const d = RS_TRACKS.map(() => new Array(RS_TIERS + 1).fill(0));
  for (let i = 0; i < RS_N; i++) if (rsHas(b, i)) d[rsTrack(i)][rsTier(i)]++;
  return d;
}
export const rsTierFull = (d, k, tier) => tier < 1 || d[k][tier] >= RS_PER;
/* the highest tier of track k complete, with every tier below it */
export function rsTopTier(d, k) { let t = 0; while (t < RS_TIERS && d[k][t + 1] >= RS_PER) t++; return t; }
/* the gates of tier t of track k beyond its own tier before: what must be complete elsewhere ({k: track or -1 for
   all, n: how many other tracks, at: tier}, or {lab: level}). The game says the same in words (rsGateWords). */
export function rsGates(k, t) {
  if (t >= 9 && t <= 10) return [{ o: 1, at: 4 }];
  if (t >= 11 && t <= 12) return [{ o: 2, at: 6 }];
  const all = { 13: 8, 14: 10, 15: 12, 16: 14, 18: 16, 20: 18, 22: 20, 24: 22 }[t];
  if (all) return [{ o: 2, at: all }];
  if (t === 17) return [{ lab: 4 }];
  return [];
}
/* whether a gate is met: o other tracks complete to tier at, or the institution at lab */
export function rsGateMet(g, d, k, lab) {
  if (g.lab) return num(lab) >= g.lab;
  let n = 0;
  for (let j = 0; j < RS_TRACKS.length; j++) if (j !== k && rsTopTier(d, j) >= g.at) n++;
  return n >= g.o;
}
/* the prerequisites of technology i within its track: the whole tier before, and a milestone its tier's four others */
export function rsPre(i) {
  const k = rsTrack(i), t = rsTier(i), s = rsSlot(i), out = [];
  if (t > 1) for (let j = 0; j < RS_PER; j++) out.push(rsIdx(k, t - 1, j));
  if (s === 0) for (let j = 1; j < RS_PER; j++) out.push(rsIdx(k, t, j));
  return out.concat(RS_X[i] || []);
}
/* whether i may be researched (or its study started) with b researched, the institution at lab and the Grand
   Challenges done (a set of their ids; the server takes every challenge as done, which the game checks) */
export function rsOpen(i, b, lab, ch) {
  if (rsHas(b, i)) return false;
  for (const p of rsPre(i)) if (!rsHas(b, p)) return false;
  const k = rsTrack(i), t = rsTier(i), d = rsDone(b);
  for (const g of rsGates(k, t)) if (!rsGateMet(g, d, k, lab)) return false;
  if (RS_C[i] && ch && !ch.has(RS_C[i])) return false;
  return true;
}
/* the highest institution the research allows: the Institute with one track at tier IV, the Academy with one at VIII
   and another at IV, the Complex with one at XII and both others at VIII, then all three at XVI, XVIII, XX, XXII, XXIV */
export function rsLevelMax(b) {
  const d = rsDone(b), top = RS_TRACKS.map((_, k) => rsTopTier(d, k)).sort((x, y) => y - x), lo = top[2];
  let l = 0;
  if (top[0] >= 4) l = 1;
  if (top[0] >= 8 && top[1] >= 4) l = 2;
  if (top[0] >= 12 && top[1] >= 8 && top[2] >= 8) l = 3;
  for (const [lv, at] of [[4, 16], [5, 18], [6, 20], [7, 22], [8, 24]]) if (lo >= at) l = lv;
  return l;
}
/* credits a day from the technologies researched */
export function rsTechRc(b) { let s = 0; for (const [i, v] of Object.entries(RS_RC)) if (rsHas(b, +i)) s += v; return s; }
/* the base daily credits: 10, a point for every 5 of Science & Technology (0 to 100), the institution and the
   technologies; the most a record may earn adds the research buildings' RS_BLD_RC_MAX, and international cooperation
   (RS_INTL_MAX), the nation's own boosts (RS_DOM_MAX) and its research edicts and laws (RS_ED_MAX) on top, and of all
   that the share RS_RC_K (game: RS_RULES.rk), the rest going on the laboratory's running costs (24 Nov 2026) */
export const RS_RC_K = 0.8;
export const rsBase = (sci, lab, techRc) => 10 + Math.floor(Math.max(0, Math.min(100, num(sci))) / 5) + (RS_INST_BONUS[Math.max(0, Math.min(8, lab | 0))] || 0) + num(techRc);
export const rsRateMax = (sci, lab, techRc) => (rsBase(sci, lab, techRc) + RS_BLD_RC_MAX) * (1 + RS_INTL_MAX + RS_DOM_MAX + RS_ED_MAX) * RS_RC_K;
/* the readiness research gives a record: {rcut: the share by which a point returns sooner, extra: points held} */
export function rsWar(rec) {
  const p = rec && rec.nrp, b = rsBits(p && p.k);
  let c = 0, x = 0;
  for (const [i, v] of Object.entries(RS_READY)) if (rsHas(b, +i)) c += v;
  for (const [i, v] of Object.entries(RS_RMAX)) if (rsHas(b, +i)) x += v;
  return { rcut: Math.round(c * 1000) / 1000, extra: x };
}

/* a record's research as the rules read it: well formed, or null */
export function rsClean(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const q = (Array.isArray(raw.q) ? raw.q : []).filter(e => Array.isArray(e) && Number.isInteger(e[0]) && e[0] >= 0 && e[0] < RS_N && num(e[1]) > 0 && num(e[2]) >= num(e[1]) && num(e[3]) >= 0).slice(0, 3)
    .map(e => [e[0], num(e[1]), num(e[2]), num(e[3]), e[4] ? 1 : 0]);
  const ap = (Array.isArray(raw.ap) ? raw.ap : []).filter(e => e && num(e.t) > 0 && typeof e.a === 'string' && e.a.length <= 128 && num(e.q) > 0 && num(e.q) <= 1000).slice(-20)
    .map(e => ({ t: num(e.t), a: e.a, q: num(e.q) }));
  return {
    k: typeof raw.k === 'string' && raw.k.length === 60 ? raw.k : rsEnc(new Uint8Array(45)),
    re: Math.max(0, num(raw.re)), rs: Math.max(0, num(raw.rs)), ra: Math.max(0, num(raw.ra)), i: Math.max(0, num(raw.i)),
    l: Math.max(0, Math.min(8, num(raw.l) | 0)), q, ap, gr: typeof raw.gr === 'string' ? raw.gr.slice(0, 20) : ''
  };
}
const sameQ = (a, b) => a[0] === b[0] && a[1] === b[1];
/* the order in which new technologies are checked: tier by tier, each track's four supporting before its milestone,
   so a technology's prerequisites (lower tiers and its own tier's four) come first */
export const RS_ORDER = (() => { const o = []; for (let t = 1; t <= RS_TIERS; t++) for (let k = 0; k < 3; k++) { for (let s = 1; s < RS_PER; s++) o.push(rsIdx(k, t, s)); o.push(rsIdx(k, t, 0)); } return o; })();

/* the save's research held to the rules (see the top of this file). n is the record being saved (changed in place),
   before the saved one ({} for none), now the server's time, savedAt the saved record's server time. Returns what
   was kept: {ok (nothing taken back), k, re, rs, l, now}, or null when the record has no research. */
export function rsSettle(n, before, now, savedAt) {
  if (!n || typeof n !== 'object') return null;
  const same = before && before.nrp && num(before.founded) === num(n.founded) && num(n.founded) > 0;
  const B = same ? rsClean(before.nrp) : null;
  /* a save without the research it had: kept as it was */
  if (!n.nrp || typeof n.nrp !== 'object' || Array.isArray(n.nrp)) {
    if (!B) { delete n.nrp; return null; }
    n.nrp = before.nrp;
    return { ok: false, k: B.k, re: B.re, rs: B.rs, l: B.l, now };
  }
  const N = rsClean(n.nrp), P = n.nrp;
  const sciN = num(n.s && n.s.sci), sciB = B ? num(before.s && before.s.sci) : sciN, sci = Math.max(sciN, sciB);
  const t0 = num(savedAt) || 0;
  let ok = true;
  /* research is never lost: the saved technologies stay */
  const bB = B ? rsBits(B.k) : new Uint8Array(45), bN = rsBits(N.k);
  for (let i = 0; i < RS_N; i++) if (rsHas(bB, i) && !rsHas(bN, i)) { rsPut(bN, i); ok = false; }
  /* the institution: one level at a time, never past what the research allows */
  const lB = B ? B.l : 0;
  let lab = N.l;
  if (lab > lB + 1 || lab > Math.max(lB, rsLevelMax(bN))) { lab = lB; ok = false; }
  if (lab < lB) { lab = lB; ok = false; }
  /* studies: those held stay (or finish), new ones start after the saved record, for their time, paid. A study's end
     may move (emergency funding, the research edicts), never to before RS_Q_MIN of its full time from its start, nor
     past RS_Q_MAX of it (or its saved end, if that is later) */
  const qB = B ? B.q : [], qN = [];
  let need = 0;
  const known = new Uint8Array(bB);
  for (const e of N.q) {
    const old = qB.find(o => sameQ(o, e));
    if (old) {
      const full = rsHours(old[0]) * HOUR, lo = Math.min(old[2], old[1] + full * RS_Q_MIN), hi = Math.max(old[2], old[1] + full * RS_Q_MAX);
      const u = Math.min(hi, Math.max(lo, e[2]));
      qN.push([old[0], old[1], u, old[3], old[4] || (e[4] ? 1 : 0)]);
      if (Math.abs(u - e[2]) > 1) ok = false;
      continue;
    }
    const i = e[0], full = rsHours(i) * HOUR;
    if (full <= 0 || e[1] < t0 - RS_SKEW || e[1] > now + RS_SKEW || e[2] - e[1] < full * RS_Q_MIN - RS_SKEW || e[3] + RS_EPS < rsMinPay(i) || qN.some(o => rsTrack(o[0]) === rsTrack(i)) || !rsOpen(i, known, Math.max(lab, lB), null)) { ok = false; continue; }
    if (e[2] - e[1] > full * RS_Q_MAX + RS_SKEW) { qN.push([e[0], e[1], e[1] + full * RS_Q_MAX, e[3], e[4]]); ok = false; } else qN.push(e);
    need += e[3];
  }
  /* new technologies, in order: their prerequisites and gates met, a later tier's from a study finished by now */
  const acc = new Uint8Array(bB);
  for (const i of RS_ORDER) {
    if (!rsHas(bN, i) || rsHas(bB, i)) continue;
    let fine = rsOpen(i, acc, Math.max(lab, lB), null);
    if (fine && rsHours(i) > 0) {
      const st = qB.find(o => o[0] === i);
      fine = !!st && st[2] <= now + RS_SKEW;
      if (fine) { const j = qN.findIndex(o => o[0] === i); if (j >= 0) qN.splice(j, 1); }
    } else if (fine) need += rsMinPay(i);
    if (fine) rsPut(acc, i); else ok = false;
  }
  /* a study whose technology is researched has finished; one finished in this save is gone from the list */
  for (let j = qN.length - 1; j >= 0; j--) if (rsHas(acc, qN[j][0])) qN.splice(j, 1);
  /* pledges to an alliance's research project: the saved ones stay, a new one is paid for */
  const apN = B ? B.ap.slice() : [];
  for (const e of N.ap) if (!apN.some(o => o.t === e.t && o.a === e.a)) { if (e.t >= t0 - RS_SKEW && e.t <= now + RS_SKEW) { apN.push(e); need += e.q; } else ok = false; }
  /* credits spent: never less than before, and enough for what is new */
  const rs = Math.max(N.rs, B ? B.rs : 0), short = rs - (B ? B.rs : 0) + RS_EPS < need;
  /* credits earned: from the time they were last counted, no faster than the record allows */
  const techRc = rsTechRc(acc), cap = rsRateMax(sci, Math.max(lab, lB), techRc);
  let gr = B ? B.gr : '';
  let grant = 0;
  for (const g of Object.keys(RS_GRANTS)) if (N.gr.includes(g) && !gr.includes(g) && (N.i > 0 || (B && B.i > 0))) { gr += g; grant += RS_GRANTS[g]; }
  /* Field Notes, for a laboratory already open in the saved record */
  if (B && B.i > 0) grant += rsFieldNotes(n, before);
  let i0 = B && B.i > 0 ? B.i : N.i > 0 ? Math.max(N.i, t0 - RS_SKEW) : 0;
  if (i0 > now + RS_SKEW) i0 = 0;
  const ra = Math.min(Math.max(N.ra, B ? B.ra : 0), now + RS_SKEW);
  const from = B && B.ra > 0 && B.i > 0 ? B.ra : i0;
  const most = (B ? B.re : 0) + grant + (i0 > 0 ? cap * Math.max(0, Math.min(ra, now) - Math.min(from, now)) / DAY : 0) + RS_EPS;
  let re = Math.max(N.re, B ? B.re : 0);
  if (re > most) { re = Math.max(B ? B.re : 0, most - RS_EPS); ok = false; }
  /* what was new and cannot be paid for is taken back whole: the saved research, its studies and pledges, and the
     credits counted */
  if (short || re - rs < -RS_EPS) {
    P.k = rsEnc(bB); P.q = B ? B.q : []; P.ap = B ? B.ap : []; P.rs = B ? B.rs : 0; P.re = Math.round(re * 100) / 100; P.ra = ra; P.l = lB; P.gr = gr;
    if (B) P.i = B.i; else if (i0) P.i = i0;
    return { ok: false, k: P.k, re: P.re, rs: P.rs, l: P.l, now };
  }
  P.k = rsEnc(acc); P.q = qN; P.ap = apN; P.rs = Math.round(rs * 100) / 100; P.re = Math.round(re * 100) / 100; P.ra = ra; P.l = lab; P.gr = gr;
  if (i0) P.i = i0; else delete P.i;
  return { ok, k: P.k, re: P.re, rs: P.rs, l: P.l, now };
}

/* ── alliances and licences (functions/alliances.js alRsStart/alRsGive, functions/treaties.js trLic/trLicAns) ── */
/* credits a day research buildings and the laboratory's site may add (the game's Technical College 1, Data Centre 1 and
   Science Park 3, and a site in the university quarter 2), and the nation's own boost (a commissioned report) the rate
   may carry beyond international cooperation */
export const RS_BLD_RC_MAX = 7, RS_DOM_MAX = 0.15;
/* the research edicts (game: "research edicts", RS_RULES edMax, qMin, qMax): what their boosts and the research laws
   may add to the credits together, and the shortest and longest a study may be made, as shares of its full time */
export const RS_ED_MAX = 0.3, RS_Q_MIN = 0.5, RS_Q_MAX = 3;
/* an alliance's research project, one at a time: p (a programme of its type) or g (its Grand Challenge, from alliance
   level 4). need: credits a member alliance gathers (per player member, within lo..hi), cap: the most one member may
   give, cost: from the treasury when it begins, days: how long its discount lasts for the members who gave */
export const RS_AL_PROJ = {
  def: { p: { n: 'Joint Defence Research Programme', tr: 'w', disc: 0.1 }, g: { n: 'Allied Defence Research Centre', tr: 'w', disc: 0.12 }, cost: { iron: 150, oil: 80 } },
  trade: { p: { n: 'Common Standards Programme', tr: 't', disc: 0.1 }, g: { n: 'Regional Standards Institute', tr: 't', disc: 0.12 }, cost: { goods: 150, food: 80 } },
  culture: { p: { n: 'Public Health and Learning Programme', tr: 'g', disc: 0.1 }, g: { n: 'Shared Heritage Archive', tr: 'g', disc: 0.12 }, cost: { food: 150, goods: 80 } },
  research: { p: { n: 'Grand Research Consortium', tr: '*', disc: 0.08 }, g: { n: 'Allied Research Campus', tr: '*', disc: 0.1 }, cost: { goods: 150, oil: 80, iron: 80 } }
};
export const RS_AL_SCALE = { p: { per: 120, lo: 360, hi: 1500, cap: 300, days: 30, xp: 60, mul: 1, lv: 1 }, g: { per: 500, lo: 1500, hi: 6000, cap: 1200, days: 90, xp: 150, mul: 4, lv: 4 } };
export const rsAlNeed = (k, members) => { const S = RS_AL_SCALE[k]; return Math.max(S.lo, Math.min(S.hi, S.per * Math.max(1, members | 0))); };
export const rsAlCost = (ty, k) => { const C = RS_AL_PROJ[ty] && RS_AL_PROJ[ty].cost, m = RS_AL_SCALE[k] ? RS_AL_SCALE[k].mul : 1, o = {}; for (const [r, v] of Object.entries(C || {})) o[r] = v * m; return o; };
/* a technology licence: 20% off one technology the licensee has not researched, for 30 days; one per technology per
   licensee ever (declined: offered again after a week); an exporter offers at most 3 a week, a licensee accepts at most
   3 a week; both nations at least a week old with a laboratory open; the fee in materials by tier */
export const RS_LIC = { disc: 0.2, days: 30, week: 7 * DAY, perWeek: 3, age: 7 * DAY };
export const rsLicFee = i => { const t = rsTier(i), k = RS_TRACKS[rsTrack(i)], a = k === 'w' ? 'iron' : k === 'g' ? 'food' : 'goods'; return { [a]: Math.round(6 + 3 * t), goods: Math.round(4 + 2 * t) + (a === 'goods' ? Math.round(6 + 3 * t) : 0) }; };
export const rsKnows = (rec, i) => rsHas(rsBits(rec && rec.nrp && rec.nrp.k), i);
export const rsOpenLab = rec => !!(rec && rec.nrp && num(rec.nrp.i) > 0);
