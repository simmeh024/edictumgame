// Entry stamps collected while visiting another region (game/edictum.html, ppvNote / ppvApply). The visiting tab holds
// a stand-in nation that nothing saves, so the stamps wait in this browser per account and go into the passport once
// the nation's own tab is home with its save read. They keep the region they came from: "Border Crossings" (two
// regions) and "Cosmopolitan" (five) could only be earned by moving region before.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { const ch = html[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
const lineOf = start => { const i = html.indexOf(start); assert.ok(i >= 0, start); return html.slice(i, html.indexOf('\n', i)); };
const DESIGN = { sh: 'ps-hex', bd: 'pb-twin', ink: 'pi-teal', ic: '', t1: 'Welcome', t2: '', fn: '' };

/* one browser's storage, shared by its tabs */
function browser() {
  const m = new Map();
  return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), keys: () => [...m.keys()] };
}
/* a tab: OBS is the visited region ('' at home) */
function tab(ls, { OBS = '', word = 'Visiting', nations = {}, nation = null, mode = OBS ? 'readonly' : 'world', ownIn = !OBS } = {}) {
  const T = { toasts: [], commits: [] };
  const ctx = vm.createContext({
    OBS, PV: null, tabPassive: false, localStorage: ls, LS_KEY: 'statehood.nation.v1', PP_PAGES: 2, PP_SLOTS: 3, PP_MAX: 6, DAY: 864e5,
    PP_STATS: new Map(), NPC_NATIONS: [], S: { uid: 'u1', obsOn: !!OBS, mode, ownIn, nation }, PP: { tried: new Set() },
    REG_BY_ID: { meridian: { name: 'Meridian Reach' }, frostmarch: { name: 'Frostmarch' } }, REG: { id: OBS || 'frostmarch' },
    NATIONS: nations, WORD: word, T,
    window: { addEventListener: () => {} }, setTimeout: f => f()
  });
  vm.runInContext(`
    const findNation=id=>NATIONS[id]?{id,n:NATIONS[id]}:undefined,obsWord=()=>WORD,ppDesign=()=>({s:${JSON.stringify(DESIGN)}}),
      czText=(v,max)=>String(v).slice(0,max),toast=t=>T.toasts.push(t),commit=m=>{T.commits.push(m);S.nation=m;},render=()=>{},
      myId=()=>S.uid,regBlocked=()=>false,clone=o=>JSON.parse(JSON.stringify(o)),
      regName=id=>REG_BY_ID[id]?REG_BY_ID[id].name:'a distant region',
      ppClean=d=>{if(!d||typeof d!=='object')return null;const v={...(d.v||{})};return {...d,v,p:Array.from({length:PP_PAGES},(_,i)=>Array.from({length:PP_SLOTS},(_,j)=>(d.p&&d.p[i]&&d.p[i][j])||0))};};
    ${fn('list')}
    ${fn('ppFree')}
    ${fn('ppCount')}
    ${fn('ppStats')}
    ${lineOf("const PPV_KEY=")}
    ${fn('ppvKey')}
    ${fn('ppvRead')}
    ${fn('ppvHeld')}
    ${fn('ppvNote')}
    ${fn('ppvApply')}
    this.G={ppvNote,ppvApply,ppvRead,ppStats,PP,S};`, ctx);
  return { ...ctx.G, T };
}
const home = (stamps = {}) => {
  const p = [[0, 0, 0], [0, 0, 0]]; let k = 0;
  for (const id of Object.keys(stamps)) { p[Math.floor(k / 3)][k % 3] = id; k++; }
  return { name: 'Frostia', reg: 'frostmarch', pp: { v: stamps, p } };
};
const stamp = (name, reg) => [name, reg, Date.now() - 864e5, 'ps-circle', 'pb-single', 'pi-violet', '', '', '', ''];

test('a nation page opened while visiting notes its stamp, with the visited region, once', () => {
  const ls = browser(), v = tab(ls, { OBS: 'meridian', nations: { n2: { name: 'Adminland', reg: 'meridian' } } });
  v.ppvNote('n2');
  const q = v.ppvRead();
  assert.equal(q.length, 1);
  assert.equal(q[0][0], 'n2');
  assert.deepEqual([q[0][1][0], q[0][1][1], q[0][1][3], q[0][1][7]], ['Adminland', 'meridian', 'ps-hex', 'Welcome'], 'name, region and the stamp as it is designed');
  assert.match(v.T.toasts[0], /^Stamped at the border: the entry stamp of Adminland goes into your passport when you return/);
  v.PP.tried.clear(); v.ppvNote('n2');
  assert.equal(v.ppvRead().length, 1, 'never twice');
  assert.equal(v.T.toasts.length, 1);
});

test('before the region is in, nothing is noted and the page is tried again', () => {
  const ls = browser(), nations = {}, v = tab(ls, { OBS: 'meridian', nations });
  v.ppvNote('n2');
  assert.equal(v.ppvRead().length, 0); assert.equal(v.PP.tried.has('n2'), false);
  nations.n2 = { name: 'Adminland', reg: 'meridian' };
  v.ppvNote('n2');
  assert.equal(v.ppvRead().length, 1);
});

test('a stamp already in the passport, or staff observing, notes nothing', () => {
  const ls = browser();
  ls.setItem('statehood.nation.v1', JSON.stringify(home({ n2: stamp('Adminland', 'meridian') })));
  const v = tab(ls, { OBS: 'meridian', nations: { n2: { name: 'Adminland', reg: 'meridian' }, n3: { name: 'Isleby', reg: 'meridian' } } });
  v.ppvNote('n2');
  assert.equal(v.ppvRead().length, 0, 'held already');
  assert.equal(v.T.toasts.length, 0);
  const staff = tab(browser(), { OBS: 'meridian', word: 'Observing', nations: { n3: { name: 'Isleby', reg: 'meridian' } } });
  staff.ppvNote('n3');
  assert.equal(staff.ppvRead().length, 0, 'an admin observing collects none');
});

test('at home, once the save is read, the stamps go into the passport and the passport carries two regions', () => {
  const ls = browser(), v = tab(ls, { OBS: 'meridian', nations: { n2: { name: 'Adminland', reg: 'meridian' }, n3: { name: 'Isleby', reg: 'meridian' } } });
  v.ppvNote('n2'); v.ppvNote('n3');
  const h = tab(ls, { nation: home({ f1: stamp('Snowdon', 'frostmarch') }), ownIn: false });
  h.PP.vDue = true;
  h.ppvApply();
  assert.equal(h.T.commits.length, 0, 'not before the nation’s own save is read');
  assert.equal(h.ppvRead().length, 2, 'they still wait');
  h.S.ownIn = true; h.ppvApply();
  assert.equal(h.T.commits.length, 1, 'one save for all of them');
  const m = h.T.commits[0];
  assert.deepEqual(Object.keys(m.pp.v).sort(), ['f1', 'n2', 'n3']);
  assert.equal(m.pp.v.n2[1], 'meridian');
  assert.equal(JSON.stringify(m.pp.p[0]), JSON.stringify(['f1', 'n2', 'n3']), 'in the next free places');
  assert.equal(h.ppStats(m).reg, 2, 'Border Crossings: stamps from two regions');
  assert.equal(ls.getItem('edictum.ppv.u1'), null, 'nothing left waiting');
  assert.match(h.T.toasts.at(-1), /^Stamped on your travels: 2 entry stamps from Meridian Reach are in your passport\./);
  assert.equal(h.PP.vDue, false);
  h.PP.vDue = true; h.ppvApply();
  assert.equal(h.T.commits.length, 1, 'nothing to do the second time');
});

test('one stamp is named, with its region', () => {
  const ls = browser(), v = tab(ls, { OBS: 'meridian', nations: { n2: { name: 'Adminland', reg: 'meridian' } } });
  v.ppvNote('n2');
  const h = tab(ls, { nation: home() });
  h.ppvApply();
  assert.equal(h.T.toasts.at(-1), 'Stamped on your travels: the entry stamp of Adminland, from Meridian Reach, is in your passport.');
});

test('a full passport keeps what does not fit waiting', () => {
  const ls = browser(), nations = {};
  for (let i = 1; i <= 3; i++) nations['n' + i] = { name: 'Visited ' + i, reg: 'meridian' };
  const v = tab(ls, { OBS: 'meridian', nations });
  for (let i = 1; i <= 3; i++) v.ppvNote('n' + i);
  const held = {}; for (let i = 1; i <= 5; i++) held['h' + i] = stamp('Home ' + i, 'frostmarch');
  const h = tab(ls, { nation: home(held) });
  h.ppvApply();
  assert.equal(Object.keys(h.T.commits[0].pp.v).length, 6, 'the one that fits goes in');
  assert.equal(h.ppvRead().map(e => e[0]).join(), 'n2,n3', 'the rest wait');
  assert.match(h.T.toasts.join(' '), /Your passport is full: 2 stamps from your travels wait until you make room/);
});

test('a stamp already collected at home is not added twice, and the visiting tab never saves', () => {
  const ls = browser(), v = tab(ls, { OBS: 'meridian', nations: { n2: { name: 'Adminland', reg: 'meridian' } } });
  v.ppvNote('n2');
  v.ppvApply();
  assert.equal(v.T.commits.length, 0, 'the visiting tab puts nothing in');
  const h = tab(ls, { nation: home({ n2: stamp('Adminland', 'meridian') }) });
  h.ppvApply();
  assert.equal(h.T.commits.length, 0);
  assert.equal(ls.getItem('edictum.ppv.u1'), null);
});

test('the game sends a visiting tab’s collecting here, and marks when the nation’s own save is read', () => {
  assert.match(fn('ppCollect'), /^function ppCollect\(id\)\{\n  if\(OBS\)\{ppvNote\(id\);return;\}/);
  assert.match(html, /ownWaitEnd\(\);\n  publishSync\(\);\n[^\n]*\n  S\.ownIn=true;/);
  assert.match(html, /if\(PP\.vDue&&!OBS\)setTimeout\(ppvApply,0\)/, 'tried at every render until done');
  assert.match(html, /window\.addEventListener\('storage',e=>\{if\(OBS\|\|!e\.key\|\|e\.key!==ppvKey\(\)\)return;PP\.vDue=true;/, 'and at once in a home tab already open');
});
