// "Over the Fence", "Good Neighbour" and the museum's "A Note over the Fence" count edicts that involve a neighbour
// (tally iss:nb, game/edictum.html tallyScan). Until 23 Nov 2026 the test read is.nb, which no edict has, so only the
// eleven migration edicts (is.mx) counted; the edicts that need a neighbour carry is.nbx. Once, the neighbour edicts
// still among the last 80 decisions are counted (tally fix:nb).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { const ch = html[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
const ISSUES = {
  fence: { id: 'fence', c: 'world', nbx: true },      // needs a neighbour
  river: { id: 'river', c: 'nature', nbx: true },
  roads: { id: 'roads', c: 'econ', nbx: false },      // nothing to do with neighbours
  mig: { id: 'mig', c: 'society', mx: 'in', nbx: false } // a migration edict
};
function tally() {
  const ctx = vm.createContext({ TALLY_MAX: 500, TALLY_TARGET_KINDS: new Set(), ISSUE_BY_ID: ISSUES, SITES: {}, BUILDINGS: {}, crsTally: () => {},
    milesReached: () => [], MILESTONES: [], STAT_KEYS: ['econ'], fmtPopShort: String, myId: () => 'me', gamesResults: () => null, medalsIn: () => ({ list: [] }), edStart: () => 0 });
  vm.runInContext(fn('nbIssue') + '\n' + fn('tallyScan') + '\nthis.scan=tallyScan;this.nbIssue=nbIssue;', ctx);
  return ctx;
}
const H = 3600e3, now = Date.now();
const rec = (n, tly, answered) => ({ name: 'Zatraland', updatedAt: now, log: [], answered, tly: { ...tly }, tlf: {}, tlx: {}, s: {} });
const ans = (id, k, o = 0) => ({ id, o, t: now - k * H, fx: 'done' });

test('the tally no longer reads is.nb, which no edict has', () => {
  assert.doesNotMatch(fn('tallyScan'), /if\(is\.nb\b/);
  assert.match(fn('tallyScan'), /if\(nbIssue\(is\)\)bump\('iss:nb'/);
  assert.equal(html.match(/\{id:'[a-z0-9-]+'[^\n]{0,300}?(?=q:'|o:\[)/g).filter(h => /(^|,)nb:/.test(h)).length, 0, 'no edict carries a top-level nb');
  assert.match(html, /is\.nbx=!is\.mx&&/, 'the edicts that need a neighbour are marked nbx');
});

test('a neighbour edict counts, and a migration edict still does; an ordinary one does not', () => {
  const g = tally();
  assert.equal(g.nbIssue(ISSUES.fence), true); assert.equal(g.nbIssue(ISSUES.mig), true);
  assert.equal(g.nbIssue(ISSUES.roads), false); assert.equal(g.nbIssue(undefined), false);
  const old = rec('', { 'fix:nb': 1 }, []);
  const n = rec('', { 'fix:nb': 1 }, [ans('fence', 3), ans('roads', 2), ans('mig', 1)]);
  g.scan(n, old, now);
  assert.equal(n.tly['iss:nb'], 2);
  assert.equal(n.tly.iss, 3);
});

test('a vetoed neighbour edict is not a decision on it', () => {
  const n = rec('', { 'fix:nb': 1 }, [ans('fence', 1, -1)]);
  tally().scan(n, rec('', { 'fix:nb': 1 }, []), now);
  assert.equal(n.tly['iss:nb'] || 0, 0);
});

test('once, the neighbour edicts decided before the fix are counted from the last 80 decisions', () => {
  const answered = [ans('fence', 9), ans('roads', 8), ans('river', 7), ans('mig', 6), ans('fence', 5, -1)];
  /* the migration edict was counted at the time; the two neighbour edicts were not */
  const old = rec('', { iss: 4, 'iss:nb': 1 }, answered), n = rec('', { iss: 4, 'iss:nb': 1 }, answered.slice());
  const g = tally();
  g.scan(n, old, now);
  assert.equal(n.tly['iss:nb'], 3, 'fence, river and the migration edict; not the veto, not roads');
  assert.equal(n.tly['fix:nb'], 1, 'done once');
  assert.equal(n.tly.iss, 4, 'nothing else counted again');
  /* the next save: nothing new, nothing counted again */
  const n2 = rec('', n.tly, answered.slice());
  g.scan(n2, n, now + H);
  assert.equal(n2.tly['iss:nb'], 3);
});

test('the count made then never lowers a higher tally, and a decision in the same save counts once', () => {
  const g = tally();
  const kept = rec('', { 'iss:nb': 12 }, [ans('fence', 2)]);
  g.scan(kept, rec('', { 'iss:nb': 12 }, [ans('fence', 2)]), now);
  assert.equal(kept.tly['iss:nb'], 12, 'older migration edicts beyond the last 80 stay counted');
  const old = rec('', {}, [ans('fence', 3)]), n = rec('', {}, [ans('fence', 3), ans('river', 1)]);
  g.scan(n, old, now);
  assert.equal(n.tly['iss:nb'], 2, 'the old one by the catch-up, the new one by the scan, neither twice');
});

test('a record counted from scratch gets the same number', () => {
  const n = { name: 'Zatraland', updatedAt: now, log: [], answered: [ans('fence', 3), ans('river', 2), ans('roads', 1)], s: {} };
  tally().scan(n, null, now);
  assert.equal(n.tly['iss:nb'], 2);
});
