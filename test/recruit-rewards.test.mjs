// Recruiting, round three: the designs recruits earn (RC_UNLOCKS) and those the recruits of a player's recruits earn
// (RC_GUNLOCKS), in game/edictum.html. test/recruit-e2e.mjs draws them on the Invite tab and earns three of them.
// Run with: node --test test/recruit-rewards.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const grab = (re, what) => { const m = src.match(re); assert.ok(m, what); return m; };
const ladder = name => JSON.parse(grab(new RegExp('const ' + name + '=(\\[\\[[^;]*\\]\\]);'), name)[1].replace(/'/g, '"'));
const A = ladder('RC_UNLOCKS'), G = ladder('RC_GUNLOCKS');
const cap = name => Number(grab(new RegExp('\\b' + name + '=(\\d+)'), name)[1]);
const defs = id => [...src.matchAll(new RegExp(`'${id}':\\{k:'([a-z]+)',n:'([^']*)',src:'([a-z]+)'`, 'g'))];

test('recruits earn a design at 1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50 and 100; their recruits at 1, 2, 3, 5, 10, 25, 50 and 100', () => {
  assert.deepEqual(A.map(x => x[1]), [1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 100]);
  assert.deepEqual(G.map(x => x[1]), [1, 2, 3, 5, 10, 25, 50, 100]);
  assert.ok(cap('RC_MAX') >= 100 && cap('RC_GMAX') >= 100, 'the counts reach the last step');
  /* the first four stay where they were */
  assert.deepEqual(A.filter(([id]) => ['t-welcoming', 's-seconded', 'f-chain', 'c-hands'].includes(id)).map(x => x[1]), [1, 3, 10, 25]);
});

test('each is a design of its own, from recruiting, with a name no other design has', () => {
  const ids = [...A, ...G].map(x => x[0]);
  assert.equal(new Set(ids).size, ids.length, 'no design in two places');
  const allNames = [...src.matchAll(/'[a-z]+-[a-z0-9-]+':\{k:'([a-z]+)',n:'([^']*)'/g)].map(m => m[1] + ':' + m[2]);
  for (const id of ids) {
    const d = defs(id);
    assert.equal(d.length, 1, id + ' is defined once');
    assert.equal(d[0][3], 'rc', id + ' comes from recruiting');
    assert.equal(allNames.filter(x => x === d[0][1] + ':' + d[0][2]).length, 1, id + ' has a name of its own: ' + d[0][2]);
  }
  /* every kind on the ladders is one Customise has, and the two ladders between them use ten kinds */
  const kinds = new Set(ids.map(id => defs(id)[0][1]));
  assert.deepEqual([...kinds].sort(), ['charge', 'emblem', 'frame', 'motto', 'paper', 'pattern', 'pin', 'seal', 'stamp', 'title']);
});

test('every design is drawn: its art, its styles, its colours', () => {
  for (const id of [...A, ...G].map(x => x[0])) {
    const k = defs(id)[0][1], key = id.slice(id.indexOf('-') + 1);
    const has = (s, what) => assert.ok(src.includes(s), `${id} (${k}): ${what || s}`);
    switch (k) {
      case 'frame': has(`CZ_FR['${id}']=`); assert.ok(src.includes(`fr==='${id}'`) || src.includes(`fr!=='${id}'`), id + ' frame art'); break;
      case 'seal': has(`.dm-wax.${id}{`); assert.match(src, new RegExp(`'${id}':'#[0-9A-F]{6}'`), id + ' LS_HEX'); break;
      case 'paper': has(`.bub.${id}{`); has(`.lp-sw.${id}{`); break;
      case 'motto': has(`.hero-motto.mf-${key},.cz-mf.mf-${key}{`); break;
      case 'stamp': { const m = src.match(new RegExp(`s==='${id}'\\?'<span class="cz-enx cz-enx-([a-z]+)">`)); assert.ok(m, id + ' stamp art'); has(`.cz-enx.cz-enx-${m[1]}{`); break; }
      case 'charge': case 'emblem': if (!['hands'].includes(key)) has(`case '${key}':return czSil(`, 'drawn as a charge'); if (k === 'emblem') { assert.ok(src.includes(`e!=='${id}'`), id + ' on the flag'); const reg = src.match(/for\(const id of (\[[^\]]*\])\)\{EMBLEMS\[id\]=UNLOCKS\[id\]\.n;if\(!CZ_EMBS\.includes\(id\)\)CZ_EMBS\.push\(id\);\}/); assert.ok(reg && reg[1].includes(`'${id}'`), id + ' in the flag designer'); } break;
      case 'pin': has(`id==='${id}'?h.replace(`, 'in the pin preview'); assert.ok(src.includes(`pin!=='${id}'`), id + ' on the map'); break;
      case 'pattern': assert.ok(src.includes(`p!=='${id}'`), id + ' pattern art'); break;
      case 'title': break;
      default: assert.fail(id + ': ' + k);
    }
  }
});

/* the counts, the step-crossing and the unlock source, run as the game has them */
function game() {
  const ctx = vm.createContext({});
  const lines = [
    `const RC_MAX=${cap('RC_MAX')},RC_GMAX=${cap('RC_GMAX')},UNLOCK_SOURCES=[];`,
    grab(/const RC_UNLOCKS=[^;]*;/, 'RC_UNLOCKS')[0], grab(/const RC_GUNLOCKS=[^;]*;/, 'RC_GUNLOCKS')[0],
    grab(/const rcPaid=n=>[^\n]*;/, 'rcPaid')[0], grab(/const rcGPaid=n=>[^\n]*;/, 'rcGPaid')[0], grab(/const rcCount=n=>[^\n]*;/, 'rcCount')[0],
    grab(/function rcNewUnl\(a,b\)\{[\s\S]*?\.map\(\(\[id\]\)=>id\);\}/, 'rcNewUnl')[0],
    grab(/UNLOCK_SOURCES\.push\(\{earned:n=>\{if\(!n\|\|n\.npc\)return \[\];const a=rcCount\(n\)[\s\S]*?\}\}\);/, 'the unlock source')[0],
    'globalThis.G={rcNewUnl,src:UNLOCK_SOURCES[0]};'];
  vm.runInContext(lines.join('\n'), ctx);
  return ctx.G;
}
const ids = (k, p = 'r') => Array.from({ length: k }, (_, i) => p + String(i).padStart(6, '0'));

test('a recruit that takes the count past a step brings that design, once', () => {
  const g = game(), at = (a, b) => [...g.rcNewUnl({ rcp: ids(a) }, { rcp: ids(b) })];
  assert.deepEqual(at(1, 2), ['ls-friend']);
  assert.deepEqual(at(3, 5), ['e-door', 'm-garland']);
  assert.deepEqual(at(49, 50), ['pn-arch']);
  assert.deepEqual(at(50, 51), []);
  assert.deepEqual(at(99, 100), ['t-host'], 'the hundredth recruit counts');
  assert.deepEqual([...g.rcNewUnl({ rcgp: [] }, { rcgp: ids(3, 'g') })], ['s-passed', 'ls-heirloom', 'e-seedling']);
  assert.deepEqual([...g.rcNewUnl({ rcp: ids(9), rcgp: ids(9, 'g') }, { rcp: ids(10), rcgp: ids(10, 'g') })], ['f-chain', 'f-rings']);
});

test('the designs are earned from the recruits paid, and say how', () => {
  const g = game(), earned = n => [...g.src.earned(n)];
  assert.deepEqual(earned({ rcp: ids(2), rcgp: ids(1, 'g') }), ['t-welcoming', 'ls-friend', 's-passed']);
  assert.equal(earned({ rcp: ids(100), rcgp: ids(100, 'g') }).length, 23, 'all of them at a hundred each');
  assert.deepEqual(earned({ npc: 1, rcp: ids(5) }), []);
  assert.deepEqual(earned(null), []);
  assert.equal(g.src.how('t-host'), 'Recruit 100 players through your link (Region › Invite).');
  assert.equal(g.src.how('pn-oak'), 'Have the players you recruited bring in 50 players of their own (Region › Invite).');
  assert.equal(g.src.how('s-passed'), 'Have the players you recruited bring in a player of their own (Region › Invite).');
  assert.equal(g.src.how('c-lion'), null);
});
