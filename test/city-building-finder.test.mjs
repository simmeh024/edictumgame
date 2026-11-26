// Finding a building in any of your cities: the search over the Cities page. A nation can hold a couple of dozen
// auto-named cities, and the one Farm Estates still at grey while eleven are blue has to be findable without
// opening all twelve. The game's own code, evaluated piece by piece.
// Run with: node --test test/city-building-finder.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const cut=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>0&&b>a,`the game still has ${from}`);return source.slice(a,b);};
const DAY=864e5,NOW=1_800_000_000_000;
/* what the block declares, lifted onto the context: a vm script's const and function stay lexical */
const EXPORTS=['CXF_SHOW','CXF_QLEN','CXF_FILTERS','cxfFold','cxfTier','cxfCol','cxfLv','cxfLvWord','cxfPar','cxfCould','cxfRows','cxfName','cxfHay','cxfHit','cxfUpOn','cxfKeep','cxfSort','cxfFind'];
/* arrays made inside the context belong to its own realm, so they are copied before being compared */
const arr=x=>Array.from(x);

const CX_UG=[{c:'grey',r:'common'},{c:'green',r:'uncommon'},{c:'blue',r:'rare'},{c:'purple',r:'epic'},{c:'gold',r:'legendary'}];
const BUILDINGS={
  farm:{n:'Farm Estates',c:'prod',res:{food:[0.6,2]}},
  sawmill:{n:'Sawmill',c:'prod',res:{timber:[1,2]}},
  mine:{n:'Iron Mine',c:'prod',res:{iron:[0.75,1.1]},need:'hills'},
  factory:{n:'Factory',c:'prod',res:{goods:[0,6]}},
  harbour:{n:'Harbour',c:'prod',res:{food:[0,3]},need:'coast'},
  hospital:{n:'Hospital',c:'soc',growth:0.05},
  market:{n:'Market Hall',c:'soc',prosper:0.03},
  cathedral:{n:'Grand Cathedral',c:'won',w:1,prosper:0.04},
  palace:{n:'Palace',c:'lead',lead:3,prosper:0.01},
  digs:{n:'Institute of Field Archaeology',c:'soc',one:1}
};
const upgradable=k=>!!BUILDINGS[k]&&!BUILDINGS[k].w&&!BUILDINGS[k].lead&&!!(BUILDINGS[k].res||BUILDINGS[k].prosper||BUILDINGS[k].growth);

function load(over={}){
  const N=200;
  const ctx={
    CX_UG,CX_UG_MAX:CX_UG.length,BUILDINGS,
    BLD_CATS:[['prod','Production'],['soc','Society'],['def','Defence'],['won','Wonders'],['lead','Leadership']],
    TIER_ROMAN:['','I','II','III','IV','V'],
    fkAscii:s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,''),
    cxUgWord:u=>`${CX_UG[u-1].c} (${CX_UG[u-1].r})`,
    MAP:{T:new Array(N).fill(1)},
    IRON_DEP:new Array(N).fill(0),
    CELL_RES:{oil:new Array(N).fill(0)},
    isCoastal:c=>c<10,
    depOf:()=>({iron:0,oil:0,timber:0}),
    bldUnlocked:()=>true,
    bEff:(k,t)=>t>=2?{n:'Industrial Works'}:BUILDINGS[k],
    myId:()=>'me',
    cxOk:ct=>ct.active!==false&&!ct.occ,
    cxUpNow:ct=>ct.upNow||null,
    cxUpgradable:upgradable,
    cxUpProblem:()=>null,
    stockNow:()=>({food:99,timber:99,iron:99,oil:99,goods:99}),
    S:{nation:{name:'Testland',s:{sci:80}}}
  };
  Object.assign(ctx,over);
  vm.createContext(ctx);
  vm.runInContext(cut('/* cxf:logic */','/* cxf:ui */')+'\n'+EXPORTS.map(k=>`this.${k}=${k};`).join(''),ctx);
  for(const k of EXPORTS)assert(ctx[k]!==undefined,`the game still has ${k}`);
  return ctx;
}

/* a city as cityState hands it over: finished keys, work under way, and the upgrade maps */
let seq=0;
const city=(nm,o={})=>Object.assign({
  id:'c'+(++seq),c:o.cell===undefined?20:o.cell,nm,cap:!!o.cap,fid:o.fid||'me',npc:false,
  done:o.done||[],prog:o.prog||[],ug:o.ug||{},tr:o.tr||{},active:o.active!==false,occ:!!o.occ,hi:0,
  dist:o.dist||[o.cell===undefined?20:o.cell],rec:{id:'c'+seq,b:[]}
},o.extra||{});
/* twelve cities, each with the same four buildings, and one Farm Estates left at grey */
function twelve(){
  const names=['Ashby Reach','Fogsend','Mirkland','Hollowfell','Dunmoss','Gallowley','Sorrowby','Witherwick','Owlby Fell','Curlew Point','Mardle Isle','Thrushgill'];
  return names.map((nm,i)=>city(nm,{cap:i===0,cell:20+i,
    done:['farm','sawmill','market','hospital'],
    ug:{farm:nm==='Dunmoss'?1:4,sawmill:3,market:3,hospital:2}}));
}

test('a building’s level counts its tier, so a retooled one is never read as behind', () => {
  const G=load(),ct=city('Fogsend',{done:['factory'],ug:{factory:2},tr:{factory:{t:2,ln:'asm'}}});
  assert.equal(G.cxfTier(ct,'factory'),2);
  assert.equal(G.cxfCol(ct,'factory'),2,'the blocks it has inside its own tier');
  assert.equal(G.cxfLv(ct,'factory'),7,'five for the tier it left behind, and two of its own');
  const plain=city('Mirkland',{done:['factory'],ug:{factory:5}});
  assert.equal(G.cxfLv(plain,'factory'),5);
  assert(G.cxfLv(ct,'factory')>G.cxfLv(plain,'factory'),'tier II with blocks beats tier I at gold');
  const bare=city('Sorrowby',{done:['factory'],tr:{factory:{t:2,ln:'asm'}}});
  assert.equal(G.cxfLv(bare,'factory'),5,'tier II with no blocks is worth what gold was at tier I');
});

test('a level in words names its colour, and its tier where it has one', () => {
  const G=load();
  assert.equal(G.cxfLvWord(0),'no upgrades');
  assert.equal(G.cxfLvWord(1),'grey');
  assert.equal(G.cxfLvWord(3),'blue');
  assert.equal(G.cxfLvWord(5),'gold','tier I gold, not tier II at nothing');
  assert.equal(G.cxfLvWord(6),'tier II at grey');
  assert.equal(G.cxfLvWord(10),'tier II at gold');
});

test('the level most of your cities keep a kind at, the higher one where two tie', () => {
  const G=load();
  const par=G.cxfPar([
    city('A',{done:['farm'],ug:{farm:4}}),
    city('B',{done:['farm'],ug:{farm:4}}),
    city('C',{done:['farm'],ug:{farm:1}})
  ]);
  assert.deepEqual({...par.get('farm')},{lv:4,n:3});
  const tie=G.cxfPar([city('A',{done:['farm'],ug:{farm:2}}),city('B',{done:['farm'],ug:{farm:3}})]);
  assert.equal(tie.get('farm').lv,3,'two levels with one city each: the higher is the one to catch up to');
});

test('the one grey farm among twelve is the only one marked behind', () => {
  const G=load(),all=twelve(),rows=G.cxfRows({},all,NOW);
  const farms=rows.filter(r=>r.k==='farm'&&!r.gap);
  assert.equal(farms.length,12);
  const behind=farms.filter(r=>r.d>0);
  assert.equal(behind.length,1);
  assert.equal(behind[0].ct.nm,'Dunmoss');
  assert.equal(behind[0].d,3,'grey against the purple the other eleven keep');
  assert.equal(behind[0].par.lv,4);
  for(const r of rows.filter(r=>r.k!=='farm'))assert.equal(r.d,0,`${r.k} stands level everywhere`);
});

test('a city missing what its fellows have gets a row of its own, and the land is respected', () => {
  const G=load();
  const all=twelve();
  all[0].done=['farm','sawmill','market'];          /* Ashby Reach never built its Hospital */
  delete all[0].ug.hospital;
  all[1].done=all[1].done.concat('mine');           /* only one city has a mine: not yet a fixture */
  all[1].ug.mine=2;
  const rows=G.cxfRows({},all,NOW);
  const gaps=rows.filter(r=>r.gap);
  assert.deepEqual(arr(gaps.map(r=>r.ct.nm+':'+r.k)),['Ashby Reach:hospital'],
    'one gap: the city with no Hospital, since eleven of the others have one');
  assert.equal(gaps[0].par.n,11);
  assert(gaps[0].d>0,'a gap counts as behind');
  assert.equal(rows.filter(r=>r.gap&&r.k==='mine').length,0,'a kind only one other city has is not yet expected everywhere');
});

test('no gap row is offered where the land, the government or the nation forbids the building', () => {
  const G=load();
  const inland=city('Mirkland',{cell:50,done:['farm'],ug:{farm:2}});
  const coast=[city('A',{cell:1,done:['farm','harbour'],ug:{farm:2,harbour:2}}),city('B',{cell:2,done:['farm','harbour'],ug:{farm:2,harbour:2}})];
  const rows=G.cxfRows({},[inland].concat(coast),NOW);
  assert.equal(rows.filter(r=>r.gap&&r.k==='harbour').length,0,'a Harbour needs a coast');
  /* hills, a wonder, a leadership building and a one-per-nation building are all left out */
  const two=[city('A',{done:['mine','cathedral','palace','digs'],ug:{mine:2}}),city('B',{done:['mine','cathedral','palace','digs'],ug:{mine:2}})];
  const plain=city('C',{cell:60,done:['farm'],ug:{farm:1}});
  const r2=G.cxfRows({},[plain].concat(two),NOW).filter(r=>r.gap);
  assert.deepEqual(arr(r2.map(r=>r.k)),[],'no hills for a mine, and the rest are one to a nation or one kind of government');
  /* with hills in reach the mine is expected */
  const hilly=load();hilly.MAP.T[61]=4;
  const h=hilly.cxfRows({},[city('C',{cell:61,dist:[61],done:['farm'],ug:{farm:1}})].concat(two),NOW).filter(r=>r.gap);
  assert.deepEqual(arr(h.map(r=>r.k)),['mine']);
});

test('a captured or occupied city is read, but nothing is expected of it', () => {
  const G=load();
  const all=twelve();
  const taken=city('Brollingham',{fid:'them',done:['farm'],ug:{farm:1}});
  const held=city('Purl Cross',{occ:true,done:['farm'],ug:{farm:1}});
  const rows=G.cxfRows({},all.concat([taken,held]),NOW);
  assert(rows.some(r=>r.ct.nm==='Brollingham'&&r.k==='farm'),'a captured city’s buildings are still listed');
  assert.equal(rows.filter(r=>r.gap&&(r.ct.nm==='Brollingham'||r.ct.nm==='Purl Cross')).length,0,
    'no gap rows for a city you do not run');
  assert.equal(rows.find(r=>r.ct.nm==='Purl Cross').ok,false);
  /* its buildings cannot be upgraded while you hold it, so it is never put on the catch-up list */
  for(const r of rows.filter(r=>r.ct.nm==='Brollingham'||r.ct.nm==='Purl Cross'))assert.equal(r.d,0);
  assert.deepEqual(arr(G.cxfFind({},all.concat([taken,held]),NOW,'','behind').map(r=>r.ct.nm)),['Dunmoss'],
    'only Dunmoss, from the twelve you run: the two you merely hold are nobody’s to fix');
});

test('only the cities you run set the level the others are measured against', () => {
  const G=load();
  const mine=[city('A',{done:['farm'],ug:{farm:4}}),city('B',{done:['farm'],ug:{farm:4}})];
  const seized=[city('Brollingham',{fid:'them',done:['farm'],ug:{farm:1}}),city('Purl Cross',{fid:'them',done:['farm'],ug:{farm:1}}),city('Hymnsworth',{fid:'them',done:['farm'],ug:{farm:1}})];
  const par=G.cxfPar(mine.concat(seized));
  assert.equal(par.get('farm').lv,1,'counting every city, three greys outvote two purples');
  const rows=G.cxfRows({},mine.concat(seized),NOW);
  assert.equal(rows.find(r=>r.ct.nm==='A').par.lv,4,'but the rows measure against your own cities only');
  for(const r of rows)assert.equal(r.d,0,'so none of your own is called behind');
});

test('searching for your farms lists all twelve and puts the grey one first', () => {
  const G=load(),all=twelve();
  const out=G.cxfFind({},all,NOW,'farm','');
  assert.equal(out.length,12);
  assert.equal(out[0].ct.nm,'Dunmoss');
  assert(out.slice(1).every(r=>r.d===0));
  /* then by city name, so the rest read in a steady order */
  assert.deepEqual(arr(out.slice(1,3).map(r=>r.ct.nm)),['Ashby Reach','Curlew Point']);
});

test('the search hits a city, a colour, a group and a word for the state', () => {
  const G=load(),all=twelve();
  assert.deepEqual(arr(G.cxfFind({},all,NOW,'dunmoss','').map(r=>r.k).sort()),['farm','hospital','market','sawmill']);
  assert.deepEqual(arr(G.cxfFind({},all,NOW,'grey','').map(r=>r.ct.nm)),['Dunmoss'],'the only building standing at grey');
  assert.equal(G.cxfFind({},all,NOW,'society','').length,24,'Market Hall and Hospital in all twelve');
  assert.deepEqual(arr(G.cxfFind({},all,NOW,'behind','').map(r=>r.ct.nm)),['Dunmoss']);
  assert.deepEqual(arr(G.cxfFind({},all,NOW,'dunmoss farm','').map(r=>r.ct.nm)),['Dunmoss'],'every word has to match');
  assert.equal(G.cxfFind({},all,NOW,'colossus','').length,0);
  assert.equal(G.cxfFind({},all,NOW,'  FARM  ','').length,12,'case and spare spaces do not matter');
});

test('the chips keep what they say, and a colour means the blocks a building stands at', () => {
  const G=load(),all=twelve();
  all[0].done=['farm','sawmill','market'];delete all[0].ug.hospital;
  all[1].upNow={k:'market',s:NOW-1000,d:NOW+1000,c:'purple',w:'purple upgrade'};
  assert.deepEqual(arr(G.cxfFind({},all,NOW,'','behind').map(r=>r.ct.nm)),['Dunmoss','Ashby Reach'],
    'both are three behind, so they read by building: Farm Estates before Hospital');
  assert.deepEqual(arr(G.cxfFind({},all,NOW,'','none').map(r=>r.ct.nm+':'+r.k)),['Ashby Reach:hospital']);
  assert.deepEqual(arr(G.cxfFind({},all,NOW,'','wip').map(r=>r.ct.nm+':'+r.k)),['Fogsend:market']);
  assert.deepEqual(arr(G.cxfFind({},all,NOW,'','grey').map(r=>r.ct.nm)),['Dunmoss']);
  assert.equal(G.cxfFind({},all,NOW,'','blue').length,24,'twelve Sawmills and twelve Market Halls, the one being raised to purple included: it still stands at blue');
  assert.equal(G.cxfFind({},all,NOW,'','max').length,0,'nothing has all five');
  const maxed=load();const m=twelve();for(const ct of m)ct.ug.sawmill=5;
  assert.equal(maxed.cxfFind({},m,NOW,'','max').length,12);
});

test('“can upgrade now” asks the game’s own rule, and skips what is busy or finished', () => {
  const asked=[];
  const G=load({cxUpProblem:(n,ct,k)=>{asked.push(ct.nm+':'+k);return ct.nm==='Dunmoss'?'You need 4 timber more.':null;}});
  const all=twelve();
  for(const ct of all)ct.ug.sawmill=5;                 /* every Sawmill is done */
  all[1].upNow={k:'market',s:NOW-1,d:NOW+1,c:'purple',w:'purple upgrade'};
  const out=G.cxfFind({},all,NOW,'','ready');
  assert.equal(out.filter(r=>r.k==='sawmill').length,0,'all five done is not ready for a sixth');
  assert.equal(out.filter(r=>r.ct.nm==='Dunmoss').length,0,'short of materials is not ready');
  assert.equal(out.filter(r=>r.ct.nm==='Fogsend'&&r.k==='market').length,0,'the builders are already on it');
  assert(out.length>0&&out.every(r=>!r.gap&&!r.wip),'what is left is standing and upgradable');
  assert(asked.every(x=>!/sawmill/.test(x)),'the rule is not asked about a building with nothing left to fit');
});

test('a building still going up is listed as such and never counted behind', () => {
  const G=load(),all=twelve();
  all[2].done=['farm','sawmill','market'];delete all[2].ug.hospital;
  all[2].prog=[{k:'hospital',s:NOW-DAY,d:NOW+DAY}];
  const rows=G.cxfRows({},all,NOW);
  const r=rows.find(x=>x.ct.nm==='Mirkland'&&x.k==='hospital');
  assert(r&&r.wip,'the one under way');
  assert.equal(r.d,0);
  assert.equal(r.col,0);
  assert.equal(rows.filter(x=>x.gap&&x.ct.nm==='Mirkland'&&x.k==='hospital').length,0,'no gap row for what is already going up');
});

test('wonders and leadership buildings are listed, and never read as behind each other', () => {
  const G=load();
  const all=[city('A',{done:['farm','cathedral','palace'],ug:{farm:2}}),city('B',{done:['farm'],ug:{farm:2}}),city('C',{done:['farm'],ug:{farm:2}})];
  const rows=G.cxfRows({},all,NOW);
  const w=rows.find(r=>r.k==='cathedral');
  assert(w,'the wonder is listed where it stands');
  assert.equal(w.d,0);
  assert.equal(rows.filter(r=>r.gap).length,0,'nobody is told to build a second cathedral or a palace');
  assert.deepEqual(arr(G.cxfFind({},all,NOW,'wonder','').map(r=>r.k)),['cathedral']);
});

test('a retooled building goes by its line’s name, and can be found by its tier', () => {
  const G=load();
  const all=[city('A',{done:['factory'],ug:{factory:2},tr:{factory:{t:2,ln:'asm'}}}),city('B',{done:['factory'],ug:{factory:4}}),city('C',{done:['factory'],ug:{factory:4}})];
  const rows=G.cxfRows({},all,NOW);
  assert.equal(G.cxfName(rows[0]),'Industrial Works');
  assert.deepEqual(arr(G.cxfFind({},all,NOW,'industrial','').map(r=>r.ct.nm)),['A']);
  assert.deepEqual(arr(G.cxfFind({},all,NOW,'tier ii','').map(r=>r.ct.nm)),['A']);
  assert.deepEqual(arr(G.cxfFind({},all,NOW,'factory','').map(r=>r.ct.nm)),['B','C','A'],
    'still found by the plain name, and the retooled one reads last under its own');
});

/* the Upgrade button on a row calls the city's own cxUpgrade; searching and listing stay a read */
test('searching changes nothing: listing touches no record and spends nothing', () => {
  const G=load();
  const all=twelve();
  const before=JSON.stringify(all.map(ct=>({done:ct.done,prog:ct.prog,ug:ct.ug,tr:ct.tr,rec:ct.rec})));
  const nation=JSON.stringify(G.S.nation);
  for(const f of ['','behind','ready','none','wip','max','grey','gold'])G.cxfFind({},all,NOW,'farm hospital market',f);
  G.cxfFind({},all,NOW,'','');
  assert.equal(JSON.stringify(all.map(ct=>({done:ct.done,prog:ct.prog,ug:ct.ug,tr:ct.tr,rec:ct.rec}))),before);
  assert.equal(JSON.stringify(G.S.nation),nation);
  assert.equal(typeof G.cxfFind,'function');
  for(const k of ['cxfRows','cxfPar','cxfFind','cxfKeep','cxfHay','cxfUpOn','cxfSort','cxfCould'])
    assert(!/\b(commit|cxPay|clone|cxUpgrade)\s*\(/.test(String(G[k])),`${k} does not write`);
});

test('a row carries its own Upgrade button only where that upgrade could be started', () => {
  const G=load();
  const ct=city('Dunmoss',{done:['farm','cathedral'],ug:{farm:1}});
  const rows=G.cxfRows({},[ct,city('B',{done:['farm','cathedral'],ug:{farm:4}}),city('C',{done:['farm','cathedral'],ug:{farm:4}})],NOW);
  const of=(nm,k)=>rows.find(r=>r.ct.nm===nm&&r.k===k);
  assert.equal(G.cxfUpOn(of('Dunmoss','farm')),true,'yours, standing, upgradable, blocks left');
  assert.equal(G.cxfUpOn(of('Dunmoss','cathedral')),false,'a wonder takes no upgrades');
  /* every other state it must keep its hands off */
  const maxed=G.cxfRows({},[city('A',{done:['farm'],ug:{farm:5}}),city('B',{done:['farm'],ug:{farm:5}})],NOW);
  assert.equal(G.cxfUpOn(maxed[0]),false,'all five done');
  const busy=city('Busy',{done:['farm'],ug:{farm:2}});
  busy.upNow={k:'farm',s:NOW-1,d:NOW+1,c:'blue',w:'blue upgrade'};
  assert.equal(G.cxfUpOn(G.cxfRows({},[busy,city('B',{done:['farm'],ug:{farm:2}})],NOW)[0]),false,'the builders are on it already');
  const going=city('Going',{prog:[{k:'farm',s:NOW-DAY,d:NOW+DAY}]});
  assert.equal(G.cxfUpOn(G.cxfRows({},[going],NOW)[0]),false,'it is still going up');
  const taken=G.cxfRows({},[city('A',{done:['farm'],ug:{farm:4}}),city('B',{done:['farm'],ug:{farm:4}}),city('Brollingham',{fid:'them',done:['farm'],ug:{farm:1}}),city('Held',{occ:true,done:['farm'],ug:{farm:1}})],NOW);
  for(const nm of ['Brollingham','Held'])assert.equal(G.cxfUpOn(taken.find(r=>r.ct.nm===nm)),false,`${nm} is not yours to upgrade`);
  /* and a gap has nothing standing to upgrade */
  assert.equal(taken.filter(r=>r.gap).every(r=>!G.cxfUpOn(r)),true);
});

test('“can upgrade now” is that same rule plus the game’s own price check', () => {
  const asked=[];
  const G=load({cxUpProblem:(n,ct,k)=>{asked.push(ct.nm+':'+k);return ct.nm==='Dunmoss'?'You need 4 timber more.':null;}});
  const all=twelve();
  const rows=G.cxfRows({},all,NOW);
  const ready=G.cxfFind({},all,NOW,'','ready');
  /* the chip keeps exactly the rows that carry a button and have no problem */
  const want=rows.filter(r=>G.cxfUpOn(r)&&r.ct.nm!=='Dunmoss');
  assert.equal(ready.length,want.length);
  assert.equal(ready.some(r=>r.ct.nm==='Dunmoss'),false,'short of materials: the button is there but disabled, and the chip drops it');
  assert.equal(asked.every(x=>rows.some(r=>G.cxfUpOn(r)&&r.ct.nm+':'+r.k===x)),true,
    'the game’s rule is asked only about rows that could carry a button');
});

test('the search is capped, and the chips are the ones the page draws', () => {
  const G=load();
  assert.equal(G.CXF_SHOW,40);
  assert(G.CXF_QLEN>=24&&G.CXF_QLEN<=120);
  assert.deepEqual(arr(G.CXF_FILTERS.map(x=>x[0])),['behind','ready','wip','none','max']);
  for(const [,l] of G.CXF_FILTERS)assert(/^[A-Z]/.test(l),`"${l}" reads as a label`);
});
