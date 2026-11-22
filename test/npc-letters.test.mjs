// Computer nations' letters about trade: what a letter asks for (npcAsk), the deals they propose (npcDealFor, npcIdea's
// and the replies' terms) always being ones their own Board of Trade would sign (npcVerdict) within both sides' daily
// spare, and their answers (npcTradeTalk, npcReply) saying what they can and cannot do. Evaluated from the game's own
// source with a made-up economy. Run with: node --test test/npc-letters.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8'), src = html.match(/<script>([\s\S]*)<\/script>\s*$/)[1];
const fn = name => { const i = src.indexOf('function ' + name + '('), j = src.indexOf('\n}\n', i); assert.ok(i >= 0 && j > i, name); return src.slice(i, j + 2); };
const line = start => { const i = src.indexOf(start), j = src.indexOf('\n', i); assert.ok(i >= 0, start); return src.slice(i, j); };
const span = (start, end) => { const i = src.indexOf(start), j = src.indexOf(end, i); assert.ok(i >= 0 && j > i, start); return src.slice(i, j + end.length); };

const ctx = vm.createContext({});
vm.runInContext(`${line('const RES=')}
${line('const clamp = ')}
${line('function list(a)')}
${line('function hexWord(k)')}
${line('function gwWord(v)')}
${line('function spareOf(E,id,res)')}
${line('function npcWant(id,g,r)')}
${line('const C3_QMAX=')}
const RES_INFO={food:['Food'],timber:['Timber'],iron:['Iron'],oil:['Oil'],goods:['Goods']};
${line('const resName=')}
${line('const fmtAmt=')}
${span('const NPC_RES_W=', '\n')}
${span('const NPC_ASK_RX=[', ']];')}
${fn('npcAsk')}${fn('npcVerdict')}${fn('npcDealFor')}
${line('const npcTerms=')}
${line('const npcIdeaAtt=')}
${fn('npcTradeTalk')}${fn('npcDealNews')}${fn('npcReply')}
const ALLY_MIN=65,NPC_BLOCS=[{id:'bloc-iron',name:'The Iron Compact',members:['npc-bloc']}];
let E=null,W={war:false},GW=0,SLOTS=0,AFF=50,HELD=0,ARMY=[1,1];
const S={nation:{name:'Fernwick',gw:{}}};
const myId=()=>'me',economy=()=>E,warWith=()=>W,gwOf=()=>GW,dealSlots=()=>SLOTS,maxDeals=()=>12,nameOf=id=>id==='npc-a'?'Avalon':id;
const cuTradeQuote=()=>({factor:1}),asmMarkTrade=()=>1,famDeal=()=>1,sameAlliance=()=>false,affinity=()=>AFF;
const npcVoice=()=>({sign:'The Board, Avalon',open:'Thank you for writing.',lines:['We will consider it.']}),hash=s=>[...String(s)].reduce((a,c)=>(a*31+c.charCodeAt(0))>>>0,7);
const NPC_BY_ID={'npc-a':{name:'Avalon',pretitle:'Kingdom',capital:'Camelot',leader:'High King',motto:'Swords Before Words'}},findNation=id=>({n:NPC_BY_ID[id]||{name:id}});
const territory=()=>({byId:{me:0,'npc-a':1}}),occupiedFrom=()=>Array(HELD).fill(0),armyPower=n=>n===S.nation?ARMY[0]:ARMY[1];
this.api={npcAsk,npcVerdict,npcDealFor,npcTradeTalk,npcReply,npcDealNews,RES,set:(o)=>{if('E'in o)E=o.E;if('W'in o)W=o.W;if('GW'in o)GW=o.GW;if('SLOTS'in o)SLOTS=o.SLOTS;if('AFF'in o)AFF=o.AFF;if('HELD'in o)HELD=o.HELD;if('ARMY'in o)ARMY=o.ARMY;}};`, ctx);
const { npcAsk, npcVerdict, npcDealFor, npcTradeTalk, npcReply, RES, set } = ctx.api;
const plain = o => JSON.parse(JSON.stringify(o));

/* an economy of two nations, the player (0) and Avalon (1): sup and dem per material; ratio and price worked out as the
   game does */
function econ(sup, dem, price = {}, active = []) {
  const E = { T: { byId: { me: 0, 'npc-a': 1 } }, sup: {}, dem: {}, ratio: {}, price: {}, active };
  for (const r of RES) {
    E.sup[r] = Float64Array.from(sup[r] || [5, 5]); E.dem[r] = Float64Array.from(dem[r] || [5, 5]);
    E.ratio[r] = Float64Array.from([0, 1].map(i => E.dem[r][i] > 0 ? E.sup[r][i] / E.dem[r][i] : 1));
    E.price[r] = price[r] || 1;
  }
  return E;
}
const rnd = (seed => () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32)(42);
const randomEcon = () => {
  const sup = {}, dem = {}, price = {};
  for (const r of RES) { dem[r] = [1 + rnd() * 12, 1 + rnd() * 12]; sup[r] = dem[r].map(d => d * (0.4 + rnd() * 1.4)); price[r] = 0.4 + rnd() * 2.6; }
  return econ(sup, dem, price);
};

test('a letter’s materials: what is asked for, what is offered, and how much', () => {
  const t = s => { const q = npcAsk(s); return [q.get, q.pay, q.n]; };
  assert.deepEqual(t('We need iron. We have plenty of food.'), ['iron', 'food', 0]);
  assert.deepEqual(t('Can you spare 6 oil a day?'), ['oil', '', 6]);
  assert.deepEqual(t('Do you need timber? We have too much of it.'), ['', 'timber', 0]);
  assert.deepEqual(t('I want to trade food for iron'), ['iron', 'food', 0]);
  assert.deepEqual(t('Could you sell us steel for our grain?'), ['iron', 'food', 0]);
  assert.deepEqual(t('Our wood for your fuel'), ['oil', 'timber', 0]);
  assert.deepEqual(t('We are short of food and oil'), ['food', '', 0]);
  assert.deepEqual(t('We’re looking for 4 tons of iron, and can give you goods in return'), ['iron', 'goods', 4]);
  assert.deepEqual(t('Send food, please'), ['food', '', 0]);
  assert.deepEqual(t('Would you like some goods?'), ['', 'goods', 0]);
  assert.deepEqual(t('Hello from Hollywood!'), ['', '', 0]);
  assert.equal(npcAsk('How are you?').any, false);
});

test('every deal a computer nation proposes is one its Board of Trade signs, within both sides’ daily spare', () => {
  let found = 0, asked = 0;
  for (let k = 0; k < 400; k++) {
    const E = randomEcon(); set({ E, GW: 0, W: { war: false } });
    for (const o of [{}, { get: 'iron' }, { pay: 'food' }, { get: 'oil', pay: 'goods' }, { get: 'timber', n: 3 }]) {
      asked++;
      const d = npcDealFor('npc-a', o); if (!d) continue; found++;
      const v = npcVerdict('npc-a', plain(d.g), plain(d.r));
      assert.ok(v.ok, `${JSON.stringify(o)} → ${JSON.stringify(d)}: ${v.why}`);
      assert.ok(d.g[1] <= E.sup[d.g[0]][0] - E.dem[d.g[0]][0] + 1e-9, 'the player can spare what it gives');
      assert.ok(d.r[1] <= E.sup[d.r[0]][1] - E.dem[d.r[0]][1] + 1e-9, 'the computer nation can spare what it sends');
      assert.ok(d.r[1] >= 0.5 && d.g[1] >= 0.5 && d.r[1] * 2 === Math.round(d.r[1] * 2) && d.g[1] * 2 === Math.round(d.g[1] * 2), 'whole half-units');
      assert.ok(d.r[1] <= 8, 'no more than 8 a day');
      if (o.get) assert.equal(d.r[0], o.get); if (o.pay) assert.equal(d.g[0], o.pay); if (o.n) assert.ok(d.r[1] <= o.n);
      assert.ok(E.ratio[d.g[0]][1] <= 1.3, 'never for a material it already has more than enough of');
    }
  }
  assert.ok(found > asked / 5, `deals are found often enough to matter (${found} of ${asked})`);
});

test('no deal from a nation with nothing to spare, at war, or hostile, nor one already running', () => {
  const short = econ({ food: [9, 1], timber: [9, 1], iron: [9, 1], oil: [9, 1], goods: [9, 1] }, {});
  set({ E: short }); assert.equal(npcDealFor('npc-a'), null, 'it has nothing to spare');
  const rich = econ({ food: [9, 9], timber: [2, 9], iron: [9, 2], oil: [5, 5], goods: [5, 5] }, {});
  set({ E: rich }); const d = npcDealFor('npc-a'); assert.deepEqual(plain(d.r[0]), 'timber'); assert.equal(d.g[0], 'iron');
  set({ W: { war: true } }); assert.equal(npcDealFor('npc-a'), null, 'at war'); set({ W: { war: false }, GW: -30 });
  assert.equal(npcDealFor('npc-a'), null, 'hostile'); set({ GW: 0 });
  set({ E: econ({ food: [9, 9], timber: [2, 9], iron: [9, 2], oil: [5, 5], goods: [5, 5] }, {}, {}, [{ a: 'me', b: 'npc-a', ag: ['iron', 2], bg: ['timber', 2] }]) });
  const again = npcDealFor('npc-a'); assert.ok(!again || !(again.g[0] === 'iron' && again.r[0] === 'timber'), 'the pair already running is not proposed again');
});

test('a trade answer says what cannot be done and attaches terms that can', () => {
  const E = econ({ food: [9, 9], timber: [2, 9], iron: [9, 2], oil: [5, 5], goods: [5, 5] }, {}); set({ E, GW: 0, W: { war: false }, SLOTS: 0 });
  let t = npcTradeTalk('npc-a', npcAsk('Can you spare some oil? We have iron.'), {});
  assert.match(t.lines.join(' '), /We have no oil to spare/);
  assert.match(t.lines.join(' '), /Instead, we could send you \d+(\.5)? timber a day for \d+(\.5)? iron a day/);
  assert.equal(t.a.k, 'idea'); assert.equal(t.a.g[0], 'timber'); assert.equal(t.a.r[0], 'iron');
  assert.ok(npcVerdict('npc-a', plain(t.a.r), plain(t.a.g)).ok, 'the attached terms are signable');
  t = npcTradeTalk('npc-a', npcAsk('We need 20 timber'), {});
  assert.match(t.lines.join(' '), /We can spare only 4 timber a day, not 20/);
  t = npcTradeTalk('npc-a', npcAsk('Do you need food?'), {});
  assert.match(t.lines.join(' '), /We have all the food we need/);
  t = npcTradeTalk('npc-a', npcAsk('what do you need?'), { need: true });
  assert.match(t.lines[0], /Just now we are short of iron, and we can spare food and timber\./);
  set({ SLOTS: 12 }); t = npcTradeTalk('npc-a', npcAsk('timber please'), {});
  assert.match(t.lines.join(' '), /every one of your deal slots is taken/); set({ SLOTS: 0 });
  set({ E: econ({ food: [5, 9], timber: [5, 9], iron: [5, 9], oil: [5, 9], goods: [5, 9] }, {}) });
  t = npcTradeTalk('npc-a', npcAsk('trade?'), {});
  assert.equal(t.a, undefined); assert.match(t.lines.join(' '), /there is no deal between us today/);
});

test('replies: peace as it really stands, threats by the armies, who they are, and a question they cannot answer', () => {
  set({ E: econ({ food: [9, 9], timber: [2, 9], iron: [9, 2] }, {}), GW: 0, W: { war: true, direct: true }, HELD: 3 });
  let r = npcReply('npc-a', 'Can we have peace?', 1, '');
  assert.match(r.x, /no peace while your troops hold 3 hexes of our land/);
  set({ HELD: 0 }); r = npcReply('npc-a', 'Let us make peace', 1, '');
  assert.match(r.x, /Offer it on current lines/);
  r = npcReply('npc-a', 'We need iron', 1, ''); assert.match(r.x, /except about peace/); assert.equal(r.a, undefined, 'no trade at war');
  set({ W: { war: true, direct: true, theyOffered: true } }); r = npcReply('npc-a', 'peace?', 1, ''); assert.match(r.x, /already offered peace/);
  set({ W: { war: false } }); r = npcReply('npc-a', 'peace', 1, '', { k: 'peace' }); assert.match(r.x, /signed the peace you sent/);
  r = npcReply('npc-a', 'We need timber. We can give you iron.', 1, '');
  assert.match(r.x, /We can send you \d+(\.5)? timber a day for \d+(\.5)? iron a day/); assert.equal(r.a.k, 'idea');
  r = npcReply('npc-a', 'How is our deal going?', 1, ''); assert.ok(!/deal \(/.test(r.x));
  set({ ARMY: [1, 3] }); r = npcReply('npc-a', 'We will invade you', 1, ''); assert.match(r.x, /Our army is larger than yours/);
  set({ ARMY: [3, 1] }); r = npcReply('npc-a', 'demands', 1, 'ultim'); assert.match(r.x, /doubled the guard/);
  r = npcReply('npc-a', 'Who are you?', 1, ''); assert.match(r.x, /We are the Kingdom of Avalon, governed from Camelot by the High King\. Our motto: “Swords Before Words”/);
  r = npcReply('npc-a', 'What is the airspeed of a swallow?', 1, ''); assert.match(r.x, /not sure what you ask/);
  r = npcReply('npc-a', 'How are you?', 1, ''); assert.match(r.x, /We are well/);
  set({ GW: -15 }); r = npcReply('npc-a', 'Hello', 1, ''); assert.match(r.x, /Relations between us are frosty/);
  set({ GW: -30 }); r = npcReply('npc-a', 'We need timber', 1, ''); assert.match(r.x, /do not trade with a nation we regard as hostile/); assert.equal(r.a, undefined);
  set({ GW: 0, AFF: 80 }); r = npcReply('npc-a', 'Join our alliance', 1, '', { k: 'ally', id: 'x' }); assert.match(r.x, /take up your invitation gladly/);
  r = npcReply('npc-bloc', 'Join our alliance', 1, ''); assert.match(r.x, /sworn to The Iron Compact/);
  r = npcReply('npc-a', 'Fernwick sends its greetings to Avalon', 1, ''); assert.equal(r.a, undefined, 'the nations’ names are not materials');
});
