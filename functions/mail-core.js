/* Letters by post: the shared half of Edictum's email (functions/mail.js, jobs/mail/run.mjs).

   Mail leaves through Resend (https://resend.com) from "The Herald of Edictum" <herald@edictumgame.com>. The API
   key lives in Firestore, authConfig/mail {key, from?, site?}, set by the owner with tools/admin/set-mail.mjs; only
   this code reads it (firestore.rules). Without a key nothing is sent: in the emulators each letter is written to
   mailOutbox/<id> instead, so the tests can read it, and elsewhere sending refuses with mail_off.

   Kinds a player may choose (mailAccounts/<uid>.p, all on once the address is confirmed):
     msg    letters from other players' nations (the text is not copied into the mail)
     now    with msg: each letter right away (functions/letters.js), not in the hourly digest; off unless chosen
     war    wars declared on them, hexes seized, peace made
     dip    diplomacy: trade deals, alliances, matters raised, border hexes ceded
     news   new development news from the Edictum team
     away   one reminder when their nation has gone unvisited for AWAY_DAYS */
import crypto from 'node:crypto';

export const KINDS = ['msg', 'now', 'war', 'dip', 'news', 'away'];
export const AWAY_DAYS = 3;
const SITE = 'https://edictumgame.com';
const FROM = 'The Herald of Edictum <herald@edictumgame.com>';
const emulated = () => process.env.FUNCTIONS_EMULATOR === 'true' || !!process.env.FIRESTORE_EMULATOR_HOST;

export const digest = v => crypto.createHash('sha256').update(String(v)).digest('hex');
export const token = () => crypto.randomBytes(18).toString('base64url');
export const validEmail = e => typeof e === 'string' && e.length <= 200 && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(e);
export const defaultPrefs = () => Object.fromEntries(KINDS.map(k => [k, k !== 'now']));
export function cleanPrefs(p) {
  const o = defaultPrefs();
  if (p && typeof p === 'object') for (const k of KINDS) if (k in p) o[k] = !!p[k];
  return o;
}

export async function mailConfig(db) {
  const s = await db.doc('authConfig/mail').get();
  return { key: s.exists ? s.get('key') || '' : '', from: s.exists && s.get('from') || FROM, site: s.exists && s.get('site') || SITE };
}

/* send one letter or many: [{to, subject, html, text, unsub?}] → number sent. Resend's batch endpoint takes 100. */
export async function send(db, letters, cfg) {
  cfg = cfg || await mailConfig(db);
  if (!letters.length) return 0;
  if (!cfg.key) {
    if (!emulated()) throw Object.assign(new Error('Mail is not set up for this game yet.'), { code: 'mail_off' });
    const b = db.batch();
    for (const l of letters) b.set(db.collection('mailOutbox').doc(), { ...l, t: Date.now() });
    await b.commit();
    return letters.length;
  }
  let sent = 0;
  for (let i = 0; i < letters.length; i += 100) {
    const body = letters.slice(i, i + 100).map(l => ({
      from: cfg.from, to: [l.to], subject: l.subject, html: l.html, text: l.text,
      ...(l.unsub ? { headers: { 'List-Unsubscribe': `<${l.unsub}>` } } : {})
    }));
    const r = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST', headers: { authorization: 'Bearer ' + cfg.key, 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!r.ok) throw Object.assign(new Error('Resend refused the letters: HTTP ' + r.status + ' ' + (await r.text()).slice(0, 300)), { code: 'mail_failed' });
    sent += body.length;
  }
  return sent;
}

/* ───────── the letters themselves, in the Herald's voice ─────────
   Mail clients strip scripts, SVG and most CSS, so the letters are tables with inline styles, and the icons are
   emoji (they render everywhere, with no images to block). Each kind has a tone: a colour band, an icon. */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const TONE = {
  seal: { band: '#12403c', deep: '#0b2e2b', accent: '#1d6b63', soft: '#e3f1ee', gold: '#e2c46f' },
  welcome: { band: '#12403c', deep: '#0b2e2b', accent: '#1d6b63', soft: '#e3f1ee', gold: '#e2c46f' },
  urgent: { band: '#7d1d24', deep: '#5a1218', accent: '#a32a33', soft: '#fbe9ea', gold: '#f1c27b' },
  calm: { band: '#1f3d63', deep: '#142a47', accent: '#2c5a92', soft: '#e7eef8', gold: '#e2c46f' },
  news: { band: '#3b2a63', deep: '#281b47', accent: '#5a40a0', soft: '#efeaf9', gold: '#e9c97a' },
  away: { band: '#6a4a14', deep: '#4a330c', accent: '#93661b', soft: '#f8f0e1', gold: '#f3d27c' }
};
function page(cfg, { tone, icon, kicker, title, lead, body, cta, foot }) {
  const t = TONE[tone];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#eef1ef;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(lead || title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1ef"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 14px;font:700 13px/1 ${SANS};letter-spacing:.32em;color:#5d6f6b;text-align:center">EDICTUM</td></tr>
<tr><td style="background:#ffffff;border-radius:16px;border:1px solid #dfe5e2;overflow:hidden">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="background:${t.band};background-image:linear-gradient(135deg,${t.band},${t.deep});padding:34px 32px 30px;text-align:center;border-radius:16px 16px 0 0">
<div style="display:inline-block;width:72px;height:72px;line-height:72px;border-radius:50%;background:rgba(255,255,255,.14);border:2px solid ${t.gold};font-size:36px;text-align:center">${icon}</div>
<div style="font:700 12px/1.4 ${SANS};letter-spacing:.2em;text-transform:uppercase;color:${t.gold};margin:18px 0 8px">${esc(kicker)}</div>
<h1 style="margin:0;font:600 26px/1.25 ${SERIF};color:#ffffff">${esc(title)}</h1></td></tr>
<tr><td style="padding:30px 32px 8px;font:16px/1.6 ${SANS};color:#2b3533">
${body}
${cta ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto 8px"><tr><td style="border-radius:10px;background:${t.accent}"><a href="${esc(cta.href)}" style="display:inline-block;padding:15px 30px;font:700 16px/1 ${SANS};color:#ffffff;text-decoration:none;border-radius:10px">${esc(cta.label)} &rarr;</a></td></tr></table>` : ''}
</td></tr>
<tr><td style="padding:22px 32px 26px"><div style="border-top:1px solid #e6ebe8;padding-top:18px;font:13px/1.6 ${SANS};color:#7a8a86;text-align:center">
&#x1F4EF; Sealed and sent by the Herald of Edictum. Replies to this address are not read.${foot ? '<br>' + foot : ''}</div></td></tr>
</table></td></tr>
<tr><td style="padding:16px 4px 0;font:12px/1.5 ${SANS};color:#93a29e;text-align:center"><a href="${esc(cfg.site)}" style="color:#93a29e">edictumgame.com</a></td></tr>
</table></td></tr></table></body></html>`;
}
const p = s => `<p style="margin:0 0 16px">${s}</p>`;
/* a list of rows, each with an icon chip */
const rows = (tone, items) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 12px">${items.map(([ic, html]) =>
  `<tr><td width="48" valign="top" style="padding:0 0 12px"><div style="width:40px;height:40px;line-height:40px;border-radius:12px;background:${TONE[tone].soft};text-align:center;font-size:20px">${ic}</div></td>
<td valign="middle" style="padding:0 0 12px 12px;font:15px/1.5 ${SANS};color:#2b3533">${html}</td></tr>`).join('')}</table>`;
const footFor = (cfg, tok) => tok ? `<a href="${esc(cfg.site)}/mail?t=${esc(tok)}" style="color:#7a8a86">Stop these letters</a> &middot; choose which ones in Settings, under Letters by post.` : '';

export function verifyLetter(cfg, { to, code, nation }) {
  const title = 'Your seal of confirmation', t = TONE.seal, link = `${cfg.site}/?mailcode=${code}#settings`;
  const body = p(`The Herald has been asked to deliver the dispatches of ${nation ? '<b>' + esc(nation) + '</b>' : 'a nation of Edictum'} to this address. Before a single letter is sealed, the chancery needs proof that this desk is truly yours.`)
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 6px"><tr><td align="center" style="background:${t.soft};border:2px dashed ${t.accent};border-radius:14px;padding:22px 12px">
<div style="font:700 12px/1 ${SANS};letter-spacing:.18em;text-transform:uppercase;color:${t.accent};margin-bottom:12px">Your code</div>
<div style="font:700 40px/1 ui-monospace,'SF Mono',Consolas,'Courier New',monospace;letter-spacing:.28em;color:#12403c;-webkit-user-select:all;user-select:all">${esc(code)}</div>
<div style="font:13px/1.4 ${SANS};color:#5d6f6b;margin-top:12px">Tap the code to select it, then copy</div></td></tr></table>`
    + p('<span style="font-size:15px;color:#5d6f6b">Open the game on the device where you asked, and press the button below. Or enter the code in Settings, under Letters by post. It expires in 30 minutes.</span>');
  return { to, subject: `${code} is your Edictum confirmation seal`,
    html: page(cfg, { tone: 'seal', icon: '&#x1F50F;', kicker: 'From the chancery', title, lead: `Your code is ${code}`, body, cta: { href: link, label: 'Confirm in one click' },
      foot: 'Never asked for this? Do nothing: no letters will follow, and the address is forgotten.' }),
    text: `${title}\n\nYour code: ${code}\n\nConfirm in one click: ${link}\nOr enter it in Settings, under Letters by post, within 30 minutes. If you never asked for this, ignore this letter.` };
}

const TIPS = [
  ['&#x1F4DC;', 'Decide, then decide again.', 'Edicts arrive at the pace you choose in Settings. Every answer moves your economy, liberties and mood. There is no wrong answer, only a different nation.'],
  ['&#x1F5FA;&#xFE0F;', 'Claim your land early.', 'Land credits wait on the Map. Spend them beside your capital before a neighbour takes the hex you were eyeing.'],
  ['&#x1F3D7;&#xFE0F;', 'Build where it counts.', 'Cities grow on what you build in them. Check what each building does before you pour timber and iron into it.'],
  ['&#x1F91D;', 'Talk before you fight.', 'Diplomacy opens trade deals and alliances. A letter costs nothing; a war costs a good deal more.'],
  ['&#x1F3A8;', 'Make it yours.', 'Customise holds your flag, banknotes and leader. Your neighbours see all of it.'],
  ['&#x1F514;', 'Keep the bell in view.', 'The bell gathers everything that needs you. While you are away, the Herald writes here.']
];
export function welcomeLetter(cfg, { to, nation, leader, tok }) {
  const who = nation ? esc(nation) : 'your nation';
  const body = p(`By decree of the Herald, this address is now entered in the rolls of Edictum${leader ? ', and the correspondence of ' + esc(leader) + ' will be delivered here' : ''}. Some counsel from the old hands of the chancery, for the governing of <b>${who}</b>:`)
    + rows('welcome', TIPS.map(([ic, h, t]) => [ic, `<b style="color:#12403c">${esc(h)}</b><br><span style="color:#5d6f6b">${esc(t)}</span>`]))
    + p('<span style="font-size:15px;color:#5d6f6b">You will hear from us only about what you chose: letters from other nations, wars, diplomacy, development news and, should your desk gather dust, a gentle reminder.</span>')
    + p('<i style="font-family:' + SERIF + '">Long may your edicts stand.</i>');
  return { to, subject: `Welcome to the rolls, ${nation || 'Edictum'}`, unsub: tok ? `${cfg.site}/mail?t=${tok}` : '',
    html: page(cfg, { tone: 'welcome', icon: '&#x1F3DB;&#xFE0F;', kicker: 'A proclamation', title: 'Welcome to the rolls of Edictum', lead: 'Six pieces of counsel for a new head of state', body, cta: { href: cfg.site, label: `Return to ${nation || 'your nation'}` }, foot: footFor(cfg, tok) }),
    text: `Welcome to the rolls of Edictum.\n\n${TIPS.map(([, h, t], i) => `${i + 1}. ${h} ${t}`).join('\n')}\n\nChoose which letters you get in Settings, under Letters by post.\nStop all letters: ${cfg.site}/mail?t=${tok}\n\n${cfg.site}` };
}

/* pings: [{k, nm}] — what happened, told without what was written */
const LINE = {
  msg: ['&#x2709;&#xFE0F;', x => `<b>${esc(x.nm)}</b> has written to you.`],
  war: ['&#x2694;&#xFE0F;', x => `<b>${esc(x.nm)}</b> declared war on you.`],
  conq: ['&#x1F3F4;', x => `<b>${esc(x.nm)}</b> seized a hex of your land.`],
  peace: ['&#x1F54A;&#xFE0F;', x => `<b>${esc(x.nm)}</b> made peace with you.`],
  trade: ['&#x1F91D;', x => `<b>${esc(x.nm)}</b> signed a trade deal with you.`],
  shared: ['&#x1F4DC;', x => `<b>${esc(x.nm)}</b> raised a matter with you.`],
  alremove: ['&#x1F6AA;', x => `<b>${esc(x.nm)}</b> removed you from its alliance.`],
  aladmit: ['&#x1F6E1;&#xFE0F;', x => `<b>${esc(x.nm)}</b> admitted you to its alliance.`],
  cede: ['&#x1F5FA;&#xFE0F;', x => `<b>${esc(x.nm)}</b> ceded a border hex to you.`]
};
export const PING_KIND = { msg: 'msg', war: 'war', conq: 'war', peace: 'war', trade: 'dip', shared: 'dip', alremove: 'dip', aladmit: 'dip', cede: 'dip' };
export function digestLetter(cfg, { to, nation, pings, tok }) {
  const counted = new Map();
  for (const x of pings) { const key = x.k + '|' + x.nm; counted.set(key, { ...x, n: (counted.get(key)?.n || 0) + 1 }); }
  const list = [...counted.values()].slice(0, 25), urgent = pings.some(x => x.k === 'war' || x.k === 'conq'), tone = urgent ? 'urgent' : 'calm';
  const title = urgent ? `Urgent dispatches for ${nation || 'your nation'}` : `Dispatches await ${nation || 'your nation'}`;
  const body = p(urgent ? 'Ministers are pacing the corridors. While you were away:' : 'While you were away, the couriers kept arriving:')
    + rows(tone, list.map(x => [LINE[x.k][0], LINE[x.k][1](x) + (x.n > 1 ? ` <span style="display:inline-block;padding:1px 8px;border-radius:99px;background:${TONE[tone].soft};color:${TONE[tone].accent};font-size:13px;font-weight:700">(${x.n} times)</span>` : '')]));
  return { to, subject: title, unsub: `${cfg.site}/mail?t=${tok}`,
    html: page(cfg, { tone, icon: urgent ? '&#x2694;&#xFE0F;' : '&#x1F4EC;', kicker: urgent ? 'Urgent dispatch' : 'The courier’s bag', title, lead: `${list.length} ${list.length === 1 ? 'matter awaits' : 'matters await'} your decision`, body, cta: { href: cfg.site, label: 'Return to your desk' }, foot: footFor(cfg, tok) }),
    text: `${title}\n\n${list.map(x => '- ' + LINE[x.k][1](x).replace(/<[^>]+>/g, '') + (x.n > 1 ? ` (${x.n} times)` : '')).join('\n')}\n\n${cfg.site}\nStop these letters: ${cfg.site}/mail?t=${tok}` };
}
/* one letter, right away: who wrote, never what (functions/letters.js) */
export function nowLetter(cfg, { to, nation, from, group, tok }) {
  const title = group ? `${from} wrote to ${group}` : `A letter from ${from}`;
  const body = p(group ? `<b>${esc(from)}</b> has written to <b>${esc(group)}</b>, a conversation ${esc(nation || 'your nation')} is part of.` : `<b>${esc(from)}</b> has written to ${esc(nation || 'your nation')}. The letter is waiting for you in Messages.`)
    + p('<span style="font-size:15px;color:#5d6f6b">Letters stay private, so the Herald does not copy them into the post. You chose to hear of each letter right away; the hourly digest leaves them out.</span>');
  return { to, subject: title, unsub: `${cfg.site}/mail?t=${tok}`,
    html: page(cfg, { tone: 'calm', icon: '&#x2709;&#xFE0F;', kicker: 'By return of post', title, lead: 'A letter awaits your reply', body, cta: { href: cfg.site + '/#messages', label: 'Read the letter' }, foot: footFor(cfg, tok) }),
    text: `${title}\n\nThe letter is waiting for you in Messages: ${cfg.site}/#messages\nStop these letters: ${cfg.site}/mail?t=${tok}` };
}
export function newsLetter(cfg, { to, posts, tok }) {
  const title = posts.length === 1 ? posts[0].ti : `${posts.length} new notices from the Edictum team`;
  const body = p('The criers are in the square with fresh news from the makers of Edictum:')
    + posts.map(x => `<div style="border-left:4px solid ${TONE.news.accent};background:${TONE.news.soft};border-radius:0 12px 12px 0;padding:14px 18px;margin:0 0 12px">
<div style="font:700 16px/1.35 ${SANS};color:#281b47;margin-bottom:4px">&#x1F4F0; ${esc(x.ti)}</div><div style="font:15px/1.55 ${SANS};color:#4a4560">${esc(x.ex)}</div></div>`).join('');
  return { to, subject: title, unsub: `${cfg.site}/mail?t=${tok}`,
    html: page(cfg, { tone: 'news', icon: '&#x1F4E3;', kicker: 'Development news', title, lead: posts.map(x => x.ti).join(' · '), body, cta: { href: cfg.site + '/#news', label: 'Read it in the game' }, foot: footFor(cfg, tok) }),
    text: `${title}\n\n${posts.map(x => x.ti + '\n' + x.ex).join('\n\n')}\n\n${cfg.site}/#news\nStop these letters: ${cfg.site}/mail?t=${tok}` };
}
export function awayLetter(cfg, { to, nation, days, tok }) {
  const title = `${nation || 'Your nation'} awaits its ${days > 6 ? 'long-lost' : 'absent'} leader`;
  const body = p(`It has been <b>${days} days</b> since anyone sat at the desk of ${esc(nation || 'your nation')}. The cabinet has kept the lamps lit, but the neighbours have started to talk.`)
    + rows('away', [['&#x1F4DC;', 'Edicts are stacking up on your desk.'], ['&#x1F465;', 'Your people are wondering who is in charge.'], ['&#x1F440;', 'The neighbours are eyeing your borders.']])
    + p('<span style="font-size:15px;color:#5d6f6b">One visit is enough to set things right. The Herald will not write about this again until you have been back.</span>');
  return { to, subject: title, unsub: `${cfg.site}/mail?t=${tok}`,
    html: page(cfg, { tone: 'away', icon: '&#x1F56F;&#xFE0F;', kicker: 'A gentle reminder', title, lead: `${days} days without a visit`, body, cta: { href: cfg.site, label: 'Take your seat again' }, foot: footFor(cfg, tok) }),
    text: `${title}\n\nIt has been ${days} days since your last visit. ${cfg.site}\nStop these letters: ${cfg.site}/mail?t=${tok}` };
}
