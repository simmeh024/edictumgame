// The riddle of the week: the weekly job (jobs/fx/riddle.mjs) makes riddles from the game's own maps, the server
// (functions/riddles.js) takes the guesses, and the game (RD_RULES, "the riddle of the week") shows them. These checks keep
// the three in step, and make riddles for every region to see that each has exactly one answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as R from '../functions/riddle-rules.js';
import { regionGeo, makeRiddle, solve, bearing } from '../jobs/fx/riddle.mjs';
import { loadWorld } from '../jobs/fx/world.mjs';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const lineOf = start => { const l = html.split('\n').find(x => x.startsWith(start)); assert.ok(l, start + ' is found'); return l; };

test('the game and the server share the riddle’s rules and its ids', () => {
  const G = vm.runInNewContext('(' + lineOf('const RD_RULES=').slice('const RD_RULES='.length).replace(/;$/, '') + ')');
  assert.equal(G.tries, R.RD_TRIES); assert.equal(G.top, R.RD_TOP); assert.equal(G.week, R.RD_WEEK);
  assert.equal(lineOf('const RD_ID='), 'const RD_ID=' + String(R.RD_ID) + ';');
  /* the week is the weekly letters' week: Monday 08:00 UTC */
  const weekStart = new Function(lineOf('const weekStart=') + ';return weekStart;')();
  const rdIdAt = new Function('weekStart', 'REG', lineOf('function rdIdAt(t)') + ';return rdIdAt;')(weekStart, { id: 'greywater' });
  for (const t of [Date.UTC(2026, 10, 16, 7, 59), Date.UTC(2026, 10, 16, 8), Date.UTC(2026, 10, 18, 12), Date.UTC(2026, 10, 22, 23, 59), Date.UTC(2027, 0, 1)]) {
    assert.equal(R.rdWeek(t), weekStart(t), new Date(t).toISOString());
    assert.equal(rdIdAt(t), R.rdId('greywater', t));
  }
  assert.equal(R.rdId('greywater', Date.UTC(2026, 10, 18, 12)), 'greywater_20261116');
  assert.equal(R.rdId('greywater', Date.UTC(2026, 10, 16, 7, 59)), 'greywater_20261109', 'before 08:00 on Monday it is still last week');
  assert.match(R.rdId('sunkenkingdoms', Date.now()), R.RD_ID);
});

test('every region gets riddles with exactly one answer, counted from a computer nation’s capital', () => {
  const src = html, W = loadWorld(src);
  let seed = 20261117; const rng = n => { seed = (seed * 48271) % 2147483647; return seed % n; };
  for (const reg of W.regions) {
    const geo = regionGeo(src, reg.id);
    for (let i = 0; i < 4; i++) {
      const Q = makeRiddle(geo, reg.npcs, rng);
      assert.ok(Q, reg.id + ' has a riddle');
      const cap = reg.npcs.find(x => x.id === Q.cap);
      assert.ok(cap && Q.lines[0].includes('the capital of ' + cap.name), Q.lines[0]);
      assert.ok(R.RD_DIRS.includes(Q.dir) && Q.lines[0].includes(Q.r + ' hexes to the ' + Q.dir));
      assert.ok(geo.M.T[Q.c] >= 2, 'the answer is land');
      assert.equal(geo.hexDist(geo.M.npcLoc[Q.cap], Q.c), Q.r, 'as many hexes from the capital as the game counts');
      const b = bearing(geo.M, geo.M.npcLoc[Q.cap], Q.c), i8 = R.RD_DIRS.indexOf(Q.dir), d = Math.abs(b - i8 * 45) % 360;
      assert.ok(Math.min(d, 360 - d) <= 12, 'the answer lies close to the line the direction names');
      assert.deepEqual(solve(geo, reg.npcs, Q), [Q.c], reg.id + ': ' + Q.lines.join(' / '));
      assert.ok(Q.lines.length >= 2 && Q.lines.length <= 5 && Q.lines.every(l => l.length <= 240));
    }
  }
});

test('the Dispatch prints it, the map panel takes a guess, and the first ten earn the Sharp-Eyed', () => {
  assert.match(html, /\['view','riddle','wx','figs','stars','fix'\]\.includes\(S\.dspSide\)/);
  assert.match(html, /boxes\.splice\(1,0,\['riddle','Riddle',box\('riddle','Riddle of the week'/);
  assert.match(html, /'t-sharp':\{k:'title',n:'the Sharp-Eyed',src:'ach'\}/);
  assert.match(html, /achDef\('press','rdl-top','s','Sharp-Eyed',[^\n]+u:'t-sharp'/);
  assert.match(html, /alReq\(\{op:'rdGuess',rid:R\.id,c\}\)/);
});

test('the server takes the guesses and keeps the answer to itself', () => {
  const civic = fs.readFileSync(new URL('../functions/civic.js', import.meta.url), 'utf8');
  assert.match(civic, /isRiddleOp\(d\.op\)\) return riddle\(db, who, d\)/);
  for (const f of ['accounts.js', 'admin.js']) assert.match(fs.readFileSync(new URL('../functions/' + f, import.meta.url), 'utf8'), /await rdForget\(db, /, f);
  const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /match \/riddles\/\{rid\} \{\n\s+allow read: if true;\n\s+match \/guesses\/\{uid\} \{ allow read: if request\.auth != null && request\.auth\.uid == uid; \}/);
  assert.doesNotMatch(rules, /match \/riddleKeys/, 'no rule opens the answers');
  const idx = JSON.parse(fs.readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8'));
  assert.ok(idx.fieldOverrides.some(o => o.collectionGroup === 'guesses' && o.fieldPath === 'u' && o.indexes.some(i => i.queryScope === 'COLLECTION_GROUP')));
  /* the job runs every Monday, after the week begins at 08:00 UTC */
  const wf = fs.readFileSync(new URL('../.github/workflows/riddle.yml', import.meta.url), 'utf8');
  assert.match(wf, /cron: '5 8 \* \* 1'/); assert.match(wf, /node jobs\/fx\/riddle\.mjs --project "\$PROJECT_ID"/);
});
