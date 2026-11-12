// src/perf-url.js: the addresses Firebase Performance Monitoring reports never carry a player ID, a query or a #hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../src/perf-url.js', import.meta.url), 'utf8');
function masker(origin) {
  const self = {}, location = new URL(origin + '/#visit/abc');
  vm.runInNewContext(src, { self, location, URL });
  return self.edictumPerfUrl;
}
const mask = masker('https://edictumgame.com');
const UID = 'kQ3xYzAb7Cd9EfGhIjKlMnOpQr12';

test('the site’s own downloads keep their path, without query or hash', () => {
  assert.equal(mask('https://edictumgame.com/assets/game.3f9a1b2c4d.js'), 'https://edictumgame.com/assets/game.3f9a1b2c4d.js');
  assert.equal(mask('/__/firebase/init.json?x=1#y'), 'https://edictumgame.com/__/firebase/init.json');
  assert.equal(mask('https://edictumgame.com/assets/fonts/bodoni-moda-latin-opsz-normal.woff2'), 'https://edictumgame.com/assets/fonts/bodoni-moda-latin-opsz-normal.woff2');
});

test('player IDs in Firebase’s paths become *', () => {
  assert.equal(mask('https://firestore.googleapis.com/v1/projects/edictum-b30de/databases/(default)/documents/nations/' + UID + '?mask.fieldPaths=rev'),
    'https://firestore.googleapis.com/v1/projects/edictum-b30de/databases/(default)/documents/nations/*');
  assert.equal(mask('https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/regions/aurelia/nations:runAggregationQuery'),
    'https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/regions/aurelia/nations:runAggregationQuery');
  assert.equal(mask('https://firestore.googleapis.com/v1/x/documents/stamps%2F' + UID), 'https://firestore.googleapis.com/v1/x/documents/stamps%*');
  // a 28-letter ID without a digit, and a Firestore document ID with one
  assert.equal(mask('https://firestore.googleapis.com/v1/d/nations/abcdefghijklmnopqrstuvwxyzAB'), 'https://firestore.googleapis.com/v1/d/nations/*');
  assert.equal(mask('https://firestore.googleapis.com/v1/d/posts/aB3dEfGhIjKlMnOpQrSt'), 'https://firestore.googleapis.com/v1/d/posts/*');
  assert.equal(mask('https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel?gsessionid=abc&SID=1'),
    'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel');
  assert.equal(mask('https://europe-west1-edictum-b30de.cloudfunctions.net/civic'), 'https://europe-west1-edictum-b30de.cloudfunctions.net/civic');
  assert.equal(mask('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=AIza'), 'https://identitytoolkit.googleapis.com/v1/accounts:lookup');
});

test('other sites keep only their host', () => {
  assert.equal(mask('https://cdn.discordapp.com/avatars/123456789012345678/a1b2c3.png'), 'https://cdn.discordapp.com/');
  assert.equal(mask('https://lh3.googleusercontent.com/a/ACg8ocL-xyz=s96-c'), 'https://lh3.googleusercontent.com/');
  assert.equal(mask('https://region1.google-analytics.com/g/collect?v=2&cid=1.2'), 'https://region1.google-analytics.com/');
  assert.equal(mask('https://evil.googleapis.com.example.org/nations/' + UID), 'https://evil.googleapis.com.example.org/');
  assert.equal(mask('http://127.0.0.1:8080/v1/projects/demo/databases/(default)/documents/nations/' + UID), 'http://127.0.0.1:8080/');
});

test('anything that is not a web address says only its kind', () => {
  assert.equal(mask('blob:https://edictumgame.com/1b2c'), 'blob:');
  assert.equal(mask('data:image/png;base64,AAAA'), 'data:');
});
