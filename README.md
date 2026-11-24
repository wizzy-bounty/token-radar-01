# RADAR-9 — Consensus Radar (token-radar-01)

[![Competition](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/wizzy-bounty/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/wizzy-bounty/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar for the make.fun **token-radar-01** bounty. The program
(`main.ts`, Node 22, standard library only) reads the sealed DefiLlama
snapshot, ranks the pre-token protocols by implied value, and writes a
dashboard that shows its working: every figure on the page is computed from
the snapshot at run time.

## The model

RADAR-9 prices each protocol with a **consensus of three unlike estimators**
and takes the median: a ridge regression on log size with ridge-shrunk
category/family effects, a median (L1) regression on the same design, and a
local peer estimator (distance-weighted median multiple of the 15 nearest
priced peers). Terms enter the parametric design only through greedy forward
selection in which each addition must improve **all four** held-out tests —
leave-one-out, walk-forward, leave-one-family-out, leave-one-chain-out — and
the shipped consensus is scored under the same four tests. Intervals are
split-conformal, calibrated on cross-fitted residuals of the consensus;
launch odds come from a logistic model under the same four-test gate and are
Platt-calibrated on out-of-fold predictions. Each row is then priced
break-even-first: the verdict is read at the smallest deposit whose net
clears a 4% T-bill hurdle after the plan's own fees and hands-on time.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` (the dossier exactly as the vendored `buildDossier` returns
it) into the output directory.

## License

MIT — see `LICENSE`.
