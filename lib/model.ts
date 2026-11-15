// Token Radar model — radar-5.
//
// The value model is a size curve, not a flat multiple. Across the protocols
// that already trade, market cap grows slower than TVL: a log-log fit on the
// usable priced comps gives log10(mcap) = intercept + slope * log10(TVL) with
// slope near 0.52, so the implied multiple falls as a protocol grows (about
// 0.48x at $10M of TVL, 0.16x at $100M, 0.05x at $1B). A category offset,
// shrunk toward zero by n/(n+15) so thin categories barely move the fit,
// carries what the curve cannot see. Every figure the dashboard shows — the
// fit, the backtest, the bands — is recomputed here from the snapshot, so
// the page and the code cannot disagree.

export const MODEL_VERSION = 'radar-5';

export interface ProtocolRec {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source?: string;
  floor_usd: number;
  protocols: ProtocolRec[];
  watchlist: string[];
}

export interface CompRow {
  slug: string;
  name: string;
  category: string | null;
  tvlUsd: number;
  mcapUsd: number;
  multiple: number;
  fittedMultiple: number;
  residualFactor: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvlUsd: number;
  change7d: number | null;
  listedAt: string | null;
  ageDays: number | null;
  watchlist: boolean;
  rank: number;
  impliedValueUsd: number;
  bandLowUsd: number;
  bandHighUsd: number;
  curveMultiple: number;
  categoryOffsetLog: number;
  categoryMedianMultiple: number | null;
  categoryRank: number;
  categoryCount: number;
  signal: string;
  watchOuts: string[];
  farmSteps: string[];
  planCostUsd: number;
  planHours: number;
  netLowUsd: number;
  verdict: string;
}

export interface ModelStats {
  medianFactor: number;
  meanLogError: number;
  within2Pct: number;
}

export interface RadarData {
  version: string;
  asOf: string;
  floorUsd: number;
  census: {
    universe: number;
    ranked: number;
    setAside: number;
    tokenRecording: number;
    pricedUsable: number;
    pricedDead: number;
    pricedNone: number;
  };
  fit: {
    intercept: number;
    slope: number;
    r2: number;
    compCount: number;
    marketMedianMultiple: number;
  };
  curveTable: { tvlUsd: number; multiple: number }[];
  backtest: {
    n: number;
    oldLoo: ModelStats;
    newLoo: ModelStats;
    oldSplitMedianFactor: number;
    newSplitMedianFactor: number;
    bandLowFactor: number;
    bandHighFactor: number;
  };
  categoryStats: { category: string; comps: number; medianMultiple: number; offsetLog: number }[];
  rows: BoardRow[];
  comps: CompRow[];
}

// ---------------------------------------------------------------- utilities

const log10 = (x: number): number => Math.log(x) / Math.LN10;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

function ols(xs: number[], ys: number[]): { a: number; b: number; r2: number } {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let ss = 0;
  let tt = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) * (xs[i] - mx);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  for (let i = 0; i < n; i++) {
    ss += (ys[i] - (a + b * xs[i])) ** 2;
    tt += (ys[i] - my) ** 2;
  }
  return { a, b, r2: tt === 0 ? 0 : 1 - ss / tt };
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso.slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(toIso.slice(0, 10) + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

// ------------------------------------------------------- the product rule
// The board ranks every protocol that records no token, minus the products
// of tokens that already trade: the watchlist rule's own exclusions (the
// bridge / staking / CEX categories, version-marked names, wrapped or staked
// names, exchange prefixes) plus the categories the same rule describes in
// words — cross-chain bridges, stablecoin wrappers and restaking products.
// A protocol the house's watchlist itself keeps is always ranked: the list
// is the floor. (Saturn is the proof the override is needed — DefiLlama
// files it under Stablecoin Wrapper, and the house watchlists it anyway.)

const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Restaking',
  'Stablecoin Wrapper',
]);

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export function isProductOfTradedToken(p: ProtocolRec): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (/\s(V2|v2|2\.0|V3|v3|3\.0)$/.test(p.name)) return true;
  if (/\b(wrapped|staked|staking|restaking)\b/i.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x));
}

// ---------------------------------------------------------------- the fit

interface CompWork extends CompRow {
  lt: number;
  lm: number;
  lmult: number;
  listedAt: string | null;
}

function fitCurve(comps: CompWork[]): { a: number; b: number; r2: number; offsets: Map<string, number> } {
  const { a, b, r2 } = ols(comps.map((c) => c.lt), comps.map((c) => c.lm));
  const byCat = new Map<string, number[]>();
  for (const c of comps) {
    const key = c.category ?? '';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(c.lm - (a + b * c.lt));
  }
  const offsets = new Map<string, number>();
  for (const [cat, res] of byCat) {
    const mean = res.reduce((s, x) => s + x, 0) / res.length;
    offsets.set(cat, mean * (res.length / (res.length + 15)));
  }
  return { a, b, r2, offsets };
}

function predictLog(fit: { a: number; b: number; offsets: Map<string, number> }, lt: number, category: string | null): number {
  return fit.a + fit.b * lt + (fit.offsets.get(category ?? '') ?? 0);
}

function looErrors(comps: CompWork[], mode: 'median' | 'curve'): number[] {
  const errs: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const p = comps[i];
    let pred: number;
    if (mode === 'median') {
      const peers = train.filter((q) => q.category === p.category).map((q) => q.lmult);
      const m = peers.length ? median(peers) : median(train.map((q) => q.lmult));
      pred = p.lt + m;
    } else {
      pred = predictLog(fitCurve(train), p.lt, p.category);
    }
    errs.push(pred - p.lm);
  }
  return errs;
}

function statsOf(errs: number[]): ModelStats {
  const ae = errs.map((e) => Math.abs(e)).sort((x, y) => x - y);
  return {
    medianFactor: Math.pow(10, median(ae)),
    meanLogError: ae.reduce((s, x) => s + x, 0) / ae.length,
    within2Pct: (ae.filter((e) => e <= log10(2)).length / ae.length) * 100,
  };
}

function splitMedianFactor(comps: CompWork[], mode: 'median' | 'curve'): number {
  const dated = comps.filter((c) => c.listedAt !== null).sort((x, y) => (x.listedAt! < y.listedAt! ? -1 : 1));
  const half = Math.floor(dated.length / 2);
  const train = dated.slice(0, half);
  const test = dated.slice(half);
  const fit = mode === 'curve' ? fitCurve(train) : null;
  const errs = test.map((p) => {
    let pred: number;
    if (mode === 'median') {
      const peers = train.filter((q) => q.category === p.category).map((q) => q.lmult);
      const m = peers.length ? median(peers) : median(train.map((q) => q.lmult));
      pred = p.lt + m;
    } else {
      pred = predictLog(fit!, p.lt, p.category);
    }
    return Math.abs(pred - p.lm);
  });
  return Math.pow(10, median(errs));
}

// -------------------------------------------------------------- farm plans

type GroupKey = 'curator' | 'lending' | 'dex' | 'yield' | 'perps' | 'rwa' | 'basis' | 'direct';

const GROUP_OF: Record<string, GroupKey> = {
  'Risk Curators': 'curator',
  'Onchain Capital Allocator': 'curator',
  'Collateral Markets': 'curator',
  'CDP Manager': 'curator',
  'Lending': 'lending',
  'Uncollateralized Lending': 'lending',
  'CDP': 'lending',
  'Dexs': 'dex',
  'Liquidity Manager': 'dex',
  'Yield': 'yield',
  'Yield Aggregator': 'yield',
  'Farm': 'yield',
  'Leveraged Farming': 'yield',
  'Derivatives': 'perps',
  'Interest Rate Derivatives': 'perps',
  'Options Vault': 'perps',
  'RWA': 'rwa',
  'Basis Trading': 'basis',
  'Dual-Token Stablecoin': 'basis',
  'CeDeFi': 'basis',
};

const MECHANISM: Record<GroupKey, string> = {
  curator: 'curated vault deposits — the curator allocates depositor funds across lending markets',
  lending: 'interest from borrowers — suppliers earn the supply side of a money market',
  dex: 'trading fees — liquidity providers and active traders split the swap flow',
  yield: 'vault yield — deposits are routed into yield-bearing positions',
  perps: 'trading fees and funding — the venue earns from leveraged flow',
  rwa: 'real-world asset yield — on-chain tickets into off-chain income',
  basis: 'funding and basis — the protocol holds the hedged side of a trade',
  direct: 'product usage — fees and activity on the protocol itself',
};

const CORE_STEPS: Record<GroupKey, [string, number, number][]> = {
  curator: [
    ['Deposit a stablecoin the vault accepts into the largest curated vault and keep the receipt token in the same wallet', 3.5, 0.5],
    ['Split a second deposit across the vault\'s other markets so activity is not riding on one allocation', 3.5, 0.5],
    ['Rebalance monthly toward the market the curator is growing, and log every move with its date', 2.0, 0.25],
  ],
  lending: [
    ['Supply a major stablecoin or ETH to the main market and leave the supply position open', 3.0, 0.5],
    ['Borrow a small amount against the supply, repay it within the week, and repeat monthly to build a borrower record', 4.0, 0.75],
    ['Add a second collateral asset the market lists so the account shows more than one kind of use', 3.0, 0.5],
  ],
  dex: [
    ['Provide liquidity to the deepest pair inside a tight range and keep the position open across weekly snapshots', 4.5, 0.75],
    ['Route a real swap through the venue each week rather than wash trades, sized to normal use', 1.5, 0.25],
    ['Claim and re-deposit any fee or reward balance the venue issues so the account compounds', 1.0, 0.25],
  ],
  yield: [
    ['Deposit into the flagship vault and hold the vault share token without wrapping it further', 3.0, 0.5],
    ['Rotate a smaller deposit into the newest strategy vault when it opens, keeping the flagship position intact', 3.0, 0.5],
    ['Harvest and re-deposit rewards on a fixed weekly day so the activity record is regular', 1.5, 0.25],
  ],
  perps: [
    ['Open and close modest hedged positions each week, sized like a user rather than a bot', 5.0, 1.0],
    ['Post margin in the venue\'s main collateral asset and leave a resting balance between sessions', 2.0, 0.25],
    ['Use one advanced order type the venue offers (stop or limit) so the account is not market-orders only', 1.0, 0.25],
  ],
  rwa: [
    ['Complete the onboarding the asset requires and make the smallest investment the ticket allows', 6.0, 1.5],
    ['Hold the position through at least one full yield distribution instead of flipping the ticket', 0.5, 0.1],
    ['Add a second asset from a different issuer on the platform when the first distribution lands', 6.0, 0.75],
  ],
  basis: [
    ['Mint or deposit into the basis position with a stablecoin and keep the position token in wallet', 3.5, 0.5],
    ['Hold through a full funding cycle, then add a smaller second tranche on a different day', 3.5, 0.5],
    ['Redeem a small slice once and re-enter, so the account shows both directions of the flow', 3.5, 0.5],
  ],
  direct: [
    ['Use the product for its main job once a week — the transaction it exists to record', 2.5, 0.5],
    ['Hold whatever balance or position the product issues instead of withdrawing after each use', 1.0, 0.25],
    ['Try the product\'s second feature (a second market, chain or mode) so usage is not one-dimensional', 2.5, 0.5],
  ],
};

function money(x: number): string {
  if (x >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
  if (x >= 1e6) return '$' + (x / 1e6).toFixed(1) + 'M';
  if (x >= 1e3) return '$' + (x / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(x).toString();
}

function planVerdict(netLowUsd: number, costSharePct: number): string {
  return netLowUsd <= 0 ? 'Skip' : costSharePct <= 0.001 ? 'Farm' : costSharePct <= 0.01 ? 'Thin' : 'Skip';
}

function buildPlan(
  p: ProtocolRec,
  ctx: { bandLowUsd: number; watchOuts: string[] },
): { steps: string[]; costUsd: number; hours: number; netLowUsd: number; verdict: string } {
  const group = GROUP_OF[p.category ?? ''] ?? 'direct';
  const chain = p.chains[0] ?? 'its main chain';
  const steps: string[] = [];
  let cost = 0;
  let hours = 0;
  const add = (text: string, c: number, h: number): void => {
    steps.push(text);
    cost += c;
    hours += h;
  };
  add(
    `Set up a fresh wallet for ${p.name} alone, fund it on ${chain}, and keep a dated log of every transaction — one wallet per protocol keeps any future eligibility check clean. Cost $0 in fees, about 15 minutes.`,
    0,
    0.25,
  );
  for (const [text, c, h] of CORE_STEPS[group]) {
    add(`${text}. Cost about $${c.toFixed(2)} in gas and fees, about ${h}h of attention.`, c, h);
  }
  add(
    `Size every position against the protocol's own scale: ${p.name} holds ${money(p.tvl_usd)} of TVL, so a four-figure position is ordinary user size — do not ape in more than the activity is worth. Cost $0, about 10 minutes of planning.`,
    0,
    0.2,
  );
  add(
    `Return on a fixed weekly slot for one genuine interaction (about $1.50 in gas, 15 minutes) — a steady record across months is what launch snapshots usually reward, not one big week.`,
    1.5,
    0.25,
  );
  const risk = ctx.watchOuts.length
    ? `Watch-outs before adding more: ${ctx.watchOuts[0].toLowerCase()}. Re-check the TVL trend monthly and stop adding if it falls for three straight checks. Cost $0, about 15 minutes a month.`
    : `Re-check the position monthly against the protocol's TVL trend and stop adding if TVL falls for three straight checks. Cost $0, about 15 minutes a month.`;
  add(risk, 0, 0.25);
  const netLow = Math.round(ctx.bandLowUsd - cost);
  const sharePct = ctx.bandLowUsd > 0 ? (cost / ctx.bandLowUsd) * 100 : 100;
  const verdict = planVerdict(netLow, sharePct);
  add(
    `Verdict — ${verdict}: the whole plan costs about $${cost.toFixed(2)} and ${hours.toFixed(1)}h against a band-low implied value of ${money(ctx.bandLowUsd)} for ${p.name}; netted at the low end the plan carries ${money(Math.max(netLow, 0))} of headroom, and the cost is ${sharePct.toFixed(3)}% of that low end.`,
    0,
    0,
  );
  return { steps, costUsd: Math.round(cost * 100) / 100, hours: Math.round(hours * 10) / 10, netLowUsd: netLow, verdict };
}

// ------------------------------------------------------------------ build

export function buildRadar(snapshot: Snapshot): RadarData {
  const protocols = snapshot.protocols;
  const watch = new Set(snapshot.watchlist);
  const asOf = snapshot.as_of;

  const tokenRecording = protocols.filter((p) => p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null);
  const pricedAll = protocols.filter((p) => p.mcap_usd !== null);
  const usable = protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const comps: CompWork[] = usable.map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    tvlUsd: p.tvl_usd,
    mcapUsd: p.mcap_usd!,
    multiple: p.mcap_usd! / p.tvl_usd,
    fittedMultiple: 0,
    residualFactor: 0,
    lt: log10(p.tvl_usd),
    lm: log10(p.mcap_usd!),
    lmult: log10(p.mcap_usd! / p.tvl_usd),
    listedAt: p.listed_at,
  }));

  const fit = fitCurve(comps);
  for (const c of comps) {
    const fitted = Math.pow(10, predictLog(fit, c.lt, c.category));
    c.fittedMultiple = fitted / c.tvlUsd;
    c.residualFactor = c.mcapUsd / fitted;
  }
  comps.sort((x, y) => y.tvlUsd - x.tvlUsd);

  const oldErr = looErrors(comps, 'median');
  const newErr = looErrors(comps, 'curve');
  const newSorted = [...newErr].sort((x, y) => x - y);
  const bandLowFactor = Math.pow(10, quantile(newSorted, 0.25));
  const bandHighFactor = Math.pow(10, quantile(newSorted, 0.75));

  const catMedian = new Map<string, number>();
  const catCount = new Map<string, number>();
  for (const c of comps) {
    const key = c.category ?? '';
    if (!catMedian.has(key)) {
      const peers = comps.filter((q) => (q.category ?? '') === key);
      catMedian.set(key, median(peers.map((q) => q.multiple)));
      catCount.set(key, peers.length);
    }
  }

  const board = protocols.filter(
    (p) => p.gecko_id === null && p.symbol === null && (watch.has(p.slug) || !isProductOfTradedToken(p)),
  );
  const setAside = protocols.filter((p) => p.gecko_id === null && p.symbol === null).length - board.length;

  const rows: BoardRow[] = board.map((p) => {
    const lt = log10(p.tvl_usd);
    const offset = fit.offsets.get(p.category ?? '') ?? 0;
    const implied = Math.max(1, Math.round(Math.pow(10, fit.a + fit.b * lt + offset)));
    const bandLow = Math.max(1, Math.round(implied * bandLowFactor));
    const bandHigh = Math.round(implied * bandHighFactor);
    const ageDays = p.listed_at ? daysBetween(p.listed_at, asOf) : null;
    const watchOuts: string[] = [];
    if (p.change_7d !== null && p.change_7d <= -10) watchOuts.push(`TVL down ${Math.abs(p.change_7d).toFixed(1)}% in 7 days`);
    if (p.change_7d === null) watchOuts.push('7-day TVL change unreported');
    if (ageDays !== null && ageDays < 90) watchOuts.push(`Listed only ${ageDays} days ago — a thin record`);
    if ((catCount.get(p.category ?? '') ?? 0) < 3) {
      const n = catCount.get(p.category ?? '') ?? 0;
      watchOuts.push(`Category offset rests on ${n} priced peer${n === 1 ? '' : 's'} — shrunk toward the curve`);
    }
    if (p.chains.length === 1) watchOuts.push('Runs on a single chain');
    let signal: string;
    if (watch.has(p.slug)) signal = 'On the watchlist';
    else if (p.change_7d !== null && p.change_7d >= 15) signal = `Surging — TVL +${p.change_7d.toFixed(1)}% in 7d`;
    else if (ageDays !== null && ageDays < 90) signal = `New — listed ${ageDays}d ago`;
    else if (ageDays !== null && ageDays >= 730) signal = `Token-free for ${(ageDays / 365).toFixed(1)} years`;
    else if (ageDays !== null) signal = `Token-free for ${ageDays} days`;
    else signal = 'Records no token';
    const plan = buildPlan(p, { bandLowUsd: bandLow, watchOuts });
    return {
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvlUsd: p.tvl_usd,
      change7d: p.change_7d,
      listedAt: p.listed_at,
      ageDays,
      watchlist: watch.has(p.slug),
      rank: 0,
      impliedValueUsd: implied,
      bandLowUsd: bandLow,
      bandHighUsd: bandHigh,
      curveMultiple: Math.pow(10, fit.a + fit.b * lt) / p.tvl_usd,
      categoryOffsetLog: offset,
      categoryMedianMultiple: catMedian.get(p.category ?? '') ?? null,
      categoryRank: 0,
      categoryCount: 0,
      signal,
      watchOuts,
      farmSteps: plan.steps,
      planCostUsd: plan.costUsd,
      planHours: plan.hours,
      netLowUsd: plan.netLowUsd,
      verdict: plan.verdict,
    };
  });

  rows.sort((x, y) => y.impliedValueUsd - x.impliedValueUsd || y.tvlUsd - x.tvlUsd || (x.slug < y.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  const byCatRows = new Map<string, BoardRow[]>();
  for (const r of rows) {
    const key = r.category ?? '';
    if (!byCatRows.has(key)) byCatRows.set(key, []);
    byCatRows.get(key)!.push(r);
  }
  for (const list of byCatRows.values()) {
    list.forEach((r, i) => {
      r.categoryRank = i + 1;
      r.categoryCount = list.length;
    });
  }

  const curveTable = [5e6, 1e7, 5e7, 1e8, 1e9].map((tvl) => ({
    tvlUsd: tvl,
    multiple: Math.pow(10, fit.a + fit.b * log10(tvl)) / tvl,
  }));

  const categoryStats = [...catMedian.entries()]
    .map(([category, med]) => ({
      category,
      comps: catCount.get(category) ?? 0,
      medianMultiple: med,
      offsetLog: fit.offsets.get(category) ?? 0,
    }))
    .sort((x, y) => y.comps - x.comps);

  return {
    version: MODEL_VERSION,
    asOf,
    floorUsd: snapshot.floor_usd,
    census: {
      universe: protocols.length,
      ranked: rows.length,
      setAside,
      tokenRecording: tokenRecording.length,
      pricedUsable: comps.length,
      pricedDead: pricedAll.length - comps.length,
      pricedNone: tokenRecording.length - pricedAll.length,
    },
    fit: {
      intercept: fit.a,
      slope: fit.b,
      r2: fit.r2,
      compCount: comps.length,
      marketMedianMultiple: median(comps.map((c) => c.multiple)),
    },
    curveTable,
    backtest: {
      n: comps.length,
      oldLoo: statsOf(oldErr),
      newLoo: statsOf(newErr),
      oldSplitMedianFactor: splitMedianFactor(comps, 'median'),
      newSplitMedianFactor: splitMedianFactor(comps, 'curve'),
      bandLowFactor,
      bandHighFactor,
    },
    categoryStats,
    rows,
    comps: comps.map((c) => ({
      slug: c.slug,
      name: c.name,
      category: c.category,
      tvlUsd: c.tvlUsd,
      mcapUsd: c.mcapUsd,
      multiple: c.multiple,
      fittedMultiple: c.fittedMultiple,
      residualFactor: c.residualFactor,
    })),
  };
}
