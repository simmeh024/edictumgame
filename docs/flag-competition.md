# The flag competition

One competition a month, for every region together, opening on the 12th. Nations enter a flag made for the occasion,
the others score it blind, and the best three take the prizes. A competition is named after the month it opens in:
`2026-11` runs from 12 November to 11 December (`START_DAY` in `functions/flagcomp-core.js`, repeated in the page's
`FLC_RULES`).

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

## Where things live

- `functions/flagcomp-core.js`: the rules with no Firebase in them (calendar, ratings, dealing, scoring, ranking).
- `functions/flagcomp.js`: the civic ops `fcState`, `fcEnter`, `fcWithdraw`, `fcNext`, `fcRate`, `fcRemove` (staff),
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
flagc/{month}/votes/{uid}  {v: {eid: '54353'}, t}                    server only
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
- Staff can take a flag out before the results with the "Remove this flag (staff)" button on the judging card.
- A winner must open the game within about two months for the goods (the game watches this month and the two
  before); opening the Hall of Flags looks back six more.

## Tests

| Command | What it covers |
|---|---|
| `node --test test/flagcomp.test.mjs` (in `npm run test:fx`) | The rules, and that the page repeats the server's calendar and numbers |
| `node --test test/shop.test.mjs` (in `npm run test:fx`) | A won Club month, alone and behind a paid membership |
| `npm run test:flagcomp` | The ops on the emulators: a whole month, the late close, staff removal |
| `npm run test:rules` | Who may read and write the competition's collections |
| `npm run test:flagcomp-e2e` | The page in a browser: four nations enter, score and open the results; `FC_SHOTS=<folder>` keeps pictures |

In the emulators the competition's clock can be shifted with the document `flagcTest/clock {skew: ms}`; production
ignores it.
