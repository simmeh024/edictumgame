// A claim whose standing waits on the server's time (game/edictum.html: raceOpen, capWrong's pend, territory()'s claim
// count, raceFailed). On 16 Nov 2026 Eternia saw "1 land credit to spend" after each load that was gone a few seconds
// later: its claim under Neverfall's capital (capWrong) was not counted until the stamp of that claim was read, in the
// last of seven batches of stamps. Such a claim now keeps its credit while its time is read, and a failed read is tried
// again instead of leaving the capital (and the credit) in place until the page is loaded again. Two claims on one hex
// still go by their records' order until the stamps are in.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i > 0 && j > i, a + ' … ' + b); return src.slice(i, j); };
const RACES = cut('const RACE={', 'async function raceFetch(');
const READ = cut('const recStamp=at=>', '/* Grow every nation');
const TERR = cut('const terrCache=new Map();', '/* armies and military policies */');
const AC_EPOCH = Date.UTC(2026, 9, 28), DAY = 864e5, N = 40;
const T0 = Date.UTC(2026, 10, 12, 19, 31);

/* a strip of 40 hexes; every nation keeps its capital and what it holds by claim (grow() as a stand-in: claims are all
   this test counts) */
function kit(world) {
  const timers = [];
  const ctx = vm.createContext({
    AC_EPOCH, DAY, FIX_EPOCH: 0, SEAL2_AT: 0, TERR_AT: null, CORE_HEXES: 1, N, timers,
    // a strip that did not grow: every claim's stamp is under the number it has (raceCK; frontier.test.mjs for one that did)
    FRONT_AT: Date.UTC(2026, 10, 19, 19, 41, 53), MAP_COLS: 1, CHART_COLS: 1,
    S: { mode: 'world', uid: 'me', nation: world.me, world: Object.fromEntries(Object.entries(world).filter(([k]) => k !== 'me')), db: {} },
    HIDN: { w: {} }, REF: { ok: new Map() }, RECL: { owner: new Map(), time: new Map() }, recRev: 0, NPC_SET: new Set(),
    MAP: { N, T: new Uint8Array(N).fill(2), cx: new Float64Array(N).map((_, i) => i), cy: new Float64Array(N) },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    wrFallsAt: () => [], wrEndsAt: () => [], wrFellOf: () => null, wrSpoilOf: () => null, wrShielded: () => false,
    raceFetch() {}, syncReclaims() {}, sealed: () => true, hidDoc: () => null, hidMask: n => n, myId: () => 'me',
    hash: s => { let h = 0; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h; },
    allNations: () => [...Object.entries(ctx.S.world).map(([id, n]) => ({ id, n })), { id: 'me', n: ctx.S.nation, me: true }],
    cellOf: l => (l && l.c >= 0 ? l.c : -1), popNow: () => 5, npcLand: () => 1, npcWeight: () => 1, budgetOf: () => 1, weightOf: () => 1, nationColor: () => '#000',
    claimLand: c => c >= 0 && c < N, hexDist: (a, b) => Math.abs(a - b), CAP_REACH: 30, inReach: (x, c) => Math.abs(c - x.cap) <= 30,
    capSince: n => Math.max(n.founded || 0, n.capAt || 0), warCovers: () => false,
    grow(list, over) {
      const owner = new Int16Array(N).fill(-1), held = new Int32Array(list.length), grown = new Int32Array(list.length);
      if (over) for (const [c, i] of over) { owner[c] = i; held[i]++; }
      list.forEach((x, i) => { if (owner[x.cap] === -1) { owner[x.cap] = i; held[i]++; grown[i] = 1; } });
      return { owner, held, grown };
    },
  });
  vm.runInContext([RACES, READ, TERR].join('\n').replace(/^const (RACE|RACE_TRIES|ccMemo|capClaimsMemo|terrCache|atlasCache)=/gm, 'var $1='), ctx);
  if (!ctx.atlasCache) ctx.atlasCache = new Map();
  /* what the page sees: its own claims, less those its land holds (claimsUsed with no switch-time claims) */
  ctx.used = id => { const T = ctx.territory(); return T.claimUsed[T.byId[id]]; };
  ctx.holds = (id, c) => { const T = ctx.territory(); return T.owner[c] === T.byId[id]; };
  ctx.stamp = (k, v) => { ctx.RACE.t.set(k, v); ctx.RACE.rev++; };
  /* the retries raceFailed set (the stamp batches raceSoon sets wait 60 ms) */
  ctx.retries = () => timers.filter(t => t.ms >= 15000);
  ctx.retry = () => { const i = timers.findLastIndex(t => t.ms >= 15000); return i < 0 ? null : timers.splice(i, 1)[0]; };
  return ctx;
}
/* Eternia (me, capital 5) claimed hex 20 on 28 Oct; Neverfall settled on it on 12 Nov, its game offline */
const eternia = () => ({ name: 'Eternia', loc: { c: 5 }, founded: T0 - 20 * DAY, claims: [{ c: 19, t: T0 - 16 * DAY }, { c: 20, t: T0 - 15 * DAY }] });
const neverfall = () => ({ name: 'Neverfall', loc: { c: 20 }, founded: T0 - 60000, capAt: T0, claims: [] });

test('a claim under a capital that stands only while the claim\'s time is read keeps its credit', () => {
  const k = kit({ me: eternia(), nev: neverfall() });
  assert.equal(k.used('me'), 2, 'both claims cost a credit while the stamp is read');
  assert.ok(!k.holds('me', 20), 'the capital stands meanwhile');
  assert.ok(k.RACE.want.has('c20:me'), 'and the stamp is asked for');
  k.stamp('c20:me', T0 - 15 * DAY + 60e3);
  assert.equal(k.used('me'), 2, 'the server says the claim came first: still two');
  assert.ok(k.holds('me', 20), 'and the land is Eternia\'s again');
  assert.deepEqual([...k.territory().wrong.keys()], ['nev']);
});

test('the credit comes back only once the server says the capital came first', () => {
  const k = kit({ me: eternia(), nev: neverfall() });
  k.territory();
  k.stamp('c20:me', T0 + 600e3); // the claim reached the server ten minutes after the capital took its place
  assert.equal(k.used('me'), 1);
  assert.ok(!k.holds('me', 20));
});

test('a failed read keeps the credit and is tried again, further apart each time, then gives up', () => {
  const k = kit({ me: eternia(), nev: neverfall() });
  k.territory(); k.RACE.want.clear();
  const waits = [];
  for (let i = 1; i < k.RACE_TRIES; i++) {
    k.raceFailed('c20:me');
    assert.equal(k.used('me'), 2, 'failed read ' + i + ': the claim still costs its credit');
    const tm = k.retry(); waits.push(tm.ms); tm.f();
    assert.equal(k.RACE.t.get('c20:me'), undefined, 'the stamp is unread again');
    assert.ok(k.RACE.want.has('c20:me'), 'and asked for'); k.RACE.want.clear();
  }
  assert.deepEqual(waits, [15000, 30000, 60000]);
  k.raceFailed('c20:me');
  assert.equal(k.retries().length, 0, 'no fourth retry');
  assert.equal(k.used('me'), 1, 'after the last failure the capital stands as before, until the next visit');
});

test('a retry is not made when the stamp arrived meanwhile', () => {
  const k = kit({ me: eternia(), nev: neverfall() });
  k.raceFailed('c20:me'); k.stamp('c20:me', T0 - 15 * DAY);
  k.retry().f();
  assert.equal(k.RACE.t.get('c20:me'), T0 - 15 * DAY);
  assert.ok(!k.RACE.want.has('c20:me'));
});

test('a hex two nations claimed: the records’ order holds until the stamps are in, and the one behind has its credit at once', () => {
  // not held back like a claim under a capital: the records' order is the server's nearly always, and holding back the
  // loser's credit kept 19 to 32 credits from Lévice, Osinova and Libertad for the first seconds of every visit
  const me = eternia(), other = { name: 'Rival', loc: { c: 30 }, founded: T0 - 20 * DAY, claims: [{ c: 25, t: T0 - 3 * DAY }] };
  me.claims.push({ c: 25, t: T0 - 2 * DAY }); // later by its own record's time
  const k = kit({ me, riv: other });
  assert.ok(k.holds('riv', 25), 'until the stamps are in, the record times decide who holds it');
  assert.equal(k.used('me'), 2, 'and the claim behind costs nothing meanwhile');
  assert.equal(k.used('riv'), 1);
  k.stamp('c25:riv', T0 - 1 * DAY); k.stamp('c25:me', T0 - 2 * DAY + 5000);
  assert.ok(k.holds('me', 25), 'the server says Eternia was first');
  assert.equal(k.used('me'), 3);
  assert.equal(k.used('riv'), 0, 'and the rival has its credit back');
});

test('settled races and claims from before the stamps count as they always did', () => {
  const me = eternia(), other = { name: 'Rival', loc: { c: 30 }, founded: AC_EPOCH - 20 * DAY, claims: [{ c: 25, t: AC_EPOCH - 3 * DAY }] };
  me.claims.push({ c: 25, t: AC_EPOCH - 2 * DAY });
  const k = kit({ me, riv: other });
  assert.equal(k.used('me'), 2, 'the hex the rival claimed first, before the stamps began, costs Eternia nothing');
  assert.equal(k.RACE.want.size, 0);
  const g = kit({ me: eternia(), nev: neverfall() }); g.S.mode = 'local';
  assert.equal(g.used('me'), 2, 'a game of its own goes by its records’ times');
  assert.ok(g.holds('me', 20) && g.RACE.want.size === 0, 'with no stamp to wait for');
});
