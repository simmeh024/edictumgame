// The French chat (20 Nov 2026): a second chat every region shares (functions/regionchat.js, RC_FR), shown on its own
// tab, Français, when the interface is in French or the player turned it on in Settings › Chat (dmx.rf), and in the
// admin portal's Region chats for staff whatever their language.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { RC_SHARED, RC_FR, RC_WORLD, rcShared } from '../functions/regionchat.js';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const between = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i >= 0 && j > i, a + ' is in the game'); return html.slice(i, j); };

test('the server knows two shared chats: the world chat and the French chat, and no other name', () => {
  assert.deepEqual(RC_SHARED, [RC_WORLD, RC_FR]);
  assert.equal(RC_FR, 'fr');
  assert.ok(rcShared('world') && rcShared('fr'));
  for (const x of ['es', 'meridian', '', undefined, 'FR']) assert.equal(rcShared(x), false, String(x));
});

/* the shared chats' state and what each says, and whether the Français tab is wanted, run with stand-ins for the game */
function game(lang, obs = false) {
  const ctx = vm.createContext({ OBS: obs, uiLang: () => lang, dmx: n => (n && n.dmx) || {} });
  vm.runInContext(between('const RGW={', '/* the Edictum team') + '\n' + between('function rgfWant(', 'function rgfOn(') + ';this.out={RGW,RGF,RGS,rgsOf,rgfWant};', ctx);
  return ctx.out;
}

test('the Français tab follows the language until the player chooses, then keeps the choice', () => {
  const en = game('en'), fr = game('fr');
  assert.equal(en.rgfWant({}), false, 'in English: off');
  assert.equal(fr.rgfWant({}), true, 'in French: on by itself');
  assert.equal(en.rgfWant({ dmx: { rf: 1 } }), true, 'turned on in English');
  assert.equal(fr.rgfWant({ dmx: { rf: 0 } }), false, 'turned off in French');
  assert.equal(fr.rgfWant({ dmx: { rf: 1 } }), true);
  assert.equal(en.rgfWant(null), false, 'no nation: the language decides');
  assert.equal(fr.rgfWant(null), true);
  assert.equal(game('fr', true).rgfWant({ dmx: { rf: 0 } }), true, 'observing another region: the staff member’s language decides');
});

test('each shared chat says the same things, the French chat in French when the interface is', () => {
  const en = game('en'), fr = game('fr');
  assert.equal(JSON.stringify(en.RGS.map(C => C.reg)), '["world","fr"]');
  assert.equal(en.rgsOf('fr'), en.RGF);assert.equal(en.rgsOf('region'), null);assert.equal(en.rgsOf('ally'), null);
  const keys = Object.keys(en.RGW.tx()).sort();
  for (const g of [en, fr]) for (const C of g.RGS) assert.deepEqual(Object.keys(C.tx()).sort(), keys, C.reg);
  assert.equal(en.RGF.tx().tab, 'Français');assert.equal(fr.RGF.tx().tab, 'Français');
  assert.equal(en.RGF.tx().the, 'the French chat');assert.equal(fr.RGF.tx().eye, 'Discussion francophone');
  assert.match(fr.RGF.tx().intro, /Écrivez en français/);
  assert.equal(fr.RGW.tx().eye, 'World chat', 'the world chat keeps its words, which the interface translates as it does the rest');
  assert.equal(en.RGF.tx().subN(3), '3 regions talking today');assert.equal(fr.RGF.tx().subN(3), '3 régions en discussion aujourd’hui');
});

test('the drawer, the settings, the bell and the admin portal all know the French chat', () => {
  assert.match(html, /function rgcTabs\(\)\{\s*const t=\[\['region','Region'\]\];for\(const C of RGS\)if\(rgsOn\(C\)\)t\.push\(\[C\.reg,C\.tx\(\)\.tab\]\)/);
  assert.match(html, /<section class="sg-card" id="set-chat-fr">/);
  assert.match(html, /data-rgc="set-fr"\$\{rgfWant\(n\)\?' checked':''\}/);
  assert.match(html, /if\(x\.rf===0\|\|x\.rf===1\)r\.rf=x\.rf;/, 'dmxClean keeps the choice');
  assert.match(html, /h==='chat\/fr'/, '#chat/fr opens the tab');
  assert.match(html, /const ACX_FR=\{id:'fr',name:'French chat'/);
  assert.match(html, /\/\^rc:fr:\/\.test\(p\)\?'French chat'/, 'the Reports queue names a French chat line');
  assert.match(html, /'set-chat-fr':'nat'/);
  assert.match(fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), /reg in \['world', 'fr'\]/);
});

test('the tab row scrolls with arrows at its ends when its tabs do not fit', () => {
  assert.match(html, /<div class="rgc-tabw"><button type="button" class="rgc-tarr" data-rgc="tabs-go" data-v="-1"/);
  assert.match(html, /\.rgc-tabw \.rgc-tabs\{flex:1;min-width:0;overflow-x:auto/);
  assert.match(html, /function rgcTabsArrows\(\)\{/);
  assert.match(html, /else if\(a==='tabs-go'\)/);
});
