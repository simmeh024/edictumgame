// Times in words (game/edictum.html; bug run items 64 and 66).
// 64: the retaliation banner said "Until 14:30 tomorrow" for any day but today, though the window lasts 48 hours, so it
//     often ends the day after tomorrow. dayTail names the day: nothing, "tomorrow", a weekday, or a date.
// 66: the file had two fmtWait functions; the later one (hours rounded down) replaced the earlier one (which could say
//     "1 day 24 h"), so the earlier one was dead code. One is left.
process.env.TZ = 'Europe/Amsterdam';
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
const ctx = vm.createContext({});
vm.runInContext(`const DAY=864e5;${fn('fmtDate')} ${fn('fmtTime')} ${fn('dayTail')} ${fn('fmtDur')} ${fn('fmtWait')} this.dayTail=dayTail;this.fmtWait=fmtWait;`, ctx);
const H = 3600e3;

test('the day after a clock time: today, tomorrow, a weekday within the week, then a date', () => {
  const now = new Date(2026, 10, 6, 10, 0).getTime(); // Friday 6 Nov 2026, 10:00
  assert.equal(ctx.dayTail(now + 13 * H, now), '', 'later today');
  assert.equal(ctx.dayTail(now + 23 * H, now), ' tomorrow');
  assert.equal(ctx.dayTail(now + 48 * H, now), ' on Sunday', 'a 48-hour window ends the day after tomorrow');
  assert.equal(ctx.dayTail(now + 8 * 24 * H, now), ' on 14 Nov 2026');
  assert.equal(ctx.dayTail(now - 2 * H, now), '', 'a time already past today');
});

test('the day count holds across the end of summer time', () => {
  const now = new Date(2026, 9, 24, 22, 0).getTime(); // Saturday 24 Oct 2026; clocks go back on the 25th
  assert.equal(ctx.dayTail(new Date(2026, 9, 25, 23, 30).getTime(), now), ' tomorrow');
  assert.equal(ctx.dayTail(new Date(2026, 9, 26, 0, 30).getTime(), now), ' on Monday');
});

test('west of UTC too', () => {
  process.env.TZ = 'America/Mexico_City';
  const now = new Date(2026, 10, 6, 20, 0).getTime();
  assert.equal(ctx.dayTail(now + 5 * H, now), ' tomorrow');
  assert.equal(ctx.dayTail(now + 47 * H, now), ' on Sunday');
  process.env.TZ = 'Europe/Amsterdam';
});

test('the retaliation and truce banners name the day with dayTail', () => {
  assert.match(html, /Until \$\{fmtTime\(o\.e\.rt\+CV_RV\)\}\$\{dayTail\(o\.e\.rt\+CV_RV,now\)\}/);
  assert.match(html, /A truce holds until \$\{fmtTime\(ws\.truceUntil\)\}\$\{dayTail\(ws\.truceUntil,now\)\}/);
  assert.doesNotMatch(html, /toDateString\(\)\?' tomorrow'/, 'no banner calls any other day "tomorrow"');
});

test('one fmtWait is left, and it never says "24 h"', () => {
  assert.equal(html.split('\nfunction fmtWait(').length - 1, 1);
  assert.equal(ctx.fmtWait(2 * 864e5 - 60e3), '1 day 23 hours');
  assert.equal(ctx.fmtWait(864e5 + 3600e3), '1 day 1 hour');
  assert.equal(ctx.fmtWait(3 * 864e5), '3 days');
  assert.equal(ctx.fmtWait(5 * 60e3), '5 min');
});
