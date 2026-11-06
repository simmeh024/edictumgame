// The Games' results (game/edictum.html, gamesResults): a player's scores are capped at what its stats allow, plus 3. A
// finished edition was capped at the stats the nation has today, so its podium moved as stats changed weeks later; it is
// now capped at the stats the nation had when the edition ended, from its history.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  if (at < 0) return '';
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
assert.ok(fn('gamesResults'), 'gamesResults is found');
const WEEK = 7 * 864e5, EPOCH = Date.UTC(2026, 0, 5);
/* one event, scored straight from the 'sport' stat; a player's entry holds the score it entered with */
function games(nations, now) {
  const ctx = vm.createContext({ nations, NOW: now });
  vm.runInContext(`
    const STAT_KEYS=['sport'],GAMES_EPOCH=${EPOCH},GAMES_WEEK=${WEEK},HOST_BONUS=8;
    const edOf=t=>Math.floor((t-GAMES_EPOCH)/GAMES_WEEK),edStart=e=>GAMES_EPOCH+e*GAMES_WEEK,b1Now=()=>NOW;
    const allNations=()=>nations,entryOf=(n,e)=>((n&&n.games&&n.games.en)||[]).find(q=>q.e===e);
    const gamesHost=()=>({id:'nobody'}),edEvents=()=>['run'],gamesBids=()=>[],npcAt=()=>null,formOf=()=>0,dqOf=()=>false;
    const baseScores=(n)=>({run:n.s.sport});
    ${fn('gamesStatsAt')}
    let gamesMemo={k:'',v:null};
    ${fn('gamesResults')}
    this.results=e=>gamesResults(e).res.run.map(r=>[r.p.id,r.v]);`, ctx);
  return ctx;
}
const player = (id, sportNow, entered, hist) => ({ id, n: { name: id, s: { sport: sportNow }, games: { en: [{ e: 0, t: EPOCH + 3600e3, f: '', sc: { run: entered } }] }, hist } });

test('a finished edition keeps the scores the stats allowed when it ended', () => {
  /* Ada entered edition 0 with 60 and held 60 to its end; her stats have since fallen to 20. Bo entered with 50 */
  const end = EPOCH + WEEK;
  const ada = player('ada', 20, 60, [{ t: EPOCH + 2 * 3600e3, s: [60] }, { t: end - 3600e3, s: [60] }, { t: end + 5 * 864e5, s: [20] }]);
  const bo = player('bo', 50, 50, [{ t: end - 3600e3, s: [50] }]);
  const G = games([ada, bo], end + 10 * 864e5);
  assert.deepEqual([...G.results(0)].map(r => [...r]), [['ada', 60], ['bo', 50]], 'Ada keeps her gold');
});

test('the edition under way is still capped at today’s stats', () => {
  const ada = player('ada', 20, 60, [{ t: EPOCH + 2 * 3600e3, s: [60] }]);
  const G = games([ada], EPOCH + 3 * 864e5);
  assert.deepEqual([...G.results(0)].map(r => [...r]), [['ada', 23]]);
});

test('a record with no history from then is capped at today’s stats, as before', () => {
  const ada = player('ada', 20, 60, [{ t: EPOCH + 30 * 864e5, s: [20] }]);
  const G = games([ada], EPOCH + 40 * 864e5);
  assert.deepEqual([...G.results(0)].map(r => [...r]), [['ada', 23]]);
});

test('a forged entry is still held to the stats it had then, plus 3', () => {
  const ada = player('ada', 20, 99, [{ t: EPOCH + WEEK - 3600e3, s: [40] }]);
  const G = games([ada], EPOCH + 10 * 864e5);
  assert.deepEqual([...G.results(0)].map(r => [...r]), [['ada', 43]]);
});
