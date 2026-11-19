// Customise around the Studios (19 Nov 2026): every section is in one of the four groups and has an address,
// Finery is gone, and Match my flag picks the nearest colour it may.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const grab = (re, what) => { const m = re.exec(html); assert.ok(m, what + ' is in the game'); return m[0]; };

test('four groups, every section in one of them, each with an address', () => {
  const groups = JSON.parse(JSON.stringify(vm.runInNewContext('[' + grab(/CZ_TABS\.splice\(0,CZ_TABS\.length,(.*?)\);/, 'the groups').replace(/^CZ_TABS\.splice\(0,CZ_TABS\.length,/, '').replace(/\);$/, '') + ']')));
  assert.deepEqual(groups.map(g => g[1]), ['Symbols of state', 'Places and people', 'Your pages', 'Paperwork']);
  const keys = groups.flatMap(g => g[2]);
  assert.equal(new Set(keys).size, keys.length, 'no section twice');
  assert.ok(!keys.includes('z'), 'Finery is no longer a section');
  const slug = vm.runInNewContext('(' + grab(/const CZ_SLUG=\{[^}]*\}/, 'CZ_SLUG').replace(/^const CZ_SLUG=/, '') + ')');
  for (const m of html.matchAll(/CZ_SLUG\.(\w)='(\w+)'/g)) slug[m[1]] = m[2];
  for (const k of keys) assert.ok(slug[k], `section ${k} has an address`);
  assert.equal(slug.g, 'map');
  for (const k of keys) assert.ok(html.includes(`.cz-dock[data-sec="${k}"]~.cz-sec:not(#cz-sec-${k})`), `section ${k} shows alone`);
});

test('Match my flag: the nearest colour it may use, never one it skips', () => {
  const ctx = {};
  vm.runInNewContext([grab(/const czRGB=.*?;\n/, 'czRGB'), grab(/const czDist=.*?;\n/, 'czDist'), grab(/const czNearest=.*?;\n/, 'czNearest')].join('').replace(/const /g, 'var '), ctx);
  const T = [['gules', '#B22234'], ['azure', '#1F4E99'], ['vert', '#2E7D32'], ['argent', '#F2F2F2'], ['or', '#E8B923']];
  assert.equal(ctx.czNearest('#CC0000', T), 'gules');
  assert.equal(ctx.czNearest('#0F6E67', T), 'vert');
  assert.equal(ctx.czNearest('#FFFFFF', T), 'argent');
  assert.equal(ctx.czNearest('#FFFFFF', T, ['argent']), 'or', 'a colour already used is skipped');
  assert.equal(ctx.czNearest('nonsense', T), 'gules', 'a bad colour still gets an answer');
});

test('the map colour, the capital marker and the land are in Map; the pencils are only on the own page', () => {
  assert.match(html, /Object\.assign\(CZ_SEC_OF,\{badge:'t',card:'b',inscription:'p',territory:'g',boundary:'g',mapcol:'g',poster:'g',pin:'g'\}\)/);
  assert.match(html, /if\(n!==S\.nation\|\|S\.view!=='nation'\|\|OBS\|\|PV\|\|typeof h!=='string'\)return h;/, 'pencils: own nation, own page, not observing');
  assert.match(html, /else if\(a==='mlk-mc-set'\)\{czTabFor\('cz-sec-g'\);uxOpen\('customise',null,'#cz-sec-g'\);\}/, 'the map card sends its colours to Customise');
});
