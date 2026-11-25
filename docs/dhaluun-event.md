# Dhaluun's Cloudspine event

This change is inactive on deployment. After approval, an operator runs the admin tool to launch it once.
It snapshots every other active, visible nation in Cloudspine (players and NPCs). Dhaluun's intelligence-gathering
missions all fail and are exposed in the existing intelligence/news feeds. No successful-operation effects or
intelligence rewards are granted. Nations founded or arriving later are not added retroactively.

The event adds 120 connected, previously unclaimed land hexes on the west side of Dhaluun's capital. It preserves
every other nation's occupied hexes, including hidden nations, and stops if there is insufficient connected land.
The event's numbered hexes are stored once; clients do not choose their own expansion. Earlier atlas dates do not
show the expansion. Normal later conquests, capitals and explicit claims continue to use the game's territory rules.

The same transaction creates an ordinary region-chat message authored by `npc-cloudspine-dhaluun`, after the
operation: **hmm, that did not go to plan.** It has the usual 30-day chat expiry and can be moderated normally.
The immutable event id prevents a rerun from posting again or awarding another 120 hexes. If Cloudspine changes
while the map is being planned, the tool stops and asks the operator to run it again.

## Run only after approval

Install the root and functions dependencies (`npm ci` and `npm ci --prefix functions`) and the Playwright browser
(`npx playwright install chromium`). Set `GOOGLE_APPLICATION_CREDENTIALS` to the existing project's service account.
Deploy the client and Firestore read rule before activation, so connected clients can read the event.

Preview without writing:

```sh
node tools/admin/dhaluun-event.mjs --project edictum-b30de
```

After reviewing the preview and receiving approval:

```sh
node tools/admin/dhaluun-event.mjs --project edictum-b30de --apply
```

The command uses a headless, disconnected copy of the actual game to compute current ownership and validate the
120-hex increase. It never signs a player in or saves a player nation. It writes only the event, chat line and audit
entry, with a transaction check on the nation snapshot. Browser clients can read `worldEvents` but cannot write it,
including accounts with the admin claim.

Checks:

```sh
node --test test/dhaluun-event.test.mjs
node --test test/dhaluun-event-plan.test.mjs
npx firebase emulators:exec --project demo-edictum --only firestore "node --test test/dhaluun-event-rules.test.mjs"
```

## The Great Border Wall and the Dispatch report

The next stage adds a completed **Great Wall** to Dhaluun’s capital, using the existing wonder’s 12% defence bonus.
Its crenellations and watchtowers follow every edge of the empire’s current perimeter, including the western
expansion and coast, rather than the short stretch used by an ordinary Great Wall. It follows later border changes
and is absent from atlas dates before construction.

The same event update publishes **“Behind Dhaluun’s new wall, preparations for something”** in Cloudspine’s Dispatch.
The report attributes the preparations to sources and leaves their purpose unknown. It belongs to the edition
covering the activation time and is included when that edition is archived normally.

After deploying the client, preview the wall stage:

```sh
node tools/admin/dhaluun-wall.mjs --project edictum-b30de
```

Publish the wall and article together:

```sh
node tools/admin/dhaluun-wall.mjs --project edictum-b30de --apply
```

This updates only the existing event’s `wall` field and creates one audit entry. A repeat returns `already-applied`.
The original territory, spy-operation timestamp and target snapshot stay intact. No additional chat post is made.

`npm run test:dhaluun-wall` checks the full perimeter, defence bonus, Dispatch edition, timeline and operator replay
handling. It also renders the real wall and the Dispatch article to screenshots in `test/out/`.

## The imperial customs notice

`tools/admin/dhaluun-customs.mjs` publishes the owner's approved text once in the **Western Dhaluun Free Trade
Agreement** channel, authored by Dhaluun. The alliance channel and chat drawer show its reserved message identity as
a yellow warning block, with an imperial customs heading. Normal messages cannot acquire that styling by copying
its words. Reactions and officer moderation remain available.

The same transaction creates `worldEvents/dhaluun-customs-v1`: a snapshot of up to two active trade routes per player
member. A shared route counts against both members' limits. Routes with Dhaluun are preferred, then other NPCs,
then fellow members. The command previews the actual game's signed, unsuspended, nonzero-flow routes; pending
offers and future trades are not selected.

Selected routes deliver **50% less in both directions for exactly 24 hours**, starting when the command publishes.
The reduction combines with existing blockade/escort effects. It changes real imports, exports and stock accrual,
while the route card states the reduction and its expiry. Stock accrual is split at the start and end boundaries,
including catch-up for an absent player. Normal flow resumes automatically; keep the event record for historical
stock accrual rather than deleting it at expiry. Existing stockpiles and the signed contracts are not rewritten.

Preview, then publish after the client has deployed:

```sh
node tools/admin/dhaluun-customs.mjs --project edictum-b30de
node tools/admin/dhaluun-customs.mjs --project edictum-b30de --apply
```

Publication checks that alliance membership and the region's nation snapshot have not changed during planning,
then writes the event, private alliance-chat message and audit entry atomically. A repeat returns `already-applied`.
The message stays as channel history after the disruption ends. No region-wide chat message is sent.

`npm run test:dhaluun-customs` checks the deadline, stock catch-up, route allocation, exact message, atomic
publication and the warning's desktop/mobile appearance in light and dark themes.

## Saaveri's condemnation

`tools/admin/dhaluun-assembly.mjs` tables **Condemnation of Dhaluun: On the Weaponisation of Customs** on behalf of
Saaveri, Cloudspine's free-transit kingdom. It publishes the owner's approved full text and Saaveri's announcement.
An existing player vote continues: the motion reserves the next three-day Assembly cycle, appears under Proposals,
and has a Community Board debate immediately. Player proposals remain queued under the normal lapse rules.

```sh
node tools/admin/dhaluun-assembly.mjs --project edictum-b30de
node tools/admin/dhaluun-assembly.mjs --project edictum-b30de --apply
```

Deploy the client and `functions/civic.js` before applying. Publication is one transaction: the reserved protected
cycle, event record, board debate and count, Assembly revision, Saaveri's region-chat announcement, and audit entry.
It refuses to replace another reserved vote and returns `already-applied` on a repeat. No player's votes, proposals
or nation records are rewritten. The full motion uses the trusted protected lock; player proposal text limits stay
at 280 characters. The normal voting weights, two-to-one condemnation threshold and seven-day censure apply.

When the normal Assembly service finalises this protected count after its deadline, that same transaction posts
Dhaluun's response in region chat and, if the debate remains available and unlocked, as a reply there:

> His Imperial Loftiness acknowledges the Assembly’s concern. The wall shall be raised accordingly.

The response is posted once whether the resolution passes or fails. It is a boast; it does not raise the physical
wall or increase its defence. No browser has to stay open, and no scheduled job or external automation is involved:
as with other Assembly results, the first normal Assembly request after the deadline finalises the count.

`test/dhaluun-assembly.test.mjs` covers the protected docket, ordinary player voting, operator atomicity, replay and
reply deadline. `test/dhaluun-assembly-page.test.mjs` renders the complete motion on desktop and mobile and at the
vote. `test/civic.test.mjs` exercises real publication and the single reply in the closing transaction on emulators.
