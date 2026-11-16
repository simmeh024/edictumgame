// Quick early buildings (2026-11-16, the owner: "Second building to build should take 5 min as well", then "Set the
// first at 2 min, 3rd at 8 min"): the quick first building takes FFB_MS (2 minutes), and the second and third buildings a
// nation starts, of any kind but a wonder and in any city, take QB_MS (5 and 8 minutes) instead of hours, once each.
// Run with: node --test test/second-build.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const line=start=>{const a=source.indexOf(start);assert(a>0,`the game still has ${start}`);return source.slice(a,source.indexOf('\n',a));};
const fn=name=>{const a=source.indexOf(`function ${name}(`);assert(a>0,`the game still has ${name}`);return source.slice(a,source.indexOf('\n}\n',a)+2);};
const MIN=60000;

function load(){
  const ctx={BUILDINGS:{farm:{n:'Farm Estates',h:2},sawmill:{n:'Sawmill',h:3},market:{n:'Market Hall',h:3},colossus:{n:'Colossus',h:24,w:1}},
    tallyOf:(n,k)=>(n.tly&&n.tly[k])||0};
  vm.createContext(ctx);
  vm.runInContext([line('const FFB_MS='),line('const QB_MS='),fn('qbMs'),line('const qbNth=')].join('\n').replace(/^const /gm,'var '),ctx);
  return ctx;
}
const city=(...ks)=>({id:'c1',b:ks.map(k=>({k,s:1,d:2}))});
const nation=(ks,o={})=>({cities:[city(...ks)],tly:{build:ks.length},...o});

test('the first building takes 2 minutes, the second 5 and the third 8',()=>{
  const G=load();
  assert.equal(G.FFB_MS,2*MIN);
  assert.deepEqual([...G.QB_MS],[5*MIN,8*MIN]);
  assert.deepEqual([...G.QB_ORD],['second','third']);
});

test('a nation with one building gets its second in 5 minutes, then its third in 8',()=>{
  const G=load();
  assert.equal(G.qbMs(nation(['farm'])),5*MIN);
  assert.equal(G.qbNth(nation(['farm'])),2);
  assert.equal(G.qbMs(nation(['farm']),'sawmill'),5*MIN);
  assert.equal(G.qbMs(nation(['farm'],{qb:1}),'sawmill'),0,'the second is used: not again with one building');
  assert.equal(G.qbMs(nation(['farm','sawmill'],{qb:1}),'market'),8*MIN,'the third');
  assert.equal(G.qbNth(nation(['farm','sawmill'])),3);
  assert.equal(G.qbMs(nation(['farm','sawmill'])),8*MIN,'an older nation with two buildings gets a quick third');
  assert.equal(G.qbMs({cities:[city(),{id:'c2',b:[{k:'farm',s:1,d:2}]}],tly:{build:1}}),5*MIN,'the first may stand in any city');
  assert.equal(G.qbMs({cities:[city('farm')]}),5*MIN,'an older nation whose first building has no tally');
});

test('never for the first, the fourth, a wonder, a computer nation, or twice',()=>{
  const G=load();
  assert.equal(G.qbMs({cities:[city()]}),0,'the first building has its own quick offer');
  assert.equal(G.qbMs(nation(['farm','sawmill','market'],{qb:2})),0,'a fourth takes its usual time');
  assert.equal(G.qbMs(nation(['farm','sawmill','market'])),0);
  assert.equal(G.qbMs(nation(['farm','sawmill'],{qb:2})),0,'the third is used');
  assert.equal(G.qbMs(nation(['farm']),'colossus'),0,'a wonder takes its usual time');
  assert.equal(G.qbMs(nation(['farm'],{tly:{build:3}})),0,'a nation that built more and lost some');
  assert.equal(G.qbMs(nation(['farm'],{npc:1})),0,'not for computer nations');
  assert.equal(G.qbMs(null),0);
});

test('starting or queueing one builds it quickly and counts it used',()=>{
  for(const f of ['startBuild','c3Queue']){
    const b=fn(f);
    assert.match(b,/quick=qbMs\(S\.nation,key\),nth=qbNth\(S\.nation\),ms=quick\|\|cxHours\(S\.nation,ct,key\)\*3600e3/,f);
    assert.match(b,/if\(quick\)n\.qb=nth-1;/,f);
  }
  assert.match(fn('startBuild'),/\$\{quick\?`, as your \$\{QB_ORD\[nth-2\]\} building`:''\}/,'the toast says why it is quick');
});

test('the count survives the save, and the Build tab shows the short time',()=>{
  assert.match(source,/if\(d&&Number\.isInteger\(d\.qb\)&&d\.qb>0&&d\.qb<=QB_MS\.length\)n\.qb=d\.qb;else delete n\.qb;/);
  assert.match(fn('catalog'),/<span class="opt-t">\$\{qbMs\(n,k\)\?esc\(fmtDur\(qbMs\(n,k\)\)\):cxHours\(n,ct,k\)\+' h'\}<\/span>/);
  assert.match(fn('catalog'),/Your \$\{QB_ORD\[qbNth\(n\)-2\]\} building goes up in <b>\$\{esc\(fmtDur\(qbMs\(n\)\)\)\}<\/b> instead of hours/);
});

// Staging playthrough (2026-11-16): a new player who went to Cities before claiming any land got no quick first
// building and waited 2 hours; the offer must not wait for a claimed hex.
test('the quick first building is offered before any land is claimed', () => {
  const f = fn('ffbOffer');
  assert.doesNotMatch(f, /lcHeld\(n\)<1/);
  assert.match(f, /cellOf\(n\.loc\)<0/, 'it still waits for a settled capital');
});
