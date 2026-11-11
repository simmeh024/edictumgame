// What a building gives in one city, in amounts a day: its share of the land's yield plus a fixed amount, times its
// upgrades and the city's mood; its upkeep; and the later buildings' own effects. Shown on the city's building rows
// ("Here: …") and in the Build tab ("In <city>: …"). The game's own code, evaluated piece by piece.
// Run with: node --test test/building-gains.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const cut=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>0&&b>a,`the game still has ${from}`);return source.slice(a,b);};
const line=start=>{const a=source.indexOf(start);assert(a>0,`the game still has ${start}`);return source.slice(a,source.indexOf('\n',a)+1);};

/* a small map: cells 0–9; oil on 0–2 (1 each), food on 0–4 (1 each), timber on 5–9 (2 each) */
const N=10,arr=f=>Float64Array.from({length:N},(_,c)=>f(c));
const CELL_RES={food:arr(c=>c<5?1:0),timber:arr(c=>c>=5?2:0),iron:arr(()=>0),oil:arr(c=>c<3?1:0),goods:arr(()=>0)};
function load(){
  const ctx={CELL_RES,RES_INFO:{food:['Food'],timber:['Timber'],iron:['Iron'],oil:['Oil'],goods:['Goods']},
    BUILDINGS:{
      farm:{n:'Farm Estates',res:{food:[0.6,2]}},oilwell:{n:'Oil Wells',res:{oil:[1.5,0]}},factory:{n:'Factory',res:{goods:[0,6]},up:{oil:1}},
      housing:{n:'Housing Estates',growth:0.08,up:{food:1}},market:{n:'Market Hall',prosper:0.03},recycle:{n:'Recycling Works',up:{goods:0.5}},
      reserve:{n:'Nature Reserve'},court:{n:'Courthouse',up:{goods:1}},palace:{n:'Royal Palace',lead:'mon',res:{goods:[0,2]}},gardens:{n:'Hanging Gardens',w:1,res:{food:[0,4]}},
      rail:{n:'Railway Station',res:{timber:[0.4,0],iron:[0.4,0],oil:[0.4,0],goods:[0,1]}},power:{n:'Power Station',res:{goods:[0,7]},up:{oil:1,iron:1}}},
    ldrOf:n=>(n&&n.gov)||[],list:a=>a.length<2?a.join(''):a.slice(0,-1).join(', ')+' and '+a[a.length-1],esc:s=>String(s)};
  vm.createContext(ctx);
  vm.runInContext([
    line('const resName='),line('const fmtAmt='),
    cut('const CX_UG=[','const CX_WALL=').replace(/\nconst CX_WALL=[\s\S]*$/,''),
    line('const CX_BANDS='),line('function cxBand('),
    cut('/* ── what a building gives in one city','function bldRow(')
  ].join('\n')+'\nthis.CX_LV=CX_LV;',ctx);
  return ctx;
}
const G=load();
const nation=(o={})=>({id:'me',n:{policies:o.pol||{},gov:o.gov||[]}});
/* cities as cityState builds them: active, held by nation 0, a district of cells, finished buildings, upgrades, mood */
const city=(o={})=>({id:o.id||'c1',nm:o.nm||'Ashford',active:o.active??true,hi:0,dist:o.dist||[0,1,2,3,4],done:o.done||[],prog:[],ug:o.ug||{},mk:o.mk??1,mood:o.mood??60});
const world=(cities,o)=>{const T={list:[nation(o)]};G.territory=()=>T;G.cityState=()=>({all:cities});return T;};

test('Oil Wells: 150% of the oil from the city’s land, in barrels a day',()=>{
  const ct=city({done:['oilwell']}),T=world([ct]);
  const g=G.bldGain(ct,'oilwell',T);
  assert.equal(g.res[0].land,3);assert.equal(g.res[0].v,4.5);
  assert.equal(G.bldGainHtml(ct,'oilwell',T,'Here'),'<span class="bld-gain">Here: <b>+4.5 oil</b> a day<span class="bld-gw"> (150% of the 3 oil from its land)</span>.</span>');
});

test('upgrades and mood raise what it makes; the words say by how much',()=>{
  const ct=city({done:['farm'],ug:{farm:5},mk:1.1,mood:80}),T=world([ct]);
  assert.equal(G.CX_LV[5],2);
  assert.equal(Math.round(G.bldGain(ct,'farm',T).res[0].v*100)/100,11,'(60% of 5 + 2) × 2 × 1.1');
  const h=G.bldGainHtml(ct,'farm',T,'Here');
  assert.match(h,/<b>\+11 food<\/b> a day/);
  assert.match(h,/60% of the 5 food from its land, plus 2; \+100% for its upgrades; \+10% while the city is thriving/);
  const sad=city({done:['farm'],mk:0.85,mood:10});world([sad]);
  assert.match(G.bldGainHtml(sad,'farm',undefined,'Here'),/−15% while the city is restless/);
});

test('a building not yet in the city: no upgrades, the same land',()=>{
  const ct=city({done:[]}),T=world([ct]);
  assert.equal(G.bldGain(ct,'oilwell',T).res[0].v,4.5);
  assert.match(G.bldGainHtml(ct,'oilwell',T,'In Ashford'),/^<span class="bld-gain">In Ashford: <b>\+4\.5 oil<\/b> a day/);
  const dry=city({dist:[5,6]});world([dry]);
  assert.match(G.bldGainHtml(dry,'oilwell',undefined,'Here'),/<b>\+0 oil<\/b> a day<span class="bld-gw"> \(150% of the 0 oil from its land\)/,'no oil, so nothing');
});

test('upkeep: the first Factory runs without oil, the next one uses it',()=>{
  const a=city({id:'a',done:['factory']}),b=city({id:'b',nm:'Brack',done:['factory']}),T=world([a,b]);
  assert.match(G.bldGainHtml(a,'factory',T,'Here'),/<b>\+6 goods<\/b> a day; uses no oil \(your first Factory runs without it\)\./);
  assert.match(G.bldGainHtml(b,'factory',T,'Here'),/<b>\+6 goods<\/b> a day; uses 1 oil a day\./);
  const c=city({id:'c',done:[]});world([c]);
  assert.equal(G.bldFreeFactory(c,undefined),true,'a first Factory still to build would run free');
  world([a,c]);assert.equal(G.bldFreeFactory(c,undefined),false);
});

test('upkeep alone is said only when it differs from the description',()=>{
  const ct=city({done:['housing']}),T=world([ct]);
  assert.equal(G.bldGainHtml(ct,'housing',T,'Here'),'','plain Housing Estates: the description already says 1 food');
  const up=city({done:['housing'],ug:{housing:1}});world([up]);
  assert.equal(G.bldGainHtml(up,'housing',undefined,'Here'),'<span class="bld-gain">Here: uses 1.1 food a day.</span>');
  assert.equal(G.bldGainHtml(ct,'market',T,'Here'),'','nothing made, nothing used');
});

test('the later buildings’ own effects, and the policies that change them',()=>{
  const ct=city({done:['factory','recycle'],dist:[0,1,5,6]}),T=world([ct],{pol:{recycleSort:1,courtFees:1,gardensAqueduct:1}});
  assert.match(G.bldGainHtml(ct,'recycle',T,'Here'),/saves 0\.6 oil a day of the city’s upkeep/);
  assert.match(G.bldGainHtml(ct,'reserve',T,'In Ashford'),/leaves 1 timber a day standing/,'25% of 4 timber, 15% with logging allowed');
  assert.match(G.bldGainHtml(ct,'court',T,'Here'),/uses no goods \(court fees pay for it\)/);
  assert.equal(G.bldGain(ct,'gardens',T).res[0].v,5,'the aqueduct adds a food');
});

test('nothing for a dormant leadership building or a city that is not working',()=>{
  const ct=city({done:['palace']}),T=world([ct]);
  assert.equal(G.bldGainHtml(ct,'palace',T,'Here'),'');
  world([ct],{gov:['mon']});assert.match(G.bldGainHtml(ct,'palace',undefined,'Here'),/<b>\+2 goods<\/b> a day/);
  assert.equal(G.bldGain(city({active:false}),'farm',T),null);
});

test('several resources at one percentage read as one phrase; upkeep as one amount a day',()=>{
  const ct=city({dist:[0,1,5,6]}),T=world([ct]);
  assert.equal(G.bldGainHtml(ct,'rail',T,'Here'),'<span class="bld-gain">Here: <b>+1.6 timber, +0 iron, +0.8 oil and +1 goods</b> a day<span class="bld-gw"> (40% of the 4 timber, 0 iron and 2 oil from its land)</span>.</span>');
  assert.equal(G.bldGainHtml(ct,'power',T,'Here'),'<span class="bld-gain">Here: <b>+7 goods</b> a day; uses 1 oil and 1 iron a day.</span>');
});

test('the rows and the Build tab show it',()=>{
  assert.match(cut('function bldRow(','function catalog('),/bldGainHtml\(ct,k,ct\.tT,'Here'\)/);
  assert.match(cut('function catalog(','function foundCityForm('),/bldGainHtml\(ct,k,ct\.tT,'In '\+ct\.nm\)/);
});
