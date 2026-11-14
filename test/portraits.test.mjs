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

test('twenty-two kinds of hair, twenty of dress and eight skin colours, the ten newer ones open to all; notes print without the skin',()=>{
  const i=source.indexOf('const PT_ROWS=['),rows=vm.runInNewContext(source.slice(i+'const PT_ROWS='.length,source.indexOf(';',i)));
  const by=Object.fromEntries(rows.map(r=>[r[0],r[2]]));
  assert.equal(rows[0][0],'s','the skin comes first');assert.equal(by.s.length,9);assert.equal(by.s[0],'Engraved','0 is the engraving in one ink');
  assert.equal(by.h.length,22);assert.equal(by.d.length,20);assert.equal(by.w.length,18);assert.equal(by.x.length,14);
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
  assert.equal(rp.length,12);assert.deepEqual(Object.values(PS).filter(id=>rp.includes(id)).sort(),rp.slice().sort(),'PT_SHOP names every portrait piece the pack grants, once');
  const i=source.indexOf('const PT_ROWS=['),rows=vm.runInNewContext(source.slice(i+'const PT_ROWS='.length,source.indexOf(';',i))),by=Object.fromEntries(rows.map(r=>[r[0],r[2]]));
  const rings=vm.runInNewContext(source.match(/const PT_RING_N=(\[[^\]]+\]);/)[1]),inks=source.match(/const PT_INKS=(\[.*\]);/)[1];
  for(const [p,id] of Object.entries(PS).filter(([,id])=>rp.includes(id))){const k=p[0],v=p.slice(1);
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

test('two portrait pieces in every other pack, at the same price: real parts, in their own pack, granted by the server, the Founder’s Package with the card pack’s two',()=>{
  const C=JSON.parse(readFileSync(new URL('../functions/shop-catalogue.json',import.meta.url),'utf8')).products;
  const PS=vm.runInNewContext('('+source.match(/const PT_SHOP=(\{[^}]+\});/)[1]+')');
  const i=source.indexOf('const PT_ROWS=['),rows=vm.runInNewContext(source.slice(i+'const PT_ROWS='.length,source.indexOf(';',i))),by=Object.fromEntries(rows.map(r=>[r[0],r[2]]));
  const rings=vm.runInNewContext(source.match(/const PT_RING_N=(\[[^\]]+\]);/)[1]),inks=vm.runInNewContext(source.match(/const PT_INKS=(\[.*\]);/)[1]);
  const want={founder:{r6:'Keystone',x9:'Founder’s rosette'},idpack:{r7:'Microprint',iholo:'Hologram'},bfpack:{w14:'Nightcap',x10:'Price tag'},orpack:{w15:'Legionary helmet',ityrian:'Tyrian purple'},
    sailpack:{w16:'Tricorne',d17:'Captain’s coat'},cbpack:{r8:'Acanthus',d18:'Waistcoat and watch chain'},tulippack:{w17:'Burgher’s hat',x11:'Tulip buttonhole'},cartopack:{r9:'Compass',x12:'Pencil behind the ear'},embpack:{d19:'Embroidered court coat',x13:'Flag lapel pin'}};
  const name=p=>{const k=p[0],v=p.slice(1);return k==='r'?rings[+v]:k==='i'?(inks.find(x=>x[0]===v)||[])[1]:by[k][+v];};
  const prices={founder:999,idpack:299,bfpack:199,orpack:299,sailpack:299,cbpack:249,tulippack:299,cartopack:399,embpack:249};
  for(const [pk,parts] of Object.entries(want)){
    assert.equal(C[pk].amount,prices[pk],pk+' keeps its price');assert.equal(C[pk].grantsV,6,pk+': owners from before are settled again (above the Black Friday Pack’s 5)');
    for(const [part,nm] of Object.entries(parts)){const id=PS[part];assert.ok(id,part+' is sold');assert.equal(name(part),nm,part);
      assert.ok(new RegExp(`\\['${pk}',\\[[^\\n]*\\['${id}','portrait','`).test(source),id+' is registered in '+pk);
      assert.ok(C[pk].grants.includes(id),pk+' grants '+id);if(pk==='idpack')assert.ok(C.founder.grants.includes(id),'the Founder’s Package grants '+id+' too');}
    assert.equal(C[pk].grants.filter(id=>id.startsWith('rp-')).length,pk==='founder'?4:2,pk+': two portrait pieces'+(pk==='founder'?', and the card pack’s two':''));}
  assert.equal(Object.keys(PS).length,30,'twelve in the Mayan Pack and eighteen in the others');
  assert.equal(vm.runInNewContext(source.match(/const PT_HAT_S=(\[[^\]]+\]);/)[1]).length,by.w.length,'every hat has its scale');
  /* on offer while its own pack sells, not the Mayan Pack's */
  assert(source.includes('const ptOffered=(n,id)=>!PT_SHOP[id]||ptHas(n,id)||ptPackSells(ptPackOf(id));'),'offered by its own pack');
  assert(/function ptPackSells\(p\)\{[^\n]*p==='bfpack'\)return shopSells\(p\)&&shopNow\(\)<shopBfUntil\(\)/.test(source),'the Black Friday Pack’s only until its date');
  /* the ring masks, the Microprint ring's name and the flag lapel pin's flag */
  for(const r of [6,7,8,9])assert(new RegExp('\\n    '+r+':C\\(48\\.7').test(source),'ring '+r+' has its mask');
  assert(source.includes("o.ring===7?ptMicro(o.mp):''")&&source.includes('L.x===13&&o.fl?ptPinFlag(o.fl,b.f)'),'the Microprint ring and the flag lapel pin read the nation');
  for(const f of ['function ptLead(n,o)','function ptMin(','function ptCand(','function ptFormerHTML(','function ptMed(']){const a=source.indexOf(f);assert(source.slice(a,a+900).includes('ptNat(n)'),f+' passes the nation’s flag and name');}
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
