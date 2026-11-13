// Exercise the actual tutorial lists, their rewards and the Google reward hook in save order, including normalization on reload.
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
function rewards(){
  const google=source.indexOf('COMMIT_HOOKS.push((n,old,now)=>{\n  if(!S.google||n.glk'),glEnd=source.indexOf('function glCheck(',google);
  assert.ok(google>0);
  let ctx;ctx=vm.createContext({S:{google:true},COMMIT_HOOKS:[],NORM_HOOKS:[],UNLOCKS:{},UNLOCK_SOURCES:[],DAY:864e5,CV_NEW:3*864e5,REGION:'Testland',REGIONS:[1,2],
    landEarned:n=>10,earnedAt:n=>10,decisions:n=>n.dec||0,cellOf:v=>Number.isInteger(v)?v:-1,tallyOf:(n,k)=>(n.tly&&n.tly[k])||0,
    pgAvailable:(n,k)=>!n.onb||n.onb.u.includes(k),pgNew:n=>!!n.onb,tutSoc:()=>null,tutDevGet:()=>ctx.DEVK||'',tutBlocks:()=>false,civicRegistered:()=>false,
    cityList:n=>n.cities||[],ppCount:n=>n.pp||0,ppStats:n=>({ds:0}),cuRenamed:()=>false,mapOpt:(k,d)=>d,LENS_INFO:{},canFeature:()=>false,featureAt:()=>7,fmtPopShort:p=>p+' million',
    stockNow:n=>({...n.stock}),roundStock:s=>({...s}),num0:v=>+v||0,stockCap:()=>400,clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),GL_CREDITS:10,GL_GIFT:{iron:5,timber:5,goods:5,oil:5},
    paidClean:()=>null,cxUpList:()=>({})});
  vm.runInContext(fn('list')+'\n'+fn('stockLimit')+'\nconst TUT_V=25,TUT_GS="mrba";const tutFresh=()=>false;\n'+fn('tutNorm')+'\n'+
    between('/* ── tutorial: the lists ── */','/* ── tutorial: end of the lists ── */')+'\n'+
    between('/* ── tutorial: rewards ── */','/* ── tutorial: end of rewards ── */')+'\n'+source.slice(google,glEnd)+
    '\n'+fn('cityBonusOpen')+'\n'+fn('cxBldExtras')+'\n'+fn('cityGoldKept')+'\n'+fn('cityGoldOpen')+'\n'+fn('bldUgEver')+'\nthis.normalize=tutNorm;this.credits=n=>landEarned(n);this.lists=TUT_LISTS;this.unlocks=UNLOCK_SOURCES;this.mapcOk=tutMapcOk;this.cityOpen=cityBonusOpen;',ctx);
  return {
    ctx,
    save(n){const old=structuredClone(n),messages=[];for(const hook of ctx.COMMIT_HOOKS){const m=hook(n,old,Date.now());if(m)messages.push(...m);}return messages;},
    reload(n){const copy=JSON.parse(JSON.stringify(n)),t=ctx.normalize(copy.tut);if(t)copy.tut=t;else delete copy.tut;return copy;}
  };
}
// a nation founded with the progressive reveals: the charter not yet finished
// b:1 and b2:1, both back pays already given: the back-pay tests below cover them on their own
const nation=over=>{const n={name:'Togetherland',seed:'one',glk:1,onb:{v:1,u:[]},capital:'Port Alder',leader:'President',stock:{food:60,timber:45,iron:25,oil:10,goods:40},...over};n.tut={b:1,b2:1,...(n.tut||{})};return n;};

test('there are four lists, every key is unique, and only the Google step pays outside n.tut.lc',()=>{
  const r=rewards(),L=r.ctx.lists;
  assert.deepEqual([...L].map(x=>x.k),['charter','first','mark','destiny']);
  const keys=L.flatMap(x=>x.tasks.map(s=>s.k));assert.equal(new Set(keys).size,keys.length);
  assert.deepEqual([...L.flatMap(x=>x.tasks.filter(s=>s.own).map(s=>s.k))],['google']);
  for(const k of ['issue','settle','land','build','trade','exp','dm','asm','dsp','insp','lens','fleet','blk','cv','world','prov','stamp','ppdes','soc','fxv','fxd'])
    assert.ok(keys.includes(k),'an earlier key is kept: '+k);
  assert.ok(L[3].tasks.some(s=>s.k==='res'),'an Assembly resolution is among the advanced steps');
});

test('an already linked nation never repeats the ordinary one-credit Google tutorial toast',()=>{
  const r=rewards();let n=nation();
  for(let i=0;i<20;i++){
    const m=r.save(n);assert.ok(!m.some(x=>/linked sign-in|Keep your nation/.test(x)),m.join(' | '));
    assert.ok(!n.tut?.lc?.includes('google'));
    n=r.reload(n); // the next save may come from a reload or another device
  }
  assert.equal(n.glk,1);
  assert.equal(n.stock.goods,40);
});

test('linking still pays its dedicated reward once and remains paid after reloading',()=>{
  const r=rewards();let n=nation({glk:undefined});
  const first=r.save(n);
  assert.equal(first.length,1);assert.match(first[0],/linked sign-in\. \+10 land credits, to spend on the map, and 5 iron, 5 timber, 5 goods and 5 oil|linked sign-in\. \+10 land credits/);
  assert.equal(n.glk,1);
  assert.deepEqual(n.stock,{food:60,timber:50,iron:30,oil:15,goods:45});
  for(let i=0;i<5;i++){n=r.reload(n);assert.deepEqual(r.save(n),[]);}
  assert.equal(n.stock.goods,45);
});

test('ordinary steps still earn their credits once, including on a linked nation',()=>{
  const r=rewards();let n=nation({dec:3,loc:3});
  assert.match(r.save(n)[0],/earned 4 land credits, and 3 goods, 5 iron, and 5 oil/);
  assert.deepEqual([...n.tut.lc],['settle','issue']);
  n=r.reload(n);assert.deepEqual(r.save(n),[]);
  n.deals=[{id:'trade'}];assert.match(r.save(n)[0],/Propose a trade\. \+2 land credits and 5 iron and 5 oil\. Spend them on the map/);
  n=r.reload(n);assert.deepEqual(r.save(n),[]);
  assert.equal(r.ctx.credits(n),10+6); // the Google step’s five are added by a wrapper this sandbox leaves out
  assert.equal(n.tlc,6,'the total is shared');
  const pub=JSON.parse(JSON.stringify(n));delete pub.tut;assert.equal(r.ctx.credits(pub),10+6,'another player’s game counts the shared total');
  pub.tlc=1e6;assert.ok(r.ctx.credits(pub)<10+200,'and never more than the tutorial can pay');
});

test('naming the first city pays 4 land credits and 5 goods, once',()=>{
  const r=rewards();let n=nation({loc:3});r.save(n);n=r.reload(n);
  assert.ok(!n.tut.lc.includes('city'),'Port Alder is only the placeholder');
  const before=r.ctx.credits(n);
  n.capital='Harbourtown';const m=r.save(n);
  assert.equal(m.length,1);assert.match(m[0],/^Step done: Name your first city\. \+4 land credits and 5 goods\. Spend them on the map\.$/);
  assert.equal(n.stock.goods,48,'5 goods, after the 3 for settling');assert.equal(r.ctx.credits(n),before+4);
  n=r.reload(n);assert.deepEqual(r.save(n),[]);assert.equal(n.stock.goods,48);
  // a rename on the Cities page counts too, even back to the placeholder
  const r2=rewards();const m2=nation({loc:3,tly:{'log:cityren':1}});r2.save(m2);assert.ok(m2.tut.lc.includes('city'));
});

test('a list done in full pays its bonus and its epithet once, and gifts respect storage',()=>{
  const r=rewards();r.ctx.DEVK='cu';let n=nation({loc:3,capital:'Harbourtown',ruler:'Ada',sport:'hurling',onb:{v:1,u:['charter']},tly:{'log:flag':1},stock:{food:395,timber:45,iron:25,oil:10,goods:40}});
  const m=r.save(n);
  assert.ok(m.some(x=>/^Your tutorial steps earned 14 land credits, and 20 goods\./.test(x)),m.join(' | '));
  assert.ok(m.some(x=>/^List complete: Your nation starts here\. \+3 land credits and 10 food and 10 timber, and the epithet “the Founder”, under Epithet in Customise\.$/.test(x)),m.join(' | '));
  assert.equal(n.tut.ch,'c');assert.equal(n.stock.food,400);assert.equal(n.stock.timber,55);
  assert.deepEqual([...r.ctx.unlocks[0].earned(n)],['t-founder']);
  n=r.reload(n);assert.deepEqual(r.save(n),[]);assert.equal(n.tut.ch,'c');assert.equal(n.stock.timber,55);
});

test('advanced steps pay three credits and a gift; an Assembly resolution counts once proposed',()=>{
  const r=rewards();let n=nation({loc:3,asm:{p:{ti:'Free Hats',tx:'Hats for every citizen of the region.',c:'civil',g:0}}});
  const m=r.save(n);assert.ok(n.tut.lc.includes('res'));assert.ok(n.tut.lc.includes('asm'),'proposing is also having one’s say');
  assert.ok(m.some(x=>/earned 7 land credits, and 13 goods and 5 food/.test(x)),m.join(' | '));
  n=r.reload(n);delete n.asm;assert.deepEqual(r.save(n),[]);assert.ok(n.tut.lc.includes('res'),'a reward is never taken back');
});

test('a nation that finished the earlier First steps has the first two lists set aside, decided once',()=>{
  const r=rewards();
  let old=nation({onb:undefined,loc:3,tut:{lc:['issue','settle','land','build','trade','exp','dm','asm']}});old=r.reload(old);r.save(old);
  assert.equal(old.tut.v,25);assert.equal(old.tut.p,1);old=r.reload(old);assert.equal(old.tut.p,1);
  let fresh=nation({loc:3});r.save(fresh);fresh=r.reload(fresh);assert.equal(fresh.tut.v,25);assert.equal(fresh.tut.p,undefined);
  Object.assign(fresh,{dec:3,claims:[{c:1}],cities:[{b:[{k:'farm'}]}],deals:[{}],exp:{},dm:[{}]});r.save(fresh);fresh=r.reload(fresh);
  assert.ok(['issue','settle','land','build','trade','exp','dm'].every(k=>fresh.tut.lc.includes(k)));
  assert.equal(fresh.tut.p,undefined,'finishing them now does not set the charter aside');
});

test('a legacy generic Google marker is safely removed without replaying either reward',()=>{
  const r=rewards();let n=r.reload(nation({tut:{lc:['google','settle']},loc:3}));
  assert.deepEqual([...n.tut.lc],['settle']);
  assert.deepEqual(r.save(n),[]);assert.equal(n.stock.goods,40);
});

test('saying hi on the region board pays 3 land credits, 10 iron and oil, 5 of the rest and the Orchid map colour, once',()=>{
  const r=rewards(),L=r.ctx.lists.find(x=>x.k==='first'),s=L.tasks.find(x=>x.k==='rmb');
  assert.ok(s,'Say hi is in Welcome to Edictum, the second list');assert.equal(s.t(),'Say hi to Testland');
  assert.equal(s.v,'region');assert.equal(s.to,'rmb-text','its button opens the board, at the message box');
  r.ctx.S.google=false;assert.match(s.lock({}),/Registered Nations/,'a guest cannot post on the board yet');r.ctx.S.google=true;assert.equal(s.lock({}),'');
  let n=nation({loc:3});r.save(n);n=r.reload(n);
  assert.ok(!n.tut.lc.includes('rmb'),'not before a message is posted');
  assert.ok(!r.ctx.mapcOk(n,'#A347C8'),'Orchid is locked until then');assert.ok(r.ctx.mapcOk(n,'#3A8FD1'),'the twelve map colours stay free');assert.ok(r.ctx.mapcOk(n,''));
  const before=r.ctx.credits(n),stock={...n.stock};
  r.ctx.DEVK='b';const m=r.save(n);
  assert.equal(m.length,1,m.join(' | '));
  assert.match(m[0],/^Step done: Say hi to Testland\. \+3 land credits and 5 food, 5 timber, 10 iron, 10 oil, and 5 goods\. Spend them on the map\. The Orchid map colour is yours too: choose it under Map colour in Settings\.$/);
  assert.equal(r.ctx.credits(n),before+3);
  for(const k of ['food','timber','iron','oil','goods'])assert.equal(n.stock[k],stock[k]+(k==='iron'||k==='oil'?10:5),k);
  assert.ok(r.ctx.mapcOk(n,'#A347C8'),'and Orchid is earned');
  r.ctx.DEVK='';n=r.reload(n);assert.deepEqual(r.save(n),[]);assert.ok(n.tut.lc.includes('rmb'),'kept on reload, on any device');assert.ok(r.ctx.mapcOk(n,'#A347C8'));
});

test('saying hi in the region chat is a step of its own beside the board’s, paying 2 land credits and 5 food, timber and goods, once',()=>{
  const r=rewards(),L=r.ctx.lists.find(x=>x.k==='first'),ks=L.tasks.map(x=>x.k),s=L.tasks.find(x=>x.k==='rch');
  assert.ok(s,'in Welcome to Edictum, the second list');assert.equal(ks.indexOf('rch'),ks.indexOf('rmb')+1,'straight after Say hi on the board');
  assert.equal(s.t,'Say hi in the region chat');assert.equal(s.act,'tut-chat','its button opens the chat');
  assert.equal(s.lock,undefined,'a guest writes in the chat too');
  let n=nation({loc:3});r.save(n);n=r.reload(n);assert.ok(!n.tut.lc.includes('rch'),'not before a line is written');
  const before=r.ctx.credits(n),stock={...n.stock};
  r.ctx.DEVK='h';const m=r.save(n);
  assert.equal(m.length,1,m.join(' | '));
  assert.match(m[0],/^Step done: Say hi in the region chat\. \+2 land credits and 5 food, 5 timber, and 5 goods\./);
  assert.equal(r.ctx.credits(n),before+2);for(const k of ['food','timber','goods'])assert.equal(n.stock[k],stock[k]+5,k);
  r.ctx.DEVK='';n=r.reload(n);assert.deepEqual(r.save(n),[]);assert.ok(n.tut.lc.includes('rch'),'kept on reload, on any device');
});

test('Look round the Shop opens Welcome to Edictum, the list after the charter, and a visit pays 2 land credits and 20 of each resource, once',()=>{
  const r=rewards(),L=r.ctx.lists,F=L.find(x=>x.k==='first'),s=F.tasks[0];
  assert.equal(L.indexOf(F),L.findIndex(x=>x.k==='charter')+1,'the list straight after the charter');
  assert.equal(s.k,'shop','the first task of Welcome to Edictum');assert.equal(s.t,'Look round the Shop');assert.equal(s.v,'shop','its button opens the Shop');
  assert.equal(s.lock,undefined,'open to guests and new nations alike');
  assert.equal(s.lc,2);assert.deepEqual({...s.gift},{food:20,timber:20,iron:20,oil:20,goods:20});
  let n=nation({loc:3});r.save(n);n=r.reload(n);assert.ok(!n.tut.lc.includes('shop'),'not before the Shop is opened');
  const before=r.ctx.credits(n),stock={...n.stock};
  r.ctx.DEVK='s';const m=r.save(n);
  assert.equal(m.length,1,m.join(' | '));
  assert.match(m[0],/^Step done: Look round the Shop\. \+2 land credits and 20 food, 20 timber, 20 iron, 20 oil,? and 20 goods\. Spend them on the map\.$/);
  assert.equal(r.ctx.credits(n),before+2);for(const k of ['food','timber','iron','oil','goods'])assert.equal(n.stock[k],stock[k]+20,k);
  r.ctx.DEVK='';n=r.reload(n);assert.deepEqual(r.save(n),[]);assert.ok(n.tut.lc.includes('shop'),'kept on reload, on any device');
  // opening the Shop page sets the device mark, and the mark survives the device's own store
  assert.match(source,/VIEWS_EXT\.shop=\(f=>function\(\)\{if\(S\.nation&&!S\.nation\.npc&&!OBS&&!tutDevGet\(\)\.includes\('s'\)\)setTimeout\(\(\)=>tutMark\('s'\),0\);/);
  assert.match(source,/k:\(k\+c\)\.replace\(\/\[\^ilwxcubhs\]\/g,''\)/);
});

test('normalising keeps what the four lists save and drops the rest',()=>{
  const r=rewards();
  assert.deepEqual(JSON.parse(JSON.stringify(r.ctx.normalize({lc:['city','nope','city','fxd'],ch:'zdcq',v:25,p:1,w:24,g:'mq',x:1}))),{g:'m',lc:['city','fxd'],ch:'cd',v:25,p:1,w:24});
  assert.equal(r.ctx.normalize({p:2,ch:'',lc:[]}),null);
});

/* the game adds "Customise your nation" to the charter list later in the file than the lists: run that too */
function withCust(r){
  const a=source.indexOf("{const L=TUT_LISTS.find(L=>L.k==='charter')"),b=source.indexOf('ch);}',a);
  assert.ok(a>0&&b>a,'the Customise task is found');
  vm.runInContext(source.slice(a,b+'ch);}'.length)+";if(typeof tutRebuild==='function')tutRebuild();",r.ctx);return r;
}
test('“Customise your nation” pays, and with it the charter list’s bonus and “the Founder”',()=>{
  const r=withCust(rewards());r.ctx.DEVK='c';
  assert.ok(r.ctx.lists[0].tasks.some(s=>s.k==='cust'));
  let n=nation({loc:3,capital:'Harbourtown',ruler:'Ada',sport:'hurling',onb:{v:1,u:['charter']},tly:{'log:flag':1},rpt:{l:{w:4}}});
  r.save(n);
  assert.ok(!n.tut.lc.includes('cust'),'not before Customise is opened');assert.ok(!(n.tut.ch||'').includes('c'),'nor the list');
  r.ctx.DEVK='cu';n=r.reload(n);const m=r.save(n);
  assert.ok(n.tut.lc.includes('cust'),'opening Customise pays its step: '+m.join(' | '));
  assert.ok(m.some(x=>/^List complete: Your nation starts here\./.test(x)),m.join(' | '));
  assert.equal(n.tut.ch,'c');assert.deepEqual([...r.ctx.unlocks[0].earned(n)],['t-founder']);
  n=r.reload(n);assert.ok(n.tut.lc.includes('cust'),'and it is kept on reload');assert.deepEqual(r.save(n),[]);
  const pub=JSON.parse(JSON.stringify(n));delete pub.tut;assert.equal(r.ctx.credits(pub),r.ctx.credits(n),'another player’s game counts all of it');
});

test('“Customise your leader” pays 5 land credits, 25 goods, 25 food and 50 timber once, and the charter waits for it',()=>{
  const r=withCust(rewards());r.ctx.DEVK='cu';
  const L=r.ctx.lists[0],ks=[...L.tasks.map(s=>s.k)],s=L.tasks.find(s=>s.k==='portrait');
  assert.ok(s,'in the charter');assert.equal(ks.indexOf('portrait'),ks.indexOf('ruler')+1,'straight after Name your leader');assert.equal(ks[ks.length-1],'charter','Finish your charter stays last');
  assert.equal(s.t,'Customise your leader');assert.equal(s.v,'customise');assert.equal(s.to,'cz-sec-r','its button opens Customise › Portraits');
  let n=nation({loc:3,capital:'Harbourtown',ruler:'Ada',sport:'hurling',onb:{v:1,u:['charter']},tly:{'log:flag':1},rpt:{s:'leader:one',b:'Harbourtown'}});
  r.save(n);
  assert.ok(!n.tut.lc.includes('portrait'),'a face kept through a rename is not yet a portrait');assert.ok(!(n.tut.ch||'').includes('c'),'and the charter waits for it');
  n=r.reload(n);const before=r.ctx.credits(n),stock={...n.stock};
  n.rpt={...n.rpt,l:{e:1,w:4}};const m=r.save(n);
  assert.ok(n.tut.lc.includes('portrait'),m.join(' | '));
  assert.ok(m.some(x=>/^Step done: Customise your leader\. \+5 land credits and 25 goods, 25 food, and 50 timber\./.test(x)),m.join(' | '));
  assert.ok(m.some(x=>/^List complete: Your nation starts here\./.test(x)),'the last step open, so the charter is complete: '+m.join(' | '));
  assert.equal(r.ctx.credits(n),before+5+3,'5 for the step and 3 for the list');
  assert.equal(n.stock.goods,stock.goods+25);assert.equal(n.stock.food,stock.food+25+10);assert.equal(n.stock.timber,stock.timber+50+10);
  n=r.reload(n);assert.deepEqual(r.save(n),[]);assert.ok(n.tut.lc.includes('portrait'),'kept on reload');
  /* an ink, a ring or a nickname saved alone counts too */
  for(const rp of [{i:'navy'},{r:2},{k:'builder'}]){const r2=withCust(rewards()),x=nation({loc:3,rpt:rp});r2.save(x);assert.ok(x.tut.lc.includes('portrait'),JSON.stringify(rp));}
});

test('back pay: once, Welcome tasks already paid get 5 iron and 5 oil each, the Google step 5 oil, and credits count afresh',()=>{
  const r=rewards();let n=r.reload({name:'Togetherland',seed:'one',glk:1,loc:3,stock:{food:60,timber:45,iron:25,oil:10,goods:40},tut:{v:25,lc:['settle','issue','land']}});
  const before=r.ctx.credits(n);assert.equal(before,10+2+2+2,'every paid task counts one credit more');
  const m=r.save(n);assert.ok(m[0].startsWith('Tutorial rewards have gone up'),m.join(' | '));
  assert.equal(n.stock.iron,35);assert.equal(n.stock.oil,25);assert.equal(n.tut.b,1);
  n=r.reload(n);assert.equal(n.tut.b,1,'kept on reload');const st={...n.stock};assert.ok(!r.save(n).some(x=>/gone up/.test(x)),'never twice');assert.deepEqual(n.stock,st);
});

test('Found a second city follows Start a building in Welcome to Edictum: the first building opens it, and it pays 5 land credits and 100 goods',()=>{
  const r=rewards(),L=r.ctx.lists,F=L.find(x=>x.k==='first'),ks=F.tasks.map(s=>s.k),s=F.tasks.find(x=>x.k==='city2');
  assert.equal(ks.indexOf('city2'),ks.indexOf('build')+1,'straight after Start a building');
  assert.ok(!L.find(x=>x.k==='destiny').tasks.some(x=>x.k==='city2'),'no longer an advanced step');
  assert.equal(s.lc,5);assert.deepEqual({...s.gift},{goods:100});
  assert.deepEqual({...F.tasks.find(x=>x.k==='build').gift},{iron:5,oil:5,timber:40},'the opening step pays the timber a city costs, and more');
  let n=nation({loc:3});assert.equal(r.ctx.cityOpen(n),false);assert.match(s.lock(n),/Start a building first/);
  n.cities=[{b:[{k:'farm'}]}];assert.equal(r.ctx.cityOpen(n),true,'the first building opens it');assert.equal(s.lock(n),'');
  let m=r.save(n);assert.ok(n.tut.lc.includes('build'));assert.equal(n.stock.timber,45+40);assert.ok(!n.tut.lc.includes('city2'));
  n=r.reload(n);n.cities=[{b:[]}];assert.equal(r.ctx.cityOpen(n),true,'and it stays open once the step is paid, whatever is pulled down');
  const goods=n.stock.goods,cr=r.ctx.credits(n);n.cities=[{b:[{k:'farm'}]},{b:[]}];m=r.save(n);
  assert.ok(m.some(x=>/Step done: Found a second city\. \+5 land credits and 100 goods\./.test(x)),m.join(' | '));
  assert.equal(n.stock.goods,goods+100);assert.equal(r.ctx.credits(n),cr+5);
  n=r.reload(n);assert.deepEqual(r.save(n),[],'once');
  assert.match(source,/function maxCities\(T,i\)\{return Math\.min\(MAX_CITIES,mileOf\(S\.nation\)\.cities\+areaCities\(myArea\(T,i\)\)\+\(cityBonusOpen\(S\.nation\)\?1:0\)\+/,'one more city than people and land bring');
  assert.equal(r.ctx.cityOpen({npc:1,cities:[{b:[{k:'farm'}]}]}),false,'computer nations have none');
});

test('second back pay: once, a nation already paid is given 40 timber for its first building and 100 goods for its second city',()=>{
  const r=rewards();let n=r.reload({name:'Togetherland',seed:'one',glk:1,loc:3,cities:[{b:[{k:'farm'}]},{b:[]}],stock:{food:60,timber:45,iron:25,oil:10,goods:40},tut:{v:25,b:1,lc:['settle','build','city2']}});
  assert.equal(r.ctx.credits(n),10+2+2+5,'the second city counts five credits now');
  const m=r.save(n);assert.ok(m.some(x=>x.startsWith('Building and founding pay more')&&/given 40 timber and 100 goods/.test(x)),m.join(' | '));
  assert.ok(!m.some(x=>/gone up/.test(x)),'the first back pay is not repeated');
  assert.equal(n.stock.timber,85);assert.equal(n.stock.goods,140);assert.equal(n.tut.b2,1);
  n=r.reload(n);assert.equal(n.tut.b2,1,'kept on reload');const st={...n.stock};assert.ok(!r.save(n).some(x=>/pay more/.test(x)),'never twice');assert.deepEqual(n.stock,st);
  let one=r.reload({name:'Soloton',seed:'two',glk:1,loc:3,cities:[{b:[{k:'farm'}]}],stock:{food:60,timber:45,iron:25,oil:10,goods:40},tut:{v:25,b:1,lc:['settle','build']}});
  r.save(one);assert.equal(one.stock.timber,85,'the timber alone for a nation with one city');assert.equal(one.stock.goods,40);
  let fresh=r.reload({name:'Newland',seed:'three',glk:1,loc:3,stock:{food:60,timber:45,iron:25,oil:10,goods:40},tut:{v:25,b:1}});
  assert.ok(!r.save(fresh).some(x=>/pay more/.test(x)),'nothing for a nation that had done neither');assert.equal(fresh.tut.b2,1);
  fresh.cities=[{b:[{k:'farm'}]}];r.save(fresh);assert.equal(fresh.stock.timber,85,'which is then paid the new gift once, not twice');
});

test('upgrades are tutorial steps: grey in Make your mark pays 2 land credits and 25 of each resource, gold among the advanced steps 5 and 100 of each',()=>{
  const r=rewards(),L=r.ctx.lists,g1=L.find(x=>x.k==='mark').tasks.find(s=>s.k==='ug1'),g5=L.find(x=>x.k==='destiny').tasks.find(s=>s.k==='ug5');
  assert.ok(g1,'the grey upgrade is in the third list');assert.equal(g1.lc,2);assert.deepEqual({...g1.gift},{food:25,timber:25,iron:25,oil:25,goods:25});
  assert.ok(g5,'the gold upgrade is among the advanced steps');assert.equal(g5.lc,5);assert.deepEqual({...g5.gift},{food:100,timber:100,iron:100,oil:100,goods:100});
  const now=Date.now();let n=nation({loc:3,cities:[{b:[{k:'farm',s:now-9e6,d:now-8e6}]}]});
  r.save(n);n=r.reload(n);assert.ok(n.tut.lc.includes('build'));assert.ok(!n.tut.lc.includes('ug1'),'a building alone is not an upgrade');
  n.cities[0].b[0].uu={u:1,s:now-3600e3,d:now+3600e3};assert.deepEqual(r.save(n),[],'nor is a grey block still being fitted');
  const st={...n.stock},cr=r.ctx.credits(n);n.cities[0].b[0]={k:'farm',s:now-9e6,d:now-8e6,ug:1};
  let m=r.save(n);assert.ok(m.some(x=>/Step done: Upgrade a building to grey\. \+2 land credits and 25 food, 25 timber, 25 iron, 25 oil,? and 25 goods\./.test(x)),m.join(' | '));
  for(const k of Object.keys(st))assert.equal(n.stock[k],st[k]+25,k);assert.equal(r.ctx.credits(n),cr+2);
  n=r.reload(n);n.cities[0].b[0].ug=4;n.cities[0].b[0].uu={u:5,s:now-3600e3,d:now-1000};
  const s2={...n.stock},c2=r.ctx.credits(n);m=r.save(n);
  assert.ok(m.some(x=>/Step done: Take a building to gold\. \+5 land credits and 100 food, 100 timber, 100 iron, 100 oil,? and 100 goods\./.test(x)),'a gold block whose time is up counts: '+m.join(' | '));
  for(const k of Object.keys(s2))assert.equal(n.stock[k],Math.min(400,s2[k]+100),k);assert.equal(r.ctx.credits(n),c2+5);
  n=r.reload(n);n.cities[0].b=[];assert.deepEqual(r.save(n),[],'paid once, and never taken back');assert.ok(n.tut.lc.includes('ug1')&&n.tut.lc.includes('ug5'));
  const vet=nation({loc:3,cities:[{b:[]}],ach:{'land-cxlv2':1,'land-cxlv3':1}});r.save(vet);
  assert.ok(vet.tut.lc.includes('ug1')&&vet.tut.lc.includes('ug5'),'the achievements remember an upgrade whose building is gone');
});
