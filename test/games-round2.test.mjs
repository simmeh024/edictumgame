// The Games, round two (game/edictum.html, "the Games, round two"): training paid for in materials, tactics against a
// roll on the day that counts only once the Games are over (and only from GAMES_V2, so older podiums stay as they were),
// boycotts, the host's swap of one drawn event, the mascot, the region chat's Games lines and the save's new fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
function line(start) {
  const at = html.indexOf('\n' + start);
  assert.ok(at >= 0, start + ' is found');
  return html.slice(at + 1, html.indexOf('\n', at + 1));
}
const WEEK = 7 * 864e5, EPOCH = Date.UTC(2026, 0, 5), V2 = +line('const GAMES_V2=').match(/GAMES_V2=(\d+)/)[1];
const EVENTS = ['national', 'athletics', 'olympiad', 'cookery', 'song', 'chess', 'regatta', 'strongman', 'architecture', 'debate', 'tattoo'];
const COMMON = `
  const GAMES_EPOCH=${EPOCH},GAMES_WEEK=${WEEK},HOST_BONUS=8,FOCUS_BONUS=10,DAY=864e5,RGC_SHOW=60;
  const GAME_EVENTS=Object.fromEntries(${JSON.stringify(EVENTS)}.map(k=>[k,{n:k==='national'?'':k[0].toUpperCase()+k.slice(1),f:s=>s.x||0}]));
  const edOf=t=>Math.floor((t-GAMES_EPOCH)/GAMES_WEEK),edStart=e=>GAMES_EPOCH+e*GAMES_WEEK;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  ${fn('hash')}
  ${line('const GAMES_V2=')}
  ${line('const TRAIN_COST=')}
  ${line('const GTAC=')}
  ${line('const gmTrPts=')}
  ${line('const gmTrUsed=')}
  ${fn('gmTrCost')}
  ${line('const gmRoll=')}
  ${line('const gmDay=')}
  ${line('const GM_MASC=')}
  ${line('const gmMsOk=')}
  ${line('const gmEvOk=')}
  ${line('const GM_NAMES=')}
  ${fn('gmTrClean')}
  ${fn('gmTacClean')}
  ${fn('gmSwapParse')}
  ${fn('gmDish')}
  ${fn('gmMascOf')}
`;
function ctx(extra, globals) {
  const c = vm.createContext(Object.assign({}, globals || {}));
  vm.runInContext(COMMON + extra, c);
  return c;
}

test('training: sessions cleaned to known events and at most three in all, each dearer than the last', () => {
  const C = ctx(`this.r={
    a:gmTrClean({chess:2,regatta:5,bogus:1,constructor:1}),b:gmTrClean({}),c:gmTrClean('x'),d:gmTrClean({song:-1,olympiad:1.7}),
    used:gmTrUsed({chess:2,regatta:1}),pts:gmTrPts({chess:2},'chess'),none:gmTrPts(null,'chess'),
    c0:gmTrCost('cookery',0),c1:gmTrCost('cookery',1),c2:gmTrCost('cookery',2),odd:gmTrCost('nothing',0)};`);
  const r = C.r;
  assert.equal(r.a.chess + (r.a.regatta || 0), 3, 'never more than three sessions in all');
  assert.equal(r.a.bogus, undefined, 'unknown events are dropped');
  assert.ok(!Object.prototype.hasOwnProperty.call(r.a, 'constructor'), 'and so are names every object inherits');
  assert.equal(r.b, null); assert.equal(r.c, null);
  assert.deepEqual({ ...r.d }, { olympiad: 1 }, 'whole sessions only, nothing negative');
  assert.equal(r.used, 3); assert.equal(r.pts, 6); assert.equal(r.none, 0);
  assert.deepEqual([r.c0.food, r.c1.food, r.c2.food], [40, 60, 80], 'each session costs half the first more than the one before');
  assert.deepEqual({ ...r.odd }, { goods: 20 }, 'an event without its own cost falls back to goods');
});

test('tactics: only play safe and go for broke are kept; the day rolls within their spread, and never before GAMES_V2', () => {
  const C = ctx(`
    const ids=[...Array(400)].map((_,i)=>'n'+i),max=t=>Math.max(...ids.map(id=>Math.abs(gmDay(id,GAMES_V2+1,'chess',t))));
    this.r={clean:gmTacClean({chess:'b',song:'s',regatta:'x',bogus:'b'}),none:gmTacClean({chess:''}),
      safe:max('s'),steady:max(''),broke:max('b'),odd:max('zzz'),before:ids.map(id=>gmDay(id,GAMES_V2-1,'chess','b')).every(v=>v===0),
      same:gmDay('ada',GAMES_V2,'chess','b')===gmDay('ada',GAMES_V2,'chess','b'),
      spread:new Set(ids.map(id=>Math.round(gmDay(id,GAMES_V2,'chess','b')))).size};`);
  const r = C.r;
  assert.deepEqual({ ...r.clean }, { chess: 'b', song: 's' });
  assert.equal(r.none, null);
  assert.ok(r.safe <= 1 && r.safe > 0.9, 'play safe swings at most 1');
  assert.ok(r.steady <= 4 && r.steady > 3.6, 'steady swings at most 4');
  assert.ok(r.broke <= 14 && r.broke > 12.5, 'go for broke swings at most 14');
  assert.equal(r.odd, r.steady, 'an unknown tactic counts as steady');
  assert.ok(r.before, 'editions before GAMES_V2 have no roll on the day');
  assert.ok(r.same, 'the same for every reader');
  assert.ok(r.spread > 20, 'and spread over the whole range');
});

/* gamesResults with one event scored straight from the entry; nations: [{id, npc, n}] */
function results(nations, now, host) {
  const C = ctx(`
    const STAT_KEYS=['x'],b1Now=()=>NOW,allNations=()=>NATIONS,entryOf=(n,e)=>((n&&n.games&&n.games.en)||[]).find(q=>q.e===e);
    const gamesHost=()=>HOST,edEvents=()=>['chess'],gamesBids=()=>[],npcAt=()=>null,dqOf=()=>false,formOf=()=>0;
    const baseScores=(n,id,f,tr)=>({chess:(n.s.x||0)+gmTrPts(tr,'chess')});
    ${fn('gamesStatsAt')}
    let gamesMemo={k:'',v:null};
    ${fn('gamesResults')}
    this.R=gamesResults;`, { NOW: now, NATIONS: nations, HOST: host || { id: 'nobody' } });
  return C.R;
}
const player = (id, e, sc, extra) => ({ id, n: { name: id, s: { x: 100 }, games: { en: [Object.assign({ e, t: EPOCH + e * WEEK + 3600e3, f: '', sc: { chess: sc } }, extra || {})] }, hist: [] } });

test('the week under way shows scores before the day; once it is over the day is added, by each team\'s tactics', () => {
  const e = V2 + 1, ada = player('ada', e, 60, { m: { chess: 'b' } }), bo = player('bo', e, 60, { m: { chess: 's' } }), cy = player('cy', e, 60);
  const during = results([ada, bo, cy], EPOCH + e * WEEK + 2 * 864e5)(e), after = results([ada, bo, cy], EPOCH + (e + 1) * WEEK + 864e5)(e);
  const by = R => Object.fromEntries(R.res.chess.map(r => [r.p.id, r]));
  const D = by(during), A = by(after);
  for (const id of ['ada', 'bo', 'cy']) {
    assert.equal(D[id].d, 0, id + ': no roll while the week is under way');
    assert.equal(D[id].v, D[id].b, id + ': the score shown is the score before the day');
    assert.equal(A[id].b, D[id].b, id + ': the score before the day does not change');
    assert.ok(Math.abs(A[id].v - Math.max(0, A[id].b + A[id].d)) < 0.101, id + ': the result is the score before the day plus the day');
  }
  assert.ok(Math.abs(A.ada.d) <= 14 && Math.abs(A.bo.d) <= 1 && Math.abs(A.cy.d) <= 4, 'each roll within its tactic');
});

test('an edition before GAMES_V2 keeps its podium exactly as it was', () => {
  const e = V2 - 3, ada = player('ada', e, 61), bo = player('bo', e, 60, { m: { chess: 'b' } });
  const R = results([ada, bo], EPOCH + (e + 5) * WEEK)(e);
  assert.deepEqual([...R.res.chess.map(r => [r.p.id, r.v, r.d])], [['ada', 61, 0], ['bo', 60, 0]]);
});

test('a team that stays home is in no event and is listed apart; the host never stays home from its own Games', () => {
  const e = V2 + 1, ada = player('ada', e, 70, { bo: 1, bt: EPOCH + e * WEEK + 5e6 }), bo = player('bo', e, 60, { bo: 2, bt: 1 }), cy = player('cy', e, 50), host = player('host', e, 40, { bo: 1, bt: 1 });
  const R = results([ada, bo, cy, host], EPOCH + e * WEEK + 864e5, { id: 'host' })(e);
  assert.deepEqual([...R.res.chess.map(r => r.p.id)], ['cy', 'host'], 'only the teams that went compete (the host with its home bonus: 40 + 8)');
  assert.deepEqual([...R.boy.map(b => [b.id, b.bo])], [['ada', 1], ['bo', 2]]);
});

test('training counts within the stats cap, so a session paid for is never capped away', () => {
  const e = V2 + 1, ada = player('ada', e, 109, { tr: { chess: 3 } });
  const R = results([ada], EPOCH + e * WEEK + 864e5)(e);
  assert.equal(R.res.chess[0].b, 109, 'stats 100 + 9 from training is allowed');
  const forged = player('bo', e, 120, { tr: { chess: 3 } });
  assert.equal(results([forged], EPOCH + e * WEEK + 864e5)(e).res.chess[0].b, 112, 'a forged score still stops at stats + training + 3');
});

test('the host\'s swap: one drawn event for one not drawn, set before its week, from GAMES_V2', () => {
  const run = (e, sw, st) => {
    const C = ctx(`
      const BIDS=${JSON.stringify(sw ? [{ id: 'h', sw, st }] : [])},gamesBids=()=>BIDS,rng=s=>{let x=s||1;return ()=>((x=Math.imul(x^x>>>15,2246822507)>>>0)%1e6)/1e6;};
      ${fn('edDrawn')}
      ${fn('gmSwapOf')}
      ${fn('edEvents')}
      this.r={d:edDrawn(${e}),v:edEvents(${e})};`);
    return C.r;
  };
  const e = V2 + 2, base = run(e).d, out = base[2], notIn = EVENTS.find(k => k !== 'national' && !base.includes(k));
  assert.equal(base[0], 'national');
  const ok = run(e, out + '>' + notIn, EPOCH + e * WEEK - 1000);
  assert.deepEqual([...ok.v], [...base.map(k => k === out ? notIn : k)], 'swapped in place');
  assert.deepEqual([...run(e, out + '>' + notIn, EPOCH + e * WEEK + 1000).v], [...base], 'a swap set after the week began is ignored');
  assert.deepEqual([...run(e, out + '>' + base[3], EPOCH).v], [...base], 'an event already drawn cannot come in twice');
  assert.deepEqual([...run(e, 'national>' + notIn, EPOCH).v], [...base], 'the national sport stays');
  assert.deepEqual([...run(e, out + '>constructor', EPOCH).v], [...base], 'a name every object inherits is no event');
  assert.deepEqual([...run(V2 - 1, out + '>' + notIn, EPOCH).v], [...run(V2 - 1).d], 'not before GAMES_V2');
});

test('the mascot: chosen from the lists on the bid, else one of them by the week and the host', () => {
  const C = ctx(`const gamesBids=()=>[];this.r={
    a:gmMascOf(50,{id:'h1',player:true,n:{}},{ms:'star',mn:'Pip'}),b:gmMascOf(50,{id:'h1',player:true,n:{}},{ms:'nope',mn:'Bob'}),
    c:gmMascOf(50,{id:'h1',player:true,n:{}},null),d:gmMascOf(51,{id:'h1',player:true,n:{}},null),
    bowl:gmMascOf(50,{id:'h1',player:true,n:{dish:'eel pie'}},{ms:'bowl',mn:'Biscuit'}),names:GM_NAMES,masc:GM_MASC};`);
  const r = C.r;
  assert.deepEqual([r.a.k, r.a.nm, r.a.label], ['star', 'Pip', 'Pip the Star']);
  assert.equal(r.b.k, r.c.k, 'an unknown choice falls back to the default'); assert.equal(r.b.nm, r.c.nm);
  assert.ok(r.names.includes(r.c.nm) && r.masc[r.c.k]);
  assert.ok(r.c.k !== r.d.k || r.c.nm !== r.d.nm, 'another week, another default');
  assert.equal(r.bowl.label, 'Biscuit, a bowl of eel pie');
});

test('the save keeps training, tactics, boycotts and the host\'s choices, and drops what it cannot know', () => {
  const C = ctx(`${fn('normGames')}this.N=normGames;`);
  const g = C.N({ games: {
    en: [{ e: 50, t: 5, f: 'chess', sc: { chess: 50 }, tr: { chess: 2, song: 4 }, m: { chess: 'b', song: 'q' }, bo: 1, bt: 9, bg: 1 }, { e: 51, t: 6, sc: { chess: 1 }, bo: 7 }],
    bids: [{ e: 52, t: 1, s: 90, sw: 'chess>regatta', st: 3, ms: 'sun', mn: 'Pip' }, { e: 53, t: 1, s: 9, sw: 'national>chess', ms: 'robot', mn: 'Eve' }, { e: 54, t: 1, s: 9, sw: 'chess>__proto__', ms: '__proto__' }] } });
  assert.deepEqual({ ...g.en[0].tr }, { chess: 2, song: 1 });
  assert.deepEqual({ ...g.en[0].m }, { chess: 'b' });
  assert.deepEqual([g.en[0].bo, g.en[0].bt, g.en[0].bg], [1, 9, 1]);
  assert.equal(g.en[1].bo, undefined, 'an unknown boycott kind is dropped');
  assert.deepEqual([g.bids[0].sw, g.bids[0].st, g.bids[0].ms, g.bids[0].mn], ['chess>regatta', 3, 'sun', 'Pip']);
  assert.deepEqual([g.bids[1].sw, g.bids[1].ms, g.bids[1].mn], [undefined, undefined, undefined]);
  assert.deepEqual([g.bids[2].sw, g.bids[2].ms], [undefined, undefined], 'inherited names are no event and no mascot');
});

test('the region chat: Games lines go in by time, never above the first line of a full window', () => {
  const C = ctx(`
    const S={nation:{}},Date={now:()=>NOW},L=[{id:'a',t:100,sys:'games'},{id:'b',t:300,sys:'games'},{id:'c',t:900,sys:'games'}],gmChatLines=()=>L;
    ${fn('gmChatMix')}
    this.mix=gmChatMix;`, { NOW: 1000 });
  const few = [{ id: 'x', t: 200 }, { id: 'y', t: 800 }];
  assert.deepEqual(C.mix(few).map(m => m.id), ['a', 'x', 'b', 'y', 'c']);
  const full = Array.from({ length: 60 }, (_, i) => ({ id: 'm' + i, t: 250 + i }));
  const m = C.mix(full).map(x => x.id);
  assert.ok(!m.includes('a'), 'a line older than a full window is left out');
  assert.ok(m.includes('b') && m.includes('c'));
  assert.deepEqual(C.mix(C.mix(few)).map(x => x.id), ['a', 'x', 'b', 'y', 'c'], 'mixing twice adds nothing twice');
});

test('the page, the chat and the Dispatch are wired in', () => {
  assert.match(html, /if\(m\.sys==='games'\)return gmChatLine\(m\);/, 'rgcLine draws the Games lines');
  assert.match(html, /vis=tab==='region'\?gmChatMix\(vis1\):vis1/, 'only the region tab has them');
  assert.match(html, /try\{dspGames2\(C,st\);\}catch\(e\)\{\}/, 'the Dispatch reads them');
  assert.match(html, /\$\{gmOpeningHTML\(e,host\)\}/, 'the opening ceremony heads the Games page');
  assert.match(html, /if\(\(entryOf\(n,e\)\|\|\{\}\)\.bo&&gamesHost\(e\)\.id!==myId\(\)\)continue;/, 'a Games stayed home from does not count as taking part');
});
