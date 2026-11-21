// The Chancery seal shown by default (game/edictum.html): a member who has chosen no seal of its own shows the best it
// holds, worked out again as its months pass, for itself (its shop record) and for every other game (finery cl with d);
// one that chose none ('') shows none; one that chose a seal shows that one while it is held.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { const ch = html[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
const info = html.slice(html.indexOf('const SEAL_INFO={'), html.indexOf('\nfunction clubSeals('));
assert.ok(info.includes("'csl-grand'"), 'the seals are found');
const SEALS = { 'csl-member': 0, 'csl-brass': 3, 'csl-silver': 6, 'csl-gold': 12, 'csl-grand': 24 };
const DAY = 864e5, T = Date.UTC(2026, 10, 21);
function game(doc, cl) {
  const me = { name: 'Libertad' }, them = { name: 'Brackwater' };
  const G = new Function('SHOP', 'shopNow', 'shopMine', 'flIdOf', `${info}
    function clubSeals(){return ${JSON.stringify(SEALS)};}
    ${['clubTenure', 'clubSealHeld', 'clubSealBest', 'clubSealAuto', 'clubSealOf'].map(fn).join('\n')}
    return {clubSealBest,clubSealAuto,clubSealOf};`)(
    { doc, cl: new Map(cl ? [['uB', cl]] : []) }, () => T, n => n === me, n => n === them ? 'uB' : null);
  return { ...G, me, them };
}
const member = (m, until = T + 20 * DAY) => ({ until, m, f: [] });

test('a member who has chosen nothing shows the best seal it holds, and it moves up with the months', () => {
  assert.equal(game({ vip: member(1) }).clubSealOf(game({ vip: member(1) }).me), null, 'only the player’s own nation is read from its record');
  let g = game({ vip: member(1) });
  assert.deepEqual(g.clubSealOf(g.me), { id: 'csl-member', m: 1 }, 'a new member: wax');
  g = game({ vip: member(4) });
  assert.deepEqual(g.clubSealOf(g.me), { id: 'csl-brass', m: 4 });
  g = game({ vip: { until: T + 300 * DAY, m: 5, f: [T - DAY, T + DAY] } });
  assert.equal(g.clubSealOf(g.me).id, 'csl-silver', 'a paid year’s months begun count, so the sixth makes it silver');
  g = game({ vip: member(2, T - DAY) });
  assert.equal(g.clubSealOf(g.me), null, 'after a short membership: none earned to keep');
  g = game({ vip: member(13, T - DAY) });
  assert.equal(g.clubSealOf(g.me).id, 'csl-gold', 'after a long one: the best seal kept');
  g = game({});
  assert.equal(g.clubSealOf(g.me), null, 'never a member');
});

test('a choice is kept: a seal while it is held, and none when none was chosen', () => {
  let g = game({ vip: member(8), seal: 'csl-member' });
  assert.equal(g.clubSealOf(g.me).id, 'csl-member', 'a lesser seal chosen stays chosen');
  g = game({ vip: member(8), seal: '' });
  assert.equal(g.clubSealOf(g.me), null, 'none chosen: none shown');
  g = game({ vip: member(1, T - DAY), seal: 'csl-member' });
  assert.equal(g.clubSealOf(g.me), null, 'the wax seal chosen ends with the membership');
  assert.equal(g.clubSealAuto({}), true); assert.equal(g.clubSealAuto({ seal: '' }), false); assert.equal(g.clubSealAuto({ seal: 'csl-gold' }), false);
  assert.equal(g.clubSealAuto({ seal: 'csl-nope' }), true, 'an unknown id counts as no choice');
  assert.equal(g.clubSealAuto(null), true);
});

test('another player’s seal: the one it chose, or with d the best it holds now', () => {
  let g = game({}, { s: 'csl-member', u: T + 20 * DAY, m: 4, f: [], d: true });
  assert.equal(g.clubSealOf(g.them).id, 'csl-brass', 'published as wax a month ago, brass now');
  g = game({}, { s: 'csl-member', u: T + 20 * DAY, m: 4, f: [], d: false });
  assert.equal(g.clubSealOf(g.them).id, 'csl-member', 'chosen: as chosen');
  g = game({}, { s: 'csl-brass', u: T - DAY, m: 2, f: [], d: true });
  assert.equal(g.clubSealOf(g.them), null, 'with d, a membership ended before any seal was kept shows none');
  g = game({});
  assert.equal(g.clubSealOf(g.them), null, 'nothing published');
  assert.equal(g.clubSealOf({ name: 'Zollhorn', npc: true }), null);
});

test('the finery list keeps d; the picker offers none and the best again; the texts say it shows unless hidden', () => {
  assert.match(html, /cm\.set\(d\.id,\{s:cl\.s,u:\+cl\.u\|\|0,m:\+cl\.m\|\|0,f:[^}]*,d:cl\.d===1\}\)/);
  const pick = fn('clubSealHTML');
  assert.match(pick, /data-id=""[^>]*>Show no seal</);
  assert.match(pick, /data-id="auto"[^>]*>Show the best I hold, as my months add up</);
  assert.match(pick, /the best seal you hold, moving up as your months add up/);
  assert.match(html, /\nasync function shopSeal\(id\)\{\n  if\(SHOP\.busy\|\|id&&id!=='auto'&&!SEAL_INFO\[id\]\)return;/, 'shopSeal takes auto');
  assert.match(html, /A member shows the best seal it holds unless it chooses another, or none\./);
  assert.doesNotMatch(html, /Nothing shows unless you choose it/);
  assert.match(html, /and on your treaties, unless you choose to hide it:/);
  for (const [f, re] of [['../src/pricing.html', /unless you choose to hide it:/], ['../src/precios.html', /salvo que decidas ocultarlo:/]])
    assert.match(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), re);
});
