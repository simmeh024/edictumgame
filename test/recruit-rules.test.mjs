// Recruiting, round two: the server's pure rules (functions/recruit.js, recruit-rules.js, join.js). The emulator suite
// (test/civic.test.mjs) files claims; test/recruit-e2e.mjs plays both sides in a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { holdOf, quietRegion, goalMet, goalOf, jpegSize, noteText, RECRUIT_GOAL, TRADE_KINDS } from '../functions/recruit.js';
import { rcPactUntil, RC_PACT } from '../functions/recruit-rules.js';
import { slugOf, joinPath, joinHTML, joinLang, joinOrigin, JOIN_SLUG } from '../functions/join.js';

const DAY = 86400000;
const snap = data => ({ exists: !!data, get: k => data ? data[k] : undefined });

test('a claim is held when the recruit plays from the recruiter’s address or device, and only then', () => {
  assert.equal(holdOf({ dev: true }), 'dev');
  assert.equal(holdOf({ ip: '203.0.113.7', seenBy: '203.0.113.7' }), 'ip');
  assert.equal(holdOf({ ip: '198.51.100.2', seenBy: '203.0.113.7', seenMe: '203.0.113.7' }), 'ip', 'last played from the same one');
  assert.equal(holdOf({ ip: '198.51.100.2', seenBy: '203.0.113.7', seenMe: '198.51.100.2' }), '');
  assert.equal(holdOf({ ip: '', seenBy: '', seenMe: '' }), '', 'nothing known');
  assert.equal(holdOf({ ip: 'not an address', seenBy: 'not an address' }), '', 'only addresses compare');
  assert.equal(holdOf({ dev: 'yes', ip: '1.2.3.4', seenBy: '5.6.7.8' }), '', 'the device says so with true only');
});

test('a region needs players at no more than 60% of the average open region', () => {
  const counts = { a: 100, b: 100, c: 30, d: 0 }, open = ['a', 'b', 'c', 'd']; // average 57.5, 60% of it 34.5
  assert.equal(quietRegion('c', counts, open), true);
  assert.equal(quietRegion('d', counts, open), true, 'an empty open region');
  assert.equal(quietRegion('a', counts, open), false);
  assert.equal(quietRegion('c', counts, ['a', 'b', 'd']), false, 'a closed region gets nothing');
  assert.equal(quietRegion('c', null, open), false, 'no counts, no bonus');
  assert.equal(quietRegion('a', { a: 0, b: 0 }, ['a', 'b']), false, 'nobody anywhere');
});

test('the joint goal: a trade between the two, on either side’s record, from founding to two weeks after filing', () => {
  const filed = Date.UTC(2026, 10, 27), founded = filed - DAY;
  const recruit = { founded, log: [{ k: 'trade', a: 'R', t: filed + 3 * DAY }] };
  assert.equal(goalOf(recruit, null, 'R', 'C', filed), true);
  assert.equal(goalOf({ founded, log: [{ k: 'trade', a: 'X', t: filed + DAY }] }, null, 'R', 'C', filed), false, 'with someone else');
  assert.equal(goalOf({ founded, log: [{ k: 'trade', a: 'R', t: filed + RECRUIT_GOAL + DAY }] }, null, 'R', 'C', filed), false, 'too late');
  assert.equal(goalOf({ founded, log: [{ k: 'tradeno', a: 'R', t: filed + DAY }] }, null, 'R', 'C', filed), false, 'a refusal is no trade');
  /* the recruiter accepted the recruit's offer: only the recruiter's record logs it */
  assert.equal(goalOf({ founded, log: [] }, { log: [{ k: 'trade', a: 'C', t: filed + DAY }] }, 'R', 'C', filed), true);
  /* the log rolled past it, but the accepted deal is still there */
  assert.equal(goalOf({ founded, deals: [{ w: 'R', a: 1, t: filed + 2 * DAY }] }, null, 'R', 'C', filed), true);
  assert.equal(goalOf({ founded, deals: [{ w: 'R', t: filed + 2 * DAY }] }, null, 'R', 'C', filed), false, 'an offer only');
  assert.equal(goalMet({ log: [{ k: 'tradeend', a: 'R', s: filed, t: filed + 30 * DAY }] }, 'R', founded, filed + RECRUIT_GOAL), true, 'a deal that began in time and ended later');
  assert.ok(TRADE_KINDS.has('trade') && !TRADE_KINDS.has('tradeno'));
});

test('the recruits’ pact binds for a month after filing, from records filed with it, unless held or refused', () => {
  const now = Date.UTC(2026, 10, 27), t = { toMillis: () => now - 5 * DAY };
  assert.equal(rcPactUntil(snap({ r: 'A', t, p: 1 }), 'A', now), now - 5 * DAY + RC_PACT);
  assert.equal(rcPactUntil(snap({ r: 'A', t, p: 1 }), 'B', now), 0, 'another player');
  assert.equal(rcPactUntil(snap({ r: 'A', t }), 'A', now), 0, 'a record from before the pact');
  assert.equal(rcPactUntil(snap({ r: 'A', t, p: 1, h: 'ip' }), 'A', now), 0, 'held');
  assert.equal(rcPactUntil(snap({ r: 'A', t, p: 1, h: 'no' }), 'A', now), 0, 'refused');
  assert.equal(rcPactUntil(snap({ r: 'A', t: now - 31 * DAY, p: 1 }), 'A', now), 0, 'over');
  assert.equal(rcPactUntil(snap(null), 'A', now), 0);
});

test('/join/ slugs from nation names, and the paths that name them', () => {
  assert.equal(slugOf('République de Ça-va'), 'republique-de-ca-va');
  assert.equal(slugOf("King's Landing"), 'kings-landing');
  assert.equal(slugOf('!!!'), 'nation');
  assert.equal(slugOf('A'.repeat(80)).length, 40);
  assert.ok(JOIN_SLUG.test(slugOf('Ελλάδα')) && slugOf('Ελλάδα') === 'nation', 'nothing left: nation');
  assert.deepEqual(joinPath('/join/meridian'), { slug: 'meridian', card: false });
  assert.deepEqual(joinPath('/join/meridian/card.jpg'), { slug: 'meridian', card: true });
  assert.equal(joinPath('/join/../x'), null);
  assert.equal(joinPath('/join/Meridian'), null, 'lower case only');
  assert.equal(joinPath('/joint/meridian'), null);
});

test('the /join/ page: the inviter in its preview tags, escaped, and the way on to the game', () => {
  const h = joinHTML({ origin: 'https://edictumgame.com', slug: 'free-state', u: 'abcdef123', name: 'Free <State> & "Co"', reg: 'meridian', h: 'ab12', via: 'wa', lang: 'en' });
  assert.match(h, /<meta property="og:title" content="Free &lt;State&gt; &amp; &quot;Co&quot; invites you to found a nation in Edictum">/);
  assert.match(h, /og:image" content="https:\/\/edictumgame\.com\/join\/free-state\/card\.jpg\?v=ab12"/);
  assert.match(h, /Meridian Reach/);
  assert.match(h, /location\.replace\("\/\?recruit=abcdef123&rg=meridian&via=wa"\)/);
  assert.ok(!h.includes('<State>'));
  const none = joinHTML({ origin: 'https://edictumgame.com', slug: 'gone', u: '', name: '', reg: '', h: '', via: '', lang: 'en' });
  assert.match(none, /og:image" content="https:\/\/edictumgame\.com\/og\.png"/);
  assert.match(none, /location\.replace\("\/"\)/);
  assert.ok(!none.includes('recruit='));
  const fr = joinHTML({ origin: 'https://edictumgame.com', slug: 'x', u: 'abcdef123', name: 'Ys', reg: 'meridian', h: '', via: 'bad via!', lang: 'fr' });
  assert.match(fr, /Ys vous invite à fonder une nation/);
  assert.ok(!fr.includes('via='), 'a bad channel is dropped');
  assert.equal(joinLang('fr-FR,fr;q=0.9'), 'fr');
  assert.equal(joinLang('en-GB'), 'en');
  const req = host => ({ get: k => k === 'x-forwarded-host' ? host : '' });
  assert.equal(joinOrigin(req('edictumgame.com')), 'https://edictumgame.com');
  assert.equal(joinOrigin(req('127.0.0.1:5000')), 'http://127.0.0.1:5000');
  assert.equal(joinOrigin(req('evil.example')), 'https://edictumgame.com');
});

test('a JPEG’s size from its header, and a note’s words', () => {
  /* SOI, APP0 (16 bytes), SOF0 with height 630 and width 1200 */
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0)];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x76, 0x04, 0xb0, 0x03, ...Array(9).fill(0)];
  assert.deepEqual(jpegSize(Buffer.from([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9])), [1200, 630]);
  assert.equal(jpegSize(Buffer.from([0x89, 0x50, 0x4e, 0x47])), null);
  assert.equal(noteText('  Come\n\nbe my   neighbour‮!  '), 'Come be my neighbour !');
  assert.equal(noteText('x'.repeat(300)).length, 140);
  assert.equal(noteText(42), '');
});
