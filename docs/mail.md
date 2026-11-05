# Letters by post (email)

Players give an email address in **Settings › Notifications › Letters by post**, confirm it with a six-figure code, and get a
welcome letter with tips. After that, they choose which letters they want:

| Kind | What it says | When |
|---|---|---|
| Letters from other nations | who wrote (never the text) | hourly digest |
| War | war declared, hex seized, peace made | hourly digest |
| Diplomacy | trade deals, alliances, matters raised, hexes ceded | hourly digest |
| Development news | new posts from the team | the hour after they are published |
| Away reminder | the nation has not been visited for 3 days | once per absence |

A player gets at most one digest every 6 hours, and never about something from before their last visit. Every
letter has a "Stop these letters" link (`/mail?t=…`) that works without signing in.

## How it works

- `functions/mail.js`: the `accounts` callable, `op: 'mail'` (status, set, verify, prefs, remove, unsub). It is not a
  new function, because CI cannot deploy a new public function (Cloud Run invoker IAM).
- `functions/mail-core.js`: the letters (HTML + text, Herald style) and the sender (Resend batch API).
- `src/shim.js` `mail` API and the game's Settings card (`mailSection` in `game/edictum.html`). After each save, the
  game writes a ping (`mailQ/<id>`: to, by, kind, nation name) for things it did to another player's nation.
- `jobs/mail/run.mjs`, run every hour by `.github/workflows/mail.yml`: digests, news, away reminders.
- Firestore (server only): `mailAccounts/<uid>`, `mailTokens/<tok>`, `mailAddr/<hash>` (3 codes a day per address),
  `mailState/news`; `mailQ` is create-only for players. In the emulators letters go to `mailOutbox/` instead.

Limits against abuse: 1 code a minute and 5 a day per player, 3 a day per address, 5 wrong tries per code,
codes expire after 30 minutes.

## Owner setup (once per project)

1. Create a Resend account at https://resend.com and add the domain **edictumgame.com** (Domains › Add).
2. At Namecheap (Advanced DNS) add the records Resend shows. For edictumgame.com (done 2026-11-04) they were:
   TXT `resend._domainkey` (DKIM), CNAME `send` → `send.forge.rmta.net.`, CNAME `rsend` →
   `rsend-euw1.forge.rmta.net.`, and TXT `_dmarc` → `v=DMARC1; p=none;`. Wait until Resend shows Verified.
3. Create an API key with **Sending access** only, for edictumgame.com.
4. Save it in Firestore (it is never in the repo):

   ```bash
   cd tools/admin && npm ci
   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/key.json node set-mail.mjs
   ```

   The sender defaults to `The Herald of Edictum <herald@edictumgame.com>`; `--from "…"` changes it, `--off` removes
   the key.
5. The hourly workflow uses the existing `FIREBASE_SERVICE_ACCOUNT` secret and `FIREBASE_PROJECT_ID` variable.

Until step 4 is done the Settings card says letters are not set up when someone asks for a code, and the job
reports "skipped".

## Tests

```bash
npm run test:mail        # callable + job against the emulators
npm run test:mail-e2e    # the Settings card and a ping, in the browser
```

## Costs

Resend's free plan covers 3,000 letters a month (100 a day). Watch the daily cap: a development news post goes to
every confirmed player who wants news at once. Beyond ~100 confirmed players, move to the $20/month plan
(50,000 letters). Gmail and Yahoo also want one-click unsubscribe (`List-Unsubscribe-Post`) from bulk senders
(over 5,000 a day); that is not built yet.
