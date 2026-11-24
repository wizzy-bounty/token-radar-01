// RADAR-8 model — written for this entry. Two models are fitted on the snapshot's own figures at
// run time: a log-log value model on the protocols whose token already carries a cap, and a
// logistic launch-odds model on all 758 protocols' records. Every candidate term must survive a
// four-way held-out test (leave-one-out, walk-forward, leave-one-family-out, leave-one-chain-out)
// before it is kept, and the board's intervals are split-conformal, calibrated on held-out peers.

import { brier, conformalQuantile, fnv, fitLogistic, fitOLS, median, predictLogistic, quantile, bootstrapSE } from './stats.ts';
import { buildPlan, priceRow, DEFAULT_DROP_SHARE, DEFAULT_HORIZON_WEEKS, type Plan, type Proto, type Verdict } from './farm.ts';

export type { Proto };

export interface Snapshot { as_of: string; source: string; floor_usd: number; protocols: Proto[]; watchlist: string[] }

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) throw new Error('snapshot shape');
  return raw;
}

/** Coarse family of a category: the unit the leave-one-family-out test removes whole. */
const FAMILY_OF: Record<string, string> = {
  Dexs: 'Trading', Derivatives: 'Trading', 'Leveraged Farming': 'Trading',
  Lending: 'Credit', CDP: 'Credit',
  Yield: 'Yield', 'Yield Aggregator': 'Yield', 'Basis Trading': 'Yield', 'Risk Curators': 'Yield', 'Onchain Capital Allocator': 'Yield',
  'Liquid Staking': 'Staking', 'Liquid Restaking': 'Staking', 'Staking Pool': 'Staking', 'Restaked BTC': 'Staking',
  Bridge: 'Bridge', 'Canonical Bridge': 'Bridge',
  RWA: 'RWA', CEX: 'Exchange', 'Launchpad': 'Launchpad',
};
export const familyOf = (category: string | null): string => (category !== null && FAMILY_OF[category]) || 'Other';

const DAY = 86_400_000;
function ageYears(p: Proto, asOf: string): number {
  if (p.listed_at === null) return 2; // unreported: the priced peers' rough middle, refilled per fit below
  return Math.max(0, (Date.parse(asOf) - Date.parse(p.listed_at)) / (365.25 * DAY));
}

export interface Item {
  p: Proto;
  lnTvlC: number; // ln(TVL) centred on ln($100M)
  growth: number; // 7d change as a fraction, clipped
  age: number; // years listed
  chains: number;
  family: string;
  category: string;
  control: number; // growth of the next protocol in slug order: a term that must not help
  hasToken: number; // odds outcome: 1 when a token is recorded
  lnMcap: number | null; // value outcome for priced peers
}

function buildItems(snap: Snapshot): Item[] {
  const sorted = [...snap.protocols].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const growthOf = new Map(sorted.map((p) => [p.slug, p.change_7d === null ? 0 : Math.max(-0.9, Math.min(3, p.change_7d / 100))]));
  const ages = sorted.map((p) => ageYears(p, snap.as_of)).filter((a) => a > 0);
  const medianAge = median(ages);
  return sorted.map((p, i) => ({
    p,
    lnTvlC: Math.log(Math.max(p.tvl_usd, 1)) - Math.log(1e8),
    growth: growthOf.get(p.slug)!,
    age: p.listed_at === null ? medianAge : ageYears(p, snap.as_of),
    chains: p.chains.length,
    family: familyOf(p.category),
    category: p.category ?? '(none)',
    control: growthOf.get(sorted[(i + 1) % sorted.length]!.slug)!,
    hasToken: p.gecko_id !== null || p.symbol !== null ? 1 : 0,
    lnMcap: p.mcap_usd !== null && p.mcap_usd > 0 ? Math.log(p.mcap_usd) : null,
  }));
}

const NUMERIC: Record<string, (it: Item) => number> = {
  growth: (it) => it.growth,
  age: (it) => it.age,
  chains: (it) => it.chains,
  control: (it) => it.control,
};
export const VALUE_CANDIDATES = ['growth', 'age', 'chains', 'family', 'control'];
export const ODDS_CANDIDATES = ['age', 'lntvl', 'growth', 'family', 'chains', 'control'];

// ------------------------------------------------------------------ value model

export interface ValueFit {
  beta: number[]; // [intercept, slope, ...kept numeric terms]
  numericTerms: string[];
  catOffset: Map<string, number>;
  famOffset: Map<string, number>;
  useFamily: boolean;
}

function shrunkOffsets(resid: { key: string; r: number }[], k: number): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const { key, r } of resid) { const a = by.get(key) ?? []; a.push(r); by.set(key, a); }
  const out = new Map<string, number>();
  for (const [key, rs] of by) out.set(key, (rs.length / (rs.length + k)) * (rs.reduce((a, b) => a + b, 0) / rs.length));
  return out;
}

/** Fit the value model on priced training items: OLS on size + kept numeric terms, then shrunk category (and family) offsets. */
export function fitValue(train: Item[], terms: string[]): ValueFit {
  const numericTerms = terms.filter((t) => t !== 'family');
  const useFamily = terms.includes('family');
  const X = train.map((it) => [1, it.lnTvlC, ...numericTerms.map((t) => NUMERIC[t]!(it))]);
  const y = train.map((it) => it.lnMcap!);
  const beta = fitOLS(X, y, 1e-6);
  const resid = train.map((it, i) => ({ it, r: y[i]! - X[i]!.reduce((a, v, j) => a + v * beta[j]!, 0) }));
  const catOffset = shrunkOffsets(resid.map(({ it, r }) => ({ key: it.category, r })), 8);
  const afterCat = resid.map(({ it, r }) => ({ key: it.family, r: r - (catOffset.get(it.category) ?? 0) }));
  const famOffset = useFamily ? shrunkOffsets(afterCat, 6) : new Map<string, number>();
  return { beta, numericTerms, catOffset, famOffset, useFamily };
}

export function predictValue(fit: ValueFit, it: Item): number {
  let s = fit.beta[0]! + fit.beta[1]! * it.lnTvlC;
  fit.numericTerms.forEach((t, j) => { s += fit.beta[j + 2]! * NUMERIC[t]!(it); });
  s += fit.catOffset.get(it.category) ?? 0;
  if (fit.useFamily) s += fit.famOffset.get(it.family) ?? 0;
  return s;
}

/** The flat baseline: every peer priced at the training set's median cap/TVL multiple. */
function flatMultiple(train: Item[]): number {
  return median(train.map((it) => Math.exp(it.lnMcap!) / it.p.tvl_usd));
}

// ------------------------------------------------------------------ odds model

export interface OddsFit { beta: number[]; terms: string[]; center: Map<string, number>; scale: Map<string, number>; famRate: Map<string, number>; baseRate: number }

function oddsFeature(it: Item, term: string, famRate: Map<string, number>, baseRate: number): number {
  switch (term) {
    case 'age': return it.age;
    case 'lntvl': return it.lnTvlC;
    case 'growth': return it.growth;
    case 'chains': return it.chains;
    case 'control': return it.control;
    case 'family': return famRate.get(it.family) ?? baseRate; // the family's recorded-token rate, a peer statistic
    default: return 0;
  }
}

export function fitOdds(train: Item[], terms: string[]): OddsFit {
  const baseRate = train.reduce((a, it) => a + it.hasToken, 0) / train.length;
  const famCount = new Map<string, { n: number; k: number }>();
  for (const it of train) { const f = famCount.get(it.family) ?? { n: 0, k: 0 }; f.n++; f.k += it.hasToken; famCount.set(it.family, f); }
  const famRate = new Map<string, number>();
  for (const [fam, { n, k }] of famCount) famRate.set(fam, (k + 20 * baseRate) / (n + 20)); // shrunk toward the base rate
  const center = new Map<string, number>(); const scale = new Map<string, number>();
  for (const t of terms) {
    const xs = train.map((it) => oddsFeature(it, t, famRate, baseRate));
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length) || 1;
    center.set(t, m); scale.set(t, sd);
  }
  const X = train.map((it) => [1, ...terms.map((t) => (oddsFeature(it, t, famRate, baseRate) - center.get(t)!) / scale.get(t)!)]);
  const beta = fitLogistic(X, train.map((it) => it.hasToken), 1e-3);
  return { beta, terms, center, scale, famRate, baseRate };
}

export function predictOdds(fit: OddsFit, it: Item): number {
  const x = [1, ...fit.terms.map((t) => (oddsFeature(it, t, fit.famRate, fit.baseRate) - fit.center.get(t)!) / fit.scale.get(t)!)];
  return Math.min(0.97, Math.max(0.02, predictLogistic(fit.beta, x)));
}

// ------------------------------------------------------------------ four-way held-out tests

export interface TermTest {
  term: string;
  loo: number; wf: number; lofo: number; loco: number;
  baseLoo: number; baseWf: number; baseLofo: number; baseLoco: number;
  wins: number;
  kept: boolean;
}

type Split = { train: number[]; test: number[] };

/** The four evaluation schemes over a dataset, as train/test index splits. */
function fourWaySplits(items: Item[]): Record<'loo' | 'wf' | 'lofo' | 'loco', Split[]> {
  const n = items.length;
  const loo: Split[] = items.map((_, i) => ({ train: items.map((_, j) => j).filter((j) => j !== i), test: [i] }));
  const byListing = items.map((_, i) => i).sort((a, b) => {
    const da = items[a]!.p.listed_at ?? '9999'; const db = items[b]!.p.listed_at ?? '9999';
    return da < db ? -1 : da > db ? 1 : a - b;
  });
  const wf: Split[] = [];
  let start = Math.floor(n * 0.4);
  while (start < n) {
    const end = Math.min(n, start + 8);
    wf.push({ train: byListing.slice(0, start), test: byListing.slice(start, end) });
    start = end;
  }
  const groupSplits = (key: (it: Item) => string, minCount: number): Split[] => {
    const groups = new Map<string, number[]>();
    items.forEach((it, i) => { const g = groups.get(key(it)) ?? []; g.push(i); groups.set(key(it), g); });
    const out: Split[] = [];
    for (const [, idx] of groups) {
      if (idx.length < minCount) continue;
      const inGroup = new Set(idx);
      out.push({ train: items.map((_, j) => j).filter((j) => !inGroup.has(j)), test: idx });
    }
    return out;
  };
  return {
    loo, wf,
    lofo: groupSplits((it) => it.family, 2),
    loco: groupSplits((it) => it.p.chains[0] ?? '(none)', 4),
  };
}

const missOf = (errs: number[]): number => Math.exp(median(errs.map((e) => Math.abs(e))));

/** Run the four-way test for the value model: base vs base+term, plus the flat baseline's four misses. */
export function testValueTerms(priced: Item[]): { tests: TermTest[]; flat: { loo: number; wf: number; lofo: number; loco: number }; base: { loo: number; wf: number; lofo: number; loco: number } } {
  const splits = fourWaySplits(priced);
  const run = (terms: string[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const scheme of ['loo', 'wf', 'lofo', 'loco'] as const) {
      const errs: number[] = [];
      for (const sp of splits[scheme]) {
        const fit = fitValue(sp.train.map((i) => priced[i]!), terms);
        for (const ti of sp.test) errs.push(predictValue(fit, priced[ti]!) - priced[ti]!.lnMcap!);
      }
      out[scheme] = missOf(errs);
    }
    return out;
  };
  const runFlat = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const scheme of ['loo', 'wf', 'lofo', 'loco'] as const) {
      const errs: number[] = [];
      for (const sp of splits[scheme]) {
        const mult = flatMultiple(sp.train.map((i) => priced[i]!));
        for (const ti of sp.test) errs.push(Math.log(mult * priced[ti]!.p.tvl_usd) - priced[ti]!.lnMcap!);
      }
      out[scheme] = missOf(errs);
    }
    return out;
  };
  const base = run([]);
  const flat = runFlat();
  const tests = VALUE_CANDIDATES.map((term) => {
    const r = run([term]);
    const wins = [r.loo! < base.loo, r.wf! < base.wf, r.lofo! < base.lofo, r.loco! < base.loco].filter(Boolean).length;
    return { term, loo: r.loo!, wf: r.wf!, lofo: r.lofo!, loco: r.loco!, baseLoo: base.loo, baseWf: base.wf, baseLofo: base.lofo, baseLoco: base.loco, wins, kept: wins >= 3 && term !== 'control' };
  });
  return { tests, flat: flat as never, base: base as never };
}

/** Run the four-way test for the odds model (Brier; base = intercept only), plus base-rate Brier. */
export function testOddsTerms(all: Item[]): { tests: TermTest[]; baseRateBrier: Record<string, number>; base: Record<string, number> } {
  const splits = fourWaySplits(all);
  const run = (terms: string[], constant: number | null): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const scheme of ['loo', 'wf', 'lofo', 'loco'] as const) {
      const preds: number[] = []; const ys: number[] = [];
      for (const sp of splits[scheme]) {
        if (constant !== null) { for (const ti of sp.test) { preds.push(constant); ys.push(all[ti]!.hasToken); } continue; }
        const fit = fitOdds(sp.train.map((i) => all[i]!), terms);
        for (const ti of sp.test) { preds.push(predictOdds(fit, all[ti]!)); ys.push(all[ti]!.hasToken); }
      }
      out[scheme] = brier(preds, ys);
    }
    return out;
  };
  const baseRate = all.reduce((a, it) => a + it.hasToken, 0) / all.length;
  const base = run([], null);
  const baseRateBrier = run([], baseRate);
  const baseModel = run([], null);
  void baseModel;
  const tests = ODDS_CANDIDATES.map((term) => {
    const r = run([term], null);
    const wins = [r.loo! < base.loo, r.wf! < base.wf, r.lofo! < base.lofo, r.loco! < base.loco].filter(Boolean).length;
    return { term, loo: r.loo!, wf: r.wf!, lofo: r.lofo!, loco: r.loco!, baseLoo: base.loo, baseWf: base.wf, baseLofo: base.lofo, baseLoco: base.loco, wins, kept: wins >= 3 && term !== 'control' };
  });
  return { tests, baseRateBrier, base };
}

/** Brier / miss of the FINAL models (all kept terms together) under the four schemes. */
export function finalModelScores(priced: Item[], all: Item[], valueTerms: string[], oddsTerms: string[]): { value: Record<string, number>; odds: Record<string, number> } {
  const vs = fourWaySplits(priced);
  const value: Record<string, number> = {};
  for (const scheme of ['loo', 'wf', 'lofo', 'loco'] as const) {
    const errs: number[] = [];
    for (const sp of vs[scheme]) {
      const fit = fitValue(sp.train.map((i) => priced[i]!), valueTerms);
      for (const ti of sp.test) errs.push(predictValue(fit, priced[ti]!) - priced[ti]!.lnMcap!);
    }
    value[scheme] = missOf(errs);
  }
  const os = fourWaySplits(all);
  const odds: Record<string, number> = {};
  for (const scheme of ['loo', 'wf', 'lofo', 'loco'] as const) {
    const preds: number[] = []; const ys: number[] = [];
    for (const sp of os[scheme]) {
      const fit = fitOdds(sp.train.map((i) => all[i]!), oddsTerms);
      for (const ti of sp.test) { preds.push(predictOdds(fit, all[ti]!)); ys.push(all[ti]!.hasToken); }
    }
    odds[scheme] = brier(preds, ys);
  }
  return { value, odds };
}

// ------------------------------------------------------------------ split conformal

export interface Conformal {
  q50: number; q80: number;
  tercileBounds: [number, number];
  scale: [number, number, number];
  coverage50: number; coverage80: number;
  fitN: number; calibN: number;
}

/** Split the priced peers by slug hash: fit on ~60%, calibrate the |log error| quantiles on the rest. */
export function splitConformal(priced: Item[], valueTerms: string[]): Conformal {
  const fitSet = priced.filter((it) => fnv(it.p.slug) % 5 < 3);
  const calib = priced.filter((it) => fnv(it.p.slug) % 5 >= 3);
  const fit = fitValue(fitSet, valueTerms);
  const res = calib.map((it) => ({ it, r: Math.abs(predictValue(fit, it) - it.lnMcap!) }));
  const all = res.map((x) => x.r);
  const q50 = conformalQuantile(all, 0.5);
  const q80 = conformalQuantile(all, 0.8);
  const tvls = priced.map((it) => it.p.tvl_usd);
  const bounds: [number, number] = [quantile(tvls, 1 / 3), quantile(tvls, 2 / 3)];
  const tercileOf = (tvl: number): number => (tvl <= bounds[0] ? 0 : tvl <= bounds[1] ? 1 : 2);
  const scale = [0, 1, 2].map((t) => {
    const rs = res.filter((x) => tercileOf(x.it.p.tvl_usd) === t).map((x) => x.r);
    if (rs.length < 8 || q80 === 0) return 1;
    return Math.min(2.5, Math.max(0.4, conformalQuantile(rs, 0.8) / q80));
  }) as [number, number, number];
  const covered = (q: number): number => res.filter((x) => x.r <= q * scale[tercileOf(x.it.p.tvl_usd)]).length / res.length;
  return { q50, q80, tercileBounds: bounds, scale, coverage50: covered(q50), coverage80: covered(q80), fitN: fitSet.length, calibN: calib.length };
}

// ------------------------------------------------------------------ the board

const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Why a protocol is not ranked, in the house rule's own terms; null when it is a board candidate. */
export function exclusionReason(p: Proto): string | null {
  if (p.gecko_id !== null || p.symbol !== null) return p.mcap_usd !== null && p.mcap_usd > 0 ? 'token trades' : 'token recorded, no cap';
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `out by rule — ${p.category.toLowerCase()} category`;
  if (/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(p.name)) return 'out by rule — versioned name';
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return 'out by rule — wrapped or staked name';
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return 'out by rule — exchange-branded name';
  return null;
}

export interface Row {
  slug: string; name: string; rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null; chains: string[]; tvl_usd: number; change_7d: number | null;
  age_days: number; watchlist: boolean; off_list: boolean;
  odds: number; value_if_usd: number; lo80: number; hi80: number;
  verdict: string; viable_capital_usd: number | null; net_at_viable: number; net_per_hour: number;
  breakeven_drop_share: number; fees_usd: number; hours: number;
  base_multiple: number; size_factor: number; category_factor: number; term_factor: number;
  plan: Plan; verdictDetail: Verdict;
}

export interface Radar {
  meta: Record<string, unknown>;
  kpi: Record<string, number>;
  valueTests: TermTest[]; oddsTests: TermTest[];
  valueFinal: Record<string, number>; oddsFinal: Record<string, number>;
  flat: Record<string, number>; valueBase: Record<string, number>;
  oddsBaseRate: Record<string, number>; oddsBase: Record<string, number>;
  conformal: Conformal;
  valueCoefs: { name: string; coef: number; se: number }[];
  oddsCoefs: { name: string; coef: number; se: number }[];
  ledger: { label: string; n: number }[];
  verdictCounts: Record<string, number>;
  rows: Row[];
  details: Record<string, unknown>[];
  integrity: { rows: number; totalImplied: number; watchlistCovered: number; ledgerTotal: number; mainChecksum: string };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

export function buildRadar(snap: Snapshot, mainChecksum: string): { board: Row[]; radar: Radar } {
  const items = buildItems(snap);
  const bySlug = new Map(items.map((it) => [it.p.slug, it]));
  const priced = items.filter((it) => it.lnMcap !== null);
  const watch = new Set(snap.watchlist);

  const vTest = testValueTerms(priced);
  const oTest = testOddsTerms(items);
  const valueTerms = vTest.tests.filter((t) => t.kept).map((t) => t.terms ?? t.term);
  const oddsTerms = oTest.tests.filter((t) => t.kept).map((t) => t.term);
  const finals = finalModelScores(priced, items, valueTerms, oddsTerms);
  const conformal = splitConformal(priced, valueTerms);

  const valueFit = fitValue(priced, valueTerms);
  const oddsFit = fitOdds(items, oddsTerms);

  // Bootstrap standard errors (200 seeded refits) for the printed coefficients.
  const vBoot = bootstrapSE(priced.length, 200, 8001, (idx) => {
    try { return fitValue(idx.map((i) => priced[i]!), valueTerms).beta; } catch { return null; }
  });
  const oBoot = bootstrapSE(items.length, 200, 8002, (idx) => {
    try { return fitOdds(idx.map((i) => items[i]!), oddsTerms).beta; } catch { return null; }
  });
  const valueCoefs = [
    { name: 'intercept — ln(value) at $100M TVL', coef: round4(valueFit.beta[0]!), se: round4(vBoot.se[0] ?? NaN) },
    { name: 'size slope (ln TVL)', coef: round4(valueFit.beta[1]!), se: round4(vBoot.se[1] ?? NaN) },
    ...valueFit.numericTerms.map((t, j) => ({ name: `${t} term`, coef: round4(valueFit.beta[j + 2]!), se: round4(vBoot.se[j + 2] ?? NaN) })),
  ];
  const oddsCoefs = [
    { name: 'intercept (logit)', coef: round4(oddsFit.beta[0]!), se: round4(oBoot.se[0] ?? NaN) },
    ...oddsTerms.map((t, j) => ({ name: `${t} term (standardised)`, coef: round4(oddsFit.beta[j + 1]!), se: round4(oBoot.se[j + 1] ?? NaN) })),
  ];

  // Ledger: every one of the 758 protocols accounted for exactly once.
  const ledgerMap = new Map<string, number>();
  const candidates: Item[] = [];
  for (const it of items) {
    const reason = exclusionReason(it.p);
    if (reason === null) { candidates.push(it); ledgerMap.set('ranked on this board', (ledgerMap.get('ranked on this board') ?? 0) + 1); }
    else ledgerMap.set(reason, (ledgerMap.get(reason) ?? 0) + 1);
  }
  const ledgerOrder = ['ranked on this board', 'token trades', 'token recorded, no cap'];
  const ledger = [...ledgerMap.entries()]
    .sort((a, b) => (ledgerOrder.indexOf(a[0]) === -1 ? 9 : ledgerOrder.indexOf(a[0])) - (ledgerOrder.indexOf(b[0]) === -1 ? 9 : ledgerOrder.indexOf(b[0])) || b[1] - a[1])
    .map(([label, n]) => ({ label, n }));

  const tercileOf = (tvl: number): number => (tvl <= conformal.tercileBounds[0] ? 0 : tvl <= conformal.tercileBounds[1] ? 1 : 2);
  const rows: Row[] = [];
  for (const it of candidates) {
    const p = it.p;
    const lnValue = predictValue(valueFit, it);
    const valueIf = Math.exp(lnValue);
    const odds = predictOdds(oddsFit, it);
    const implied = Math.max(1, Math.round(valueIf * odds));
    const scale = conformal.scale[tercileOf(p.tvl_usd)];
    const plan0 = buildPlan(p, null);
    const vd = priceRow(implied, p.tvl_usd, DEFAULT_DROP_SHARE, DEFAULT_HORIZON_WEEKS, plan0.feesUsd, plan0.hours, Math.min(1_000_000, 0.05 * p.tvl_usd));
    const plan = buildPlan(p, vd.viableCapital);
    const baseMultiple = Math.exp(valueFit.beta[0]!) / 1e8; // cap/TVL multiple at exactly $100M TVL
    const sizeFactor = Math.exp(valueFit.beta[1]! * it.lnTvlC);
    const catFactor = Math.exp(valueFit.catOffset.get(it.category) ?? 0);
    let termLog = 0;
    valueFit.numericTerms.forEach((t, j) => { termLog += valueFit.beta[j + 2]! * NUMERIC[t]!(it); });
    if (valueFit.useFamily) termLog += valueFit.famOffset.get(it.family) ?? 0;
    rows.push({
      slug: p.slug, name: p.name, rank: 0,
      implied_value_usd: implied,
      farm_steps: plan.steps.map((s) => s.text),
      category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d,
      age_days: Math.round(it.age * 365.25), watchlist: watch.has(p.slug), off_list: !watch.has(p.slug) && p.tvl_usd >= snap.floor_usd,
      odds: round4(odds), value_if_usd: Math.round(valueIf),
      lo80: Math.max(1, Math.round(implied * Math.exp(-conformal.q80 * scale))),
      hi80: Math.round(implied * Math.exp(conformal.q80 * scale)),
      verdict: vd.verdict, viable_capital_usd: vd.viableCapital, net_at_viable: vd.netAtViable, net_per_hour: vd.netPerHour,
      breakeven_drop_share: vd.breakevenDropShare, fees_usd: plan.feesUsd, hours: plan.hours,
      base_multiple: round4(baseMultiple), size_factor: round4(sizeFactor), category_factor: round4(catFactor), term_factor: round4(Math.exp(termLog)),
      plan, verdictDetail: vd,
    });
  }
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => { r.rank = i + 1; });

  const verdictCounts: Record<string, number> = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  for (const r of rows) verdictCounts[r.verdict]!++;
  const totalImplied = rows.reduce((a, r) => a + r.implied_value_usd, 0);

  // Two featured detail pages: the best FARM by net/hour, and the best watchlist row.
  const farmRows = rows.filter((r) => r.verdict === 'FARM').sort((a, b) => b.net_per_hour - a.net_per_hour);
  const pickFarm = farmRows[0] ?? [...rows].sort((a, b) => b.net_per_hour - a.net_per_hour)[0]!;
  const watchRows = rows.filter((r) => r.watchlist).sort((a, b) => b.net_per_hour - a.net_per_hour || b.implied_value_usd - a.implied_value_usd);
  const pickWatch = watchRows[0]!.slug === pickFarm.slug ? watchRows[1]! : watchRows[0]!;
  const details = [pickFarm, pickWatch].map((r) => buildDetail(r, priced, bySlug, valueFit, oddsFit));

  const radar: Radar = {
    meta: {
      title: 'RADAR-8 — BREAK-EVEN FIRST',
      asOf: snap.as_of, source: snap.source, floorUsd: snap.floor_usd,
      protocols: snap.protocols.length, watchlist: snap.watchlist.length, pricedPeers: priced.length,
      dropShare: DEFAULT_DROP_SHARE, horizonWeeks: DEFAULT_HORIZON_WEEKS,
      note: 'Every number on this page is computed from the sealed snapshot at run time. A protocol is said to record no token, never to have none. Deposits are sized at most 5% of a protocol TVL and at most $1,000,000 — a larger single position is a takeover, not a farm.',
    },
    kpi: {
      missWf: round4(finals.value.wf!), missLoo: round4(finals.value.loo!), missLofo: round4(finals.value.lofo!), missLoco: round4(finals.value.loco!),
      flatWf: round4(vTest.flat.wf), flatLoo: round4(vTest.flat.loo),
      coverage50: round4(conformal.coverage50), coverage80: round4(conformal.coverage80),
      brier: round4(finals.odds.loo!), brierBase: round4(oTest.baseRateBrier.loo),
      farm: verdictCounts.FARM!, ranked: rows.length,
    },
    valueTests: vTest.tests, oddsTests: oTest.tests,
    valueFinal: finals.value, oddsFinal: finals.odds,
    flat: vTest.flat, valueBase: vTest.base,
    oddsBaseRate: oTest.baseRateBrier, oddsBase: oTest.base,
    conformal, valueCoefs, oddsCoefs, ledger, verdictCounts, rows, details,
    integrity: { rows: rows.length, totalImplied, watchlistCovered: rows.filter((r) => r.watchlist).length, ledgerTotal: ledger.reduce((a, s) => a + s.n, 0), mainChecksum },
  };
  return { board: rows, radar };
}

function buildDetail(r: Row, priced: Item[], bySlug: Map<string, Item>, valueFit: ValueFit, oddsFit: OddsFit): Record<string, unknown> {
  const it = bySlug.get(r.slug)!;
  const peers = priced
    .filter((x) => x.p.slug !== r.slug)
    .sort((a, b) => Math.abs(Math.log(a.p.tvl_usd / r.tvl_usd)) + (a.category === it.category ? 0 : 0.35) - (Math.abs(Math.log(b.p.tvl_usd / r.tvl_usd)) + (b.category === it.category ? 0 : 0.35)))
    .slice(0, 5)
    .map((x) => ({ name: x.p.name, category: x.p.category, tvl: x.p.tvl_usd, mcap: x.p.mcap_usd, multiple: round4(x.p.mcap_usd! / x.p.tvl_usd) }));
  const deposits = [1000, 5000, 10000, 25000, 50000, 100000];
  const shares = [0.02, 0.04, 0.06, 0.1];
  const matrix = shares.map((ds) => deposits.map((D) => Math.round(r.implied_value_usd * ds * (D / (r.tvl_usd + D)) - r.fees_usd - r.hours * 25)));
  // Odds break-even at the row's viable capital: the odds at which net just clears the T-bill line.
  const D = r.viable_capital_usd ?? 10000;
  const needed = ((r.fees_usd + r.hours * 25 + 0.04 * (DEFAULT_HORIZON_WEEKS / 52) * D) * (r.tvl_usd + D)) / (DEFAULT_DROP_SHARE * D);
  const oddsBreakeven = round4(Math.min(9.99, needed / Math.max(r.value_if_usd, 1)));
  return {
    slug: r.slug, name: r.name, kind: r.watchlist ? 'watchlist pick' : 'best farm pick',
    breakdown: [
      { label: 'Base value at $100M TVL (multiple x TVL)', value: `$${Math.round(1e8 * r.base_multiple).toLocaleString('en-US')}` },
      { label: 'Size curve factor', value: `x${r.size_factor}` },
      { label: 'Category factor (shrunk)', value: `x${r.category_factor}` },
      { label: 'Kept-term factor', value: `x${r.term_factor}` },
      { label: 'Value if it launches', value: `$${r.value_if_usd.toLocaleString('en-US')}` },
      { label: 'Launch odds (peer record)', value: `${Math.round(r.odds * 100)}%` },
      { label: 'Implied value (value x odds)', value: `$${r.implied_value_usd.toLocaleString('en-US')}` },
    ],
    peers, matrix, deposits, shares,
    breakevens: { dropShareAt10k: r.breakeven_drop_share, oddsBreakeven, viableCapital: r.viable_capital_usd },
    exitRule: `Unwind if TVL falls under $${Math.round(r.tvl_usd * 0.7).toLocaleString('en-US')} (30% below entry), if a token is announced on terms below the break-even drop share of ${Math.round(r.breakeven_drop_share * 1000) / 10}% at $10,000, or at the end of the ${DEFAULT_HORIZON_WEEKS}-week horizon — whichever comes first.`,
    steps: r.plan.steps,
  };
  void valueFit; void oddsFit;
}

/** The gate's board checks, restated: returns a refusal string, or null when the board is valid. */
export function boardIssue(board: Row[], snap: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows`;
  const slugs = new Set(snap.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (!slugs.has(r.slug)) return `invented slug ${r.slug}`;
    if (seen.has(r.slug)) return `duplicate slug ${r.slug}`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `rank ${r.rank} at position ${i + 1}`;
    if (i > 0 && board[i - 1]!.implied_value_usd < r.implied_value_usd) return 'implied rises with rank';
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return 'implied not a positive whole number';
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `farm_steps count on ${r.slug}`;
    for (const s of r.farm_steps) { const t = s.trim(); if (t.length < 20 || t.length > 600) return `farm step length on ${r.slug}: ${t.length}`; }
  }
  for (const slug of snap.watchlist) if (!seen.has(slug)) return `watchlist slug missing: ${slug}`;
  if (new Set(board.map((r) => r.implied_value_usd)).size < 2) return 'all implied values equal';
  return null;
}

/** The dashboard's data file: one window.RADAR assignment the static page renders from. */
export function dataScript(radar: Radar): string {
  const slim = {
    ...radar,
    rows: radar.rows.map((r) => ({
      slug: r.slug, name: r.name, rank: r.rank, implied: r.implied_value_usd, category: r.category, chains: r.chains,
      tvl: r.tvl_usd, chg: r.change_7d, age: r.age_days, wl: r.watchlist, off: r.off_list, odds: r.odds,
      vif: r.value_if_usd, lo: r.lo80, hi: r.hi80, verdict: r.verdict, viable: r.viable_capital_usd,
      net: r.net_at_viable, nph: r.net_per_hour, be: r.breakeven_drop_share, fees: r.fees_usd, hours: r.hours,
      bm: r.base_multiple, sf: r.size_factor, cf: r.category_factor, tf: r.term_factor, steps: r.farm_steps,
    })),
  };
  return `window.RADAR = ${JSON.stringify(slim)};\n`;
}
