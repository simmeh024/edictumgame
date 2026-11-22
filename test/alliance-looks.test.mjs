// Alliance looks (22 Nov 2026): the pure parts, sliced out of the game and run on their own: the banner's frame by
// level, the second colour (chosen, else the banner's), the week's renown from the daily tallies, what a moment shows
// (a level risen, a project built) and what a level opens, the jagged line of a rivalry, the time under attack; and the
// server's check of the coat of arms the charter saves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../functions/alliances.js', import.meta.url), 'utf8');
/* a top-level function: its first line, and its indented body down to the closing brace at the start of a line */
const fn = (name, src = html) => {
  const at = src.indexOf('\nfunction ' + name + '('); assert.ok(at >= 0, name + ' is in the game');
  const lines = src.slice(at + 1).split('\n'), out = [lines[0]];
  if (!lines[1].startsWith(' ') && lines[1] !== '}') return lines[0];
  for (const l of lines.slice(1)) { out.push(l); if (l === '}') break; }
  return out.join('\n');
};
const line = (re, what) => { const m = re.exec(html); assert.ok(m, what + ' is in the game'); return m[0]; };
const constOf = name => { const at = html.indexOf('const ' + name + '='); assert.ok(at >= 0, name); let i = html.indexOf('{', at), d = 0; for (; i < html.length; i++) { const c = html[i]; if (c === '{') d++; else if (c === '}' && --d === 0) break; } return html.slice(at, i + 1) + ';'; };

const ctx = vm.createContext({ DAY: 86400000, num0: v => Number(v) || 0, safeColor: (c, d) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toUpperCase() : d,
  list: a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1], PATTERNS: { saltire: ['Saltire'], cross: ['Cross'] }, EMBLEMS: { crown: 'Crown', anchor: 'Anchor' } });
vm.runInContext([line(/const AL_TIER_N=[^\n]*/, 'AL_TIER_N'), fn('alTier'), fn('alAccOf'), line(/const AL_DEF_EM=[^\n]*/, 'AL_DEF_EM'), fn('alWeekData'), fn('alMoDiff'), fn('alLvOpens'), fn('alZig'), fn('alSince'),
  constOf('AL_RULES'), constOf('AL_PJ'), line(/const AL_PAT_LV=[^\n]*/, 'AL_PAT_LV'), line(/const AL_EMB_LV=[^\n]*/, 'AL_EMB_LV'),
  'Object.assign(this,{alTier,alAccOf,alWeekData,alMoDiff,alLvOpens,alZig,alSince});'].join('\n'), ctx);
const { alTier, alAccOf, alWeekData, alMoDiff, alLvOpens, alZig, alSince } = ctx;
/* through JSON, so arrays and objects made in the sandbox compare with this realm's */
const J = v => JSON.parse(JSON.stringify(v));

test('the frame: none to level 3, bronze from 4, silver from 7, gold at 10', () => {
  assert.deepEqual(J([1, 3, 4, 6, 7, 9, 10].map(alTier)), ['', '', 'b', 'b', 's', 's', 'g']);
});

test('the second colour: the leader’s, else the banner’s second, or its third when the second is the map colour', () => {
  assert.equal(alAccOf({ ac: '#2a9d8f', col: '#3A8FD1', em: { c: ['#111111', '#222222', '#333333'] } }), '#2A9D8F');
  assert.equal(alAccOf({ col: '#3A8FD1', em: { c: ['#111111', '#222222', '#333333'] } }), '#222222');
  assert.equal(alAccOf({ col: '#222222', em: { c: ['#111111', '#222222', '#333333'] } }), '#333333');
  assert.equal(alAccOf({ col: '#3A8FD1', em: {} }), '#F2C230', 'no banner colours: the default banner’s');
});

test('the week: renown each day from the tallies, this week against the last, and what earned it', () => {
  const now = Date.UTC(2026, 10, 22, 12), D = 86400000, t = (d, x, b) => ({ t: now - d * D, k: 'tally', x: String(x), b: JSON.stringify(b) });
  const W = alWeekData({ log: [t(0, 24, { active: 2, deals: 1 }), t(1, 18, { gifts: 1, active: 2 }), t(8, 10, { active: 1 }), t(20, 99, { active: 9 }), { t: now, k: 'join' }] }, now);
  assert.equal(W.days.length, 14);
  assert.equal(W.wk, 42); assert.equal(W.prev, 10, 'three weeks ago is not counted');
  assert.deepEqual(J(W.parts), { active: 4, deals: 1, gifts: 1, battles: 0, calls: 0 });
  assert.equal(W.days[13].v, 24); assert.equal(W.days[12].v, 18); assert.equal(W.days[5].v, 10);
});

test('moments: a level risen and each project built, nothing the first time an alliance is seen', () => {
  assert.deepEqual(J(alMoDiff(null, { l: 4, pj: { hall: 1 } })), []);
  assert.deepEqual(J(alMoDiff({ l: 4, pj: { hall: 1 } }, { l: 4, pj: { hall: 1 } })), []);
  assert.deepEqual(JSON.parse(JSON.stringify(alMoDiff({ l: 3, pj: { hall: 1 } }, { l: 5, pj: { hall: 2, arsenal: 1 } }))), [{ k: 'lv', from: 3, to: 5 }, { k: 'pj', p: 'hall', lv: 2 }, { k: 'pj', p: 'arsenal', lv: 1 }]);
});

test('what a level opens: places, a frame, banner designs, the type’s projects', () => {
  const o = alLvOpens('def', 3, 4);
  assert.equal(o[0], '2 more member places');
  assert.ok(o.some(x => /bronze frame/.test(x)), 'level 4 frames the banner in bronze');
  assert.ok(o.some(x => /emblems: .*anchor/.test(x)), 'the anchor opens at 4');
  assert.ok(o.some(x => /to build: .*Beacon Towers/.test(x)), 'a defence pact may build its Beacon Towers’ second level');
  assert.ok(!alLvOpens('trade', 3, 4).some(x => /Beacon/.test(x)), 'a trade bloc is not offered a defence pact’s project');
  assert.equal(alLvOpens('def', 1, 3)[0], '4 more member places', 'two levels at once');
});

test('a rivalry’s line zigzags from one circle to the other', () => {
  const d = alZig(0, 0, 90, 0);
  assert.match(d, /^M0\.0,0\.0L/); assert.match(d, /L90\.0,0\.0$/);
  assert.ok((d.match(/L/g) || []).length >= 9);
});

test('the time under attack', () => {
  const now = Date.UTC(2026, 10, 22, 12);
  assert.equal(alSince(now - 7 * 60000, now), '7 min');
  assert.equal(alSince(now - (3 * 60 + 12) * 60000, now), '3 h 12 min');
  assert.equal(alSince(now - (2 * 1440 + 4 * 60) * 60000, now), '2 days 4 h');
});

test('the server keeps arms of known shape and refuses others', () => {
  const sctx = vm.createContext({});
  vm.runInContext([server.match(/const KEY = [^\n]*/)[0], fn('armsOf', server), 'this.armsOf=armsOf;'].join('\n'), sctx);
  const { armsOf } = sctx, j = v => JSON.parse(JSON.stringify(v));
  assert.deepEqual(j(armsOf({ s: 'heater', d: 'fess', t: ['gules', 'or'], c: 'lion', ct: 'or', x: 'dropped' })), { s: 'heater', d: 'fess', t: ['gules', 'or'], c: 'lion', ct: 'or' });
  assert.deepEqual(j(armsOf({ s: 'heater', d: 'plain', t: ['azure', 'argent'], c: '', ct: 'or' })).c, '', 'no charge');
  for (const bad of [null, [], 'arms', { s: 'heater', d: 'fess', t: ['gules'], c: 'lion', ct: 'or' }, { s: 'Heater!', d: 'fess', t: ['gules', 'or'], c: 'lion', ct: 'or' }, { s: 'heater', d: 'fess', t: ['gules', 'or'], c: '<b>', ct: 'or' }])
    assert.equal(armsOf(bad), null, JSON.stringify(bad));
});
