// The ambassadors' chat (23 Nov 2026): a closed chat (functions/regionchat.js, RC_AMB, rchat/amb) for the Edictum
// Ambassadors, moderators and admins alone, on its own Ambassadors tab in the chat drawer and in the admin portal's
// Region chats. The server refuses anyone else's line or reaction, the rules anyone else's read, and a mention there
// names only ambassadors and staff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { RC_AMB, RC_SHARED, rcShared, rcMayUse } from '../functions/regionchat.js';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const letters = fs.readFileSync(new URL('../functions/letters.js', import.meta.url), 'utf8');
const between = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i >= 0 && j > i, a + ' is in the game'); return html.slice(i, j); };

test('the server knows the ambassadors’ chat as a shared chat that only ambassadors and staff use', () => {
  assert.equal(RC_AMB, 'amb');
  assert.ok(RC_SHARED.includes('amb') && rcShared('amb'));
  for (const reg of ['world', 'fr']) assert.equal(rcMayUse(reg, { uid: 'p' }), true, reg + ' is everyone’s');
  assert.equal(rcMayUse('amb', { uid: 'p' }), false, 'a player');
  assert.equal(rcMayUse('amb', null), false);
  assert.equal(rcMayUse('amb', { amb: true }), true, 'an ambassador');
  assert.equal(rcMayUse('amb', { mod: true }), true, 'a moderator');
  assert.equal(rcMayUse('amb', { admin: true }), true, 'an admin');
});

/* the drawer's shared chats, and who has the Ambassadors tab, run with stand-ins for the game */
function game(S, { pv = false, me = 'me' } = {}) {
  const ctx = vm.createContext({ Set, OBS: false, PV: pv, S, myId: () => me, uiLang: () => 'en', dmx: () => ({}) });
  vm.runInContext(between('const RGW={', '/* the Edictum team') + '\n' + between('function rgaMay(', 'function rgaOn(') + ';this.out={RGW,RGA,RGS,rgsOf,rgaMay};', ctx);
  return ctx.out;
}

test('the Ambassadors tab: ambassadors and staff, by the live list once it is heard', () => {
  assert.equal(game({}).rgaMay(), false, 'a player');
  assert.equal(game({ isAmb: true }).rgaMay(), true, 'an ambassador before the list is heard');
  assert.equal(game({ isAmb: false, ambs: new Set(['me']) }).rgaMay(), true, 'appointed a moment ago');
  assert.equal(game({ isAmb: true, ambs: new Set(['other']) }).rgaMay(), false, 'stood down a moment ago');
  assert.equal(game({ isMod: true }).rgaMay(), true, 'a moderator');
  assert.equal(game({ isOwner: true }).rgaMay(), true, 'an admin');
  assert.equal(game({ isOwner: true }, { pv: true }).rgaMay(), false, 'not in a preview');
  assert.equal(game({ ambs: new Set(['']) }, { me: '' }).rgaMay(), false, 'no player');
});

test('the ambassadors’ chat says what every shared chat says', () => {
  const g = game({});
  assert.equal(g.rgsOf('amb'), g.RGA);
  assert.deepEqual(Object.keys(g.RGA.tx()).sort(), Object.keys(g.RGW.tx()).sort());
  const T = g.RGA.tx();
  assert.equal(T.tab, 'Ambassadors'); assert.equal(T.the, 'the ambassadors’ chat');
  assert.match(T.intro, /^Only Edictum Ambassadors, moderators and the team read this chat\./);
  assert.equal(T.subN(4), T.sub, 'no count of regions: it is no region’s chat');
});

test('the drawer, the bell, the push link, the Reports queue and the admin portal know the ambassadors’ chat', () => {
  assert.match(html, /const rgsOn=C=>C===RGF\?rgfOn\(\):C===RGA\?rgaOn\(\):C===RGK\?rgkOn\(\):rgwOn\(\);/);
  assert.match(html, /function rgcCount\(\)\{return rgcUnread\(\)\+rgcAllyAllUnread\(\)\+RGS\.reduce\(\(k,C\)=>k\+\(C===RGA\|\|C===RGK\?rgwUnread\(C\):rgwNamedUnread\(C\)\),0\);\}/, 'the Chat button counts every new line there');
  assert.match(html, /if\(W===RGA\)return out\.filter\(o=>isAmbId\(o\.id\)\|\|isStaff\(o\.id\)\);/, '@ offers only ambassadors and staff');
  assert.match(html, /if\(k==='amb'\)\{const g=\/<svg/, 'the tab carries the ambassador’s globe');
  assert.match(html, /m\.reg==='amb'\?'the ambassadors’ chat'/, 'the bell names it');
  assert.match(html, /h==='chat\/amb'/); assert.match(html, /location\.hash==='#chat\/amb'/);
  assert.match(html, /\/\^rc:amb:\/\.test\(p\)\?'Ambassadors’ chat'/);
  assert.match(html, /const ACX_SHARED=\[ACX_WORLD,ACX_FR,ACX_AMB,ACX_WAC\]/);
  assert.match(html, /Only Edictum Ambassadors and staff read the ambassadors’ chat\./, 'an old mention of it says why it does not open');
  assert.match(letters, /amb: 'the ambassadors’ chat'/);
  assert.match(rules, /\|\| reg == 'amb' && exists\(\/databases\/\$\(database\)\/documents\/ambassadors\/\$\(request\.auth\.uid\)\)/);
  assert.equal(rules.match(/reg == 'amb' && exists/g).length, 2, 'its lines and its pictures');
});
