// Settings regrouped (18 Nov 2026): every tab sits in one of the five groups, short numbers read right,
// and "Who can reach me" lets the right nations through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const grab = (re, what) => { const m = re.exec(html); assert.ok(m, what + ' is in the game'); return m[0]; };
/* a top-level function: its first line, and its indented body down to the closing brace at the start of a line */
const fn = name => {
  const at = html.indexOf('\nfunction ' + name + '('); assert.ok(at >= 0, name + ' is in the game');
  const lines = html.slice(at + 1).split('\n'), out = [lines[0]];
  if (!lines[1].startsWith(' ') && lines[1] !== '}') return lines[0];
  for (const l of lines.slice(1)) { out.push(l); if (l === '}') break; }
  return out.join('\n');
};

test('every Settings tab is in exactly one group', () => {
  const groups = vm.runInNewContext(grab(/const SG_GROUPS=\[.*?\];/s, 'SG_GROUPS').replace(/^const SG_GROUPS=/, '').replace(/;$/, ''));
  const base = vm.runInNewContext(grab(/const SG_TABS=\[.*?\];/, 'SG_TABS').replace(/^const SG_TABS=/, '').replace(/;$/, '')).map(t => t[0]);
  const added = [...html.matchAll(/SG_TABS\.splice\([^\n]*?,0,\['(\w+)'/g)].map(m => m[1]);
  const pushed = [...grab(/SG_TABS\.push\(.*?\);/, 'SG_TABS.push').matchAll(/\['(\w+)'/g)].map(m => m[1]);
  const all = [...base, ...added, ...pushed], inGroups = groups.flatMap(g => g[2]);
  assert.deepEqual(JSON.parse(JSON.stringify(groups.map(g => g[1]))), ['Your nation', 'Play', 'Contact and privacy', 'Look and feel', 'Account']);
  for (const k of all) assert.equal(inGroups.filter(x => x === k).length, 1, `${k} is in one group`);
  assert.equal(new Set(inGroups).size, all.length, 'no group names a tab that does not exist');
});

test('short numbers: 4.37M, 12.3k, 1.5B, and small ones written out', () => {
  const ctx = {}; vm.runInNewContext(fn('numShort'), ctx);
  const f = ctx.numShort;
  assert.equal(f(4370000), '4.37M');
  assert.equal(f(12345), '12.3k');
  assert.equal(f(1.5e9), '1.5B');
  assert.equal(f(100e6), '100M');
  assert.equal(f(10000), '10k');
  assert.equal(f(2.0e12), '2T');
  assert.equal(f(9999), '9,999');
  assert.equal(f(-2500000), '-2.5M');
});

test('who can reach me: everyone, allies and neighbours, nobody; the team always', () => {
  const ctx = {
    sameAlliance: (a, b) => (a === 'me' && b === 'ally') || (a === 'ally' && b === 'me'),
    territory: () => ({ byId: { me: 0, nbr: 1, far: 2, ally: 3 } }),
    bordersOf: (T, i) => new Set(i === 0 ? [1] : i === 1 ? [0] : []),
    isStaff: id => id === 'team'
  };
  vm.runInNewContext([fn('rchOf'), fn('rchNear'), fn('rchLets')].join('\n'), ctx);
  const me = { rch: { l: 'f', s: 'n' } };
  assert.equal(ctx.rchLets(me, 'me', 'ally', 'l'), true, 'an ally may write');
  assert.equal(ctx.rchLets(me, 'me', 'nbr', 'l'), true, 'a neighbour may write');
  assert.equal(ctx.rchLets(me, 'me', 'far', 'l'), false, 'a stranger may not');
  assert.equal(ctx.rchLets(me, 'me', 'ally', 's'), false, 'nobody sends caches, allies included');
  assert.equal(ctx.rchLets(me, 'me', 'team', 's'), true, 'the team always gets through');
  assert.equal(ctx.rchLets(me, 'me', 'far', 't'), true, 'trade offers are open to everyone');
  assert.equal(ctx.rchLets({}, 'me', 'far', 'l'), true, 'nothing set: everyone');
});

test('the servers keep "Nobody" for Supply Caches, alliance invitations and border proposals', () => {
  const read = f => fs.readFileSync(new URL('../functions/' + f, import.meta.url), 'utf8');
  assert.match(read('supply.js'), /closed\(nationJSON\(other\), 's'\)\) refuse\('sc_closed'/);
  assert.match(read('alliances.js'), /closed\(nationJSON\(target\), 'a'\)\) refuse\('al_closed'/);
  assert.match(read('borders.js'), /offer && closed\(recs\[ids\[i\]\], 'b'\)\) refuse\('bd_closed'/);
  assert.match(html, /SC_BACK\.add\('sc_closed'\)/, 'a refused cache comes back to the sender');
});
