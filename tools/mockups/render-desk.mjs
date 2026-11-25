// Renders every page of the Ambassador's Desk exactly as the game draws it: the same view functions, sliced out of
// game/edictum.html, and the game's own built stylesheet. Not a test; a way to look at what was built.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const root = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const html = fs.readFileSync(path.join(root, 'game/edictum.html'), 'utf8');
const cssFile = fs.readdirSync(path.join(root, 'public/assets')).find(f => f.endsWith('.css'));
const css = fs.readFileSync(path.join(root, 'public/assets', cssFile), 'utf8');
const DAY = 86400000;

/* The built stylesheet is nearly a megabyte of the whole game. Keep only the rules the desk uses, so a page is
   small enough to open straight from disk. */
function topLevel(src) {
  const out = []; let depth = 0, start = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { out.push(src.slice(start, i + 1)); start = i + 1; }
  }
  return out;
}
const USED = /(^|[\s,>])(:root|html|body|\*|button|input|select|textarea|h1|h2|h3|p|code|svg|dialog|a)([\s,:[{.]|$)|\.(adm|amb|btn|chip|row|field|input|err|hint|muted|num|lbl|eyebrow|display|lede|h2|wordmark|tbl|linkish|staff-pill|cred-pill|back|cat-pill)/;
function keep(chunk) {
  const head = chunk.slice(0, chunk.indexOf('{')).trim();
  if (head.startsWith('@font-face')) return '';
  if (head.startsWith('@keyframes')) return chunk;
  if (head.startsWith('@media') || head.startsWith('@supports')) {
    const inner = chunk.slice(chunk.indexOf('{') + 1, chunk.lastIndexOf('}'));
    const kept = topLevel(inner).map(keep).filter(Boolean).join('');
    return kept ? chunk.slice(0, chunk.indexOf('{') + 1) + kept + '}' : '';
  }
  return USED.test(head) ? chunk : '';
}
const deskCss = topLevel(css).map(keep).filter(Boolean).join('');


const a = html.indexOf('\nconst AMB_VIEWS=');
const b = html.indexOf('\n/* the desk stands in front of the ordinary page');
const block = html.slice(a, b);

const ctx = vm.createContext({ window: { claude: { use: () => Promise.resolve(null) } } });
vm.runInContext([
  'const DAY=' + DAY + ';const PV=false;',
  'const esc=v=>String(v==null?"":v).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]));',
  'const rel=t=>{const d=Date.now()-t;if(d<0)return "just now";if(d<36e5)return Math.max(1,Math.round(d/6e4))+" min ago";if(d<' + DAY + ')return Math.round(d/36e5)+" h ago";return Math.round(d/' + DAY + ')+" days ago";};',
  'const fmtPop=p=>(p<1?Math.round(p*1000)+" thousand":p.toFixed(1)+" million");const fmtDate=t=>"a day";',
  'const regName=r=>({mer:"Meridian Reach",cor:"Coral Reach",emb:"Ember Isles",jad:"Jade Terraces",lan:"Lantern Coast",ver:"Verdant Basin"}[r]||r);',
  'const REG={id:"mer",name:"Meridian Reach"};',
  'const admSkel=(n=6)=>"<div class=\\"adm-skel\\">"+"<i></i>".repeat(n)+"</div>";',
  'const NAV_SVG=p=>\'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">\'+p+"</svg>";',
  'const NAV_IC_DEF="<svg viewBox=\\"0 0 24 24\\"></svg>";',
  'const ADM_MOBILE={matches:false};const S={isAmb:true,isMod:false,isOwner:false,mode:"world"};',
  'const render=()=>{};const toast=()=>{};const go=()=>{};const setTimeout=()=>0;',
  block,
  'this.AMB=AMB;this.ambView=ambView;this.AMB_VIEWS=AMB_VIEWS;this.ambWelcomeText=ambWelcomeText;',
].join('\n'), ctx);

const now = Date.now();
ctx.AMB.d = {
  at: now, reg: 'mer', me: 'Envoyland', quiet: 6 * 3600000, span: 3 * DAY,
  newly: [
    { uid: 'n1', name: 'The Dominion of Ashmoor', pop: 1.2, f: now - 4 * 3600000, t: now - 4 * 3600000, spoke: false },
    { uid: 'n2', name: 'The Republic of Pennyholm', pop: 3.4, f: now - 11 * 3600000, t: now - 20 * 60000, spoke: false },
    { uid: 'n3', name: 'The Free City of Cresswick', pop: 2.1, f: now - 26 * 3600000, t: now - 2 * 3600000, spoke: true,
      greeted: { by: 'v1', nm: 'Velloria', t: now - 6 * 3600000, wrote: true } }],
  rooms: [
    { reg: 'cor', online: 14, last: now - 9 * 3600000, lines: 3 },
    { reg: 'jad', online: 9, last: now - 7 * 3600000, lines: 11 },
    { reg: 'emb', online: 21, last: now - 6 * 3600000, lines: 18 },
    { reg: 'lan', online: 38, last: now - 20 * 60000, lines: 96 },
    { reg: 'mer', online: 63, last: now - 120000, lines: 214 }],
  topics: [
    { id: 't1', reg: 'mer', ti: 'Does anybody actually trade iron, or is it just me?', nm: 'Readerland', t: now - 2 * DAY, tg: 'trade' },
    { id: 't2', reg: 'cor', ti: 'Is the Assembly worth joining as a small nation?', nm: 'Little Farhaven', t: now - 2 * DAY, tg: 'general' },
    { id: 't3', reg: 'emb', ti: 'How do I move my capital?', nm: 'Saltmarrow', t: now - 31 * 3600000, tg: 'general' }],
  silences: [
    { uid: 's1', nm: 'Tallowmere', why: 'Unkind to other players', until: now + 23 * 3600000, t: now - 3600000, mine: true, perm: false },
    { uid: 's2', nm: 'Kestrel Point', why: 'Posting the same line over and over', until: now + 18 * 3600000, t: now - 6 * 3600000, mine: false, perm: false }],
  cred: { left: 2, of: 3, week: 1 },
  asks: [
    { key: 'capital-how-move', x: 'How do I move my capital?', n: 41, la: now - 3600000 },
    { key: 'harbour-route-sea-why', x: 'Why does my harbour say no sea route?', n: 33, la: now - 5 * 3600000 },
    { key: 'competition-enter-flag-national', x: 'Can I enter my national flag in the competition?', n: 28, la: now - DAY },
    { key: 'assembly-joining-small-worth', x: 'Is the Assembly worth joining if I am small?', n: 19, la: now - 2 * DAY }] };
ctx.AMB.led = { at: now,
  silences: [
    { uid: 's1', nm: 'Tallowmere', why: 'Unkind to other players', reg: 'mer', t: now - 3600000, until: now + 23 * 3600000, perm: false, running: true },
    { uid: 's3', nm: 'Mackerel Point', why: 'Posting the same line over and over', reg: 'mer', t: now - 4 * DAY, until: now - 4 * DAY + 6 * 3600000, perm: false, running: false },
    { uid: 's4', nm: 'The Wrackline', why: 'Unkind to other players', reg: 'mer', t: now - 9 * DAY, until: now - 8 * DAY, perm: false, running: false }],
  notes: [
    { id: 'x1', kind: 'threat', x: 'A letter saying "I know where you live" to a nation that had beaten them in a vote.', name: 'Mewstone', t: now - 3 * DAY, state: 'done', said: 'Banned for 30 days. Good catch, the account had two others doing the same.' },
    { id: 'x2', kind: 'broken', x: 'Province loyalty stuck at 0 however they rule. Three edicts in a row changed nothing.', name: 'Candlewick Isle', t: now - 6 * DAY, state: 'read', said: 'Passed to the developers.' },
    { id: 'x3', kind: 'scam', x: 'Selling founded nations for real money in the region chat, twice today.', name: 'Brindlehome', t: now - 14 * 3600000, state: 'waiting', said: '' }] };
ctx.AMB.greet = 'n1';
ctx.AMB.draft = ctx.ambWelcomeText('Ashmoor');
ctx.AMB.cfor = 'Cresswick';
ctx.AMB.cx = 'Cresswick has answered half the questions on the Meridian board this week, and never once made anyone feel daft for asking.';

const titles = { 'amb': 'Your round', 'amb-welcome': 'Newly founded', 'amb-rooms': 'Quiet rooms',
  'amb-silences': 'Silences', 'amb-passed': 'Passed to staff', 'amb-praise': 'Commendations', 'amb-asks': 'What players ask' };
const out = process.argv[2] || '.';
for (const v of ctx.AMB_VIEWS) {
  const page = `<!doctype html><html lang="en" data-theme="${process.argv[3] === 'dark' ? 'dark' : 'light'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${titles[v]}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400;6..96,600;6..96,700&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet">
<style>${deskCss}</style></head><body>${ctx.ambView(v)}</body></html>`;
  fs.writeFileSync(path.join(out, v + '.html'), page);
}
console.log('rendered', ctx.AMB_VIEWS.length, 'pages into', out, '(' + Math.round(deskCss.length / 1024) + ' KB of the game’s own stylesheet in each)');
