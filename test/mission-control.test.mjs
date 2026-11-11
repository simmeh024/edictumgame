// Letters from Mission Control: the story's own section run with the game's real edict clock (syncInbox, holidays,
// nextEntry, follow-ups), Willow Street's real section beside it, the real mandate arithmetic, and simple stand-ins for
// the rest of the game. Run with: node --test test/mission-control.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {splitContent} from '../scripts/split-content.mjs';

const html=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8'),src=html.match(/<script>([\s\S]*)<\/script>\s*$/)[1];
const cut=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i+a.length);assert.ok(i>=0&&j>i,'section '+a);return src.slice(i,j);};
const fn=name=>{const i=src.indexOf('function '+name+'('),j=src.indexOf('\n}\n',i);assert.ok(i>=0&&j>i,name);return src.slice(i,j+2);};
const literal=name=>{const m=src.match(new RegExp('const '+name+'\\s*=\\s*([^;]+);'));assert.ok(m,name);return m[1];};
const WS=cut('/* ───────── Letters from Willow Street: one citizen','\n/* ───────── ');
const MC=cut('/* ───────── Letters from Mission Control:','\n/* ───────── Mission Control on the Space page');
const UI=cut('/* ───────── Mission Control on the Space page','\n/* ───────── ');
const lineOf=(s,start)=>{const i=s.indexOf(start);assert.ok(i>=0,start);return s.slice(i,s.indexOf('\n',i));};
const fnIn=(s,name)=>{const i=s.indexOf('function '+name+'('),j=s.indexOf('\n}\n',i);assert.ok(i>=0&&j>i,name);return s.slice(i,j+2);};
const STAT_KEYS=JSON.parse(literal('STAT_KEYS').replace(/'/g,'"'));
const FAMS=['rep','crn','imp','sul','the','peo','col','bor'],OLD=40,MIN=60000,DAY=864e5;

function game(){
  const ctx=vm.createContext({console});
  vm.runInContext(`
    const SP_POP_PREP=0.02;let spLandBonus=()=>null;
    const CAP_BASE=5,CAP_VIP=10,EDICT_KEEP=CAP_VIP,DAY=864e5,STAT_KEYS=${JSON.stringify(STAT_KEYS)};const MONARCH_PRE=${literal('MONARCH_PRE')};const MONARCH_LEADER=${literal('MONARCH_LEADER')};
    const LVL=v=>v<36?0:v>64?2:1,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),clone=o=>JSON.parse(JSON.stringify(o));
    let VIP_RUNS=[];${src.match(/function edictCapAt\(t\) \{[^\n]*\}/)[0]}${fn('hash')}${fn('rng')}
    const ISSUES=Array.from({length:${OLD}},(x,i)=>({id:'old'+i,c:'econ',t:'Old '+i,q:'q',o:[{t:'a',e:{econ:1},fx:'one'},{t:'b',e:{econ:-1},fx:'two'},{t:'c',e:{happy:1},fx:'three',nx:'chain-b'}]}));
    ISSUES.push({id:'chain-b',fo:1,c:'econ',t:'Follow-up',q:'q',o:[{t:'a',e:{econ:1},fx:'f'},{t:'b',e:{econ:1},fx:'g'},{t:'c',e:{econ:1},fx:'h'}]});
    ISSUES.push({id:'moon-base',c:'tech',t:'Fly Me to the Moon',q:'q',o:[]});
    ISSUES.forEach((x,i)=>{x.no=i+1;});const ISSUE_BY_ID=Object.fromEntries(ISSUES.map(x=>[x.id,x])),ISSUES_RANDOM=ISSUES.filter(i=>!i.fo);
    const NORM_HOOKS=[],COMMIT_HOOKS=[],UNLOCK_SOURCES=[],MAP_LAYERS=[],CZ_FR={},toasts=[];let czSeq=0,renders=0;
    const UNLOCKS={'t-welllit':{k:'title',n:'the Well-Lit',src:'ws'},'s-received':{k:'stamp',n:'R',src:'ws'},'e-loaf':{k:'emblem',n:'Loaf',src:'ws'},'a-crust':{k:'accent',n:'Crust',src:'ws'},'m-quote':{k:'motto',n:'Q',src:'ws'},'p-cobble':{k:'pattern',n:'C',src:'ws'},'f-crayon':{k:'frame',n:'C',src:'ws'},'pn-lamp':{k:'pin',n:'Lamp',src:'ws'}};
    const S={nation:null,mode:'local',world:null,result:null};
    const window={scrollTo(){}},document={addEventListener(){}};
    function render(){renders++;}function toast(m){toasts.push(m);}
    function tallyOf(n,k){return (n&&n.tly&&n.tly[k])||0;}function decisions(n){return n.dec||0;}
    function markSeen(n,id){n.iseen=[...new Set((n.iseen||[]).concat(ISSUE_BY_ID[id].no))];}
    function pickIssue(n){const ids=ISSUES.filter(i=>!i.fo&&!i.ws&&!i.mc&&i.id&&!n.inbox.some(x=>x.id===i.id));return ids[hash(n.seed+':'+n.issueSeq)%ids.length].id;}
    function incomingShared(){return [];}function sharedInto(){}function b1Draw(m){return nextEntry(m);}
    function edictPriorNorm(p){return p&&p.id?p:null;}function findNation(){return null;}function pickNb(){return null;}
    function commit(n){const now=Date.now();for(const h of COMMIT_HOOKS)for(const t of h(n,S.nation,now)||[])toast(t);S.nation=n;}
    function fill(t,n,x){return String(t).replace(/\\{N\\}/g,n.name).replace(/\\{CAP\\}/g,n.capital).replace(/\\{L\\}/g,n.leader).replace(/\\{D\\}/g,n.demonym).replace(/\\{(Cs|C|A|As|FIN|DEF|FOR|INT|WRK|HEA|CUL)\\}/g,'x');}
    function geoAfter(n,opt,ent,now){return [];}
    function applyP(n,e){if(e&&e.p)for(const k of Object.keys(e.p)){if(e.p[k])n.policies[k]=true;else delete n.policies[k];}}
    function answer(id,o){const now=Date.now(),n=clone(syncInbox(S.nation,now)),ent=n.inbox.find(x=>x.id===id);if(!ent)return;
      const is=ISSUE_BY_ID[id],opt=is&&is.o[o];if(!opt)return;const wasFull=n.inbox.length>=edictCapAt(now),fx=fill(opt.fx,n,ent);
      for(const k of Object.keys(opt.e||{}))if(k in n.s)n.s[k]=clamp(n.s[k]+opt.e[k],0,100);applyP(n,opt.e);const geo=geoAfter(n,opt,ent,now);
      if(opt.nx)n.chain=(n.chain||[]).concat({id:opt.nx,at:now+3600e3});
      n.answered.push({id,o,t:now,fx});n.answered=n.answered.slice(-80);n.inbox=n.inbox.filter(x=>x.id!==id);if(wasFull)n.issueClock=now;
      if(o>=0)n.dec=(n.dec||0)+1;markSeen(n,id);commit(n);S.result={id,o,fx,t:now,geo,ctx:ent.nb?{nb:ent.nb}:null};render();}
    ${fn('dismiss')}
    function landEarned(n){return 0;}function earnedAt(n,p){return 0;}function uxUnlockInfo(){return null;}function achUnlockWords(u){return 'keepsake '+u;}
    function issuesView(){return '';}function issueView(){return '';}function resultView(){return '';}
    function czStampArt(){return '';}function czEmblemSVG(){return '';}function czPatSVG(){return '';}function czFrameArt(){return ['',''];}function pnSVG(){return '<svg></svg>';}function czSil(){return '';}
    ${fn('roman')}const fmt0=v=>String(v);function list(a){a=a.filter(Boolean);if(a.length<2)return a[0]||'';if(a.length===2)return a[0]+' and '+a[1];return a.slice(0,-1).join(', ')+', and '+a[a.length-1];}const cap1=s=>s?s[0].toUpperCase()+s.slice(1):s;const esc=s=>String(s);
    function cityList(n){return (n&&n.cities)||[];}const fmtDur=ms=>Math.round(ms/60000)+' min';
    ${['function pol(','function govApproval(','const MD_CAP=10,MD_COST=','function mdRate(','function mdOne(','function mdCost(','function mdOk(','function mdWait(','const mdFmt=','function mdSpend(','function mdGain(','function mdShort(','function gvDecree('].map(s=>lineOf(src,s)).join('\n')}
    ${fn('mdNow')}${fn('gvLdr')}
    function applyEffects(n,e){for(const k of Object.keys(e))if(k in n.s)n.s[k]=clamp(n.s[k]+e[k],0,100);}
    ${cut('const AWAY_MIN=10*60000;','function foundStats(')}
    ${cut('function safeReq(is,n)','/* issues other players sent')}
    ${fn('fdFam')}
    ${WS}
    ${MC}
    ${lineOf(UI,'for(const [k,v] of Object.entries(MC_MD))')}
    ${UI.slice(UI.indexOf('const MC_MD_WHAT='),UI.indexOf('/* whether a spend is on offer now'))}
    ${fnIn(UI,'mcMdState')}${fnIn(UI,'mcSpend')}
    const mcNow=()=>Date.now();
    this.G={S,ISSUES,ISSUE_BY_ID,ISSUES_RANDOM,NORM_HOOKS,COMMIT_HOOKS,toasts,syncInbox,answer,dismiss,commit,fill,
      MC_STORY,MC_IDS,MC_TITLES,MC_FACTS,MC_MS,MC_CHAIN,MC_AT,MC_GATE,mcGate,MC_ODDS,MC_GUAR,MC_SEC,MC_MD,MD_COST,MC_TEAM_KEYS,WS_FAMS,
      mcOf,mcNorm,mcBlank,mcCtx,mcCtxNorm,mcLetter,mcOutcome,mcVariant,mcReveal,mcReady,mcNext,mcRoll,mcDone,mcDoneAt,mcHas,mcSlots,mcActive,mcStartProblem,mcHours,mcCost,mcManifest,mcCond,mcDsl,mcCr,mcMdState,mcSpend,mcSiteSecs,mcCrew,
      mdCost,mdNow,wsOf,fdFam,SPX_AT,SPX_AGAIN,SPX_ID,SPX_TEAM,spOpen,spPreDue,spPre,spPreAt,mcVet,mcPrepFlown,MC_FX,landBonus:(n,b,t)=>spLandBonus(n,b,t),setRuns:r=>{VIP_RUNS=r;}};`,ctx);
  return ctx.G;
}
const G0=game();
/* a nation as the founding page leaves it, then normalised as every load does */
function nation(G,over={}){
  const now=Date.now(),n=Object.assign({name:'Testoria',pretitle:'Republic',leader:'President',capital:'Port Test',demonym:'Testorian',currency:'crown',animal:'otter',
    founded:now-60*DAY,seed:'42',s:Object.fromEntries(STAT_KEYS.map(k=>[k,50])),policies:{},answered:[],inbox:[],issueClock:now,issueSeq:0,freq:60,log:[],dec:0,cities:[{id:'cap',c:5,nm:'',t:now-60*DAY,b:[]}]},over);
  return normalize(G,n);
}
function normalize(G,d){const n=JSON.parse(JSON.stringify(d));n.inbox=(d.inbox||[]).filter(x=>x&&G.ISSUE_BY_ID[x.id]).slice(0,5).map(x=>({id:x.id,at:x.at}));for(const h of G.NORM_HOOKS)h(n,d);return n;}
/* the desk as the player sees it after `slots` arrival times have passed */
function after(G,n,slots){const m=JSON.parse(JSON.stringify(n));m.issueClock=Date.now()-slots*m.freq*MIN-1000;return G.syncInbox(m,Date.now());}
const isMc=x=>/^mc-\d/.test(x.id),mcOn=n=>[...n.inbox].filter(isMc),J=x=>JSON.parse(JSON.stringify(x));
/* a nation that has enacted e edicts, with Willow Street's letters up to date so none of them is due */
function ready(G,e=MC0,over={}){const n=nation(G,over);if(!n.mc.p)n.mc.p={o:0,t:Date.now()-30*DAY};n.ws.e=e;n.ws.c=[5,10,25,50,100,250,500,1000].filter(a=>a<=e).map(()=>({o:0,f:'rep',b:'111',t:1,x:'',n:''}));if(n.ws.c.length>=8)n.ws.d=1;return n;}
const MC0=G0.MC_AT;
/* the agency, with a mission flown (s and d in the past) */
function agency(n,tm='flt',flown={}){const now=Date.now();n.mc.a={nm:'Testorian Space Agency',t:now-30*DAY,f:tm,tm:{sci:now-30*DAY,flt:now-30*DAY,eng:now-30*DAY}};
  for(const [k,d] of Object.entries(flown))n.mc.ms[k]={s:now-d-3600e3,d:now-d};return n;}
const bld=(n,k,d=Date.now()-DAY)=>{n.cities[0].b.push({k,s:d-3600e3,d});return n;};
/* the ordinary edicts on the desk are all answered, the story's letter left alone */
function clearDesk(G){for(const x of G.S.nation.inbox.filter(x=>!isMc(x)&&!/^ws-/.test(x.id)))G.answer(x.id,0);}

test('fourteen letters, numbered after every other edict, out of the random pool; the old charter edict joins them',()=>{
  const G=game();
  assert.deepEqual(J([...G.MC_IDS]),Array.from({length:14},(x,k)=>'mc-'+(k+1)));
  G.MC_IDS.forEach(id=>{const is=G.ISSUE_BY_ID[id];assert.equal(is.fo,1);assert.equal(is.o.length,3);assert.ok(!G.ISSUES_RANDOM.includes(is));});
  assert.equal(G.ISSUE_BY_ID['moon-base'].fo,1,'Fly Me to the Moon is chapter IX now');assert.ok(!G.ISSUES_RANDOM.includes(G.ISSUE_BY_ID['moon-base']));
  const ws=src.indexOf('/* ───────── Letters from Willow Street: one citizen'),mc=src.indexOf('/* ───────── Letters from Mission Control:'),last=src.lastIndexOf('for(const is of NS_ISSUES)');
  assert.ok(mc>last&&mc>ws,'after the last batch of edicts, so no number moves');
  assert.equal(G.MC_TITLES[0],'A Letter in the Wrong Tray');assert.equal(G.MC_TITLES[13],'The First Night');
});

test('112 versions: every family tells all fourteen chapters, with the facts the mechanics need',()=>{
  const G=game(),F=G.MC_STORY.fam,need={2:['p3','wide','sharp'],3:['rl','dom','partner'],4:['pub','pub','keep'],5:['ps','high','low'],6:['rv','rec','route'],9:['hb','big','power'],12:['lz','pref','backup']};
  const CH9={rep:['elected','appointed'],crn:['royal','civil'],imp:['frontier','civilian'],sul:['concession','public'],the:['protect','sample'],peo:['vote','central'],col:['foreign','local'],bor:['shared','rates']};
  assert.deepEqual(J(Object.keys(F).sort()),[...FAMS].sort());let versions=0;
  for(const f of FAMS){assert.equal(F[f].ch.length,14,f);
    F[f].ch.forEach((ch,k)=>{const vs=Array.isArray(ch)?ch:[ch];assert.ok(vs.length&&vs.every(Boolean),f+' '+(k+1));
      for(const v of vs){versions++;assert.equal(v.o.length,3,f+' '+(k+1));const got=x=>new Set(v.o.map(o=>o.s&&o.s[x]));
        if(need[k])for(const val of need[k].slice(1))assert.ok(got(need[k][0]).has(val),`${f} ${k+1} offers ${need[k][0]}=${val}`);
        if(k===0)assert.ok(v.o.every(o=>o.sn),f+': every sponsor is named');
        if(k===8){for(const val of CH9[f])assert.ok(got('ch').has(val),`${f} IX offers ${val}`);assert.ok(v.o.filter(o=>o.e.p&&o.e.p.moonBase).length>=2,f+' IX grants the base');}
        if(k===13)assert.ok(v.o.every(o=>o.s&&o.s.lamp==='yes'),f+': the lamp, at last');}});}
  assert.ok(versions>=112,'at least 112 versions');
  /* each family speaks for itself: the chapter IX letters differ, and so do their speakers */
  const ix=FAMS.map(f=>{const v=F[f].ch[8];return (Array.isArray(v)?v[v.length-1]:v).o.map(o=>o.t).join('|');});assert.equal(new Set(ix).size,8);
});

test('the opening: nothing below 50 enacted edicts, then one roll per eligible slot, derived from the slot itself',()=>{
  const G=game();
  let n=ready(G,MC0-1);n=after(G,n,5);assert.equal(mcOn(n).length,0,'49 edicts: no letter');assert.equal(n.mc.r||0,0,'and no roll');
  n=ready(G,MC0);const v=after(G,n,5);
  /* each of the five slots rolled (or the letter came): the misses are counted, the last slot rolled is kept */
  assert.ok(mcOn(v).length===1||v.mc.r===5,'five eligible slots: a letter or five misses');
  assert.ok(v.mc.rt>0,'the last slot rolled is kept');
  /* the same record, the same slots: the same outcome (a reload, another device) */
  const T0=Date.now()-6*3600e3,at=m=>{const c=J(m);c.issueClock=T0;return G.syncInbox(c,T0+5*3600e3+1);},v1=at(n),v2=at(normalize(G,J(n)));assert.deepEqual(J(v1.mc),J(v2.mc));assert.deepEqual(J(v1.inbox.map(x=>x.id)),J(v2.inbox.map(x=>x.id)));
  /* the roll is the slot's: one in eight over many slots */
  let hits=0;for(let i=0;i<4000;i++)if(G.mcRoll({seed:'s'+i},1.79e12+i*3600e3))hits++;assert.ok(hits>380&&hits<620,'about one in eight: '+hits);
});

test('the twelfth eligible slot brings it, whatever the dice say, and only once per nation',()=>{
  const G=game();
  /* a fixed clock: slot i arrives at T0 + i hours, so the rolls are known in advance */
  const H=3600e3,T0=Date.now()-30*H;
  let seed=null;for(let s=0;s<20000&&!seed;s++){const sd='z'+s;let miss=true;for(let i=1;i<=12;i++)if(G.mcRoll({seed:sd},T0+i*H)){miss=false;break;}if(miss)seed=sd;}
  assert.ok(seed,'found a seed whose dice miss twelve times running');
  let m=ready(G,MC0,{seed});m.issueClock=T0;
  /* slot by slot, the desk cleared between them as a player answering would (an answer to a desk with room leaves the clock alone) */
  let at=-1;for(let i=1;i<=12&&at<0;i++){m=G.syncInbox(m,T0+i*H+1);if(mcOn(m).length)at=i;else{assert.equal(m.mc.r,i,'miss '+i+' kept');assert.equal(m.mc.rt,T0+i*H,'the slot rolled');
    const back=normalize(G,J(m));assert.equal(back.mc.r,i,'and kept across a reload');m=back;m.inbox=[];}}
  assert.equal(at,12,'the twelfth eligible arrival');assert.equal(m.mc.r,0);
  /* the same slot cannot be rolled twice: a copy of the record from before the twelfth slot brings the same letter */
  G.S.nation=m;G.answer('mc-1',0);assert.equal(G.S.nation.mc.c.length,1);
  /* never again: the opening is resolved, so the next slots bring nothing from Mission Control */
  for(let i=0;i<20;i++){const v=after(G,G.S.nation,1);assert.equal(mcOn(v).length,0);G.S.nation=v;clearDesk(G);}
});

test('slots that cannot take the letter do not roll: a full desk, a holiday, a follow-up or a Willow Street letter first',()=>{
  const G=game(),now=Date.now();
  /* a full desk: no slot, no roll */
  let n=ready(G,MC0);n.inbox=[0,1,2,3,4].map(i=>({id:'old'+i,at:now-1}));let v=after(G,n,6);assert.equal(v.mc.r||0,0,'full desk');assert.equal(mcOn(v).length,0);
  /* a holiday: no slot */
  n=ready(G,MC0);n.away={a:now-7*3600e3,b:now+3600e3};v=after(G,n,6);assert.equal(v.mc.r||0,0,'holiday');assert.equal(mcOn(v).length,0);
  /* a follow-up due takes the slot */
  n=ready(G,MC0);n.chain=[{id:'chain-b',at:now-10*3600e3}];v=G.syncInbox(Object.assign(JSON.parse(JSON.stringify(n)),{issueClock:now-60*MIN-1000}),now);
  assert.equal(v.inbox[0].id,'chain-b');assert.equal(v.mc.r||0,0,'the follow-up’s slot is not rolled');
  /* a Willow Street letter due takes the slot */
  n=ready(G,MC0);n.ws.c=n.ws.c.slice(0,3);v=G.syncInbox(Object.assign(JSON.parse(JSON.stringify(n)),{issueClock:now-60*MIN-1000}),now);
  assert.equal(v.inbox[0].id,'ws-4');assert.equal(v.mc.r||0,0,'Willow Street first');
  /* a member's bigger desk: slots up to ten roll */
  G.setRuns([[now-DAY,now+DAY]]);n=ready(G,MC0,{seed:'q'});v=after(G,n,8);assert.ok(mcOn(v).length===1||v.mc.r===8);G.setRuns([]);
});

test('missions: buildings and earlier missions come first, one per team, two slots with Mission Control',()=>{
  const G=game(),now=Date.now();let n=ready(G,10);
  assert.match(G.mcStartProblem(n,'cam',now),/Found the space agency/);
  agency(n,'flt');n.mc.a.tm={flt:n.mc.a.t};
  assert.equal(G.mcStartProblem(n,'cam',now),'');assert.match(G.mcStartProblem(n,'scope',now),/Fund the Science & Survey team/);
  assert.match(G.mcStartProblem(n,'orb',now),/Mission Control/,'the orbital pass needs Mission Control');
  n.mc.ms.cam={s:now-3600e3,d:now-60e3};assert.match(G.mcStartProblem(n,'orb',now),/Mission Control/);
  bld(n,'mctrl');assert.match(G.mcStartProblem(n,'orb',now),/Something Came Back/,'the orbital pass waits for letter III, which asks how to fly it');assert.equal(G.mcSlots(n,now),2,'Mission Control adds a slot');
  const letters=k=>Array.from({length:k},()=>({o:0,f:'rep',b:'111',t:1,x:''}));
  n.mc.c=letters(3);assert.equal(G.mcStartProblem(n,'orb',now),'','letter III answered: the pass may fly');
  n.mc.ms.orb={s:now-60e3,d:now+3600e3};assert.match(G.mcStartProblem(n,'relay',now),/orbital pass/);
  n.mc.a.tm.sci=now;assert.match(G.mcStartProblem(n,'polar',now),/Deep Space Tracking Station/);
  /* the relay waits for letter IV (alone or with a partner), then for a station to hear it */
  n.mc.ms.orb.d=now-60e3;assert.match(G.mcStartProblem(n,'relay',now),/The Missing Eleven Minutes/);
  n.mc.c=letters(4);assert.equal(G.mcStartProblem(n,'relay',now),'');
  n.mc.ms.relay={s:now-7200e3,d:now-60e3,v:'dom'};assert.equal(G.mcDone(n,'relay',now),false,'no station, no data');
  bld(n,'dsts',now-30e3);assert.equal(G.mcDone(n,'relay',now),true);assert.equal(G.mcDoneAt(n,'relay',now),now-30e3,'received when the station opened');
  /* chapter III needs Mission Control and the flight test; chapter V the station and the relay */
  assert.equal(G.mcReady(n,2,now),true);assert.equal(G.mcReady(n,4,now),true);
  const m=ready(G,10);agency(m,'sci',{scope:60e3});assert.equal(G.mcReady(m,1,now),true,'the first image');assert.equal(G.mcReady(m,2,now),false,'no test flight, no Mission Control');
  /* an Observatory or a Space Port the nation already has is credited */
  const o=ready(G,10);agency(o,'eng');bld(o,'observ');bld(o,'spaceport');assert.equal(G.mcDone(o,'scope',now),true);assert.equal(G.mcDone(o,'cam',now),true);
});

test('the chart lights up as the missions land, and only adds',()=>{
  const G=game(),now=Date.now(),count=n=>[...G.mcReveal(n,now)].reduce((a,v)=>a+v,0),sharp=n=>[...G.mcReveal(n,now)].filter(v=>v>1).length;
  const n=ready(G,10);assert.equal(count(n),0,'black before anything flies');agency(n,'eng');assert.equal(count(n),0);
  let prev=0;const steps=[['trk',0],['cam',0],['orb',0],['relay',0],['polar',0],['rover',0],['cargo',0],['hab',0]];
  bld(n,'mctrl');bld(n,'dsts');bld(n,'robo');bld(n,'crewc');
  for(const [k] of steps){if(k==='cargo')bld(n,'spaceport');n.mc.ms[k]={s:now-7200e3,d:now-60e3};const c=count(n);assert.ok(c>prev,k+' lights more of the chart: '+c);prev=c;}
  assert.ok(sharp(n)>0,'some sectors are charted in detail');assert.ok(prev<G.MC_SEC,'not the whole Moon');
  /* a sector survey charts its sector */
  const s=G.mcReveal(n,now).findIndex(v=>v===0);n.mc.ms['sc'+s]={s:now-7200e3,d:now-60e3};assert.equal(G.mcReveal(n,now)[s],2);
  /* wider or sharper: chapter III's choice shapes the orbital pass that follows it */
  const w=ready(G,10);agency(w,'flt',{cam:DAY});const sh=JSON.parse(JSON.stringify(w));w.mc.ms.orb={s:now-7200e3,d:now-60e3,v:'wide'};sh.mc.ms.orb={s:now-7200e3,d:now-60e3,v:'sharp'};
  assert.ok(count(w)>count(sh),'the wide pass sees more');assert.ok(sharp(sh)>sharp(w),'the sharp pass charts more');
});

test('a veto files the proposal as failed, the story goes on, and the mission can still be flown',()=>{
  const G=game(),now=Date.now();let n=ready(G,2000,{seed:'v'});n.mc.r=11;agency(n,'flt',{cam:DAY});G.S.nation=after(G,n,1);
  assert.deepEqual(J(mcOn(G.S.nation).map(x=>x.id)),['mc-1']);G.dismiss('mc-1');
  const w=G.S.nation.mc;assert.equal(w.c.length,1);assert.equal(w.c[0].o,-1);assert.equal(w.x.tr,-1,'Okafor remembers');
  /* the next chapter is due (the camera test already flew): it comes, and remembers the failure */
  const v=after(G,G.S.nation,1);assert.deepEqual(J(mcOn(v).map(x=>x.id)),['mc-2']);
  const L=G.mcLetter(v.inbox.find(isMc).mc);assert.match(L.paras[0],/did not pass/);
  /* a vetoed chapter III leaves the pass at its default; the mission is flown with ordinary funding all the same */
  const m=ready(G,10);agency(m,'flt',{cam:DAY});bld(m,'mctrl');m.mc.c=[0,0,-1].map(o=>({o,f:'rep',b:'111',t:1,x:''}));assert.equal(G.mcStartProblem(m,'orb',now),'');
});

test('one letter on the desk at a time, and a nation that is ahead catches up through ordinary slots',()=>{
  const G=game();let n=ready(G,2000,{seed:'c'});n.mc.r=11;agency(n,'flt',{cam:DAY,orb:DAY});bld(n,'mctrl');G.S.nation=after(G,n,3);
  assert.equal(mcOn(G.S.nation).length,1,'only one on the desk');
  for(let k=0;k<4;k++){const id='mc-'+(k+1);assert.equal(mcOn(G.S.nation)[0].id,id);G.answer(id,0);G.S.nation=after(G,G.S.nation,1);clearDesk(G);}
  assert.equal(G.S.nation.mc.c.length,4,'four answered');assert.equal(mcOn(G.S.nation).length,0,'chapter V waits for the station and the relay');
});

test('a change of government: the letter on the desk keeps its voice; the next one is addressed to the new authority',()=>{
  const G=game();let n=ready(G,2000,{seed:'g'});n.mc.r=11;agency(n,'flt',{cam:DAY});n=after(G,n,1);
  const ent=n.inbox.find(isMc),before=G.fill('{MCQ}',n,ent);
  /* a revolution: the Republic becomes a Kingdom, and the freedoms collapse */
  n.pretitle='Kingdom';n.leader='King';n.s.civil=5;n.s.pol=5;n.policies.censorship=true;
  assert.equal(G.fdFam(n),'crn');assert.equal(G.fill('{MCQ}',n,ent),before,'the same letter after the revolution');
  const back=normalize(G,JSON.parse(JSON.stringify(n)));assert.deepEqual(J(back.inbox.find(isMc).mc),J(ent.mc),'and after a reload');
  G.S.nation=back;G.answer('mc-1',0);assert.equal(G.S.nation.mc.c[0].f,'rep','resolved as it arrived');assert.ok(G.S.nation.mc.c[0].sn,'the sponsor is remembered');
  const v=after(G,G.S.nation,1),c=v.inbox.find(isMc).mc;assert.equal(c.f,'crn');assert.equal(c.g,'rep');
  const L=G.mcLetter(c);assert.match(L.to,/Crown/);assert.ok(L.paras[0].includes('the Senate'),'she notes the change, naming the old government');
});

test('the sponsor speaks at the charter, and a refused contract never reaches the manifest',()=>{
  const G=game();
  for(const f of FAMS){const v0=G.MC_STORY.fam[f].ch[8],v=Array.isArray(v0)?v0[v0.length-1]:v0;
    const base={v:1,k:8,f,b:'111',p:[],x:{},h:[0,0,0,0,0,0,0,0],hf:Array(8).fill(f),g:f,ag:'X',tm:'flt',dn:[],bl:[],cr:0,sn:'Sponsor'};
    const texts=[0,1,2].map(o=>{const c={...base,h:[o,0,0,0,0,0,0,0]};return G.mcLetter(c).paras.join(' ')+G.mcVariant(c).o.map(x=>G.mcDsl(x.t,c)).join(' ');});
    assert.ok(new Set(texts).size>1,f+': who sponsored the agency changes the hearing');}
  /* the manifest lists cargo from answers given, never from an option refused or a proposal vetoed */
  const n=ready(G,10);const cg=[];for(const f of FAMS)G.MC_STORY.fam[f].ch.forEach((ch,k)=>{const v=Array.isArray(ch)?ch[ch.length-1]:ch;v.o.forEach((o,i)=>{if(o.cg)cg.push([f,k,i,o.cg]);});});
  assert.ok(cg.length>0,'some answers carry cargo');
  for(const [f,k,i,line] of cg){const m=JSON.parse(JSON.stringify(n));m.mc.c=Array.from({length:k+1},(x,j)=>({o:j===k?(i+1)%3:0,f,b:'111',t:1,x:''}));
    assert.ok(!G.mcManifest(m).includes(line),`${f} ${k+1}: refused cargo stays at home`);m.mc.c[k].o=-1;assert.ok(!G.mcManifest(m).includes(line),'vetoed cargo too');
    m.mc.c[k].o=i;assert.ok(G.mcManifest(m).includes(line),`${f} ${k+1}: accepted cargo goes up`);}
});

test('the mandate: the decree prices, charged once with the effect, and the two gains come once',()=>{
  const G=game(),now=Date.now();let n=ready(G,10);agency(n,'flt',{cam:DAY});n.mdt={v:10,t:now};G.S.nation=n;
  assert.equal(G.mdCost(n,'mcStaff'),2);assert.equal(G.mdCost(n,'mcRelay'),3);assert.equal(G.mdCost(n,'mcReview'),4);
  n.policies.upperHouse=true;n.policies.proportionalRep=true;assert.equal(G.mdCost(n,'mcReview'),6,'more people to persuade');
  n.policies={noElections:true};assert.equal(G.mdCost(n,'mcStaff'),1,'one-person rule');
  assert.ok(!Object.keys(G.MD_COST).includes('mcStaff'),'the decree list on the Government page is unchanged');
  /* second staff: charged and applied together, once */
  n.policies={};G.S.nation=n;assert.equal(G.mcSlots(n,now),1);G.mcSpend('mcStaff');
  let m=G.S.nation;assert.equal(G.mcSlots(m,now),2);assert.ok(Math.abs(G.mdNow(m,now)-8)<0.01,'two spent');assert.equal(m.ldr.d,1,'counted in the leader’s record');
  G.mcSpend('mcStaff');assert.ok(Math.abs(G.mdNow(G.S.nation,now)-8)<0.01,'not twice');
  /* a relay window: half the remaining relay, once; with too little mandate nothing changes and the relay flies anyway */
  m=G.S.nation;m.mc.ms.orb={s:now-DAY,d:now-60e3};m.mc.ms.relay={s:now-60e3,d:now+10*3600e3-60e3,v:'dom'};m.mdt={v:2,t:now};G.S.nation=m;
  G.mcSpend('mcRelay');assert.equal(G.S.nation.mc.ms.relay.d,now+10*3600e3-60e3,'not enough mandate: nothing charged, nothing changed');assert.ok(!G.S.nation.mc.md.c4);
  m=G.S.nation;m.mdt={v:10,t:now};G.S.nation=m;G.mcSpend('mcRelay');const r=G.S.nation.mc.ms.relay;assert.ok(Math.abs(r.d-(now+5*3600e3-60e3))<5000,'five hours sooner');assert.ok(G.S.nation.mc.md.c4);
  /* the gains: publishing the far-side charts, and the first night */
  m=G.S.nation;m.mdt={v:3,t:now};m.mc.c=Array.from({length:5},()=>({o:0,f:'rep',b:'111',t:1,x:''}));m.mc.x.pub='pub';G.S.nation=m;G.commit(JSON.parse(JSON.stringify(m)));
  assert.ok(Math.abs(G.mdNow(G.S.nation,Date.now())-4)<0.05,'+1 once');G.commit(JSON.parse(JSON.stringify(G.S.nation)));assert.ok(Math.abs(G.mdNow(G.S.nation,Date.now())-4)<0.05,'not twice');
  m=G.S.nation;m.mc.c=Array.from({length:14},()=>({o:0,f:'rep',b:'111',t:1,x:''}));m.sp={moon:{t:now-3600e3,c:12345,e:3}};m.mc.ld={t:now-3600e3,c:12345,p:0};G.S.nation=m;G.commit(JSON.parse(JSON.stringify(m)));
  assert.ok(Math.abs(G.mdNow(G.S.nation,Date.now())-6)<0.05,'+2 after the first night');G.commit(JSON.parse(JSON.stringify(G.S.nation)));assert.ok(Math.abs(G.mdNow(G.S.nation,Date.now())-6)<0.05,'once');
});

test('veterans: a wonder under way, a wonder finished or a colony landed credits the programme from the saved facts',()=>{
  const G=game(),now=Date.now();
  const w=ready(G,MC0);w.cities[0].b.push({k:'lunar',s:now-DAY,d:now+DAY});assert.equal(G.mcCr(w,now),1);
  assert.ok(G.MC_CHAIN.filter(k=>k!=='prep').every(k=>G.mcDone(w,k,now)),'every mission before the wonder is credited');assert.equal(G.mcDone(w,'prep',now),false);
  assert.ok([1,2,3,4,5,6,7,8,9,10,11].every(k=>G.mcReady(w,k,now)),'chapters II to XII may arrive');assert.equal(G.mcReady(w,12,now),false);
  /* the launch preparation is never credited before a colony stands: it can still be flown for its settlers */
  const d=ready(G,MC0);d.cities[0].b.push({k:'lunar',s:now-5*DAY,d:now-DAY});assert.equal(G.mcCr(d,now),2);assert.equal(G.mcDone(d,'prep',now),false);assert.equal(G.mcReady(d,12,now),true);
  agency(d,'flt');assert.equal(G.mcStartProblem(d,'prep',now),'','the preparation can be flown once the wonder is complete');
  const c=ready(G,MC0);c.cities[0].b.push({k:'lunar',s:now-50*DAY,d:now-40*DAY});c.sp={moon:{t:now-30*DAY,c:4242,k:'',b:'',p:3,pa:now,e:9}};assert.equal(G.mcCr(c,now),3);assert.equal(G.mcReady(c,13,now),true);assert.equal(G.mcDone(c,'prep',now),true,'credited once landed');
  /* their letters still come one at a time, at the normal pace */
  c.mc.r=11;G.S.nation=after(G,c,4);assert.equal(mcOn(G.S.nation).length,1);
  /* an old colony gets no landing bonus: the agency did not prepare that landing */
  const v=ready(G,10);v.sp={moon:{t:now-30*DAY,c:4242,e:9}};G.S.nation=v;G.commit(JSON.parse(JSON.stringify(v)));assert.equal(G.S.nation.sp.moon.e,9);assert.ok(!G.S.nation.mc.ld,'no agency, no crewed-landing record');
  /* a landing prepared by the agency: the crew lands with 20,000 settlers and two more points (given at the landing,
     never again by the save hook), recorded once, and gone with the colony if the landing is lost */
  const p=ready(G,10);agency(p,'flt');p.mc.ms.prep={s:now-5*DAY,d:now-DAY};
  assert.deepEqual(J(G.landBonus(p,{id:'moon'},now)),{p:0.02,e:2});assert.equal(G.landBonus(p,{id:'mars'},now),null,'the Moon only');
  assert.equal(G.landBonus(v,{id:'moon'},now),null,'no agency, no bonus');
  const late=ready(G,10);agency(late,'flt');late.mc.ms.prep={s:now-DAY,d:now+DAY};assert.equal(G.landBonus(late,{id:'moon'},now),null,'not before it is flown');
  /* the credited preparation of a nation that is already landed is not a flown one */
  const cr=ready(G,10);agency(cr,'flt');cr.cities[0].b.push({k:'lunar',s:now-9*DAY,d:now-5*DAY});cr.sp={moon:{t:now-DAY,c:5,e:3}};assert.equal(G.mcDone(cr,'prep',now),true);assert.equal(G.mcPrepFlown(cr,now),false);
  G.S.nation=p;const q=JSON.parse(JSON.stringify(p));q.sp={moon:{t:now,c:777,p:0.02,e:5}};G.commit(q);
  assert.equal(G.S.nation.sp.moon.e,5);assert.equal(G.S.nation.mc.ld.p,1);G.commit(JSON.parse(JSON.stringify(G.S.nation)));assert.equal(G.S.nation.sp.moon.e,5,'once');
  const lost=JSON.parse(JSON.stringify(G.S.nation));delete lost.sp;G.commit(lost);assert.ok(!G.S.nation.mc.ld);
  /* an unprepared landing is recorded without the flag, and gets nothing */
  const u=ready(G,10);agency(u,'flt');G.S.nation=u;const uq=JSON.parse(JSON.stringify(u));uq.sp={moon:{t:now,c:778,e:3}};G.commit(uq);assert.equal(G.S.nation.mc.ld.p,0);assert.equal(G.S.nation.sp.moon.e,3);
});

test('stored records are checked: damage is dropped, a letter that is not next leaves the desk, and nothing is guessed',()=>{
  const G=game(),now=Date.now();
  const bad=G.mcNorm({v:1,a:{nm:'X'.repeat(90),t:now,f:'zzz',tm:{}},ms:{cam:{s:now,d:now-5},orb:{s:now-1,d:now+99*DAY},sc999:{s:1,d:2},fake:{s:1,d:2},scope:{s:now-10,d:now-5,v:'<b>'}},c:[{o:5}],x:{p3:'huge',rl:'dom',tr:9},r:99,md:{c1:'yes',c4:now},pf:-3,xn:'  Lamplighter\u0007 One  ',ld:{t:now,c:-1}},{});
  assert.equal(bad.a,null,'an agency without a known first team is not guessed');assert.deepEqual(J(Object.keys(bad.ms)),['scope']);assert.equal(bad.ms.scope.v,undefined);
  assert.deepEqual(J(bad.c),[]);assert.deepEqual(J(bad.x),{rl:'dom',tr:3});assert.equal(bad.r,0);assert.deepEqual(J(bad.md),{c4:now});assert.equal(bad.pf,undefined);assert.equal(bad.xn,'Lamplighter One');assert.equal(bad.ld,undefined);
  assert.deepEqual(J(G.mcNorm(null,{})),J(G.mcBlank()));assert.deepEqual(J(G.mcNorm({v:2},{})),J(G.mcBlank()));
  /* the desk: a letter whose context is damaged, or which is not the next chapter, is not kept */
  let n=ready(G,MC0,{seed:'d'});n.mc.r=11;agency(n,'flt',{cam:DAY});n=after(G,n,1);const x=n.inbox.find(isMc);
  const d1=JSON.parse(JSON.stringify(n));d1.inbox.find(isMc).mc.k=3;assert.equal(normalize(G,d1).inbox.filter(isMc).length,0);
  const d2=JSON.parse(JSON.stringify(n));d2.inbox.find(isMc).id='mc-5';assert.equal(normalize(G,d2).inbox.filter(isMc).length,0);
  const ok=normalize(G,JSON.parse(JSON.stringify(n)));assert.deepEqual(J(ok.inbox.find(isMc).mc),J(x.mc));
  /* the private half only */
  const shim=readFileSync(new URL('../src/shim.js',import.meta.url),'utf8');assert.match(shim,/'gwl', 'mc'\]/);
});

test('the letters are cached with the other stories, and read the same after extraction',()=>{
  const story=MC.slice(MC.indexOf('const MC_STORY='),MC.indexOf('}};',MC.indexOf('const MC_STORY='))+3);
  const split=splitContent(story+'\nthis.out=MC_STORY;');
  assert.ok(split.count>300,'the letters’ long texts move to the content file ('+split.count+')');assert.ok(split.content.includes('Ministry of Fisheries'));
  const a=vm.createContext({}),b=vm.createContext({});vm.runInContext(story+'\nthis.out=MC_STORY;',a);
  vm.runInContext('var window=this;window.__edictum={};',b);vm.runInContext(split.content,b);vm.runInContext(split.code,b);
  assert.deepEqual(J(b.out),J(a.out));
  assert.match(readFileSync(new URL('../scripts/split-content.mjs',import.meta.url),'utf8'),/'MC_STORY'/);
});

/* the game's own replay of this device's actions onto another device's save (actRecord, rebaseActs) */
const RFROM=html.indexOf('const ACT_SKIP='),RTO=html.indexOf('/* The account control lives in the Firebase adapter.');
const replay=()=>new Function('RES',`
  const clone=v=>JSON.parse(JSON.stringify(v)),num0=v=>Number(v)||0,OBS=false,PV=null,S={nation:null};let commitNo=0,carried=false;
  const roundStock=st=>Object.fromEntries(RES.map(r=>[r,Math.round(num0(st[r])*100)/100]));const stockNow=n=>({...n.stock});
  ${html.slice(RFROM,RTO)}
  return {S,act(n){const r=actRecord(n);S.nation=n;commitNo++;return r;},rebase:rebaseActs};`)(['food','timber','iron','oil','goods']);
const rbase=()=>({name:'Testland',updatedAt:1,stock:{food:50,timber:50,iron:50,oil:50,goods:100},mdt:{v:10,t:1},ldr:{t:1,e:0,d:0},inbox:[{id:'mc-3',at:5}],answered:[],
  mc:{v:1,a:{nm:'A',t:1,f:'flt',tm:{flt:1}},ms:{orb:{s:1,d:2}},c:[{o:0,f:'rep',b:'111',t:1,x:''},{o:0,f:'rep',b:'111',t:1,x:''}],x:{},r:0,md:{}}});
const rplay=(g,f)=>{const n=JSON.parse(JSON.stringify(g.S.nation));f(n);n._stockSet=true;g.act(n);};

test('two devices: a mission, a mandate spend, a letter or a landing is never applied or paid twice',()=>{
  /* the relay started on both: the replay is left out whole, so its cost is not charged a second time */
  let g=replay();g.S.nation=rbase();rplay(g,n=>{n.mc.ms.relay={s:10,d:20,v:'dom'};n.stock.goods-=12;n.stock.iron-=15;n.stock.oil-=8;});
  let cloud={...rbase(),updatedAt:2,stock:{food:50,timber:50,iron:35,oil:42,goods:88}};cloud.mc.ms.relay={s:11,d:21,v:'dom'};
  assert.equal(g.rebase(cloud),null,'the other device’s relay stands, and nothing is replayed');
  /* the same mandate spend on both: the other device's charge and effect stand, once */
  g=replay();g.S.nation=rbase();rplay(g,n=>{n.mdt={v:7,t:10};n.ldr={t:1,e:0,d:1};n.mc.md={c4:10};n.mc.ms.relay={s:5,d:10};});
  cloud={...rbase(),updatedAt:2,mdt:{v:7,t:9},ldr:{t:1,e:0,d:1}};cloud.mc.md={c4:9};
  assert.equal(g.rebase(cloud),null,'the spend is not replayed onto a save that already holds one');
  /* different spends on each device are both kept */
  g=replay();g.S.nation=rbase();rplay(g,n=>{n.mc.md={c1:10};});cloud={...rbase(),updatedAt:2,motto:'x'};
  const r=g.rebase(cloud);assert.equal(r.clash,0);assert.equal(r.n.mc.md.c1,10);
  /* the same letter answered on both: the answer that removes it from the desk cannot be replayed */
  g=replay();g.S.nation=rbase();rplay(g,n=>{n.inbox=[];n.answered.push({id:'mc-3',o:1,t:10,fx:'x'});});
  cloud={...rbase(),updatedAt:2,inbox:[],answered:[{id:'mc-3',o:0,t:9,fx:'y'}]};assert.equal(g.rebase(cloud),null);
  /* a landing on both: one colony, one landing cost */
  g=replay();g.S.nation=rbase();rplay(g,n=>{n.sp={moon:{t:10,c:7,e:3}};n.stock.goods-=50;});
  cloud={...rbase(),updatedAt:2,sp:{moon:{t:9,c:8,e:3}},stock:{food:50,timber:50,iron:50,oil:50,goods:50}};assert.equal(g.rebase(cloud),null);
});

test('every letter also waits for its gate of enacted edicts: 50, 100, 200, 300, 450, 600, 800 … 1,600',()=>{
  const G=game(),now=Date.now();
  assert.deepEqual(J(G.MC_GATE),[50,100,200,300,450,600,800,1000,1200,1400,1600]);
  assert.deepEqual(J(Array.from({length:14},(x,k)=>G.mcGate(k))),[50,100,200,300,450,600,800,1000,1200,1400,1600,1600,1600,1600],'letters XII to XIV keep the last gate');
  /* evenly spaced: no gap between two letters more than 200 edicts (13 days at 15 a day) */
  assert.ok(G.MC_GATE.every((g,i)=>!i||g-G.MC_GATE[i-1]<=200));
  assert.equal(G.MC_AT,G.MC_GATE[0]);
  /* a nation far ahead: the Lunar Colony landed, so every chapter's mission is credited; only the gates hold it back */
  const ahead=(e,k)=>{const n=ready(G,e);n.cities[0].b.push({k:'lunar',s:now-50*DAY,d:now-40*DAY});n.sp={moon:{t:now-30*DAY,c:4242,k:'',b:'',p:3,pa:now,e:9}};
    n.mc.c=Array.from({length:k},()=>({o:0,f:'rep',b:'111',t:1,x:''}));return n;};
  for(let k=1;k<14;k++){const g=G.mcGate(k);
    assert.ok(G.mcReady(ahead(g,k),k,now),'chapter '+(k+1)+' is otherwise ready');
    assert.equal(G.mcNext(ahead(g-1,k),now),-1,`letter ${k+1} waits at ${g-1} edicts`);
    assert.equal(G.mcNext(ahead(g,k),now),k,`letter ${k+1} may come at ${g}`);}
  /* through the real edict clock: chapter III needs 200, so at 150 it stays away however many slots pass */
  let n=ahead(150,2);n=after(G,n,5);assert.equal(mcOn(n).length,0,'150 edicts: no letter III');
  n=ahead(200,2);n=after(G,n,1);assert.deepEqual(J(mcOn(n).map(x=>x.id)),['mc-3'],'200 edicts: it comes with the next slot');
  /* the gate counts enacted edicts only: answering the letters does not open the next gate */
  n=ready(G,100,{seed:'gate'});n.mc.r=11;agency(n,'flt',{cam:DAY});G.S.nation=after(G,n,1);G.answer('mc-1',0);
  assert.equal(G.S.nation.ws.e,100,'a letter answered is not an enacted edict');G.S.nation=after(G,G.S.nation,1);assert.deepEqual(J(mcOn(G.S.nation).map(x=>x.id)),['mc-2']);
  G.answer('mc-2',0);bld(G.S.nation,'mctrl');G.S.nation=after(G,G.S.nation,3);assert.equal(mcOn(G.S.nation).length,0,'letter III waits for 200 edicts');
  clearDesk(G);assert.equal(G.S.nation.ws.e,103,'three ordinary edicts enacted');
});

test('a letter weighs like an ordinary edict: its stat changes count twice, its laws once',()=>{
  const G=game();assert.equal(G.MC_FX,2);
  const n=ready(G,MC0,{seed:'fx'});n.mc.r=11;agency(n,'flt',{cam:DAY});G.S.nation=after(G,n,1);
  const ent=mcOn(G.S.nation)[0];assert.ok(ent,'letter I is on the desk');const e=G.mcVariant(ent.mc).o[0].e,before={...G.S.nation.s};
  const keys=Object.keys(e).filter(k=>typeof e[k]==='number'&&k in before);assert.ok(keys.length>0,'the answer moves some stats');
  G.answer(ent.id,0);for(const k of keys)assert.equal(G.S.nation.s[k],Math.max(0,Math.min(100,before[k]+2*e[k])),k);
});

/* ── the prelude: the edict that opens the Space page ── */
const closed=(G,e)=>{const n=ready(G,e);delete n.mc.p;return n;};
const isPre=G=>x=>x.id===G.SPX_ID;
test('the Space page opens with an edict once 25 edicts are enacted: certain, one copy, and any answer opens it',()=>{
  const G=game(),pre=isPre(G);
  assert.equal(G.SPX_AT,25);
  let n=closed(G,24);assert.equal(G.spOpen(n),false,'closed below the count');n=after(G,n,6);assert.equal(n.inbox.filter(pre).length,0,'24 edicts: no prelude');
  const v=after(G,closed(G,25),1);assert.deepEqual(J(v.inbox.map(x=>x.id)),[G.SPX_ID],'the very next slot brings it, no dice');
  assert.equal(after(G,v,4).inbox.filter(pre).length,1,'one copy, however many slots pass');
  const is=G.ISSUE_BY_ID[G.SPX_ID];assert.equal(is.fo,1);assert.ok(!G.ISSUES_RANDOM.includes(is),'never drawn at random');assert.equal(is.o.length,3);
  assert.deepEqual(J(G.SPX_TEAM).sort(),['eng','flt','sci'],'each answer backs a different team');
  for(let o=0;o<3;o++){G.S.nation=after(G,closed(G,25),1);G.toasts.length=0;G.answer(G.SPX_ID,o);const m=G.S.nation;
    assert.equal(m.mc.p.o,o);assert.ok(G.spOpen(m),'open after answer '+(o+1));assert.ok(G.toasts.some(t=>/Space page is open/.test(t)),'and the player is told');
    assert.equal(m.ws.e,25,'a story edict: it does not count as an enacted edict');
    const back=normalize(G,J(m));assert.equal(back.mc.p.o,o,'kept across a reload');
    assert.equal(after(G,back,6).inbox.filter(pre).length,0,'and it never comes again');}
  /* a Willow Street letter due at the same count goes first, then the prelude */
  n=closed(G,25);n.ws.c=n.ws.c.slice(0,2);let w=after(G,n,1);assert.equal(w.inbox[0].id,'ws-3','Willow Street first');
  w=after(G,w,1);assert.ok(w.inbox.some(pre),'then the prelude, with the next slot');
});

test('a veto puts it off for five more edicts, and Dr. Okafor’s first letter waits for the page',()=>{
  const G=game(),pre=isPre(G);
  G.S.nation=after(G,closed(G,25),1);G.toasts.length=0;G.dismiss(G.SPX_ID);
  let m=G.S.nation;assert.deepEqual(J(m.mc.p),{o:-1,t:m.mc.p.t,e:25});assert.ok(!G.spOpen(m),'still closed');assert.ok(G.toasts.some(t=>/come back/.test(t)));
  assert.equal(G.spPreAt(m),30);assert.equal(normalize(G,J(m)).mc.p.e,25,'the veto is kept across a reload');
  m.ws.e=29;assert.equal(after(G,m,4).inbox.filter(pre).length,0,'not before thirty');
  m.ws.e=30;G.S.nation=after(G,m,1);assert.ok(G.S.nation.inbox.some(pre),'back at thirty');
  G.answer(G.SPX_ID,1);assert.ok(G.spOpen(G.S.nation));assert.equal(G.S.nation.mc.p.o,1,'an answer after a veto opens it');
  /* sixty edicts on a closed page: the prelude comes, letter I does not, and its dice are not rolled */
  const n=closed(G,60);n.mc.r=11;const v=after(G,n,3);assert.equal(mcOn(v).length,0,'no letter from Mission Control');assert.equal(v.mc.r,11,'no roll while the page is closed');assert.ok(v.inbox.some(pre));
  G.S.nation=v;G.answer(G.SPX_ID,0);const w=after(G,G.S.nation,1);assert.deepEqual(J(mcOn(w).map(x=>x.id)),['mc-1'],'then letter I, with its misses intact');
});

test('a nation already in space keeps the page and never sees the prelude',()=>{
  const G=game(),now=Date.now();
  const cases={agency:n=>agency(n),letter:n=>{n.mc.c=[{o:0,f:'rep',b:'111',t:1,x:''}];},desk:n=>{n.inbox=[{id:'mc-1',at:now-1}];},
    colony:n=>{n.sp={moon:{t:now-DAY,c:5,e:1}};},mars:n=>{n.sp={mars:{t:now-DAY,c:5,e:1}};},belt:n=>{n.belt={st:-1};},wonder:n=>{n.cities[0].b.push({k:'lunar',s:now-DAY,d:now+DAY});}};
  for(const [k,f] of Object.entries(cases)){const n=closed(G,60);f(n);assert.ok(G.spOpen(n,now),k);assert.equal(G.spPreDue(n,now),false,k+': no prelude');
    if(k!=='desk')assert.equal(after(G,n,4).inbox.filter(isPre(G)).length,0,k+': none arrives');}
  assert.equal(G.spOpen(closed(G,60),now),false,'a nation with none of them waits for the edict');
  assert.ok(G.spOpen({npc:1}),'computer nations count as open');
});

test('the prelude’s text and record: known placeholders, a bounded record, and a copy left on the desk goes',()=>{
  const G=game(),P=G.MC_STORY.pre,all=[P.t,P.q,...P.o.flatMap(o=>[o.t,o.fx,o.r]),P.veto].join(' ');
  assert.deepEqual([...new Set(all.match(/\{[A-Z]+\}/g))].sort(),['{CAP}','{DEF}','{HEA}','{N}','{WRK}']);
  assert.ok(P.o.every(o=>o.r.length>80&&o.fx.length>20&&/Ministry of Space Affairs|Agency \(proposed\)/.test(o.fx+o.r)),'every answer founds the Ministry of Space Affairs');
  const n=J(nation(G));
  assert.equal(normalize(G,{...n,mc:{v:1,c:[],ms:{},p:{o:7,t:1}}}).mc.p,undefined,'an unknown answer is dropped');
  assert.deepEqual(J(normalize(G,{...n,mc:{v:1,c:[],ms:{},p:{o:-1,t:5,e:31}}}).mc.p),{o:-1,t:5,e:31});
  const open=normalize(G,{...n,mc:{v:1,c:[],ms:{},p:{o:2,t:5,e:9}},inbox:[{id:G.SPX_ID,at:1}]});
  assert.deepEqual(J(open.mc.p),{o:2,t:5},'a count is kept only with a veto');assert.equal(open.inbox.length,0,'a copy left on the desk after the page opened goes');
});
