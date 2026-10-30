/* Sign-in with Discord (src/shim.js, "Discord"; README.md, Sign-in).

   Firebase Authentication has no Discord provider, and an OpenID Connect provider is billed from its 50th
   monthly user, so Discord is joined to the player's account here instead: the page opens Discord's consent
   window, Discord sends that window back to /discord (src/discord.html) with a one-time code, and this
   exchanges the code for the Discord account's id. The id becomes a custom claim on the player's account
   (dc, with dcn its display name), which makes it a Registered Nation (functions/eligibility.js), and the same
   Discord account later signs in to that player id with a custom token. Only the identify scope is asked:
   no email address, no servers, no messages.

   It runs inside the accounts callable (functions/accounts.js), not as a function of its own: a new public
   function needs its invoker set on Cloud Run, which the deploy's service account may not do.
   accounts({op: 'discord', step: 'start', origin, state}) → {url}: Discord's consent page, which returns to
     <origin>/discord
   accounts({op: 'discord', step: 'link', origin, code}) → {ok: true, name} once the caller's account holds that
     Discord account, or {taken: true, name, token} when another account already does: the token signs this
     browser in to it

   Storage (only this code reads or writes it; see firestore.rules):
     authConfig/discord   {clientId, secret, origins?}: the Discord application (tools/admin/set-discord.mjs);
                          origins, the addresses allowed to sign in, defaults to the live site's
     discordLinks/{id}    {uid, name, at}: the player account a Discord account belongs to

   In the emulators (FUNCTIONS_EMULATOR) the start can carry emu: {id, name}, and the window then comes
   straight back with a code that stands for that Discord account, so the tests need no Discord. */
import { HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { refuse } from './eligibility.js';

const API = 'https://discord.com/api/v10';
const EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/;

function project() {
  try { return process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || ''; } catch { return ''; }
}
async function settings() {
  const s = await getFirestore().doc('authConfig/discord').get();
  const clientId = s.exists ? s.get('clientId') : '', secret = s.exists ? s.get('secret') : '';
  if (!EMULATOR && (!clientId || !secret)) refuse('discord_off', 'Discord sign-in is not set up for this game yet.');
  const p = project(), origins = s.exists && Array.isArray(s.get('origins')) ? s.get('origins')
    : ['https://edictumgame.com', `https://${p}.web.app`, `https://${p}.firebaseapp.com`];
  return { clientId: clientId || 'emulator', secret, origins };
}
/* Discord sends the window back only to an address registered with the application, and the code is
   only good with the same address */
function returnTo(cfg, origin) {
  if (typeof origin !== 'string' || !(cfg.origins.includes(origin) || EMULATOR && LOCAL.test(origin)))
    refuse('discord_origin', 'Discord sign-in is not set up for this web address.');
  return origin + '/discord';
}
async function discordUser(cfg, code, redirectUri) {
  if (typeof code !== 'string' || !code || code.length > 512) throw new HttpsError('invalid-argument', 'Discord did not send a sign-in code.');
  if (EMULATOR && code.startsWith('emu.')) {
    const u = JSON.parse(Buffer.from(code.slice(4), 'base64url').toString());
    return { id: String(u.id), name: String(u.name || 'tester').slice(0, 40) };
  }
  const r = await fetch(API + '/oauth2/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: cfg.clientId, client_secret: cfg.secret })
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) refuse('discord_code', 'Discord did not confirm the sign-in. Try again.');
  const m = await fetch(API + '/users/@me', { headers: { authorization: 'Bearer ' + t.access_token } });
  const u = await m.json().catch(() => ({}));
  if (!m.ok || !/^\d{5,25}$/.test(String(u.id || ''))) refuse('discord_user', 'Discord did not say which account signed in. Try again.');
  return { id: String(u.id), name: String(u.global_name || u.username || 'Discord user').slice(0, 40) };
}
async function exists(uid) {
  try { await getAuth().getUser(uid); return true; } catch (e) { if (e.code === 'auth/user-not-found') return false; throw e; }
}
async function claim(uid, id, name) {
  const u = await getAuth().getUser(uid);
  await getAuth().setCustomUserClaims(uid, { ...(u.customClaims || {}), dc: id, dcn: name });
}
/* frees the caller's Discord account, before the account itself is deleted (functions/accounts.js, close) */
export async function forgetDiscord(uid) {
  const u = await getAuth().getUser(uid), id = u.customClaims?.dc;
  if (!id) return;
  const db = getFirestore(), ref = db.doc('discordLinks/' + id);
  await db.runTransaction(async tx => { const s = await tx.get(ref); if (s.exists && s.get('uid') === uid) tx.delete(ref); });
  const c = { ...u.customClaims };
  delete c.dc; delete c.dcn;
  await getAuth().setCustomUserClaims(uid, c);
}

/* accounts({op: 'discord', step, …}) for a signed-in caller */
export async function discordStep(uid, d) {
  const db = getFirestore();
  if (d.step === 'start') {
    const cfg = await settings(), uri = returnTo(cfg, d.origin);
    if (typeof d.state !== 'string' || !/^[a-f0-9]{32}$/.test(d.state)) throw new HttpsError('invalid-argument', 'Start the Discord sign-in again.');
    if (EMULATOR && d.emu && d.emu.id) {
      const code = 'emu.' + Buffer.from(JSON.stringify({ id: String(d.emu.id), name: String(d.emu.name || '') })).toString('base64url');
      return { url: uri + '?' + new URLSearchParams({ code, state: d.state }) };
    }
    /* prompt=none: a player who has allowed Edictum before goes straight back */
    return { url: 'https://discord.com/oauth2/authorize?' + new URLSearchParams({ client_id: cfg.clientId, response_type: 'code', redirect_uri: uri, scope: 'identify', state: d.state, prompt: 'none' }) };
  }
  if (d.step === 'link') {
    const cfg = await settings(), who = await discordUser(cfg, d.code, returnTo(cfg, d.origin));
    const me = await getAuth().getUser(uid), mine = me.customClaims?.dc;
    if (me.disabled) refuse('account_disabled', 'This account is disabled. Contact support.');
    if (mine && mine !== who.id) refuse('discord_other', 'This nation is already linked to another Discord account.');
    const ref = db.doc('discordLinks/' + who.id);
    /* a link left by an account that was since deleted no longer counts; a disabled one keeps it, so a
       banned player cannot carry their Discord account to a fresh guest */
    const held = await db.runTransaction(async tx => {
      const s = await tx.get(ref), owner = s.exists ? s.get('uid') : '';
      if (owner && owner !== uid && await exists(owner)) return owner;
      tx.set(ref, { uid, name: who.name, at: Date.now() });
      return uid;
    });
    await claim(held, who.id, who.name);
    if (held !== uid) return { taken: true, name: who.name, token: await getAuth().createCustomToken(held) };
    return { ok: true, name: who.name };
  }
  throw new HttpsError('invalid-argument', 'Unknown Discord step.');
}
