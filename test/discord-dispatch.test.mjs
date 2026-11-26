import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchMessages, isPublication, nonceFor, sendPart, splitText } from '../functions/discord-dispatch-core.js';
import { deliverDispatch } from '../functions/discord-dispatch.js';

test('only first publication triggers, including a published new document', () => {
  assert.equal(isPublication(null, { pub: true }), true);
  assert.equal(isPublication({ pub: false }, { pub: true }), true);
  assert.equal(isPublication({ pub: true }, { pub: true }), false);
  assert.equal(isPublication({ pub: false }, { pub: false }), false);
  assert.equal(isPublication({ pub: true }, null), false);
});

test('long dispatch text and poll are preserved and messages respect Discord limits', () => {
  const long = 'A'.repeat(4000) + '😀' + 'B'.repeat(2000);
  const messages = dispatchMessages('post123', { ti: 'A dispatch', h: `<p>${long}</p>`, pl: { q: 'Which?', o: ['One', 'Two'] } });
  assert.ok(messages.length > 3);
  assert.ok(messages.every(x => x.length <= 1900));
  const joined = messages.join('');
  assert.ok(joined.includes(long));
  assert.match(joined, /Poll: Which\?/);
  assert.match(joined, /https:\/\/edictumgame.com\/#devnews\/post123/);
  assert.equal(splitText('😀😀', 3).join(''), '😀😀');
});

test('Discord messages suppress mentions and use a stable per-part nonce', async () => {
  let request;
  await sendPart({ token: 'secret', channelId: '123456789012345678', content: '@everyone', nonce: nonceFor('p', 1, 0),
    fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ id: '1' }) }; } });
  const payload = JSON.parse(request.options.body);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(payload.enforce_nonce, true);
  assert.equal(payload.nonce, nonceFor('p', 1, 0));
  assert.notEqual(payload.nonce, nonceFor('p', 1, 1));
  await assert.rejects(sendPart({ token: 'secret', channelId: '123456789012345678', content: 'x', nonce: 'x',
    fetchImpl: async () => ({ ok: false, status: 429 }) }), /429/);
});

// A small transaction double exercises persisted progress and retries without sending to Discord.
test('a failed multipart delivery resumes at the unsent part and ignores duplicate events', async () => {
  const post = { pub: true, t: 100, ti: 'Dispatch', h: `<p>${'x'.repeat(4000)}</p>` };
  const store = new Map([['devnews/post1', post]]);
  const snapshot = path => ({ exists: store.has(path), data: () => store.get(path), get: key => store.get(path)?.[key] });
  const db = {
    doc(path) { return { path, get: async () => snapshot(path), update: async data => store.set(path, { ...store.get(path), ...data }) }; },
    async runTransaction(fn) { return fn({ get: async ref => snapshot(ref.path),
      set: (ref, data) => store.set(ref.path, { ...store.get(ref.path), ...data }),
      update: (ref, data) => store.set(ref.path, { ...store.get(ref.path), ...data }) }); },
  };
  const event = { params: { postId: 'post1' }, data: { before: { exists: false }, after: { exists: true, data: () => post } } };
  const sent = [];
  const config = { db, key: 'secret', channelId: '123456789012345678', send: async x => {
    if (sent.length === 1) throw new Error('network');
    sent.push(x.content);
  } };
  await assert.rejects(deliverDispatch(event, config), /network/);
  assert.equal(store.get('discordDispatch/post1').next, 1);
  config.send = async x => sent.push(x.content);
  await deliverDispatch(event, config);
  assert.deepEqual(sent, dispatchMessages('post1', post));
  assert.equal(store.get('discordDispatch/post1').done, true);
  await deliverDispatch(event, config);
  assert.deepEqual(sent, dispatchMessages('post1', post));
});
