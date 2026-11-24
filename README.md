[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/wizzy-bounty/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/wizzy-bounty/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# RADAR-8 — Break-Even First

An entry for the make.fun bounty [token-radar-01](https://make.fun/bounty/token-radar-01).

RADAR-8 ranks all 198 protocols that pass the house watchlist rule with the
TVL floor lifted (the 40-name watchlist plus early and off-list protocols),
and prices every row at **its own minimum viable capital** — the smallest
deposit whose net, after plan fees and hands-on time at $25/h, clears a 4%
T-bill over the same horizon. The cover of the dashboard is the model
evidence, not board statistics.

## What it does

- **Four-way term tests.** Every candidate term for both models (a log-log
  value model on the 128 priced peers, a logistic launch-odds model on all
  758 protocol records) must lower the held-out miss in at least 3 of 4
  schemes — leave-one-out, walk-forward, leave-one-family-out and
  leave-one-chain-out — or it is printed as *tested, not kept*, next to a
  control term that must not help and never does. Coefficients carry
  bootstrap standard errors from 200 seeded refits.
- **Split-conformal intervals.** The value model is fitted on one split of
  the priced peers and its absolute log errors calibrated on a held-out
  split; each row's whisker is the conformal 80% interval, scaled per TVL
  tercile. Measured coverage on the calibration split (53% at the 50%
  target, 87% at the 80% target) is printed on the cover.
- **Break-even economics per row.** Minimum viable capital, break-even drop
  share at a $10,000 reference deposit, verdict (FARM / MARGINAL / SKIP)
  read at the viable capital, and net per hands-on hour. Deposits are sized
  at most 5% of a protocol's TVL and at most $1,000,000.
- **Full accounting.** A stacked ledger accounts for all 758 snapshot
  protocols exactly once — ranked, token trades, token recorded with no
  cap, and out by the house rule with the reasons itemised — beside an
  integrity strip (rows recomputed, total implied, `main.ts` checksum,
  watchlist 40/40, ledger 758/758).
- **Two featured detail pages** (best FARM by net/hour, best watchlist
  row) with factor-by-factor value breakdowns, nearest priced peers, a
  net-by-deposit-by-drop-share matrix, break-evens, exit rules and a
  10-step farm plan with a cost and a time on every step. Every other row
  has its own detail view. Scenario controls (drop share, horizon, plan
  size) recompute every verdict live; the board sorts by any column,
  including net/hour and viable capital, and exports CSV/JSON.

## Run it

```
node main.ts --input /path/to/snapshot.json   # writes /output
MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

Node 22, standard library only. Output: `board.json` (the ranked board),
`dashboard/` (the page, with `data.js` generated beside it), `screenshots/`,
and `dossier.json` — written exactly as `buildDossier` returns it.

## Layout

- `main.ts` — entry point: fits the models, writes the board, the page data
  and the dossier.
- `lib/model.ts` — both models, the four-way term tests, the split-conformal
  calibration, the board and the detail builder.
- `lib/farm.ts` — chain fee classes, costed farm plans, break-even pricing.
- `lib/stats.ts` — the small statistics toolkit (seeded RNG, ridge fits,
  logistic IRLS, bootstrap).
- `dashboard/` — the page: sortable, filterable, searchable, with a live
  scenario editor and CSV/JSON export. No network requests; the whole
  dashboard source stays under the 64 KiB budget so it is read whole.
