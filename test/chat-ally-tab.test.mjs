// The chat drawer's Alliance tab (19 Nov 2026): it carries the alliance's own name, and a name too long for the
// row shows the short code that stands beside its members' names (the leader's own from the charter, else the
// initials), with the full name kept for the tooltip and screen readers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const grab = (re, what) => { const m = re.exec(html); assert.ok(m, what + ' is in the game'); return m[0]; };
/* a top-level function: its first line, and its indented body down to the closing brace at the start of a line */
const fn = name => {
  const at = html.indexOf('\nfunction ' + name + '('); assert.ok(at >= 0, name + ' is in the game');
  const lines = html.slice(at + 1).split('\n'), out = [lines[0]];
  if (!lines[1].startsWith(' ') && lines[1] !== '}') return lines[0];
  for (const l of lines.slice(1)) { out.push(l); if (l === '}') break; }
  return out.join('\n');
};
const ctx = vm.createContext({});
vm.runInContext([grab(/const esc = v => [^\n]*/, 'esc'), grab(/const rgcTag=nm=>[^\n]*/, 'rgcTag'), grab(/const AL_TG_RE=[^\n]*/, 'AL_TG_RE'), grab(/const alCode=[^\n]*/, 'alCode'),
  grab(/const RGC_AL_MAX=\d+;/, 'RGC_AL_MAX'), fn('rgcTabLabel'),
  'this.rgcTabLabel=rgcTabLabel;this.RGC_AL_MAX=RGC_AL_MAX;'].join('\n'), ctx);
const { rgcTabLabel, RGC_AL_MAX } = ctx;
const shown = h => h.match(/<span class="rgc-tl"[^>]*>([^<]*)<\/span>/)[1];

test('the other tabs keep their own labels', () => {
  assert.equal(rgcTabLabel('region', 'Region'), 'Region');
  assert.equal(rgcTabLabel('haps', 'Happenings'), 'Happenings');
});

test('a name that fits shows in full, untranslated, with a tooltip', () => {
  const h = rgcTabLabel('ally', 'The Chat Pact');
  assert.equal(shown(h), 'The Chat Pact');
  assert.match(h, /data-no-tr=""/);
  assert.match(h, /title="The Chat Pact · alliance chat"/);
  assert.doesNotMatch(h, /u-sr|aria-hidden/);
  assert.equal(shown(rgcTabLabel('ally', 'x'.repeat(RGC_AL_MAX))), 'x'.repeat(RGC_AL_MAX));
});

test('a name too long for the row shows its initials, the full name for screen readers', () => {
  const h = rgcTabLabel('ally', 'Northern Trade League');
  assert.equal(shown(h), 'NTL');
  assert.match(h, /aria-hidden="true"/);
  assert.match(h, /<span class="u-sr" data-no-tr="">Northern Trade League<\/span>/);
  assert.match(h, /title="Northern Trade League · alliance chat"/);
  assert.equal(shown(rgcTabLabel('ally', 'The Grand Northern Chat Pact')), 'GNCP', 'a leading The is left out, as on the badge');
  assert.equal(shown(rgcTabLabel('ally', 'Confederationofnations')), 'CONF', 'one long word: its first four letters');
});

test('a short code the leader chose stands in for the initials, and only for a name too long', () => {
  assert.equal(shown(rgcTabLabel('ally', 'Northern Trade League', 'NT7')), 'NT7');
  assert.equal(shown(rgcTabLabel('ally', 'Northern Trade League', '4X')), '4X', 'digits count');
  assert.equal(shown(rgcTabLabel('ally', 'The Chat Pact', 'TCP')), 'The Chat Pact', 'a name that fits still shows in full');
  assert.equal(shown(rgcTabLabel('ally', 'Northern Trade League', '')), 'NTL', 'no code: the initials');
  assert.equal(shown(rgcTabLabel('ally', 'Northern Trade League', 'TOOLONG')), 'NTL', 'a code the server would refuse is ignored');
  assert.equal(shown(rgcTabLabel('ally', 'Northern Trade League', 'ab')), 'NTL', 'lower case is not a code');
});

test('the name is escaped', () => {
  const h = rgcTabLabel('ally', '<b>&Co</b>');
  assert.doesNotMatch(h, /<b>/);
  assert.equal(shown(h), '&lt;b&gt;&amp;Co&lt;/b&gt;');
});

test('an empty name falls back to Alliance', () => {
  assert.equal(shown(rgcTabLabel('ally', '')), 'Alliance');
});
