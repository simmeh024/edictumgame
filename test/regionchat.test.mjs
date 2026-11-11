/* The region chat's pacing (functions/regionchat.js, rcWait): a second and a half after a player's last line, at most
   RC_MINUTE lines in any minute and RC_HOUR in any hour, counted from the times kept in rcPace/<uid>. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rcWait, RC_GAP, RC_MINUTE, RC_HOUR, isRegionChatOp, rcSilence, RC_MUTE_HOURS } from '../functions/regionchat.js';

const NOW = 1_800_000_000_000, SEC = 1000;

test('a first line, or one long after the last, waits for nothing', () => {
  assert.equal(rcWait([], NOW).wait, 0);
  assert.equal(rcWait(undefined, NOW).wait, 0);
  assert.equal(rcWait([NOW - 10 * SEC], NOW).wait, 0);
});

test('a line straight after another waits out the gap', () => {
  assert.equal(rcWait([NOW - 500], NOW).wait, RC_GAP - 500);
  assert.equal(rcWait([NOW - RC_GAP], NOW).wait, 0);
});

test('a minute holds at most RC_MINUTE lines: the next waits until the oldest of them is a minute old', () => {
  const p = Array.from({ length: RC_MINUTE }, (_, i) => NOW - 55 * SEC + i * 4 * SEC);
  const { wait } = rcWait(p, NOW + 3 * SEC);
  assert.equal(wait, p[0] + 60 * SEC - (NOW + 3 * SEC));
  assert.equal(rcWait(p.slice(1), NOW + 3 * SEC).wait, 0);
});

test('an hour holds at most RC_HOUR lines', () => {
  const p = Array.from({ length: RC_HOUR }, (_, i) => NOW - 3500 * SEC + i * 20 * SEC);
  assert.ok(p[p.length - 1] < NOW - 2 * SEC);
  assert.equal(rcWait(p, NOW).wait, p[0] + 3600 * SEC - NOW);
});

test('times from the future, of the wrong kind or over an hour old are left out of the count', () => {
  const { wait, recent } = rcWait([NOW + 60 * SEC, 'x', null, NOW - 2 * 3600 * SEC, NOW - 30 * SEC], NOW);
  assert.equal(wait, 0);
  assert.deepEqual(recent, [NOW - 30 * SEC]);
});

test('the chat’s operations are its own: writing, deleting, silencing and lifting', () => {
  assert.ok(['rcPost', 'rcDelete', 'rcMute', 'rcUnmute'].every(isRegionChatOp));
  assert.ok(!isRegionChatOp('cbTopic') && !isRegionChatOp('rcBan') && !isRegionChatOp('') && !isRegionChatOp('constructor'));
});

test('a silence runs until its end; one that has ended, or has no end, is none', () => {
  assert.deepEqual(rcSilence({ until: NOW + 1000, why: 'Spam' }, NOW), { until: NOW + 1000, perm: false, why: 'Spam' });
  assert.deepEqual(rcSilence({ until: NOW + 1000, perm: true }, NOW), { until: NOW + 1000, perm: true, why: '' });
  assert.equal(rcSilence({ until: NOW, why: 'Spam' }, NOW), null);
  assert.equal(rcSilence({ until: 'soon' }, NOW), null);
  assert.equal(rcSilence(null, NOW), null);
});

test('a silence lasts an hour, a day, a week, 30 days or until lifted', () => {
  assert.deepEqual(RC_MUTE_HOURS, [1, 24, 168, 720, 0]);
});
