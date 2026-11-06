// The Chronicle's rows (game/edictum.html, the Chancery Club's Chronicle; bug run item 61). Each row is a UTC day, but
// its label used the player's own time zone, so west of UTC (Mexico, say) every row showed the day before. Rows are
// labelled by their UTC date now.
process.env.TZ = 'America/Mexico_City';
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

test('a UTC day is labelled with its own date west of UTC, where the local date was a day early', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`${fn('fmtDate')} ${fn('fmtDayUTC')} this.fmtDate=fmtDate;this.fmtDayUTC=fmtDayUTC;`, ctx);
  const t = Date.UTC(2026, 10, 6);
  assert.equal(ctx.fmtDayUTC(t), '6 Nov 2026');
  assert.equal(ctx.fmtDate(t), '5 Nov 2026', 'the old label');
  process.env.TZ = 'Asia/Tokyo';
  assert.equal(ctx.fmtDayUTC(t), '6 Nov 2026', 'east of UTC too');
  process.env.TZ = 'America/Mexico_City';
});
test('both kinds of Chronicle row use the UTC label', () => {
  const at = html.indexOf('const [y,m]=mk.split');
  const block = html.slice(at, html.indexOf('return `${head}${status}', at));
  assert.equal((block.match(/fmtDayUTC\(t\)/g) || []).length, 2);
  assert.doesNotMatch(block, /fmtDate\(t\)/);
});
