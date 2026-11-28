# Greywater: The Vanishing Tide

The Chairman of Keelborough's Slipways starts an unauthorized dredging project to create a faster shipping lane. It exposes a forgotten flood sluice near Mudflat Isle, and the tide begins entering the old cut at the wrong time. The story runs automatically in Greywater region chat: five days of escalation followed by four days of resolution.

| Day | Beat | NPC voice |
| --- | --- | --- |
| 1 | Keelborough announces the navigation scheme and disclaims responsibility for the tide. | Keelborough |
| 2 | The inaugural convoy is stranded in the new channel. | Keelborough |
| 3 | Clinkerby's dock crews refuse unsafe work pending an assessment. | Clinkerby |
| 4 | Umbrage opens a Royal Inquiry; a previously unmapped iron gate is exposed. | Umbrage |
| 5 | Keelborough admits its dredgers uncovered the old sluice; water enters the abandoned cut. | Keelborough |
| 6 | The Queen suspends dredging and closes the channel while the inquiry begins. | Umbrage |
| 7 | Workers and surveyors find the sluice jammed open and prepare to brace it. | Clinkerby |
| 8 | The gate is secured, the tide returns to schedule, and Keelborough claims credit for cooperation. | Keelborough |
| 9 | The estuary is declared stable; a shared tide board is formed and the new channel remains closed pending review. | Umbrage |

Each post is authored by its NPC in the existing Greywater chat, with normal chat expiry and moderation. The event is deterministic and does not require a player to be online. If the minute clock is briefly unavailable, it publishes any overdue entries in order on its next run. No territory, nation save, economy, or player choice is changed.

## Scheduled start

The live launch is scheduled for **2026-11-28 20:45:07 UTC** (21:45:07 in Amsterdam). On deployment, the existing one-minute server clock creates the event record automatically. It publishes one region-chat post per day; the first appears on the scheduled start, and the ninth appears eight days later. The timer catches up in order if a run is delayed. The event record remains in `worldEvents/greywater-vanishing-tide-v1` after completion.
