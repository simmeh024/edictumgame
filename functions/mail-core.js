/* Letters by post: the shared half of Edictum's email (functions/mail.js, jobs/mail/run.mjs).

   Mail leaves through Resend (https://resend.com) from "The Herald of Edictum" <herald@edictumgame.com>. The API
   key lives in Firestore, authConfig/mail {key, from?, site?}, set by the owner with tools/admin/set-mail.mjs; only
   this code reads it (firestore.rules). Without a key nothing is sent: in the emulators each letter is written to
   mailOutbox/<id> instead, so the tests can read it, and elsewhere sending refuses with mail_off.

   Kinds a player may choose (mailAccounts/<uid>.p, all on once the address is confirmed):
     msg    letters from other players' nations (the text is not copied into the mail)
     war    wars declared on them, hexes seized, peace made
     dip    diplomacy: trade deals, alliances, matters raised, border hexes ceded
     news   new development news from the Edictum team
     away   one reminder when their nation has gone unvisited for AWAY_DAYS */
import crypto from 'node:crypto';

export const KINDS = ['msg', 'war', 'dip', 'news', 'away'];
export const AWAY_DAYS = 3;
const SITE = 'https://edictumgame.com';
const FROM = 'The Herald of Edictum <herald@edictumgame.com>';
const emulated = () => process.env.FUNCTIONS_EMULATOR === 'true' || !!process.env.FIRESTORE_EMULATOR_HOST;

export const digest = v => crypto.createHash('sha256').update(String(v)).digest('hex');
export const token = () => crypto.randomBytes(18).toString('base64url');
export const validEmail = e => typeof e === 'string' && e.length <= 200 && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(e);
export const defaultPrefs = () => Object.fromEntries(KINDS.map(k => [k, true]));
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

/* ───────── the letters themselves, in the Herald's voice ───────── */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function page(cfg, { kicker, title, body, cta, foot }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#e8eeeb;color:#12292a;font-family:Georgia,'Times New Roman',serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8eeeb"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#f7f4ec;border:1px solid #c9bfa6;border-radius:6px">
<tr><td style="padding:22px 28px 6px;text-align:center;border-bottom:2px double #b59a5b">
<div style="font:600 12px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#8a6d2f">${esc(kicker)}</div>
<div style="font:italic 600 30px/1.25 Georgia,serif;color:#12292a;margin:6px 0 10px">Edictum</div></td></tr>
<tr><td style="padding:22px 28px 8px;font:16px/1.65 Georgia,serif;color:#24403e">
<h1 style="font:600 22px/1.3 Georgia,serif;color:#12292a;margin:0 0 14px">${esc(title)}</h1>
${body}
${cta ? `<p style="margin:26px 0 8px;text-align:center"><a href="${esc(cta.href)}" style="display:inline-block;background:#1d4a46;color:#f7f4ec;text-decoration:none;font:600 15px/1 system-ui,-apple-system,'Segoe UI',sans-serif;padding:13px 22px;border-radius:4px">${esc(cta.label)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:16px 28px 22px;border-top:1px solid #ddd3bb;font:12px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif;color:#6b7d79;text-align:center">
Sealed and sent by the Herald of Edictum. Replies to this address are not read.<br>${foot || ''}</td></tr>
</table></td></tr></table></body></html>`;
}
const p = s => `<p style="margin:0 0 14px">${s}</p>`;
const footFor = (cfg, tok) => tok ? `<a href="${esc(cfg.site)}/mail?t=${esc(tok)}" style="color:#6b7d79">Stop these letters</a> · choose which ones in Settings, under Letters by post.` : '';

export function verifyLetter(cfg, { to, code, nation }) {
  const title = 'Your seal of confirmation';
  const body = p(`The Herald has been asked to deliver the dispatches of ${nation ? '<b>' + esc(nation) + '</b>' : 'a nation of Edictum'} to this address. Before a single letter is sealed, the chancery needs proof that this desk is truly yours.`)
    + `<p style="margin:20px 0;text-align:center;font:700 34px/1 ui-monospace,Consolas,monospace;letter-spacing:.3em;color:#1d4a46">${esc(code)}</p>`
    + p('Enter these six figures in Settings, under Letters by post. The seal expires in 30 minutes.')
    + p('<span style="color:#6b7d79;font-size:14px">If you never asked for this, do nothing: no letters will follow, and the address is forgotten.</span>');
  return { to, subject: `${code} is your Edictum confirmation seal`, html: page(cfg, { kicker: 'From the chancery', title, body }),
    text: `${title}\n\nYour code: ${code}\n\nEnter it in Settings, under Letters by post, within 30 minutes. If you never asked for this, ignore this letter.` };
}

const TIPS = [
  ['Decide, then decide again.', 'Edicts arrive on your desk at the pace you choose in Settings. Every answer moves your economy, your liberties and your people’s mood. There is no wrong answer, only a different nation.'],
  ['Claim your land early.', 'Land credits wait on the Map. Spend them next to your capital before a neighbour takes the hex you were eyeing.'],
  ['Build where it counts.', 'Cities grow on what you build in them. Look at Cities for what each building does before you pour timber and iron into it.'],
  ['Talk before you fight.', 'Diplomacy opens trade deals and alliances. A letter costs nothing; a war costs a good deal more.'],
  ['Make it yours.', 'Customise holds your flag, your banknotes and your leader’s portrait. Your neighbours see all of it.'],
  ['Keep the bell in view.', 'The bell gathers everything that needs you. If you are away a while, the Herald can write to you here.']
];
export function welcomeLetter(cfg, { to, nation, leader, tok }) {
  const who = nation ? esc(nation) : 'your nation';
  const body = p(`By decree of the Herald, this address is now entered in the rolls of Edictum${leader ? ', and the correspondence of ' + esc(leader) + ' will be delivered here' : ''}.`)
    + p(`A few words of counsel from the old hands of the chancery, for the governing of ${who}:`)
    + `<ol style="margin:0 0 16px;padding-left:22px">${TIPS.map(([h, t]) => `<li style="margin:0 0 10px"><b>${esc(h)}</b> ${esc(t)}</li>`).join('')}</ol>`
    + p('You will hear from us only about the matters you chose: letters from other nations, wars, diplomacy, development news and, should your desk gather dust, a gentle reminder. Change any of them in Settings, under Letters by post.')
    + p('Long may your edicts stand.');
  return { to, subject: `Welcome to the rolls, ${nation || 'Edictum'}`, unsub: tok ? `${cfg.site}/mail?t=${tok}` : '',
    html: page(cfg, { kicker: 'A proclamation', title: `Welcome to the rolls of Edictum`, body, cta: { href: cfg.site, label: `Return to ${nation || 'your nation'}` }, foot: footFor(cfg, tok) }),
    text: `Welcome to the rolls of Edictum.\n\n${TIPS.map(([h, t], i) => `${i + 1}. ${h} ${t}`).join('\n')}\n\nChoose which letters you get in Settings, under Letters by post.\nStop all letters: ${cfg.site}/mail?t=${tok}\n\n${cfg.site}` };
}

/* pings: [{k, nm, kind}] — what happened, told without what was written */
const LINE = {
  msg: x => `<b>${esc(x.nm)}</b> has written to you.`,
  war: x => `<b>${esc(x.nm)}</b> declared war on you.`,
  conq: x => `<b>${esc(x.nm)}</b> seized a hex of your land.`,
  peace: x => `<b>${esc(x.nm)}</b> made peace with you.`,
  trade: x => `<b>${esc(x.nm)}</b> signed a trade deal with you.`,
  shared: x => `<b>${esc(x.nm)}</b> raised a matter with you.`,
  alremove: x => `<b>${esc(x.nm)}</b> removed you from its alliance.`,
  aladmit: x => `<b>${esc(x.nm)}</b> admitted you to its alliance.`,
  cede: x => `<b>${esc(x.nm)}</b> ceded a border hex to you.`
};
export const PING_KIND = { msg: 'msg', war: 'war', conq: 'war', peace: 'war', trade: 'dip', shared: 'dip', alremove: 'dip', aladmit: 'dip', cede: 'dip' };
export function digestLetter(cfg, { to, nation, pings, tok }) {
  const counted = new Map();
  for (const x of pings) { const key = x.k + '|' + x.nm; counted.set(key, { ...x, n: (counted.get(key)?.n || 0) + 1 }); }
  const lines = [...counted.values()].slice(0, 25).map(x => LINE[x.k](x) + (x.n > 1 ? ` <span style="color:#6b7d79">(${x.n} times)</span>` : ''));
  const urgent = pings.some(x => x.k === 'war' || x.k === 'conq');
  const title = urgent ? `Urgent dispatches for ${nation || 'your nation'}` : `Dispatches await ${nation || 'your nation'}`;
  const body = p(urgent ? 'Ministers are pacing the corridors. While you were away:' : 'While you were away, the couriers kept arriving:')
    + `<ul style="margin:0 0 16px;padding-left:20px">${lines.map(l => `<li style="margin:0 0 8px">${l}</li>`).join('')}</ul>`;
  return { to, subject: title, unsub: `${cfg.site}/mail?t=${tok}`,
    html: page(cfg, { kicker: urgent ? 'Urgent dispatch' : 'The courier’s bag', title, body, cta: { href: cfg.site, label: 'Return to your desk' }, foot: footFor(cfg, tok) }),
    text: `${title}\n\n${[...counted.values()].map(x => '- ' + LINE[x.k](x).replace(/<[^>]+>/g, '') + (x.n > 1 ? ` (${x.n} times)` : '')).join('\n')}\n\n${cfg.site}\nStop these letters: ${cfg.site}/mail?t=${tok}` };
}
export function newsLetter(cfg, { to, posts, tok }) {
  const title = posts.length === 1 ? posts[0].ti : `${posts.length} new notices from the Edictum team`;
  const body = p('The criers are in the square with fresh news from the makers of Edictum:')
    + posts.map(x => `<p style="margin:0 0 14px"><b>${esc(x.ti)}</b><br>${esc(x.ex)}</p>`).join('');
  return { to, subject: title, unsub: `${cfg.site}/mail?t=${tok}`,
    html: page(cfg, { kicker: 'Development news', title, body, cta: { href: cfg.site + '/#news', label: 'Read it in the game' }, foot: footFor(cfg, tok) }),
    text: `${title}\n\n${posts.map(x => x.ti + '\n' + x.ex).join('\n\n')}\n\n${cfg.site}/#news\nStop these letters: ${cfg.site}/mail?t=${tok}` };
}
export function awayLetter(cfg, { to, nation, days, tok }) {
  const title = `${nation || 'Your nation'} awaits its ${days > 6 ? 'long-lost' : 'absent'} leader`;
  const body = p(`It has been ${days} days since anyone sat at the desk of ${esc(nation || 'your nation')}. The cabinet has kept the lamps lit, but edicts are stacking up and the neighbours have started to talk.`)
    + p('One visit is enough to set things right. The Herald will not write about this again until you have been back.');
  return { to, subject: title, unsub: `${cfg.site}/mail?t=${tok}`,
    html: page(cfg, { kicker: 'A gentle reminder', title, body, cta: { href: cfg.site, label: 'Take your seat again' }, foot: footFor(cfg, tok) }),
    text: `${title}\n\nIt has been ${days} days since your last visit. ${cfg.site}\nStop these letters: ${cfg.site}/mail?t=${tok}` };
}
