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
  const ctx=vm.createContext({S:{google:true},COMMIT_HOOKS:[],NORM_HOOKS:[],UNLOCKS:{},UNLOCK_SOURCES:[],DAY:864e5,CV_NEW:3*864e5,REGION:'Testland',REGIONS:[1,2],
    landEarned:n=>10,earnedAt:n=>10,decisions:n=>n.dec||0,cellOf:v=>Number.isInteger(v)?v:-1,tallyOf:(n,k)=>(n.tly&&n.tly[k])||0,
    pgAvailable:(n,k)=>!n.onb||n.onb.u.includes(k),pgNew:n=>!!n.onb,tutSoc:()=>null,tutDevGet:()=>'',tutBlocks:()=>false,civicRegistered:()=>false,
    cityList:n=>n.cities||[],ppCount:n=>n.pp||0,ppStats:n=>({ds:0}),cuRenamed:()=>false,mapOpt:(k,d)=>d,LENS_INFO:{},canFeature:()=>false,featureAt:()=>7,fmtPopShort:p=>p+' million',
    stockNow:n=>({...n.stock}),roundStock:s=>({...s}),num0:v=>+v||0,stockCap:()=>400,clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),GL_CREDITS:5,GL_GIFT:{iron:5,timber:5,goods:5}});
  vm.runInContext(fn('list')+'\n'+fn('stockLimit')+'\nconst TUT_V=25,TUT_GS="mrba";const tutFresh=()=>false;\n'+fn('tutNorm')+'\n'+
    between('/* ── tutorial: the lists ── */','/* ── tutorial: end of the lists ── */')+'\n'+
    between('/* ── tutorial: rewards ── */','/* ── tutorial: end of rewards ── */')+'\n'+source.slice(google,glEnd)+
    '\nthis.normalize=tutNorm;this.credits=n=>landEarned(n);this.lists=TUT_LISTS;this.unlocks=UNLOCK_SOURCES;',ctx);
  return {
    ctx,
    save(n){const old=structuredClone(n),messages=[];for(const hook of ctx.COMMIT_HOOKS){const m=hook(n,old,Date.now());if(m)messages.push(...m);}return messages;},
    reload(n){const copy=JSON.parse(JSON.stringify(n)),t=ctx.normalize(copy.tut);if(t)copy.tut=t;else delete copy.tut;return copy;}
  };
}
// a nation founded with the progressive reveals: the charter not yet finished
const nation=over=>({name:'Togetherland',seed:'one',glk:1,onb:{v:1,u:[]},capital:'Port Alder',leader:'President',stock:{food:60,timber:45,iron:25,oil:10,goods:40},...over});

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
  assert.equal(first.length,1);assert.match(first[0],/linked sign-in\. \+5 land credits/);
  assert.equal(n.glk,1);
  assert.deepEqual(n.stock,{food:60,timber:50,iron:30,oil:10,goods:45});
  for(let i=0;i<5;i++){n=r.reload(n);assert.deepEqual(r.save(n),[]);}
  assert.equal(n.stock.goods,45);
});

test('ordinary steps still earn their credits once, including on a linked nation',()=>{
  const r=rewards();let n=nation({dec:3,loc:3});
  assert.match(r.save(n)[0],/earned 2 land credits/);
  assert.deepEqual([...n.tut.lc],['settle','issue']);
  n=r.reload(n);assert.deepEqual(r.save(n),[]);
  n.deals=[{id:'trade'}];assert.match(r.save(n)[0],/Propose a trade\. \+1 land credit\. Spend it on the map/);
  n=r.reload(n);assert.deepEqual(r.save(n),[]);
  assert.equal(r.ctx.credits(n),10+3); // the Google step’s five are added by a wrapper this sandbox leaves out
  assert.equal(n.tlc,3,'the total is shared');
  const pub=JSON.parse(JSON.stringify(n));delete pub.tut;assert.equal(r.ctx.credits(pub),10+3,'another player’s game counts the shared total');
  pub.tlc=1e6;assert.ok(r.ctx.credits(pub)<10+200,'and never more than the tutorial can pay');
});

test('naming the first city pays 3 land credits and 5 goods, once',()=>{
  const r=rewards();let n=nation({loc:3});r.save(n);n=r.reload(n);
  assert.ok(!n.tut.lc.includes('city'),'Port Alder is only the placeholder');
  const before=r.ctx.credits(n);
  n.capital='Harbourtown';const m=r.save(n);
  assert.equal(m.length,1);assert.match(m[0],/^Step done: Name your first city\. \+3 land credits and 5 goods\. Spend them on the map\.$/);
  assert.equal(n.stock.goods,45);assert.equal(r.ctx.credits(n),before+3);
  n=r.reload(n);assert.deepEqual(r.save(n),[]);assert.equal(n.stock.goods,45);
  // a rename on the Cities page counts too, even back to the placeholder
  const r2=rewards();const m2=nation({loc:3,tly:{'log:cityren':1}});r2.save(m2);assert.ok(m2.tut.lc.includes('city'));
});

test('a list done in full pays its bonus and its epithet once, and gifts respect storage',()=>{
  const r=rewards();let n=nation({loc:3,capital:'Harbourtown',ruler:'Ada',sport:'hurling',onb:{v:1,u:['charter']},tly:{'log:flag':1},stock:{food:395,timber:45,iron:25,oil:10,goods:40}});
  const m=r.save(n);
  assert.ok(m.some(x=>/^Your tutorial steps earned 8 land credits, and 5 goods\./.test(x)),m.join(' | '));
  assert.ok(m.some(x=>/^List complete: Your nation starts here\. 10 food and 10 timber, and the epithet “the Founder”, under Epithet in Customise\.$/.test(x)),m.join(' | '));
  assert.equal(n.tut.ch,'c');assert.equal(n.stock.food,400);assert.equal(n.stock.timber,55);
  assert.deepEqual([...r.ctx.unlocks[0].earned(n)],['t-founder']);
  n=r.reload(n);assert.deepEqual(r.save(n),[]);assert.equal(n.tut.ch,'c');assert.equal(n.stock.timber,55);
});

test('advanced steps pay two credits and a gift; an Assembly resolution counts once proposed',()=>{
  const r=rewards();let n=nation({loc:3,asm:{p:{ti:'Free Hats',tx:'Hats for every citizen of the region.',c:'civil',g:0}}});
  const m=r.save(n);assert.ok(n.tut.lc.includes('res'));assert.ok(n.tut.lc.includes('asm'),'proposing is also having one’s say');
  assert.ok(m.some(x=>/earned 4 land credits, and 5 food and 10 goods/.test(x)),m.join(' | '));
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

test('normalising keeps what the four lists save and drops the rest',()=>{
  const r=rewards();
  assert.deepEqual(JSON.parse(JSON.stringify(r.ctx.normalize({lc:['city','nope','city','fxd'],ch:'zdcq',v:25,p:1,w:24,g:'mq',x:1}))),{g:'m',lc:['city','fxd'],ch:'cd',v:25,p:1,w:24});
  assert.equal(r.ctx.normalize({p:2,ch:'',lc:[]}),null);
});
