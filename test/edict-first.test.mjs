// A new nation's fourth edict (the first timed one, after the founding edict and the two on the desk) arrives ten
// minutes after founding; the clock then keeps the nation's own pace. Runs the game's own syncInbox on a nation
// founded the way found() founds it.
//   node --test test/edict-first.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const MIN = 60000, src = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const J = o => JSON.parse(JSON.stringify(o));
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };

function game() {
  const ctx = vm.createContext({});
  const found = cut('  for(let i=0;i<2;i++){n.inbox.push({id:pickIssue(n),at:now});n.issueSeq++;}', '  /* Start over');
  vm.runInContext(`
    const CAP_BASE=5,CAP_VIP=10,EDICT_KEEP=CAP_VIP,DAY=864e5,window={},document={addEventListener(){}},NORM_HOOKS=[],S={};let VIP_RUNS=[];${src.match(/function edictCapAt\(t\) \{[^\n]*\}/)[0]}
    ${src.match(/const FREQS = [^\n]*/)[0]}
    ${src.match(/const EDICT_FIRST=\d+;/)[0]}
    const clone=o=>JSON.parse(JSON.stringify(o));function incomingShared(){return [];}function sharedInto(){}
    function b1Draw(m){return {id:'e'+m.issueSeq,at:m.issueClock};}
    let DRAWN=[];function pickIssue(n){DRAWN.push(n.issueClock);return 'start'+n.issueSeq;}
    ${cut('const AWAY_MIN=10*60000;', 'function foundStats(')}
    /* found(), from the moment the new nation exists up to the Start over carry */
    function found(now){const n={inbox:[],issueClock:now,issueSeq:0,freq:FREQ_DEF};DRAWN=[];
${found}      return n;}
    this.G={syncInbox,found,FREQ_DEF,EDICT_FIRST,drawn:()=>DRAWN};`, ctx);
  return ctx.G;
}

test('founding: two edicts on the desk, drawn at the founding moment, and the clock set back a slot less ten minutes', () => {
  const G = game(), t0 = Date.UTC(2026, 10, 15, 9);
  assert.equal(G.EDICT_FIRST, 10);
  assert.equal(G.FREQ_DEF, 30);
  const n = G.found(t0);
  assert.deepEqual(J(n.inbox.map(x => x.at)), [t0, t0]);
  assert.deepEqual(J(G.drawn()), [t0, t0], 'the starting edicts are drawn at the founding moment, not at the earlier clock');
  assert.equal(n.issueClock, t0 - 20 * MIN);
});

test('the fourth edict ten minutes in, then one every 30 minutes', () => {
  const G = game(), t0 = Date.UTC(2026, 10, 15, 9), n = G.found(t0), at = m => G.syncInbox(n, t0 + m * MIN);
  assert.equal(at(0).inbox.length, 2);
  assert.equal(at(9.9).inbox.length, 2, 'nothing before ten minutes');
  const v = at(10);
  assert.equal(v.inbox.length, 3, 'ten minutes after founding: one more');
  assert.equal(v.inbox[2].at, t0 + 10 * MIN, 'drawn at its own slot');
  assert.equal(v.issueClock, t0 + 10 * MIN, 'the clock now runs from that edict');
  assert.equal(at(39.9).inbox.length, 3, 'the next waits a whole 30 minutes');
  assert.equal(at(40).inbox.length, 4);
  assert.equal(at(70).inbox.length, 5);
});

test('a nation that changes its pace before the fourth arrives keeps the head start of 20 minutes', () => {
  const G = game(), t0 = Date.UTC(2026, 10, 15, 9), n = G.found(t0);
  const hourly = { ...n, freq: 60 };
  assert.equal(G.syncInbox(hourly, t0 + 39.9 * MIN).inbox.length, 2);
  assert.equal(G.syncInbox(hourly, t0 + 40 * MIN).inbox.length, 3);
});
