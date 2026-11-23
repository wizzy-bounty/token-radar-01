[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/wizzy-bounty/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/wizzy-bounty/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# RADAR-7 — Token Launch Radar

An entry for the make.fun bounty [token-radar-01](https://make.fun/bounty/token-radar-01).

RADAR-7 ranks every protocol the house watchlist rule would rank — with the
TVL floor lifted, so early protocols are ranked too — and prices each one
with two models fitted on the snapshot's own figures at run time. Nothing on
the board is hand-entered.

## What it does

- **Coverage that reconciles.** The board ranks 201 protocols (the 40-name
  watchlist plus every other protocol passing the house rule), and a stacked
  ledger accounts for all 758 protocols in the snapshot: ranked, already
  carrying a recorded cap, token recorded with no cap yet, and out by the
  house rule itself, with the out-reasons itemised.
- **A value model with three held-out tests.** ln(cap ÷ TVL) is regressed on
  the protocols whose tokens carry a positive cap. A candidate term is kept
  only if it lowers the typical miss in all three tests: leave-one-out,
  walk-forward (earlier listings price later ones), and leave-one-family-out.
  Terms that fail — including a control term that cannot legitimately help —
  are printed as tested, not kept.
- **An odds model the same way.** A logistic fit over all 758 protocols for
  whether a token gets recorded, gated by the same three tests.
- **Honest ranges.** 200 bootstrap refits (coefficients plus a drawn
  residual, because peers scatter around the model) give every row a
  P10–P90 implied band and a 5–95% rank range. The page checks the bands
  against the priced peers: the share of actual caps inside the printed
  P25–P75 and P10–P90 bands is reported next to the model.
- **Costed verdicts with a stress column.** At a default scenario ($10,000
  deposit, 7% of any launch value to farmers, 12 weeks), each row's drop is
  priced against step fees from its own chains and hands-on hours at $25/h,
  versus a 4% T-bill: FARM, MARGINAL or SKIP. The verdict is recomputed at
  the row's P25 implied value as a stress test, and every row carries a
  concrete farm plan (in `board.json`) with a cost and a time on each step.
- **Two deep detail pages** — the best farm and the best watchlist protocol —
  with factor-by-factor value and odds breakdowns, priced peers, a
  net-by-size matrix, break-evens and a 10-step costed plan. Every other row
  has its own detail view with the verdict priced out.

## Run it

```
node main.ts --input /path/to/snapshot.json   # writes /output
MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

Node 22, standard library only. Output: `board.json` (the ranked board),
`dashboard/` (the page, with `data.js` generated beside it), `screenshots/`,
and `dossier.json`.

## Layout

- `main.ts` — entry point: fits the models, writes the board, the page data
  and the dossier (exactly as `buildDossier` returns it).
- `lib/model.ts` — the two models, the three held-out tests, term
  selection, the bootstrap.
- `lib/farm.ts` — chain fee classes, verdicts, farm plans, detail builder.
- `lib/stats.ts` — the small statistics toolkit (seeded RNG, ridge fits,
  logistic IRLS).
- `dashboard/` — the page: sortable, filterable, searchable, with a live
  scenario editor and CSV/JSON export. No network requests; the whole
  dashboard source stays under the 64 KiB budget so it is read whole.
