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
