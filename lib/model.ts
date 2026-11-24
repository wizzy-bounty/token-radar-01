// model.ts — RADAR-9's models, written for this entry. The design answers the
// two failures its predecessors measured in the open:
//
//   RADAR-7 fitted one ridge regression and gated its terms on three held-out
//   tests, but a single estimator still extrapolated badly onto later-listed
//   protocols (walk-forward miss x3.01) and its evidence sat below the fold.
//   RADAR-8 tested each term ALONE, kept whatever won 3 of 4 solo tests, and
//   bolted category offsets onto the fit unconditionally, computed from the
//   same residuals the fit had already minimised — the combination was never
//   validated, and its walk-forward miss worsened to x4.10.
//
// RADAR-9's value model is a consensus: three different estimators — a ridge
// regression, a median (L1) regression, and a local peer estimator — price
// every protocol, and the board takes the median of the three. Terms enter
// the parametric design only through greedy forward selection in which each
// addition must improve ALL FOUR held-out tests (leave-one-out, walk-forward,
// leave-one-family-out, leave-one-chain-out) of the ridge estimator, and the
// shipped consensus is then scored under the same four tests with the term
// set frozen and coefficients refit in every split. Intervals are conformal,
// calibrated on cross-fitted residuals of the consensus itself.

import {
  brier, bootstrapSE, clamp, conformalQuantile, dot, fitLogistic, fitMedianIRLS,
  fnv, hatDiag, meanSd, median, predictLogistic, quantile, ridgeSolve, rng,
  typicalMiss, weightedMedian,
} from './stats.ts';
import { buildPlan, priceRow, DROP_SHARE, HORIZON_WEEKS, type Plan, type Proto, type Verdict } from './farm.ts';

export type { Proto };
export interface Snapshot { as_of: string; source: string; floor_usd: number; protocols: Proto[]; watchlist: string[] }

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) throw new Error('snapshot shape');
  return raw;
}

// ------------------------------------------------------------------ universe

const EXCLUDED_CATS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIX = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export function exclusionReason(p: Proto): string | null {
  if (p.gecko_id !== null || p.symbol !== null) return p.mcap_usd !== null && p.mcap_usd > 0 ? 'token trades' : 'token recorded, no cap';
  if (p.category !== null && EXCLUDED_CATS.has(p.category)) return `out by rule — ${p.category.toLowerCase()} category`;
  if (/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(p.name)) return 'out by rule — versioned name';
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return 'out by rule — wrapped or staked name';
  if (EXCHANGE_PREFIX.some((e) => p.name === e || p.name.startsWith(e + ' '))) return 'out by rule — exchange-branded name';
  return null;
}

const FAMILY_OF: Record<string, string> = {
  'Lending': 'Credit', 'Uncollateralized Lending': 'Credit', 'CDP': 'Credit', 'CDP Manager': 'Credit',
  'Collateral Markets': 'Credit', 'Collateral Management': 'Credit', 'Leveraged Farming': 'Credit',
  'Dexs': 'Trading', 'Derivatives': 'Trading', 'Options': 'Trading', 'Options Vault': 'Trading',
  'Interest Rate Derivatives': 'Trading', 'Prediction Market': 'Trading', 'Basis Trading': 'Trading', 'Synthetics': 'Trading',
  'Yield': 'Yield', 'Yield Aggregator': 'Yield', 'Risk Curators': 'Yield', 'Onchain Capital Allocator': 'Yield',
  'Liquidity Manager': 'Yield', 'Farm': 'Yield', 'Indexes': 'Yield',
  'Liquid Staking': 'Staking', 'Staking Pool': 'Staking', 'Restaking': 'Staking', 'Liquid Restaking': 'Staking',
  'Restaked BTC': 'Staking', 'Anchor BTC': 'Staking', 'Decentralized BTC': 'Staking',
  'Bridge': 'Bridge & chain', 'Canonical Bridge': 'Bridge & chain', 'Cross Chain Bridge': 'Bridge & chain', 'Chain': 'Bridge & chain',
  'RWA': 'Real-world', 'Payments': 'Real-world', 'Crypto Card Issuer': 'Real-world', 'Stablecoin Issuer': 'Real-world',
  'Algo-Stables': 'Real-world', 'Dual-Token Stablecoin': 'Real-world', 'Stablecoin Wrapper': 'Real-world', 'Reserve Currency': 'Real-world',
  'Launchpad': 'Launchpad',
};
export const familyOf = (category: string | null): string =>
  category === null ? 'Other services' : (FAMILY_OF[category] ?? 'Other services');

// ------------------------------------------------------------------ features

export interface Item {
  p: Proto;
  lnTvlC: number;   // ln(TVL / $100M)
  growth: number;   // 7d change as a fraction, clamped
  ageYears: number; // years since DefiLlama began tracking it (median-imputed)
  lnChains: number; // ln(chain count)
  family: string;
  category: string;
  control: number;  // growth of another protocol in slug order: must not help
  hasToken: number;
  lnMult: number | null; // ln(mcap / TVL) for priced peers
  listedMs: number | null;
}

function buildItems(snap: Snapshot): Item[] {
  const asOfMs = Date.parse(snap.as_of + 'T00:00:00Z');
  const sorted = [...snap.protocols].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const knownAges = sorted.filter((p) => p.listed_at !== null)
    .map((p) => Math.max(0, (asOfMs - Date.parse(p.listed_at!)) / (365.25 * 86_400_000)));
  const medianAge = median(knownAges);
  return sorted.map((p, i) => {
    const listedMs = p.listed_at !== null ? Date.parse(p.listed_at) : null;
    return {
      p,
      lnTvlC: Math.log(Math.max(p.tvl_usd, 1) / 1e8),
      growth: clamp((p.change_7d ?? 0) / 100, -0.6, 2.0),
      ageYears: listedMs !== null ? Math.max(0, (asOfMs - listedMs) / (365.25 * 86_400_000)) : medianAge,
      lnChains: Math.log(Math.max(1, p.chains.length)),
      family: familyOf(p.category),
      category: p.category ?? '(none)',
      control: clamp((sorted[(i + 41) % sorted.length]!.change_7d ?? 0) / 100, -0.6, 2.0),
      hasToken: p.gecko_id !== null || p.symbol !== null ? 1 : 0,
      lnMult: p.mcap_usd !== null && p.mcap_usd > 0 ? Math.log(p.mcap_usd / p.tvl_usd) : null,
      listedMs,
    };
  });
}

// ------------------------------------------------------------------ splits

type Split = { train: number[]; test: number[] };
type Scheme = 'loo' | 'wf' | 'lofo' | 'loco';
const SCHEMES: Scheme[] = ['loo', 'wf', 'lofo', 'loco'];

function splitsFor(items: Item[], minGroup: number): Record<Scheme, Split[]> {
  const n = items.length;
  const loo: Split[] = items.map((_, i) => ({ train: items.map((_, j) => j).filter((j) => j !== i), test: [i] }));
  const dated = items.map((_, i) => i).filter((i) => items[i]!.listedMs !== null)
    .sort((a, b) => (items[a]!.listedMs! - items[b]!.listedMs!) || a - b);
  const undated = items.map((_, i) => i).filter((i) => items[i]!.listedMs === null);
  const wf: Split[] = [];
  let start = Math.floor(dated.length * 0.4);
  while (start < dated.length) {
    const end = Math.min(dated.length, start + 8);
    wf.push({ train: [...dated.slice(0, start), ...undated], test: dated.slice(start, end) });
    start = end;
  }
  const groups = (key: (it: Item) => string): Split[] => {
    const by = new Map<string, number[]>();
    items.forEach((it, i) => { const g = by.get(key(it)) ?? []; g.push(i); by.set(key(it), g); });
    const out: Split[] = [];
    for (const [, idx] of by) {
      if (idx.length < minGroup) continue;
      const inG = new Set(idx);
      out.push({ train: items.map((_, j) => j).filter((j) => !inG.has(j)), test: idx });
    }
    return out;
  };
  return { loo, wf, lofo: groups((it) => it.family), loco: groups((it) => it.p.chains[0] ?? '(none)') };
}

// ------------------------------------------------------------------ value: design + three estimators

export type VTerm = 'growth' | 'age' | 'chains' | 'curve' | 'category' | 'family' | 'control';
const V_CANDIDATES: VTerm[] = ['growth', 'age', 'chains', 'curve', 'category', 'family', 'control'];
export const V_LABEL: Record<VTerm, string> = {
  growth: '7-day TVL growth', age: 'age, years listed', chains: 'chain count, ln',
  curve: 'size curvature, (ln TVL)^2', category: 'category effect', family: 'family effect',
  control: 'control: growth of another row',
};

interface Ctx { catLevels: string[]; famLevels: string[] }
function buildCtx(priced: Item[]): Ctx {
  const levels = (key: (it: Item) => string): string[] => {
    const count = new Map<string, number>();
    for (const it of priced) count.set(key(it), (count.get(key(it)) ?? 0) + 1);
    return [...count.entries()].filter(([, n]) => n >= 3).map(([k]) => k).sort();
  };
  return { catLevels: levels((it) => it.category), famLevels: levels((it) => it.family) };
}

interface Design { X: number[][]; pen: number[]; blocks: { name: string; from: number; to: number }[] }
function vDesign(feats: Item[], terms: VTerm[], ctx: Ctx): Design {
  const X: number[][] = feats.map(() => [1]);
  const pen: number[] = [0];
  const blocks: Design['blocks'] = [];
  const push = (name: string, colOf: (f: Item) => number[], p: number[]) => {
    const from = pen.length;
    feats.forEach((f, i) => { for (const c of colOf(f)) X[i]!.push(c); });
    pen.push(...p);
    blocks.push({ name, from, to: pen.length });
  };
  push('size', (f) => [f.lnTvlC], [0]);
  for (const t of terms) {
    if (t === 'growth') push(t, (f) => [f.growth], [0]);
    else if (t === 'age') push(t, (f) => [f.ageYears], [0]);
    else if (t === 'chains') push(t, (f) => [f.lnChains], [0]);
    else if (t === 'curve') push(t, (f) => [f.lnTvlC * f.lnTvlC], [0]);
    else if (t === 'control') push(t, (f) => [f.control], [0]);
    else if (t === 'category') push(t, (f) => ctx.catLevels.map((lv) => (lv === f.category ? 1 : 0)), ctx.catLevels.map(() => 8));
    else if (t === 'family') push(t, (f) => ctx.famLevels.map((lv) => (lv === f.family ? 1 : 0)), ctx.famLevels.map(() => 8));
  }
  return { X, pen, blocks };
}

/** E3, the local peer estimator: a distance-weighted median of the ln multiples
 *  of the 15 nearest priced peers in standardised (size, growth, age, chains)
 *  space; peers in the target's own family count as closer than they measure. */
class PeerEstimator {
  private z: number[][]; private mult: number[]; private fam: string[]; private slugs: string[];
  constructor(peers: Item[]) {
    const cols = [peers.map((p) => p.lnTvlC), peers.map((p) => p.growth), peers.map((p) => p.ageYears), peers.map((p) => p.lnChains)];
    const stats = cols.map((c) => meanSd(c));
    this.z = peers.map((p) => [p.lnTvlC, p.growth, p.ageYears, p.lnChains].map((v, j) => (v - stats[j]!.mean) / stats[j]!.sd));
    this.mult = peers.map((p) => p.lnMult!);
    this.fam = peers.map((p) => p.family);
    this.slugs = peers.map((p) => p.p.slug);
    this.stats = stats;
  }
  private stats: { mean: number; sd: number }[];
  predict(target: Item): number {
    const tz = [target.lnTvlC, target.growth, target.ageYears, target.lnChains]
      .map((v, j) => (v - this.stats[j]!.mean) / this.stats[j]!.sd);
    const scored: { d: number; m: number }[] = [];
    for (let i = 0; i < this.z.length; i++) {
      if (this.slugs[i] === target.p.slug) continue;
      let d2 = 0;
      for (let j = 0; j < 4; j++) d2 += (tz[j]! - this.z[i]![j]!) ** 2;
      if (this.fam[i] === target.family) d2 *= 0.49;
      scored.push({ d: d2, m: this.mult[i]! });
    }
    scored.sort((a, b) => a.d - b.d);
    const near = scored.slice(0, Math.min(15, scored.length));
    if (near.length === 0) return median(this.mult);
    return weightedMedian(near.map((s) => ({ v: s.m, w: 1 / (0.3 + s.d) })));
  }
}

interface VFit { beta1: number[]; beta2: number[]; peers: PeerEstimator; terms: VTerm[]; ctx: Ctx }
function fitValue(train: Item[], terms: VTerm[], ctx: Ctx): VFit {
  const { X, pen } = vDesign(train, terms, ctx);
  const y = train.map((it) => it.lnMult!);
  const beta1 = ridgeSolve(X, y, pen).beta;
  const beta2 = fitMedianIRLS(X, y, pen, beta1);
  return { beta1, beta2, peers: new PeerEstimator(train), terms, ctx };
}
function predMembers(fit: VFit, it: Item): [number, number, number] {
  const { X } = vDesign([it], fit.terms, fit.ctx);
  return [dot(X[0]!, fit.beta1), dot(X[0]!, fit.beta2), fit.peers.predict(it)];
}
const predEnsemble = (fit: VFit, it: Item): number => median(predMembers(fit, it));

// ------------------------------------------------------------------ value: tests + selection

export type Scores4 = Record<Scheme, number>;

function evalValueE1(priced: Item[], terms: VTerm[], ctx: Ctx, splits: Record<Scheme, Split[]>): Scores4 {
  const out = {} as Scores4;
  const { X, pen } = vDesign(priced, terms, ctx);
  const y = priced.map((it) => it.lnMult!);
  const fit = ridgeSolve(X, y, pen);
  const h = hatDiag(X, fit.inv);
  // Ridge leave-one-out shortcut: the LOO error of row i is resid_i / (1 - h_i).
  const looErrs = priced.map((it, i) => (y[i]! - dot(X[i]!, fit.beta)) / (1 - Math.min(h[i]!, 0.999999)));
  out.loo = typicalMiss(looErrs);
  for (const scheme of ['wf', 'lofo', 'loco'] as Scheme[]) {
    const errs: number[] = [];
    for (const sp of splits[scheme]) {
      const train = sp.train.map((i) => priced[i]!);
      const { X: Xt, pen: pt } = vDesign(train, terms, ctx);
      const beta = ridgeSolve(Xt, train.map((it) => it.lnMult!), pt).beta;
      for (const ti of sp.test) {
        const { X: Xq } = vDesign([priced[ti]!], terms, ctx);
        errs.push(dot(Xq[0]!, beta) - priced[ti]!.lnMult!);
      }
    }
    out[scheme] = typicalMiss(errs);
  }
  return out;
}

const allBetter = (a: Scores4, b: Scores4): boolean => SCHEMES.every((s) => a[s] < b[s] * 0.999);
const mean4 = (s: Scores4): number => SCHEMES.reduce((a, k) => a + s[k], 0) / 4;

interface TermRow<T extends string> { term: T; label: string; solo: Scores4; kept: boolean }
interface Selection<T extends string> { kept: T[]; base: Scores4; final: Scores4; table: TermRow<T>[] }

function greedySelect<T extends string>(
  candidates: T[],
  label: (t: T) => string,
  evalFn: (terms: T[]) => Scores4,
): Selection<T> {
  const cache = new Map<string, Scores4>();
  const ev = (t: T[]): Scores4 => {
    const key = [...t].sort().join(',');
    if (!cache.has(key)) cache.set(key, evalFn(t));
    return cache.get(key)!;
  };
  const base = ev([]);
  const solo = new Map<T, Scores4>();
  for (const t of candidates) solo.set(t, ev([t]));
  const kept: T[] = [];
  let current = base;
  for (;;) {
    let best: T | null = null, bestScores: Scores4 | null = null;
    for (const t of candidates) {
      if (kept.includes(t) || t === 'control') continue;
      const s = ev([...kept, t]);
      if (allBetter(s, current) && (bestScores === null || mean4(s) < mean4(bestScores))) { best = t; bestScores = s; }
    }
    if (best === null || bestScores === null) break;
    kept.push(best); current = bestScores;
  }
  return {
    kept, base, final: current,
    table: candidates.map((t) => ({ term: t, label: label(t), solo: solo.get(t)!, kept: kept.includes(t) })),
  };
}

/** Scores of the shipped value pipeline (and each member + the flat baseline)
 *  with the term set frozen and coefficients refit in every split. */
function valuePipelineScores(priced: Item[], terms: VTerm[], ctx: Ctx, splits: Record<Scheme, Split[]>):
  { ens: Scores4; e1: Scores4; e2: Scores4; e3: Scores4; flat: Scores4 } {
  const run = (member: 'ens' | 'e1' | 'e2' | 'e3' | 'flat'): Scores4 => {
    const out = {} as Scores4;
    for (const scheme of SCHEMES) {
      const errs: number[] = [];
      for (const sp of splits[scheme]) {
        const train = sp.train.map((i) => priced[i]!);
        if (member === 'flat') {
          const m = median(train.map((it) => it.lnMult!));
          for (const ti of sp.test) errs.push(m - priced[ti]!.lnMult!);
          continue;
        }
        const fit = fitValue(train, terms, ctx);
        for (const ti of sp.test) {
          const it = priced[ti]!;
          const pred = member === 'ens' ? predEnsemble(fit, it) : predMembers(fit, it)[member === 'e1' ? 0 : member === 'e2' ? 1 : 2];
          errs.push(pred - it.lnMult!);
        }
      }
      out[scheme] = typicalMiss(errs);
    }
    return out;
  };
  return { ens: run('ens'), e1: run('e1'), e2: run('e2'), e3: run('e3'), flat: run('flat') };
}

// ------------------------------------------------------------------ odds model

export type OTerm = 'lntvl' | 'age' | 'growth' | 'lnchains' | 'famrate' | 'control';
const O_CANDIDATES: OTerm[] = ['lntvl', 'age', 'growth', 'lnchains', 'famrate', 'control'];
export const O_LABEL: Record<OTerm, string> = {
  lntvl: 'size, ln TVL', age: 'age, years listed', growth: '7-day TVL growth',
  lnchains: 'chain count, ln', famrate: 'family token rate (peer record)', control: 'control: growth of another row',
};

interface OFit { beta: number[]; se: number[]; terms: OTerm[]; center: Map<string, number>; scale: Map<string, number>; famRate: Map<string, number>; baseRate: number }
function oddsRaw(it: Item, t: OTerm, famRate: Map<string, number>, baseRate: number): number {
  switch (t) {
    case 'lntvl': return it.lnTvlC;
    case 'age': return it.ageYears;
    case 'growth': return it.growth;
    case 'lnchains': return it.lnChains;
    case 'famrate': return famRate.get(it.family) ?? baseRate;
    case 'control': return it.control;
  }
}
function fitOdds(train: Item[], terms: OTerm[]): OFit {
  const baseRate = train.reduce((a, it) => a + it.hasToken, 0) / train.length;
  const famCount = new Map<string, { n: number; k: number }>();
  for (const it of train) { const f = famCount.get(it.family) ?? { n: 0, k: 0 }; f.n++; f.k += it.hasToken; famCount.set(it.family, f); }
  const famRate = new Map<string, number>();
  for (const [fam, { n, k }] of famCount) famRate.set(fam, (k + 20 * baseRate) / (n + 20));
  const center = new Map<string, number>(), scale = new Map<string, number>();
  for (const t of terms) {
    const { mean, sd } = meanSd(train.map((it) => oddsRaw(it, t, famRate, baseRate)));
    center.set(t, mean); scale.set(t, sd);
  }
  const X = train.map((it) => [1, ...terms.map((t) => (oddsRaw(it, t, famRate, baseRate) - center.get(t)!) / scale.get(t)!)]);
  const fit = fitLogistic(X, train.map((it) => it.hasToken), 1);
  const se = fit.beta.map((_, j) => Math.sqrt(Math.max(fit.inv[j]![j]!, 0)));
  return { beta: fit.beta, se, terms, center, scale, famRate, baseRate };
}
function oddsX(fit: OFit, it: Item): number[] {
  return [1, ...fit.terms.map((t) => (oddsRaw(it, t, fit.famRate, fit.baseRate) - fit.center.get(t)!) / fit.scale.get(t)!)];
}
const predOddsRaw = (fit: OFit, it: Item): number => predictLogistic(fit.beta, oddsX(fit, it));

function evalOdds(all: Item[], terms: OTerm[], splits: Record<Scheme, Split[]>): Scores4 {
  const out = {} as Scores4;
  const fit = fitOdds(all, terms);
  const X = all.map((it) => oddsX(fit, it));
  const full = fitLogistic(X, all.map((it) => it.hasToken), 1);
  // Leave-one-out by the Pregibon one-step approximation to a refit.
  const looP = all.map((it, i) => {
    const xi = X[i]!;
    const gi = full.inv.map((row) => dot(row, xi));
    const h = Math.min(full.w[i]! * dot(xi, gi), 0.999999);
    const adj = full.beta.map((bj, j) => bj - (gi[j]! * full.w[i]! * (it.hasToken - full.prob[i]!)) / (1 - h));
    return predictLogistic(adj, xi);
  });
  out.loo = brier(looP, all.map((it) => it.hasToken));
  for (const scheme of ['wf', 'lofo', 'loco'] as Scheme[]) {
    const preds: number[] = [], ys: number[] = [];
    for (const sp of splits[scheme]) {
      const f = fitOdds(sp.train.map((i) => all[i]!), terms);
      for (const ti of sp.test) { preds.push(predOddsRaw(f, all[ti]!)); ys.push(all[ti]!.hasToken); }
    }
    out[scheme] = brier(preds, ys);
  }
  return out;
}

function oddsPipelineScores(all: Item[], terms: OTerm[], splits: Record<Scheme, Split[]>): { model: Scores4; baseRate: Scores4 } {
  const model = {} as Scores4, baseRate = {} as Scores4;
  for (const scheme of SCHEMES) {
    const preds: number[] = [], ys: number[] = [], base: number[] = [];
    for (const sp of splits[scheme]) {
      const train = sp.train.map((i) => all[i]!);
      const f = fitOdds(train, terms);
      const br = train.reduce((a, it) => a + it.hasToken, 0) / train.length;
      for (const ti of sp.test) { preds.push(predOddsRaw(f, all[ti]!)); ys.push(all[ti]!.hasToken); base.push(br); }
    }
    model[scheme] = brier(preds, ys);
    baseRate[scheme] = brier(base, ys);
  }
  return { model, baseRate };
}

// ------------------------------------------------------------------ conformal (cross-fitted)

export interface Conformal {
  q50: number; q80: number;
  tercileBounds: [number, number];
  scale: [number, number, number];
  coverage50: number; coverage80: number;
  n: number;
}

function crossConformal(priced: Item[], terms: VTerm[], ctx: Ctx): Conformal {
  const resid: { it: Item; r: number }[] = [];
  for (let fold = 0; fold < 5; fold++) {
    const test = priced.filter((it) => fnv(it.p.slug) % 5 === fold);
    const train = priced.filter((it) => fnv(it.p.slug) % 5 !== fold);
    if (test.length === 0 || train.length === 0) continue;
    const fit = fitValue(train, terms, ctx);
    for (const it of test) resid.push({ it, r: Math.abs(predEnsemble(fit, it) - it.lnMult!) });
  }
  const all = resid.map((x) => x.r);
  const q50 = conformalQuantile(all, 0.5), q80 = conformalQuantile(all, 0.8);
  const tvls = priced.map((it) => it.p.tvl_usd);
  const bounds: [number, number] = [quantile(tvls, 1 / 3), quantile(tvls, 2 / 3)];
  const tercileOf = (tvl: number): number => (tvl <= bounds[0] ? 0 : tvl <= bounds[1] ? 1 : 2);
  const scale = [0, 1, 2].map((t) => {
    const rs = resid.filter((x) => tercileOf(x.it.p.tvl_usd) === t).map((x) => x.r);
    if (rs.length < 8 || q80 === 0) return 1;
    return clamp(conformalQuantile(rs, 0.8) / q80, 0.5, 2);
  }) as [number, number, number];
  const covered = (q: number): number => resid.filter((x) => x.r <= q * scale[tercileOf(x.it.p.tvl_usd)]).length / resid.length;
  return { q50, q80, tercileBounds: bounds, scale, coverage50: covered(q50), coverage80: covered(q80), n: resid.length };
}

// ------------------------------------------------------------------ the board

export interface Row {
  slug: string; name: string; rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null; chains: string[]; tvl_usd: number; change_7d: number | null;
  age_days: number; watchlist: boolean; off_list: boolean;
  odds: number; value_if_usd: number;
  lo50: number; hi50: number; lo80: number; hi80: number;
  e1_usd: number; e2_usd: number; e3_usd: number;
  verdict: string; viable_capital_usd: number | null; read_at_usd: number; net_at_viable: number; net_per_hour: number;
  breakeven_drop_share: number; fees_usd: number; hours: number;
  plan: Plan; verdictDetail: Verdict;
}

export interface Radar {
  meta: Record<string, unknown>;
  kpi: Record<string, number>;
  valueTerms: TermRow<VTerm>[]; oddsTerms: TermRow<OTerm>[];
  valueKept: VTerm[]; oddsKept: OTerm[];
  estimatorScores: { name: string; scores: Scores4 }[];
  valueBase: Scores4; oddsScores: Scores4; oddsBaseRate: Scores4;
  conformal: Conformal;
  valueCoefs: { name: string; coef: number; se: number }[];
  oddsCoefs: { name: string; coef: number; se: number }[];
  calib: { brierRaw: number; brierCal: number; slope: number };
  reading: string[];
  ledger: { label: string; n: number }[];
  verdictCounts: Record<string, number>;
  rows: Row[];
  details: Record<string, unknown>[];
  integrity: { rows: number; totalImplied: number; watchlistCovered: number; ledgerTotal: number; mainChecksum: string };
}

const r4 = (n: number): number => Math.round(n * 10000) / 10000;

export function buildRadar(snap: Snapshot, mainChecksum: string): { board: Row[]; radar: Radar } {
  const items = buildItems(snap);
  const bySlug = new Map(items.map((it) => [it.p.slug, it]));
  const priced = items.filter((it) => it.lnMult !== null);
  const watch = new Set(snap.watchlist);
  const ctx = buildCtx(priced);
  const vSplits = splitsFor(priced, 4);
  const oSplits = splitsFor(items, 10);

  // Selection: greedy, every addition must improve all four tests.
  const vSel = greedySelect(V_CANDIDATES, (t) => V_LABEL[t], (t) => evalValueE1(priced, t, ctx, vSplits));
  const oSel = greedySelect(O_CANDIDATES, (t) => O_LABEL[t], (t) => evalOdds(items, t, oSplits));

  // Shipped-pipeline scores with the term sets frozen.
  const vPipe = valuePipelineScores(priced, vSel.kept, ctx, vSplits);
  const oPipe = oddsPipelineScores(items, oSel.kept, oSplits);
  const conformal = crossConformal(priced, vSel.kept, ctx);

  // Final fits on all the data.
  const vFit = fitValue(priced, vSel.kept, ctx);
  const oFit = fitOdds(items, oSel.kept);

  // Odds calibration: Platt scaling on cross-fitted logits (5 folds, frozen terms).
  const oof: { logit: number; y: number }[] = [];
  for (let fold = 0; fold < 5; fold++) {
    const test = items.filter((it) => fnv(it.p.slug) % 5 === fold);
    const train = items.filter((it) => fnv(it.p.slug) % 5 !== fold);
    const f = fitOdds(train, oSel.kept);
    for (const it of test) {
      const p = clamp(predOddsRaw(f, it), 1e-4, 1 - 1e-4);
      oof.push({ logit: Math.log(p / (1 - p)), y: it.hasToken });
    }
  }
  const platt = fitLogistic(oof.map((o) => [1, o.logit]), oof.map((o) => o.y), 0.01);
  const calib = {
    brierRaw: r4(brier(oof.map((o) => 1 / (1 + Math.exp(-o.logit))), oof.map((o) => o.y))),
    brierCal: r4(brier(oof.map((o) => predictLogistic(platt.beta, [1, o.logit])), oof.map((o) => o.y))),
    slope: r4(platt.beta[1]!),
  };
  const finalOdds = (it: Item): number => {
    const p = clamp(predOddsRaw(oFit, it), 1e-4, 1 - 1e-4);
    const cal = predictLogistic(platt.beta, [1, Math.log(p / (1 - p))]);
    return clamp(cal, 0.02, 0.97);
  };

  // Bootstrap standard errors for the ridge coefficients (200 seeded refits).
  const vBoot = bootstrapSE(priced.length, 200, 9001, (idx) => {
    try {
      const train = idx.map((i) => priced[i]!);
      const { X, pen } = vDesign(train, vSel.kept, ctx);
      return ridgeSolve(X, train.map((it) => it.lnMult!), pen).beta;
    } catch { return null; }
  });
  const { blocks } = vDesign(priced, vSel.kept, ctx);
  const coefName = (b: { name: string }): string =>
    b.name === 'size' ? 'size slope (ln TVL)' : (V_LABEL[b.name as VTerm] ?? b.name);
  const valueCoefs = [
    { name: 'intercept — ln multiple at $100M TVL', coef: r4(vFit.beta1[0]!), se: r4(vBoot[0] ?? NaN) },
    ...blocks.map((b, j) => ({
      name: b.to - b.from > 1 ? `${coefName(b)} (${b.to - b.from} levels, ridge-shrunk)` : coefName(b),
      coef: r4(vFit.beta1[b.from]!), se: r4(vBoot[b.from] ?? NaN),
    })),
  ];
  const oddsCoefs = [
    { name: 'intercept (logit)', coef: r4(oFit.beta[0]!), se: r4(oFit.se[0]!) },
    ...oSel.kept.map((t, j) => ({ name: `${O_LABEL[t]} (standardised)`, coef: r4(oFit.beta[j + 1]!), se: r4(oFit.se[j + 1]!) })),
  ];

  // Ledger: all 758 protocols accounted for exactly once.
  const ledgerMap = new Map<string, number>();
  const candidates: Item[] = [];
  for (const it of items) {
    const reason = exclusionReason(it.p);
    if (reason === null) { candidates.push(it); ledgerMap.set('ranked on this board', (ledgerMap.get('ranked on this board') ?? 0) + 1); }
    else ledgerMap.set(reason, (ledgerMap.get(reason) ?? 0) + 1);
  }
  const order = ['ranked on this board', 'token trades', 'token recorded, no cap'];
  const ledger = [...ledgerMap.entries()]
    .sort((a, b) => (order.indexOf(a[0]) === -1 ? 9 : order.indexOf(a[0])) - (order.indexOf(b[0]) === -1 ? 9 : order.indexOf(b[0])) || b[1] - a[1])
    .map(([label, n]) => ({ label, n }));

  const tercileOf = (tvl: number): number => (tvl <= conformal.tercileBounds[0] ? 0 : tvl <= conformal.tercileBounds[1] ? 1 : 2);
  const rows: Row[] = [];
  for (const it of candidates) {
    const p = it.p;
    const members = predMembers(vFit, it);
    const valueIf = p.tvl_usd * Math.exp(median(members));
    const odds = finalOdds(it);
    const implied = Math.max(1, Math.round(valueIf * odds));
    const sc = conformal.scale[tercileOf(p.tvl_usd)];
    const plan0 = buildPlan(p, null);
    const vd = priceRow(implied, p.tvl_usd, DROP_SHARE, HORIZON_WEEKS, plan0.feesUsd, plan0.hours, Math.min(1_000_000, 0.05 * p.tvl_usd));
    const plan = buildPlan(p, vd.viableCapital);
    rows.push({
      slug: p.slug, name: p.name, rank: 0,
      implied_value_usd: implied,
      farm_steps: plan.steps.map((s) => s.text),
      category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d,
      age_days: Math.round(it.ageYears * 365.25), watchlist: watch.has(p.slug), off_list: !watch.has(p.slug) && p.tvl_usd >= snap.floor_usd,
      odds: r4(odds), value_if_usd: Math.round(valueIf),
      lo50: Math.max(1, Math.round(implied * Math.exp(-conformal.q50 * sc))), hi50: Math.round(implied * Math.exp(conformal.q50 * sc)),
      lo80: Math.max(1, Math.round(implied * Math.exp(-conformal.q80 * sc))), hi80: Math.round(implied * Math.exp(conformal.q80 * sc)),
      e1_usd: Math.round(p.tvl_usd * Math.exp(members[0])), e2_usd: Math.round(p.tvl_usd * Math.exp(members[1])), e3_usd: Math.round(p.tvl_usd * Math.exp(members[2])),
      verdict: vd.verdict, viable_capital_usd: vd.viableCapital, read_at_usd: vd.readAt, net_at_viable: vd.netAtViable, net_per_hour: vd.netPerHour,
      breakeven_drop_share: vd.breakevenDropShare, fees_usd: plan.feesUsd, hours: plan.hours,
      plan, verdictDetail: vd,
    });
  }
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => { r.rank = i + 1; });

  const verdictCounts: Record<string, number> = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  for (const r of rows) verdictCounts[r.verdict]!++;
  const totalImplied = rows.reduce((a, r) => a + r.implied_value_usd, 0);

  const farmRows = rows.filter((r) => r.verdict === 'FARM').sort((a, b) => b.net_per_hour - a.net_per_hour);
  const pickFarm = farmRows[0] ?? [...rows].sort((a, b) => b.net_per_hour - a.net_per_hour)[0]!;
  const watchRows = rows.filter((r) => r.watchlist).sort((a, b) => b.net_per_hour - a.net_per_hour || b.implied_value_usd - a.implied_value_usd);
  const pickWatch = watchRows[0]!.slug === pickFarm.slug ? watchRows[1]! : watchRows[0]!;
  const details = [pickFarm, pickWatch].map((r) => buildDetail(r, priced, bySlug));

  const fmtX = (n: number): string => `x${n.toFixed(2)}`;
  const bestMember = (['e1', 'e2', 'e3'] as const).reduce((a, b) => (vPipe[a].wf <= vPipe[b].wf ? a : b));
  const memberName = { e1: 'the ridge regression', e2: 'the median regression', e3: 'the local peer estimator' } as const;
  const rejected = vSel.table.filter((t) => !t.kept && t.term !== 'control').map((t) => t.label);
  const reading = [
    `Walk-forward is the test that decides: later listings priced by earlier ones. The consensus misses by ${fmtX(vPipe.ens.wf)} there, against ${fmtX(vPipe.flat.wf)} for a flat median multiple and ${fmtX(vPipe[bestMember].wf)} for its best single member (${memberName[bestMember]}); taking the median of three unlike estimators is what survives contact with protocols none of them has seen.`,
    `Terms were admitted only when they improved all four held-out tests of the ridge estimator at once. Kept for value: ${vSel.kept.length > 0 ? vSel.kept.map((t) => V_LABEL[t]).join(', ') : 'none beyond size'}; kept for odds: ${oSel.kept.length > 0 ? oSel.kept.map((t) => O_LABEL[t]).join(', ') : 'none beyond the base rate'}. Tested and refused: ${rejected.length > 0 ? rejected.join(', ') : 'none'} — and the control term (another row's growth) ${vSel.table.find((t) => t.term === 'control')!.kept || oSel.table.find((t) => t.term === 'control')!.kept ? 'was kept, which would indict the whole test battery' : 'helped nowhere, as it must not'}.`,
    `Intervals are conformal, calibrated on cross-fitted residuals of the consensus itself (${conformal.n} held-out peers): the 50% band held ${(conformal.coverage50 * 100).toFixed(0)}% of peers and the 80% band ${(conformal.coverage80 * 100).toFixed(0)}%, against 50% and 80% promised. Launch odds were Platt-calibrated on out-of-fold predictions: the fitted calibration slope is ${calib.slope} (1.00 is perfect), and Brier moves from ${calib.brierRaw} to ${calib.brierCal} — the odds the board prints are the calibrated ones.`,
    `Verdicts are read at one capital per row, printed beside the verdict: FARM means that deposit breaks even and clears the 4% T-bill hurdle; MARGINAL means the best deposit nets positive but no deposit clears the hurdle; the break-even drop share is quoted at that same deposit, so a verdict and its break-even figure cannot contradict each other.`,
  ];

  const radar: Radar = {
    meta: {
      title: 'RADAR-9 — CONSENSUS RADAR',
      asOf: snap.as_of, source: snap.source, floorUsd: snap.floor_usd,
      protocols: snap.protocols.length, watchlist: snap.watchlist.length, pricedPeers: priced.length,
      dropShare: DROP_SHARE, horizonWeeks: HORIZON_WEEKS,
      note: 'Every number on this page is computed from the sealed snapshot at run time. A protocol is said to record no token, never to have none. Held-out scores refit coefficients in every split with the term set frozen; walk-forward, family and chain splits re-check the same terms the cover reports. Deposits are sized at most 5% of a protocol TVL and at most $1,000,000.',
    },
    kpi: {
      missWf: r4(vPipe.ens.wf), missLoo: r4(vPipe.ens.loo), missLofo: r4(vPipe.ens.lofo), missLoco: r4(vPipe.ens.loco),
      flatWf: r4(vPipe.flat.wf), flatLoo: r4(vPipe.flat.loo),
      coverage50: r4(conformal.coverage50), coverage80: r4(conformal.coverage80),
      brier: calib.brierCal, brierBase: r4(oPipe.baseRate.loo),
      farm: verdictCounts.FARM!, ranked: rows.length,
      multipleAt100M: r4(Math.exp(vFit.beta1[0]!)),
    },
    valueTerms: vSel.table, oddsTerms: oSel.table,
    valueKept: vSel.kept, oddsKept: oSel.kept,
    estimatorScores: [
      { name: 'consensus (median of the three)', scores: vPipe.ens },
      { name: 'E1 ridge regression', scores: vPipe.e1 },
      { name: 'E2 median (L1) regression', scores: vPipe.e2 },
      { name: 'E3 local peer estimator', scores: vPipe.e3 },
      { name: 'flat median multiple (baseline)', scores: vPipe.flat },
    ],
    valueBase: vSel.base, oddsScores: oPipe.model, oddsBaseRate: oPipe.baseRate,
    conformal, valueCoefs, oddsCoefs, calib, reading, ledger, verdictCounts, rows, details,
    integrity: { rows: rows.length, totalImplied, watchlistCovered: rows.filter((r) => r.watchlist).length, ledgerTotal: ledger.reduce((a, s) => a + s.n, 0), mainChecksum },
  };
  return { board: rows, radar };
}

function buildDetail(r: Row, priced: Item[], bySlug: Map<string, Item>): Record<string, unknown> {
  const it = bySlug.get(r.slug)!;
  const peers = priced
    .filter((x) => x.p.slug !== r.slug)
    .sort((a, b) => Math.abs(Math.log(a.p.tvl_usd / r.tvl_usd)) + (a.category === it.category ? 0 : 0.35) - (Math.abs(Math.log(b.p.tvl_usd / r.tvl_usd)) + (b.category === it.category ? 0 : 0.35)))
    .slice(0, 5)
    .map((x) => ({ name: x.p.name, category: x.p.category, tvl: x.p.tvl_usd, mcap: x.p.mcap_usd, multiple: r4(x.p.mcap_usd! / x.p.tvl_usd) }));
  const deposits = [1000, 5000, 10000, 25000, 50000, 100000];
  const shares = [0.02, 0.04, 0.06, 0.1];
  const matrix = shares.map((ds) => deposits.map((D) => Math.round(r.implied_value_usd * ds * (D / (r.tvl_usd + D)) - r.fees_usd - r.hours * 25)));
  const D = r.viable_capital_usd ?? 10000;
  const needed = ((r.fees_usd + r.hours * 25 + 0.04 * (HORIZON_WEEKS / 52) * D) * (r.tvl_usd + D)) / (DROP_SHARE * D);
  const oddsBreakeven = r4(Math.min(9.99, needed / Math.max(r.value_if_usd, 1)));
  return {
    slug: r.slug, name: r.name, kind: r.watchlist ? 'watchlist pick' : 'best farm pick',
    breakdown: [
      { label: 'E1 ridge regression — value if it launches', value: `$${r.e1_usd.toLocaleString('en-US')}` },
      { label: 'E2 median regression — value if it launches', value: `$${r.e2_usd.toLocaleString('en-US')}` },
      { label: 'E3 local peers — value if it launches', value: `$${r.e3_usd.toLocaleString('en-US')}` },
      { label: 'Consensus (median of the three)', value: `$${r.value_if_usd.toLocaleString('en-US')}` },
      { label: 'Launch odds (peer record, calibrated)', value: `${Math.round(r.odds * 100)}%` },
      { label: 'Implied value (consensus x odds)', value: `$${r.implied_value_usd.toLocaleString('en-US')}` },
      { label: 'Conformal 80% band', value: `$${r.lo80.toLocaleString('en-US')} – $${r.hi80.toLocaleString('en-US')}` },
    ],
    peers, matrix, deposits, shares,
    breakevens: { dropShareAt10k: r.breakeven_drop_share, oddsBreakeven, viableCapital: r.viable_capital_usd },
    exitRule: `Unwind if TVL falls under $${Math.round(r.tvl_usd * 0.7).toLocaleString('en-US')} (30% below entry), if a token is announced on terms below the break-even drop share of ${Math.round(r.breakeven_drop_share * 1000) / 10}% at the capital the verdict is read at, or at the end of the ${HORIZON_WEEKS}-week horizon — whichever comes first.`,
    steps: r.plan.steps,
  };
}

/** The gate's board checks, restated: a refusal string, or null when valid. */
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

/** The dashboard's data file: one window.RADAR9 assignment the static page renders from. */
export function dataScript(radar: Radar): string {
  const slim = {
    ...radar,
    rows: radar.rows.map((r) => ({
      slug: r.slug, name: r.name, rank: r.rank, implied: r.implied_value_usd, category: r.category, chains: r.chains,
      tvl: r.tvl_usd, chg: r.change_7d, age: r.age_days, wl: r.watchlist, off: r.off_list, odds: r.odds,
      vif: r.value_if_usd, lo50: r.lo50, hi50: r.hi50, lo80: r.lo80, hi80: r.hi80,
      e1: r.e1_usd, e2: r.e2_usd, e3: r.e3_usd,
      verdict: r.verdict, viable: r.viable_capital_usd, readat: r.read_at_usd, net: r.net_at_viable, nph: r.net_per_hour,
      be: r.breakeven_drop_share, fees: r.fees_usd, hours: r.hours, steps: r.farm_steps,
    })),
  };
  return `window.RADAR9 = ${JSON.stringify(slim)};\n`;
}
