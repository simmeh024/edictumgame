/* /join/<slug>: a player's recruiting link as it is shared (game/edictum.html, rcLink), without the account id in it and
   with the inviter in the preview that chat apps and social sites draw for a link (27 November 2026).

   Firebase Hosting rewrites /join/** to the paddle function (functions/shop.js), the one public HTTP function the
   project has: a new one needs its Cloud Run invoker set, which the deploy's service account may not do
   (functions/accounts.js). It answers GET only and reads only.

   /join/<slug>           a small page with Open Graph and Twitter tags (the inviter's name and region, and their card)
                          for the sites that draw a preview; for a person, a script sends the browser on to the game's own
                          link, /?recruit=<uid>&rg=<region>&via=<channel>, which keeps the recruiter on the device and
                          starts the visitor in the recruiter's region as it always has. Sites that draw previews do not
                          run scripts, so they stay on this page and read its tags.
   /join/<slug>/card.jpg  the inviter's preview picture: the JPEG the game drew from the invitation card (flag, name,
                          motto, region) and sent with accounts op 'joinCard' (functions/recruit.js). Without one, the
                          game's own picture (og.png).

   joinSlug/<slug> {u, t}: the player a slug names, made once by accounts op 'joinLink' from the nation's name, and
   kept when the nation is renamed so links already shared still work. joinCard/<uid> {s, img?, h?, at?}: the player's
   slug and picture. Server only (firestore.rules); both go with the account (functions/accounts.js, close). A banned
   player's link still opens the game, without their name, picture or recruiting. */
import { getFirestore } from 'firebase-admin/firestore';
import DATA from './civic-data.json' with { type: 'json' };

export const JOIN_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/, JOIN_VIA = /^[a-z]{1,8}$/;
const RC_UID = /^[A-Za-z0-9_-]{6,128}$/;
const REG_NAME = new Map(DATA.regions.map(r => [r.id, r.name]));
/* the hosts a page may name as its own in the tags; anything else is read as the live site */
const HOSTS = /^(edictumgame\.com|edictum-b30de\.web\.app|edictum-b30de\.firebaseapp\.com|edictum-staging\.web\.app|edictum-staging\.firebaseapp\.com|127\.0\.0\.1(:\d+)?|localhost(:\d+)?)$/;

/* the slug and whether the picture is asked for, from a request's path; null for anything else */
export function joinPath(p) {
  const m = /^\/join\/([^/?#]+)(\/card\.jpg)?\/?$/.exec(String(p || ''));
  return m && JOIN_SLUG.test(m[1]) ? { slug: m[1], card: !!m[2] } : null;
}

/* a slug from a nation's name: letters and digits, accents dropped, words joined by hyphens, at most 40 characters */
export function slugOf(name) {
  const s = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return JOIN_SLUG.test(s) && s.length >= 2 ? s : 'nation';
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* JSON safe inside a <script> */
const js = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16));

const WORDS = {
  en: { title: n => `${n} invites you to found a nation in Edictum`, anon: 'You are invited to found a nation in Edictum',
    desc: (n, r) => `Found your nation in ${r}, beside ${n}, and you both get a founding bonus. Edictum is a free multiplayer game of nations and edicts.`,
    anonDesc: 'Edictum is a free multiplayer game of nations and edicts. Found yours, write its laws and meet your neighbours.',
    go: 'Taking you to Edictum…', open: 'Open Edictum' },
  fr: { title: n => `${n} vous invite à fonder une nation dans Edictum`, anon: 'Vous êtes invité à fonder une nation dans Edictum',
    desc: (n, r) => `Fondez votre nation en ${r}, à côté de ${n}, et vous recevrez tous les deux un bonus de fondation. Edictum est un jeu multijoueur gratuit de nations et d’édits.`,
    anonDesc: 'Edictum est un jeu multijoueur gratuit de nations et d’édits. Fondez la vôtre, écrivez ses lois et rencontrez vos voisins.',
    go: 'Direction Edictum…', open: 'Ouvrir Edictum' }
};
export const joinLang = accept => /^\s*fr\b/i.test(String(accept || '')) ? 'fr' : 'en';

/* the page: x {origin, slug, u, name, reg, h (the picture's hash, '' for none), via, lang} */
export function joinHTML(x) {
  const W = WORDS[x.lang] || WORDS.en, ok = !!(x.u && x.name), rn = REG_NAME.get(x.reg) || '';
  const url = x.origin + '/join/' + x.slug, title = ok ? W.title(x.name) : W.anon, desc = ok && rn ? W.desc(x.name, rn) : W.anonDesc;
  const img = ok && x.h ? url + '/card.jpg?v=' + encodeURIComponent(x.h) : x.origin + '/og.png';
  const to = ok ? '/?recruit=' + encodeURIComponent(x.u) + (rn ? '&rg=' + encodeURIComponent(x.reg) : '') + (x.via && JOIN_VIA.test(x.via) ? '&via=' + x.via : '') : '/';
  return `<!doctype html>
<html lang="${x.lang === 'fr' ? 'fr' : 'en-GB'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Edictum">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img)}">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f1e3;color:#1d2a2a;font:17px/1.5 system-ui,sans-serif}a{color:#2f5d9e}</style>
</head>
<body>
<p>${esc(W.go)} <a href="${esc(to)}">${esc(W.open)}</a></p>
<script>location.replace(${js(to)});</script>
</body>
</html>`;
}

/* the origin a page names as its own: the address the visitor used, when it is one of the game's */
export function joinOrigin(req) {
  const host = String(req.get?.('x-forwarded-host') || req.headers?.['x-forwarded-host'] || req.get?.('host') || '').split(',')[0].trim().toLowerCase();
  if (!HOSTS.test(host)) return 'https://edictumgame.com';
  return (/^(127\.0\.0\.1|localhost)/.test(host) ? 'http://' : 'https://') + host;
}

export async function joinPage(req, res) {
  const p = joinPath(req.path), db = getFirestore();
  if (!p) { res.status(404).send(''); return; }
  const s = await db.doc('joinSlug/' + p.slug).get().catch(() => null), u = s && s.exists ? String(s.get('u') || '') : '';
  const live = RC_UID.test(u);
  const [sum, ban, card] = live ? await db.getAll(db.doc('summaries/' + u), db.doc('bans/' + u), db.doc('joinCard/' + u)).catch(() => [null, null, null]) : [null, null, null];
  const ok = live && sum && sum.exists && !(ban && ban.exists);
  if (p.card) {
    const img = ok && card && card.exists ? card.get('img') : null;
    if (!img || !img.length) { res.status(404).send(''); return; }
    res.set('Cache-Control', 'public, max-age=600, s-maxage=600');
    res.set('Content-Type', 'image/jpeg');
    res.status(200).send(Buffer.from(img));
    return;
  }
  const via = typeof req.query?.via === 'string' && JOIN_VIA.test(req.query.via) ? req.query.via : '';
  const html = joinHTML({ origin: joinOrigin(req), slug: p.slug, u: ok ? u : '', name: ok ? String(sum.get('name') || '').slice(0, 80) : '',
    reg: ok ? String(sum.get('reg') || '') : '', h: ok && card && card.exists && card.get('img') ? String(card.get('h') || '1') : '', via,
    lang: joinLang(req.get?.('accept-language')) });
  res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.set('Vary', 'Accept-Language');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
}
