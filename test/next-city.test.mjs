// What unlocks the next city (game/edictum.html, nextCityWhen; bug run item 65). Past 200 million people no
// population step adds a city, so nextCityAt is null, but land can still add some. Three texts then said
// "Next at null million people". They name only the steps still ahead now.
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

const ctx = vm.createContext({});
vm.runInContext(`${miles} ${line('const fmtPopShort=')} ${line('const AREA_CITY_AT=')} ${line('const nextAreaCity=')}
  function popNow(n){return n.pop;}
  ${fn('nextCityAt')} ${fn('nextCityWhen')} this.when=nextCityWhen;`, ctx);
const M = 1e6;

test('people, land, or both, whichever is still ahead', () => {
  assert.equal(ctx.when({ pop: 150 }, 1.5 * M), '200 million people or 2 million km² of land');
  assert.equal(ctx.when({ pop: 250 }, 1.5 * M), '2 million km² of land', 'past 200M only land is left');
  assert.equal(ctx.when({ pop: 150 }, 150 * M), '200 million people', 'past 100M km² only people are left');
  assert.equal(ctx.when({ pop: 250 }, 150 * M), '', 'nothing is left');
});

test('the short form for the city list button', () => {
  assert.equal(ctx.when({ pop: 150 }, 1.5 * M, true), '200 million people');
  assert.equal(ctx.when({ pop: 250 }, 25 * M, true), '30 million km²');
  assert.equal(ctx.when({ pop: 250 }, 150 * M, true), '');
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
