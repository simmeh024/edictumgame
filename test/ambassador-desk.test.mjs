// The Ambassador's Desk (functions/ambassador.js, and the amb-* views in game/edictum.html), in the parts that need
// no database. What matters here is the shape of the role, not the queries:
//   - the desk, and every op on it, is refused to anyone without the ambassador's claim: a player, a moderator and
//     an admin all get nothing, so the desk can never become a second, weaker moderator's portal;
//   - one question tallies once however it was worded, and an ambassador counts once a day towards it;
//   - the week's commendations come back on a Monday and not before;
//   - the round counts a room as quiet only when somebody is there to hear the silence.
// The rest, which needs the emulators and a browser, is test/ambassador-e2e.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ambassador, askKey, weekOf, AMB_OPS, isAmbOp, AMB_CRED, AMB_NEW, AMB_PASS_KINDS, AMB_CRED_WHY } from '../functions/ambassador.js';

const DAY = 86400000;

test('every op belongs to the desk, and nothing else does', () => {
  for (const op of AMB_OPS) assert.ok(isAmbOp(op), op + ' is an ambassador op');
  for (const op of ['rcMute', 'rcUnmute', 'cbMod', 'moderate', 'setAmb', 'ambassador', '', 'ambDeskish'])
    assert.ok(!isAmbOp(op), op + ' is not one of the desk ops');
});

test('the desk is the ambassador’s alone', async () => {
  /* the claim is the whole gate: it is checked before anything is read, so these need no database */
  const nobody = [{ uid: 'u1' }, { uid: 'u2', mod: true }, { uid: 'u3', admin: true }, { uid: 'u4', amb: false }];
  for (const who of nobody) for (const op of AMB_OPS) {
    await assert.rejects(() => ambassador(null, who, { op }, new Set(['mer'])),
      e => e.code === 'permission-denied' && /ambassadors have a desk/.test(e.message),
      `${op} is refused to ${JSON.stringify(who)}`);
  }
});

test('an ambassador cannot commend or greet their own nation', async () => {
  const who = { uid: 'u1', amb: true }, regions = new Set(['mer']);
  await assert.rejects(() => ambassador(null, who, { op: 'ambGreet', uid: 'u1' }, regions),
    e => /cannot greet your own nation/.test(e.message));
  await assert.rejects(() => ambassador(null, who, { op: 'ambCommend', uid: 'u1', why: 'civil', x: 'a good long line' }, regions),
    e => /cannot commend your own nation/.test(e.message));
});

test('a note and a commendation have to say what they are', async () => {
  const who = { uid: 'u1', amb: true }, regions = new Set(['mer']);
  await assert.rejects(() => ambassador(null, who, { op: 'ambPass', kind: 'whatever', x: 'a long enough line' }, regions),
    e => /what kind of note/.test(e.message), 'a kind outside the list is no kind');
  await assert.rejects(() => ambassador(null, who, { op: 'ambPass', kind: 'threat', x: 'too short' }, regions),
    e => /sentence or two/.test(e.message), 'a note has to say something');
  await assert.rejects(() => ambassador(null, who, { op: 'ambCommend', uid: 'u2', why: 'flattery', x: 'a good long line' }, regions),
    e => /what it is for/.test(e.message), 'a reason outside the list is no reason');
  await assert.rejects(() => ambassador(null, who, { op: 'ambAsk', x: 'eh?' }, regions),
    e => /in a few words/.test(e.message), 'a question has to be a question');
  /* the words the desk offers are the words the server will take */
  assert.deepEqual(Object.keys(AMB_PASS_KINDS), ['threat', 'scam', 'trouble', 'broken', 'silence']);
  assert.deepEqual(Object.keys(AMB_CRED_WHY), ['newcomer', 'answers', 'civil', 'made', 'own']);
});

test('one question tallies once, however it was worded', () => {
  const a = askKey('How do I move my capital?');
  assert.equal(a, askKey('how do i MOVE my Capital'), 'capitals and punctuation say nothing');
  assert.equal(a, askKey('my capital: how do i move it'), 'a rewording with the same long words is the same question');
  assert.equal(a, askKey('Capital! How do I move my capital?'), 'a word said twice is still one word');
  assert.notEqual(a, askKey('Where did my province loyalty go?'), 'a different question is a different tally');
  assert.ok(!a.split('-').some(w => ['do', 'my', 'the'].includes(w)), 'the short words are dropped, so word order cannot split a tally');
  assert.equal(askKey('?!'), '', 'nothing to count is no key');
});

test('the week’s commendations come back on a Monday', () => {
  const mon = Date.UTC(2026, 10, 23, 9), sun = Date.UTC(2026, 10, 22, 23), nextMon = Date.UTC(2026, 10, 30, 0, 1);
  assert.equal(weekOf(mon), weekOf(Date.UTC(2026, 10, 29, 23, 59)), 'Monday to Sunday is one week');
  assert.notEqual(weekOf(sun), weekOf(mon), 'the Sunday before belongs to the week before');
  assert.equal(weekOf(nextMon), weekOf(mon) + 1, 'the next Monday is the next week, and only then');
  assert.ok(AMB_CRED >= 1 && AMB_CRED <= 5, 'a handful a week, so a commendation keeps meaning something');
  assert.equal(AMB_NEW, 3 * DAY, 'a nation is newly founded for three days');
});

/* ── the round, as the page counts it ── */
const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const grab = (re, what) => { const m = re.exec(html); assert.ok(m, what + ' is in the game'); return m[0]; };
const fnOf = name => {
  const at = html.indexOf('\nfunction ' + name + '('); assert.ok(at >= 0, name + ' is in the game');
  const lines = html.slice(at + 1).split('\n'), out = [lines[0]];
  for (const l of lines.slice(1)) { out.push(l); if (l === '}') break; }
  return out.join('\n');
};
const ctx = vm.createContext({});
vm.runInContext([
  'const DAY=' + DAY + ';',
  grab(/const ambQuiet=[^\n]*\n/, 'ambQuiet'),
  grab(/const ambNew=[^\n]*\n/, 'ambNew'),
  grab(/const ambIn=[^\n]*\n/, 'ambIn'),
  fnOf('ambWaiting'),
  'const AMB={d:null};',
  'this.AMB=AMB;this.ambQuiet=ambQuiet;this.ambNew=ambNew;this.ambWaiting=ambWaiting;this.ambIn=ambIn;',
].join('\n'), ctx);

test('a room is quiet only when somebody is there to hear it', () => {
  const now = Date.now();
  ctx.AMB.d = { at: now, quiet: 6 * 3600000, newly: [], rooms: [], topics: [], silences: [] };
  const room = (online, agoHours) => ({ reg: 'mer', online, last: now - agoHours * 3600000, lines: 2 });
  assert.ok(ctx.ambQuiet(room(14, 9)), 'readers and no line for nine hours is a room to walk into');
  assert.ok(!ctx.ambQuiet(room(0, 40)), 'an empty room is not an ambassador’s problem');
  assert.ok(!ctx.ambQuiet(room(14, 1)), 'a room that spoke an hour ago is alive');
  assert.ok(!ctx.ambQuiet({ reg: 'mer', online: 9, last: 0, lines: 0 }), 'a chat with no line ever has nothing to be quiet about');
});

test('the round counts what is waiting on the ambassador, and nothing else', () => {
  const now = Date.now();
  ctx.AMB.d = { at: now, quiet: 6 * 3600000,
    newly: [{ uid: 'a', f: now - 3600000 }, { uid: 'b', f: now - 7200000, greeted: { by: 'x', nm: 'Velloria', t: now } }],
    rooms: [{ reg: 'mer', online: 14, last: now - 9 * 3600000, lines: 3 }, { reg: 'cor', online: 0, last: now - 50 * 3600000, lines: 0 }],
    topics: [{ id: 't1' }, { id: 't2' }], silences: [] };
  assert.equal(ctx.ambNew().length, 1, 'a nation another ambassador greeted is no longer waiting');
  assert.equal(ctx.ambWaiting(), 1 + 1 + 2, 'one to greet, one quiet room and two unanswered topics');
  ctx.AMB.d = null;
  assert.equal(ctx.ambWaiting(), 0, 'before the round is read, nothing is claimed to be waiting');
});

test('a silence that has not run out yet reads as a time still to come', () => {
  assert.match(ctx.ambIn(Date.now() + 40 * 60000), /^in \d+ min$/);
  assert.match(ctx.ambIn(Date.now() + 5 * 3600000), /^in \d+ h$/);
  assert.equal(ctx.ambIn(Date.now() - 1000), 'any moment', 'a time already past is not described as the future');
});

/* ── every page of the desk, drawn ──
   The desk is the one place an ambassador is told what the role is, so what matters is not only that each page
   draws without throwing but what is on it: a way to greet, answer and praise, and nothing at all that removes. */
const deskBlock = (() => {
  const a = html.indexOf('\nconst AMB_VIEWS=');
  const b = html.indexOf('\n/* the desk stands in front of the ordinary page');
  assert.ok(a >= 0 && b > a, 'the Ambassador\u2019s Desk is in the game');
  return html.slice(a, b);
})();
const desk = vm.createContext({ window: { claude: { use: () => Promise.resolve(null) } } });
vm.runInContext([
  'const DAY=' + DAY + ';const PV=false;',
  'const esc=v=>String(v==null?"":v).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]));',
  'const rel=t=>"a while ago";const fmtPop=p=>String(p)+"m";const fmtDate=t=>"a day";',
  'const regName=r=>({mer:"Meridian Reach",cor:"Coral Reach"}[r]||r);',
  'const REG={id:"mer",name:"Meridian Reach"};',
  'const admSkel=(n=6)=>"<div class=\\"adm-skel\\"></div>";',
  'const NAV_SVG=p=>"<svg>"+p+"</svg>";const NAV_IC_DEF="<svg></svg>";',
  'const ADM_MOBILE={matches:false};const S={isAmb:true,isMod:false,isOwner:false,mode:"world"};',
  'const render=()=>{};const toast=()=>{};const go=()=>{};const setTimeout=()=>0;',
  deskBlock,
  'this.AMB=AMB;this.ambView=ambView;this.AMB_VIEWS=AMB_VIEWS;this.S=S;this.ambWelcomeText=ambWelcomeText;',
].join('\n'), desk);

const round = (now = Date.now()) => ({ at: now, reg: 'mer', me: 'Envoyland', quiet: 6 * 3600000, span: 3 * DAY,
  newly: [{ uid: 'n1', name: 'Ashmoor', pop: 1.2, f: now - 4 * 3600000, t: now - 4 * 3600000, spoke: false }],
  rooms: [{ reg: 'mer', online: 14, last: now - 9 * 3600000, lines: 3 }, { reg: 'cor', online: 2, last: now - 600000, lines: 40 }],
  topics: [{ id: 't1', reg: 'mer', ti: 'Does anybody trade iron?', nm: 'Readerland', t: now - 2 * DAY, tg: 'trade' }],
  silences: [{ uid: 's1', nm: 'Tallowmere', why: 'Unkind', until: now + 23 * 3600000, t: now - 3600000, mine: true, perm: false }],
  cred: { left: 2, of: 3, week: 1 }, asks: [{ key: 'capital-how-move', x: 'How do I move my capital?', n: 41, la: now }] });

test('every page of the desk draws', () => {
  desk.AMB.d = round();
  desk.AMB.led = { at: Date.now(), silences: [{ uid: 's1', nm: 'Tallowmere', why: 'Unkind', reg: 'mer', t: Date.now() - 3600000, until: Date.now() + 3600000, perm: false, running: true }],
    notes: [{ id: 'x1', kind: 'threat', x: 'a threat in a letter', name: 'Mewstone', t: Date.now() - DAY, state: 'done', said: 'Banned for 30 days' }] };
  for (const v of desk.AMB_VIEWS) {
    const h = desk.ambView(v);
    assert.ok(h.length > 400, v + ' draws a page');
    assert.match(h, /class="adm amb"/, v + ' draws in the portal shell');
    assert.match(h, /Ambassador&rsquo;s desk|Ambassador<\/span>/, v + ' says whose desk it is');
    assert.ok(!/undefined|NaN|\[object Object\]/.test(h), v + ' has no gaps in it: ' + (h.match(/.{0,40}(undefined|NaN).{0,40}/) || [''])[0]);
  }
});

test('an empty desk draws too, before the round has been read', () => {
  desk.AMB.d = null; desk.AMB.led = null;
  for (const v of desk.AMB_VIEWS) {
    const h = desk.ambView(v);
    assert.ok(h.length > 300, v + ' draws before anything is loaded');
    assert.ok(!/undefined|NaN/.test(h), v + ' says nothing it does not know');
  }
  desk.AMB.d = round();
});

test('the desk offers nothing that takes anything away', () => {
  desk.AMB.d = round();
  const all = desk.AMB_VIEWS.map(v => desk.ambView(v)).join('\n');
  /* the buttons of the desk, as a reader would read them */
  const buttons = [...all.matchAll(/<button[^>]*>([^<]*)</g)].map(m => m[1].trim());
  for (const b of buttons) assert.ok(!/^(Remove|Delete|Hide|Ban|Lift|Unsilence)/i.test(b), 'the desk has no button that reads "' + b + '"');
  assert.ok(buttons.some(b => /welcome/i.test(b)), 'it can greet');
  assert.ok(buttons.some(b => /commend/i.test(b)), 'it can praise');
  assert.ok(buttons.some(b => /moderator/i.test(b)), 'it can hand something up');
  assert.match(all, /only a moderator can lift it/, 'and it says who lifts a silence');
});

test('the welcome letter is written in the ambassador\u2019s own words, not the game\u2019s', () => {
  const x = desk.ambWelcomeText('Ashmoor');
  assert.match(x, /Welcome to Meridian Reach, Ashmoor\./, 'it names the nation and the region');
  assert.match(x, /capital/, 'it says what to do first');
  assert.ok(!/—/.test(x), 'and says it without a dash');
});
