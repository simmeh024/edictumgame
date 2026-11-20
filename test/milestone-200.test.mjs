// The 200-nation gift (2026-11-20): once Edictum has 200 nations, each of the first two hundred gets a pop-up with two
// boxes, 200 of every material in one and the Platinum regalia in the other: eight things for Customise (the Ducenti
// pattern, the Moonstone map colour, the Twin arches shield, the Platinum tincture, the Milestone charge and flag
// emblem, the Platinum frame, the Platinum seal and the epithet "of the Two Hundred"). The first box opened earns the
// platinum achievement I Was Here at 200. These checks keep the pieces wired where the game asks for them; the
// browser test (test/milestone-200.mjs) opens the boxes and wears the regalia.
// Run with: node --test test/milestone-200.test.mjs
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const game=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const has=(s,why)=>assert.ok(game.includes(s),why||s);
const at=s=>{const i=game.indexOf(s);assert.ok(i>=0,s);return i;};

test('the gift’s constants come before the colour gate, the shields, the stock limit and the achievement that read them',()=>{
  const k=at("const M200_N=200,M200_MC='#8EA4BC',M200_MCN='Moonstone';");
  for(const s of ['function ctgMcOk(','const czShOk=','function xsMax(',"achDef('odd','odd-here200'"])assert.ok(at(s)>k,s+' after M200_N');
});

test('the first two hundred: all nations less those founded after this one, 200 or fewer, and only once 200 are there',()=>{
  has('M200.tot>=M200_N&&M200.after!=null&&M200.tot-M200.after<=M200_N');
  has('const M200_EVERY=10*60e3;');
  has("if(M200.f===f&&(M200.after!=null||Date.now()-M200.at<M200_EVERY))return;");
  has("if(!(tot>=M200_N)){M200.tot=tot;M200.after=null;M200.f=f;return;}");
  has("navigator.webdriver&&!window.EDICTUM_M200");
  has('function m200In(n){\n  if(m200Bits(n))return true;');
});

test('the two boxes: bits 1 and 2 of n.m200, kept by the record, the first allowed over the storage limit',()=>{
  has("NORM_HOOKS.push((n,d)=>{const v=d&&Number.isInteger(d.m200)?d.m200&3:0;if(v)n.m200=v;else delete n.m200;});");
  has("(typeof m200Bits==='function'&&m200Bits(n)&1?M200_N:0)",'xsMax allows the supplies above the limit');
  has('for(const r of RES)st[r]=num0(st[r])+M200_N;m.m200=b|1;xsMark(m,st,now);m.stock=roundStock(st);m.stockAt=now;m._stockSet=true;');
  has('const n=S.nation,b=m200Bits(n);if(!m200Due(n)||(b&k))return;','a box gives once');
  assert.ok(!/['"]m200['"]/.test(readFileSync(new URL('../src/shim.js',import.meta.url),'utf8')),'m200 stays in the public half, for other players to see the regalia worn');
});

test('the platinum achievement: earned with the first box opened',()=>{
  has("achDef('odd','odd-here200','p','I Was Here at 200','Be one of the nations in Edictum when it reached 200 nations, and open one of its gifts.',1,x=>achYes(m200Bits(x.n)>0),{fm:'bool'});");
  assert.equal((game.match(/achDef\('[a-z]+','odd-here200'/g)||[]).length,1,'defined once');
});

test('eight pieces of regalia: seven unlocks, the map colour through ctgMcOk and the shield as a milestone gift',()=>{
  has("const M200_U=['p-ducenti','tn-plat','c-milestone','e-milestone','f-platinum','s-platinum','t-ducenti'];");
  const kinds={'p-ducenti':'pattern','tn-plat':'tinct','c-milestone':'charge','e-milestone':'emblem','f-platinum':'frame','s-platinum':'stamp','t-ducenti':'title'};
  for(const [id,k] of Object.entries(kinds))has(`'${id}':{k:'${k}',`,id+' is a '+k);
  assert.equal((game.match(/src:'m200'/g)||[]).length,7,'all seven come from the gift alone');
  has("UNLOCK_SOURCES.push({earned:n=>m200Got(n)?M200_U.slice():[],");
  /* each is drawn */
  has("if(p!=='p-ducenti')return f.apply(this,arguments);",'czPatSVG draws the pattern');
  has("if(k!=='milestone')return f.apply(this,arguments);",'czCharge draws the Milestone');
  has("if(e!=='e-milestone')return f.apply(this,arguments);",'czEmblemSVG puts it on a flag');
  has("EMBLEMS['e-milestone']='Milestone';if(!CZ_EMBS.includes('e-milestone'))CZ_EMBS.push('e-milestone');",'the flag designer lists it');
  has("CZ_FR['f-platinum']=[18,18,264,34];");
  has("if(fr!=='f-platinum')return f.apply(this,arguments);",'czFrameArt draws the frame');
  has("if(s!=='s-platinum')return f.apply(this,arguments);",'czStampArt draws the seal');
  /* the tincture, a metal, held like the earned four, falling back to Argent */
  has("plat:['Platinum','#C3CCD6']};");
  has("const CZ_METAL={or:1,argent:1,gilt:1,plat:1};");
  has(",plat:'tn-plat'},CZ_TN_FB={");
  has(",plat:'argent'};");
  /* the map colour and the shield read n.m200 */
  has('function ctgMcOk(n,c){if(c===M100_MC)return m100Got(n);if(c===M200_MC)return m200Got(n);');
  has("const mcGiftName=c=>c===M100_MC?M100_MCN:c===M200_MC?M200_MCN:'';");
  has('${m100McSw(n,st)}${m200McSw(n,st)}');
  assert.equal(game.split("if(ctgMcOk(n,M200_MC))s+=sw(M200_MC,M200_MCN,'a gift for 200 nations');").length,2,'the Customise colour row');
  has("if(ctgMcOk(n,M200_MC))sws+=sw(M200_MC,M200_MCN,'a gift for 200 nations');",'the map look card');
  has("twin:'Twin arches'");
  has('const CZ_SH_GIFT={royal:50,triumph:100,twin:200};');
  has('const czShGot=(n,s)=>CZ_SH_GIFT[s]===200?m200Got(n):CZ_SH_GIFT[s]===100?m100Got(n):n.m50===1;');
  has("case 'twin':return 'M6,26C6,13");
});

test('one pop-up at a time: after the 50-player and 100-nation gifts, before the founders’ gift',()=>{
  has("document.getElementById('m100')||document.getElementById('m200')||!fgfOpen()",'the founders’ gift waits for it');
  has("document.getElementById('m200')||document.getElementById('m100')||m50Due(n)&&!m50Later||m100Due(n)&&!M100.later||m100Busy()",'it waits for the others');
  assert.ok(at('const M200_EVERY=')>at('const m100Busy='),'after the 100-nation gift, whose m100Busy it uses');
});
