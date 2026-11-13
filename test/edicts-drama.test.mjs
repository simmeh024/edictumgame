// Crises and gambles (13 November 2026): thirty crisis edicts with a twelve-hour clock, at most three a week, signed
// by the cabinet when the clock runs out; twenty-four edicts with a gamble among their motions, rolled once and seeded.
// Run with: node --test test/edicts-drama.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const START='/* ───────── crises and gambles',END='\n/* ───────── ';
const STAT_KEYS=JSON.parse(source.match(/const STAT_KEYS = (\[[^\]]+\])/)[1].replace(/'/g,'"'));
const BUDGET_KEYS=[...source.slice(source.indexOf('const BUDGET = ['),source.indexOf('];',source.indexOf('const BUDGET = ['))).matchAll(/\['([a-z]+)','/g)].map(m=>m[1]);
const TOPICS=[...source.slice(source.indexOf('const ISSUE_TOPICS = ['),source.indexOf('];',source.indexOf('const ISSUE_TOPICS = ['))).matchAll(/\['([a-z]+)','/g)].map(m=>m[1]);
const OLDER=2556,MINISTERS=['FIN','INT','FOR','DEF','CUL','WRK','HEA'],ODDS=[0.25,0.33,0.5,0.67,0.75,0.8];
const DAY=864e5,H=3600e3,MIN=60000,J=x=>JSON.parse(JSON.stringify(x));
const cut=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i+a.length);assert(i>=0&&j>i,a);return source.slice(i,j);};
const section=()=>{const a=source.indexOf(START);return source.slice(a,source.indexOf(END,a+START.length));};

function content(){
  const ctx={ISSUES:new Array(OLDER).fill(null).map((x,i)=>({id:'old'+i})),ISSUE_BY_ID:{},ISSUES_RANDOM:[],document:{addEventListener(){}},NOTIF_SOURCES:[],NORM_HOOKS:[],DAY};
  vm.createContext(ctx);
  const s=section();
  vm.runInContext(s.slice(0,s.indexOf('const CRS_MS='))+'\nthis.J=JSON.stringify({C:CRS_ISSUES,G:GMB_ISSUES,R:ISSUES_RANDOM.map(i=>i.id)});',ctx);
  return JSON.parse(ctx.J);
}

test('thirty crises and twenty-four gambles, numbered after every older edict, in the last edict section',()=>{
  const {C,G,R}=content();
  assert.equal(C.length,30);assert.equal(G.length,24);
  assert.deepEqual(C.concat(G).map(x=>x.no),Array.from({length:54},(x,i)=>OLDER+1+i));
  const a=source.indexOf(START);
  assert(a>source.indexOf('for(const is of CHN_ISSUES)'),'after the chains, so no number moves');
  assert(source.indexOf(END,a+START.length)<=source.indexOf('/* ───────── the browser tab'),'before the browser tab');
  const later=source.indexOf('ISSUES.push(',source.indexOf(END,a+START.length)),pt=source.indexOf('/* ───────── portraits of state: the court painter');
  assert(later===-1||(pt>a&&later>pt),'only the court painter’s edict (its own test) is added after this section');
  assert.deepEqual(R,G.map(x=>x.id),'gambles are drawn at random; crises only come by their own clock');
  const split=readFileSync(new URL('../scripts/split-content.mjs',import.meta.url),'utf8');
  assert(/'CRS_ISSUES'/.test(split)&&/'GMB_ISSUES'/.test(split),'the content split carries them');
});

test('a crisis names the cabinet’s motion and the minister who signs it; that motion is never a gamble',()=>{
  const {C}=content();
  for(const is of C){
    assert(/^crs-[a-z0-9-]+$/.test(is.id),is.id);assert.equal(is.crs,1,is.id);assert(TOPICS.includes(is.c),is.id);
    assert.equal(is.o.length,3,is.id);
    assert(Number.isInteger(is.cb)&&is.cb>=0&&is.cb<3,is.id+' cb');assert(!is.o[is.cb].g,is.id+' the cabinet does not gamble');
    assert(MINISTERS.includes(is.cbm),is.id+' cbm');assert(is.o[is.cb].t.includes('{'+is.cbm+'}'),is.id+' the signing minister speaks for that motion');
    const g=is.o.filter(o=>o.g).length;assert(g>=1&&g<=2,is.id+' one gamble, two at most');
  }
});

test('a gamble edict has one or two gambles, all six odds are used, and both outcomes are worded',()=>{
  const {C,G}=content();
  for(const is of G){assert(/^risk-[a-z0-9-]+$/.test(is.id),is.id);assert.equal(is.w,2,is.id);assert(TOPICS.includes(is.c),is.id);assert.equal(is.o.length,3,is.id);
    const g=is.o.filter(o=>o.g).length;assert(g>=1&&g<=2,is.id);}
  const used=new Set();
  for(const is of C.concat(G))for(const o of is.o)if(o.g){
    assert(ODDS.includes(o.g.p),is.id+' p '+o.g.p);used.add(o.g.p);
    for(const k of ['w','l'])assert(typeof o.g[k]==='string'&&o.g[k].length<=45&&/^[a-z{]/.test(o.g[k])&&!/[.!]$/.test(o.g[k]),is.id+' '+k+': '+o.g[k]);
    assert(typeof o.g.fx==='string'&&o.g.fx.length>20&&o.g.fx!==o.fx,is.id+' failure decree');
    assert(o.g.e&&Object.keys(o.g.e).length,is.id+' failure effects');
  }
  assert.deepEqual([...used].sort(),ODDS.slice().sort());
});

test('effects use the game’s own keys, in the house sizes',()=>{
  const {C,G}=content();
  const check=(id,e)=>{for(const [k,v] of Object.entries(e)){
    if(k==='b'){for(const [bk,bv] of Object.entries(v))assert(BUDGET_KEYS.includes(bk)&&Number.isInteger(bv)&&bv&&Math.abs(bv)<=2,id+' budget '+bk);}
    else assert(STAT_KEYS.includes(k)&&Number.isInteger(v)&&v&&Math.abs(v)<=(k==='wealth'?3:5),id+' '+k+'='+v);}};
  for(const is of C.concat(G))for(const o of is.o){check(is.id,o.e);if(o.g)check(is.id,o.g.e);}
});

test('wording: unique ids and titles, known placeholders, typographic quotes, decrees without a full stop',()=>{
  const {C,G}=content(),all=C.concat(G),ids=new Set(),titles=new Set();
  const PH=new Set(['N','D','C','Cs','CAP','A','As','SPORT',...MINISTERS]);
  for(const is of all){
    assert(!ids.has(is.id),is.id);ids.add(is.id);assert(!titles.has(is.t),is.t);titles.add(is.t);
    assert.equal(source.split(`t:'${is.t}'`).length-1,1,'title used once in the game: '+is.t);
    const texts=[is.t,is.q,...is.o.flatMap(o=>[o.t,o.fx,...(o.g?[o.g.w,o.g.l,o.g.fx]:[])])];
    for(const t of texts){
      for(const m of t.matchAll(/\{([A-Za-z]+)\}/g))assert(PH.has(m[1]),is.id+' placeholder '+m[1]);
      assert(!/["']/.test(t),is.id+' straight quote: '+t.slice(0,50));assert(!/postcode/i.test(t),is.id+' zip code');
    }
    for(const o of is.o)for(const fx of [o.fx,o.g&&o.g.fx].filter(Boolean))assert(!/\.$/.test(fx)||/”$/.test(fx),is.id+' decree ends without a full stop');
  }
});

/* ── the clock: the desk's own syncInbox with the crisis section beside it ── */
function desk(){
  const ctx=vm.createContext({});
  vm.runInContext(`
    const CAP_BASE=5,CAP_VIP=10,EDICT_KEEP=CAP_VIP,CRS_KEEP=3,DAY=864e5,window={},document={addEventListener(){}},NORM_HOOKS=[],NOTIF_SOURCES=[],S={},OBS=false;let VIP_RUNS=[];
    ${source.match(/function edictCapAt\(t\) \{[^\n]*\}/)[0]}${cut('function hash(','\n')}\n${cut('function rng(','\n')}\n
    const clone=o=>JSON.parse(JSON.stringify(o)),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));function incomingShared(){return [];}function sharedInto(){}
    function b1Draw(m){return {id:'e'+m.issueSeq,at:m.issueClock};}
    const PF={int:['int','the Interior','Interior Minister'],wrk:['wrk','Public Works','Minister of Public Works']};function cabOf(){return {int:{nm:'Ada Brook'},wrk:{nm:'Ivo Lund'}};}
    function decisions(n){return n.dec||0;}function regionIssueOk(){return true;}function safeReq(){return true;}
    function issLast(n){const m=new Map();(n.iseen||[]).forEach((id,r)=>m.set(id,{d:r,r}));return m;}
    function markSeen(n,id){n.iseen=(n.iseen||[]).filter(x=>x!==id).concat(id);}
    function fill(t){return String(t);}function classify(s){return s.happy>60?'happy':'plain';}function popNow(n){return n.pop||1;}
    function applyEffects(n,e){for(const k of Object.keys(e))if(k in n.s)n.s[k]=clamp(n.s[k]+e[k],0,100);}
    const ISSUES=[],ISSUE_BY_ID={},ISSUES_RANDOM=[];
    ${cut('const AWAY_MIN=10*60000;','function foundStats(')}
    ${section().replace(/const CRS_ISSUES=\[[\s\S]*?\n\];\nconst GMB_ISSUES=\[[\s\S]*?\n\];/,`const CRS_ISSUES=[{id:'crs-a',crs:1,cb:1,cbm:'WRK',t:'A',o:[{e:{happy:3},fx:'a',g:{p:0.5,e:{happy:-3},fx:'a2'}},{e:{happy:1},fx:'b'},{e:{happy:-1},fx:'c'}]},{id:'crs-b',crs:1,cb:0,cbm:'INT',t:'B',o:[{e:{safety:1},fx:'d'},{e:{safety:2},fx:'e'},{e:{safety:3},fx:'f',g:{p:0.33,e:{safety:-3},fx:'f2'}}]},{id:'crs-c',crs:1,cb:2,cbm:'INT',t:'C',o:[{e:{env:1},fx:'g'},{e:{env:2},fx:'h'},{e:{env:3},fx:'i'}]}];\nconst GMB_ISSUES=[];`)}
    this.D={syncInbox,deskN,crsWeek,crsDue,crsSign,crsLate,crsDeadline,crsCabOpt,gmbRoll,optOf,crsZone,CRS_EPOCH,CRS_MS,ISSUE_BY_ID,setRuns:r=>{VIP_RUNS=r;}};`,ctx);
  return ctx.D;
}
const T0=Date.UTC(2026,10,23);/* a Monday, after the start */
const nation=(o={})=>({seed:'s1',name:'Testland',founded:T0-30*DAY,dec:40,freq:60,inbox:[],issueClock:T0,issueSeq:0,s:{happy:50,safety:50,env:50},answered:[],log:[],crz:60,...o});

test('one to three crises a week, on different days, between eight in the morning and eight at night',()=>{
  const D=desk(),counts={1:0,2:0,3:0};
  for(const seed of ['a','b','c','d','e','f','g','h']){
    for(let w=0;w<120;w++){
      const z=[-300,0,60,330,600][w%5],n=nation({seed,crz:z}),t=D.crsWeek(n,w);
      assert(t.length>=1&&t.length<=3,'count');counts[t.length]++;
      const days=t.map(x=>Math.floor((x+z*MIN-D.CRS_EPOCH)/DAY));assert.equal(new Set(days).size,t.length,'different days');
      for(const x of t){const h=((x+z*MIN)%DAY+DAY)%DAY/H;assert(h>=8&&h<20,'local hour '+h);}
      assert.deepEqual(t,t.slice().sort((a,b)=>a-b));assert.deepEqual(D.crsWeek(n,w),t,'the same every time');
    }
  }
  assert(counts[1]&&counts[2]&&counts[3],JSON.stringify(counts));
});

test('a crisis lands on a full desk, never more than three a week, and the desk’s room ignores it',()=>{
  const D=desk();
  let n=nation({inbox:[1,2,3,4,5].map(i=>({id:'e'+i,at:T0})),issueClock:T0});
  const seen=new Map();
  for(let t=T0;t<T0+10*7*DAY;t+=H){
    n=D.syncInbox(n,t);
    for(const x of n.inbox)if(x.cr&&!seen.has(x.at)){seen.set(x.at,x.id);assert(x.at<=t&&t<x.at+H+1,'arrives on time');}
    assert.equal(D.deskN(n.inbox),5,'the five ordinary edicts stay; no slot was taken by a crisis');
    n={...n,inbox:n.inbox.filter(x=>!x.cr||t-x.at<2*H)};/* the player decides it within two hours */
  }
  const per={};for(const at of seen.keys()){const w=Math.floor((at-D.CRS_EPOCH)/(7*DAY));per[w]=(per[w]||0)+1;}
  assert(Object.values(per).every(k=>k>=1&&k<=3),JSON.stringify(per));
  assert(seen.size>=10,'about two a week: '+seen.size);
});

test('no crisis for a new nation, nor in a holiday; one that ran out unseen is dropped; a holiday stops the clock',()=>{
  const D=desk(),w=Math.floor((T0-D.CRS_EPOCH)/(7*DAY)),n0=nation(),s=D.crsWeek(n0,w)[0];
  assert(D.crsDue(nation({dec:3}),s+MIN)===null,'ten decisions first');
  assert(D.crsDue(nation({founded:s-DAY}),s+MIN)===null,'two days old first');
  assert.deepEqual(J(D.crsDue(n0,s+MIN)),[s]);
  assert(D.crsDue(nation({away:{a:s-H,b:s+H}}),s+2*H)===null,'not in a holiday');
  assert(D.crsDue(n0,s+D.CRS_MS+MIN)===null,'ran out before anyone looked: dropped');
  const v=D.syncInbox(n0,s+MIN),x=v.inbox.find(e=>e.cr);assert(x&&x.at===s&&D.ISSUE_BY_ID[x.id].crs);
  assert.equal(v.crt,s);assert.equal(v.crz,60);
  assert.equal(D.crsDeadline(v,x),s+D.CRS_MS);
  const hol={...v,away:{a:s+H,b:s+5*H}};assert.equal(D.crsDeadline(hol,x),s+D.CRS_MS+4*H,'the holiday stops the clock');
  assert.equal(D.syncInbox(v,s+2*MIN).inbox.filter(e=>e.cr).length,1,'delivered once');
});

test('when the clock runs out the minister signs the cabinet’s motion, which is never the gamble',()=>{
  const D=desk(),is=D.ISSUE_BY_ID['crs-a'];
  assert.equal(D.crsCabOpt(is),1);assert.equal(D.crsCabOpt({o:[{g:{}},{},{}],cb:0}),1,'a gamble is never the cabinet’s');
  const n=nation({inbox:[{id:'crs-a',at:T0,cr:1},{id:'e1',at:T0}]});
  assert.equal(D.crsLate(n,T0+D.CRS_MS-1).length,0);assert.equal(D.crsLate(n,T0+D.CRS_MS).length,1);
  const m=JSON.parse(JSON.stringify(n)),r=D.crsSign(m,m.inbox[0],T0+D.CRS_MS+5*MIN);
  assert.equal(r.o,1);assert.equal(m.s.happy,51);assert.deepEqual(J(m.inbox.map(x=>x.id)),['e1']);
  assert.deepEqual(J(m.answered.at(-1)),{id:'crs-a',o:1,t:T0+D.CRS_MS,fx:'b',c:1});
  assert.equal(m.crl[0].id,'crs-a');
});

test('a gamble rolls once, seeded on the nation and the edict’s arrival, and comes off about as often as it says',()=>{
  const D=desk();
  const a=D.gmbRoll({seed:'x'},'gmb-a',{at:5},0.67),b=D.gmbRoll({seed:'x'},'gmb-a',{at:5},0.67);assert.deepEqual(a,b,'no second try');
  assert.equal(a.need,67);assert.equal(a.ok,a.roll<=67);
  for(const p of [0.25,0.33,0.5,0.67,0.75,0.8]){
    let k=0;const N=6000;for(let i=0;i<N;i++)if(D.gmbRoll({seed:'s'+i},'gmb-'+(i%7),{at:i*977},p).ok)k++;
    assert(Math.abs(k/N-p)<0.025,p+': '+k/N);
  }
  const is=D.ISSUE_BY_ID['crs-a'];
  assert.deepEqual(JSON.parse(JSON.stringify(D.optOf(is,0,0))).e,{happy:-3},'a lost gamble had its own effects');
  assert.deepEqual(JSON.parse(JSON.stringify(D.optOf(is,0,1))).e,{happy:3});assert.equal(D.optOf(is,1).fx,'b');
});

test('the game wires it in: answer rolls, a crisis has no veto, loading keeps crises beside ten edicts',()=>{
  const ans=cut('function answer(id,o,how){','\nfunction dismiss(');
  assert(/gmbRoll\(n,id,ent,opt0\.g\.p\)/.test(ans)&&/rec\.g=gm\.ok\?1:0/.test(ans),'answer rolls and keeps the outcome');
  assert(/if\(n\.inbox\.some\(x=>x\.id===id&&x\.cr\)\)\{crsHandOver\(id\);return;\}/.test(cut('function dismiss(id){','\n}\n')),'no veto on a crisis');
  for(const f of ['function normalizeGeo(','function normalizeWorld(','function normalizeBase(']){const i=source.indexOf(f),body=source.slice(i,source.indexOf('\n}\n',i));
    assert(/inbox[^;]*cr!==1\)\.slice\(0,EDICT_KEEP\)\.concat\([^;]*slice\(0,CRS_KEEP\)/.test(body),f);}
  assert(/crsTick\(now,v\)/.test(cut('function tick(){','\n}\n')),'the tick keeps the clock');
  assert(/sfx\('stamp',hit\)/.test(cut('function fxResult(viaVT){','\n}\n')),'the seal sounds at the impact');
  assert(/'crt', 'crz', 'crl', 'crd', 'gmb'/.test(readFileSync(new URL('../src/shim.js',import.meta.url),'utf8')),'the clock is kept in the private half');
});
