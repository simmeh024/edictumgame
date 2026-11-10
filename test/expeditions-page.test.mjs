// The Expeditions page's plain parts: the odds of the die, what a find brings, the race against other nations'
// expeditions (n.xb, in the shared half), the route on the expedition's card, and the odds of a fleeting party.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const shim=readFileSync(new URL('../src/shim.js',import.meta.url),'utf8');
const section=(a,b)=>{const s=source.indexOf(a),e=source.indexOf(b,s);assert.ok(s>0&&e>s,'section '+a);return source.slice(s,e);};
const KINDS=section('const SITE_KINDS={','const SITE_MAX=');
const OUTCOME=section('const EXP_TABLE=','function resolveExp(');
const PAGE=section('/* ───────── the Expeditions page (Map › Expeditions) ─────────','/* the die with a seal on it');
const FLT=section('function flTier(','\n/* ── bonuses:');
const FLODDS=section('const FL_TSN=','const flSealed=');

const DAY=864e5,NOW=1_800_000_000_000;
function game({docs=[],sites=20}={}){
  const NORM_HOOKS=[];
  const ctx=vm.createContext({NORM_HOOKS,DAY,Math,Number,Object,String,
    SITES:Array.from({length:sites},(_,i)=>({c:i,k:'falls',x:'Vel'})),
    STATS:{wealth:{n:'Prosperity'},env:{n:'Eco-Friendliness'},happy:{n:'Happiness'},sci:{n:'Science & Technology'},tour:{n:'Tourism'},culture:{n:'Culture'},health:{n:'Public Health'},relig:{n:'Religiousness'},weird:{n:'Weirdness'}},
    fmtAmt:x=>{const v=Math.round(x*10)/10;return Number.isInteger(v)?String(v):v.toFixed(1);},resName:r=>r,
    fmtDur:ms=>Math.ceil(ms/60e3)+' min',clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),esc:v=>String(v),
    tradeDocs:()=>docs,myId:()=>'me',siteLabel:si=>'Rumoured waterfall '+si});
  vm.runInContext(KINDS+OUTCOME+PAGE+FLT+FLODDS+'\nthis.X={expOdds,expRuns,xpOddsHTML,xpFinds,xpRivals,xpRivalText,xpRoute,xpRoutePts,flOdds,flRuns,flOddsHTML,XP_IC,SITE_KINDS};',ctx);
  return {...ctx.X,NORM_HOOKS};
}

test('the odds of the die: whole fives that sum to 100, and the chance to find it',()=>{
  const G=game();
  for(const [m,dc] of [[0,9],[4,11],[6,10],[-3,14],[12,9],[-12,13]]){
    const o=G.expOdds(m,dc);assert.equal(o.lost+o.traces+o.found+o.great,100,`${m} vs ${dc}`);assert.equal(o.find,o.found+o.great);
    for(const k of ['lost','traces','found','great'])assert.equal(o[k]%5,0);}
  assert.deepEqual({...G.expOdds(4,11)},{lost:10,traces:20,found:30,great:40,find:70},'d20 + 4 against 11');
  assert.deepEqual({...G.expOdds(6,10)},{lost:5,traces:10,found:30,great:55,find:85},'d20 + 6 against 10');
});

test('a natural 1 is always lost and a natural 20 always remarkable',()=>{
  const G=game();
  assert.equal(G.expOdds(40,9).lost,5);assert.equal(G.expOdds(40,9).great,95);
  assert.equal(G.expOdds(-40,30).great,5);assert.equal(G.expOdds(-40,30).lost,95);
});

test('the die in runs of one outcome, lowest face first, twenty faces in all',()=>{
  const G=game(),R=G.expRuns(4,11);
  assert.deepEqual([...R].map(r=>[...r]),[['lost',2],['traces',4],['found',6],['great',8]]);
  for(const [m,dc] of [[0,9],[-12,13],[12,9]])assert.equal(G.expRuns(m,dc).reduce((a,r)=>a+r[1],0),20);
});

test('the odds as drawn: the percent, a bar in runs, words for a screen reader, and only outcomes that can happen',()=>{
  const G=game(),h=G.xpOddsHTML(30,9);
  assert.match(h,/<span class="xp-pct">95%<\/span>/);
  assert.match(h,/aria-label="95% to find it: lost 5%, remarkable 95%"/);
  assert.equal((h.match(/<i class="xp-z/g)||[]).length,2);
  assert.doesNotMatch(h,/traces 0/);
});

test('what a first find brings, and half as much again for a remarkable one',()=>{
  const G=game(),t=(k,m)=>[...G.xpFinds(k,m)].map(f=>f.t);
  assert.deepEqual(t('wreck'),['+2 prosperity','30 goods']);
  assert.deepEqual(t('wreck',1.5),['+3 prosperity','45 goods']);
  assert.deepEqual(t('meteor',1.5),['+6 science']);
  const seep=G.xpFinds('seep');assert.equal(seep[0].t,'−1 environment');assert.equal(seep[0].neg,true);
  assert.ok(G.xpFinds('valley').some(f=>f.land&&f.t==='a land credit'));
  assert.deepEqual([...G.xpFinds('nonsense')],[]);
});

test('every kind of site has its glyph',()=>{
  const G=game();
  for(const k of Object.keys(G.SITE_KINDS))assert.match(G.XP_IC[k]||'',/^M[\d.]/,k);
});

test('rivals: other nations bound for the same site, soonest first; never your own, and not ones long gone',()=>{
  const docs=[['me',{name:'Us',xb:{s:3,t:NOW+5e5}}],['a',{name:'Aldmoor',xb:{s:3,t:NOW+9e5}}],['b',{name:'Brisk',xb:{s:3,t:NOW+2e5}}],
    ['c',{name:'Corvane',xb:{s:4,t:NOW+1e5}}],['d',{name:'Dunmere',xb:{s:3,t:NOW-3*DAY}}],['e',{name:'Ely',xb:{s:3,t:'soon'}}],['f',{name:'Fen'}]];
  const G=game({docs}),R=G.xpRivals(3,NOW);
  assert.deepEqual([...R].map(r=>r.name),['Brisk','Aldmoor']);
  assert.deepEqual([...G.xpRivals(9,NOW)],[]);
});

test('the race in words: a rival ahead, behind, or already home',()=>{
  const G=game();
  assert.equal(G.xpRivalText([],NOW,NOW,false),null);
  const ahead=G.xpRivalText([{name:'Brisk',t:NOW+2*60e3}],NOW+20*60e3,NOW,false);
  assert.equal(ahead.warn,true);assert.equal(ahead.t,'Brisk’s expedition is bound here too, and gets back 18 min before yours');
  assert.equal(G.xpRivalText([{name:'Brisk',t:NOW+2*60e3},{name:'Aldmoor',t:NOW+3*60e3}],NOW+20*60e3,NOW,true).t,'Brisk’s expedition (and 1 more) is bound here too, and gets back 18 min before yours would');
  const behind=G.xpRivalText([{name:'Aldmoor',t:NOW+30*60e3}],NOW+5*60e3,NOW,true);
  assert.equal(behind.warn,false);assert.equal(behind.t,'Aldmoor’s expedition is bound here too, but yours would get back 25 min sooner');
  const home=G.xpRivalText([{name:'Corvane',t:NOW-60e3}],NOW+5*60e3,NOW,false);
  assert.equal(home.warn,true);assert.match(home.t,/already back from here, and its report is not in yet/);
});

test('n.xb survives a load only when it names a real site and a time',()=>{
  const G=game({sites:10}),norm=d=>{const n={};for(const h of G.NORM_HOOKS)h(n,d);return n.xb;};
  const pl=v=>v&&[...v].map(x=>({...x}));
  assert.deepEqual(pl(norm({xb:{s:3,t:NOW,r:20}})),[{s:3,t:NOW}],'an older record’s one entry, and never the roll');
  assert.deepEqual(pl(norm({xb:[{s:3,t:NOW},{s:9,t:NOW+1},{s:4,t:NOW+2}]})),[{s:3,t:NOW},{s:9,t:NOW+1}],'one entry for each team, two at most');
  for(const xb of [{s:10,t:NOW},{s:-1,t:NOW},{s:1.5,t:NOW},{s:2,t:NaN},{s:2,t:0},{s:'2',t:NOW},'x',null])assert.equal(norm({xb}),undefined,JSON.stringify(xb));
  assert.equal(norm({}),undefined);
});

test('the shared half: n.exp (with its roll) stays private, n.xb is shared and follows the teams out',()=>{
  const nx=shim.slice(shim.indexOf('var NX_KEYS'),shim.indexOf('function splitNation'));
  assert.match(nx,/'exp'/,'the expedition stays private');assert.doesNotMatch(nx,/'xb'/,'where it went is shared');
  assert.match(source,/if\(L\.length\)n\.xb=L;else delete n\.xb;return \[\];\}\);/,'every save writes it from the teams out, and drops it when none is');
});

test('the route: from the capital to the site, cut where the party is',()=>{
  const G=game(),{pts}=G.xpRoutePts(),a=G.xpRoute(0),b=G.xpRoute(1),m=G.xpRoute(0.5);
  assert.deepEqual([a.x,a.y],[30,55]);assert.deepEqual([b.x,b.y],[556,40]);
  assert.equal(pts.length,49);
  const cut=`${m.x.toFixed(1)},${m.y.toFixed(1)}`;
  assert.ok(m.done.endsWith(cut)&&m.rest.startsWith(cut),'both halves meet at the party');
  assert.ok(m.x>200&&m.x<460,'halfway is near the middle');
  assert.deepEqual([G.xpRoute(-1).x,G.xpRoute(2).x],[30,556],'clamped');
  let last=-1;for(let p=0;p<=1;p+=0.05){const r=G.xpRoute(p),n=r.done.split(' ').length;assert.ok(n>=last);last=n;}
});

test('a fleeting party’s odds: five tiers in fives, and arriving first adds 2',()=>{
  const G=game();
  for(const [m,f] of [[0,false],[3,true],[-5,false],[14,true]]){const o=G.flOdds(m,f);assert.equal(o.reduce((a,v)=>a+v,0),100);}
  assert.deepEqual([...G.flOdds(0,false)],[5,30,30,25,10]);
  assert.deepEqual([...G.flOdds(0,true)],[5,20,30,25,20]);
  const h=G.flOddsHTML(0,true);
  assert.match(h,/<span class="xp-pct">75%<\/span>/);assert.match(h,/\+2 for arriving first/);
});

// ── the outfitters: blocks, the workshop, what they cost and need, and what they do ──
const XUS=section("/* ── the outfitters: upgrades to the explorers' kit",'function siteDefault(si)');
const LOSTS=section('const LOST_KINDS={','const LOST_ORDER=');
function outfit({cities=[],now=NOW}={}){
  const ctx=vm.createContext({Math,Object,Number,String,Date:{now:()=>now},
    clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),cap1:s=>s?s[0].toUpperCase()+s.slice(1):s,
    list:a=>a.length<2?(a[0]||''):a.length===2?a[0]+' and '+a[1]:a.slice(0,-1).join(', ')+', and '+a[a.length-1],
    BUILDINGS:{sawmill:{n:'Sawmill'},mine:{n:'Iron Mine'},orepit:{n:'Ore Pits'},outfit:{n:'Outfitters’ Guild'},farm:{n:'Farm Estates'},caravan:{n:'Caravanserai'},rail:{n:'Railway Station'},
      warehouse:{n:'Warehouse'},harbour:{n:'Harbour'},university:{n:'University'},reserve:{n:'Nature Reserve'},digs:{n:'Institute of Field Archaeology'},library:{n:'Great Library'},
      maproom:{n:'Map Room'},observ:{n:'Observatory'},market:{n:'Market Hall'},airport:{n:'Airport'},xclub:{n:'Explorers’ Club'}},
    cityList:()=>cities,cxUps:b=>b.ug||0,whLevel:b=>b.wl||0});
  vm.runInContext(LOSTS+'const LOST_ORDER=Object.keys(LOST_KINDS);'+XUS+'\nthis.X={XU,XU_KEYS,XU_TOTAL,xuLv,xuAll,xuCost,xuHours,xuReqText,xuHave,xuGear,xuTimeK,xuReach,xuCostK,xuCurio,xuParty,xuLvText,xuNowText,LOST_KINDS};',ctx);
  return ctx.X;
}

test('seven upgrades of five blocks and one of a single block: 36 in all',()=>{
  const X=outfit();
  assert.deepEqual([...X.XU_KEYS],['gear','mules','depots','rations','nat','maps','swift','team']);
  assert.equal(X.XU_TOTAL,36);
  for(const k of X.XU_KEYS)assert.equal(X.XU[k].req.length,k==='team'?1:5,k);
});

test('the first block is open to everyone, except Old maps (a Map Room) and the second team (the Explorers’ Club)',()=>{
  const X=outfit();
  for(const k of X.XU_KEYS)assert.equal(X.XU[k].req[0]===null,!['maps','team'].includes(k),k);
  assert.equal(X.xuReqText(X.XU.maps.req[0]),'a Map Room');
  assert.equal(X.xuReqText(X.XU.team.req[0]),'an Explorers’ Club');
});

test('what each block needs, in words',()=>{
  const X=outfit(),q=(k,i)=>X.xuReqText(X.XU[k].req[i]);
  assert.equal(q('gear',1),'a Sawmill');
  assert.equal(q('gear',2),'an Iron Mine or Ore Pits');
  assert.equal(q('gear',4),'an Outfitters’ Guild upgraded to green');
  assert.equal(q('mules',1),'Farm Estates');
  assert.equal(q('mules',4),'a Caravanserai upgraded to blue');
  assert.equal(q('depots',4),'a Warehouse at level 3');
  assert.equal(q('nat',1),'a University');
  assert.equal(q('maps',4),'a Map Room upgraded to purple');
  assert.equal(q('swift',4),'an Airport');
});

test('a requirement is met by a finished building, upgraded far enough, in any city',()=>{
  const now=NOW,c1={id:'a',b:[{k:'sawmill',d:now-1},{k:'outfit',d:now-1,ug:1}]},c2={id:'b',b:[{k:'outfit',d:now+5e5,ug:3},{k:'warehouse',d:now-1,wl:3}]};
  const X=outfit({cities:[c1,c2],now});
  assert.equal(X.xuHave({},X.XU.gear.req[1],now).c.id,'a','a Sawmill in the first city');
  assert.equal(X.xuHave({},X.XU.gear.req[4],now),null,'a Guild at grey is not green, and one still being built does not count');
  assert.equal(X.xuHave({},X.XU.depots.req[4],now).c.id,'b','a Warehouse at level 3');
  assert.equal(X.xuHave({},X.XU.gear.req[2],now),null,'no mine');
  assert.deepEqual({...X.xuHave({},null,now)},{},'no requirement');
});

test('blocks fitted, and one whose time in the workshop is up',()=>{
  const X=outfit();
  const n={xu:{gear:2,maps:1},xuw:{k:'gear',u:3,s:NOW-1e6,d:NOW-1}};
  assert.equal(X.xuLv(n,'gear',NOW),3);assert.equal(X.xuLv(n,'maps',NOW),1);assert.equal(X.xuLv(n,'mules',NOW),0);
  assert.equal(X.xuLv({xu:{gear:2},xuw:{k:'gear',u:3,s:NOW,d:NOW+1}},'gear',NOW),2,'still in the workshop');
  assert.equal(X.xuLv({xu:{team:4}},'team',NOW),1,'never above the most');
  assert.equal(X.xuAll(n,NOW),4);
});

test('each block dearer and longer than the last',()=>{
  const X=outfit();
  for(const k of X.XU_KEYS.filter(k=>k!=='team'))for(let i=1;i<5;i++){
    const a=X.xuCost(k,i-1),b=X.xuCost(k,i);for(const r in a)assert.ok(b[r]>a[r],k+' '+i+' '+r);
    assert.ok(X.xuHours(k,i)>X.xuHours(k,i-1));}
  assert.deepEqual({...X.xuCost('gear',0)},{goods:16,iron:8});
  assert.deepEqual({...X.xuCost('gear',4)},{goods:72,iron:36});
  assert.deepEqual({...X.xuCost('team',0)},{goods:120,iron:40,food:60});assert.equal(X.xuHours('team',0),12);
});

test('trekking gear: +1 in more kinds of land with each block, and +1 more everywhere at gold',()=>{
  const X=outfit(),g=(L,t)=>X.xuGear({xu:{gear:L}},t);
  assert.deepEqual(['farmland','hills','forest','mountain','islet'].map(t=>g(1,t)),[1,1,0,0,0]);
  assert.deepEqual(['farmland','forest','marsh','mountain','arid'].map(t=>g(2,t)),[1,1,1,0,0]);
  assert.deepEqual(['mountain','arid','islet'].map(t=>g(4,t)),[1,1,1]);
  assert.deepEqual(['farmland','islet','mountain'].map(t=>g(5,t)),[2,2,2]);
  assert.equal(g(0,'farmland'),0);
});

test('mules, depots, rations and naturalists: small gains for each block',()=>{
  const X=outfit(),n=L=>({xu:{mules:L,depots:L,rations:L,nat:L}});
  assert.equal(X.xuTimeK(n(0)),1);assert.ok(Math.abs(X.xuTimeK(n(5))-0.7)<1e-9);
  assert.equal(X.xuReach(n(5)),15);
  assert.ok(Math.abs(X.xuCostK(n(5))-0.6)<1e-9);
  assert.ok(Math.abs(X.xuCurio(n(5))-0.3)<1e-9);
});

test('swift parties: faster, shorter rests, then a better roll',()=>{
  const X=outfit(),P=L=>({...X.xuParty({xu:{swift:L}})});
  assert.deepEqual(P(0),{t:1,cd:30*60000,roll:0});
  assert.deepEqual(P(1),{t:0.9,cd:30*60000,roll:0});
  assert.deepEqual(P(2),{t:0.9,cd:25*60000,roll:0});
  assert.deepEqual(P(4),{t:0.8,cd:20*60000,roll:0});
  assert.deepEqual(P(5),{t:0.8,cd:20*60000,roll:1});
});

test('the blocks in words',()=>{
  const X=outfit();
  assert.equal(X.xuLvText('maps',0),'pirate coves on your map');
  assert.equal(X.xuNowText({},'mules',3),'−18% journey time.');
  assert.equal(X.xuNowText({},'maps',2),'Shows pirate coves and petrified forests.');
  assert.equal(X.xuNowText({},'nat',0),'Nothing yet.');
  assert.match(X.xuNowText({},'gear',5),/, and \+1 more everywhere\.$/);
});

test('lost places: five kinds, each shown by its own block of Old maps, harder than any ordinary site',()=>{
  const X=outfit(),K=X.LOST_KINDS,ks=Object.keys(K);
  assert.deepEqual(ks,['cove','petrified','icecave','temple','observatory']);
  assert.deepEqual(ks.map(k=>K[k].lv),[1,2,3,4,5]);
  for(const k of ks){assert.ok(K[k].dc>=15,k);assert.equal(K[k].lost,1);assert.ok(K[k].b.length>0);}
  assert.match(source,/const SITE_KS=Object\.keys\(SITE_KINDS\)\.filter\(k=>!SITE_KINDS\[k\]\.lost\)/,'the Field Guide still counts the fourteen ordinary kinds');
});

test('the second team is kept private like the first, and named in the shared half only by where and when',()=>{
  const nx=shim.slice(shim.indexOf('var NX_KEYS'),shim.indexOf('function splitNation'));
  assert.match(nx,/'exp', 'exp2'/);
  assert.match(source,/COMMIT_HOOKS\.push\(\(n\)=>\{if\(!n\)return \[\];const L=\[n\.exp,n\.exp2\]\.filter\(Boolean\)\.map\(e=>\(\{s:e\.s,t:e\.t1\}\)\);/);
});
