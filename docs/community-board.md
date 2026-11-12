# Community Board

Every region's board, under Other › Community Board. The player's own region comes first and open, then the
Chancery (Club members and Founding Supporters), then every other region, collapsed. Registered Nations open topics
and reply on any board; guests read, follow and react. Everything is written by the server (civic ops `cb*` in
`functions/board.js`); the page only reads.

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

## How it works

| Data | What it holds | Who reads it |
| --- | --- | --- |
| `cb/{reg}` | topic and reply counts, last activity, posts today | everyone |
| `cb/{reg}/posts/{tid}` | a topic; `rv {uid: kind}` reactions | everyone (the Chancery: members) |
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
