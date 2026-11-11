# Region chat

A live chat for each region: the nations of a region talk to each other in short lines, from any page of the game.

## What players get

- **The Chat button** (a speech bubble) beside the bell. Its number counts the lines not yet read; lines from
  blocked nations are not counted.
- **The drawer.** It opens on the right of any page (the whole screen on a phone) and shows the newest 60 lines of
  the region: each with its nation's flag, name (a link to its page) and time, the Edictum staff mark for staff, a
  divider for each day and a "New" divider before the first line not yet read when the drawer opened. Lines by one
  nation within five minutes run together under one heading. The header says how many nations of the region are
  online (the same count as the green dots on the Region page).
- **Writing.** Registered Nations write lines of up to 300 characters: Enter sends. A line shows at once as
  "Sending…" and is replaced by the server's copy. Guests read along and are offered a sign-in.
- **Mentions.** A line that names the player's nation (as a word of its own, with or without @) is highlighted,
  and, with the drawer shut, told in a notice (at most one every 30 seconds).
- **A line's menu** (⋯, on hover or focus):
  - *Report to the moderators*: the game's report dialog, with the line quoted. The report reaches the admin
    portal's Reports queue as "Region chat", where **Remove the line** deletes it for everyone.
  - *Block (nation)*: the same block as in Messages. Its lines are hidden (the drawer says how many) and its letters
    stop. The blocked nation is not told. Unblocking is in Settings › Letters.
  - *Delete* one's own line; staff see *Remove the line* on every line, which the audit log keeps with its words.
- **Settings › Letters › Region chat**: turn the chat off (the button goes, and the game stops listening), and turn
  off the mention notice. The drawer's gear button opens it. The settings search finds it too.
- An admin observing another region sees its chat read-only, with *Remove the line*.

## How it works

- `functions/regionchat.js`, in the existing `civic` callable (CI cannot deploy a new public function):
  - `rcPost {x, reg?}`: `eligibility()` (not banned, not under moderation, region open, a Registered Nation). The
    region is the one in the player's saved record; a `reg` from the browser must match it. The server cleans the
    text (one line, no control characters, at most 300 characters) and writes
    `rchat/{reg}/chat/{id} {a, nm, x, t, exp, st?}`: the author's uid, their nation's name, the words, the server's
    time, `exp` 30 days on, and `st` 'admin' or 'mod' for staff. Nothing else from the browser is kept.
  - Pacing in the same transaction (`rcPace/{uid} {p, h}`): 1.5 seconds after the last line, at most 12 lines in any
    minute and 150 in any hour (`rcWait`), and never the same words twice within two minutes (a hash of the words
    without spaces, punctuation or case). The callable's in-memory token bucket (`rc:` 15 at once, then one a second)
    stops a flood before it reads anything.
  - `rcDelete {reg, id, report?}`: the author deletes their own line; staff (admin or mod claim) any line, which
    writes an `adminAudit` entry `chat_delete` with the words and closes the report if one is named.
- `functions/admin.js` `delete_post` takes `rc:<region>:<line>` from the Reports queue.
- The lines are a `chat` collection with the author in `a`, as the alliance channels are, so deleting an account
  (`functions/accounts.js`) or an admin removing or banning a nation (`functions/admin.js`) deletes them too;
  `rcPace/` goes with the account.
- `firestore.rules`: a line is read by a signed-in player whose saved nation (`nations/{uid}.reg`) is in that region,
  and by admins; nobody writes one but the server. `rcPace/` is the server's alone.
- Reports are ordinary `post` reports (`src/shim.js` files kind `chat` as `post`, with `post: rc:<reg>:<line>`).
- `game/edictum.html`, section "Region chat" (prefix `rgc`, state `RGC`): the button is drawn by `shell()`
  (`rgcButton`) and kept current between drawings by `rgcBadge`; the drawer is made once in `<body>`, outside
  `#app`, and drawn by its own `rgcPaint`, so the game drawing itself again never touches what is being typed. The
  listener (`rgcConnect`) follows the region as the game connects; a nation founded a moment ago is not saved yet,
  so a refused listener tries again after 3, 6, 12 and then every 30 seconds. The last line read is kept per region
  in `localStorage` (`edictum.rgc.<region>`). The settings are `dmx.rc` (0: chat off) and `dmx.rcn` (0: no mention
  notice) in the private half of the record.

## Costs

Every open game of the region listens to the newest 60 lines: opening the game reads up to 60 documents, and each new
line is one read for every player of the region with the game open (a region holds at most 250 or 300 nations). A
player who turns the chat off reads nothing. Each line is one callable call, one transaction (the player's record,
ban, moderation and account documents, the region's status and the pacing document) and two writes.

## Owner setup (once per project)

**Lines deleted after 30 days.** The privacy notice says lines are deleted 30 days after they were written. Switch on
Firestore's TTL policy for the `exp` field of the `chat` collection group (the alliance channels' lines have no `exp`
and are not touched):

```bash
gcloud firestore fields ttls update exp --collection-group=chat --enable-ttl --project=edictum-b30de
```

Or in the Firebase console: Firestore › Time-to-live › Create policy, collection group `chat`, field `exp`. The
repo's `firestore.indexes.json` leaves TTL out, so deploys leave the policy alone.

## Tests

- `test/regionchat.test.mjs` (in `test:fx`): the pacing.
- `test/civic.test.mjs`: writing, pacing, repeats, the region check, deleting, staff removal and its audit, bans.
- `test/rules.test.mjs`: who reads a region's chat; nobody writes it.
- `test/region-chat-e2e.mjs` (`npm run test:region-chat`, CI suite "Region chat"): the button and drawer, two
  players writing, the count, the mention notice, runs and dividers, guests, the menu, reporting and removal from the
  Reports queue, blocking and unblocking, deleting, staff removal, a phone, and the setting.
