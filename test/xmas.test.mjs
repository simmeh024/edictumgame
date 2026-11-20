// Christmas on Willow Street: The Twenty-Five Lights (game/edictum.html, the section "Christmas on Willow Street";
// functions/xmas-rules.js). The section runs here as written, in a small game of stand-ins, on a clock the tests set:
// the calendar's dates, catch-up, answers in order and once, the gifts, the record as saved and loaded, the words of
// all twenty-five letters in every government's voice, and the server's own hold on the answers.
// Run with: node --test test/xmas.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../functions/xmas-rules.js';

const html=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8'),src=html.match(/<script>([\s\S]*)<\/script>\s*$/)[1];
const i0=src.indexOf('/* ───────── Christmas on Willow Street: The Twenty-Five Lights'),i1=src.indexOf('\n/* ───────── ',i0+10);
assert.ok(i0>0&&i1>i0&&src.indexOf('\nconst hot=window.claude&&window.claude.hot;')>i1,'the section is found, before the game starts');
const SECTION=src.slice(i0,i1);
const DAYMS=864e5,U=(y,m,d,h=0,mi=0,s=0)=>Date.UTC(y,m-1,d,h,mi,s);
const FAMS=['rep','crn','imp','sul','the','peo','col','bor'];

function game(opts={}){
  const ctx=vm.createContext({console,URLSearchParams,JSON,Math});
  ctx.T={now:U(2026,12,12,14)};
  vm.runInContext(`
    Date.now=()=>T.now;
    const DAY=864e5,RES=['food','timber','iron','oil','goods'],STOCK_CAP=400;
    const store={},sstore={};
    const localStorage={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}};
    const sessionStorage={getItem:k=>k in sstore?sstore[k]:null,setItem:(k,v)=>{sstore[k]=String(v);}};
    const location={hostname:${JSON.stringify(opts.host||'edictumgame.com')},search:${JSON.stringify(opts.search||'')},pathname:'/'};
    const listeners={},docClicks=[];
    const window={addEventListener:(k,f)=>{(listeners[k]=listeners[k]||[]).push(f);},scrollTo(){},dispatch(k,e){for(const f of listeners[k]||[])f(e);}};
    const document={addEventListener:(k,f)=>{if(k==='click')docClicks.push(f);},querySelector:()=>null};
    function setTimeout(){}function setInterval(){}
    const S={nation:null,mode:'world',uid:'me',view:'christmas',muHall:'',museumFor:null};
    let OBS=false,PV=false,tabPassive=false,commitNo=0,czVer=0,czSeq=0,renders=0,saves=0,clockCalls=0;
    const NORM_HOOKS=[],COMMIT_HOOKS=[],UNLOCK_SOURCES=[],UNLOCKS={},EXT_PAGES=['dispatch'],NAV_LABELS={},NAV_WORDS={},NAV_ICONS={},VIEWS_EXT={},MAP_LAYERS=[];
    const NAV_GROUPS=[{k:'nation',l:'Your nation',v:['nation','issues','government']}];
    const MU_HALLS=[['entrance','Entrance'],['collection','Collection']],MU_NO={},MU_HALL_NM={},MU_WALL={};
    const EMBLEMS={},CZ_EMBS=[],CZ_CHB={},CTG_TE=['te-hatch'],CTG_TB=['tb-survey'],MLK_TE=['te-hatch'],SHOP_PIN={},LS_HEX={},CZ_SHIELDS={heater:'Heater'},CZ_SH_SHOP={};
    const PT_ROW_BY={w:['w','Headwear',Array.from({length:26},(_,i)=>'hat'+i)]},PT_HAT_S=[],PT_SHOP={},PT_SHOP_BY={},CZ_DKEY='cz.disp',CZ={disp:{}};
    const RGC={goto:null},MAP={cx:[],cy:[]},HEX_R=10,HEX_W=17.32;
    const NAV_SVG=p=>'<svg>'+p+'</svg>';
    function hash(s){let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
    function rng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
    const cap1=s=>s?s[0].toUpperCase()+s.slice(1):s,esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),clone=o=>JSON.parse(JSON.stringify(o)),num0=v=>Number.isFinite(+v)?+v:0,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
    function roman(n){const v=[[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];let s='';for(const [a,r] of v)while(n>=a){s+=r;n-=a;}return s;}
    function fmtDate(t){return new Date(t).toISOString().slice(0,10);}function fmtDayUTC(t){return fmtDate(t);}function fmtTime(t){return new Date(t).toISOString().slice(11,16);}
    const resName=r=>r,resIco=r=>'';function toast(){}function render(){renders++;}function saveSoon(){saves++;}
    function stockNow(n){return Object.assign({food:0,timber:0,iron:0,oil:0,goods:0},n.stock||{});}
    const roundStock=st=>Object.fromEntries(RES.map(r=>[r,Math.round(num0(st[r])*100)/100]));
    function xsMark(n,st){let x=0;for(const r of RES)x=Math.max(x,num0(st[r])-STOCK_CAP);if(x>0)n.xs=Math.max(n.xs||0,Math.ceil(x));}
    function commit(n){for(const h of COMMIT_HOOKS)h(n,S.nation,Date.now());delete n._stockSet;S.nation=n;commitNo++;}
    function fdFam(n){return n&&n.fam||'rep';}
    function wsOf(n){return n&&n.ws||null;}
    function cbCall(d){clockCalls++;return Promise.resolve({now:Date.now()});}
    function unlockHow(id){return 'how '+id;}function myId(){return 'me';}function muTarget(){return {n:S.nation,id:'me'};}function muEmpty(a,b){return '<p>'+a+'</p>';}
    function czSil(){return '';}function ctgLandSVG(){return '<svg></svg>';}function pnSVG(){return '<svg></svg>';}function ppStampBody(){return '';}function cz(){return {};}function czMine(){return new Set();}
    function hexFill(){}function edgeList(){}function ptL(){return '';}function ptC(){return '';}function czElEnd(){return -1;}function czTile(){return '';}function shopArt(){return '';}
    function xsMax(n){return 0;}function landEarned(n){return 10;}function earnedAt(n){return 10;}async function writeRemote(){}
    function go(v){S.view=v;}function navCur(){return S.view;}
    function navGroups(){return NAV_GROUPS.map(g=>({k:g.k,l:g.l,items:g.v.concat(EXT_PAGES.filter(v=>!g.v.includes(v)&&v==='christmas'?false:false)).map(v=>[v,NAV_LABELS[v]||v])}));}
    function nvxCompute(){return {};}function issuesView(){return '<div class="issue-meta"></div>';}function museumView(){return '<div class="mu-hall" data-hall="x"></div>\\n<nav class="mu-walk"></nav>';}
    function rgcLine(m){return 'line:'+m.id;}
    function czEmblemSVG(){return 'e';}function czCharge(){return 'c';}function czPatSVG(){return 'p';}function ctgFinish(){}function ctgBorder(){}function shopCtgWorn(){return ['te-lights','tb-fairy','te-hatch'];}
    function dmWaxN(){return 'w';}function czShieldPath(){return 'h';}function czArmsSVG(){return '<path d="x" class="cz-ol"/>';}function ptBust(){return {lay:'',list:[],s:1};}function ptLockWords(){return '';}function shopFineryHTML(){return '';}
    ${SECTION}
    this.G={S,T,listeners,docClicks,store,get commitNo(){return commitNo;},get saves(){return saves;},get czVer(){return czVer;},XM_EV,XM_STORY,XM_LAND,XM_CZD,XM_IC,xmAt,xmPhase,xmArrived,xmSeason,xmNow,xmSync,xmNorm,xmRec,xmAns,xmCount,xmFlags,xmKnows,xmCtx,xmFill,xmOpt,xmCh,xmCan,xmAnswer,xmUnlocks,xmLand,xmWin,xmChatMix,xmView,xmPreview,xmGlobeWords,XMS,XMC,XMP,NORM_HOOKS,UNLOCKS,UNLOCK_SOURCES,EXT_PAGES,NAV_GROUPS,VIEWS_EXT,MU_HALLS,
      landEarned:n=>landEarned(n),xsMax:n=>xsMax(n),navGroups:()=>navGroups(),nvxCompute:(n,t)=>nvxCompute(n,t),issuesView:(v,t)=>issuesView(v,t),rgcLine:m=>rgcLine(m),writeRemote:()=>writeRemote(),PT_ROW_BY,PT_SHOP,CTG_TE,CTG_TB,shopCtgWorn:(n,c)=>shopCtgWorn(n,c)};
  `,ctx);
  return ctx.G;
}
function fresh(g,extra){g.XMC.known=true;g.S.nation=Object.assign({name:'Aldmere',capital:'Port Aldine',founded:U(2026,11,1),stock:{food:100,timber:100,iron:50,oil:20,goods:10},inbox:[],answered:[],dec:3,issueClock:5,ws:null},extra||{});return g.S.nation;}
function answerAll(g,upto,pick){for(let d=1;d<=upto;d++)g.xmAnswer(d,pick?pick(d):0);}
const J=v=>JSON.parse(JSON.stringify(v));
const ids=n=>J((n.xm?n.xm.c:[]).map(x=>x.id));

test('the calendar: the note on 30 November, a letter at 00:00 UTC each day of 1 to 25 December, closed at 00:00 UTC on 7 January',()=>{
  const g=game();
  assert.equal(g.xmAt(0),U(2026,11,30));assert.equal(g.xmAt(1),U(2026,12,1));assert.equal(g.xmAt(12),U(2026,12,12));assert.equal(g.xmAt(25),U(2026,12,25));
  assert.equal(g.XM_EV.close,U(2027,1,7));assert.equal(g.XM_EV.id,'xmas-2026');
  const at=[[U(2026,11,29,23,59,59),'before',0],[U(2026,11,30),'pre',0],[U(2026,11,30,23,59,59),'pre',0],[U(2026,12,1),'live',1],[U(2026,12,1,23,59,59),'live',1],[U(2026,12,2),'live',2],
    [U(2026,12,12,14),'live',12],[U(2026,12,24,23,59,59),'live',24],[U(2026,12,25),'live',25],[U(2027,1,6,23,59,59),'live',25],[U(2027,1,7),'closed',25]];
  for(const [t,ph,a] of at){assert.equal(g.xmPhase(t),ph,new Date(t).toISOString());assert.equal(g.xmArrived(t),a,new Date(t).toISOString());}
  /* written in, never "this December": the same day next year is not in season */
  assert.equal(g.xmSeason(U(2027,12,12)),false);assert.equal(g.xmArrived(U(2027,12,1))>0&&g.xmPhase(U(2027,12,1)),'closed');
});

test('a letter opens only once it has arrived, and only after the one before it',()=>{
  const g=game(),n=fresh(g);
  g.T.now=U(2026,11,30,23,59,59);assert.equal(g.xmCan(n,1,g.xmNow()),'early');assert.equal(g.xmCan(n,0,g.xmNow()),'ok');
  g.T.now=U(2026,12,1);assert.equal(g.xmCan(n,1,g.xmNow()),'ok');assert.equal(g.xmCan(n,2,g.xmNow()),'early');
  g.T.now=U(2026,12,5,10);assert.equal(g.xmCan(n,3,g.xmNow()),'order','three waits for one and two');
  g.xmAnswer(3,0);assert.deepEqual(ids(g.S.nation),[],'refused out of order');
  g.xmAnswer(6,0);assert.deepEqual(ids(g.S.nation),[],'refused before it arrives');
  assert.match(g.XMS.err,/arrived|order/);
});

test('a late joiner on 12 December has letters 1 to 12 at once, one after another, with no timer between them',()=>{
  const g=game();fresh(g);g.T.now=U(2026,12,12,9);
  for(let d=1;d<=12;d++){assert.equal(g.xmCan(g.S.nation,d,g.xmNow()),'ok',`letter ${d} is open`);g.xmAnswer(d,d%3);}
  assert.deepEqual(ids(g.S.nation),[1,2,3,4,5,6,7,8,9,10,11,12]);
  assert.equal(g.xmCan(g.S.nation,13,g.xmNow()),'early');
  g.xmAnswer(13,0);assert.equal(g.xmCount(g.S.nation),12);
  /* the windows: twelve lit, thirteen not yet */
  assert.equal(g.xmWin(g.S.nation,12,g.xmNow()),'pend','the last answer waits for its save');
  assert.equal(g.xmWin(g.S.nation,11,g.xmNow()),'lit');assert.equal(g.xmWin(g.S.nation,13,g.xmNow()),'locked');
});

test('a player back after days away picks up where they left off; nothing is lost and nothing is answered for them',()=>{
  const g=game();fresh(g);g.T.now=U(2026,12,3,20);answerAll(g,3);
  g.T.now=U(2026,12,9,8);
  assert.equal(g.xmArrived(g.xmNow())-g.xmCount(g.S.nation),6,'six waiting');
  assert.deepEqual(ids(g.S.nation),[1,2,3],'catching up opens letters; it answers none');
  for(let d=4;d<=9;d++)g.xmAnswer(d,1);
  assert.equal(g.xmCount(g.S.nation),9);
  g.T.now=U(2027,1,6,23,59);g.xmAnswer(10,0);assert.equal(g.xmCount(g.S.nation),10,'answered up to the last minute');
  g.T.now=U(2027,1,7);g.xmAnswer(11,0);assert.equal(g.xmCount(g.S.nation),10,'not once the calendar has closed');assert.match(g.XMS.err,/closed/);
});

test('an answer is given once: a second tap, a stale button or a retry gives nothing more',()=>{
  const g=game();fresh(g);g.T.now=U(2026,12,1,10);
  g.xmAnswer(1,1);const food=g.S.nation.stock.food,n1=g.commitNo;
  g.xmAnswer(1,1);g.xmAnswer(1,0);g.xmAnswer(1,2);
  assert.equal(g.commitNo,n1,'no further commits');assert.equal(g.S.nation.stock.food,food);
  assert.deepEqual(J(g.S.nation.xm.c.map(x=>[x.id,x.o])),[[1,1]]);
  /* the gift: letter 1, answer 2 is 30 food */
  assert.equal(food,130);
});

test('in a region game, an answer waits until the game has the server’s time',()=>{
  const g=game();fresh(g);g.XMC.known=false;g.T.now=U(2026,12,1,10);
  g.xmAnswer(1,0);assert.equal(g.S.nation.xm,undefined,'held');assert.match(g.XMS.err,/time/);
  g.XMC.known=true;g.xmAnswer(1,0);assert.equal(g.xmCount(g.S.nation),1);
});

test('only answers 1 to 3 of a letter exist',()=>{
  const g=game();fresh(g);g.T.now=U(2026,12,1,10);
  for(const bad of [3,-1,'1',1.5,null,undefined,NaN])g.xmAnswer(1,bad);
  assert.equal(g.S.nation.xm,undefined);
  g.xmAnswer(26,0);g.xmAnswer(-1,0);assert.equal(g.S.nation.xm,undefined);
});

test('the record: kept as saved through a reload, rid of anything malformed, of another edition, or after a gap',()=>{
  const g=game(),norm=d=>{const n={};for(const h of g.NORM_HOOKS)h(n,d);return n.xm;};
  const good={id:'xmas-2026',c:[{id:2,o:1,t:5,f:'crn'},{id:1,o:0,t:4,f:'rep'},{id:0,o:2,t:3}]};
  assert.deepEqual(J(norm({xm:J(good)})),{id:'xmas-2026',c:[{id:0,o:2,t:3},{id:1,o:0,t:4,f:'rep'},{id:2,o:1,t:5,f:'crn'}]});
  assert.equal(norm({xm:{id:'xmas-2025',c:[{id:1,o:0,t:4}]}}),undefined,'another edition');
  assert.deepEqual(J(norm({xm:{id:'xmas-2026',c:[{id:1,o:0,t:4},{id:3,o:0,t:6},{id:1,o:2,t:9},{id:2,o:5,t:7},{id:4,o:1,t:0},'x',null]}}).c.map(x=>x.id)),[1],'a gap, a repeat, a bad answer, no time');
  assert.equal(norm({xm:{id:'xmas-2026',c:[{id:1,o:0,t:4,f:'nope'}]}}).c[0].f,undefined);
  /* and after answering: the record survives JSON and normalising unchanged */
  fresh(g);g.T.now=U(2026,12,4,12);answerAll(g,4,d=>d%3);
  const saved=J(g.S.nation);assert.deepEqual(J(norm(saved)),J(g.S.nation.xm));
});

test('the Christmas letters never touch the edict desk, its clock, the count of enacted edicts or Mara’s own letters',()=>{
  const g=game(),n=fresh(g,{ws:{v:1,e:30,c:[{o:0},{o:1},{o:2}],x:{lp:'on',bk:'open',tm:'in'}},inbox:[{id:'x',at:1}],answered:[{id:'y',o:1}],dec:7,issueClock:42});
  const before={ws:clone(n.ws),inbox:clone(n.inbox),answered:clone(n.answered),dec:n.dec,issueClock:n.issueClock};
  g.T.now=U(2026,12,6,12);answerAll(g,6);g.xmAnswer(0,1);
  const m=g.S.nation;assert.deepEqual({ws:m.ws,inbox:m.inbox,answered:m.answered,dec:m.dec,issueClock:m.issueClock},before);
  function clone(o){return JSON.parse(JSON.stringify(o));}
  /* who knows Mara is read from her letters, never written */
  assert.deepEqual(JSON.parse(JSON.stringify(g.xmKnows(m))),{K:true,G:true,B:true,T:true,HL:false});
  assert.deepEqual(JSON.parse(JSON.stringify(g.xmKnows(fresh(g)))),{K:false,G:false,B:false,T:false,HL:false});
});

test('later letters remember earlier answers in their own words',()=>{
  const g=game();fresh(g);g.T.now=U(2026,12,25,9);
  /* the lanterns (7), the gingerbread (5), the inspector (8), the song (12) */
  const pick={1:2,3:0,4:1,5:2,7:1,8:2,12:1};answerAll(g,24,d=>pick[d]??0);
  const n=g.S.nation,txt=d=>{const C=g.xmCtx(n,d);return g.xmCh(d).q.map(p=>g.xmFill(p,C)).join(' ');},opt=(d,i)=>g.xmOpt(g.xmCtx(n,d),d,i);
  assert.match(opt(16,0).r,/tin lanterns come out again/,'the lanterns return in the blizzard');
  assert.match(txt(17),/gingerbread Senate House/,'the bakery’s speciality is the one chosen');
  assert.match(opt(21,2).r,/countersigned by the Honorary Winter Inspector/,'the inspector gets another duty');
  assert.match(opt(24,1).r,/“Twenty-Five Lights”/,'the choir sings the chosen song');
  assert.match(txt(21),/Extraordinary Commission/,'the Commission of letter 1 objects to the objection');
  const ada=txt(25);
  for(const re of [/making me Secretary/,/the tree, which was tall/,/candles/,/an inspector/,/“Twenty-Five Lights” is stuck/])assert.match(ada,re,'Ada’s letter: '+re);
  /* a newcomer meets Mara; a player who knows her is greeted as one */
  assert.match(txt(1),/My name is Mara Bell/);
  const g2=game();fresh(g2,{ws:{v:1,c:[{o:0},{o:0}],x:{lp:'on'}}});g2.T.now=U(2026,12,1,1);
  assert.match(g2.xmCh(1).q.map(p=>g2.xmFill(p,g2.xmCtx(g2.S.nation,1))).join(' '),/You know me already.*under the lamp Ada named Gerald/);
});

test('every government speaks with its own voices, and the snowman and the closed road in its own way',()=>{
  const g=game(),n=fresh(g);g.T.now=U(2026,12,25,1);answerAll(g,7);
  for(const f of FAMS){n.fam=f;const C=g.xmCtx(n,8),o=g.xmOpt(C,8,0),F=g.XM_STORY.fam[f];
    assert.ok(o.say.includes(F.O),f+': the clerk speaks');assert.ok(g.xmFill(g.XM_STORY.ch[0].q[2],C).includes(F.house),f+': the house is named');}
  n.fam='crn';assert.match(g.xmOpt(g.xmCtx(n,8),8,0).say,/royal patronage/);assert.match(g.xmOpt(g.xmCtx(n,8),8,0).k[0],/Royal Warrant/);
  n.fam='rep';assert.match(g.xmOpt(g.xmCtx(n,8),8,0).say,/permit properly/);
});

test('all twenty-five letters: three answers each, written in full, with three different gifts and no broken words',()=>{
  const g=game(),S=g.XM_STORY,keys=S.ch.map(c=>c.k),names=new Set();
  assert.equal(S.ch.length,25);assert.equal(new Set(keys).size,25,'each letter remembers its own thing');
  const DSL=/\[\[([^|\][]+)\|([^|\][]*)(?:\|([^|\][]*))?\]\]/g,known=new Set(['K','G','B','T','HL']);
  const checkConds=(t,d,where)=>{for(const m of String(t).matchAll(DSL))for(const term of m[1].split('&')){const x=term.trim().replace(/^!/,'');if(known.has(x))continue;
    const [k,v]=x.split(':');if(k==='f'){for(const f of v.split('/'))assert.ok(FAMS.includes(f),where);continue;}
    const at=keys.indexOf(k);assert.ok(at>=0&&at+1<d,`${where}: ${k} is remembered by an earlier letter`);for(const val of v.split('/'))assert.ok(S.ch[at].o.some(o=>o.id===val),`${where}: ${k}:${val}`);}};
  S.ch.forEach((c,i)=>{const d=i+1;
    assert.ok(c.t&&c.q.length>=2,`letter ${d} is written`);c.q.forEach(p=>checkConds(p,d,`letter ${d}`));
    assert.equal(c.o.length,3,`letter ${d} has three answers`);assert.equal(new Set(c.o.map(o=>o.id)).size,3);
    const bundles=new Set();
    for(const o of c.o){for(const f of ['a','b','r','fx'])assert.ok(typeof o[f]==='string'&&o[f].length>4,`letter ${d} ${o.id}.${f}`);
      for(const f of ['a','b','r','fx'])checkConds(o[f],d,`letter ${d} ${o.id}.${f}`);
      assert.ok(['W','P','O'].includes(o.by));assert.ok(Array.isArray(o.k)&&o.k.length===3&&g.XM_IC[o.k[1]],`letter ${d} ${o.id}: a keepsake with a picture`);
      assert.ok(!names.has(o.k[0]),'one keepsake per answer: '+o.k[0]);names.add(o.k[0]);
      const units=Object.entries(o.g).reduce((s,[r,v])=>{assert.ok(['food','timber','iron','oil','goods'].includes(r));assert.ok(Number.isInteger(v)&&v>0);return s+v;},0);
      assert.ok(units>0&&units<=30,`letter ${d} ${o.id}: a modest bundle`);bundles.add(o.k[0]+JSON.stringify(o.g));
      for(const f of Object.keys(o.v||{}))assert.ok(FAMS.includes(f));
      if(o.x)assert.ok(g.UNLOCKS[o.x],o.x);}
    assert.equal(bundles.size,3,`letter ${d}: three different gifts`);
    for(const id of c.cz||[])assert.ok(g.UNLOCKS[id]&&g.UNLOCKS[id].src==='xmas',id);});
  assert.deepEqual(J(S.ch.map((c,i)=>c.cz?i+1:0).filter(Boolean)),[5,10,15,20,24,25],'the Customise days');
  assert.deepEqual(J(S.ch.map(c=>(c.cz||[]).length).filter(Boolean)),[1,1,1,1,5,5]);
  /* in every voice, knowing Mara or not, along three paths: nothing left unfilled */
  for(const f of FAMS)for(const ws of [null,{v:1,c:[{o:0},{o:0},{o:0},{o:0}],x:{lp:'on',bk:'open',tm:'in'}}])for(const path of [0,1,2]){
    const gg=game(),n=fresh(gg,{fam:f,ws});gg.T.now=U(2026,12,25,2);gg.xmAnswer(0,path);
    for(let d=0;d<=25;d++){const C=gg.xmCtx(n===gg.S.nation?n:gg.S.nation,d),c=gg.xmCh(d);
      const all=c.q.map(p=>gg.xmFill(p,C)).concat(c.o.flatMap((x,i)=>{const o=gg.xmOpt(C,d,i);return [o.say,o.r,o.fx].concat(o.k?o.k:[]);}));
      for(const t of all)assert.doesNotMatch(t,/undefined|NaN|\{[A-Z0-9]+\}|\[\[|\]\]|  /,`${f} ${ws?'K':'new'} path ${path} letter ${d}: ${t.slice(0,80)}`);
      if(d>0)gg.xmAnswer(d,(d+path)%3);}
    assert.doesNotMatch(gg.xmGlobeWords(gg.S.nation),/undefined|\[\[|\{[A-Z]/);}
});

test('the gifts: a bounded budget, fifteen pieces for Customise, the snow globe, and 5 land credits for the note',()=>{
  const g=game(),S=g.XM_STORY,units=o=>Object.values(o.g).reduce((a,b)=>a+b,0);
  const most=S.ch.reduce((s,c)=>s+Math.max(...c.o.map(units)),0),least=S.ch.reduce((s,c)=>s+Math.min(...c.o.map(units)),0);
  assert.ok(most<=760&&least>=200,`${least} to ${most} units in all`);
  const n=fresh(g);g.T.now=U(2026,12,25,5);answerAll(g,25,d=>d===20?1:0);
  assert.equal(g.xmUnlocks(g.S.nation).length,15);assert.ok(g.xmUnlocks(g.S.nation).includes('e-xstar-craft'));
  assert.ok(g.xmUnlocks(g.S.nation).includes('te-lights'),'the special land finish');
  assert.equal(g.UNLOCK_SOURCES.flatMap(s=>s.earned(g.S.nation)).length,15);
  /* the materials may stand above the storage limit, as far as the answers gave */
  assert.ok(g.xsMax(g.S.nation)>0);
  /* the note: 5 land credits whichever answer, counted for every player who reads the record */
  assert.equal(g.landEarned(g.S.nation),10);g.xmAnswer(0,2);assert.equal(g.landEarned(g.S.nation),15);assert.equal(g.xmLand(g.S.nation),5);
  /* answering costs nothing: no material goes down */
  const g2=game(),m=fresh(g2);g2.T.now=U(2026,12,25,5);const st0=clone(m.stock);answerAll(g2,25);
  for(const r of Object.keys(st0))assert.ok(g2.S.nation.stock[r]>=st0[r],r);
  function clone(o){return JSON.parse(JSON.stringify(o));}
});

test('an answer counts as sealed only once a save that carries it is in; one the region did not keep is taken back',()=>{
  const g=game();fresh(g);g.T.now=U(2026,12,2,12);
  g.xmAnswer(1,0);assert.ok(g.XMS.pend&&g.XMS.pend.d===1,'waiting for its save');assert.equal(g.saves,1,'a save asked for at once');
  /* a save that left before the answer does not seal it */
  g.listeners['edictum:saved'].forEach(f=>f({detail:{xm:{n:0,p:0}}}));assert.ok(g.XMS.pend,'an earlier save is not this one');
  g.writeRemote();g.listeners['edictum:saved'].forEach(f=>f({detail:{xm:{n:1,p:0}}}));
  assert.equal(g.XMS.pend,null);assert.equal(g.xmCount(g.S.nation),1);
  /* the region kept none of letter 2 (sent after the close, or another device answered first) */
  g.xmAnswer(2,1);g.writeRemote();g.listeners['edictum:saved'].forEach(f=>f({detail:{xm:{n:1,p:0}}}));
  assert.equal(g.xmCount(g.S.nation),1,'taken back');assert.match(g.XMS.err,/did not accept/);
});

test('the menu, the badge, the Edicts card and the green line in the chat follow the season',()=>{
  const g=game(),n=fresh(g);
  assert.ok(g.EXT_PAGES.includes('christmas'));assert.ok(g.NAV_GROUPS[0].v.includes('christmas'));
  g.T.now=U(2026,11,29,12);g.S.view='nation';
  assert.equal(g.xmChatMix([{id:'a',t:1}]).length,1,'no line before the season');
  g.T.now=U(2026,11,30,8);
  const mixed=g.xmChatMix([{id:'a',t:U(2026,11,29)},{id:'b',t:U(2026,11,30,5)}]);assert.deepEqual(J(mixed.map(m=>m.id)),['a','xm-fest-2026','b'],'in its place, at 00:00 UTC on 30 November');
  assert.match(g.rgcLine(mixed[1]),/The festive season has started\. <a href="#christmas" data-act="go" data-v="christmas">Visit Willow Street now<\/a>/);
  assert.equal(g.rgcLine({id:'z'}),'line:z');
  assert.equal(g.nvxCompute(n,0).christmas.k,1,'the note waits');
  g.T.now=U(2026,12,4,8);assert.equal(g.nvxCompute(n,0).christmas.k,5,'the note and four letters');
  assert.match(g.issuesView({},0),/Four letters are waiting/);
  g.T.now=U(2027,1,7,1);assert.equal(g.xmChatMix([]).length,0,'gone once the calendar closes');assert.equal(g.nvxCompute(n,0).christmas,undefined);
});

test('a preview of another day works only on a development host, and keeps its answers to itself',()=>{
  const prod=game({host:'edictumgame.com',search:'?xmas=2026-12-20T10:00Z'});assert.equal(prod.xmPreview(),false,'never in production');
  const dev=game({host:'localhost',search:'?xmas=2026-12-20T10:00Z'});assert.equal(dev.xmPreview(),true);
  assert.equal(dev.xmArrived(dev.xmNow()),20,'the preview’s clock');
  const n=fresh(dev);dev.xmAnswer(1,0);assert.equal(n.xm,undefined,'nothing saved');assert.equal(dev.S.nation.stock.food,100,'nothing given');
  assert.equal(dev.xmCount(dev.S.nation),1,'the preview remembers it in this tab');assert.equal(dev.commitNo,0);
});

test('the game and the server keep the same calendar and the same pieces',()=>{
  const g=game();
  assert.deepEqual(JSON.parse(JSON.stringify(g.XM_EV)),R.XM_EV);
  for(const [d,list] of Object.entries(R.XM_CZ))assert.deepEqual(J(g.XM_STORY.ch[d-1].cz),list,'letter '+d);
  assert.deepEqual(J(g.XM_STORY.ch[19].o.map(o=>o.x)),R.XM_STARS);
  for(const id of R.XM_IDS)assert.equal(g.UNLOCKS[id].src,'xmas',id);
  for(let d=0;d<=25;d++)assert.equal(g.xmAt(d),R.xmAt(d));
  assert.deepEqual(J(Object.keys(g.XM_STORY.fam).sort()),[...R.XM_FAMS].sort());
});

test('the server holds new answers to their date and order, and never lets a save rewrite or drop one',()=>{
  const A=(id,o,t)=>({id,o,t});
  /* early, and out of order */
  let n={xm:{id:'xmas-2026',c:[A(1,0,U(2026,12,1,1)),A(2,1,U(2026,12,1,2))]}};
  assert.deepEqual(R.xmSettle(n,{},U(2026,12,1,3)),{n:1,p:0});assert.deepEqual(n.xm.c.map(x=>x.id),[1],'letter 2 had not arrived');
  n={xm:{id:'xmas-2026',c:[A(2,0,U(2026,12,2,1))]}};assert.deepEqual(R.xmSettle(n,{},U(2026,12,3)),{n:0,p:0});assert.equal(n.xm,undefined,'not before letter 1');
  /* a saved answer cannot be changed or dropped; a device that lost it gets it back */
  const before={xm:{id:'xmas-2026',c:[A(0,2,U(2026,11,30,5)),A(1,0,U(2026,12,1,1))]}};
  n={xm:{id:'xmas-2026',c:[A(1,2,U(2026,12,1,9)),A(2,1,U(2026,12,2,9))]}};
  assert.deepEqual(R.xmSettle(n,before,U(2026,12,2,10)),{n:2,p:1});assert.deepEqual(n.xm.c.map(x=>[x.id,x.o]),[[0,2],[1,0],[2,1]]);
  n={};assert.deepEqual(R.xmSettle(n,before,U(2026,12,2,10)),{n:1,p:1});assert.equal(n.xm.c.length,2);
  /* the close: made before it and arriving within the grace, yes; made after it, or arriving too late, no */
  const late=t=>({xm:{id:'xmas-2026',c:[A(1,0,t)]}});
  n=late(U(2027,1,6,23,59));assert.equal(R.xmSettle(n,{},U(2027,1,7,0,10)).n,1);
  n=late(U(2027,1,7,0,1));assert.equal(R.xmSettle(n,{},U(2027,1,7,0,2)).n,0);
  n=late(U(2027,1,6,23,59));assert.equal(R.xmSettle(n,{},U(2027,1,7,2)).n,0);
  /* the note stands apart, from 30 November */
  n={xm:{id:'xmas-2026',c:[A(0,1,U(2026,11,30,1))]}};assert.deepEqual(R.xmSettle(n,{},U(2026,11,30,2)),{n:0,p:1});
  n={xm:{id:'xmas-2026',c:[A(0,1,U(2026,11,29,1))]}};assert.deepEqual(R.xmSettle(n,{},U(2026,11,29,2)),{n:0,p:0});
  /* the pieces held: only those the kept answers earn; others untouched */
  const all=Array.from({length:25},(_,i)=>A(i+1,i===19?2:0,U(2026,12,i+1,1)));
  n={xm:{id:'xmas-2026',c:all},cz:{u:['te-lights','e-xstar-street','e-xstar-ada','p-guilloche']}};
  R.xmSettle(n,{},U(2026,12,25,2));assert.deepEqual(n.cz.u,['te-lights','e-xstar-street','p-guilloche']);
  n={xm:{id:'xmas-2026',c:all},cz:{u:['te-lights','p-guilloche']}};R.xmSettle(n,{},U(2026,12,24,2));assert.deepEqual(n.cz.u,['p-guilloche'],'letter 25 not yet: no land finish');
});

test('the Christmas pieces join the game’s own lists, and the Cartographer’s Pack does not count them as worn',()=>{
  const g=game();
  assert.ok(g.CTG_TE.includes('te-lights')&&g.CTG_TB.includes('tb-fairy'));
  assert.deepEqual(J(g.shopCtgWorn(null,{})),['te-hatch']);
  assert.equal(g.PT_ROW_BY.w[2][26],'Paper crown');assert.equal(g.PT_SHOP.w26,'rp-papercrown');
  assert.ok(g.MU_HALLS.some(([k])=>k==='xmas'));assert.equal(typeof g.VIEWS_EXT.christmas,'function');
});
