# Community Board

Every region's board, under News and people › Community Board. First *Latest on every board* (the newest topics of
all the boards with any), then the player's own region, open, then the Chancery (Club members and Founding
Supporters), then the other boards that have topics, collapsed; the empty boards wait behind a picker. Registered
Nations open topics and reply on any board; guests read, follow and react. Everything is written by the server (civic
ops `cb*` in `functions/board.js`); the page only reads.

The Region page's **Board** tab shows the same board: the region's topics first, then its **Quick messages** (the
short-message board, `boards/{reg}`, up to 400 characters, unchanged), so each region has one place to talk.

## What players can do

- **Topics and replies** with a kind (General, Trade, …), @mentions (the bell), edits and deletes of their own posts,
  reports of others'. Staff pin, lock, hide, move and delete inside the board; admins post on several boards at once
  from the admin portal.
- **Follow a topic.** The author follows their topic from the start, and so does everyone who replies, unless they
  muted it. Each new reply puts a notice in the bell ("Readerland replied on “Trade fair”", or "3 new replies on …"),
  under its own switch in Settings › Notifications. **Follow** / **✓ Following** sits under the topic; pressing it
  while following mutes the topic, so replying again does not follow it again.
- **What is new.** The menu counts the followed topics with unread replies. Above the boards, *Topics you follow*
  lists them, the newest news first, with *Mark all as read*. On a board, a topic shows **2 new** (replies since the
  player last read it) or **New** (never opened). Opening a topic scrolls to a *New since you last read* line.
  Followed topics are counted by the server, so this works across devices; other topics are remembered in the
  browser (`edictum.cbSeen.<uid>`).
- **Reactions** on topics and replies: the region page board's four (👍 ❤️ 🎉 🤔), one per nation on each post.
  The same reaction again takes it back. Hovering a reaction names who gave it.
- **Quote** a post into a reply. The reply shows the quoted post's words as they read now, and a link to jump to it.
  A post that was hidden or deleted shows as "no longer shown".
- **Formatting**: `**bold**`, `*italic*` (or `_italic_`), and lists of `- ` or `1. ` lines, with buttons and
  Ctrl+B / Ctrl+I. *Preview* shows the post as it will read. A link to edictumgame.com becomes a link. A nation's
  page (`#visit/<id>`) or a topic (`#community/<region>/<topic>`, from the topic's *Copy link*) shows as a card. The
  text is escaped before formatting, so only those few tags are ever made.
- **Author column**: flag, name, rank colour, alliance initials, a Club mark, online state, the Founder and staff
  badges, the region, and the total number of posts. Under each post, the author's **signature**, written in
  Customise › Community Board (up to 100 characters). Staff can remove a signature with *Remove signature*.
- **Finding topics** (2026-11-22): buttons for a kind, and for *Unanswered*, *Started by me* and *Following*, apply
  to Latest and every board, and are kept on the device (`edictum.cbFlt`). A row shows the post's first line and
  who replied last (`lr`). *Latest on every board* reads each board with topics once every 90 seconds (15 topics
  each); the boards open on the page stay live.
- **Reading a long topic**: it opens on its latest 20 replies, or from the first unread one, with *Show N earlier
  replies*. Every post has *Reply* (which names its author in the box, a mention). A *Reply* bar stays at the foot of
  the screen while the replies scroll by and comes to rest above the reply box. At the bottom: back to the boards
  (where the list was left) and the previous and next topic of the list the topic was opened from.
- **Drafts**: a topic or reply being written is kept on the device for 14 days (`edictum.cbDraft.<uid>`, a reply per
  topic). A topic left unfinished is offered on the front page: *Continue writing* or *Discard*.
- **When the next post may go**: the form says so ("You can post again in 25 seconds."), from the device's own posts
  and the wait the server last gave. *Post* stays pressable; the server's pacing decides.

## How it works

| Data | What it holds | Who reads it |
| --- | --- | --- |
| `cb/{reg}` | topic and reply counts, last activity, posts today | everyone |
| `cb/{reg}/posts/{tid}` | a topic; `rv {uid: kind}` reactions; `lr` who replied last | everyone (the Chancery: members) |
| `cb/{reg}/posts/{tid}/posts/{rid}` | a reply; `q` the post it quotes, `rv` | as above |
| `cbSubs/{tid}` | `{reg, f: {uid: 1 following, 0 muted}}` | server only |
| `cbWatch/{uid}/t/{tid}` | the player's copy: `{reg, ti, f, n, t, nt, nm, s}` | the player, who may only set `n` to 0 and `s` |
| `cbUser/{uid}` | board profile: `{n, t, nm, rg, rk?, al?, cl?, fd?, sg?}` | everyone |
| `cbRx/{uid}` | where the player reacted, so reactions leave with the account | server only |

- **Reply** (`cbReply`): one transaction writes the reply and the counts. It adds the replier to `cbSubs` unless they
  muted the topic, and adds one to `n` on every other follower's copy, up to 200 followers per topic. A topic from
  before following began picks up its author at its first reply.
- **Follow** (`cbFollow {reg, topic, on}`): following or muting, for any nation that can read the board.
- **React** (`cbReact {reg, topic, reply?, e}`): paced like the region page's reactions (20 at once, then one every
  4 s).
- **Signature** (`cbSig {sg}`) for a Registered Nation. Staff remove one with `cbMod {act: 'nosig'}`.
- **Profile**: refreshed with every post. The rank is the index the author's own game sends (`rk`). The alliance is
  read from `allyOf/` and `alliances/`, the Club and Founder marks from `shop/`. The first post after this shipped
  counts the posts already on the boards. Deleting posts lowers the count. Posts signed by the Edictum team count for
  nobody.
- **Moderation**: hiding a topic blanks its title in the followers' copies until it is shown again. Moving a topic
  moves the copies; deleting one deletes them.
- **Account closed or nation removed** (`cbForget`): its reactions, follows, copies, `cbRx` and profile go.

## Tests

- `test/civic.test.mjs`: following, notices and muting; reactions and quotes; the profile, counts and signature.
- `test/rules.test.mjs`: `cbWatch` read and mark-read only; `cbUser` public and server-written; `cbSubs`/`cbRx`
  closed.
- `test/board-e2e.mjs` (`npm run test:board`): the whole flow in the browser, from preview and formatting through
  notices, the New line, reactions, quotes and muting, to the signature and staff removing it. Screenshot:
  `test/out/board-following.png`.
- `test/board-round3-e2e.mjs` (`npm run test:board-round3`): Latest, the picker, filters, rows, a 34-reply thread
  (Show earlier, Reply, the bar, the way on), drafts across a reload, the pacing line, the Region page's Board tab, and
  a phone. Screenshots: `test/out/board3-topic.png`, `board3-region.png`, `board3-phone.png`.
