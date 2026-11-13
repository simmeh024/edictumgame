/* The region chat's pacing (functions/regionchat.js, rcWait): a second and a half after a player's last line, at most
   RC_MINUTE lines in any minute and RC_HOUR in any hour, counted from the times kept in rcPace/<uid>. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rcWait, RC_GAP, RC_MINUTE, RC_HOUR, RC_GUEST_HOUR, isRegionChatOp, rcSilence, RC_MUTE_HOURS, rcPicData, rcPicIn, RC_THUMB_MAX, RC_PIC_MAX } from '../functions/regionchat.js';

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

test('a guest’s hour holds RC_GUEST_HOUR lines: the next waits until the oldest of them is an hour old', () => {
  assert.equal(RC_GUEST_HOUR, 10);
  const p = Array.from({ length: RC_GUEST_HOUR }, (_, i) => NOW - 3000 * SEC + i * 60 * SEC);
  assert.equal(rcWait(p, NOW).wait, 0, 'a Registered Nation writes on');
  assert.equal(rcWait(p, NOW, RC_GUEST_HOUR).wait, p[0] + 3600 * SEC - NOW);
  assert.equal(rcWait(p.slice(1), NOW, RC_GUEST_HOUR).wait, 0, 'nine in the hour leave one more');
  assert.equal(rcWait(p, p[0] + 3600 * SEC, RC_GUEST_HOUR).wait, 0, 'and the oldest an hour old frees one');
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

/* pictures (admins): rcPicData takes a data URL only of an allowed kind, of at most `max` bytes, whose bytes are that kind */
const bytes = (head, n = 64) => Buffer.concat([Buffer.from(head), Buffer.alloc(Math.max(0, n - head.length), 7)]);
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), JPEG = bytes([0xff, 0xd8, 0xff, 0xe0]), GIF = bytes([...Buffer.from('GIF89a')]);
const WEBP = bytes([...Buffer.from('RIFF'), 1, 2, 3, 4, ...Buffer.from('WEBPVP8 ')]);
const url = (kind, b) => `data:image/${kind};base64,` + b.toString('base64');

test('a picture is taken by what its bytes are, of the kinds allowed', () => {
  assert.deepEqual(rcPicData(url('png', PNG), 1000), { kind: 'png', size: 64 });
  assert.deepEqual(rcPicData(url('jpeg', JPEG), 1000), { kind: 'jpeg', size: 64 });
  assert.deepEqual(rcPicData(url('webp', WEBP), 1000), { kind: 'webp', size: 64 });
  assert.deepEqual(rcPicData(url('gif', GIF), 1000), { kind: 'gif', size: 64 });
  assert.equal(rcPicData(url('gif', GIF), 1000, ['jpeg', 'png', 'webp']), null, 'a kind not allowed');
  assert.equal(rcPicData(url('jpeg', PNG), 1000), null, 'a PNG called a JPEG');
  assert.equal(rcPicData(url('png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), 1000), null, 'not a picture at all');
  assert.equal(rcPicData('data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64'), 1000), null, 'no SVG');
  assert.equal(rcPicData('data:text/html;base64,' + PNG.toString('base64'), 1000), null);
  assert.equal(rcPicData(url('png', PNG).replace('base64,', 'base64, '), 1000), null, 'not plain base64');
  assert.equal(rcPicData(url('png', PNG) + '"onerror="x', 1000), null);
  assert.equal(rcPicData('https://example.com/a.png', 1000), null, 'no addresses');
  assert.equal(rcPicData(url('png', Buffer.alloc(0)), 1000), null);
  assert.equal(rcPicData(null, 1000), null);
  assert.equal(rcPicData({ toString: () => url('png', PNG) }, 1000), null);
});

test('a picture is no bigger than allowed', () => {
  const big = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], RC_THUMB_MAX + 1);
  assert.equal(rcPicData(url('png', big), RC_THUMB_MAX), null);
  assert.ok(rcPicData(url('png', big.subarray(0, RC_THUMB_MAX)), RC_THUMB_MAX));
  assert.ok(rcPicData(url('png', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], RC_PIC_MAX)), RC_PIC_MAX));
  assert.equal(rcPicData(url('png', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], RC_PIC_MAX + 3)), RC_PIC_MAX), null);
  // the picture's document stays under Firestore's 1 MiB with room to spare, and a line with its small copy is small
  assert.ok(Math.ceil(RC_PIC_MAX / 3) * 4 + 30 + 4096 < 1048576);
  assert.ok(Math.ceil(RC_THUMB_MAX / 3) * 4 < 70000);
});

test('a line’s picture: a small copy (no GIF) and the picture, with their sizes; anything else is refused', () => {
  const ok = { th: url('webp', WEBP), w: 440, h: 248, d: url('gif', GIF), fw: 1920, fh: 1080 };
  assert.deepEqual(rcPicIn(ok), { im: { s: ok.th, w: 440, h: 248, fw: 1920, fh: 1080, k: 'gif' }, d: ok.d, kind: 'gif' });
  const refused = p => assert.throws(() => rcPicIn(p), e => e.code === 'invalid-argument' && e.details?.code === 'rc_pic', JSON.stringify(p).slice(0, 80));
  refused(null); refused('x'); refused([]);
  refused({ ...ok, th: url('gif', GIF) });
  refused({ ...ok, d: 'data:image/svg+xml;base64,PHN2Zy8+' });
  refused({ ...ok, w: 0 }); refused({ ...ok, h: 641 }); refused({ ...ok, fw: 4097 }); refused({ ...ok, fh: 1.5 }); refused({ ...ok, fw: '1920' });
  const { th, ...noThumb } = ok; refused(noThumb);
});
