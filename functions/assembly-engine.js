// Generated from the trusted Assembly engine in game/edictum.html; regenerate with tools/build-civic.mjs.
import DATA from './civic-data.json' with {type:'json'};
function hash(str){let h=2166136261>>>0;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function rng(seed){let a=seed>>>0;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
export function assemblyEngine(region,records,protectedLocks=[]){
const DAY=86400000,GAMES_EPOCH=Date.UTC(2026,0,5),REG={id:region},NPC_NATIONS=DATA.regions.find(r=>r.id===region)?.npcs.map(x=>({...x,npc:true,policies:Object.fromEntries(x.pol.map(p=>[p,1]))}))||[],NPC_BASE=Object.fromEntries(NPC_NATIONS.map(x=>[x.id,x])),npcAt=id=>NPC_NATIONS.find(x=>x.id===id),npcRev=0;
const S={mode:'server',uid:'',nation:null,world:Object.fromEntries(records.map(r=>[r.id,r.n]))},myId=()=>'',clone=x=>structuredClone(x),conflictsOf=k=>DATA.conflicts.flatMap(([a,b])=>a===k?[b]:b===k?[a]:[]);
const affinity=(a,b)=>Math.round(Math.max(0,Math.min(100,100-(['civil','econ','pol'].reduce((v,k)=>v+Math.abs((a.s[k]??50)-(b.s[k]??50)),0)/3)+(b.civicAffinity||0)+Math.max(-20,Math.min(20,Number(b.gw?.[a.id])||0)))));
const ASM_EPOCH=GAMES_EPOCH,ASM_P=3*DAY,ASM_NPC_W=1/3,ASM_AFF=78,ASM_REJOIN=3*DAY,ASM_LAPSE=3,ASM_BACK=6,ASM_TOMB=4*DAY,ASM_REEND=DAY,ASM_MSG_GAP=3600e3,ASM_REDRAFT=6*3600e3,ASM_HMAX=10,ASM_HTX=4,ASM_EMAX=24,ASM_SMAX=12,ASM_TI=60,ASM_TX=280,ASM_MSG=100,ASM_OX=100;
const asmCyc=t=>Math.floor((t-ASM_EPOCH)/ASM_P),asmT0=c=>ASM_EPOCH+c*ASM_P,asmNo=c=>c+1;
/* sixteen kinds of resolution; m: mild, s: strong (p: a law the strong version makes, unless a member's own laws contradict it) */
const ASM_CATS={
  env:{n:'Environmental standards',m:{env:2,econ:-1},s:{env:4,econ:-2,health:1,b:{env:1}},p:'plasticBagBan'},
  trade:{n:'Free trade',m:{econ:2,wealth:1,equal:-1},s:{econ:3,wealth:2,equal:-2,b:{commerce:1}}},
  rights:{n:'Human rights',m:{civil:2,pol:1},s:{civil:3,pol:2,safety:-1},p:'whistleblowerProtection'},
  tax:{n:'A regional tax floor',m:{tax:2,equal:1,wealth:-1},s:{tax:3,equal:2,econ:-2,b:{welfare:1}},p:'wealthTax'},
  sci:{n:'Science funding',m:{sci:2,tax:1},s:{sci:4,edu:2,tax:1,b:{edu:1}}},
  decency:{n:'Moral decency',m:{cons:2,weird:-1,civil:-1},s:{cons:3,weird:-2,civil:-2,relig:1},p:'sundayClosing'},
  borders:{n:'Open borders',m:{civil:1,econ:1,cons:-1},s:{civil:2,econ:2,cons:-2,safety:-1},p:'openBorders'},
  arms:{n:'Arms limits',m:{mil:-2,happy:1},s:{mil:-4,safety:1,happy:1,b:{defence:-1,aid:1}}},
  animals:{n:'Animal welfare',m:{env:1,happy:1},s:{env:2,happy:1,econ:-1},p:'freeRange'},
  digital:{n:'Digital rights',m:{civil:1,sci:1},s:{civil:2,sci:1,safety:-1},p:'dataPrivacy'},
  ai:{n:'AI safety',m:{safety:1,sci:-1},s:{safety:2,sci:-2,weird:-1,b:{admin:1}}},
  social:{n:'Social media rules',m:{happy:1,civil:-1},s:{happy:2,edu:1,civil:-1},p:'socialMediaAge'},
  culture:{n:'A culture fund',m:{culture:2,tax:1},s:{culture:3,tour:2,tax:1},p:'artsCouncil'},
  holiday:{n:'A public holiday',m:{happy:2,econ:-1},s:{happy:3,culture:1,econ:-2},p:'holidayEntitlement'},
  metric:{n:'Metric everything',m:{sci:1,weird:-1},s:{sci:2,edu:1,weird:2,cons:-1},p:'decimalTime'},
  health:{n:'Public health',m:{health:2,happy:-1},s:{health:3,happy:-1,tax:1,b:{health:1}},p:'junkFoodTax'}
};
/* what a computer nation tables when no member has proposed anything */
const ASM_RES=[
  {c:'env',g:0,ti:'The Polite Chimney Accord',tx:'Factory chimneys across the region may emit only clean, well-mannered smoke, and must apologise when the wind changes.'},
  {c:'env',g:1,ti:'The Great Plastic Bag Amnesty',tx:'Every plastic bag hidden under every sink in the region is to be handed in, no questions asked, to a regional museum of regret. No new ones may be sold.'},
  {c:'env',g:0,ti:'Lights Out for the Stars',tx:'Street lamps dim at midnight so the region can see the stars again. Burglars are asked to bring their own torches.'},
  {c:'trade',g:0,ti:'On the Free Movement of Cheese',tx:'Cheese may cross any border in the region without papers, inspection or questions about its age.'},
  {c:'trade',g:1,ti:'The Open Markets Act',tx:'Tariffs between member nations fall to nothing, and customs officers are retrained as greeters.'},
  {c:'rights',g:0,ti:'The Right to a Second Opinion',tx:'Every citizen may appeal any government decision once, in writing, in crayon if necessary.'},
  {c:'rights',g:1,ti:'The Charter of Inconvenient Truths',tx:'Members protect whistleblowers and the free press, and citizens may say what they like about their ministers, preferably within earshot.'},
  {c:'tax',g:0,ti:'The Minimum Effort Tax Floor',tx:'No member may tax its citizens at less than the price of a decent sandwich.'},
  {c:'tax',g:1,ti:'The Yacht Registration Act',tx:'Tax havens are abolished across the region. Large fortunes pay a yearly levy, and yachts must now be registered somewhere damp.'},
  {c:'sci',g:0,ti:'Explosions on Tuesdays',tx:'Laboratories receive a small regional grant and permission to blow things up on Tuesdays, under supervision.'},
  {c:'sci',g:1,ti:'The Very Large Telescope Fund',tx:'Members pool their money for a telescope big enough to see what the neighbours are doing on the Moon.'},
  {c:'decency',g:0,ti:'Trousers in Parliament',tx:'Legislators must wear trousers, or a dignified equivalent, during all debates and most votes.'},
  {c:'decency',g:1,ti:'The Sunday Best Act',tx:'Shops close on Sundays, swearing in public earns a stern look, and topiary must be modest.'},
  {c:'borders',g:0,ti:'The Visa-Free Picnic Zone',tx:'Citizens may cross any border in the region for a picnic, provided they take their crumbs home.'},
  {c:'borders',g:1,ti:'The Open Borders Compact',tx:'Anyone with a job offer may move to any member nation. Border guards will be offered new jobs, abroad.'},
  {c:'arms',g:0,ti:'No Tanks on Sundays',tx:'Tanks may not be driven on Sundays, except to church, and then only slowly.'},
  {c:'arms',g:0,ti:'The Ceremonial Cannon Register',tx:'Every cannon in the region must be registered, named and given one day off a week.'},
  {c:'arms',g:1,ti:'Swords into Ploughshares',tx:'Members cut military spending, give more in aid, and melt down one ceremonial cannon each for garden furniture.'},
  {c:'animals',g:0,ti:'A Bill of Rights for Ducks',tx:'Ducks may cross any road in the region with right of way and, on request, a police escort.'},
  {c:'animals',g:1,ti:'The Happy Hen Convention',tx:'Cages are banned, hens may roam free, and every farm must keep a quiet room for nervous geese.'},
  {c:'digital',g:0,ti:'The Cookie Disclosure Act',tx:'Websites must say exactly what their cookies are made of, and whether they contain nuts.'},
  {c:'digital',g:1,ti:'The Right to Be Forgotten, Mostly',tx:'Citizens own their personal data, and governments must stop asking for their mother’s maiden name.'},
  {c:'ai',g:0,ti:'Please and Thank You',tx:'Every chatbot in the region must say please and thank you, and may not claim to have feelings before lunch.'},
  {c:'ai',g:1,ti:'The Big Red Button Accord',tx:'Every artificial intelligence must have a large red off switch, clearly labelled and well out of its own reach.'},
  {c:'social',g:0,ti:'The Like Limit',tx:'Citizens may give no more than a hundred likes a day, to protect the value of the like.'},
  {c:'social',g:1,ti:'Go and Play Outside',tx:'Nobody under sixteen may hold a social media account. Teenagers will be issued with a ball.'},
  {c:'culture',g:0,ti:'Poetry on the Buses',tx:'Every bus must display a poem, which drivers may read aloud at red lights.'},
  {c:'culture',g:1,ti:'The Regional Culture Fund',tx:'Members set up arts councils to pay for orchestras, theatres and at least one deeply confusing sculpture each.'},
  {c:'holiday',g:0,ti:'Assembly Day',tx:'A new public holiday celebrates the Assembly itself, with fireworks, bunting and a reading of the minutes.'},
  {c:'holiday',g:1,ti:'The Long Weekend Treaty',tx:'Workers across the region get generous paid holidays by law, and Mondays are to be approached gently.'},
  {c:'metric',g:0,ti:'Metric Pints',tx:'Beer is to be served in half litres, and nobody may complain about it in imperial units.'},
  {c:'metric',g:1,ti:'Metric Everything',tx:'Clocks go decimal: ten hours a day and a hundred minutes an hour. Lunch is at five point oh.'},
  {c:'health',g:0,ti:'An Apple a Day',tx:'Every school serves fruit at break, and canteen chips are reduced to a garnish.'},
  {c:'health',g:1,ti:'The Doughnut Levy',tx:'Sugary, salty and fatty snacks carry a regional health levy. Doughnuts may be sold only with a leaflet.'}
].filter(r=>ASM_CATS[r.c]);

/* ── small helpers ── */
const asmClean=(v,max)=>String(v==null?'':v).replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const asmKeyOk=k=>typeof k==='string'&&k.length>=3&&k.length<=100&&!/[\s<>"'&]/.test(k);
const asmIdOk=v=>typeof v==='string'&&v.length>0&&v.length<=60;
const asmCmp=(a,b)=>a<b?-1:a>b?1:0;
const asmPKey=(id,p)=>String(id)+'~'+Math.round(p.t).toString(36);
const asmA=n=>n&&n.asm&&n.asm.r===REG.id?n.asm:null;
const asmArr=n=>Math.max((n&&n.founded)||0,(n&&n.mvAt)||0);
const asmW=v=>{const r=Math.round(v*10)/10;return Number.isInteger(r)?String(r):r.toFixed(1);};
const asmVotes=v=>asmW(v)+(Math.abs(v-1)<1e-9?' vote':' votes');
const asmG=g=>g?'Strong':'Mild';
function asmPerm(L,seed){const r=rng(seed),a=[...Array(L).keys()];for(let i=L-1;i>0;i--){const j=Math.floor(r()*(i+1));const t=a[i];a[i]=a[j];a[j]=t;}return a;}
/* a member at time T: arrived by then, and not resigned (or back after resigning) */
function asmMemberAt(n,T){
  if(!n||n.npc||!n.civicAt||T<n.civicAt)return false;
  const a=asmA(n);if(!a||!a.o)return true;
  if(T<a.o)return true;return !!(a.j&&a.j>a.o&&T>=a.j);
}
/* the effects of a resolution, as data and in plain words */
function asmFx(cat,g){const C=ASM_CATS[cat];return C?(g?C.s:C.m):{};}
function asmFxItems(cat,g){
  const C=ASM_CATS[cat];if(!C)return [];const e=asmFx(cat,g),out=[];
  for(const k of Object.keys(e)){if(k==='b'||!STATS[k])continue;out.push({t:`${STATS[k].n} ${e[k]>0?'+':'−'}${Math.abs(e[k])}`,up:e[k]>0});}
  if(e.b)for(const bk of Object.keys(e.b)){const B=BUDGET.find(x=>x[0]===bk);if(B)out.push({t:`${e.b[bk]>0?'more':'less'} spent on ${B[2]}`,up:e.b[bk]>0,b:1});}
  if(g&&C.p)out.push({t:`${POLICIES[C.p][0]} becomes law`,law:1});
  return out;
}
const asmFxWords=(cat,g)=>asmFxItems(cat,g).map(x=>x.t).join(', ');
/* apply a passed resolution to a member's own nation; returns a note on the law it carries */
function asmApply(n,cat,g){
  const C=ASM_CATS[cat];if(!C)return '';const e=clone(asmFx(cat,g));let note='';
  if(g&&C.p){if(n.policies[C.p])note='had';else{const cf=conflictsOf(C.p).find(q=>n.policies[q]);if(cf)note='x:'+cf;else{e.p={[C.p]:1};note='law';}}}
  applyEffects(n,e);return note;
}
function asmLawNote(cat,pn){const C=ASM_CATS[cat];if(!C||!C.p||!pn)return '';const L=POLICIES[C.p][0];
  if(pn==='law')return `${L} is now law.`;if(pn==='had')return `${L} was already law.`;
  if(pn.startsWith('x:')){const q=POLICIES[pn.slice(2)];return `${L} did not pass into law: your ${q?q[0]:'own laws'} stands in its way.`;}return '';}

/* ── the records of the region ── */
function asmRecs(me){
  const my=me===undefined?S.nation:me,out=[];
  if(my&&!my.npc&&my.name&&(my.reg||REG.id)===REG.id)out.push({id:myId(),n:my,me:true});
  if(S.mode!=='local'&&S.world)for(const id of Object.keys(S.world)){if(id===S.uid)continue;const n=S.world[id];if(n&&n.name&&!n.npc&&(n.reg||'meridian')===REG.id)out.push({id,n});}
  return out;
}
/* each computer nation backs the player member it likes best, if it likes them enough */
function asmNpcBacks(x,mem,c){
  const src=npcAt(x.id,asmT0(c))||x;let best=null,ba=-1;
  for(const r of mem){let a=0;try{a=affinity(src,r.n);}catch(e){a=0;}if(a>ba||(a===ba&&best&&asmCmp(r.id,best.id)<0)){ba=a;best=r;}}
  return {x,r:best&&ba>=ASM_AFF?best:null,a:ba,best};
}
/* the Delegate at time T: the player member with the most endorsements; a tie goes to whoever reached
   that count first (computer nations' backing counts from the start of the cycle), then the older nation */
function asmDelegateAt(recs,T){
  const c=asmCyc(T),mem=recs.filter(r=>asmMemberAt(r.n,T));
  const info=new Map(mem.map(r=>[r.id,{r,k:0,by:[],np:[],reach:0}]));
  for(const r of mem){const a=asmA(r.n);if(!a||!a.e)continue;const seen=new Set();
    for(const e of a.e){if(e.i===r.id||seen.has(e.i)||!info.has(e.i)||e.t>T||(e.w&&e.w<=T))continue;seen.add(e.i);const o=info.get(e.i);o.k++;o.by.push(r.id);o.reach=Math.max(o.reach,e.t);}}
  const npc=NPC_NATIONS.map(x=>asmNpcBacks(x,mem,c));
  for(const b of npc)if(b.r){const o=info.get(b.r.id);o.k++;o.np.push(b.x.id);o.reach=Math.max(o.reach,asmT0(c));}
  for(const o of info.values()){o.by.sort(asmCmp);o.np.sort(asmCmp);}
  let best=null;
  for(const o of info.values()){if(!o.k)continue;if(!best||o.k>best.k||(o.k===best.k&&(o.reach<best.reach||(o.reach===best.reach&&((o.r.n.founded||0)<(best.r.n.founded||0)||((o.r.n.founded||0)===(best.r.n.founded||0)&&asmCmp(o.r.id,best.r.id)<0))))))best=o;}
  return {D:best?{id:best.r.id,r:best.r,k:best.k,by:best.by,np:best.np}:null,info,npc};
}
const asmDel=(recs,T)=>asmDelegateAt(recs,T).D;
/* support for a proposal at time T, from members other than its author */
function asmSupAt(recs,k,author,T){
  const by=[];for(const r of recs){if(r.id===author||!asmMemberAt(r.n,T))continue;const a=asmA(r.n);if(a&&a.s&&a.s.some(x=>x.k===k&&x.t<T&&(!x.w||x.w>=T)))by.push(r.id);}
  return by;
}
/* the computer nations' ready-made resolution for a cycle, tabled by the nation it suits best */
function asmNpcScore(x,R,c){
  const cat=R.cat||R.c,C=ASM_CATS[cat];if(!C)return 0;const e=asmFx(cat,R.g),src=npcAt(x.id,asmT0(c))||x,B=NPC_BASE[x.id];let sc=0;
  for(const k of Object.keys(e)){if(k==='b'||!(k in src.s))continue;const w=(src.s[k]-50)/50;sc+=e[k]*(k==='tax'?w*0.5:w);}
  if(R.g&&C.p){const pl=B?B.pol:Object.keys(x.policies||{});if(pl.includes(C.p))sc+=1.5;else if(conflictsOf(C.p).some(q=>pl.includes(q)))sc-=2.5;}
  return sc;
}
function asmNpcRes(c){
  const L=ASM_RES.length;if(!L||!NPC_NATIONS.length)return null;
  const b=Math.floor(c/L),R=ASM_RES[asmPerm(L,hash(REG.id+':asmres:'+b))[c-b*L]];
  let by=NPC_NATIONS[0],bs=-Infinity;for(const x of NPC_NATIONS){const s=asmNpcScore(x,R,c);if(s>bs){bs=s;by=x;}}
  return {c,k:'npc~'+REG.id+'~'+c,ti:R.ti,tx:R.tx,cat:R.c,g:R.g,by:by.id,bn:by.name,w:'n',lt:0};
}
/* the resolution that goes to the vote in cycle c, computed from the records as they stood at its start */
function asmPickRaw(c,recs,ex){
  const t0=asmT0(c),cands=[];
  for(const r of recs){const a=asmA(r.n),p=a&&a.p;if(!p||p.t>=t0)continue;const cp=asmCyc(p.t);if(cp<c-ASM_LAPSE||cp>=c||!asmMemberAt(r.n,t0))continue;
    const k=asmPKey(r.id,p);if(ex.has(k))continue;cands.push({r,p,k});}
  const res=(x,w)=>({c,k:x.k,ti:x.p.ti,tx:x.p.tx,cat:x.p.c,g:x.p.g,by:x.r.id,bn:x.r.n.name,w,lt:0});
  if(!cands.length)return asmNpcRes(c);
  const D=asmDel(recs,t0),ag=D&&asmA(D.r.n)&&asmA(D.r.n).a;
  if(ag&&ag.c===c&&ag.t<t0){const hit=cands.find(x=>x.k===ag.k);if(hit)return res(hit,'d');}
  for(const x of cands)x.sup=asmSupAt(recs,x.k,x.r.id,t0).length;
  cands.sort((a,b)=>b.sup-a.sup||a.p.t-b.p.t||asmCmp(a.r.id,b.r.id));
  return res(cands[0],'s');
}
/* locks (n.asm.cur) and recorded outcomes (n.asm.h): per cycle, the earliest wins */
function asmLocks(){return new Map(protectedLocks.map(x=>[x.c,x]));}
function asmPickFor(c,recs,L){
  if(L.has(c))return L.get(c);
  const ex=new Set();for(const [cc,x] of L)if(cc<c)ex.add(x.k);
  for(const cc of [c-2,c-1])if(!L.has(cc)){const p=asmPickRaw(cc,recs,ex);if(p)ex.add(p.k);}
  return asmPickRaw(c,recs,ex);
}
/* the count. Players vote with 1, the Delegate with 1 + endorsements, computer nations with a third each */
function asmNpcVote(x,L,c){
  const r=rng(hash(x.id+':asmv:'+L.k)),at=asmT0(c)+3600e3+Math.floor(r()*ASM_P*0.8);
  if(L.by===x.id)return {v:1,t:asmT0(c)+600e3,sc:9};
  const sc=asmNpcScore(x,L,c)+(r()*2-1)*0.8;
  return {v:sc>=0.6?1:sc<=-0.6?-1:0,t:at,sc};
}
function asmTally(L,c,recs,T,D){
  const t0=asmT0(c),t1=asmT0(c+1),Tm=Math.min(T,t1-1),rows=[];let y=0,no=0,shown=0;
  for(const r of recs){if(!asmMemberAt(r.n,Tm))continue;const a=asmA(r.n),v=a&&a.v?a.v.find(x=>x.c===c&&x.k===L.k&&x.t>=t0&&x.t<t1&&x.t<=T):null;
    const del=!!(D&&D.id===r.id),w=1+(del?D.k:0);rows.push({id:r.id,n:r.n,me:!!r.me,v:v?v.v:0,t:v?v.t:0,w,del});if(v){if(v.v>0)y+=w;else if(v.v<0)no+=w;}}
  for(const x of NPC_NATIONS){const nv=asmNpcVote(x,L,c),on=nv.t<=T;if(on)shown++;rows.push({id:x.id,n:x,npc:true,v:on?nv.v:null,t:nv.t,w:ASM_NPC_W});if(on){if(nv.v>0)y+=ASM_NPC_W;else if(nv.v<0)no+=ASM_NPC_W;}}
  y=Math.round(y*100)/100;no=Math.round(no*100)/100;
  return {rows,y,n:no,ok:y>no,shown};
}
/* the outcome of a finished cycle: the earliest recorded one, or the count from the records */
function asmFinal(c){return protectedLocks.find(x=>x.c===c&&x.f)||null;}
/* everything the pages need, memoised by the records and the minute */
let asmMemo={k:'',v:null},asmDrawn='';
function asmState(now,me){
  now=now||Date.now();const mine=me===undefined||me===S.nation;if(me===undefined)me=S.nation;
  const c=asmCyc(now),recs=asmRecs(me);
  const base=mine?[REG.id,c,npcRev,S.mode,S.uid||'',...recs.map(r=>r.id+':'+(r.n.updatedAt||0))].join('|'):'';
  const k=base+'|'+Math.floor(now/60000);
  if(mine&&asmMemo.k===k)return asmMemo.v;
  const L=asmLocks(recs),cur=asmPickFor(c,recs,L),DD=asmDelegateAt(recs,now),D=DD.D,V=cur?asmTally(cur,c,recs,now,D):null;
  const v={c,t0:asmT0(c),t1:asmT0(c+1),now,recs,L,cur,locked:L.has(c),D,DD,V,sig:hash(base)+':'+(V?V.shown:0)};
  if(mine)asmMemo={k,v};
  return v;
}

return {state:now=>asmState(now),pick:(c,exclude)=>asmPickRaw(c,records,exclude),tally:asmTally,delegate:asmDelegateAt,key:asmPKey,cycle:asmCyc,t0:asmT0,cats:ASM_CATS};
}
