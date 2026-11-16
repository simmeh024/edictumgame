// The 100-nation gift (2026-11-16): once Edictum has 100 nations, each of the first hundred gets a pop-up with two
// boxes, 100 of every material in one and the Triumph regalia (Centum pattern, Triumph Purple map colour, Triumphal
// arch shield) in the other. These checks keep the pieces wired where the game asks for them; the browser test
// (test/milestone-100.mjs) opens the boxes.
// Run with: node --test test/milestone-100.test.mjs
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const game=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const has=(s,why)=>assert.ok(game.includes(s),why||s);
const at=s=>{const i=game.indexOf(s);assert.ok(i>=0,s);return i;};

test('the gift’s constants come before the colour gate, the shields and the stock limit that read them',()=>{
  const k=at('const M100_N=100,M100_MC=');
  for(const s of ['function ctgMcOk(','const czShOk=','function xsMax('])assert.ok(at(s)>k,s+' after M100_N');
});

test('the first hundred: all nations less those founded after this one, 100 or fewer, and only once 100 are there',()=>{
  has('M100.tot>=M100_N&&M100.after!=null&&M100.tot-M100.after<=M100_N');
  has("S.db.count('summaries',[['f','>',f]])",'those founded after: by the founding time in the public summary');
  has("S.db.count('summaries')",'all nations');
  /* the count is paced: again every ten minutes until 100, then once a visit, and never in a test browser unless asked */
  has('const M100_EVERY=10*60e3;');
  has("if(M100.f===f&&(M100.after!=null||Date.now()-M100.at<M100_EVERY))return;");
  has("navigator.webdriver&&!window.EDICTUM_M100");
  /* a box opened settles it for good */
  has('function m100In(n){\n  if(m100Bits(n))return true;');
});

test('the summary still carries the founding time the count needs',()=>{
  const shim=readFileSync(new URL('../src/shim.js',import.meta.url),'utf8');
  assert.match(shim,/sum\.f = Math\.floor\(data\.founded\)/);
  const rules=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
  assert.match(rules,/match \/summaries\/\{uid\} \{\s*allow read: if true;/,'anyone may count the summaries');
});

test('the two boxes: bits 1 and 2 of n.m100, kept by the record, the first allowed over the storage limit',()=>{
  has("NORM_HOOKS.push((n,d)=>{const v=d&&Number.isInteger(d.m100)?d.m100&3:0;if(v)n.m100=v;else delete n.m100;});");
  has("(typeof m100Bits==='function'&&m100Bits(n)&1?M100_N:0)",'xsMax allows the supplies above the limit');
  has('for(const r of RES)st[r]=num0(st[r])+M100_N;m.m100=b|1;xsMark(m,st,now);m.stock=roundStock(st);m.stockAt=now;m._stockSet=true;');
  has('const n=S.nation,b=m100Bits(n);if(!m100Due(n)||(b&k))return;','a box gives once');
  assert.ok(!/['"]m100['"]/.test(readFileSync(new URL('../src/shim.js',import.meta.url),'utf8')),'m100 stays in the public half, for other players to see the regalia worn');
});

test('the regalia: the pattern as an unlock, the map colour through ctgMcOk, the shield as a milestone gift',()=>{
  has("UNLOCKS['p-centum']={k:'pattern',n:'Centum',src:'m100'};");
  has("UNLOCK_SOURCES.push({earned:n=>m100Got(n)?['p-centum']:[],");
  has("if(p!=='p-centum')return f.apply(this,arguments);",'czPatSVG draws it');
  has('function ctgMcOk(n,c){if(c===M100_MC)return m100Got(n);');
  has("triumph:'Triumphal arch'");
  has('const CZ_SH_GIFT={royal:50,triumph:100};');
  has("case 'triumph':return 'M6,24H22");
  /* the colour shows wherever map colours are chosen or named, once held */
  has('${mapcEarnedSw(n,st)}${ctgMcSw(n,st)}${m100McSw(n,st)}');
  has("if(ctgMcOk(n,M100_MC))sws+=sw(M100_MC,M100_MCN,");
  assert.equal((game.match(/\|\|mcGiftName\(/g)||[]).length,3,'Settings, the map look card and its toast name it');
});

test('one pop-up at a time',()=>{
  has("document.getElementById('m50')||document.getElementById('m100')||!fgfOpen()",'the founders’ gift waits for it');
  has("m50Due(n)&&!m50Later||m100Busy()",'it waits for the 50-player gift and any other open dialog');
});
