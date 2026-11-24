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
     away   one reminder when their nation has gone unvisited for AWAY_DAYS
     fc     the flag competition: an entrant who has not yet scored the flags it must, when judging opens and on its
            last day. An account saved before this kind existed has no fc: it counts as chosen unless every other
            kind is off (fcWanted), which is how a "stop these letters" left it. */
import crypto from 'node:crypto';

export const KINDS = ['msg', 'now', 'war', 'dip', 'news', 'away', 'fc'];
export const fcWanted = p => !!p && (typeof p.fc === 'boolean' ? p.fc : KINDS.some(k => k !== 'now' && k !== 'fc' && p[k]));
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
  away: { band: '#6a4a14', deep: '#4a330c', accent: '#93661b', soft: '#f8f0e1', gold: '#f3d27c' },
  flag: { band: '#7a2433', deep: '#531824', accent: '#a8324a', soft: '#f9e8ec', gold: '#f0cf7e' }
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

/* no nation's name: whoever asked chose it, and the address's owner may never have asked (functions/mail.js) */
export function verifyLetter(cfg, { to, code }) {
  const title = 'Your seal of confirmation', t = TONE.seal, link = `${cfg.site}/?mailcode=${code}#settings`;
  const body = p(`The Herald has been asked to deliver the dispatches of a nation of Edictum to this address. Before a single letter is sealed, the chancery needs proof that this desk is truly yours.`)
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

/* a guest's recovery code (functions/mail.js, recoveryMail), shown as the game shows it (EDC-XXXXXXXX-…). No nation's
   name: the address is whatever the player typed. */
export function recoveryLetter(cfg, { to, code }) {
  const title = 'Your recovery code', t = TONE.seal, shown = 'EDC-' + String(code).slice(3).match(/.{1,8}/g).join('-');
  const body = p('You asked the Herald to send the recovery code of a Guest Nation in Edictum to this address. It brings the nation back on another browser or device.')
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 6px"><tr><td align="center" style="background:${t.soft};border:2px dashed ${t.accent};border-radius:14px;padding:20px 12px">
<div style="font:700 12px/1 ${SANS};letter-spacing:.18em;text-transform:uppercase;color:${t.accent};margin-bottom:12px">Recovery code</div>
<div style="font:700 17px/1.5 ui-monospace,'SF Mono',Consolas,'Courier New',monospace;letter-spacing:.04em;color:#12403c;word-break:break-all;-webkit-user-select:all;user-select:all">${esc(shown)}</div>
<div style="font:13px/1.4 ${SANS};color:#5d6f6b;margin-top:12px">Tap the code to select it, then copy</div></td></tr></table>`
    + p('<span style="font-size:15px;color:#5d6f6b">To use it, open the game, choose <b>Recover with a code</b> in the account panel and enter the code. If a new key is made in the game, this code stops working.</span>')
    + p('<b>Anyone who reads this letter can take over the nation.</b> Keep it private, or delete it once the code is stored somewhere safe.');
  return { to, subject: 'Your Edictum recovery code',
    html: page(cfg, { tone: 'seal', icon: '&#x1F511;', kicker: 'From the chancery', title, lead: 'Keep this letter private', body, cta: { href: cfg.site + '/', label: 'Open Edictum' },
      foot: 'Never asked for this? Delete this letter: someone typed your address by mistake. We keep no copy of it.' }),
    text: `${title}\n\nRecovery code: ${shown}\n\nTo use it, open ${cfg.site}, choose Recover with a code in the account panel and enter the code. If a new key is made in the game, this code stops working.\n\nAnyone who reads this letter can take over the nation: keep it private. If you never asked for this, delete this letter.` };
}

/* a one-time sign-in link an admin made for a player who could not get back in (functions/once.js), sent to the
   verified address on the account: it names their nation, since only the account's owner reads this address */
export function onceLetter(cfg, { to, nation, link }) {
  const who = nation ? `<b>${esc(nation)}</b>` : 'your nation', title = 'Your way back in';
  const body = p(`The Edictum team made this link so you can get back into ${who}. It signs you in on the phone or computer where you open it.`)
    + p('<b>It works once, within 24 hours.</b> After it signs you in, the game shows you how to make sure you can always get back in on your own.')
    + p('<span style="font-size:15px;color:#5d6f6b">Open it in your usual browser (Chrome or Safari), not inside another app. If the button does not work, copy this address into your browser:</span>')
    + `<p style="margin:0 0 16px;font:14px/1.5 ui-monospace,'SF Mono',Consolas,'Courier New',monospace;word-break:break-all;color:#12403c">${esc(link)}</p>`
    + p('<b>Anyone who opens this link can sign in to your nation</b> until it is used: do not share it.');
  return { to, subject: 'Your one-time sign-in link for Edictum',
    html: page(cfg, { tone: 'seal', icon: '&#x1F511;', kicker: 'From the Edictum team', title, lead: 'A one-time sign-in link', body, cta: { href: link, label: nation ? 'Sign in to ' + nation : 'Sign in to Edictum' },
      foot: 'Did not ask the Edictum team for help? Do not open the link, and write to us from the Help page in the game.' }),
    text: `${title}\n\nThe Edictum team made this link so you can get back into ${nation || 'your nation'}. It works once, within 24 hours:\n\n${link}\n\nOpen it in your usual browser (Chrome or Safari), not inside another app. After it signs you in, the game shows you how to make sure you can always get back in.\n\nAnyone who opens this link can sign in to your nation until it is used: do not share it. Did not ask the Edictum team for help? Do not open the link, and write to us from the Help page in the game.` };
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
/* the flag competition: an entrant still short of the flags it must score. last: judging closes within a day */
export function fcLetter(cfg, { to, nation, left, duty, close, last, tok }) {
  const flags = left === 1 ? 'one more flag' : `${left} more flags`, when = new Date(close).toUTCString().replace(/:\d\d GMT$/, ' UTC');
  const title = last ? `Last day: score ${flags} to keep your flag in` : `Judging is open: your flag needs you to score ${flags}`;
  const body = p(last ? `Judging in the flag competition closes within a day, and the flag ${esc(nation || 'your nation')} entered is not yet safe.` : `Entries are closed and judging has begun in this month’s flag competition. ${esc(nation || 'Your nation')} has a flag in the running.`)
    + rows('flag', [['&#x2B50;', `Every entrant scores <b>${duty} ${duty === 1 ? 'flag' : 'flags'}</b> of the others to stay in the running. You have <b>${flags}</b> to go.`],
      ['&#x23F3;', `Judging closes on <b>${esc(when)}</b>. A flag whose entrant has not scored enough by then does not place, however well it did.`],
      ['&#x1F5FA;&#xFE0F;', 'Every five flags you score also earn a land credit, ten at most.']])
    + p('<span style="font-size:15px;color:#5d6f6b">The flags are shown without names, a few at a time. It takes a minute or two.</span>');
  return { to, subject: title, unsub: `${cfg.site}/mail?t=${tok}`,
    html: page(cfg, { tone: 'flag', icon: '&#x1F6A9;', kicker: last ? 'The flag competition · last day' : 'The flag competition', title, lead: `${flags} to score`, body, cta: { href: cfg.site + '/#flagcomp', label: 'Score the flags' }, foot: footFor(cfg, tok) }),
    text: `${title}\n\nEvery entrant scores ${duty} flags of the others to stay in the running; you have ${flags} to go. Judging closes on ${when}.\n\n${cfg.site}/#flagcomp\nStop these letters: ${cfg.site}/mail?t=${tok}` };
}
/* war, round two: a player's capital besieged (kind 'siege'), or fallen ('fell'), told right away (functions/letters.js,
   warWord; sent for the war kind); since 24 November 2026 also fallen while the government moves on to nn ('moved') */
export function warLetter(cfg, { to, kind, by, nation, capital, at, nn, tok }) {
  if (kind === 'moved') return movedLetter(cfg, { to, by, nation, capital, nn, tok });
  const fell = kind === 'fell', cap = capital || 'your capital', when = at ? new Date(at).toUTCString().replace(/:\d\d GMT$/, ' UTC') : '';
  const title = fell ? `${cap} has fallen` : `${by || 'An enemy'} has laid siege to ${cap}`;
  const body = fell
    ? p(`The army of <b>${esc(by || 'an enemy')}</b> has stormed <b>${esc(cap)}</b>, and the government of ${esc(nation || 'your nation')} is no more.`)
      + rows('urgent', [['&#x1F525;', 'The land your enemies took stays theirs.'], ['&#x1F331;', `Your people can rise again in the same region, with land credits, a quarter of your materials and seven days of peace, or start anew in another region.`], ['&#x1F3C5;', 'Either way you keep your achievements, portrait, flag, currency and history.']])
    : p(`The army of <b>${esc(by || 'an enemy')}</b> has surrounded <b>${esc(cap)}</b>, the capital of ${esc(nation || 'your nation')}.`)
      + rows('urgent', [['&#x23F3;', `The final assault can come from <b>${esc(when || 'one day from now')}</b>. If ${esc(cap)} falls, your government moves to your biggest city; with no other city, ${esc(nation || 'your nation')} falls with it.`], ['&#x1F6E1;&#xFE0F;', 'Fortify the capital, win back your land, and call on your allies.'], ['&#x1F3F3;&#xFE0F;', 'Or surrender: the war ends on current lines, and you pay tribute for 14 days.']]);
  return { to, subject: title, unsub: `${cfg.site}/mail?t=${tok}`,
    html: page(cfg, { tone: 'urgent', icon: fell ? '&#x1F3DA;&#xFE0F;' : '&#x2694;&#xFE0F;', kicker: fell ? 'The fall' : 'Urgent dispatch', title, lead: fell ? 'Your nation has fallen' : 'A siege has begun', body, cta: { href: cfg.site + (fell ? '' : '/#map'), label: fell ? 'Rise again' : 'Take command' }, foot: footFor(cfg, tok) }),
    text: `${title}

${fell ? `The army of ${by} stormed ${cap}. Your people can rise again, or start anew in another region.` : `The final assault can come from ${when || 'one day from now'}. Fortify, win back land, call your allies, or surrender.`}

${cfg.site}
Stop these letters: ${cfg.site}/mail?t=${tok}` };
}
/* the capital taken, the nation not: its government has moved to nn, its biggest city, and the war goes on */
function movedLetter(cfg, { to, by, nation, capital, nn, tok }) {
  const cap = capital || 'your capital', nc = nn || 'your biggest city', title = `${cap} has fallen`;
  const body = p(`The army of <b>${esc(by || 'an enemy')}</b> has stormed <b>${esc(cap)}</b>. The government of ${esc(nation || 'your nation')} got out in time, and <b>${esc(nc)}</b> is your capital now.`)
    + rows('urgent', [['&#x1F3DB;&#xFE0F;', `${esc(nc)} is your capital. If it falls too, your government moves on to your next biggest city; with no city left, ${esc(nation || 'your nation')} falls.`], ['&#x2694;&#xFE0F;', `The war goes on. ${esc(by || 'Your enemy')} must lay a new siege to take ${esc(nc)}.`], ['&#x1F6E1;&#xFE0F;', 'Fortify, win back your land, call on your allies, or surrender.']]);
  return { to, subject: title, unsub: `${cfg.site}/mail?t=${tok}`,
    html: page(cfg, { tone: 'urgent', icon: '&#x1F3DA;&#xFE0F;', kicker: 'The capital has fallen', title, lead: `Your government has moved to ${nc}`, body, cta: { href: cfg.site + '/#map', label: 'Take command' }, foot: footFor(cfg, tok) }),
    text: `${title}

The army of ${by || 'an enemy'} stormed ${cap}. Your government has moved to ${nc}, and the war goes on. If ${nc} falls too, it moves on to your next biggest city; with no city left, ${nation || 'your nation'} falls.

${cfg.site}/#map
Stop these letters: ${cfg.site}/mail?t=${tok}` };
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
