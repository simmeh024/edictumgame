// Exercise the actual tutorial groups, their rewards, the Google reward hook and the Nation page's card in save order,
// including normalization on reload, the doubling's back pay and the move from the four lists of Version 25.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
function fn(name){
  const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);
  let i=source.indexOf('{',start),depth=0;
  for(;i<source.length;i++){if(source[i]==='{')depth++;else if(source[i]==='}'&&--depth===0)break;}
  return source.slice(start,i+1);
}
function between(a,b){const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>0&&j>i,a);return source.slice(i,j);}
const LISTS=between('/* ── tutorial: the lists ── */','/* ── tutorial: end of the lists ── */');
const REWARDS=between('/* ── tutorial: rewards ── */','/* ── tutorial: end of rewards ── */');
const CARD=between('/* ── the card on the Nation page: one card, at most three next steps ──','/* ── What’s new: once, for a nation that played an earlier version ── */');
function baseCtx(extra){
  const ctx=vm.createContext({S:{google:true},COMMIT_HOOKS:[],NORM_HOOKS:[],UNLOCKS:{},UNLOCK_SOURCES:[],DAY:864e5,CV_NEW:3*864e5,REGION:'Testland',REGIONS:[1,2],
    landEarned:n=>10,earnedAt:n=>10,decisions:n=>n.dec||0,cellOf:v=>Number.isInteger(v)?v:-1,tallyOf:(n,k)=>(n.tly&&n.tly[k])||0,
    pgAvailable:(n,k)=>!n.onb||n.onb.u.includes(k),pgNew:n=>!!n.onb,tutSoc:()=>null,tutDevGet:()=>ctx.DEVK||'',tutBlocks:()=>false,civicRegistered:()=>false,
    cityList:n=>n.cities||[],ppCount:n=>n.pp||0,ppStats:n=>({ds:0}),cuRenamed:()=>false,mapOpt:(k,d)=>d,LENS_INFO:{},canFeature:()=>false,featureAt:()=>7,fmtPopShort:p=>p+' million',
    stockNow:n=>({...n.stock}),roundStock:s=>({...s}),num0:v=>+v||0,stockCap:()=>400,clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),GL_CREDITS:10,GL_GIFT:{iron:5,timber:5,goods:5,oil:5},
    fmtDur:ms=>Math.ceil(ms/36e5)+' h',paidClean:()=>null,cxUpList:()=>({}),...(extra||{})});
  return ctx;
}
function rewards(){
  const google=source.indexOf('COMMIT_HOOKS.push((n,old,now)=>{\n  if(!S.google||n.glk'),glEnd=source.indexOf('function glCheck(',google);
  assert.ok(google>0);
  const ctx=baseCtx();
  vm.runInContext(fn('list')+'\n'+fn('stockLimit')+'\nconst TUT_V=25,TUT_GS="mrba";const tutFresh=()=>false;\n'+fn('tutNorm')+'\n'+LISTS+'\n'+REWARDS+'\n'+source.slice(google,glEnd)+
    '\n'+fn('cityBonusOpen')+'\n'+fn('cxBldExtras')+'\n'+fn('cityGoldKept')+'\n'+fn('cityGoldOpen')+'\n'+fn('bldUgEver')+'\nthis.normalize=tutNorm;this.credits=n=>landEarned(n);this.lists=TUT_LISTS;this.unlocks=UNLOCK_SOURCES;this.mapcOk=tutMapcOk;this.cityOpen=cityBonusOpen;this.pend=tutPend;this.all=TUT_ALL;',ctx);
  return {
    ctx,
    save(n){const old=structuredClone(n),messages=[];for(const hook of ctx.COMMIT_HOOKS){const m=hook(n,old,Date.now());if(m)messages.push(...m);}return messages;},
    reload(n){const copy=JSON.parse(JSON.stringify(n)),t=ctx.normalize(copy.tut);if(t)copy.tut=t;else delete copy.tut;return copy;}
  };
}
// a nation founded with the progressive reveals; b:1, b2:1 and v:26, every back pay already given: the back-pay tests below cover them on their own
const nation=over=>{const n={name:'Togetherland',seed:'one',glk:1,onb:{v:1,u:[]},capital:'Port Alder',leader:'President',stock:{food:60,timber:45,iron:25,oil:10,goods:40},...over};n.tut={b:1,b2:1,v:26,...(n.tut||{})};return n;};
const G=(r,k)=>r.ctx.lists.find(L=>L.k===k);
const task=(r,k)=>r.ctx.all.find(s=>s.k===k);

/* the rewards of Version 25, before the doubling: [land credits, gift] */
const V25={settle:[2,{goods:3}],city:[4,{goods:5}],ruler:[2,{goods:3}],portrait:[5,{goods:25,food:25,timber:50}],culture:[2,{goods:3}],flag:[2,{goods:3}],cust:[2,{goods:3}],
  shop:[2,{food:20,timber:20,iron:20,oil:20,goods:20}],issue:[2,{iron:5,oil:5}],land:[2,{iron:5,oil:5}],build:[2,{iron:5,oil:5,timber:40}],city2:[5,{goods:100}],insp:[2,{iron:5,oil:5}],
  lens:[2,{iron:5,oil:5}],cab:[2,{iron:5,oil:5}],trade:[2,{iron:5,oil:5}],exp:[2,{iron:5,oil:5}],dm:[2,{iron:5,oil:5}],rmb:[3,{food:5,timber:5,iron:10,oil:10,goods:5}],rch:[2,{food:5,timber:5,goods:5}],
  mdig:[2,{food:10,timber:10,iron:10,oil:10,goods:10}],dsp:[2,{goods:5}],stamp:[2,{goods:5}],ppdes:[2,{goods:5}],asm:[2,{food:5}],soc:[2,{goods:5}],games:[2,{food:5}],fleet:[2,{timber:5}],
  cv:[2,{iron:5}],desk:[2,{timber:5}],fxv:[3,{oil:5}],fxd:[3,{oil:5}],ug1:[2,{food:25,timber:25,iron:25,oil:25,goods:25}],res:[3,{goods:10}],ally:[3,{iron:10}],blk:[3,{timber:10}],
  ug5:[5,{food:100,timber:100,iron:100,oil:100,goods:100}],road:[3,{timber:10}],prov:[3,{goods:10}],repeal:[3,{goods:10}],bid:[3,{iron:10}],lore:[3,{goods:10}],world:[3,{oil:10}]};
const V25_BONUS={c:[3,{food:10,timber:10}],f:[2,{goods:10}],m:[3,{iron:10}],d:[5,{goods:20}]};
const dbl=g=>Object.fromEntries(Object.entries(g).map(([k,v])=>[k,v*2]));

test('five groups: the main path, Build your future, the region, Make it your own and the ledger; every earlier key is kept',()=>{
  const r=rewards(),L=r.ctx.lists;
  assert.deepEqual([...L].map(x=>x.k),['establish','future','region','own','ambitions']);
  assert.deepEqual([...L].map(x=>x.c),['c','f','m','','d'],'the four letters of the lists before Version 26, so a bonus paid then is never paid again; Make it your own has none');
  const keys=L.flatMap(x=>x.tasks.map(s=>s.k));assert.equal(new Set(keys).size,keys.length);
  for(const k of [...Object.keys(V25),'charter','google'])assert.ok(keys.includes(k),'an earlier key is kept: '+k);
  assert.equal(keys.length,Object.keys(V25).length+2,'and no task is lost or added');
  assert.deepEqual([...L.flatMap(x=>x.tasks.filter(s=>s.own).map(s=>s.k))],['google']);
  assert.deepEqual([...G(r,'establish').tasks.map(s=>s.k)],['settle','land','build','issue','charter'],'settle, claim, build, three edicts, then the charter');
  assert.deepEqual([...G(r,'future').tasks.map(s=>s.k)],['city2','trade','exp','stamp']);assert.equal(G(r,'future').need,2);
  assert.deepEqual([...G(r,'region').tasks.map(s=>s.k)],['dsp','rch','dm','games','asm']);assert.equal(G(r,'region').need,3);assert.equal(G(r,'region').opt,1);
  assert.deepEqual([...G(r,'own').tasks.map(s=>s.k)],['city','ruler','portrait','culture','flag','cust']);assert.equal(G(r,'own').bonus,null);
  const A=G(r,'ambitions');assert.deepEqual([...A.secs.map(s=>s[0])],['b','x','g','p','i']);
  assert.ok(A.tasks.every(s=>A.secs.some(([k])=>k===s.sec)),'every ambition is filed in one of the five sections');
  assert.ok(!G(r,'establish').tasks.some(s=>s.k==='shop')&&A.tasks.find(s=>s.k==='shop').after==='establish','the Shop is a later discovery, after the main path');
});

test('every task pays twice what it did, signing the charter pays 10 land credits, and every bonus is doubled',()=>{
  const r=rewards();
  for(const [k,[lc,g]] of Object.entries(V25)){const s=task(r,k);assert.equal(s.lc,lc*2,k);assert.deepEqual({...s.gift},dbl(g),k);}
  const c=task(r,'charter');assert.equal(c.lc,10);assert.deepEqual({...c.gift},{goods:6});
  for(const L of r.ctx.lists.filter(L=>L.c)){const [lc,g]=V25_BONUS[L.c];assert.equal(L.bonus.lc,lc*2,L.k);assert.deepEqual({...L.bonus.gift},dbl(g),L.k);}
  assert.equal(task(r,'google').lc,undefined,'the sign-in step keeps its own reward (n.glk)');
  assert.deepEqual([...G(r,'establish').tasks.map(s=>s.bonus)].filter(Boolean),[]);
});

test('an already linked nation never repeats the ordinary one-credit Google tutorial toast',()=>{
  const r=rewards();let n=nation();
  for(let i=0;i<20;i++){
    const m=r.save(n);assert.ok(!m.some(x=>/linked sign-in|Keep your nation/.test(x)),m.join(' | '));
    assert.ok(!n.tut?.lc?.includes('google'));
    n=r.reload(n);
  }
  assert.equal(n.glk,1);assert.equal(n.stock.goods,40);
});

test('linking still pays its dedicated reward once and remains paid after reloading',()=>{
  const r=rewards();let n=nation({glk:undefined});
  const first=r.save(n);
  assert.equal(first.length,1);assert.match(first[0],/linked sign-in\. \+10 land credits/);
  assert.equal(n.glk,1);assert.deepEqual(n.stock,{food:60,timber:50,iron:30,oil:15,goods:45});
  for(let i=0;i<5;i++){n=r.reload(n);assert.deepEqual(r.save(n),[]);}
  assert.equal(n.stock.goods,45);
});

test('ordinary steps earn their doubled credits once, wherever they were done',()=>{
  const r=rewards();let n=nation({dec:3,loc:3});
  assert.match(r.save(n)[0],/earned 8 land credits, and 6 goods, 10 iron, and 10 oil/);
  assert.deepEqual([...n.tut.lc],['settle','issue']);
  n=r.reload(n);assert.deepEqual(r.save(n),[]);
  n.deals=[{id:'trade'}];assert.match(r.save(n)[0],/Propose a trade\. \+4 land credits and 10 iron and 10 oil\. Spend them on the map/);
  n=r.reload(n);assert.deepEqual(r.save(n),[]);
  assert.equal(r.ctx.credits(n),10+12);assert.equal(n.tlc,12,'the total is shared');
  const pub=JSON.parse(JSON.stringify(n));delete pub.tut;assert.equal(r.ctx.credits(pub),10+12,'another player’s game counts the shared total');
  pub.tlc=1e6;assert.ok(r.ctx.credits(pub)<10+400,'and never more than the tutorial can pay');
});

test('naming the first city pays 8 land credits and 10 goods, once',()=>{
  const r=rewards();let n=nation({loc:3});r.save(n);n=r.reload(n);
  assert.ok(!n.tut.lc.includes('city'),'Port Alder is only the placeholder');
  const before=r.ctx.credits(n);
  n.capital='Harbourtown';const m=r.save(n);
  assert.equal(m.length,1);assert.match(m[0],/^Step done: Name your first city\. \+8 land credits and 10 goods\. Spend them on the map\.$/);
  assert.equal(n.stock.goods,56,'10 goods, after the 6 for settling');assert.equal(r.ctx.credits(n),before+8);
  n=r.reload(n);assert.deepEqual(r.save(n),[]);assert.equal(n.stock.goods,56);
  const r2=rewards();const m2=nation({loc:3,tly:{'log:cityren':1}});r2.save(m2);assert.ok(m2.tut.lc.includes('city'),'a rename on the Cities page counts too');
});

test('the main path’s bonus waits for the charter, which opens once the four steps are done, cosmetics or not',()=>{
  const r=rewards(),c=task(r,'charter');
  let n=nation({loc:3,dec:3,claims:[{c:1}],cities:[{b:[{k:'farm'}]}],stock:{food:395,timber:45,iron:25,oil:10,goods:40}});
  assert.equal(c.lock(nation({loc:3})),'Opens once the four steps above are done.');
  assert.equal(c.lock(n),'','no name, no leader, no flag, no portrait, and the charter is open');
  let m=r.save(n);
  assert.ok(['settle','land','build','issue'].every(k=>n.tut.lc.includes(k)),m.join(' | '));
  assert.ok(!(n.tut.ch||'').includes('c'),'the four alone do not finish the main path');assert.ok(!m.some(x=>/complete/.test(x)));
  n=r.reload(n);r.ctx.DEVK='c';m=r.save(n);
  assert.ok(m.some(x=>/^Step done: Sign the founding charter\. \+10 land credits and 6 goods\./.test(x)),m.join(' | '));
  assert.ok(m.some(x=>/^Main path complete: Establish your nation\. \+6 land credits and 20 food and 20 timber, and the epithet “the Founder”, under Epithet in Customise\.$/.test(x)),m.join(' | '));
  assert.equal(n.tut.ch,'c');assert.equal(n.stock.food,400,'gifts respect storage');
  assert.deepEqual([...r.ctx.unlocks[0].earned(n)],['t-founder']);
  const st={...n.stock};n=r.reload(n);assert.deepEqual(r.save(n),[]);assert.equal(n.tut.ch,'c');assert.deepEqual(n.stock,st,'never twice, on reload');
  assert.ok(!['city','ruler','portrait','culture','flag','cust'].some(k=>n.tut.lc.includes(k)),'and no cosmetic task was needed');
});

test('Build your future: any two of four pay its bonus once, and the other two stay open with their own rewards',()=>{
  const r=rewards();let n=nation({loc:3,pp:1});
  let m=r.save(n);assert.ok(n.tut.lc.includes('stamp'),'one is done');assert.ok(!(n.tut.ch||'').includes('f'),'one is not two');
  n=r.reload(n);n.exp={s:1,t0:1,t1:2};m=r.save(n);
  assert.ok(m.some(x=>/^Done: Build your future\. \+4 land credits and 20 goods, and the epithet “the Steward”/.test(x)),m.join(' | '));
  assert.equal(n.tut.ch,'f');assert.ok(!n.tut.lc.includes('trade')&&!n.tut.lc.includes('city2'),'the bonus does not tick the other two');
  n=r.reload(n);assert.deepEqual(r.save(n),[]);
  const cr=r.ctx.credits(n);n.deals=[{id:'x'}];m=r.save(n);
  assert.deepEqual(m,['Step done: Propose a trade. +4 land credits and 10 iron and 10 oil. Spend them on the map.'],'a third pays its own reward, and no bonus again');
  assert.equal(r.ctx.credits(n),cr+4);assert.equal(n.tut.ch,'f');
});

test('your region: any three of five, so a guest finishes it without the Assembly, which says what it waits for',()=>{
  const r=rewards();r.ctx.S.google=false;const asm=task(r,'asm');
  assert.match(asm.lock({founded:Date.now()}),/Only Registered Nations act in the Assembly: link a sign-in first, and your nation must be a day old \(24 h to go\)\./);
  let n=nation({loc:3,dsp:{s:1},dm:[{t:'hello'}]});r.save(n);assert.ok(!(n.tut.ch||'').includes('m'));
  n=r.reload(n);n.games={en:[{f:1}]};const m=r.save(n);
  assert.ok(m.some(x=>/^Done: Take your place in Testland\. \+6 land credits and 20 iron, and the epithet “the Renowned”/.test(x)),m.join(' | '));
  assert.ok(!n.tut.lc.includes('asm')&&!n.tut.lc.includes('rch'));
});

test('a veteran is paid the other half of every gift once, its credits count double, and a regrouped bonus is not paid again',()=>{
  const r=rewards();
  let n=r.reload({name:'Oldland',seed:'old',glk:1,loc:3,dec:3,claims:[{c:1}],cities:[{b:[{k:'farm'}]}],stock:{food:60,timber:45,iron:25,oil:10,goods:40},
    tut:{v:25,b:1,b2:1,lc:['settle','land','build','issue','city','ruler','culture','flag','cust','charter','portrait'],ch:'c'}});
  assert.equal(r.ctx.credits(n),10+4+4+4+4+8+4+4+4+4+10+10+6,'every paid task and the paid bonus count at the new rate');
  const m=r.save(n);
  const bp=m.find(x=>x.startsWith('Tutorial rewards have doubled'));assert.ok(bp,m.join(' | '));
  /* half of: settle 6 goods, land/build/issue 10 iron 10 oil each, build 80 timber, city 10 goods, four 6-goods tasks, charter 6, portrait 50/50/100, bonus 20 food 20 timber */
  assert.equal(n.stock.goods,40+3+5+12+3+25);assert.equal(n.stock.iron,25+15);assert.equal(n.stock.oil,10+15);assert.equal(n.stock.timber,45+40+50+10);assert.equal(n.stock.food,60+25+10);
  assert.ok(!m.some(x=>/complete/.test(x)),'the main path was the charter’s letter: its bonus is not paid again');
  assert.equal(n.tut.v,26);
  for(let i=0;i<3;i++){n=r.reload(n);const st={...n.stock};assert.ok(!r.save(n).some(x=>/doubled/.test(x)),'never twice');assert.deepEqual(n.stock,st);}
  /* a tab still running the old version drops fields it does not know, but keeps v as it is */
  assert.equal(r.reload(n).tut.v,26);
  let fresh=nation({loc:3});delete fresh.tut.v;r.save(fresh);assert.equal(fresh.tut.v,26,'a new nation is marked at once');assert.equal(fresh.stock.goods,40+6,'and paid only its own step');
});

test('a veteran with every list of Version 25 finished has every bonus counted, and none paid again',()=>{
  const r=rewards();
  const lc=Object.keys(V25).concat('charter').filter(k=>k!=='soc');
  let n=r.reload({name:'Allland',seed:'all',glk:1,loc:3,stock:{food:60,timber:45,iron:25,oil:10,goods:40},tut:{v:26,b:1,b2:1,lc,ch:'cfmd'}});
  const m=r.save(n);assert.deepEqual(m,[],'nothing to pay: every bonus is paid already');assert.equal(n.tut.ch,'cfmd');
  assert.deepEqual([...r.ctx.unlocks[0].earned(n)].sort(),['t-founder','t-renowned','t-sovereign','t-steward']);
});

test('the earlier back pays still happen once, at their own amounts, before the doubling',()=>{
  const r=rewards();let n=r.reload({name:'Togetherland',seed:'one',glk:1,loc:3,stock:{food:60,timber:45,iron:25,oil:10,goods:40},tut:{v:26,lc:['settle','issue','land']}});
  const m=r.save(n);assert.ok(m[0].startsWith('Tutorial rewards have gone up'),m.join(' | '));
  assert.equal(n.stock.iron,35);assert.equal(n.stock.oil,25);assert.equal(n.tut.b,1);
  n=r.reload(n);assert.equal(n.tut.b,1);const st={...n.stock};assert.ok(!r.save(n).some(x=>/gone up/.test(x)),'never twice');assert.deepEqual(n.stock,st);
  let b2=r.reload({name:'Twoland',seed:'two',glk:1,loc:3,cities:[{b:[{k:'farm'}]},{b:[]}],stock:{food:60,timber:45,iron:25,oil:10,goods:40},tut:{v:26,b:1,lc:['settle','build','city2']}});
  const m2=r.save(b2);assert.ok(m2.some(x=>x.startsWith('Building and founding pay more')&&/given 40 timber and 100 goods/.test(x)),m2.join(' | '));
  assert.equal(b2.stock.timber,85);assert.equal(b2.stock.goods,140);assert.equal(b2.tut.b2,1);
});

test('a nation that finished the earlier First steps is marked once',()=>{
  const r=rewards();
  let old=nation({onb:undefined,loc:3,tut:{lc:['issue','settle','land','build','trade','exp','dm','asm']}});delete old.tut.v;old=r.reload(old);r.save(old);
  assert.equal(old.tut.v,26);assert.equal(old.tut.p,1);old=r.reload(old);assert.equal(old.tut.p,1);
  let fresh=nation({loc:3});delete fresh.tut.v;r.save(fresh);fresh=r.reload(fresh);assert.equal(fresh.tut.p,undefined);
});

test('a legacy generic Google marker is safely removed without replaying either reward',()=>{
  const r=rewards();let n=r.reload(nation({tut:{lc:['google','settle']},loc:3}));
  assert.deepEqual([...n.tut.lc],['settle']);
  assert.deepEqual(r.save(n),[]);assert.equal(n.stock.goods,40);
});

test('saying hi on the region board is an ambition: 6 land credits, its gift and the Orchid map colour, once',()=>{
  const r=rewards(),s=task(r,'rmb');
  assert.equal(s.sec,'p');assert.equal(s.t(),'Say hi to Testland');assert.equal(s.to,'rmb-text');
  r.ctx.S.google=false;assert.match(s.lock({}),/Registered Nations/);r.ctx.S.google=true;assert.equal(s.lock({}),'');
  let n=nation({loc:3});r.save(n);n=r.reload(n);
  assert.ok(!r.ctx.mapcOk(n,'#A347C8'));assert.ok(r.ctx.mapcOk(n,'#3A8FD1'));
  const before=r.ctx.credits(n),stock={...n.stock};
  r.ctx.DEVK='b';const m=r.save(n);
  assert.match(m[0],/^Step done: Say hi to Testland\. \+6 land credits and 10 food, 10 timber, 20 iron, 20 oil, and 10 goods\. Spend them on the map\. The Orchid map colour is yours too/);
  assert.equal(r.ctx.credits(n),before+6);for(const k of ['food','timber','iron','oil','goods'])assert.equal(n.stock[k],stock[k]+(k==='iron'||k==='oil'?20:10),k);
  assert.ok(r.ctx.mapcOk(n,'#A347C8'));r.ctx.DEVK='';n=r.reload(n);assert.deepEqual(r.save(n),[]);
});

test('saying hello in the region chat pays 4 land credits and 10 food, timber and goods, once, and a guest may do it',()=>{
  const r=rewards(),s=task(r,'rch');assert.equal(s.act,'tut-chat');assert.equal(s.lock,undefined);
  let n=nation({loc:3});r.save(n);n=r.reload(n);const before=r.ctx.credits(n),stock={...n.stock};
  r.ctx.DEVK='h';const m=r.save(n);assert.match(m[0],/^Step done: Say hello in the region chat\. \+4 land credits and 10 food, 10 timber, and 10 goods\./);
  assert.equal(r.ctx.credits(n),before+4);for(const k of ['food','timber','goods'])assert.equal(n.stock[k],stock[k]+10,k);
  r.ctx.DEVK='';n=r.reload(n);assert.deepEqual(r.save(n),[]);
});

test('Look round the Shop pays 4 land credits and 40 of each resource, once, and the device mark survives its own store',()=>{
  const r=rewards(),s=task(r,'shop');assert.equal(s.v,'shop');assert.equal(s.lock,undefined,'visiting early still pays: actions count wherever they are done');
  let n=nation({loc:3,stock:{food:60,timber:45,iron:25,oil:10,goods:40}});r.save(n);n=r.reload(n);const before=r.ctx.credits(n),stock={...n.stock};
  r.ctx.DEVK='s';const m=r.save(n);assert.match(m[0],/^Step done: Look round the Shop\. \+4 land credits and 40 food, 40 timber, 40 iron, 40 oil,? and 40 goods\. Spend them on the map\.$/);
  assert.equal(r.ctx.credits(n),before+4);for(const k of ['food','timber','iron','oil','goods'])assert.equal(n.stock[k],stock[k]+40,k);
  assert.match(source,/VIEWS_EXT\.shop=\(f=>function\(\)\{if\(S\.nation&&!S\.nation\.npc&&!OBS&&!tutDevGet\(\)\.includes\('s'\)\)setTimeout\(\(\)=>tutMark\('s'\),0\);/);
  assert.match(source,/k:\(k\+c\)\.replace\(\/\[\^ilwxcubhs\]\/g,''\)/);
});

test('Customise your leader pays 10 land credits, 50 goods, 50 food and 100 timber once, an ink, ring or nickname counting too',()=>{
  const r=rewards(),s=task(r,'portrait');assert.equal(s.to,'cz-sec-r');
  let n=nation({loc:3,rpt:{s:'leader:one',b:'Harbourtown'}});r.save(n);assert.ok(!n.tut.lc.includes('portrait'),'a face kept through a rename is not a portrait');
  n=r.reload(n);const before=r.ctx.credits(n),stock={...n.stock};n.rpt={...n.rpt,l:{e:1,w:4}};const m=r.save(n);
  assert.ok(m.some(x=>/^Step done: Customise your leader\. \+10 land credits and 50 goods, 50 food, and 100 timber\./.test(x)),m.join(' | '));
  assert.equal(r.ctx.credits(n),before+10);assert.equal(n.stock.goods,stock.goods+50);
  for(const rp of [{i:'navy'},{r:2},{k:'builder'}]){const r2=rewards(),x=nation({loc:3,rpt:rp});r2.save(x);assert.ok(x.tut.lc.includes('portrait'),JSON.stringify(rp));}
});

test('the first building opens a second city, and Found a second city pays 10 land credits and 200 goods',()=>{
  const r=rewards(),s=task(r,'city2');
  assert.deepEqual({...task(r,'build').gift},{iron:10,oil:10,timber:80});
  let n=nation({loc:3});assert.equal(r.ctx.cityOpen(n),false);assert.match(s.lock(n),/Start a building first/);
  n.cities=[{b:[{k:'farm'}]}];assert.equal(r.ctx.cityOpen(n),true);assert.equal(s.lock(n),'');
  r.save(n);assert.equal(n.stock.timber,45+80);
  n=r.reload(n);const goods=n.stock.goods,cr=r.ctx.credits(n);n.cities=[{b:[{k:'farm'}]},{b:[]}];const m=r.save(n);
  assert.ok(m.some(x=>/Step done: Found a second city\. \+10 land credits and 200 goods\./.test(x)),m.join(' | '));
  assert.equal(n.stock.goods,Math.min(400,goods+200));assert.equal(r.ctx.credits(n),cr+10);
  assert.match(source,/function maxCities\(T,i\)\{return Math\.min\(MAX_CITIES,mileOf\(S\.nation\)\.cities\+areaCities\(myArea\(T,i\)\)\+\(cityBonusOpen\(S\.nation\)\?1:0\)\+/);
});

test('upgrades are ambitions: grey pays 4 land credits and 50 of each, gold 10 and 200 of each',()=>{
  const r=rewards(),now=Date.now();let n=nation({loc:3,cities:[{b:[{k:'farm',s:now-9e6,d:now-8e6}]}],stock:{food:100,timber:100,iron:100,oil:100,goods:100}});
  r.save(n);n=r.reload(n);assert.ok(!n.tut.lc.includes('ug1'));
  n.cities[0].b[0]={k:'farm',s:now-9e6,d:now-8e6,ug:1};const st={...n.stock},cr=r.ctx.credits(n);
  let m=r.save(n);assert.ok(m.some(x=>/Step done: Upgrade a building to grey\. \+4 land credits and 50 food, 50 timber, 50 iron, 50 oil,? and 50 goods\./.test(x)),m.join(' | '));
  for(const k of Object.keys(st))assert.equal(n.stock[k],st[k]+50,k);assert.equal(r.ctx.credits(n),cr+4);
  n=r.reload(n);n.cities[0].b[0].ug=4;n.cities[0].b[0].uu={u:5,s:now-3600e3,d:now-1000};m=r.save(n);
  assert.ok(m.some(x=>/Step done: Take a building to gold\. \+10 land credits and 200 food, 200 timber, 200 iron, 200 oil,? and 200 goods\./.test(x)),m.join(' | '));
});

test('normalising keeps the bonus letters c f m d and drops the rest',()=>{
  const r=rewards();
  assert.deepEqual(JSON.parse(JSON.stringify(r.ctx.normalize({lc:['city','nope','city','fxd'],ch:'zdcq',v:26,p:1,w:24,g:'mq',x:1}))),{g:'m',lc:['city','fxd'],ch:'cd',v:26,p:1,w:24});
  assert.equal(r.ctx.normalize({p:2,ch:'',lc:[]}),null);
  assert.match(source,/'Graduate of the Charter','[^']*',1,x=>\{try\{return achYes\(x\.me&&tutBon\(\)\.every\(L=>tutChOf\(x\.n\)\.includes\(L\.c\)\)\)/,'the achievement counts the four bonus letters, not the number of groups');
});

/* ── the card on the Nation page ── */
function card(store={},over={}){
  const now=Date.now(),ctx=baseCtx({OBS:'',TUT:{sealAt:0,sec:'',shH:''},localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v);}},
    document:{addEventListener(){},getElementById:()=>null},render:()=>{},myId:()=>'me',territory:()=>({byId:{me:0},owner:[0,0,0],list:[{me:1}]}),MAP:{N:3},
    maxCities:()=>ctx.MAXC??1,MAX_CITIES:33,nvxCitySite:()=>true,CITY_COST:{food:30,timber:30,goods:20},costText:o=>Object.entries(o).map(([r,v])=>v+' '+r).join(', '),
    BUILDINGS:{farm:{n:'Farm',d:'Makes food. More text.'},saw:{n:'Sawmill',d:'Makes timber.'}},FFB_GIFT:12,FFB_OUT:{farm:'food'},resName:r=>r,firstSentence:t=>String(t).split('. ')[0]+'.',
    cityLabel:(n,c)=>c.nm||n.capital,wsOf:n=>n.ws||null,WS_AT:[5,10,25],wsK:()=>-1,mileOf:()=>({cities:1}),MILE_CITIES:5,MILESTONES:[{p:7,city:1}],popNow:()=>4,fmtPop:p=>p+' million',
    nextCreditPop:()=>5,esc:s=>String(s),resIco:r=>`<i data-r="${r}"></i>`,landCredits:()=>3,GL_TAG:'<span class="tut-lc">+10 land</span>',...over});
  vm.runInContext(fn('list')+'\nconst TUT_V=25,TUT_GS="mrba";\n'+fn('tutNorm')+'\n'+LISTS+'\n'+REWARDS+'\n'+CARD+
    '\n'+fn('cityBonusOpen')+'\n'+fn('cxBldExtras')+'\n'+fn('cityGoldKept')+'\n'+fn('cityGoldOpen')+'\n'+fn('bldUgEver')+'\nthis.X={tutCard,tutPhase,tutPicks,tutHid,tutHide,tutGroup,tutL,fdl:()=>0};',ctx);
  return {ctx,X:ctx.X,store};
}
const settled=o=>({name:'Testoria',seed:'s1',capital:'Port Alder',leader:'President',loc:3,founded:Date.now()-36e5,onb:{v:1,u:[]},stock:{food:60,timber:45,iron:25,oil:10,goods:40},tut:{b:1,b2:1,v:26},...o});

test('a fresh nation is guided at once: before settling the card folds under Place your capital, then shows the main path',()=>{
  const {X,ctx}=card();let n=settled({loc:null});ctx.S.nation=n;
  assert.equal(X.tutPhase(n),'fold');const f=X.tutCard(n);assert.match(f,/tut-fold/);assert.match(f,/0 of 4/);assert.doesNotMatch(f,/tut-pk-r/,'no next steps beside the capital card');
  n=settled();ctx.S.nation=n;assert.equal(X.tutPhase(n),'est');
  const h=X.tutCard(n);assert.match(h,/Testoria takes shape/);assert.match(h,/class="tut-seals"/);
  const picks=X.tutPicks(n,'est');assert.ok(picks.length>0&&picks.length<=3,'at most three');assert.equal(picks[0].k,'land','the next step of the main path comes first');
  assert.equal((h.match(/class="btn"/g)||[]).length,1,'one filled button: the recommended step');
});

test('next steps are only things the nation can do now: never a locked task, a later discovery, or one that must wait',()=>{
  const {X,ctx}=card();ctx.S.google=false;
  const n=settled({dec:3,claims:[{c:1}],cities:[{id:'c1',b:[{k:'farm',s:1,d:2}]}]});ctx.DEVK='c';ctx.S.nation=n;
  ctx.MAXC=1;/* every city the nation may found stands already: the second city waits */
  for(let i=0;i<4;i++){const ks=X.tutPicks(n,'next').map(x=>x.k);
    assert.ok(!ks.includes('asm')&&!ks.includes('rmb')&&!ks.includes('res'),'nothing a guest cannot do: '+ks);
    assert.ok(!ks.includes('city2'),'nor the second city while it must wait: '+ks);
    assert.ok(ks.length<=3);}
  ctx.MAXC=2;assert.ok(X.tutPicks(n,'next').some(x=>x.k==='city2'),'once it can be founded, it is offered');
  const est=settled();ctx.S.nation=est;ctx.DEVK='s';assert.ok(!X.tutPicks(est,'est').some(x=>x.k==='shop'),'the Shop waits for the main path');
});

test('identity tasks never hold up the path: with none done, the four steps lead to the charter, then Build your future',()=>{
  const store={},{X,ctx}=card(store);const n=settled({dec:3,claims:[{c:1}],cities:[{id:'c1',b:[{k:'farm',s:1,d:2}]}]});ctx.S.nation=n;
  assert.equal(X.tutPhase(n),'sign');const h=X.tutCard(n);assert.match(h,/The founding charter of Testoria/);assert.match(h,/data-act="pg-charter"/);assert.match(h,/\+10 land/);
  store['statehood.tutlater.v1']='s1';assert.equal(X.tutPhase(n),'fut','Later puts the charter aside on this device');
  assert.match(X.tutCard(n),/data-k="charter"/,'and it stays on the card as a step');
  delete store['statehood.tutlater.v1'];ctx.DEVK='c';assert.equal(X.tutPhase(n),'fut');
  const f=X.tutCard(n);assert.match(f,/Choose any two/);assert.match(f,/0 of 2 chosen/);assert.equal((f.match(/<li class="tut-tile/g)||[]).length,4);
});

test('choose any two: two done finish the part on the card, and the others stay open in Other things to try',()=>{
  const {X,ctx}=card();ctx.DEVK='c';
  const n=settled({dec:3,claims:[{c:1}],cities:[{id:'c1',b:[{k:'farm',s:1,d:2}]}],pp:1,exp:{s:1,t0:1,t1:2}});ctx.S.nation=n;
  const F=X.tutGroup(n,X.tutL('future'));assert.equal(F.done,2);assert.ok(F.full);
  assert.equal(X.tutPhase(n),'next','two of four finish it, before its bonus is even paid');
  const h=X.tutCard(n);assert.match(h,/Next for Testoria/);assert.match(h,/Build your future · 2 of 4/,'the other two are still a click away');
  assert.ok(!F.core.find(x=>x.k==='trade').ok&&!F.core.find(x=>x.k==='city2').ok,'and are not marked done');
});

test('previously completed actions are recognised: a nation that did things before the task appeared sees them done',()=>{
  const {X,ctx}=card();ctx.DEVK='c';
  const n=settled({dec:9,claims:[{c:1}],cities:[{id:'c1',b:[{k:'farm',s:1,d:2}]}],deals:[{id:'d'}],dsp:{s:1},dm:[{t:'x'}],capital:'Estport',ruler:'Ada'});ctx.S.nation=n;
  for(const [g,k] of [['future','trade'],['region','dsp'],['region','dm'],['own','city'],['own','ruler']])assert.ok(X.tutGroup(n,X.tutL(g)).st.find(x=>x.k===k).ok,k);
  assert.ok(!X.tutPicks(n,'next').some(x=>['trade','dsp','dm','city','ruler'].includes(x.k)),'and never offers them again');
});

test('a building going up shows its clock and what it makes, and something useful to do meanwhile',()=>{
  const now=Date.now(),{X,ctx}=card();const n=settled({claims:[{c:1}],cities:[{id:'c1',b:[{k:'farm',s:now-6e4,d:now+12e4}]}],ffb:{k:'farm',c:'c1',s:now-6e4,d:now+12e4}});ctx.S.nation=n;
  const h=X.tutCard(n);assert.match(h,/The Farm in Port Alder is going up/);assert.match(h,/first cart brings 12 food/);assert.match(h,/data-live="ffb" data-d="\d+"/);
  assert.match(h,/While you wait/,'a step from another group fills the wait');assert.match(h,/First letter from Willow Street|Another city|Next land credit/,'and what is coming');
});

test('hidden guidance stays hidden: the old lists’ choice carries over, and the new key is kept',()=>{
  const store={},{X}=card(store);const n=settled({tut:{v:26,ch:''}});
  store['statehood.steps0.v1']='s1';assert.equal(X.tutHid(n),false,'the charter hidden, Welcome still showing: guidance was on');
  for(const k of Object.keys(store))delete store[k];
  for(const k of ['statehood.steps0.v1','statehood.steps.v1','statehood.steps2.v1','statehood.steps4.v1'])store[k]='s1';
  assert.equal(X.tutHid(n),true,'every list hidden: the card starts hidden');assert.equal(X.tutCard(n),'');
  for(const k of Object.keys(store))delete store[k];
  store['statehood.steps.v1']='s1';store['statehood.steps2.v1']='s1';store['statehood.steps4.v1']='s1';
  assert.equal(X.tutHid(settled({tut:{v:26,ch:'c'}})),true,'charter done and the rest hidden: hidden');
  for(const k of Object.keys(store))delete store[k];
  store['statehood.tutcard.v1']=JSON.stringify({s:'s1',h:0});store['statehood.steps.v1']='s1';assert.equal(X.tutHid(n),false,'once decided under the new key, the old keys are not read again');
  X.tutHide(true);assert.equal(X.tutHid(n),false,'tutHide acts on the current nation (none here)');
});

test('the card is drawn from the real group code, so the probe and the page agree',()=>{
  assert.match(source,/TUTL:\{lists:TUT_LISTS,state:tutState,cur:tutCur,credits:tutCredits,pend:tutPend,card:n=>tutCard\(n\),phase:n=>tutPhase\(n\),picks:/);
  assert.match(source,/function pgGuided\(n\)\{return pgNew\(n\)&&!tutHid\(n\)&&!tutEstDone\(n\);\}/,'the banners come back once the main path is done, never held by cosmetics');
});
