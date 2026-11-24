// City population thresholds and the next-city messages, including the land fallback once population
// unlocks run out. The schedule below 100 million and the other growth rewards must stay unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('no function ' + name);
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
const line = start => { const at = html.indexOf(start); if (at < 0) throw new Error('missing ' + start); return html.slice(at, html.indexOf('\n', at)); };
const miles = html.slice(html.indexOf('const MILESTONES=['), html.indexOf('];', html.indexOf('const MILESTONES=[')) + 2);
const cities = html.slice(html.indexOf('const CITY_POP_AT=['), html.indexOf('];', html.indexOf('const CITY_POP_AT=[')) + 2);

const ctx = vm.createContext({S:{nation:null},myArea:T=>T.area,cityBonusOpen:n=>!!n.bonus,cityGoldOpen:n=>!!n.gold});
vm.runInContext(`${cities} ${line('const CITY_DISTRICT=')} ${miles}
  ${html.match(/MILESTONES.push\([\s\S]*?\n\);/)[0]}
  ${line('const fmtPopShort=')} ${line('const AREA_CITY_AT=')} ${line('const areaCities=')} ${line('const nextAreaCity=')}
  function popNow(n){return n.pop;}
  function mileCredit(n,i){return MILESTONES[i]?.c||0;}
  ${fn('milesReached')} ${fn('mileOf')} ${fn('maxCities')} ${fn('growthMilestones')}
  ${fn('nextCityAt')} ${fn('nextCityWhen')}
  this.when=nextCityWhen;this.next=nextCityAt;this.allow=n=>mileOf(n).cities;
  this.schedule=CITY_POP_AT;this.milestones=MILESTONES;this.display=growthMilestones;
  this.limits={population:MILE_CITIES,total:MAX_CITIES};`, ctx);
const M = 1e6;

test('people, land, or both, whichever is still ahead', () => {
  assert.equal(ctx.when({ pop: 150 }, 1.5 * M), '200 million people or 2 million km² of land');
  assert.equal(ctx.when({ pop: 250 }, 1.5 * M), '275 million people or 2 million km² of land');
  assert.equal(ctx.when({ pop: 150 }, 150 * M), '200 million people', 'past 100M km² only people are left');
  assert.equal(ctx.when({ pop: 1e9 }, 1.5 * M), '2 million km² of land', 'land remains after the final population step');
  assert.equal(ctx.when({ pop: 1e9 }, 150 * M), '', 'nothing is left');
});

test('the short form for the city list button', () => {
  assert.equal(ctx.when({ pop: 150 }, 1.5 * M, true), '200 million people');
  assert.equal(ctx.when({ pop: 250 }, 25 * M, true), '275 million people');
  assert.equal(ctx.when({ pop: 1e9 }, 25 * M, true), '30 million km²');
  assert.equal(ctx.when({ pop: 1e9 }, 150 * M, true), '');
});

test('each requested threshold opens exactly one city, with the early thresholds preserved', () => {
  const expected=[7,8.5,12.5,25,50,75,100,110,115,125,150,200,225,250,275,300,325,350,400,450,500,550,600,650,700,800,900,
    ...[1,1.25,1.5,2,2.5,3,4,5,6,7,8,9,10,12,14,16,18,20,25,30,40,50,100,200,300,500,1000].map(t=>t*1e6)];
  assert.deepEqual(Array.from(ctx.schedule),expected);
  assert.equal(ctx.allow({pop:5}),1);
  for(const [i,p] of expected.entries()){
    assert.equal(ctx.next({pop:p-0.00001}),p,`next city just below ${p} million`);
    assert.equal(ctx.allow({pop:p-0.00001}),i+1,`locked just below ${p} million`);
    assert.equal(ctx.allow({pop:p}),i+2,`unlocked at ${p} million`);
    assert.equal(ctx.next({pop:p}),expected[i+1]??null,`next step after ${p} million`);
  }
  assert.equal(ctx.next({pop:900}),1e6,'the next step is 1 trillion, as requested');
  assert.equal(ctx.when({pop:1e6},150*M,true),'1.25 trillion people');
  assert.equal(ctx.when({pop:500e6},150*M,true),'1000 trillion people');
});

test('all city unlocks fit alongside the existing land and building bonuses', () => {
  assert.equal(ctx.limits.population,55);
  assert.equal(ctx.limits.total,76);
  ctx.S.nation={pop:1e9,bonus:true,gold:true};
  assert.equal(ctx.maxCities({area:100*M},0),76);
  ctx.S.nation={pop:900,bonus:false,gold:false};
  assert.equal(ctx.maxCities({area:0},0),28,'the former population cap no longer cuts off new cities');
});

test('growth displays city-only steps without changing saved reward milestone indices', () => {
  const original=Array.from(ctx.milestones,m=>m.p);
  const display=Array.from(ctx.display(),m=>m.p);
  assert.deepEqual(original,[5,6,7,8.5,10,12.5,15,20,25,35,50,75,100,200,500,1000,1500,2000,3500,5000,10000,20000,35000,50000,100000,200000,350000,500000,1000000]);
  assert.equal(ctx.milestones[12].t,'Superpower');
  assert.equal(ctx.milestones[12].c,10);
  assert.equal(ctx.milestones[13].c,12);
  assert.ok(display.includes(110)&&display.includes(1250000)&&display.includes(1e9));
  assert.deepEqual(display,Array.from(new Set(display)).sort((a,b)=>a-b));
  assert.deepEqual(Array.from(ctx.milestones,m=>m.p),original,'display does not mutate saved indices');
});

test('the save adapter preserves populations beyond ten trillion through the final city milestone', () => {
  const shim=fs.readFileSync(new URL('../src/shim.js',import.meta.url),'utf8');
  const encode=shim.slice(shim.indexOf('  function encode('),shim.indexOf('  function revision('));
  const g=vm.createContext({MAX_JSON:1e6,isObj:v=>v&&typeof v==='object',str:(v,n)=>String(v??'').slice(0,n),
    num:v=>Number.isFinite(v)?v:0,serverTime:()=>0,mapVer:()=>0,mapError:e=>new Error(e.message)});
  vm.runInContext(encode,g);
  for(const pop of [1e6,1.25e6,1e7,14e6,100e6,1e9]){
    const saved=g.encode('nations',{name:'Cityland',pop});
    assert.equal(saved.pop,pop,'headline population stays at '+pop+' million');
    assert.equal(JSON.parse(saved.j).pop,pop,'record agrees with the headline');
  }
});

test('no text still formats nextCityAt on its own', () => {
  assert.doesNotMatch(html, /fmtPopShort\(nextCityAt\(/);
  assert.equal(html.split('nextCityWhen(S.nation,myArea(T,mi))?` The next one unlocks at').length - 1, 2, 'cityProblem and the empty card');
  assert.match(html, /nextCityWhen\(n,myArea\(T,mi\),true\)\?`Next at \$\{nextCityWhen\(n,myArea\(T,mi\),true\)\}`:'No room for another'/);
  assert.match(html, /nextCityWhen\(S\.nation,myArea\(T,mi\)\)\?'No room for another city yet':'No room for another city'/);
});

// A nation's first building and its first gold upgrade each open one more city, on top of people and land
test('the first gold upgrade opens one more city, for good', () => {
  const g = vm.createContext({ tallyOf: (n, k) => (n.tly && n.tly[k]) || 0, cityList: n => n.cities || [], DAY: 864e5, paidClean: () => null, cxUpList: () => ({}) });
  vm.runInContext(fn('cxBldExtras') + '\n' + fn('cityGoldKept') + '\n' + fn('cityGoldOpen') + '\nthis.open=cityGoldOpen;this.kept=cityGoldKept;', g);
  const city = (...b) => ({ b }), now = Date.now();
  assert.equal(g.open({ cities: [city({ k: 'farm' }, { k: 'mine', ug: 4 })] }), false, 'purple is not gold');
  assert.equal(g.open({ cities: [city({ k: 'farm', ug: 5 })] }), true, 'a gold building standing now');
  assert.equal(g.open({ cities: [city({ k: 'farm', ug: 4, uu: { u: 5, s: now - 3600e3, d: now + 3600e3 } })] }), false, 'not while the gold block is still being fitted');
  const due = { cities: [city({ k: 'farm', ug: 4, uu: { u: 5, s: now - 3600e3, d: now - 1000 } })] };
  assert.equal(g.open(due), true, 'a gold block whose time is up counts before the save that writes it');
  assert.equal(g.kept(due), false, 'but is not yet on record, so that save can say it is the first');
  assert.equal(g.open({ cities: [city({ k: 'farm', ug: 3, uu: { u: 4, s: now - 3600e3, d: now - 1000 } })] }), false, 'a purple block that is due is not gold');
  assert.equal(g.open({ cities: [city({ k: 'farm', lv: 3 })] }), true, 'an old level 3 reads as gold');
  assert.equal(g.open({ cities: [city({ k: 'farm', lv: 2 })] }), false);
  assert.equal(g.open({ cities: [city()], ach: { 'land-cxlv3': 1 } }), true, 'the achievement, after the building is gone');
  assert.equal(g.open({ cities: [], tly: { 'log:bgold': 1 } }), true, 'the tally of gold upgrades finished');
  assert.equal(g.open({ npc: 1, cities: [city({ k: 'farm', ug: 5 })] }), false, 'computer nations have none');
  assert.equal(g.open(null), false);
  assert.match(html, /function maxCities\(T,i\)\{return Math\.min\(MAX_CITIES,mileOf\(S\.nation\)\.cities\+areaCities\(myArea\(T,i\)\)\+\(cityBonusOpen\(S\.nation\)\?1:0\)\+\(cityGoldOpen\(S\.nation\)\?1:0\)\);\}/);
  assert.equal(html.split('${cityGoldHint(S.nation)}').length - 1, 2, 'both messages at the limit name it while it is still ahead');
  assert.match(html, /hadGold=cityGoldKept\(old\);let newGold=false;/, 'the save that finishes the first one judges it on the record before');
  assert.match(html, /if\(newGold&&!hadGold\)out\.push\(/, 'and says so');
});
