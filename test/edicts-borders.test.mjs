// Five edicts on border control, from Sealed Borders to Free Movement, and what the two new laws do to migration.
// Run with: node --test test/edicts-borders.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const START='/* ───────── five edicts on border control',END='\n/* ───────── ';
const STAT_KEYS=JSON.parse(source.match(/const STAT_KEYS = (\[[^\]]+\])/)[1].replace(/'/g,'"'));
const LADDER=['sealedBorders','exitTax','borderWall','openBorders','freeMovement'];
const OLDER=2451;

function load(){
  const ctx={ISSUES:new Array(OLDER).fill(null).map((x,i)=>({id:'old'+i})),ISSUE_BY_ID:{},ISSUES_RANDOM:[]};
  vm.createContext(ctx);
  const a=source.indexOf(START),b=source.indexOf(END,a+START.length);
  assert(a>source.indexOf('for(const is of SHOW_ISSUES)'),'after the spectacle edicts, so no number moves');
  assert(b<=source.indexOf('/* ───────── the browser tab'));
  assert.equal(source.indexOf('ISSUES.push(',b),-1,'no edict is added after this section');
  vm.runInContext(source.slice(a,b)+'\nthis.J=JSON.stringify({X:BRD_ISSUES,R:BRD_ISSUES.map(is=>ISSUES_RANDOM.includes(is))});',ctx);
  return JSON.parse(ctx.J);
}

test('five new edicts, numbered after every older one, drawn at random',()=>{
  const c=load();
  assert.deepEqual(c.X.map(x=>x.no),[2452,2453,2454,2455,2456]);
  c.X.forEach((x,i)=>{assert(c.R[i]&&!x.req);assert.equal(source.split(`{id:'${x.id}',`).length,2,x.id);assert.equal(source.split(`t:'${x.t}'`).length,2,x.t);});
  assert(/'BRD_ISSUES'/.test(readFileSync(new URL('../scripts/split-content.mjs',import.meta.url),'utf8')));
});

test('every option sets the whole border ladder, and together they reach every step',()=>{
  const c=load(),seen=new Set();
  for(const is of c.X)for(const o of is.o){
    assert.deepEqual(Object.keys(o.e.p).sort(),[...LADDER].sort(),is.id);
    const on=LADDER.filter(k=>o.e.p[k]===1);seen.add(on.join('+')||'ordinary');
    assert(on.length<=1||on.join()==='exitTax,borderWall',is.id+' one step at a time');
    for(const [k,v] of Object.entries(o.e))if(k!=='p'&&k!=='b')assert(STAT_KEYS.includes(k)&&Math.abs(v)<=4,is.id+' '+k);
    for(const t of [o.t,o.fx])assert(!/['"]/.test(t),is.id+' typographic quotes');
  }
  for(const s of ['sealedBorders','exitTax','borderWall','ordinary','openBorders','freeMovement'])assert(seen.has(s),s);
});

test('the laws exist, conflict sensibly and drive migration',()=>{
  for(const k of LADDER)assert(source.includes(k+":['"),k);
  assert(source.includes("['sealedBorders','openBorders'],['sealedBorders','freeMovement'],['sealedBorders','exitTax']"));
  assert(source.includes('exit=pi.sealedBorders?0:pi.exitTax?0.5:pi.freeMovement?1.25:1;if(!exit)continue;'),'nobody leaves a sealed nation');
  assert(source.includes('if(pj.sealedBorders)continue;'),'nobody moves into a sealed nation');
  assert(source.includes("(pj.freeMovement?1.6:0)"),'free movement draws more arrivals');
});
