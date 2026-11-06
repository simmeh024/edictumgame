// A nation's name must be free in its region (game/edictum.html, nameTaken; bug run item 53). The check looked only at
// players' nations, sleepers included, so founding or renaming a nation after one of the computer-run nations (Vellmark,
// Oskaloo) passed and the region had two of a name. The computer-run nations count now, in any region.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('no function ' + name);
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
const line = re => { const m = html.match(re); if (!m) throw new Error('no line ' + re); return m[0]; };

function names(home = 'meridian') {
  const ctx = vm.createContext({});
  vm.runInContext(`
    ${line(/const nameFold=[^\n]*/)}
    const NPCS_MER=[{name:'Vellmark'},{name:'Oskaloo'}];
    const REG_BY_ID={meridian:{id:'meridian'},terra:{id:'terra',npcs:[{name:'Gaia Prime'}]}};
    const REG=REG_BY_ID[${JSON.stringify(home)}],NPC_NATIONS=(REG.id==='meridian'?NPCS_MER:REG.npcs).map(d=>({id:'npc-'+d.name,npc:true,name:d.name}));
    const S={uid:'me',worldAll:{me:{name:'Myland',reg:'meridian'},a:{name:'Aldoria',reg:'meridian'}},world:null};
    const DORM={all:{z:{name:'Sleepy Hollow',reg:'terra'}},w:null};
    ${fn('npcNamesOf')}
    ${fn('nameTaken')}
    this.taken=nameTaken;`, ctx);
  return ctx.taken;
}

test('a computer-run nation’s name is taken in its region, whatever the case or accents', () => {
  const taken = names();
  assert.equal(taken('Vellmark', 'meridian'), true);
  assert.equal(taken('  OSKALOO ', 'meridian'), true);
  assert.equal(taken('Véllmark', 'meridian'), true);
});
test('players’ nations still count, and the player’s own name does not', () => {
  const taken = names();
  assert.equal(taken('aldoria', 'meridian'), true);
  assert.equal(taken('Myland', 'meridian'), false);
  assert.equal(taken('Sleepy Hollow', 'terra'), true);
});
test('names are per region: another region’s computer nations are found too, and do not block this one', () => {
  const taken = names();
  assert.equal(taken('Gaia Prime', 'terra'), true, 'from the region list when the page is in another region');
  assert.equal(taken('Gaia Prime', 'meridian'), false);
  assert.equal(taken('Vellmark', 'terra'), false);
  const onTerra = names('terra');
  assert.equal(onTerra('gaia prime', 'terra'), true, 'the page’s own region uses its computer nations');
  assert.equal(onTerra('Vellmark', 'meridian'), true, 'Meridian’s list is known from elsewhere');
});
test('a free name is free', () => {
  assert.equal(names()('New Vellmark', 'meridian'), false);
});
