// model.ts — radar-7's two models, fitted from the snapshot's own figures
// at run time. Nothing about any protocol is hardcoded: the value model
// learns what a launch has been worth from the protocols whose tokens
// already trade, and the odds model learns how often peers like each one
// went on to record a token. A candidate term is kept only when it lowers
// the miss in all three held-out tests: leave-one-out, walk-forward
// (earlier listings price later ones) and leave-one-family-out.

import {
  rng, median, quantile, clamp, fitLinear, huberRefit, hatDiag,
  fitLogistic, brier, typicalMiss, type LogFit,
} from './stats.ts';

export interface Protocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}

export interface Snapshot {
  as_of: string; source: string; floor_usd: number;
  protocols: Protocol[]; watchlist: string[];
}

export interface Row {
  p: Protocol;
  ageDays: number; ageYears: number; lnTvl: number; growth: number; lnChains: number;
  family: string; hasToken: boolean;
  odds: number; valueIf: number; implied: number;
  p10: number; p25: number; p75: number; p90: number;
  rankLo: number; rankHi: number; rank: number;
}

const EXCLUDED_CATS = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);
const EXCHANGE_PREFIX = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export function nameExcluded(name: string): boolean {
  if (/\s(V2|v2|2\.0|V3|v3|3\.0|V4|v4)$/.test(name)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(name)) return true;
  return EXCHANGE_PREFIX.some((e) => name === e || name.startsWith(e + ' '));
}

/** The house's watchlist rule with the TVL floor lifted: the board's universe. */
export function isBoardProtocol(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null
    && !(p.category !== null && EXCLUDED_CATS.has(p.category))
    && !nameExcluded(p.name);
}

const FAMILY_OF: Record<string, string> = {
  'Lending': 'Lending & credit', 'Uncollateralized Lending': 'Lending & credit',
  'CDP': 'Lending & credit', 'CDP Manager': 'Lending & credit',
  'Leveraged Farming': 'Lending & credit', 'Collateral Markets': 'Lending & credit',
  'Collateral Management': 'Lending & credit',
  'Dexs': 'Trading & derivatives', 'Derivatives': 'Trading & derivatives',
  'Options': 'Trading & derivatives', 'Options Vault': 'Trading & derivatives',
  'Interest Rate Derivatives': 'Trading & derivatives', 'Prediction Market': 'Trading & derivatives',
  'Basis Trading': 'Trading & derivatives', 'Synthetics': 'Trading & derivatives',
  'Yield': 'Yield & vaults', 'Yield Aggregator': 'Yield & vaults',
  'Risk Curators': 'Yield & vaults', 'Onchain Capital Allocator': 'Yield & vaults',
  'Liquidity Manager': 'Yield & vaults', 'Farm': 'Yield & vaults', 'Indexes': 'Yield & vaults',
  'Liquid Staking': 'Staking & restaking', 'Staking Pool': 'Staking & restaking',
  'Restaking': 'Staking & restaking', 'Liquid Restaking': 'Staking & restaking',
  'Restaked BTC': 'Staking & restaking', 'Anchor BTC': 'Staking & restaking',
  'Decentralized BTC': 'Staking & restaking',
  'Bridge': 'Bridge & chain', 'Canonical Bridge': 'Bridge & chain',
  'Cross Chain Bridge': 'Bridge & chain', 'Chain': 'Bridge & chain',
  'RWA': 'Real-world & payments', 'Payments': 'Real-world & payments',
  'Crypto Card Issuer': 'Real-world & payments', 'Stablecoin Issuer': 'Real-world & payments',
  'Algo-Stables': 'Real-world & payments', 'Dual-Token Stablecoin': 'Real-world & payments',
  'Stablecoin Wrapper': 'Real-world & payments', 'Reserve Currency': 'Real-world & payments',
};
export function familyOf(category: string | null): string {
  if (category === null) return 'Other services';
  return FAMILY_OF[category] ?? 'Other services';
}

export interface Accounting {
  total: number; ranked: number; watchlistIn: number; watchlistTotal: number; early: number; offList: number;
  trades: number; recordedNoCap: number; outByRule: number;
  outReasons: { label: string; n: number }[];
}

export function accountFor(snap: Snapshot, board: Protocol[]): Accounting {
  const wl = new Set(snap.watchlist);
  const boardSet = new Set(board.map((p) => p.slug));
  const trades = snap.protocols.filter((p) => p.mcap_usd !== null).length;
  const recorded = snap.protocols.filter((p) => p.gecko_id !== null || p.symbol !== null);
  const out = snap.protocols.filter((p) => p.gecko_id === null && p.symbol === null && !boardSet.has(p.slug));
  const reasons = new Map<string, number>();
  for (const p of out) {
    const label = p.category !== null && EXCLUDED_CATS.has(p.category)
      ? p.category.toLowerCase()
      : 'name reads wrapped, staked or versioned';
    reasons.set(label, (reasons.get(label) ?? 0) + 1);
  }
  return {
    total: snap.protocols.length,
    ranked: board.length,
    watchlistIn: board.filter((p) => wl.has(p.slug)).length,
    watchlistTotal: snap.watchlist.length,
    early: board.filter((p) => p.tvl_usd < snap.floor_usd).length,
    offList: board.filter((p) => p.tvl_usd >= snap.floor_usd && !wl.has(p.slug)).length,
    trades,
    recordedNoCap: recorded.length - trades,
    outByRule: out.length,
    outReasons: [...reasons.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n),
  };
}

// ---------------------------------------------------------------- features

export interface Feat {
  slug: string; ageDays: number; ageYears: number; lnTvl: number;
  growth: number; lnChains: number; family: string; category: string;
  listedMs: number | null;
}

export function derive(p: Protocol, asOfMs: number, medianAgeDays: number): Feat {
  const listedMs = p.listed_at !== null ? Date.parse(p.listed_at) : null;
  const ageDays = listedMs !== null ? Math.max(0, Math.round((asOfMs - listedMs) / 86400000)) : medianAgeDays;
  return {
    slug: p.slug, ageDays, ageYears: ageDays / 365.25,
    lnTvl: Math.log(p.tvl_usd / 1e8),
    growth: clamp((p.change_7d ?? 0) / 100, -0.6, 2.0),
    lnChains: Math.log(Math.max(1, p.chains.length)),
    family: familyOf(p.category),
    category: p.category ?? 'Uncategorised',
    listedMs,
  };
}

export type TermName = 'size' | 'category' | 'family' | 'growth' | 'age' | 'chains' | 'control';
export const TERM_LABEL: Record<TermName, string> = {
  size: 'size curve, ln TVL', category: 'category effect', family: 'family effect',
  growth: '7-day TVL growth', age: 'age, years listed', chains: 'chain count, ln',
  control: 'control: growth of another row',
};
const ALL_TERMS: TermName[] = ['size', 'category', 'family', 'growth', 'age', 'chains', 'control'];

export interface Ctx { catLevels: string[]; famLevels: string[]; control: Map<string, number> }

export function buildCtx(feats: Feat[], minPeers: number, peerSlugs: Set<string>): Ctx {
  const catCount = new Map<string, number>(), famCount = new Map<string, number>();
  for (const f of feats) {
    if (!peerSlugs.has(f.slug)) continue;
    catCount.set(f.category, (catCount.get(f.category) ?? 0) + 1);
    famCount.set(f.family, (famCount.get(f.family) ?? 0) + 1);
  }
  const levels = (m: Map<string, number>) => [...m.entries()].filter(([, n]) => n >= minPeers).map(([k]) => k).sort();
  const control = new Map<string, number>();
  const sorted = [...feats].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  sorted.forEach((f, i) => control.set(f.slug, sorted[(i + 41) % sorted.length].growth));
  return { catLevels: levels(catCount), famLevels: levels(famCount), control };
}

/** Design matrix for a term set. Dummy blocks are ridge-shrunk (value) or
 *  column-scaled (odds, where the logistic ridge is uniform). */
export function design(feats: Feat[], terms: TermName[], ctx: Ctx, kind: 'value' | 'odds'):
  { X: number[][]; penalty: number[]; blocks: { name: TermName; from: number; to: number }[] } {
  const X: number[][] = feats.map(() => [1]);
  const penalty: number[] = [0];
  const blocks: { name: TermName; from: number; to: number }[] = [];
  const push = (name: TermName, colOf: (f: Feat) => number[], pen: number[]) => {
    const from = penalty.length;
    feats.forEach((f, i) => { const cs = colOf(f); for (const c of cs) X[i].push(c); });
    penalty.push(...pen);
    blocks.push({ name, from, to: penalty.length });
  };
  for (const t of terms) {
    if (t === 'size') push(t, (f) => [f.lnTvl], [0]);
    else if (t === 'growth') push(t, (f) => [f.growth], [0]);
    else if (t === 'age') push(t, (f) => [f.ageYears], [0]);
    else if (t === 'chains') push(t, (f) => [f.lnChains], [0]);
    else if (t === 'control') push(t, (f) => [ctx.control.get(f.slug) ?? 0], [0]);
    else if (t === 'category') {
      const s = kind === 'value' ? 1 : 0.5, pen = kind === 'value' ? 8 : 0;
      push(t, (f) => ctx.catLevels.map((lv) => (lv === f.category ? s : 0)), ctx.catLevels.map(() => pen));
    } else if (t === 'family') {
      const s = kind === 'value' ? 1 : 0.5, pen = kind === 'value' ? 8 : 0;
      push(t, (f) => ctx.famLevels.map((lv) => (lv === f.family ? s : 0)), ctx.famLevels.map(() => pen));
    }
  }
  return { X, penalty, blocks };
}

// ---------------------------------------------------------------- fitting

export interface Scores { loo: number; wf: number; lofo: number }
export interface TermRow { name: TermName; label: string; solo: Scores; kept: boolean }

const mean3 = (s: Scores) => (s.loo + s.wf + s.lofo) / 3;
const better = (a: Scores, b: Scores) => a.loo < b.loo * 0.999 && a.wf < b.wf * 0.999 && a.lofo < b.lofo * 0.999;

interface PricedRow { f: Feat; tvl: number; mcap: number; lnMult: number }

function fitValueBeta(rows: PricedRow[], terms: TermName[], ctx: Ctx): { beta: number[]; penalty: number[] } {
  const { X, penalty } = design(rows.map((r) => r.f), terms, ctx, 'value');
  const fit = fitLinear(X, rows.map((r) => r.lnMult), penalty);
  return { beta: fit.beta, penalty };
}

function predLnMult(f: Feat, terms: TermName[], ctx: Ctx, beta: number[]): number {
  const { X } = design([f], terms, ctx, 'value');
  return X[0].reduce((s, x, j) => s + x * beta[j], 0);
}

function evalValue(priced: PricedRow[], terms: TermName[], ctx: Ctx): Scores {
  const { X, penalty } = design(priced.map((r) => r.f), terms, ctx, 'value');
  const y = priced.map((r) => r.lnMult);
  const fit = fitLinear(X, y, penalty);
  const h = hatDiag(X, fit.inv);
  const looPred = priced.map((r, i) => r.tvl * Math.exp(y[i] - fit.resid[i] / (1 - h[i])));
  const loo = typicalMiss(priced.map((r) => r.mcap), looPred);
  // walk-forward: earlier listings price later ones
  const dated = priced.filter((r) => r.f.listedMs !== null).sort((a, b) => (a.f.listedMs ?? 0) - (b.f.listedMs ?? 0));
  const half = Math.floor(dated.length / 2);
  const wfBeta = fitValueBeta(dated.slice(0, half), terms, ctx).beta;
  const wf = typicalMiss(
    dated.slice(half).map((r) => r.mcap),
    dated.slice(half).map((r) => r.tvl * Math.exp(predLnMult(r.f, terms, ctx, wfBeta))),
  );
  // leave-one-family-out, pooled
  const acts: number[] = [], preds: number[] = [];
  for (const fam of new Set(priced.map((r) => r.f.family))) {
    const test = priced.filter((r) => r.f.family === fam);
    if (test.length < 4) continue;
    const b = fitValueBeta(priced.filter((r) => r.f.family !== fam), terms, ctx).beta;
    for (const r of test) { acts.push(r.mcap); preds.push(r.tvl * Math.exp(predLnMult(r.f, terms, ctx, b))); }
  }
  const lofo = typicalMiss(acts, preds);
  return { loo, wf, lofo };
}

interface OddsRow { f: Feat; y: number }

function fitOddsBeta(rows: OddsRow[], terms: TermName[], ctx: Ctx, start?: number[], maxIter = 40): LogFit {
  const { X } = design(rows.map((r) => r.f), terms, ctx, 'odds');
  return fitLogistic(X, rows.map((r) => r.y), 1, start, maxIter);
}

function predOdds(f: Feat, terms: TermName[], ctx: Ctx, beta: number[]): number {
  const { X } = design([f], terms, ctx, 'odds');
  const z = X[0].reduce((s, x, j) => s + x * beta[j], 0);
  return 1 / (1 + Math.exp(-clamp(z, -30, 30)));
}

function evalOdds(rows: OddsRow[], terms: TermName[], ctx: Ctx): Scores {
  const fit = fitOddsBeta(rows, terms, ctx, undefined, 16);
  const { X } = design(rows.map((r) => r.f), terms, ctx, 'odds');
  // leave-one-out by the one-step (Pregibon) approximation to a refit
  const looP = rows.map((r, i) => {
    const xi = X[i], gi = fit.inv.map((row) => row.reduce((s, g, j) => s + g * xi[j], 0));
    const h = Math.min(fit.w[i] * xi.reduce((s, x, j) => s + x * gi[j], 0), 0.999999);
    const adj = fit.beta.map((bj, j) => bj - (gi[j] * fit.w[i] * (r.y - fit.prob[i])) / (1 - h));
    const z = xi.reduce((s, x, j) => s + x * adj[j], 0);
    return 1 / (1 + Math.exp(-clamp(z, -30, 30)));
  });
  const loo = brier(rows.map((r) => r.y), looP);
  const dated = rows.filter((r) => r.f.listedMs !== null).sort((a, b) => (a.f.listedMs ?? 0) - (b.f.listedMs ?? 0));
  const undated = rows.filter((r) => r.f.listedMs === null);
  const half = Math.floor(dated.length / 2);
  const train = [...dated.slice(0, half), ...undated];
  const wfFit = fitOddsBeta(train, terms, ctx, undefined, 16);
  const wf = brier(
    dated.slice(half).map((r) => r.y),
    dated.slice(half).map((r) => predOdds(r.f, terms, ctx, wfFit.beta)),
  );
  let se = 0, cnt = 0;
  for (const fam of new Set(rows.map((r) => r.f.family))) {
    const test = rows.filter((r) => r.f.family === fam);
    if (test.length < 10) continue;
    const fb = fitOddsBeta(rows.filter((r) => r.f.family !== fam), terms, ctx, undefined, 16);
    for (const r of test) { const pr = predOdds(r.f, terms, ctx, fb.beta); se += (r.y - pr) * (r.y - pr); cnt++; }
  }
  return { loo, wf, lofo: cnt ? se / cnt : loo };
}

function greedy(rawEval: (t: TermName[]) => Scores): { kept: TermName[]; base: Scores; final: Scores; table: TermRow[] } {
  const cache = new Map<string, Scores>();
  const evalFn = (t: TermName[]) => {
    const key = [...t].sort().join(',');
    if (!cache.has(key)) cache.set(key, rawEval(t));
    return cache.get(key)!;
  };
  const base = evalFn([]);
  const solo = new Map<TermName, Scores>();
  for (const t of ALL_TERMS) solo.set(t, evalFn([t]));
  const kept: TermName[] = [];
  let current = base;
  for (;;) {
    let bestTerm: TermName | null = null, bestScores: Scores | null = null;
    for (const t of ALL_TERMS) {
      if (kept.includes(t) || t === 'control') continue;
      const s = evalFn([...kept, t]);
      if (better(s, current) && (bestScores === null || mean3(s) < mean3(bestScores))) { bestTerm = t; bestScores = s; }
    }
    if (bestTerm === null || bestScores === null) break;
    kept.push(bestTerm); current = bestScores;
  }
  const table = ALL_TERMS.map((t) => ({
    name: t, label: TERM_LABEL[t], solo: solo.get(t)!, kept: kept.includes(t),
  }));
  return { kept, base, final: current, table };
}

// ---------------------------------------------------------------- report

export interface ModelSide {
  kept: TermName[]; table: TermRow[]; base: Scores; final: Scores;
  beta: number[]; blocks: { name: TermName; from: number; to: number }[];
}

export interface Built {
  rows: Row[]; accounting: Accounting;
  value: ModelSide & { multipleAt100M: number; sizeSlope: number; seIntercept: number; seSlope: number; nPriced: number; zeroCap: number };
  odds: ModelSide & { baseRate: number; baseBrier: Scores; calledRight: number };
  honesty: { inP2575: number; inP1090: number };
  totalImplied: number; totalTvl: number;
  pricedPeers: { f: Feat; tvl: number; mcap: number }[];
  valueTerms: TermName[]; oddsTerms: TermName[]; ctx: Ctx; ctxOdds: Ctx;
  valueBeta: number[]; oddsBeta: number[];
}

const BOOT = 200;

export function buildModel(snap: Snapshot): Built {
  const asOfMs = Date.parse(snap.as_of + 'T00:00:00Z');
  const knownAges = snap.protocols.filter((p) => p.listed_at !== null)
    .map((p) => Math.round((asOfMs - Date.parse(p.listed_at!)) / 86400000));
  const medianAge = Math.round(median(knownAges));
  const feats = new Map<string, Feat>();
  for (const p of snap.protocols) feats.set(p.slug, derive(p, asOfMs, medianAge));

  // The value model learns from peers whose tokens carry a positive cap.
  // Sixteen recorded tokens sit at $0 in the snapshot — no live market, not
  // a valuation — so they stay in the odds model and the ledger but out of
  // this fit; the dashboard says so.
  const priced: PricedRow[] = snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0).map((p) => ({
    f: feats.get(p.slug)!, tvl: p.tvl_usd, mcap: p.mcap_usd!, lnMult: Math.log(p.mcap_usd! / p.tvl_usd),
  }));
  const zeroCap = snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd <= 0).length;
  const oddsRows: OddsRow[] = snap.protocols.map((p) => ({
    f: feats.get(p.slug)!, y: p.gecko_id !== null || p.symbol !== null ? 1 : 0,
  }));
  const ctxV = buildCtx([...feats.values()], 3, new Set(priced.map((r) => r.f.slug)));
  const ctxO = buildCtx([...feats.values()], 10, new Set(oddsRows.map((r) => r.f.slug)));

  const vSel = greedy((t) => evalValue(priced, t, ctxV));
  const oSel = greedy((t) => evalOdds(oddsRows, t, ctxO));

  const vFit = fitValueBeta(priced, vSel.kept, ctxV);
  const vDesign = design(priced.map((r) => r.f), vSel.kept, ctxV, 'value');
  const oFit = fitOddsBeta(oddsRows, oSel.kept, ctxO);
  const oDesign = design(oddsRows.map((r) => r.f), oSel.kept, ctxO, 'odds');

  const boardProtos = snap.protocols.filter(isBoardProtocol);
  const boardFeats = boardProtos.map((p) => feats.get(p.slug)!);
  const point = boardFeats.map((f, i) => {
    const valueIf = boardProtos[i].tvl_usd * Math.exp(predLnMult(f, vSel.kept, ctxV, vFit.beta));
    const odds = predOdds(f, oSel.kept, ctxO, oFit.beta);
    return { valueIf, odds, implied: valueIf * odds };
  });

  // Bootstrap: refit both models on resamples and reprice the whole board.
  // A refit's prediction also draws one of the full fit's own residuals —
  // peers scatter around the model by a typical ×3 or so, and a band that
  // only wobbles the coefficients would pretend that scatter away.
  const vResid = priced.map((r) => r.lnMult - predLnMult(r.f, vSel.kept, ctxV, vFit.beta));
  const rand = rng(20261114);
  const impliedSamples: number[][] = boardFeats.map(() => []);
  const peerSamples: number[][] = priced.map(() => []);
  const vBetas: number[][] = [], oBetas: number[][] = [];
  for (let b = 0; b < BOOT; b++) {
    const vIdx = priced.map(() => Math.floor(rand() * priced.length));
    const vRes = vIdx.map((i) => priced[i]);
    const vb = fitValueBeta(vRes, vSel.kept, ctxV).beta;
    vBetas.push(vb);
    const oIdx = oddsRows.map(() => Math.floor(rand() * oddsRows.length));
    const oRes = oIdx.map((i) => oddsRows[i]);
    const ob = fitOddsBeta(oRes, oSel.kept, ctxO, oFit.beta, 14).beta;
    oBetas.push(ob);
    boardFeats.forEach((f, i) => {
      const draw = vResid[Math.floor(rand() * vResid.length)];
      const v = boardProtos[i].tvl_usd * Math.exp(predLnMult(f, vSel.kept, ctxV, vb) + draw);
      impliedSamples[i].push(v * predOdds(f, oSel.kept, ctxO, ob));
    });
    priced.forEach((r, i) => {
      const draw = vResid[Math.floor(rand() * vResid.length)];
      peerSamples[i].push(r.tvl * Math.exp(predLnMult(r.f, vSel.kept, ctxV, vb) + draw));
    });
  }
  // rank ranges: rank each row inside every refit
  const rankSamples: number[][] = boardFeats.map(() => []);
  for (let b = 0; b < BOOT; b++) {
    const order = impliedSamples.map((s, i) => [s[b], i] as [number, number]).sort((a, c) => c[0] - a[0]);
    order.forEach(([, idx], r) => rankSamples[idx].push(r + 1));
  }
  let inMid = 0, inWide = 0;
  priced.forEach((r, i) => {
    const s = peerSamples[i];
    if (r.mcap >= quantile(s, 0.25) && r.mcap <= quantile(s, 0.75)) inMid++;
    if (r.mcap >= quantile(s, 0.10) && r.mcap <= quantile(s, 0.90)) inWide++;
  });

  const rows: Row[] = boardProtos.map((p, i) => {
    const f = boardFeats[i], s = impliedSamples[i];
    return {
      p, ageDays: f.ageDays, ageYears: f.ageYears, lnTvl: f.lnTvl, growth: f.growth,
      lnChains: f.lnChains, family: f.family, hasToken: false,
      odds: point[i].odds, valueIf: point[i].valueIf, implied: Math.max(1, Math.round(point[i].implied)),
      p10: Math.max(1, Math.round(quantile(s, 0.10))), p25: Math.max(1, Math.round(quantile(s, 0.25))),
      p75: Math.max(1, Math.round(quantile(s, 0.75))), p90: Math.max(1, Math.round(quantile(s, 0.90))),
      rankLo: Math.round(quantile(rankSamples[i], 0.05)), rankHi: Math.round(quantile(rankSamples[i], 0.95)),
      rank: 0,
    };
  });
  rows.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  rows.forEach((r, i) => { r.rank = i + 1; });

  const sd = (xs: number[]) => { const m = xs.reduce((a, c) => a + c, 0) / xs.length; return Math.sqrt(xs.reduce((a, c) => a + (c - m) * (c - m), 0) / xs.length); };
  const sizeBlock = vDesign.blocks.find((b) => b.name === 'size');
  const baseRate = oddsRows.reduce((s, r) => s + r.y, 0) / oddsRows.length;
  const calledRight = oddsRows.filter((r, i) => (oFit.prob[i] >= 0.5) === (r.y === 1)).length / oddsRows.length;

  return {
    rows,
    accounting: accountFor(snap, boardProtos),
    value: {
      ...vSel, beta: vFit.beta, blocks: vDesign.blocks,
      multipleAt100M: Math.exp(vFit.beta[0]),
      sizeSlope: sizeBlock ? vFit.beta[sizeBlock.from] : 0,
      seIntercept: sd(vBetas.map((b) => b[0])),
      seSlope: sizeBlock ? sd(vBetas.map((b) => b[sizeBlock.from])) : 0,
      nPriced: priced.length, zeroCap,
    },
    odds: {
      ...oSel, beta: oFit.beta, blocks: oDesign.blocks,
      baseRate, baseBrier: evalOdds(oddsRows, [], ctxO), calledRight,
    },
    honesty: { inP2575: inMid / priced.length, inP1090: inWide / priced.length },
    totalImplied: rows.reduce((s, r) => s + r.implied, 0),
    totalTvl: rows.reduce((s, r) => s + r.p.tvl_usd, 0),
    pricedPeers: priced.map((r) => ({ f: r.f, tvl: r.tvl, mcap: r.mcap })),
    valueTerms: vSel.kept, oddsTerms: oSel.kept, ctx: ctxV, ctxOdds: ctxO,
    valueBeta: vFit.beta, oddsBeta: oFit.beta,
  };
}

/** Factor-by-factor breakdown of one row's value and odds, for detail views. */
export function breakdown(built: Built, f: Feat, kind: 'value' | 'odds'):
  { label: string; factor: number }[] {
  const terms = kind === 'value' ? built.valueTerms : built.oddsTerms;
  const beta = kind === 'value' ? built.valueBeta : built.oddsBeta;
  const ctx = kind === 'value' ? built.ctx : built.ctxOdds;
  const { blocks } = design([f], terms, ctx, kind);
  const { X } = design([f], terms, ctx, kind);
  const out: { label: string; factor: number }[] = [];
  out.push({ label: kind === 'value' ? 'base multiple at $100M TVL' : 'base rate (logit)', factor: beta[0] });
  for (const b of blocks) {
    let contrib = 0;
    for (let j = b.from; j < b.to; j++) contrib += X[0][j] * beta[j];
    out.push({ label: TERM_LABEL[b.name], factor: contrib });
  }
  return out;
}
