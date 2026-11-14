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

test('twenty-two kinds of hair, seventeen of dress and eight skin colours, the ten newer ones open to all; notes print without the skin',()=>{
  const i=source.indexOf('const PT_ROWS=['),rows=vm.runInNewContext(source.slice(i+'const PT_ROWS='.length,source.indexOf(';',i)));
  const by=Object.fromEntries(rows.map(r=>[r[0],r[2]]));
  assert.equal(rows[0][0],'s','the skin comes first');assert.equal(by.s.length,9);assert.equal(by.s[0],'Engraved','0 is the engraving in one ink');
  assert.equal(by.h.length,22);assert.equal(by.d.length,17);assert.equal(by.w.length,14);assert.equal(by.x.length,9);
  assert.deepEqual([...by.h.slice(0,10)],['Neat','Bun','Long','Full','Cropped','Swept','Powdered wig','Tied queue','Topknot','Braided'],'the older hair keeps its numbers');
  assert.deepEqual([...by.h.slice(10,20)],['Bald','Curly','Ponytail','Bob','Pompadour','Receding','Locs','Long waves','Cornrows','Long plait'],'and so does the hair added after it');
  assert.deepEqual([...by.d.slice(0,9)],['Suit','High collar','Plain','Military','Ruff','Cravat','Toga','Ermine robe','Chain of office'],'the older dress keeps its numbers');
  const SK=vm.runInNewContext(source.match(/const PT_SKIN=(\[[^;]+\]);/)[1]);
  assert.equal(SK.length,by.s.length);assert.equal(SK[0],null);
  for(const t of SK.slice(1))assert(t.length===2&&t.every(c=>/^#[0-9a-f]{6}$/.test(c)),'a skin and its line colour: '+t);
  const a=source.indexOf('const PT_LOCK={'),lk=source.slice(a,source.indexOf('};',a));
  for(let h=10;h<20;h++)assert(!new RegExp('\\bh'+h+':').test(lk),'hair '+h+' is open');
  for(let d=9;d<14;d++)assert(!new RegExp('\\bd'+d+':').test(lk),'dress '+d+' is open');
  assert(!/\bs\d:/.test(lk),'every skin is open');
  assert(/cuBustArt=\(f=>function\(id,seed,ink,cx,top,s,m,old,look\)\{\n  const L=ptPrint\(look\)/.test(source),'banknotes engrave the look without the skin');
  assert(/function ptSilhouette\(sub,fill,op\)\{\n  const L=ptPrint\(/.test(source),'and so do their silhouettes');
});

test('the Mayan Pack’s twelve portrait pieces: each a real part, sold in the Shop, never earned, and shown to others only while held',()=>{
  const cat=JSON.parse(readFileSync(new URL('../functions/shop-catalogue.json',import.meta.url),'utf8')).products.mayapack;
  const PS=vm.runInNewContext('('+source.match(/const PT_SHOP=(\{[^}]+\});/)[1]+')');
  const rp=cat.grants.filter(id=>id.startsWith('rp-'));
  assert.equal(rp.length,12);assert.deepEqual(Object.values(PS).sort(),rp.slice().sort(),'PT_SHOP names every portrait piece the pack grants, once');
  const i=source.indexOf('const PT_ROWS=['),rows=vm.runInNewContext(source.slice(i+'const PT_ROWS='.length,source.indexOf(';',i))),by=Object.fromEntries(rows.map(r=>[r[0],r[2]]));
  const rings=vm.runInNewContext(source.match(/const PT_RING_N=(\[[^\]]+\]);/)[1]),inks=source.match(/const PT_INKS=(\[.*\]);/)[1];
  for(const [p,id] of Object.entries(PS)){const k=p[0],v=p.slice(1);
    if(k==='r')assert.ok(rings[+v],p+' is a ring');else if(k==='i')assert.ok(inks.includes(`['${v}',`),p+' is an ink');else assert.ok(by[k]&&by[k][+v],p+' is a part');
    assert.ok(source.includes(`['${id}','portrait','`),id+' is a portrait piece in the Shop');}
  assert.deepEqual([by.h[20],by.h[21],by.w[11],by.w[12],by.w[13],by.d[14],by.d[15],by.d[16],by.x[7],by.x[8],rings[5]],['Tied crest','Jade-bound hair','Quetzal headdress','Jaguar headdress','Jade headband','Jade collar','Jaguar cape','Feather mantle','Jade ear spools','Nose bead','Stepped fret']);
  const a=source.indexOf('const PT_LOCK={'),lk=source.slice(a,source.indexOf('};',a));
  for(const p of Object.keys(PS))assert(!new RegExp('\\b'+p+':').test(lk),p+' is bought, not earned');
  assert.equal(vm.runInNewContext(source.match(/const PT_HAT_S=(\[[^\]]+\]);/)[1]).length,by.w.length,'every hat has its scale');
  /* another nation's record shows a Shop piece only while the Shop says it is held */
  assert(/const ptHas=\(n,id\)=>PT_SHOP\[id\]\?!!n&&typeof czHolds==='function'&&czHolds\(n,PT_SHOP\[id\],n\.cz\)/.test(source),'held as the Shop holds anything');
  assert(/function ptLead\(n,o\)\{\n  o=o\|\|\{\};const r=\(n&&n\.rpt\)\|\|\{\},L=ptKeep\(n,r\.l\|\|\{\}\)/.test(source),'the leader’s look');
  assert(/return ptKeep\(n,Object\.assign\(\{\},code\?code\[2\]:\{\},own\|\|\{\}\)\);\}/.test(source),'a minister’s look');
  assert(source.includes("look:ptKeep(n,(p&&p.l)||{})")&&source.includes('look:p&&ptKeep(n,p.l)'),'and past leaders, in the Museum and on old banknotes');
  assert(source.includes("if(!tryOn&&PT_SHOP['i'+i]&&!ptHas(n,'i'+i))return null;"),'the ink');
  assert((source.match(/ptRingOk\(n,/g)||[]).length>=2,'the ring');
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
