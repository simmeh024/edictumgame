// Edict works, jobs and unemployment (14 November 2026): the answers that build, the week before a works opens, the
// Ministry's letter and first delivery, unemployment from the census, laws, works and hiring edicts, what it does to
// Happiness and migration, and the adviser's forecast on the result page. Run with: node --test test/edict-works.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const START='/* ───────── edict works, jobs and unemployment',DAY=864e5;
const sec=(()=>{const a=source.indexOf(START);assert(a>0,'the section exists');return source.slice(a,source.indexOf('\n/* ───────── ',a+START.length));})();

/* a function of the game, by name, from `function name(` to its closing brace */
function gameFn(name){
  const a=source.indexOf('function '+name+'(');assert(a>=0,'the game has function '+name);
  let i=source.indexOf('{',a),depth=0;for(;i<source.length;i++){const c=source[i];if(c==='{')depth++;else if(c==='}'&&--depth===0)break;}
  return source.slice(a,i+1);
}
const line=start=>{const a=source.indexOf(start);assert(a>=0,start);return source.slice(a,source.indexOf('\n',a));};
const block=(start,end)=>{const a=source.indexOf(start);assert(a>=0,start);return source.slice(a,source.indexOf(end,a)+end.length);};

/* every option of every edict, by 'id:index', read from the source the way the arrays are written: one option a line */
const OPTS=(()=>{const out={},L=source.split('\n');let id=null,o=0;
  for(const s of L){const m=/^\s*\{id:'([^']+)'.*o:\[/.exec(s);if(m){id=m[1];o=0;continue;}
    if(id&&/^\s*\{t:'.*?',(?:e|g):\{/.test(s)){out[id+':'+o]={t:(/^\s*\{t:'(.*?)',/.exec(s)||[])[1],fx:(/fx:'([^']*)'/.exec(s)||[])[1]||''};o++;}}
  return out;})();

/* the section on its own, with the game's census estimate, budget shares and lists, and small stand-ins for the rest */
function sandbox(extra={}){
  const code=['const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));',block('const BUDGET = [','];'),line('const RES_INFO='),line('const RES_POL = '),
    block('const POLICIES = {','\n};'),line('const DRIFT_TO='),gameFn('unempOf'),gameFn('bpOf'),gameFn('list'),
    `let cxCityAgg=function(a,ct){},rbdParts=function(){return null;},geoAfter=function(){return [];},answer=function(){},
     resultView=function(){return S.html||'';},cityCard=function(){return S.card||'';},almanac=function(x){return {now:S.now,s:x.n.s,unemp:-1};},
     migAppeal=function(){return 50;};`,
    sec,
    'this.X={EDW_OPTS,EDW_KINDS,EDW_JOBS,EDW_LAW_JOBS,EDW_OPEN,EDW_MAX,unempNow,jbNow,unHappyRate,edwPeople,edwCity,edwOutText,optWho,edwForecast,edwLetter,edwRows,unempOf,cxCityAgg,geoAfter,answer,resultView,cityCard,almanac,migAppeal};'].join('\n');
  const S={nation:null,result:null,now:0};
  const ctx=vm.createContext(Object.assign({DAY,S,ISSUE_BY_ID:{},OFFICES:{},DM_SOURCES:[],HELP_EXT:[],COMMIT_HOOKS:[],NORM_HOOKS:[],
    fill:(t,n)=>String(t).replace(/\{CAP\}/g,n.capital||'Capital').replace(/\{A\}/g,'Otter').replace(/\{D\}/g,'Pellish').replace(/\{DISH\}/g,'Stew'),
    fmt0:v=>Math.round(v).toLocaleString('en-US'),popNow:n=>n.pop,pol:n=>(n&&n.policies)||{},cityList:n=>n.cities||[],cellOf:v=>Number.isInteger(v)?v:-1,
    isCoastal:c=>c>=100,cityLabel:(n,c)=>c.nm||n.capital,fmtDate:t=>new Date(t).toISOString().slice(0,10),esc:s=>String(s),cap1:s=>s[0].toUpperCase()+s.slice(1),
    pctS:v=>(Math.round(v*10)/10).toFixed(1)+'%',stockNow:n=>Object.assign({},n.stock),stockLimit:(n,r,v)=>Math.min(400,v),num0:v=>+v||0,roundStock:s=>s,
    cabOf:()=>({wrk:{nm:'Ada Brick'}}),dmSeal:()=>'',economy:()=>({byDoc:new Map()}),cityState:()=>({all:[]})},extra));
  vm.runInContext(code,ctx);return {X:ctx.X,ctx,S};
}
const nation=(o={})=>Object.assign({name:'Pellmark',capital:'Pell',loc:5,pop:10,cities:[{id:'cap',c:5,nm:''},{id:'a',c:120,nm:'Saltby'}],
  s:{econ:50,wealth:50,tax:30,happy:50},policies:{},budget:{welfare:8,admin:8,defence:8,edu:8,env:8,health:8,commerce:8,aid:8,law:8,transport:8,equality:8,spirit:8},stock:{goods:20,food:20,iron:20,oil:5,timber:20}},o);

test('every answer that builds or hires is a real option, and says so',()=>{
  const {X}=sandbox();
  const words={yard:/ship|yard|navy|naval|carrier|dock|ferry/i,plant:/factor|works|plant|mill|steel|fab|made|make|turns out/i,port:/port|harbour|canal|quay|zone|warehouse|channel|dredg|cargo|airport/i,
    mine:/mine|quarry|ore|lithium/i,rig:/drill|rig/i,power:/power|reactor|solar/i,farm:/farm|fish|greenhouse|tomato/i,
    leisure:/park|resort|ski|casino|golf|forest|hotel|chairlift|world|land /i,lab:/data cent|launch|rocket/i};
  for(const [k,[kind,name,need,jobs]] of Object.entries(X.EDW_OPTS)){
    const o=OPTS[k];assert(o,k+' is an option');assert(X.EDW_KINDS[kind],k+' kind '+kind);
    assert(words[kind].test(o.fx+' '+o.t),k+' ('+kind+'): '+o.fx);
    assert(name.length>2&&name.length<=48&&!/["']/.test(name),k+' name '+name);
    assert(need===undefined||need===''||need==='coast',k+' need');assert(jobs===undefined||(jobs>0&&jobs<=0.5),k+' jobs');
  }
  assert(Object.keys(X.EDW_OPTS).length>=60,'some sixty answers build');
  for(const [k,v] of Object.entries(X.EDW_JOBS)){const o=OPTS[k];assert(o,k+' is an option');assert(v!==0&&Math.abs(v)<=1.2,k);
    assert(/job|employ|hire|hiring|work|unemploy|robot|automat|close|abroad|clerk|army|tracer|guard|cart|mound|zone|factor|steel|mine|lithium|chairlift|casino|hotel|forest|mall|shopping|golf|park/i.test(o.t+' '+o.fx),k+': '+o.t);}
  assert(X.EDW_JOBS['call-centre-ai:1']>0&&X.EDW_JOBS['job-guarantee:0']<0,'lay-offs raise it, hiring lowers it');
  for(const k of Object.keys(X.EDW_LAW_JOBS))assert(source.includes('\n'+k+':[')||new RegExp('\\b'+k+":\\['").test(source),k+' is a law');
});

test('a works opens a week on, in the capital or the first coastal city, and the answer’s hiring moves unemployment at once',()=>{
  const {X,ctx}=sandbox(),now=Date.UTC(2026,10,14,12);
  const opts=[{t:'a',e:{}},{t:'b',e:{}},{t:'“Build real factories, not tax-free sheds,” says Puddingstone harbourmaster Agnes Moreau. “A state-backed shipyard would employ twice as many people.”',e:{wealth:2}}];
  ctx.ISSUE_BY_ID['n03-free-port']={t:'Duty-Free and Easy',o:opts};
  const n=nation();
  const notes=X.geoAfter(n,opts[2],null,now,{id:'n03-free-port'});
  assert.equal(n.ew.length,1);const w=n.ew[0];
  assert.deepEqual({k:w.k,nm:w.nm,c:w.c,t:w.t,d:w.d},{k:'n03-free-port:2',nm:'Puddingstone Shipyard',c:120,t:now,d:now+7*DAY},'a yard goes to a coastal city: the capital is inland here');
  assert.match(notes[0][1],/Puddingstone Shipyard opens near Saltby on 2026-11-21/);
  assert.equal(n.jb.v,-0.4);assert.equal(n.jb.t,now);
  const capCoast=nation({loc:150,cities:[{id:'cap',c:150,nm:''}]});X.geoAfter(capCoast,opts[2],null,now,{id:'n03-free-port'});assert.equal(capCoast.ew[0].c,150,'the capital when it is on the coast');
  const lost=nation();X.geoAfter(lost,{...opts[2]},null,now,{id:'n03-free-port'});assert.equal(lost.ew,undefined,'a gamble that failed (another option object) builds nothing');
  const full=nation({ew:Array.from({length:X.EDW_MAX},(_,i)=>({k:'nuke:0',nm:'N'+i,c:5,t:1,d:2}))});X.geoAfter(full,opts[2],null,now,{id:'n03-free-port'});assert.equal(full.ew.length,X.EDW_MAX,'at most thirty');
  const u0=X.unempOf(n.s,{}),u1=X.unempNow(n,now);assert.equal(Math.round((u1-u0)*1000)/1000,-0.4,'the hiring counts now; the yard not yet');
  assert.equal(Math.round((X.unempNow(n,now+7*DAY)-u0)*1000)/1000,Math.round((-0.4*Math.pow(0.98,7)-0.5)*1000)/1000,'a week on: the nudge has faded 2% a day and the yard employs 0.5 points');
});

test('unemployment: the census estimate, laws, open works and the fading nudge, from 0.8% to 30%',()=>{
  const {X}=sandbox(),now=1e12;const n=nation();
  assert.equal(X.unempNow(n,now),X.unempOf(n.s,{}),'nothing else: the census estimate the currency job also uses');
  n.policies={industrialStrategy:true,youthGuarantee:true,conscription:true};assert.equal(Math.round((X.unempOf(n.s,n.policies)-X.unempNow(n,now))*100)/100,1.3,'three laws put 1.3 points to work');
  n.policies={};n.jb={v:-1,t:now-35*DAY};assert(Math.abs(X.jbNow(n,now)+Math.pow(0.98,35))<1e-9,'about half left after five weeks');
  n.jb={v:-50,t:now};assert.equal(X.unempNow(n,now),0.8,'never below 0.8%');
  const npc=nation({npc:true,jb:{v:-5,t:now},ew:[{k:'nuke:0',nm:'x',c:5,t:0,d:1}]});assert.equal(X.unempNow(npc,now),X.unempOf(npc.s,{}),'computer nations: census and laws only');
  const rich=nation({s:{econ:80,wealth:85,tax:30,happy:50}}),poor=nation({s:{econ:20,wealth:20,tax:30,happy:50}});
  assert(X.unempNow(poor,now)>X.unempNow(rich,now)+5);
  assert(X.unHappyRate(poor,X.unempNow(poor,now))<0&&X.unHappyRate(rich,X.unempNow(rich,now))>0,'high unemployment lowers Happiness, low lifts it');
  assert.equal(X.unHappyRate(nation(),30),-0.06*1,'at most 0.06 a day');
  const kind=nation({budget:{welfare:40,admin:8,defence:8,edu:8,env:8,health:8,commerce:8,aid:8,law:8,transport:8,equality:8,spirit:8}});assert(X.unHappyRate(kind,12)>X.unHappyRate(nation(),12),'a larger welfare budget softens the fall');
  assert.equal(X.migAppeal({n:poor}),50-0.35*(X.unempNow(poor,Date.now())-6),'migrants weigh it');
  assert.equal(X.almanac({n:poor}).unemp,X.unempNow(poor,0,poor.s),'the Statistics page shows the full figure');
});

test('on a save: Happiness feels unemployment after an hour, for at most 14 days at a time, within 10 to 90',()=>{
  const {ctx}=sandbox(),hook=ctx.COMMIT_HOOKS[0],t=Date.UTC(2026,10,1);
  const n=nation({s:{econ:20,wealth:20,tax:30,happy:50}});
  hook(n,null,t);assert.equal(n.unh,t);assert.equal(n.s.happy,50,'the first save only starts the clock');
  hook(n,null,t+30*60e3);assert.equal(n.s.happy,50);assert.equal(n.unh,t,'nothing within the hour');
  hook(n,null,t+10*DAY);assert(n.s.happy<50&&n.s.happy>49,'ten days of high unemployment: a little lower: '+n.s.happy);
  const h=n.s.happy;hook(n,null,t+200*DAY);assert(Math.abs((h-n.s.happy)-(50-h)/10*14)<1e-6,'a long absence counts as 14 days');
  const low=nation({s:{econ:20,wealth:20,tax:30,happy:10.01}});low.unh=t;hook(low,null,t+14*DAY);assert.equal(low.s.happy,10,'not below 10');
  const npc=nation({npc:true});hook(npc,null,t);assert.equal(npc.unh,undefined);
});

test('a works that has opened sends its first delivery once, and the Ministry writes',()=>{
  const {ctx,X}=sandbox(),hook=ctx.COMMIT_HOOKS[1],t=Date.UTC(2026,10,21,12);
  ctx.ISSUE_BY_ID['n03-free-port']={t:'Duty-Free and Easy',o:[]};
  const n=nation({ew:[{k:'n03-free-port:2',nm:'Puddingstone Shipyard',c:120,t:t-7*DAY,d:t-1000},{k:'nuke:0',nm:'Nuclear Power Stations',c:5,t:t,d:t+7*DAY}]});
  const msg=JSON.parse(JSON.stringify(hook(n,null,t)));
  assert.deepEqual(msg,['Puddingstone Shipyard has opened near Saltby: goods +3 a day. The Ministry of Public Works has written.']);
  assert.equal(n.stock.goods,35,'fifteen goods');assert.equal(n.ew[0].p,1);assert.equal(n.ew[1].p,undefined,'the other is still being built');
  assert.equal(hook(n,null,t+DAY).length,0,'paid once');assert.equal(n.stock.goods,35);
  const letters=ctx.DM_SOURCES[0](n,t);assert.equal(letters.length,1);assert.equal(letters[0].peer,'office-works');assert.equal(letters[0].t,t-1000);
  assert.match(letters[0].x,/^To the government of Pellmark,/);
  assert.match(letters[0].x,/Puddingstone Shipyard opened today near Saltby\. The first hull slid down the slipway this morning, and about 25,000 people now work at the yard\./);
  assert.match(letters[0].x,/it has sent 15 goods to your stockpile, and unemployment is down 0\.5 points/);
  assert.match(letters[0].x,/your edict “Duty-Free and Easy”, decided on 2026-11-14/);assert.match(letters[0].x,/Ada Brick, Minister of Public Works$/);
  assert(ctx.OFFICES['office-works'].name==='The Ministry of Public Works');
  assert.equal(X.edwPeople(nation({pop:0.004}),0.5),'about 10 people'.replace('about 10 people','a few dozen people'));
  assert.equal(X.edwPeople(nation({pop:3.21}),0.3),'about 4,800 people');
});

test('a works adds its output to its city, or to the capital once its city is gone',()=>{
  const {X}=sandbox(),now=Date.now(),n=nation({ew:[{k:'n03-free-port:2',nm:'Y',c:120,t:0,d:1},{k:'casino:0',nm:'C',c:999,t:0,d:1},{k:'nuke:0',nm:'N',c:120,t:0,d:now+DAY}]});
  const z=()=>({add:{food:0,timber:0,iron:0,oil:0,goods:0},prosper:0});
  const a1=z(),c1={c:120,cap:false,fn:n};X.cxCityAgg(a1,c1);assert.equal(a1.add.goods,3);assert.equal(a1.prosper,0,'the reactor is not open yet');assert.deepEqual({...c1.edw},{goods:3});
  const a2=z(),c2={c:5,cap:true,fn:n};X.cxCityAgg(a2,c2);assert.equal(a2.prosper,0.015,'the casino of a city no longer held works for the capital');
  const a3=z();X.cxCityAgg(a3,{c:120,npc:true,fn:n});assert.equal(a3.add.goods,0,'never for computer cities');
});

test('who proposed the answer, from its words',()=>{
  const {X}=sandbox();
  const cases=[
    ['“Build real factories, not tax-free sheds,” says Puddingstone harbourmaster Agnes Moreau. “A state-backed shipyard would employ twice as many people.”','Puddingstone harbourmaster Agnes Moreau'],
    ['“Puddingstone likes being sleepy,” says the town’s oldest resident, Winifred Pask. “Leave us alone.”','Winifred Pask'],
    ['“Why be shy about it?” asks Lennart Sobieski, spooning a strawberry yoghurt. “Let ministers accept sponsorship openly.”','Lennart Sobieski'],
    ['“Adults of sound mind,” says palliative care doctor Dr. Miriam Sorensen. “Legalise it.”','palliative care doctor Dr. Miriam Sorensen'],
    ['“If one company runs every shop anyway, the state may as well own it,” says socialist MP Lena Sorokina.','socialist MP Lena Sorokina'],
    ['“An internship is an investment,” says publishing executive Hugo Vandermeer, whose own internship was at his father’s firm. “Leave them alone.”','publishing executive Hugo Vandermeer'],
    ['Ban it outright.','']];
  for(const [t,w] of cases)assert.equal(X.optWho(t),w,t);
});

test('the result page: the adviser’s forecast and the unemployment row',()=>{
  const {X,ctx,S}=sandbox(),now=Date.UTC(2026,10,14,12);
  ctx.ISSUE_BY_ID['n03-free-port']={t:'Duty-Free and Easy',o:[{t:'a'},{t:'b'},{t:'“Build real factories, not tax-free sheds,” says Puddingstone harbourmaster Agnes Moreau. “A state-backed shipyard would employ twice as many people.”'}]};
  const n=nation();S.nation=n;
  S.result={id:'n03-free-port',o:2,t:now,before:{tax:30},after:{tax:32},out:{a:100,b:106.8},enacted:['industrialStrategy'],repealed:[],
    edw:{k:'n03-free-port:2',nm:'Puddingstone Shipyard',city:'Saltby',d:now+7*DAY,kd:'yard',jobs:0.5},jobs:{a:9.2,b:8.8,c:8.3}};
  const html=X.edwForecast(S.result,n);
  assert.match(html,/<b>Puddingstone harbourmaster Agnes Moreau<\/b> expects:/);
  assert.match(html,/Output a year rises 6\.8% now/);
  assert.match(html,/Industrial Strategy: goods \+20% from today\./);
  assert.match(html,/Puddingstone Shipyard opens near Saltby on 2026-11-21: goods \+3 a day, and work for about 25,000 people\./);
  assert.match(html,/Unemployment 9\.2% → 8\.8% now, and about 8\.3% once Puddingstone Shipyard opens\./);
  assert.match(html,/At that level, unemployment lowers Happiness by about 0\.7 a month\./);assert.match(html,/Income tax eases back toward 35%/);
  S.html='<h2 class="lbl-h">Census changes</h2><ul class="deltas"><li>x</li></ul>';
  const page=X.resultView();assert(page.indexOf('edw-fc')<page.indexOf('Census changes'),'the forecast comes before the census changes');
  assert.match(page,/<li class="d-up edw-un"><span class="d-name">Unemployment<\/span><span class="d-vals">9\.2% → 8\.8%<\/span><span class="d-chg up">▼ 0\.4<\/span><\/li><\/ul>/);
  S.result={id:'n03-free-port',o:0,t:now,before:{tax:30},after:{tax:30},enacted:[],repealed:[]};assert.equal(X.edwForecast(S.result,n),'','nothing economic: no forecast');
});

test('the record keeps its works and nudge through a reload, and nothing else',()=>{
  const {ctx}=sandbox(),norm=ctx.NORM_HOOKS[0],out={};
  norm(out,{ew:[{k:'n03-free-port:2',nm:'Puddingstone Shipyard',c:120,t:1,d:2,p:1,x:9},{k:5},null,{k:'a',t:3,d:2}],jb:{v:-0.4,t:5},unh:7});
  assert.deepEqual(JSON.parse(JSON.stringify(out)),{ew:[{k:'n03-free-port:2',nm:'Puddingstone Shipyard',c:120,t:1,d:2,p:1}],jb:{v:-0.4,t:5},unh:7});
  const none={};norm(none,{jb:{v:99,t:1}});assert.deepEqual(none,{});
});

test('placement: the section sits before the portraits section, wraps what it needs and is styled',()=>{
  const a=source.indexOf(START),b=source.indexOf('/* ───────── portraits of state: the faces of the government');
  assert(a>0&&a<b,'before the portraits section');
  for(const f of ['function cxCityAgg(','function cityCard(','function rbdParts(','function almanac(','function migAppeal(','function geoAfter(','function answer(','function resultView('])assert(source.indexOf(f)<a,f+' is defined first');
  for(const w of ['cxCityAgg=(f=>','rbdParts=(f=>','geoAfter=(f=>','answer=(f=>','resultView=(f=>','cityCard=(f=>','almanac=(f=>','migAppeal=(f=>'])assert(sec.includes(w),w);
  assert(/\.edw-fc\{/.test(source.slice(0,source.indexOf('</style>'))),'the forecast is styled');
  const shim=readFileSync(new URL('../src/shim.js',import.meta.url),'utf8');
  assert(!/NX_KEYS\.(ew|jb|unh)\b|'ew'|'jb'/.test(shim.slice(shim.indexOf('var NX_KEYS'),shim.indexOf('function splitNation'))),'works and the nudge are shared: other players count them');
  assert(/export function unempOf\(s, p\) \{ return clamp\(2 \+ \(100 - s\.econ\) \* 0\.06/.test(readFileSync(new URL('../jobs/fx/engine.mjs',import.meta.url),'utf8')),'the currency job keeps the census estimate');
});
