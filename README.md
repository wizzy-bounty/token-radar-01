# Token Radar — 198 pre-token protocols priced off 144 live tokens, with farm plans

The best token launch radar: a program that reads a sealed snapshot of every
protocol DefiLlama tracks and writes a web dashboard ranking the protocols that
record no token yet by what their launch would be worth — each with the steps to
farm it, the risks to watch, and the live-token benchmarks the price rests on.

Built for the make.fun `token-radar-01` competition ($1,325, 1st place $1,000).
No entry fee, no network at runtime.

## What it does

`main.ts` (Node 22, standard library only) reads `/input/snapshot.json`
(758 protocols at or above $5M TVL, 40 on the watchlist, snapshot 2026-11-14)
and writes to `/output`:

- `board.json` — **198 rows**: every farmable pre-token protocol in the snapshot
  (the 40 watchlist slugs plus all 158 pre-token protocols below the floor), ranked
  by implied value, each with an eight-step farm plan.
- `data.js` — the dashboard's dataset, beside the page.
- `dashboard/` — a static page (no network): a "start here" shortlist of the five
  to farm first, the value model stated on the first screen, a searchable,
  sortable board with a signal in every row, category and chain filters, a
  watchlist-only toggle, a detail view per protocol with the full model
  breakdown, its watch-outs and its farm plan, a benchmark tab listing **all 144
  priced live tokens with each one's market cap per TVL dollar**, and a model
  panel with the formula and the peer-multiples table. Every protocol in the
  snapshot is accounted for on the page: 198 ranked, 144 set aside as wrapped,
  staked, bridged or exchange products of tokens that already trade, and 416
  that already record a token (144 of them priced, the rest without a market
  price in the snapshot).
- `screenshots/` — the board, a protocol's detail view, and a filtered view.
- `dossier.json` — built with the kit's `vendor/makefun-board.ts`.

## The model (radar-3)

```
implied = round(TVL × peerMultiple(category) × growthMult × maturityMult)
```

- `peerMultiple` — the category's live-token peers' median market-cap/TVL, shrunk
  toward the whole market's median (0.169x) with a prior weight of 5, clamped to
  [0.05, 1.00]. Computed at runtime from the snapshot; no multiple is hardcoded
  and no protocol name is ever special-cased. Categories with fewer than 3 live
  peers use the market median — the detail view flags every row where that
  fallback is in play.
- `growthMult = 1 + clamp(change_7d, -60, 120)/100 × 0.5`
- `maturityMult = 0.6 + min(age_days, 1095)/1095 × 0.4` (unknown age = 365 days)

Top of the board on this snapshot: Steakhouse Financial ($367.3M), Sentora
Curator ($352.8M), Gauntlet ($218.7M). "No token" means the snapshot records no
token for the protocol — it does not prove the protocol has none. Implied value
is this radar's own estimate, not a price and not a promise of a launch.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

The program is deterministic: two runs write byte-identical output.

## License

MIT — see `LICENSE`.
