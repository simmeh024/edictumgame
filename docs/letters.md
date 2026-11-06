# Letters between nations (Messages)

The Messages page is where nations write to each other. This page describes how it works and what the owner
sets up once.

## What players get

- **Conversations** with any nation of the region, computer-run nations, the region's offices, groups of up to 12
  nations, and their alliance (every player member, automatically).
- **Letters**: up to 2,500 characters, as a plain letter or a formal note (Congratulation, Protest, Condolence,
  Friendship, Ultimatum, Treaty). A letter can answer another (it quotes a few words of it) and carry one
  attachment: a trade offer, a peace offer, an alliance invitation, a city or an achievement. The reader's card
  shows the attachment as it stands now, with the buttons of its own page (Accept, Decline, Join, Accept peace,
  Show on the map).
- **Tools**: a draft per conversation (kept in the browser), Ctrl+Enter to send, day dividers and full times,
  search across letters, filters (Unread, Players, Computer, Offices, Groups, Archived), pin, mute, archive,
  delete, block, report, "Show earlier letters".
- **Notices**: a pop-up in the game when a letter arrives, push notifications on a device that asked for them,
  and Letters by post, hourly or right away (see [mail.md](mail.md)). None of them carries the letter's words.
- **Settings › Letters** (the Messages page's Settings button): which offices write, read receipts, the notice,
  push notifications, blocked nations, muted and archived conversations.
- **Customise › Stationery** (the Messages page's Customise button): paper, wax seal and signature, which other
  players see on the letters they get. Some are free; others come with letters written (10 to 200), prestige
  (1,000 to 2,500), five achievements (Grand Coalition, The Diplomat, The Unbowed, The Champion, Island Hopper) or the
  Chancery Club. "Papers of your government" has one paper for each of the Bureau's 27 classifications: a nation
  earns one the first time it is classed that way and keeps it (govCatsHeld). These 32 are drawn from one table
  (LP_X), whose variables a stylesheet injected at start-up turns into classes (.lpx).

## How it works

- `game/edictum.html`, section "messages": threads (`dmThreads`), the page (`messagesView`), delivery (`dmFlush`),
  computer nations (`npcReply`, `dmNpcHook`, `npcIdea`), offices (`OFFICES`, `DM_SOURCES`). The end of the script has
  Settings › Letters (`dmSettingsPane`, push) and Customise › Stationery (`czStationery`).
- The player's own copy of their letters, read state and letter settings are in the private half (`nationp`:
  `dm`, `seenDm`, `dmx`), which nobody else reads.
- `src/shim.js` `letters` API: `send`/`sendGroup`, `listen` (only letters newer than those this browser already
  holds), `older`, read receipts, blocks, `remove`, `notify`, `push`.
- Firestore (rules in `firestore.rules`):
  - `letters/<by>~<to>~<t>`: one letter to one reader (a group letter is one per member); deleted by Firestore's
    TTL policy on `exp`, a year on.
  - `llimits/<uid>` `{l, d, n}`: one batch every 3 seconds, at most 150 letters a day.
  - A letter is at most 2,500 characters. The player's own copy keeps at most 400,000 characters of letters
    (DM_CHARS) and this browser's cache 900,000 (LT_CHARS), dropping the oldest first.
  - `lpair/<by>~<to>` `{u}`: letters in a row not yet answered, at most 10 (group letters are not counted).
  - `lblock/<b>~<x>`: b accepts no letters, and no Letters by post pings, from x.
  - `lseen/<r>~<w>` `{t}`: a read receipt.
  - `pushSubs/<uid>`, `lnote/<by>~<to>`: server only (functions/letters.js).
- `functions/letters.js` runs in the `accounts` callable (`op: 'letters'`), not as a new function (CI cannot deploy
  a new public function): it keeps push subscriptions and, when a writer's game reports a delivered letter, tells
  a reader who is not in the game, at most once per writer every 10 minutes, unless they blocked or muted the
  writer: a push notification (Web Push, `web-push`, with the VAPID keys below) and, if they chose it, a Letter by
  post right away (`nowLetter` in `functions/mail-core.js`; at most 40 a day). The hourly mail job then leaves
  those letters out of the digest.
- `src/push-sw.js` is the service worker that shows a notification and opens Messages on a click. It does nothing
  else (no caching).

## Owner setup (once per project)

1. **Push notifications.** Make the keys and save them in Firestore (never in the repo):

   ```bash
   cd tools/admin && npm ci
   ```

   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/service-account.json node set-push.mjs
   ```

   In PowerShell: `$env:GOOGLE_APPLICATION_CREDENTIALS="C:\keys\…json"; node set-push.mjs`. Until this is done,
   Settings › Letters says notifications are not set up yet. Running it again with `--new` replaces the keys, and
   every device has to turn notifications on again.

2. **Letters deleted after a year.** Switch on Firestore's TTL policy for `letters.exp` (like `support.exp`):

   ```bash
   gcloud firestore fields ttls update exp --collection-group=letters --enable-ttl --project=edictum-b30de
   ```

   Or in the Firebase console: Firestore › Time-to-live › Create policy, collection group `letters`, field `exp`.
   Letters written before this change have no `exp` and stay until deleted.

The two new indexes (`letters` by `to` + `ts`, and by `by` + `to` + `t`) deploy with the rules.
