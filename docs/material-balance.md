# Material balance, 23 November 2026

New nations start with 60 goods, up from 40. The other starting stores remain 60 food, 45 timber, 25 iron and 10 oil.

Existing player nations receive the extra **20 goods once**, automatically on their next save or within five seconds of opening the updated game. The `mbg` field records how many have actually been received. If stores have less than 20 room, only what fits is paid, and the rest remains due until space opens. Repeated saves, reloads and concurrent devices do not pay it twice. Newly founded nations are marked as already paid because their starting stock includes the increase. Re-founding creates a new nation with that same starting stock; it does not create another back payment. Computer nations are excluded. The player sees a payment notice when goods arrive.

Each active city held by a player pays **2 food, 1 timber and 1 goods per day directly into the stockpile**, including cities without buildings. This income is added after consumption, the state's share, spoilage and the low-stock top-up; it does not change resource supply ratios. It follows the city's current holder, including an occupied city, through the existing city aggregate. Computer nations receive no bonus. Storage limits still apply. The resource breakdown identifies the payment as “City base income”.

With one city held throughout, no spending and no storage limits, the change alone adds:

| Since founding | Extra food | Extra timber | Extra goods (including the larger starting stock) |
|---|---:|---:|---:|
| At founding | 0 | 0 | 20 |
| After 2 days | 4 | 2 | 22 |
| After 3 days | 6 | 3 | 23 |

Other income, growth, trade, rewards and player actions continue to affect actual stocks. For illustration, with a fixed pre-change income of 7 goods/day, one city now earns 8/day: **60 → 76 after two days → 84 after three days**, before spending. This illustration holds the original income constant; it is not a prediction of population growth.

## Building material prices

Food, timber and oil in new-building and upgrade quotes are multiplied by 1.2, rounded up to whole units. Iron and goods retain their previous prices. This covers the five upgrade blocks, tier II retools, economy levels, warehouse tiers, city walls and space-building quotes (including their shipping oil). Build durations and output are unchanged.

| Quote without cabinet or research discounts | Before | After |
|---|---|---|
| Farm Estates | 10 timber, 8 goods | 12 timber, 8 goods |
| Sawmill | 12 food, 8 goods | 15 food, 8 goods |
| Factory | 15 timber, 6 iron | 18 timber, 6 iron |
| Space Port | 60 iron, 30 oil, 60 goods | 60 iron, 36 oil, 60 goods |
| Factory, first upgrade block | 6 timber, 5 iron | 8 timber, 5 iron |
| Factory, gold upgrade block | 23 timber, 23 iron | 28 timber, 23 iron |
| Factory, tier II retool | 180 timber, 80 iron, 40 oil, 30 goods | 216 timber, 80 iron, 48 oil, 30 goods |
| Warehouse, first upgrade | 72 timber, 48 iron, 36 goods | 87 timber, 48 iron, 36 goods |

For example, a Sawmill's food cost is `ceil(12 × 1.2) = 15`. A Factory's gold block already converts 30% of its timber to iron; only the remaining 23 timber receives the surcharge: `ceil(23 × 1.2) = 28`. Upgrade prices use the original building base so the surcharge is applied once. Kept payments on land buildings and upgrades remain the source for cancellation refunds.
