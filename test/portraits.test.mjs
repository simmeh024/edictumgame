// Portraits of state (13 November 2026): the court painter's edict, and what a portrait's record keeps.
// The browser suite (test/portraits.mjs) plays the rest. Run with: node --test test/portraits.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const START='/* ───────── portraits of state: the court painter',END='\n/* ───────── ';
const STAT_KEYS=JSON.parse(source.match(/const STAT_KEYS = (\[[^\]]+\])/)[1].replace(/'/g,'"'));

test('the court painter’s edict: one edict, numbered after every older one, before the browser tab',()=>{
  const a=source.indexOf(START),b=source.indexOf(END,a+START.length);
  assert(a>0&&a>source.indexOf('for(const is of GMB_ISSUES)'),'after the crises and gambles, so no number moves');
  assert(b<=source.indexOf('/* ───────── the browser tab'),'before the browser tab');
  assert.equal(source.indexOf('ISSUES.push(',b),-1,'no edict is added after it');
  const ctx=vm.createContext({ISSUES:[],ISSUE_BY_ID:{},ISSUES_RANDOM:[]});
  vm.runInContext(source.slice(a,b)+'\nthis.J=JSON.stringify(PT_ISSUES);this.R=ISSUES_RANDOM.length;this.Q=String(PT_ISSUES[0].req);',ctx);
  const [is]=JSON.parse(ctx.J);
  assert.equal(is.id,'pt-court-painter');assert.equal(ctx.R,1,'drawn at random');assert.match(ctx.Q,/n\.ruler/,'asked of a nation whose leader has a name');
  assert.deepEqual(is.o.map(o=>o.e.pt),[1,2,3],'each answer says what the painter does');
  for(const o of is.o)for(const [k,v] of Object.entries(o.e)){
    if(k==='pt')continue;if(k==='cab'){assert.deepEqual(v,{all:5});continue;}
    assert(STAT_KEYS.includes(k),k);assert(Number.isInteger(v)&&Math.abs(v)>=1&&Math.abs(v)<=4,k+' '+v);
  }
  for(const s of [is.t,is.q,...is.o.flatMap(o=>[o.t,o.fx])])assert(!/["']/.test(s),'typographic quotes: '+s);
  assert(/'PT_ISSUES'/.test(readFileSync(new URL('../scripts/split-content.mjs',import.meta.url),'utf8')),'the content split carries it');
});

test('the portraits section: its record keys, its private fields, and the wrappers it relies on',()=>{
  const i=source.indexOf('/* ───────── portraits of state: the faces of the government');assert(i>0);
  const sec=source.slice(i,source.indexOf('\nconst hot=window.claude&&window.claude.hot;',i));
  assert(sec.length>1000,'the section sits just before the game starts');
  for(const k of ['n.rpt','n.cpt','n.cdc','n.ptu','n.ptz'])assert(sec.includes(k),k);
  const shim=readFileSync(new URL('../src/shim.js',import.meta.url),'utf8');
  assert(/NX_KEYS\.ptu = NX_KEYS\.ptz = 1;/.test(shim),'earned pieces and the term are private');
  assert(!/'rpt'|'cpt'|'cdc'|NX_KEYS\.(rpt|cpt|cdc)\b/.test(shim.slice(shim.indexOf('var NX_KEYS'),shim.indexOf('function splitNation'))),'the looks stay shared: visitors see them');
  for(const w of ['cvMed=(f=>','cuBustArt=(f=>','geoAfter=(f=>','logLine=(f=>','rewardInfo=(f=>'])assert(sec.includes(w),w);
  assert(source.includes('.cz-dock[data-sec="r"]~.cz-sec:not(#cz-sec-r)'),'Customise hides the section when another is open');
  /* the banknotes' past series keep the portrait of their last day */
  assert(/p=ptSnapNorm\(x\.p\);if\(p\)o\.p=p;return o;/.test(source),'n.cuS keeps p');
});
