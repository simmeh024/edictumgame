// The chat line's heading (23 Nov 2026): the name keeps its room while the marks beside it give way; staff, moderators
// and ambassadors wear a small round badge (their words kept for screen readers) with the name in the role's colour;
// the world chat names another region quietly ("of Meridian") and leaves the reader's own region out; and a nation's
// name opens its card, where its region and every mark are spelled out.
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
const ctx = vm.createContext({ lang: 'en' });
vm.runInContext([grab(/const esc = v => [^\n]*/, 'esc'),
  grab(/const STAFF_PILL='[^\n]*/, 'STAFF_PILL'), grab(/const AMB_PILL='[^\n]*/, 'AMB_PILL'), grab(/const MOD_PILL='[^\n]*/, 'MOD_PILL'),
  grab(/const rgcRoleIc=[^\n]*/, 'rgcRoleIc'), grab(/const RGC_PIN='[^\n]*/, 'RGC_PIN'), fn('rgcNcMarks'), fn('rgcNcHTML'), fn('rgwFrom'),
  `const REG={id:'meridian'},REG_BY_ID={meridian:{id:'meridian',name:'Meridian',the:'the Meridian'},greywater:{id:'greywater',name:'Greywater',the:'the Greywater'}};
   const uiLang=()=>lang,flagSVG=(f,l)=>'<svg aria-label="'+l+'"></svg>',rgwFlag=()=>'<svg class="far"></svg>',fullName=n=>'The Republic of '+n.name;
   this.rgcRoleIc=rgcRoleIc;this.rgcNcHTML=rgcNcHTML;this.rgwFrom=rgwFrom;this.STAFF_PILL=STAFF_PILL;this.AMB_PILL=AMB_PILL;this.MOD_PILL=MOD_PILL;`].join('\n'), ctx);
const { rgcRoleIc, rgcNcHTML, rgwFrom, STAFF_PILL, AMB_PILL, MOD_PILL } = ctx;
const words = h => h.replace(/<[^>]+>/g, '');

test('a role pill becomes a small badge, its words kept for screen readers', () => {
  for (const [p, w] of [[STAFF_PILL, 'Edictum staff'], [MOD_PILL, 'Edictum Moderator'], [AMB_PILL, 'Edictum Ambassador']]) {
    const h = rgcRoleIc(p);
    assert.match(h, /^<span class="staff-pill ic[ "]/, 'the badge keeps the pill’s own class and colour');
    assert.match(h, new RegExp('</svg><span class="sr">' + w + '</span></span>$'), w + ' is read out, not shown');
    assert.equal(words(h), w, 'its text is still the role');
    assert.match(h, /title="[^"]+"/, 'pointing at it says the role');
  }
  assert.match(rgcRoleIc(AMB_PILL), /class="staff-pill ic amb"/);
  assert.match(rgcRoleIc(MOD_PILL), /class="staff-pill ic mod"/);
});

test('another region is named quietly after the name, in the reader’s language', () => {
  const h = rgwFrom('greywater');
  assert.equal(words(h), 'of Greywater');
  assert.match(h, /title="A nation of the Greywater"/);
  assert.match(h, /<span data-no-tr>of<\/span>/, 'the little word is never swapped by the French dictionary');
  ctx.lang = 'fr';
  try { assert.equal(words(rgwFrom('greywater')), 'de Greywater'); } finally { ctx.lang = 'en'; }
  assert.equal(rgwFrom('nowhere'), '', 'an unknown region: nothing');
});

test('the heading leaves out the reader’s own region and keeps the name from shrinking', () => {
  const line = fn('rgcLine');
  assert.match(line, /from=rg&&rg!==REG\.id\?rgwFrom\(rg\):''/, 'no region for the reader’s own');
  assert.match(line, /<span class="rgc-lw">\$\{who\}\$\{from\}\$\{mk\?`<span class="rgc-mk">\$\{mk\}<\/span>`:''\}/, 'name, region, then the marks');
  assert.match(line, /mk=m\.tm\?'':\(pill\?rgcRoleIc\(pill\):''\)\+marks/, 'the role’s badge leads the marks');
  assert.match(html, /\.rgc-lw \.rgc-nm\{flex:0 0 auto;max-width:100%\}/, 'the name does not shrink until it fills the row');
  assert.match(html, /\.rgc-mk\{display:flex;flex-wrap:wrap;[^}]*height:20px;[^}]*overflow:hidden\}/, 'a mark that does not fit drops out whole');
  assert.match(html, /\.rgc-nm\.rl-st\{color:var\(--stamp\)\}/, 'a staff name in the staff colour');
});

test('a nation of this region: its card names it, its region, and opens its page', () => {
  const x = { id: 'u1', n: { name: 'Chatterly', flag: {} } };
  const h = rgcNcHTML({ id: 'L1', a: 'u1' }, x, 'Chatterly', 'meridian', '');
  assert.match(h, /class="rgc-ask rgc-nc" role="group" aria-label="Chatterly"/);
  assert.match(h, /<b>Chatterly<\/b><span class="hint">The Republic of Chatterly<\/span>/);
  assert.match(words(h), /Region Meridian \(yours\)/);
  assert.match(h, /<button type="button" class="btn small" data-act="visit" data-id="u1">Open its page<\/button>/);
  assert.match(h, /data-rgc="nc" data-l="L1">Close<\/button>/);
});

test('a nation of another region: its flag from the line, its region, and no page to open', () => {
  const h = rgcNcHTML({ id: 'L2', a: 'u2', fl: '{}', w: 1 }, null, 'Bretonnie', 'greywater', '');
  assert.match(h, /<svg class="far"><\/svg>/);
  assert.match(words(h), /Region Greywater/);
  assert.doesNotMatch(words(h), /yours/);
  assert.doesNotMatch(h, /data-act="visit"/);
  assert.doesNotMatch(h, /class="hint">The Republic/);
});

test('a line with no known region (an alliance member from elsewhere): no region row', () => {
  assert.doesNotMatch(rgcNcHTML({ id: 'L3', a: 'u3' }, null, 'Faraway', '', ''), /Region/);
});
