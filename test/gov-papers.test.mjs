// Papers of your government: a classification the nation once had stays held after its history snapshots (about
// eleven days) and its log (60 entries) roll past it, because n.gcs keeps each one for good (govCatsHeld, gcsNorm,
// and their commit and load hooks), evaluated from the game's own source. Run with: node --test test/gov-papers.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8'), src = html.match(/<script>([\s\S]*)<\/script>\s*$/)[1];
const fn = name => { const i = src.indexOf('function ' + name + '('), j = src.indexOf('\n}\n', i); assert.ok(i >= 0 && j > i, name); return src.slice(i, j + 2); };
const line = start => { const i = src.indexOf(start), j = src.indexOf('\n', i); assert.ok(i >= 0, start); return src.slice(i, j); };
const block = (start, end) => { const i = src.indexOf(start), j = src.indexOf(end, i); assert.ok(i >= 0 && j > i, start); return src.slice(i, j + end.length); };
const ctx = vm.createContext({});
vm.runInContext(`${block('const CATS = [', '];')}
const STAT_KEYS=['civil','econ','pol'],COMMIT_HOOKS=[],NORM_HOOKS=[];
/* every classification has a paper, as LP_X gives each of the 27 one */
const LP_CAT=Object.fromEntries(CATS.map((c,i)=>[c,'lp-k'+i]));
${line('function classify(')}
${line('function sOfH(')}
${line('const LVL = ')}
${fn('govCatsHeld')}
${line('function gcsNorm(')}
${line('COMMIT_HOOKS.push(n=>{if(n.npc)return [];const all=gcsNorm')}
${line('NORM_HOOKS.push((n,d)=>{const a=gcsNorm')}
${line('function aClasses(')}
function achM(x,k,f){return f();}
function aCls(x){return classify(x.n.s);}
this.api={CATS,classify,govCatsHeld,gcsNorm,aClasses,commit:n=>{for(const h of COMMIT_HOOKS)h(n);return n;},norm:d=>{const n={};for(const h of NORM_HOOKS)h(n,d);return n;}};`, ctx);
const { CATS, classify, govCatsHeld, gcsNorm, aClasses, commit, norm } = ctx.api;
const plain = o => JSON.parse(JSON.stringify(o));
const S = (civil, econ, pol) => ({ civil, econ, pol });

test('a classification kept in n.gcs stays held when neither the history nor the log has it any more', () => {
  const now = S(50, 50, 50), cur = classify(now), old = ['Capitalizt', 'Scandinavian Liberal Paradise'];
  assert.ok(!old.includes(cur));
  const n = { s: now, hist: [{ t: 1, s: [50, 50, 50] }], log: [{ k: 'war' }], gcs: old };
  assert.deepEqual([...govCatsHeld(n)].sort(), [...old, cur].sort());
  assert.equal(aClasses({ n }), 3);
});

test('every save adds what the nation is and was lately, and never takes a paper away', () => {
  const n = { s: S(90, 90, 90), hist: [{ t: 1, s: [10, 10, 10] }], log: [{ k: 'cat', a: 'Corrupt Dictatorship', b: 'Anarchy' }] };
  commit(n);
  const first = plain(n.gcs);
  assert.deepEqual(first, plain(gcsNorm([classify(S(90, 90, 90)), classify(S(10, 10, 10)), 'Corrupt Dictatorship', 'Anarchy'])));
  assert.deepEqual(first, plain(CATS.filter(c => first.includes(c))), 'kept in CATS order');
  // the history and the log roll past all of them: the record still has every one
  n.hist = []; n.log = []; n.s = S(50, 50, 50);
  commit(n);
  assert.deepEqual(plain(n.gcs), plain(gcsNorm([...first, classify(n.s)])));
  // a save with nothing new leaves the list as it was
  const before = n.gcs; commit(n); assert.equal(n.gcs, before);
});

test('computer nations get no list', () => {
  const n = { npc: true, s: S(50, 50, 50) }; commit(n); assert.equal(n.gcs, undefined);
});

test('loading keeps only the Bureau’s names, each once, in CATS order', () => {
  assert.deepEqual(plain(norm({ gcs: ['Anarchy', 'Not a class', 7, null, 'Psychotic Dictatorship', 'Anarchy'] }).gcs), ['Psychotic Dictatorship', 'Anarchy']);
  assert.equal(norm({ gcs: 'Anarchy' }).gcs, undefined);
  assert.equal(norm({}).gcs, undefined);
  assert.equal(norm(null).gcs, undefined);
});
