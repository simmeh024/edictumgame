// The Edictum Discord server (27 Nov 2026): a small pill under the region chat's buttons, a button in the Help page's
// Support box (beside "Create a support ticket", and on its own when offline) and one in every section's
// "Still stuck?" panel. Each opens the invite in a new tab, with Discord's own mark and French words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const grab = (re, what) => { const m = re.exec(html); assert.ok(m, what + ' is in the game'); return m[0]; };
const fn = name => {
  const at = html.indexOf('\nfunction ' + name + '('); assert.ok(at >= 0, name + ' is in the game');
  const lines = html.slice(at + 1).split('\n'), out = [lines[0]];
  for (const l of lines.slice(1)) { out.push(l); if (l === '}') break; }
  return out.join('\n');
};
const INVITE = 'https://discord.gg/2ganeH3jTx';
const ctx = vm.createContext({});
vm.runInContext([grab(/const DISCORD_URL='[^\n]*/, 'DISCORD_URL'), grab(/const discordIc=[^\n]*/, 'discordIc'), grab(/const dcBtn=[^\n]*/, 'dcBtn'),
  'this.DISCORD_URL=DISCORD_URL;this.discordIc=discordIc;this.dcBtn=dcBtn;'].join('\n'), ctx);
const { DISCORD_URL, discordIc, dcBtn } = ctx;
const newTab = h => /target="_blank"/.test(h) && /rel="noopener noreferrer"/.test(h);

test('the link is the Edictum invite, and the mark is decoration', () => {
  assert.equal(DISCORD_URL, INVITE);
  const ic = discordIc(14);
  assert.match(ic, /^<svg class="dc-ic" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M20\.317 /);
  assert.match(html, /\.dc-ic\{flex:none;color:#5865f2\}/, 'Discord’s blue-violet');
  assert.match(html, /:root\[data-theme="dark"\] \.dc-ic\{color:#8b93f8\}/, 'a lighter one in the dark theme');
  assert.match(html, /@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\) \.dc-ic\{color:#8b93f8\}\}/, 'and when the system is dark');
});

test('the Help page buttons open the invite in a new tab', () => {
  const big = dcBtn('Join our Discord'), small = dcBtn('Ask on Discord', 1);
  assert.match(big, /^<a class="btn ghost dc-btn" href="https:\/\/discord\.gg\/2ganeH3jTx"/);
  assert.ok(newTab(big) && newTab(small));
  assert.ok(big.endsWith('</svg>Join our Discord ↗</a>'), 'the words, after the mark');
  assert.match(small, /^<a class="btn ghost small-btn dc-btn" /, 'the panel’s button is small like its neighbours');
  assert.match(small, /width="15" height="15"/);
});

test('the Support box offers Discord beside a ticket, and on its own when offline', () => {
  const sup = fn('supportBox');
  assert.match(sup, /Create a support ticket<\/button>\$\{dcBtn\('Join our Discord'\)\}<\/div>\$\{DC_SUP_HINT\}/, 'beside the ticket button, then the line under it');
  assert.match(sup, /<\/a>\.<\/p><div class="row">\$\{dcBtn\('Join our Discord'\)\}<\/div>\$\{DC_SUP_HINT\}`:/, 'offline: the button alone');
  assert.match(html, /const DC_SUP_HINT='<p class="hint sup-dc">Players and the game’s team talk on the Edictum Discord too\. It opens in a new tab\.<\/p>';/);
});

test('every "Still stuck?" panel asks on Discord, between the Community Board and the wiki', () => {
  const st = fn('helpStuckHTML');
  assert.match(st, /Ask on the Community Board<\/button>`:''\}\$\{dcBtn\('Ask on Discord',1\)\}<a class="btn ghost small-btn" href="\$\{Object\.hasOwn\(WIKI_PAGE,k\)/);
});

test('the chat’s head: the four buttons in a row, the Discord pill under them', () => {
  const at = html.indexOf('d.innerHTML=`<div class="rgc-head">'); assert.ok(at >= 0, 'the chat’s head');
  const head = html.slice(at, html.indexOf('<div class="rgc-tabw">', at));
  assert.match(head, /<\/div>\n    <div class="rgc-hside"><div class="rgc-hbs"><button type="button" class="rgc-hb rgc-dockb"/, 'the title block, then the buttons’ column');
  const row = head.slice(head.indexOf('<div class="rgc-hbs">'), head.indexOf('<a class="rgc-dc"'));
  assert.deepEqual([...row.matchAll(/data-rgc="(\w+)"/g)].map(m => m[1]), ['dock', 'full', 'settings', 'close'], 'the same four buttons, in order');
  const pill = /<a class="rgc-dc"[^>]*>[\s\S]*?<\/a><\/div><\/div>\n *$/.exec(head);
  assert.ok(pill, 'the pill closes the column and the head');
  assert.ok(newTab(pill[0]));
  assert.match(pill[0], /href="\$\{DISCORD_URL\}"/);
  assert.match(pill[0], /aria-label="Join the Edictum Discord \(opens in a new tab\)"/, 'says where it goes');
  assert.match(pill[0], /\$\{discordIc\(14\)\}Discord <span aria-hidden="true">↗<\/span><\/a>/);
  assert.match(html, /\.rgc-hside\{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:4px\}/);
  assert.match(html, /\.rgc-hbs\{display:flex;gap:6px\}/, 'the buttons keep their old spacing');
  assert.match(html, /\.rgc-dc\{[^}]*border-radius:999px;[^}]*text-transform:uppercase;[^}]*white-space:nowrap\}/, 'a small pill');
});

test('the new words have French', () => {
  const m = /for\(const \[k,v\] of Object\.entries\(\{'Join our Discord ↗'[\s\S]*?\}\)\)if\(!\(k in FR_UI\)\)FR_UI\[k\]=v;/.exec(html);
  assert.ok(m, 'the Discord words are added to the French dictionary');
  const FR = vm.runInNewContext('const FR_UI={};' + m[0] + ';FR_UI');
  for (const k of ['Join our Discord ↗', 'Ask on Discord ↗', 'Join the Edictum Discord (opens in a new tab)',
    'Players and the game’s team talk on the Edictum Discord too. It opens in a new tab.']) assert.ok(FR[k] && FR[k] !== k, k);
  assert.ok(html.indexOf('const FR_UI') < m.index, 'FR_UI exists by then');
});
