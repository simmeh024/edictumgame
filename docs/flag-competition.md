# The flag competition

One competition a month, for every region together, opening on the 12th. Nations enter a flag made for the occasion,
the others score it blind, and the best three take the prizes. A competition is named after the month it opens in:
`2026-12` runs from 12 December to 11 January (`START_DAY` in `functions/flagcomp-core.js`, repeated in the page's
`FLC_RULES`). The first one, `2026-11`, opened a day early on 11 November (`EARLY`); its judging and results kept
the usual days.

## How a month runs

| Days (UTC) | Phase | What happens |
|---|---|---|
| 12 to 18 | Entries | A Registered Nation designs a flag on the Flag Competition page and enters it. It may replace or withdraw it. |
| 19 to 23 | Judging | Registered Nations at least a day old score the flags, one to five stars in five categories. |
| 24 to the 11th of the next month | Results | The podium stands; the next competition opens on the 12th. |

- The entry is a design of its own, made in the flag designer on a draft (scope `fc`). It is not the national flag, and
  the page refuses a design identical to it, because neighbours would recognise it.
- Judges are dealt flags without a name or region, the least-rated first, never their own. A judge may score flags
  from their own region.
- The five categories: Simplicity, Colour, Composition, Originality, Would you fly it.
- A flag's score is the mean of its judges' averages. From five ratings on, the highest and the lowest judge are left
  out.
- To place, a flag needs five ratings (fewer when few judges turned up: half of them, never under two), and its
  entrant must have scored ten flags (every other flag, when there are fewer than ten).
- Ties go to the flag with more ratings, then the better "Would you fly it", then the earlier entry.

## Entering and judging, in detail

- **The draft follows the player.** The design in progress is kept on the device (`{f, t}` in localStorage) and, four
  seconds after the drawing pauses (at once when the page is left or the tab hidden), on the server through the civic
  op `fcDraft` (`fcDraft/{uid}`, server only). `fcState` gives it back while entries are open; the page opens whichever
  is newest of this device's copy, the server's and the flag entered. Local copies are timed by the server's clock.
- **Three views of each flag.** The judging card shows the flag large, then at list and map size (34 and 20 pixels
  wide), then flying from a pole (18 strips of the flag, each rising and falling a little out of step; still for
  readers who ask for reduced motion).
- **Skip for now.** A skip is kept on the server (`fcSkip`, the judge's `votes/{uid}.k`): `fcDeal` deals skipped flags
  only after every other flag, so a skip sends a flag to the back of the queue. Scoring it later clears the skip.
- **Changing a score.** "Change a score" lists the flags the judge has scored (`fcMine`) and opens one again with its
  stars. `fcRate` says whether a rating was the flag's first from that judge (`first`); only a first score moves the
  tally `fcj`, and so the land credits, the achievements and the daily desk.
- **The keyboard.** 1 to 5 give the marked category its stars and mark the next one; the arrows move the mark (left
  and right change its stars); Enter submits (a focused button is pressed instead); S skips, or cancels a change.
- **Reports.** A judge may report a flag: a symbol of hate, a copy of another nation's flag, or something else, with up
  to 300 characters (`fcReport`, `reps/{eid}~{uid}`, the flag's count in `rp`). Once per flag and judge (a second
  report replaces the first), 20 flags a month at most. Reporting does not take a flag out.

## Reminders

- **The menu** marks the page when entries open (until the page is seen), on the last day of entries (until it is
  seen that day), while a judge has flags to score, and when a podium waits unopened. The first two are for a
  Registered Nation that has not entered.
- **The bell** pins a notice for an entrant still short of its share while judging is open, and another on its last
  day. The texts are fixed, so scoring a flag does not make the notice new again. An entrant's game fetches the
  competition's state once in the background so the bell knows without the page being opened.
- **By post** (`jobs/mail/run.mjs`, kind `fc`): the same entrant gets one letter when judging opens and one on its last
  day (`mailAccounts/<uid>.fc` remembers `'<month>:open'` or `'<month>:last'`). An account saved before the kind
  existed counts as having chosen it unless every other kind is off (`fcWanted`).
- **The daily desk**: while judging is open a Registered Nation has one more task, to score three flags (`n.dd.f`), paid
  5 goods and 5 iron. It stands apart from the day's three: the desk is clear without it.

## The staff's page

Admin portal › Game content › Flag competition (`admin-flagc`, civic ops `fcAdmin`, `fcRemove`, `fcDismiss`,
`fcCloseNow`, staff only). For this month or any of the six before:

- every entry with its nation, region, entry time, ratings, live score, reports and how many flags its entrant scored;
- the reports, a flag at a time, with each reason, note and reporter;
- every judge with flags scored, mean, founding date, whether they entered, and marks from `fcSuspect`:
  **Drive-by** (at most two flags scored, one given 4.6 or more), **Lifts one flag** (a flag given two stars or more
  above what at least two other judges gave it), **Same for all** (five or more flags within 0.4 of one score). A flag with marked ratings
  also shows its score without them. Marks are for a look; nothing is taken out by itself;
- "Take it out" (with a reason, in the admin audit log as `flagc_remove`), "Dismiss the reports" (`flagc_dismiss`), and
  "Run the close now" when judging is over and the month is not yet closed.

## Prizes

| Place | Prize |
|---|---|
| 1st | 300 goods and a month of the Chancery Club |
| 2nd | 150 goods |
| 3rd | 75 goods |

- The goods are added by the winner's own game, once, when it sees its uid on the public podium (`n.fcp`, a commit
  hook). They are clipped at the stockpile cap like any gift.
- The Club month is the server's: `grantPrizeMonth` in `functions/shop.js` writes `shopPrize/{uid}` and settles the
  shop. In `entitlement` a won month runs like a gifted one: it begins where everything paid, given or granted ends,
  so a paying member keeps it for later, and a renewal pushes it back whole.
- The winner wears a rosette beside its flag (wherever the Founder pill and the Chancery seal show) until the next
  podium, and every podium hangs in the Hall of Flags tab.

## Land credits for judging

- Every 5 flags a nation scores earn it a land credit, 10 at most (`JUDGE_PER`, `JUDGE_LAND` in the page's
  `FLC_RULES`). The count is the nation's lifetime tally of flags scored (`fcj`), over every competition, so the tenth
  credit comes with the fiftieth flag. After that the scoring goes on as before, for no more land.
- The credits earned are kept on the nation as `n.fcl` (shared half, so other players and the land check count them)
  and added by a wrapper around `landEarned` and `earnedAt`. A toast of the `land` kind tells of each one, and the
  judging page says how many are earned and how far the next is.
- Like every other credit they are stored, not lost, while a nation has paused its land credit gains.

## Achievements

A category of its own, "The Flag Competition" (`flag`), with 17 achievements:

| Id | Name | Tier | For |
|---|---|---|---|
| `fc-enter` | Colours to the Mast | bronze | entering a flag |
| `fc-first` | First Up the Pole | bronze | being the first nation to enter in a competition (the server says so: `fcEnter` returns `first`) |
| `fc-redo` | Back to the Drawing Board | bronze | replacing an entry with a new design |
| `fc-enter3` | Regular at the Flagpole | silver | entering three competitions in a row (`n.fce`, the months entered) |
| `fc-enter12` | A Flag for Every Season | gold | entering twelve competitions |
| `fc-judge10` | An Eye for a Flag | bronze | scoring 10 flags |
| `fc-judge50` | Seasoned Judge | silver | scoring 50 flags |
| `fc-judge100` | Chief Vexillologist | gold | scoring 100 flags |
| `fc-early` | Before the Ink Dries | bronze | scoring a flag on the first day of judging |
| `fc-duty3` | Reliable Juror | silver | scoring a full share of flags in three competitions (`n.fcd`: the last month counted) |
| `fc-all` | No Flag Left Unscored | silver | scoring every flag in a competition with at least five others (`n.fca`) |
| `fc-podium` | A Flag on the Podium | silver | a place in the first three |
| `fc-podium3` | A Habit of Podiums | gold | three podiums |
| `fc-set` | The Whole Podium | gold | first, second and third place, each at least once |
| `fc-win` | Best in Show | gold | winning |
| `fc-ace` | By Acclamation | gold | winning with a score of 4.5 or more |
| `fc-win3` | Flag of Flags | platinum | winning three competitions |

None is paid for what the stars were: an achievement for a five-star or a one-star rating would bend the scores.
A month entered counts once, however often its flag is withdrawn and entered again, and an entry the server holds is
added to `n.fce` when the page loads, whichever device made it.

## Where things live

- `functions/flagcomp-core.js`: the rules with no Firebase in them (calendar, ratings, dealing, scoring, ranking).
- `functions/flagcomp.js`: the civic ops `fcState`, `fcEnter`, `fcWithdraw`, `fcNext`, `fcRate`, `fcSkip`, `fcMine`,
  `fcReport`, `fcDraft`, and for staff `fcAdmin`, `fcRemove`, `fcDismiss`, `fcCloseNow`,
  the close (`fcClose`) and the account clean-up (`fcForget`). No new Cloud Function: the ops run inside `civic`.
- `functions/flagcomp-prize.js`: loads the shop only when a competition closes.
- `game/edictum.html`, section "the flag competition" (state `FLC`, page `flagcomp`, probe `G.FLC()`).
- `firestore.rules`: `flagc/{month}` and `flagc/{month}/hall/{entry}` are public and read-only; `flags`, `mine` and
  `votes` under a month, and `shopPrize/`, are the server's alone.
- `firestore.indexes.json`: a collection-group index on `hall.u`, used when an account is deleted.

```
flagc/{month}              {n, st: 'open' | 'done', res?: {at, need, duty, all, top: [{e, u, nm, rg, fl, s, n, c}], club?}, hw?}
flagc/{month}/hall/{eid}   {u, nm, rg, fl, t, s, n, c, pl, why?}     written when judging closes
flagc/{month}/flags/{eid}  {u, nm, rg, fl, t, n}                     server only
flagc/{month}/mine/{uid}   {e}                                       server only
flagc/{month}/votes/{uid}  {v: {eid: '54353'}, t, k?: {eid: t}, rp?} server only (k: skipped, rp: reports sent)
flagc/{month}/reps/{eid~uid} {e, by, why, note, t}                  server only
fcDraft/{uid}              {fl, t}                                   server only
```

There is no timer. A month is closed by the first request after its judging ends: any open game asks once when its
clock says the judging is over, and `fcState` also closes the previous month if nobody came by. Closing is safe to
repeat: the podium is published once, the Club month is granted once (keyed `fc-<month>`), and the hall is rewritten
if a close was cut short.

## Limits worth knowing

- Unlocked parts are checked by the entrant's own game (`flagNorm`), not by the server: a tampered client could enter
  a pattern or emblem its nation has not earned. A flag has no free text or images, only parts from fixed tables.
- Ratings from accounts on the same connection as the entrant are not excluded: the civic ops do not see the caller's
  address. The trimmed mean and the minimum number of ratings are the defence.
- Staff can take a flag out before the results, from the staff's page or with the "Remove this flag (staff)" button on
  the judging card.
- A winner must open the game within about two months for the goods (the game watches this month and the two
  before); opening the Hall of Flags looks back six more.

## Tests

| Command | What it covers |
|---|---|
| `node --test test/flagcomp.test.mjs` (in `npm run test:fx`) | The rules, and that the page repeats the server's calendar and numbers |
| `node --test test/shop.test.mjs` (in `npm run test:fx`) | A won Club month, alone and behind a paid membership |
| `npm run test:flagcomp` | The ops on the emulators: a whole month, the late close, staff removal, drafts, skips, changed scores, reports, the staff's page |
| `npm run test:mail` | The reminder letters: once when judging opens, once on its last day, never to one who switched them off |
| `npm run test:rules` | Who may read and write the competition's collections |
| `npm run test:flagcomp-e2e` | The page in a browser: four nations enter, score and open the results; `FC_SHOTS=<folder>` keeps pictures |

In the emulators the competition's clock can be shifted with the document `flagcTest/clock {skew: ms}`; production
ignores it.
