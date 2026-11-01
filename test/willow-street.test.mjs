// Letters from Willow Street: the story's own section evaluated with the game's real edict clock (syncInbox, holidays,
// nextEntry and its follow-ups) and the real veto, and simple stand-ins for the rest of the game. Run with:
// node --test test/willow-street.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {splitContent} from '../scripts/split-content.mjs';

const html=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8'),src=html.match(/<script>([\s\S]*)<\/script>\s*$/)[1];
const cut=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i+a.length);assert.ok(i>=0&&j>i,'section '+a);return src.slice(i,j);};
const fn=name=>{const i=src.indexOf('function '+name+'('),j=src.indexOf('\n}\n',i);assert.ok(i>=0&&j>i,name);return src.slice(i,j+2);};
const literal=name=>{const m=src.match(new RegExp('const '+name+'\\s*=\\s*([^;]+);'));assert.ok(m,name);return m[1];};
/* up to the next section, wherever later edicts or other sections are added after it */
const SECTION=cut('/* ───────── Letters from Willow Street: one citizen','\n/* ───────── ');
const STAT_KEYS=JSON.parse(literal('STAT_KEYS').replace(/'/g,'"'));
const BUDGET_KEYS=[...src.slice(src.indexOf('const BUDGET = ['),src.indexOf('];',src.indexOf('const BUDGET = ['))).matchAll(/\['([a-z]+)','/g)].map(m=>m[1]);
const POLICY_KEYS=new Set([...src.slice(src.indexOf('const POLICIES = {'),src.indexOf('const CATS = [')).matchAll(/^\s*([a-zA-Z]+):\[/gm)].map(m=>m[1]));
const PRETITLES=JSON.parse(literal('PRETITLES').replace(/'/g,'"'));
const FAMS=['rep','crn','imp','sul','the','peo','col','bor'],OLD=40,MIN=60000;

/* the section in a small game: real clock, real follow-ups, real holidays, real veto; answer() as the game's does it */
function game(){
  const ctx=vm.createContext({console});
  vm.runInContext(`
    const CAP=5,DAY=864e5,STAT_KEYS=${JSON.stringify(STAT_KEYS)};const MONARCH_PRE=${literal('MONARCH_PRE')};const MONARCH_LEADER=${literal('MONARCH_LEADER')};
    const LVL=v=>v<36?0:v>64?2:1,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),clone=o=>JSON.parse(JSON.stringify(o));
    ${fn('hash')}${fn('rng')}
    const ISSUES=Array.from({length:${OLD}},(x,i)=>({id:'old'+i,c:'econ',t:'Old '+i,q:'q',o:[{t:'a',e:{econ:1},fx:'one'},{t:'b',e:{econ:-1},fx:'two'},{t:'c',e:{happy:1},fx:'three',nx:'chain-b'}]}));
    ISSUES.push({id:'chain-b',fo:1,c:'econ',t:'Follow-up',q:'q',o:[{t:'a',e:{econ:1},fx:'f'},{t:'b',e:{econ:1},fx:'g'},{t:'c',e:{econ:1},fx:'h'}]});
    ISSUES.forEach((x,i)=>{x.no=i+1;});const ISSUE_BY_ID=Object.fromEntries(ISSUES.map(x=>[x.id,x]));
    const NORM_HOOKS=[],COMMIT_HOOKS=[],UNLOCK_SOURCES=[],MAP_LAYERS=[],CZ_FR={},toasts=[];let czSeq=0,renders=0;
    const UNLOCKS={'t-welllit':{k:'title',n:'the Well-Lit',src:'ws'},'s-received':{k:'stamp',n:'Received, with thanks',src:'ws'},'e-loaf':{k:'emblem',n:'Loaf',src:'ws'},'a-crust':{k:'accent',n:'Crust',src:'ws'},'m-quote':{k:'motto',n:'Quotation marks',src:'ws'},'p-cobble':{k:'pattern',n:'Cobblestones',src:'ws'},'f-crayon':{k:'frame',n:'Crayon',src:'ws'},'pn-lamp':{k:'pin',n:'Street lamp',src:'ws'}};
    const S={nation:null,mode:'local',world:null,result:null};
    const window={scrollTo(){}},document={addEventListener(){}};
    function render(){renders++;}function toast(m){toasts.push(m);}
    function tallyOf(n,k){return (n&&n.tly&&n.tly[k])||0;}
    function markSeen(n,id){n.iseen=[...new Set((n.iseen||[]).concat(ISSUE_BY_ID[id].no))];}
    function pickIssue(n){const ids=ISSUES.filter(i=>!i.fo&&!i.ws&&i.id&&!n.inbox.some(x=>x.id===i.id));return ids[hash(n.seed+':'+n.issueSeq)%ids.length].id;}
    function incomingShared(){return [];}function sharedInto(){}function b1Draw(m){return nextEntry(m);}
    function edictPriorNorm(p){return p&&p.id?p:null;}function findNation(){return null;}function pickNb(){return null;}
    function commit(n){const now=Date.now();for(const h of COMMIT_HOOKS)h(n,S.nation,now);S.nation=n;}
    function fill(t,n,x){return String(t).replace(/\\{N\\}/g,n.name).replace(/\\{CAP\\}/g,n.capital).replace(/\\{L\\}/g,n.leader).replace(/\\{D\\}/g,n.demonym).replace(/\\{(Cs|C|A|As|FIN|DEF|FOR|INT|WRK|HEA|CUL)\\}/g,'x');}
    function geoAfter(n,opt,ent,now){return [];}
    function answer(id,o){const now=Date.now(),n=clone(syncInbox(S.nation,now)),ent=n.inbox.find(x=>x.id===id);if(!ent)return;
      const is=ISSUE_BY_ID[id],opt=is&&is.o[o];if(!opt)return;const wasFull=n.inbox.length>=CAP,fx=fill(opt.fx,n,ent);
      for(const k of Object.keys(opt.e||{}))if(k in n.s)n.s[k]=clamp(n.s[k]+opt.e[k],0,100);const geo=geoAfter(n,opt,ent,now);
      if(opt.nx)n.chain=(n.chain||[]).concat({id:opt.nx,at:now+3600e3});
      n.answered.push({id,o,t:now,fx});n.answered=n.answered.slice(-80);n.inbox=n.inbox.filter(x=>x.id!==id);if(wasFull)n.issueClock=now;
      if(o>=0)n.dec=(n.dec||0)+1;markSeen(n,id);commit(n);S.result={id,o,fx,t:now,geo,ctx:ent.nb?{nb:ent.nb}:null};render();}
    ${fn('dismiss')}
    function landEarned(n){return 0;}function earnedAt(n,p){return 0;}function uxUnlockInfo(){return null;}function achUnlockWords(u){return 'keepsake '+u;}
    function issuesView(){return '';}function issueView(){return '';}function resultView(){return '';}
    function czStampArt(){return '';}function czEmblemSVG(){return '';}function czPatSVG(){return '';}function czFrameArt(){return ['',''];}function pnSVG(){return '<svg></svg>';}function czSil(){return '';}
    ${fn('roman')}const fmt0=v=>String(v);function list(a){return a.join(' and ');}const cap1=s=>s?s[0].toUpperCase()+s.slice(1):s;const esc=s=>String(s);
    ${cut('const AWAY_MIN=10*60000;','function foundStats(')}
    ${cut('function safeReq(is,n)','/* issues other players sent')}
    ${fn('fdFam')}
    ${SECTION}
    this.G={S,ISSUES,ISSUE_BY_ID,NORM_HOOKS,COMMIT_HOOKS,UNLOCK_SOURCES,toasts,syncInbox,answer,dismiss,commit,fill,awayStart:null,
      WS_STORY,WS_AT,WS_IDS,WS_FACTS,WS_FAMS,WS_POL,WS_KEEP,wsCond,wsDsl,wsApply,wsVariant,wsLetter,wsOutcome,wsCtx,wsNorm,wsDue,wsLand,wsCtxNorm,wsOf,fdFam};`,ctx);
  return ctx.G;
}
const G0=game();
/* a nation as the founding page leaves it, then normalised as every load does */
function nation(G,over={}){
  const now=Date.now(),n=Object.assign({name:'Testoria',pretitle:'Republic',leader:'President',capital:'Port Test',demonym:'Testorian',currency:'crown',animal:'otter',
    founded:now-30*DAY(),seed:'42',s:Object.fromEntries(STAT_KEYS.map(k=>[k,50])),policies:{},answered:[],inbox:[],issueClock:now,issueSeq:0,freq:60,log:[],dec:0},over);
  return normalize(G,n);
}
function DAY(){return 864e5;}
function normalize(G,d){const n=JSON.parse(JSON.stringify(d));n.inbox=(d.inbox||[]).filter(x=>x&&G.ISSUE_BY_ID[x.id]).slice(0,5).map(x=>({id:x.id,at:x.at}));for(const h of G.NORM_HOOKS)h(n,d);return n;}
/* the desk as the player sees it after `slots` arrival times have passed */
function after(G,n,slots){const m=JSON.parse(JSON.stringify(n));m.issueClock=Date.now()-slots*m.freq*MIN-1000;return G.syncInbox(m,Date.now());}
const wsOn=n=>[...n.inbox].filter(x=>/^ws-/.test(x.id)),ids=a=>[...a].map(x=>x.id);
function play(G,n){G.S.nation=n;return G;}
/* answers the first ordinary edict on the desk, drawing one first if the desk is empty */
function enact(G,o=0){let n=G.S.nation;for(let s=1;!n.inbox.some(x=>!/^ws-/.test(x.id)&&x.id!=='chain-b');s++){n=after(G,G.S.nation,s);G.S.nation=n;}
  G.answer(n.inbox.find(x=>!/^ws-/.test(x.id)&&x.id!=='chain-b').id,o);}
const render=(G,c)=>{const L=G.wsLetter(c);return [L.to,...L.paras,L.sign].join('\n');};

test('the eight letters are edicts of their own: numbered after every other edict, never drawn at random',()=>{
  const G=game();
  assert.deepEqual([...G.WS_IDS],['ws-1','ws-2','ws-3','ws-4','ws-5','ws-6','ws-7','ws-8']);
  assert.deepEqual([...G.WS_AT],[5,10,25,50,100,250,500,1000]);
  G.WS_IDS.forEach((id,k)=>{const is=G.ISSUE_BY_ID[id];assert.equal(is.no,OLD+2+k,'numbered after the others');assert.equal(is.fo,1,'only ever delivered by the story');assert.equal(is.o.length,3);});
  assert.equal(G.ISSUES.slice(0,OLD+1).every((x,i)=>x.no===i+1),true,'older numbers unchanged');
  /* in the real game: after the last batch of edicts, before boot, and out of the random pool */
  const ev=src.indexOf('for(const is of EV_ISSUES){'),ws=src.indexOf('/* ───────── Letters from Willow Street: one citizen');
  assert.ok(ev>0&&ws>ev,'the letters come after the last batch of edicts, so no number moves');
  assert.ok(/const ISSUES_RANDOM=ISSUES\.filter\(i=>!i\.fo\)/.test(src),'fo keeps an edict out of the random pool');
});

test('all 64 versions are complete: three answers each, known effects, facts, placeholders and conditions',()=>{
  const G=game(),S=G.WS_STORY,PH=new Set(['N','D','C','Cs','L','CAP','A','As','SPORT','DISH','LANG','FIN','DEF','FOR','INT','WRK','HEA','CUL']);
  assert.deepEqual(Object.keys(S.fam).sort(),[...FAMS].sort(),'every family has its arc');
  const probe={b:'111',x:{},p:[],h:[],hf:[],f:'rep',g:''},textOk=(t,w)=>{
    for(const m of String(t).matchAll(/\[\[([^|\][]+)\|/g))assert.doesNotThrow(()=>G.wsCond(m[1],probe),w+': '+m[1]);
    for(const m of String(t).matchAll(/\{([^}]*)\}/g))assert.ok(PH.has(m[1])||(m[1]==='WSOLD'&&/trans/.test(w)),w+': {'+m[1]+'}');
    assert.equal((String(t).match(/\[\[/g)||[]).length,(String(t).match(/\]\]/g)||[]).length,w+': balanced');};
  let versions=0;const titles={};
  for(const f of FAMS){const F=S.fam[f];assert.equal(F.ch.length,8,f);textOk(F.to,f);
    F.ch.forEach((ch,k)=>{const vs=Array.isArray(ch)?ch:[ch];if(Array.isArray(ch))assert.ok(!ch[ch.length-1].if,f+' '+k+' ends with an unconditional version');
      for(const v of vs){versions++;const w=f+' letter '+(k+1);titles[f+k]=titles[f+k]||v.t;textOk(v.q,w);textOk(v.t,w);
        assert.equal(v.o.length,3,w);
        v.o.forEach((o,i)=>{const ow=w+' option '+(i+1);assert.ok('hmcrb'.includes(o.k)&&o.k.length===1,ow);
          assert.match(o.t,/^“[^”]+,” [a-z]+ /,ow+' opens with a quoted speech');[o.t,o.fx,o.r].forEach(t=>textOk(t,ow));
          assert.ok(!/[.!?]$/.test(o.fx),ow+' ruling reads on from the decree');
          const keys=Object.keys(o.e);assert.ok(keys.length>=2&&keys.length<=5,ow);
          for(const [key,val] of Object.entries(o.e)){
            if(key==='b'){for(const [bk,bv] of Object.entries(val))assert.ok(BUDGET_KEYS.includes(bk)&&Math.abs(bv)<=2,ow+' budget '+bk);continue;}
            if(key==='p'){for(const pk of Object.keys(val))assert.ok(POLICY_KEYS.has(pk),ow+' law '+pk);continue;}
            assert.ok(STAT_KEYS.includes(key)&&Number.isInteger(val)&&Math.abs(val)<=3&&val!==0,ow+' '+key);}
          for(const [key,val] of Object.entries(o.s||{})){if(key==='tr'){assert.ok([-2,-1,1,2].includes(val),ow);continue;}
            const m=/^(\w+)(?:<([\w/-]+)|@(\w+):([\w/-]+))?$/.exec(String(val));assert.ok(G.WS_FACTS[key]&&m&&G.WS_FACTS[key].includes(m[1]),ow+' fact '+key+'='+val);}
        });}
    });
    for(const [k,key] of [[0,'lp'],[2,'bk'],[6,'ad']])for(const v of [].concat(F.ch[k]))v.o.forEach((o,i)=>assert.ok(o.s&&key in o.s,`${f} letter ${k+1} option ${i+1} records ${key}`));
  }
  assert.ok(versions>=64,'at least one version of each of the 64 letters');
  for(const k of [0,1,2,3,4,5,6,7])assert.equal(new Set(FAMS.map(f=>titles[f+k])).size,8,'each family titles letter '+(k+1)+' its own way');
  assert.equal(titles.rep0,'A Light on Willow Street');assert.equal(titles.crn3,'By Appointment');assert.equal(titles.peo2,'The People’s Bakery');assert.equal(titles.bor7,'Any Other Business');
  /* the shared parts */
  assert.equal(S.band.length,8);for(const b of S.band)for(const ax of ['c','e','p']){assert.equal(b[ax].length,3);b[ax].forEach(t=>textOk(t,'band'));}
  for(const f of FAMS){assert.ok(S.trans[f].includes('{WSOLD}'),f+' transition names the old institution');assert.ok(S.house[f]);}
  for(const [p,k,t] of S.pol){assert.ok(G.WS_POL.includes(p)&&POLICY_KEYS.has(p)&&k>=0&&k<8,p);textOk(t,'law '+p);}
  assert.equal(S.dis.length,8);assert.equal(S.tail.length,3);
});

test('every family, all 27 freedom combinations and many remembered facts render as finished prose',()=>{
  const G=game(),R=(()=>{let a=11;return()=>{a=(a*1103515245+12345)%2147483648;return a/2147483648;};})(),keys=Object.keys(G.WS_FACTS);
  for(const f of FAMS)for(let k=0;k<8;k++){
    const seen=new Set();
    for(let b=0;b<27;b++){
      const bs=''+Math.floor(b/9)+Math.floor(b/3)%3+b%3,x={};for(const key of keys)if(R()<0.5)x[key]=G.WS_FACTS[key][Math.floor(R()*G.WS_FACTS[key].length)];x.tr=Math.floor(R()*7)-3;
      const c={v:1,k,f,b:bs,p:b%3?[]:[...G.WS_POL],x,h:Array.from({length:k},(_,i)=>(b+i)%4-1),hf:Array.from({length:k},(_,i)=>FAMS[(b+i)%8]),g:b%2?FAMS[b%8]:''};
      const t=render(G,c);seen.add(t);
      for(const s of [t,...G.wsVariant(c).o.flatMap((o,i)=>[G.wsDsl(o.t,c),G.wsDsl(o.fx,c),G.wsOutcome(c,i)])]){
        assert.ok(!/\[\[|\]\]|\||\{WS|undefined|null/.test(s),`${f} ${k+1} ${bs}: ${s.slice(0,120)}`);
        assert.ok(!/ {2}|\s[,.;]/.test(s.replace(/\n/g,'')),`${f} ${k+1} spacing: ${s.slice(0,120)}`);}
      assert.ok(G.wsVariant(c).o.every((o,i)=>/[.!?”]$/.test(G.wsOutcome(c,i))),`${f} ${k+1} outcomes end with a full stop`);
    }
    assert.equal(seen.size,27,`${f} letter ${k+1}: each of the 27 freedom combinations reads differently`);
  }
});

test('civil, economic and political freedom each change the letter, whatever the type of state',()=>{
  const G=game(),c=(f,b)=>({v:1,k:3,f,b,p:[],x:{bk:'open'},h:[0,0,0],hf:['rep','rep','rep'],g:'rep'});
  for(const f of ['crn','peo']){
    const low=render(G,c(f,'000')),civil=render(G,c(f,'200')),econ=render(G,c(f,'020')),pol=render(G,c(f,'002'));
    assert.notEqual(low,civil);assert.notEqual(low,econ);assert.notEqual(low,pol);
  }
  /* a crown with free speech, a republic without it: the band, not the name, decides how openly she writes */
  const crown=render(G,c('crn','200')),rep=render(G,c('rep','000'));
  assert.match(crown,/Three newspapers have printed my name/);assert.match(rep,/I have not given any interviews/);
});

test('a letter arrives exactly at its milestone, never before, and only through an arrival slot',()=>{
  const G=game();
  for(let k=0;k<8;k++){
    const base=nation(G);base.ws.c=Array.from({length:k},()=>({o:0,f:'rep',b:'111',t:1,x:'done',n:'T'}));
    base.ws.e=G.WS_AT[k]-1;assert.equal(wsOn(after(G,base,3)).length,0,`letter ${k+1} waits at ${G.WS_AT[k]-1}`);
    base.ws.e=G.WS_AT[k];
    assert.equal(wsOn(after(G,base,0)).length,0,'no slot, no letter: opening the page creates nothing');
    const d=wsOn(after(G,base,1));assert.equal(d.length,1);assert.equal(d[0].id,'ws-'+(k+1),`letter ${k+1} at ${G.WS_AT[k]}`);
    assert.equal(d[0].ws.k,k);
  }
  const done=nation(G);done.ws.c=Array.from({length:8},()=>({o:0,f:'rep',b:'111',t:1,x:'',n:''}));done.ws.e=5000;done.ws.d=1;
  assert.equal(wsOn(after(G,done,5)).length,0,'a finished story sends nothing more');
});

test('enacted edicts count once each; vetoes, letters and re-saves do not; the count outlives the capped history',()=>{
  const G=game();play(G,nation(G));
  for(let i=0;i<3;i++)enact(G);assert.equal(G.S.nation.ws.e,3);
  G.commit(JSON.parse(JSON.stringify(G.S.nation)));assert.equal(G.S.nation.ws.e,3,'saving again counts nothing');
  let n=after(G,G.S.nation,1);G.S.nation=n;G.dismiss(n.inbox.find(x=>!/^ws-/.test(x.id)).id);assert.equal(G.S.nation.ws.e,3,'a veto is not enacted');
  enact(G);enact(G);assert.equal(G.S.nation.ws.e,5);
  n=after(G,G.S.nation,1);G.S.nation=n;const ws=wsOn(n)[0];assert.equal(ws.id,'ws-1');
  G.answer('ws-1',0);assert.equal(G.S.nation.ws.e,5,'answering a letter does not advance the letters');assert.equal(G.S.nation.ws.c.length,1);
  for(let i=0;i<120;i++)enact(G,i%2);
  assert.equal(G.S.nation.answered.length,80,'the decision history is capped');assert.equal(G.S.nation.ws.e,125,'the story count is not');
});

test('one letter at a time: a backlog follows slot by slot, a full desk or a holiday waits, a follow-up goes first',()=>{
  const G=game();let n=nation(G);n.ws.e=1000;
  let v=after(G,n,5);assert.equal(wsOn(v).length,1,'a nation that earned all eight gets letter I only');assert.equal(v.inbox.length,5,'and ordinary edicts in the other slots');
  /* answered: the next letter comes at a later slot, not at once */
  G.S.nation=v;G.answer('ws-1',1);assert.equal(wsOn(G.S.nation).length,0);
  v=after(G,G.S.nation,0);assert.equal(wsOn(v).length,0,'no slot yet');
  G.S.nation=v;for(const x of v.inbox.slice())G.dismiss(x.id);
  v=after(G,G.S.nation,2);assert.deepEqual(wsOn(v).map(x=>x.id),['ws-2']);
  /* a full desk holds the letter back without losing it */
  n=nation(G);n.ws.e=10;n.inbox=['old1','old2','old3','old4','old5'].map((id,i)=>({id,at:Date.now()-1e6+i}));
  v=after(G,n,4);assert.equal(v.inbox.length,5);assert.equal(wsOn(v).length,0,'nothing is evicted');
  G.S.nation=v;G.answer('old1',0);v=after(G,G.S.nation,1);assert.deepEqual(wsOn(v).map(x=>x.id),['ws-1'],'the first free slot brings it');
  /* holiday mode: no slots, so no letter */
  n=nation(G);n.ws.e=5;n.issueClock=Date.now()-3*60*MIN;n.away={a:Date.now()-4*60*MIN,b:Date.now()+60*MIN};
  assert.equal(wsOn(G.syncInbox(n,Date.now())).length,0,'no letter on holiday');
  n.away={a:Date.now()-3*60*MIN,b:Date.now()-0.5*60*MIN};assert.equal(wsOn(G.syncInbox(n,Date.now())).length,0,'the time away has no slots, so nothing is caught up');
  n.away={a:Date.now()-3*60*MIN,b:Date.now()-1.9*60*MIN};assert.equal(wsOn(G.syncInbox(n,Date.now())).length,1,'it comes with the first slot after the holiday');
  /* a follow-up that is due takes the slot first; the letter comes at the next */
  n=nation(G);n.ws.e=5;n.chain=[{id:'chain-b',at:Date.now()-3*3600e3}];
  v=G.syncInbox(Object.assign(JSON.parse(JSON.stringify(n)),{issueClock:Date.now()-1*60*MIN-1000}),Date.now());
  assert.deepEqual(ids(v.inbox),['chain-b'],'the follow-up first');
  v=G.syncInbox(Object.assign(JSON.parse(JSON.stringify(n)),{issueClock:Date.now()-2*60*MIN-1000}),Date.now());
  assert.deepEqual(ids(v.inbox),['chain-b','ws-1'],'then the letter');
});

test('a letter keeps the voice and choices it arrived with, through a change of government, a reload and another device',()=>{
  const G=game();let n=nation(G,{pretitle:'Kingdom',leader:'Queen'});n.ws.e=5;
  let v=after(G,n,1);const ent=wsOn(v)[0];assert.equal(ent.ws.f,'crn');
  const text0=G.fill('{WSQ}',v,ent),opts0=[1,2,3].map(i=>G.fill('{WS'+i+'}',v,ent));
  /* the government changes while the letter waits */
  v.pretitle='People’s Republic';v.leader='Chairman';for(const k of ['civil','econ','pol'])v.s[k]=90;v.policies.surveillance=true;
  assert.equal(G.fill('{WSQ}',v,v.inbox.find(x=>x.id==='ws-1')),text0,'same letter after the revolution');
  /* saved, reloaded elsewhere */
  const back=normalize(G,JSON.parse(JSON.stringify(v))),e2=back.inbox.find(x=>x.id==='ws-1');
  assert.ok(e2&&e2.ws,'the frozen context survives the save');assert.equal(G.fill('{WSQ}',back,e2),text0);
  assert.deepEqual([1,2,3].map(i=>G.fill('{WS'+i+'}',back,e2)),opts0,'and so do its three answers');
  /* answered under the new government: recorded with the family it arrived under; the next letter notes the change */
  G.S.nation=back;G.answer('ws-1',0);const w=G.S.nation.ws;assert.equal(w.c[0].f,'crn');assert.ok(w.x.lp,'the answer’s facts are kept');
  w.e=10;G.S.nation.ws=w;v=after(G,G.S.nation,1);const next=wsOn(v)[0];assert.equal(next.ws.f,'peo');assert.equal(next.ws.g,'crn');
  assert.match(G.fill('{WSQ}',v,next),/the Palace/,'a short transition remembers where her letters used to go');
});

test('a veto files the letter unanswered: the story goes on and later letters say so',()=>{
  const G=game();let n=nation(G);n.ws.e=10;G.S.nation=after(G,n,1);
  G.dismiss('ws-1');const w=G.S.nation.ws;
  assert.equal(w.c[0].o,-1);assert.equal(w.x.lp,'off','an unanswered lamp stays dark');assert.equal(w.x.tr,-1,'and Mara notices');
  assert.equal(G.wsLand(G.S.nation),0,'a veto brings no land');assert.equal(G.toasts.pop(),'Filed unanswered. Mara Bell will not hear back, and her next letter will remember it.');
  const v=after(G,G.S.nation,1),ent=wsOn(v)[0];assert.equal(ent.id,'ws-2');
  const L=G.fill('{WSQ}',v,ent);assert.match(L,/My last letter received no reply/);assert.match(L,/still dark/);assert.doesNotMatch(L,/Thank you again for the lamp/);
});

test('random lives: every answer and veto, in any order of governments, leads to a finished, consistent story',()=>{
  const G=game(),R=(()=>{let a=3;return()=>{a=(a*1103515245+12345)%2147483648;return a/2147483648;};})(),pts=PRETITLES;
  for(let life=0;life<120;life++){
    let n=nation(G,{pretitle:pts[Math.floor(R()*pts.length)]});n.ws.e=1000;G.S.nation=n;let lastText='';
    for(let k=0;k<8;k++){
      const v=after(G,G.S.nation,1),ent=wsOn(v)[0];assert.equal(ent.id,'ws-'+(k+1));
      const t=G.fill('{WSQ}',v,ent);assert.ok(t.length>150&&!/\[\[|\]\]|\{/.test(t),t.slice(0,100));assert.notEqual(t,lastText);lastText=t;
      G.S.nation=v;const o=Math.floor(R()*4)-1;if(o<0)G.dismiss(ent.id);else G.answer(ent.id,o);
      const w=G.S.nation.ws;assert.equal(w.c.length,k+1);assert.ok(Math.abs(w.x.tr||0)<=3);
      for(const [key,val] of Object.entries(w.x))if(key!=='tr')assert.ok(G.WS_FACTS[key].includes(val),key+'='+val);
      /* between letters, a new government and new freedoms, sometimes */
      const m=JSON.parse(JSON.stringify(G.S.nation));if(R()<0.4)m.pretitle=pts[Math.floor(R()*pts.length)];for(const s of ['civil','econ','pol'])m.s[s]=Math.floor(R()*100);G.S.nation=m;
    }
    const w=G.S.nation.ws;assert.equal(w.d,1,'complete after eight');assert.equal(wsOn(after(G,G.S.nation,3)).length,0,'and nothing more arrives');
    assert.equal(G.wsLand(G.S.nation),5*w.c.filter(r=>r.o>=0).length);
    const keep=G.UNLOCK_SOURCES[0].earned(G.S.nation);assert.deepEqual([...keep],[...w.c].map((r,k)=>r.o>=0?G.WS_KEEP[k]:'').filter(Boolean),'a keepsake for each answered letter');
  }
});

test('callbacks follow what really happened: the bakery, the debt, the hearing and Ada',()=>{
  const G=game(),c=(f,k,x,h=[0,0,0,0,0,0,0].slice(0,k))=>({v:1,k,f,b:'111',p:[],x,h,hf:h.map(()=>f),g:f}),T=(f,k,x,h)=>render(G,c(f,k,x,h));
  /* the Crown's invoice exists only if a contract was made */
  assert.notEqual(T('crn',4,{ct:'crown',bk:'open'}),T('crn',4,{bk:'open'}));
  /* a bakery that never opened is never described as trading */
  assert.doesNotMatch(T('rep',3,{bk:'shut'}),/between batches/);assert.match(T('rep',3,{bk:'open'}),/between batches/);
  /* Ada was at a hearing only if there was one */
  assert.doesNotMatch(T('rep',6,{st:'kept'}),/seen me speak at a hearing/);assert.match(T('rep',6,{st:'kept',hr:'yes'}),/seen me speak at a hearing/);
  /* the last letter follows her treatment, without praising the ruler by default */
  assert.match(T('rep',7,{tr:-2}),/not always been treated well/);assert.match(T('rep',7,{tr:3}),/mostly been treated well/);
});

test('stored stories are checked: legacy nations, damage, repeated loading, completed stories and stale copies',()=>{
  const G=game();
  /* an established nation from before the letters: counted from its lifetime record, the larger of the two */
  let n=nation(G,{dec:37,tly:{iss:41}});assert.equal(n.ws.e,41);assert.equal(n.ws.m,'l');assert.equal(n.ws.c.length,0);
  const v=after(G,n,3);assert.deepEqual(wsOn(v).map(x=>x.id),['ws-1'],'letter one first, however much was earned');
  /* normalising again changes nothing */
  const again=normalize(G,JSON.parse(JSON.stringify(n)));assert.deepEqual(again.ws,n.ws);
  /* damaged fields: what can be read is kept, the rest starts safely */
  n=nation(G,{dec:12,ws:{v:1,e:'many',c:[{o:0,f:'rep',b:'111',t:5,x:'ok',n:'A'},{o:7},{o:1}],x:{lp:'purple',bk:'open',tr:99,zz:1}}});
  assert.equal(n.ws.e,11,'a count that cannot be read falls back to the lifetime record, less the letter answered');
  assert.equal(n.ws.c.length,1,'resolved letters stop at the first that cannot be read');assert.deepEqual({...n.ws.x},{bk:'open',tr:3},'unknown facts are dropped and trust is kept within its bounds');
  for(const bad of [null,'x',[],{v:2},{v:1,c:'no'}])assert.doesNotThrow(()=>nation(G,{ws:bad}));
  /* a desk letter whose context is damaged, or which is not the letter the story waits for, leaves the desk */
  const at=Date.now();n=nation(G,{ws:{v:1,e:20,c:[],x:{}},inbox:[{id:'ws-1',at,ws:{v:1,k:0,f:'rep',b:'9x9',h:[]}},{id:'old3',at:at+1}]});
  assert.deepEqual(ids(n.inbox),['old3']);
  n=nation(G,{ws:{v:1,e:20,c:[],x:{}},inbox:[{id:'ws-2',at,ws:{v:1,k:1,f:'rep',b:'111',h:[0],hf:['rep'],x:{},p:[]}}]});assert.equal(n.inbox.length,0,'a letter out of turn is removed');
  /* a record saved without its story (an older copy of the game): letters it shows as seen are not sent again */
  n=nation(G,{dec:70,iseen:[G.ISSUE_BY_ID['ws-1'].no,G.ISSUE_BY_ID['ws-2'].no],answered:[{id:'ws-2',o:1,t:5,fx:'second'}]});
  assert.deepEqual([...n.ws.c].map(r=>r.o),[-2,1]);assert.equal(n.ws.m,'r');assert.equal(n.ws.e,68,'both recovered letters are taken off the count');
  assert.deepEqual(wsOn(after(G,n,2)).map(x=>x.id),['ws-3']);
  /* a completed story stays complete */
  n=nation(G,{ws:{v:1,e:1500,c:Array.from({length:8},(x,i)=>({o:i%2?-1:0,f:'bor',b:'012',t:i+1,x:'r'+i,n:'L'+i})),x:{st:'kept'},d:1}});
  assert.equal(n.ws.d,1);assert.equal(n.ws.c.length,8);assert.equal(normalize(G,JSON.parse(JSON.stringify(n))).ws.d,1);
  /* a stale copy that resolves a letter already resolved changes nothing */
  const G2=game();let m=nation(G2);m.ws.e=10;G2.S.nation=after(G2,m,1);G2.answer('ws-1',0);
  const st=JSON.parse(JSON.stringify(G2.S.nation));st.answered.push({id:'ws-1',o:2,t:Date.now()+5,fx:'stale'});G2.commit(st);
  assert.equal(G2.S.nation.ws.c.length,1);assert.equal(G2.S.nation.ws.c[0].o,0);
});

test('land credits and keepsakes come once per answered letter, and other players count the land from the shared half',()=>{
  const G=game();let n=nation(G);n.ws.e=10;G.S.nation=after(G,n,1);G.answer('ws-1',2);
  assert.equal(G.S.nation.wsl,5);assert.deepEqual([...G.UNLOCK_SOURCES[0].earned(G.S.nation)],['t-welllit']);
  G.commit(JSON.parse(JSON.stringify(G.S.nation)));assert.equal(G.S.nation.wsl,5,'saving again pays nothing more');
  /* another player's view of this nation has no private half: the shared count is trusted within its bounds */
  const pub=JSON.parse(JSON.stringify(G.S.nation));delete pub.ws;pub.inbox=[];
  assert.equal(normalize(G,pub).wsl,5);pub.wsl=45;assert.equal(normalize(G,pub).wsl,undefined,'an impossible amount is dropped');
  const opts=G.ISSUE_BY_ID['ws-1'].o;assert.ok(opts.every(o=>!Object.keys(o.e).length),'outside a decision the letter has no effects of its own');
});

test('the shared and private halves: the story stays private, its land count is shared',()=>{
  const shim=readFileSync(new URL('../src/shim.js',import.meta.url),'utf8'),keys=shim.match(/\[('asmLocal'[\s\S]*?)\]\.forEach\(function \(k\) \{ NX_KEYS\[k\] = 1; \}\)/)[1];
  assert.match(keys,/'ws'/);assert.doesNotMatch(keys,/'wsl'/);
});

test('the letters are cached with the other stories, and read the same after extraction',()=>{
  const story=SECTION.slice(SECTION.indexOf('const WS_STORY='),SECTION.indexOf('}};',SECTION.indexOf('const WS_STORY='))+3);
  const split=splitContent(story+'\nthis.out=WS_STORY;');
  assert.ok(split.count>300,'the letters’ long texts move to the content file ('+split.count+')');
  const a=vm.createContext({}),b=vm.createContext({});vm.runInContext(story+'\nthis.out=WS_STORY;',a);
  vm.runInContext('var window=this;window.__edictum={};',b);vm.runInContext(split.content,b);vm.runInContext(split.code,b);
  assert.deepEqual(JSON.parse(JSON.stringify(b.out)),JSON.parse(JSON.stringify(a.out)));
  assert.match(readFileSync(new URL('../scripts/split-content.mjs',import.meta.url),'utf8'),/'WS_STORY'/);
});
