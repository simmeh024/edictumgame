/* The player survey (28 Nov 2026): its questions, the rules that pick who is asked, and the checks on what comes back.
   One place for all of it: the server sends a player their questions with the invitation (functions/survey.js), checks
   the answers against the same list, and the admin portal's Player survey page reads the list to label its results and
   its Excel download. A question's id and its answers' ids are what the records keep, so they never change once the
   survey is open; a label may be reworded.

   Kinds: one (a single answer; `other` opens a short text box), many (up to `max`; `solo` stands alone, like "none"),
   scale (a whole number lo..hi, its two ends labelled), text (open words). `why` adds an optional "why?" box to a one,
   `sub` a follow-up on the same screen, asked only after the answer in `when`. Core questions go to everyone; each
   player also gets `draw` of the others (the admin portal sets how many, 2 at first). */
export const SV_ID = 's1';
export const SV_TITLE = 'Edictum player survey';
export const SV_MIN = 50;              // the engagement score (functions/stats.js, 0..100) a player needs to be asked
export const SV_AGE = 7 * 86400000;    // and a nation at least a week old
export const SV_SHARE = 0.25;          // the chance an eligible player is drawn on a given day
export const SV_DRAW = 2;              // questions drawn for each player from the ones not in the core
export const SV_LATER = 2;             // "Ask me tomorrow" at most twice
export const SV_TEXT = 300, SV_OTHER = 80;

const PARTS = [['edicts', 'Edicts and their stories'], ['economy', 'Cities, buildings and the economy'], ['map', 'The map, land and borders'],
  ['war', 'War'], ['diplomacy', 'Alliances, treaties and diplomacy'], ['talk', 'Chat, letters and the Community Board'],
  ['studios', 'Designing my flag, arms, currency and notes'], ['research', 'Research'], ['sea', 'Expeditions, the deep sea and the Moon'],
  ['assembly', 'The World Assembly and its Council'], ['games', 'The Games and their medals'], ['ranks', 'Rankings, honours and statistics']];
const opts = list => list.map(([v, t, x]) => ({ v, t, ...(x || {}) }));

export const SV_QS = [
  { id: 'ruler', core: true, k: 'one', q: 'What kind of ruler are you?',
    o: opts([['builder', 'A builder: I grow my cities and my economy'], ['diplomat', 'A diplomat: alliances, treaties and deals'], ['conqueror', 'A conqueror: land and war'],
      ['storyteller', 'A storyteller: my nation’s story and character'], ['collector', 'A collector: honours, designs and the museum'], ['optimiser', 'An optimiser: I work out the best way to play']]) },
  { id: 'love', core: true, k: 'many', max: 3, q: 'Which parts of Edictum do you enjoy most?', h: 'Pick up to 3.', o: opts(PARTS) },
  { id: 'chore', core: true, k: 'many', max: 3, q: 'Which parts feel like a chore, or do you skip?', h: 'Pick up to 3.',
    o: opts([...PARTS, ['none', 'Nothing feels like a chore', { solo: 1 }]]) },
  { id: 'back', core: true, k: 'one', q: 'What brings you back to Edictum most?',
    o: opts([['story', 'The edicts and their story'], ['grow', 'Watching my nation grow'], ['people', 'My alliance and my friends here'], ['compete', 'Competing and the rankings'],
      ['rewards', 'Rewards and things to collect'], ['habit', 'Habit: it is part of my day'], ['other', 'Something else', { other: 1 }]]) },
  { id: 'pace', core: true, k: 'one', q: 'How does the pace of the game feel?', o: opts([['slow', 'Too slow'], ['right', 'About right'], ['fast', 'Too fast']]) },
  { id: 'src', k: 'one', q: 'How did you first hear about Edictum?',
    o: opts([['friend', 'A friend, or another player’s invitation link'], ['discord', 'Discord'], ['search', 'A search engine'], ['social', 'Social media: Reddit, TikTok, YouTube and the like'],
      ['othergame', 'Another game’s community or forum'], ['other', 'Somewhere else', { other: 1 }]]) },
  { id: 'len', k: 'one', q: 'How long do you usually play at a time?', o: opts([['u5', 'Under 5 minutes'], ['m15', '5 to 15 minutes'], ['m45', '15 to 45 minutes'], ['long', 'Longer than 45 minutes']]) },
  { id: 'when', k: 'many', max: 6, q: 'When do you usually play?', h: 'Pick all that fit.',
    o: opts([['morning', 'A look in the morning'], ['breaks', 'In breaks during the day'], ['evening', 'In the evening'], ['night', 'Late at night'],
      ['allday', 'It stays open all day and I look in now and then'], ['weekend', 'Mostly at weekends']]) },
  { id: 'rp', k: 'one', q: 'Do you roleplay your nation: write its story, or speak in character?', o: opts([['lot', 'Yes, a lot'], ['some', 'Sometimes'], ['no', 'No']]) },
  { id: 'econ', k: 'scale', lo: 1, hi: 5, l: ['Not at all', 'Completely'], q: 'How well do you understand where your nation’s income comes from?' },
  { id: 'others', k: 'one', q: 'Do other players make Edictum better or worse for you?', why: 'Why? (optional)',
    o: opts([['better', 'Better'], ['mixed', 'Some of each'], ['worse', 'Worse'], ['little', 'I hardly deal with other players']]) },
  { id: 'attacked', k: 'one', q: 'When another nation attacks you, it feels like…',
    o: opts([['fair', 'A fair challenge'], ['annoying', 'Annoying, but part of the game'], ['quit', 'It makes me want to stop playing'], ['never', 'I have not been attacked']]) },
  { id: 'shop', k: 'one', q: 'Have you bought anything in the Edictum shop?', o: opts([['yes', 'Yes'], ['no', 'Not yet']]),
    sub: { id: 'shopwhy', when: 'no', k: 'many', max: 2, q: 'What would make the shop worth it for you?', h: 'Pick up to 2.',
      o: opts([['designs', 'Designs I really want'], ['price', 'Lower prices'], ['sale', 'A sale or a bundle'], ['support', 'Knowing it keeps the game going'],
        ['show', 'More ways to show off what I buy'], ['never', 'Nothing: I don’t buy things in games', { solo: 1 }], ['other', 'Something else', { other: 1 }]]) } },
  { id: 'pmf', core: true, k: 'one', q: 'If Edictum closed tomorrow, how would you feel?', o: opts([['very', 'Very disappointed'], ['somewhat', 'Somewhat disappointed'], ['not', 'Not really disappointed']]) },
  { id: 'nps', core: true, k: 'scale', lo: 0, hi: 10, l: ['Not at all likely', 'Extremely likely'], q: 'How likely are you to recommend Edictum to a friend?' },
  { id: 'change', core: true, k: 'text', q: 'What is one thing you would change tomorrow?', h: 'A sentence or two is plenty.' },
];
export const SV_BY_ID = Object.fromEntries(SV_QS.flatMap(q => q.sub ? [[q.id, q], [q.sub.id, q.sub]] : [[q.id, q]]));
export const svCore = () => SV_QS.filter(q => q.core).map(q => q.id);
export const svPool = () => SV_QS.filter(q => !q.core).map(q => q.id);

/* a number 0..1 from the words, the same every time (FNV-1a, then one round of mixing) */
export function svHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const svDay = t => new Date(t).toISOString().slice(0, 10);
/* drawn today: a share of the eligible players each day, a different share every day */
export const svDrawn = (uid, sid, t, share) => svHash(uid + '|' + sid + '|' + svDay(t)) < share;
/* the questions drawn for a player from the pool: k of them, the same for them every time, in the survey's order */
export function svPick(uid, sid, k) {
  const pool = svPool(), n = Math.max(0, Math.min(pool.length, Math.floor(+k || 0)));
  const by = pool.map(id => [svHash(uid + '|' + sid + '|q|' + id), id]).sort((a, b) => a[0] - b[0]).slice(0, n).map(x => x[1]);
  return pool.filter(id => by.includes(id));
}
/* everything one player is asked, in order: the core and their drawn questions */
export const svAsked = drawn => SV_QS.filter(q => q.core || (drawn || []).includes(q.id));

const words = (s, max) => typeof s === 'string' ? s.replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';
/* one answer, as the records keep it, or undefined when it does not fit the question */
function cleanOne(q, v) {
  if (q.k === 'one') return typeof v === 'string' && q.o.some(o => o.v === v) ? v : undefined;
  if (q.k === 'many') {
    if (!Array.isArray(v)) return undefined;
    const ids = [...new Set(v.filter(x => typeof x === 'string' && q.o.some(o => o.v === x)))];
    if (!ids.length) return undefined;
    const solo = ids.find(x => q.o.find(o => o.v === x).solo);
    return solo ? [solo] : ids.slice(0, q.max || ids.length);
  }
  if (q.k === 'scale') return Number.isInteger(v) && v >= q.lo && v <= q.hi ? v : undefined;
  if (q.k === 'text') { const s = words(v, SV_TEXT); return s || undefined; }
  return undefined;
}
const hasOther = (q, v) => q.o && q.o.some(o => o.other && (v === o.v || (Array.isArray(v) && v.includes(o.v))));
/* What a player sent, made safe: only the questions they were asked, only answers that fit, the words cut to length.
   {a: {qid: answer}, o: {qid: words for "Something else"}, w: {qid: why}}; a skipped question is simply absent. */
export function svClean(asked, sent) {
  const a = {}, o = {}, w = {}, A = sent && typeof sent.a === 'object' && sent.a ? sent.a : {}, O = sent && sent.o && typeof sent.o === 'object' ? sent.o : {}, W = sent && sent.w && typeof sent.w === 'object' ? sent.w : {};
  const take = q => {
    const v = cleanOne(q, A[q.id]);
    if (v === undefined) return undefined;
    a[q.id] = v;
    if (hasOther(q, v)) { const s = words(O[q.id], SV_OTHER); if (s) o[q.id] = s; }
    if (q.why) { const s = words(W[q.id], SV_TEXT); if (s) w[q.id] = s; }
    return v;
  };
  for (const q of asked) { const v = take(q); if (q.sub && v === q.sub.when) take(q.sub); }
  return { a, o, w };
}
/* the questions as a player's game draws them: no core flags, nothing the page does not need */
export function svForPlayer(asked) {
  const one = q => ({ id: q.id, k: q.k, q: q.q, ...(q.h ? { h: q.h } : {}), ...(q.o ? { o: q.o } : {}), ...(q.max ? { max: q.max } : {}),
    ...(q.k === 'scale' ? { lo: q.lo, hi: q.hi, l: q.l } : {}), ...(q.why ? { why: q.why } : {}), ...(q.when ? { when: q.when } : {}) });
  return asked.map(q => ({ ...one(q), ...(q.sub ? { sub: one(q.sub) } : {}) }));
}
