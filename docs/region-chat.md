# Region chat

A live chat for each region: the nations of a region talk to each other in short lines, from any page of the game.

## What players get

- **The Chat button** (a speech bubble). Its number counts the lines not yet read; lines from blocked nations are not
  counted. By default it floats over the page in the bottom-right corner (above the tab bar on a phone). Dragged, it
  snaps to the nearer side and keeps its height, and it stays there on that device. It steps up over a bar at the foot
  of the page (unsaved changes, the shop's basket, the map's panel on a phone), moves beside the open drawer on a wide
  screen, and on a phone hides under the drawer and while the player types in the page. Settings › Chat can put it
  beside the bell and the search button instead, or show both.
- **The drawer.** It opens on the right of any page (the whole screen on a phone) and shows the newest 60 lines of
  the region: each with its nation's flag, name (a link to its page) and time, the Edictum staff mark for staff, a
  divider for each day and a "New" divider before the first line not yet read when the drawer opened. Lines by one
  nation within five minutes run together under one heading. The header says how many nations of the region are
  online (the same count as the green dots on the Region page).
- **Writing.** Every nation writes lines of up to 300 characters: Enter sends. A line shows at once as
  "Sending…" and is replaced by the server's copy. A guest (a nation with no linked sign-in) writes 10 lines in any
  hour: under the box the drawer says how many are left ("Guests can send 10 lines an hour: 7 are left."), and once
  they are used, when the guest can write again, each time with a **Link a sign-in** button. A Registered Nation's
  limit is 150 an hour, which no one is told of.
- **Mentions.** A line that names the player's nation (as a word of its own, with or without @) is highlighted,
  and, with the drawer shut, told in a notice (at most one every 30 seconds).
- **A line's menu** (⋯, on hover or focus):
  - *Report to the moderators*: the game's report dialog, with the line quoted. The report reaches the admin
    portal's Reports queue as "Region chat", where **Remove the line** deletes it for everyone.
  - *Block (nation)*: the same block as in Messages. Its lines are hidden (the drawer says how many) and its letters
    stop. The blocked nation is not told. Unblocking is in Settings › Letters.
  - *Delete* one's own line; staff see *Remove the line* on every line, which the audit log keeps with its words.
- **Settings › Chat** (its own tab, after Letters; `#settings/chat`): where the Chat button sits on this device
  (Floating, Beside the bell or Both, and *Put it back in the corner* after a drag; localStorage `edictum.rgc.place`
  and `edictum.rgc.fab`), turning the chat off (the button goes, and the game stops listening) and the mention notice
  (both kept with the nation, `dmx.rc` and `dmx.rcn`). The drawer's gear button opens it. The settings search finds
  both cards ("Chat button", "Region chat").
- An admin observing another region sees its chat read-only, with *Remove the line*.
- **Silenced players** see, in place of the writing box, that a moderator silenced them, until when and why; they
  still read the chat. Lines the **Edictum team** signs show the team's mark and name, never a nation's.

- **Tabs** in the drawer: **Region** (the region chat), **Alliance** (for a member of a player alliance: the alliance's
  channel, the same one as on the Diplomacy page) and **Happenings** (the region's happenings, as on the Region page,
  newest first). Each tab counts what is new in it; the Chat button counts Region and Alliance. Happenings counts from
  the player's first look, so a new player is not shown the region's whole past.
- **A new nation is welcomed in the chat**: when a nation is founded, the region chat shows "Welcomia has been founded,
  welcome to #Meridian Reach!" as an announcement (a "New nation" label, the nation's flag and a link to its page), with
  a **Welcome** button for the others for a week, until they have greeted it, and **Say hello** ("Hello, everyone!") for
  the new nation itself until it has written a line. The line counts as new on the Chat button like any other; it is
  not the new nation's own line (no guest line counted, no tutorial step done). Its menu reacts to it and reports it;
  the nation itself deletes it and staff remove it.
- **Welcome**: beside a nation founded in the last week, in Happenings. It starts a line in the region chat that
  @mentions the nation ("Welcome to the Meridian Reach, @Pocketland!"), ready to send.
- **@mentions**: typing @ offers the region's nations (arrows and Enter or Tab pick one, Escape closes the list). The
  nation mentioned gets a notice in its bell ("… mentioned you in the region chat"), and a push notification when it is
  not in the game.
- **Answer** (a line's menu): the answer quotes the line it answers (a click on the quote shows it), and the line's writer
  is told in their bell ("… answered you in the region chat").
- **Reactions** (a line's menu, or a click on a reaction under a line): 👍 Hear, hear, 😄 Ha!, 👏 Bravo, 👎 Shame. One per
  nation per line; the same again takes it back. Hovering a reaction names who gave it.
- **Badges beside a name**: the rank's colour (a small diamond in the colour of the rank's card border), the alliance's
  initials, and the Founding Supporter badge the nation wears. The Chancery Club is not shown: the privacy notice keeps
  a membership private.
- **Docked** (a wide screen, 1100 pixels or more): the drawer's dock button puts it beside the page, which makes room for
  it, instead of over it; it stays as the pages change. The choice is kept in the browser.
- **The tutorial**: "Say hi in the region chat" (list 2, Welcome to Edictum, after "Say hi" on the board): 2 land credits
  and 5 food, timber and goods for a first line. Its button opens the chat.

- **Pictures from admins.** An admin's line may carry a picture: the picture button beside Send (a PNG, JPEG, WebP or
  GIF), a picture pasted into the writing box, or one dropped on the drawer. It is prepared at once (a bar above the box
  shows a small copy, its size and an × to take it away) and goes with the words, or alone. Everyone sees a small copy
  under the line's words (at most 240 × 200 pixels on the page); a click shows the picture over the page, fitted to the
  window, with who posted it, when and its words, and a click on it shows it at its own size. Escape or a click beside it
  closes it. Players, moderators and guests have no picture button, and the server refuses theirs. Answering a picture
  quotes it as "📷 A picture"; a mention in a line with only a picture reads the same in the bell.

## Staff tools

- **Admin portal › Moderation › Region chats** (`#admin-chat`, admins): every region, busiest first, with its newest
  line; the chosen region's chat as it happens (its newest 100 lines); a box to **write in it as the Edictum team**
  (signed "Edictum team", with no nation needed there, in any region, open or closed); and on each line **Remove**,
  **Silence…** and **Inspect**. Under the chat, the players silenced now, each with **Lift**.
  The team's box takes a picture as the drawer does (its picture button, a paste or a drop), and the log shows each
  line's small copy, which opens the picture.
- **Silence** (from that page, or from a line's menu in the chat for admins and moderators): an hour, 24 hours,
  7 days, 30 days or until lifted, in every region's chat, with a reason the player sees, and optionally removing the
  player's lines of the last 24 hours in that region. Staff cannot be silenced. Silencing and lifting are in the audit
  log (`chat_silence`, `chat_unsilence`) with the reason, the end and how many lines went.

## How it works

- `functions/regionchat.js`, in the existing `civic` callable (CI cannot deploy a new public function):
  - `rcPost {x, reg?}`: `eligibility()` (not banned, not under moderation, region open; a guest too). The
    region is the one in the player's saved record; a `reg` from the browser must match it. The server cleans the
    text (one line, no control characters, at most 300 characters) and writes
    `rchat/{reg}/chat/{id} {a, nm, x, t, exp, st?}`: the author's uid, their nation's name, the words, the server's
    time, `exp` 30 days on, and `st` 'admin' or 'mod' for staff. Nothing else from the browser is kept.
  - Pacing in the same transaction (`rcPace/{uid} {p, h}`): 1.5 seconds after the last line, at most 12 lines in any
    minute and 150 in any hour (`rcWait`), and never the same words twice within two minutes (a hash of the words
    without spaces, punctuation or case). A guest writes `RC_GUEST_HOUR` (10) lines in any hour: the eleventh is
    refused with `rc_guest {wait, max}` ("Guests can send 10 lines an hour. You can write again in 23 minutes, or link a
    sign-in to chat freely."), and a guest's line comes back with `guest: true`, `left` (lines left this hour) and `gt`
    (the times of their lines this hour), which the drawer counts from. A sign-in lifts the limit at once: the same
    `rcPace` times count against 150. The callable's in-memory token bucket (`rc:` 15 at once, then one a second)
    stops a flood before it reads anything.
  - `rcPost {team: true, reg, x}` (staff): a line signed by the team, `{tm: true, nm: 'Edictum team', a: <staff uid>}`,
    in any region; the staff member's own pacing applies.
  - `rcPost` also takes `re` (a line of the same chat to answer: the line keeps `r {id, a, nm, x}` with up to 90
    characters of it, `rc_gone` if it is no longer there) and `mn` (up to 5 uids the writer's game picked: the server
    keeps those of the region whose saved name follows an @ in the words and who have not blocked the writer, as
    `mn {uid: name}`). Each one mentioned, and the writer of the line answered, gets `mentions/{uid}/m/{id}
    {k: 'chat', by, nm, reg, rc, x, t, rp?}` (the bell, beside the Community Board's mentions), and
    `pushChatMention` (functions/letters.js) sends a push notification to one not in the game, at most once every ten
    minutes a player (`rcNote/{uid}`, server-only), unless they blocked the writer or turned the chat or its notices off.
  - `rcPost` also takes `pic {th, w, h, d, fw, fh}` from an **admin** (an admin claim; a moderator is refused with
    `permission-denied`), with words or with none. The game draws the picture anew on a canvas, so nothing of a camera's
    metadata goes with it: `d` is the picture, at most 1920 pixels a side and 690 KB as WebP (JPEG where the browser
    cannot write WebP), or a GIF of at most 690 KB kept as it is so it still moves; `th` is a small copy of at most
    440 × 360 pixels and 46 KB. The server (`rcPicIn`, `rcPicData`) takes only `data:image/…;base64,` URLs of those
    kinds (no GIF for the small copy, never SVG), checks each one's first bytes are what it claims, and refuses more than
    48 KB for the small copy or 700 KB for the picture (which keeps its document under Firestore's 1 MiB) or a side over
    640 (small copy) or 4096 pixels (`rc_pic`). The line keeps `im {s, w, h, fw, fh, k}` (the small copy, its size, the
    picture's size and kind), which every reader of the chat gets with the line; the picture is
    `rcimg/{reg}/chat/{line} {a, d, k, t, exp}`, read only when someone opens it. `rcimg`'s collection is named `chat` on
    purpose: the time-to-live policy on the `chat` group's `exp` deletes it after 30 days with its line, and an account's
    deletion or an admin removing a nation (both delete the `chat` documents whose `a` is theirs) take it too.
    `rcDelete`, the Reports queue's `delete_post` and a silence's wipe delete it with its line; the audit entry of a
    removed line says `pic: true`. A repeat check counts the picture with the words. An answer to a picture keeps
    `r.im: true`; a mention of a line with no words reads "📷 A picture". `firestore.indexes.json` exempts `chat`'s `im`
    and `d` from indexing.
  - `rcReact {reg, id, k}`: one of `hear`, `ha`, `bravo`, `shame` per nation per line, kept as `rv {uid: kind}` on the
    line (a guest of the region may react too). `rcForget` takes a nation's reactions away with its account or its
    removal by an admin.
  - `rcMute {uid, hours, why, reg?, wipe?}` (staff): `rcMute/{uid} {until, perm?, why, by, t, nm, reg}`; `hours` is one of
    1, 24, 168, 720 or 0 (until lifted: `until` 1 Jan 2100 and `perm`). `wipe` deletes the player's lines of the last 24
    hours in `reg` (their own region if not given). `rcPost` refuses a silenced player (`rc_silenced`, with `until`,
    `perm` and `why` in the details). `rcUnmute {uid}` (staff) deletes it.
  - `rcHello {}`: the game asks it once a new nation's record is saved (`edictum:saved`, within the hour of founding,
    once per nation: `localStorage` `edictum.rgc.hello.<uid>`). The server writes `rchat/{reg}/chat/{id} {a: the new
    nation's uid, nm, x: "<name> has been founded, welcome to #<region>!", t, exp, sys: 'found'}` only for a nation whose
    birth (`eligibility()`, the record's creation, never `founded`) is within `RC_HELLO_AGE` (an hour); once a day an
    account (`rcHello/{uid} {g, t}`), so founding again and again names no one; once a day a name in a region (a nation
    carried into another account on signing in is saved anew there); at most `RC_HELLO_HOUR` (20) a region an hour
    (`rcHello/~{reg} {w: [{t, k}]}`); never for a silenced account. Otherwise it answers `{ok: true, skip}`
    (`done`, `old`, `again`, `busy`, `silenced`) and writes nothing. `rcHello/` is server-only and goes with the
    account. No new Cloud Function: it is a `civic` op like the others.
  - `rcDelete {reg, id, report?}`: the author deletes their own line; staff (admin or mod claim) any line, which
    writes an `adminAudit` entry `chat_delete` with the words and closes the report if one is named.
- `functions/admin.js` `delete_post` takes `rc:<region>:<line>` from the Reports queue.
- The lines are a `chat` collection with the author in `a`, as the alliance channels are, so deleting an account
  (`functions/accounts.js`) or an admin removing or banning a nation (`functions/admin.js`) deletes them too;
  `rcPace/` goes with the account.
- `firestore.rules`: a line is read by a signed-in player whose saved nation (`nations/{uid}.reg`) is in that region,
  and by admins; nobody writes one but the server. A line's picture (`rcimg/{reg}/chat/{id}`) is read the same way, and written
  only by the server. `rcPace/` is the server's alone. `rcMute/{uid}` is read by that player and by
  admins, and written only by the server; it goes with the account.
- Reports are ordinary `post` reports (`src/shim.js` files kind `chat` as `post`, with `post: rc:<reg>:<line>`).
- `game/edictum.html`, section "Region chat" (prefix `rgc`, state `RGC`): the button is drawn by `shell()`
  (`rgcButton`) and kept current between drawings by `rgcBadge`; the drawer is made once in `<body>`, outside
  `#app`, and drawn by its own `rgcPaint`, so the game drawing itself again never touches what is being typed. The
  listener (`rgcConnect`) follows the region as the game connects; a nation founded a moment ago is not saved yet,
  so a refused listener tries again after 3, 6, 12 and then every 30 seconds. The last line read is kept per region
  in `localStorage` (`edictum.rgc.<region>`). The settings are `dmx.rc` (0: chat off) and `dmx.rcn` (0: no mention
  notice) in the private half of the record.

## Costs

A line with a picture weighs up to about 65 KB more (its small copy) for every reader; the picture itself (up to about
930 KB) is one read, and only for whoever opens it. Every open game of the region listens to the newest 60 lines: opening the game reads up to 60 documents, and each new
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

- `test/regionchat.test.mjs` (in `test:fx`): the pacing; which pictures the server takes (kinds, first bytes, sizes).
- `test/civic.test.mjs`: writing, pacing, repeats, the region check, deleting, staff removal and its audit, bans; the
  welcome of a new nation and each case that writes none.
- `test/rules.test.mjs`: who reads a region's chat and its pictures; nobody writes them.
- `test/civic.test.mjs`, pictures: only an admin posts one, with words or alone; refused kinds and sizes; repeats;
  answers and mentions of a picture; the team's picture in another region; removal by staff or the Reports queue takes
  the picture; it is a `chat` document of its author.
- `test/region-chat-e2e.mjs` (`npm run test:region-chat`, CI suite "Region chat"): the button and drawer, two
  players writing, the count, the mention notice, runs and dividers, guests, the menu, reporting and removal from the
  Reports queue, blocking and unblocking, deleting, staff removal, a phone, and the setting; every nation founded is
  welcomed once, and a nation founded later shows its welcome line with Welcome and Say hello. Pictures: only an admin has the
  picture button; a picture chosen, pasted, taken away and sent with words or alone; the small copy in the others'
  drawers and on a phone; opening it (fetched at full size, then at its own size) and closing it; answering it; the
  server refusing a player's; the admin portal's log, its newest-line preview and the team's picture; removing a line
  takes its picture.
