# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/wizzy-bounty/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/wizzy-bounty/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

The best token launch radar: a program that reads a sealed snapshot of every
protocol DefiLlama tracks and writes a web dashboard ranking the protocols that
record no token yet by what their launch would be worth — each with the steps to
farm it, the risks to watch, and the live-token benchmarks the price rests on.
Every implied value carries a band from the model's own leave-one-out
spread, the value model is tested out of sample, and every farm plan is
netted at the band's low end.

Built for the make.fun `token-radar-01` competition ($1,325, 1st place $1,000).
No entry fee, no network at runtime.

## What it does

`main.ts` (Node 22, standard library only) reads `/input/snapshot.json`
(758 protocols at or above $5M TVL, 40 on the watchlist, snapshot 2026-11-14)
and writes to `/output`:

- `board.json` — **198 rows**: every farmable pre-token protocol in the snapshot
  (all 40 watchlist protocols covered, plus all 158 other pre-token protocols),
  ranked by implied value, each with an eight-step farm plan.
- `data.js` — the dashboard's dataset, beside the page.
- `dashboard/` — a static page (no network): a "start here" shortlist of the five
  to farm first, the value model stated on the first screen, a searchable,
  sortable board with a signal in every row, a band from the model's own
  leave-one-out spread and a Net column (the band's low end minus the farm
  plan's cost) on every row, category and chain filters, a watchlist-only
  toggle, a detail view per protocol with the full model breakdown, its
  watch-outs, its farm plan with the earning mechanism and the netted verdict,
  a benchmark tab listing **all 128 priced live tokens with a usable price,
  each with its market cap per TVL dollar and the multiple the curve assigns
  its size**, and a model panel with the size-curve formula, the
  category-offset table and the out-of-sample backtest. Every protocol in the
  snapshot is accounted for on the page: 198 ranked, 144 set aside as wrapped,
  staked, bridged or exchange products of tokens that already trade, and 416
  that already record a token (128 of them with a usable price, 16 carrying a
  price of zero, and 272 with no price in the snapshot) — a census of
  198 + 144 + 416 = 758.
- `screenshots/` — the board, a protocol's detail view, and a filtered view.
- `dossier.json` — built with the kit's `vendor/makefun-board.ts`.

## The model (radar-5)

Implied value comes from a size curve — market cap grows slower than TVL, so
the implied multiple falls as a protocol grows — not from a flat
category-median multiple:

```
log10(value) = 3.02 + 0.52 x log10(TVL) + a category offset shrunk by n/(n+15)
```

- The curve is fitted at runtime from the snapshot; no multiple is hardcoded
  and no protocol name is ever special-cased. The category offset is each
  category's mean residual from the curve, shrunk toward zero by n/(n+15),
  where n is the category's number of priced comps, so thin categories barely
  move the fit. Growth and tenure are shown as signals on each row, never
  priced in.
- The fit rests on the 128 priced tokens with a usable price. Of the 416
  protocols that record a token, 16 records carry a price of zero and are
  excluded as evidence, and 272 record a token with no price.

**Tested out of sample.** A leave-one-out backtest on the 128 comps — each
token priced by a model fitted without it, then compared with the market cap
it actually carries — gives the curve model a median error of x3.70 against
x4.89 for the old category-median model. A time split (fit the older half,
price the newer) agrees: x3.01 against x4.82. Each row's band is the model's
own LOO spread — the middle half of its leave-one-out errors, applied to that
row's implied value.

**Farm plans netted at the band's low end.** Each plan states its cost and
its net at the band's low end (band low minus plan cost), and carries a
Farm / Thin / Skip verdict on that netted figure. Each plan also names the
mechanism it actually earns by — for example trading fees, borrower interest,
vault yield, or funding and basis — from the protocol's category and the
snapshot's numbers.

The board covers 198 pre-token protocols, with all 40 watchlist protocols
covered. Census: 198 ranked + 144 set aside + 416 token-recording = 758.

Top of the board on this snapshot: Sentora Curator ($101.6M), Steakhouse
Financial ($101.5M), Gauntlet ($75.9M). "No token" means the snapshot records no
token for the protocol — it does not prove the protocol has none. Implied value
is this radar's own estimate, not a price and not a promise of a launch.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

The program is deterministic: two runs write byte-identical output.

## License

MIT — see `LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
