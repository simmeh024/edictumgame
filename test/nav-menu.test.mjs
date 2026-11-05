// The player's own menu (n.nav): what navNorm keeps of a saved layout, how navLayout files pages (a page the layout
// does not name joins its usual group), what navShown hides, and how the phone tab bar fills its four places.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const json = v => JSON.parse(JSON.stringify(v));
const DEF = [
  { k: 'nation', l: 'Your nation', items: [['nation', 'Nation'], ['issues', 'Edicts'], ['cities', 'Cities']] },
  { k: 'land', l: 'Land and space', items: [['map', 'Map'], ['space', 'Space']] },
  { k: 'abroad', l: 'Abroad', items: [['region', 'Region'], ['trade', 'Trade']] },
  { k: 'other', l: 'Other', items: [['shop', 'Shop'], ['chronicle', 'National Chronicle']] },
  { k: 'opts', l: 'Options', items: [['settings', 'Settings'], ['help', 'Help']] }];
function load(nav, view = 'nation') {
  const S = { nation: nav === undefined ? { name: 'Testland' } : { name: 'Testland', nav }, view };
  const hooks = [];
  const ctx = vm.createContext({ S, NORM_HOOKS: hooks, NAV_TABS: ['nation', 'issues', 'map', 'region'], navCur: () => S.view, WeakMap, JSON, Object, Set, Array });
  const a = src.indexOf('const NAV_LOCK='), b = src.indexOf('}\n', src.indexOf('function navCls()')) + 1;
  assert(a > 0 && b > a);
  /* navGroups as the game has it: the usual groups laid out by navLayout, empty groups dropped */
  vm.runInContext(src.slice(a, b) + `\nfunction navGroups(){return navLayout(${JSON.stringify(DEF)}).filter(g=>g.items.length);}`, ctx);
  return { c: ctx, S, hooks };
}
const keys = g => json(g.map(x => x.k + ':' + x.items.map(i => i[0]).join(',')));

test('a saved layout keeps only what it may: known styles, sound keys and pages, never a hidden Nation or Settings', () => {
  const { c } = load();
  assert.equal(c.navNorm(null), null);
  assert.equal(c.navNorm([1, 2]), null);
  assert.equal(c.navNorm({ s: 'zzz', h: 1, evil: { a: 1 } }), null);
  const p = c.navNorm({ s: 'i', h: 0, x: ['nation', 'settings', 'space', 'space', 'Bad Page', 7], t: 'map,map,messages,<b>,region,nation,help',
    o: JSON.stringify([['opts', '  Tools   and  more  ', ['settings', 'help']], ['junk!', 'x', ['zzz']], ['opts', 'dup', []], ['c1', 'A name far longer than twenty-four letters', ['help', 'map', 'map', 9]]]) });
  assert.equal(p.s, 'i'); assert.equal(p.h, 0);
  assert.deepEqual(json(p.x), ['space']);
  assert.equal(p.t, 'map,messages,region,nation');
  assert.deepEqual(JSON.parse(p.o), [['opts', 'Tools and more', ['settings', 'help']], ['c1', 'A name far longer than t', ['map']]]);
  assert.equal(c.navNorm({ o: 'not json' }), null);
  assert.equal(c.navNorm({ o: 'x'.repeat(5000) }), null);
});
test('normalize keeps the menu through its hook, cleaned', () => {
  const { hooks } = load(), n = {};
  assert.equal(hooks.length, 1);
  hooks[0](n, { nav: { s: 'l', x: ['nation', 'map'] } });
  assert.deepEqual(json(n.nav), { s: 'l', x: ['map'] });
  const m = {}; hooks[0](m, {}); assert.equal('nav' in m, false);
});
test('without a saved menu the usual groups come back unchanged', () => {
  const { c } = load();
  assert.deepEqual(keys(c.navGroups()), keys(DEF));
  assert.equal(c.navCls(), '');
});
test('a layout orders groups and pages, keeps its own names, and files a page it does not name in its usual group', () => {
  const { c } = load({ o: JSON.stringify([['opts', 'Tools', ['help', 'settings']], ['c1', 'Daily', ['map', 'issues']], ['nation', '', ['cities', 'nation']], ['other', '', ['shop']]]) });
  const g = c.navGroups();
  /* space, region and trade are in no group the layout names (land and abroad are gone): Other takes them */
  assert.deepEqual(keys(g), ['opts:help,settings', 'c1:map,issues', 'nation:cities,nation', 'other:shop,space,region,trade,chronicle']);
  assert.deepEqual(json(g.map(x => x.l)), ['Tools', 'Daily', 'Your nation', 'Other']);
  const { c: c2 } = load({ o: JSON.stringify([['nation', '', ['nation']], ['other', '', []]]) });
  assert.deepEqual(keys(c2.navGroups()), ['nation:nation,issues,cities', 'other:map,space,region,trade,shop,chronicle,settings,help']);
  /* and with no Other either, the last group */
  const { c: c3 } = load({ o: JSON.stringify([['c1', 'Mine', ['help']], ['c2', 'Rest', []]]) });
  assert.equal(keys(c3.navGroups()).at(-1).startsWith('c2:'), true);
});
test('hidden pages leave the menu but not the page list, and the open page always shows', () => {
  const { c, S } = load({ x: ['space', 'trade', 'region'] });
  assert.deepEqual(keys(c.navShown()), ['nation:nation,issues,cities', 'land:map', 'other:shop,chronicle', 'opts:settings,help']);
  assert.equal(keys(c.navGroups()).join().includes('space'), true);
  S.view = 'trade';
  assert.deepEqual(keys(c.navShown())[2], 'abroad:trade');
});
test('the tab bar keeps the player’s four, skips hidden ones and fills from the usual four', () => {
  const vis = { nation: 1, issues: 1, map: 1, region: 1, trade: 1, help: 1 };
  assert.deepEqual(json(load().c.navTabList(vis)), ['nation', 'issues', 'map', 'region']);
  assert.deepEqual(json(load({ t: 'trade,help' }).c.navTabList(vis)), ['trade', 'help', 'nation', 'issues']);
  assert.deepEqual(json(load({ t: 'trade,map,help,nation', x: ['map'] }).c.navTabList(vis)), ['trade', 'help', 'nation', 'issues']);
  assert.deepEqual(json(load({ t: 'gone,trade' }).c.navTabList(vis)), ['trade', 'nation', 'issues', 'map']);
});
test('the style and headings reach the shell as classes', () => {
  assert.equal(load({ s: 'i' }).c.navCls(), ' nav-rail');
  assert.equal(load({ s: 'l', h: 0 }).c.navCls(), ' nav-noic nav-flat');
});
