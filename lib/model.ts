// Token launch radar — the model (radar-4).
//
// Everything on the board is derived from the sealed snapshot's own figures:
// a protocol's TVL, its seven-day growth, how long it has run with no token on
// record, and what the market already pays for a token in its category. No
// protocol name is ever special-cased and no number is hardcoded: the same
// functions score every row, and the dashboard recomputes each row from the
// figures the row itself carries, so the page and the board cannot drift.
//
// radar-4 adds the evidence radar-3 only asserted: the model is tested out of
// sample (leave-one-out and a time-split backtest on the priced live tokens),
// every implied value carries the peer-spread band its own category supports,
// and every farm plan is netted to the dollar. The ranking and the model
// arithmetic are unchanged — the 198 rows, their order and their implied
// values are identical to radar-3; the gap was evidence, not formula.

export interface Protocol {
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
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'radar-4';

// The model's constants, in one place. The dashboard prints these so a reader
// can recompute any row by hand.
export const MODEL = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  peer_prior_weight: 5,
  peer_min_peers: 3,
  peer_min: 0.05,
  peer_max: 1,
};

const round4 = (x: number): number => Math.round(x * 10000) / 10000;
const round2 = (x: number): number => Math.round(x * 100) / 100;
const round1 = (x: number): number => Math.round(x * 10) / 10;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// The p-th percentile of a sorted array, by nearest rank; deterministic.
function percentileOf(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

// Categories are DefiLlama's; a protocol with none groups under 'Other'.
export function categoryOf(p: Protocol): string {
  return p.category ?? 'Other';
}

// Whole days between the day DefiLlama began tracking the protocol and the
// snapshot's own date; null when the snapshot carries no listing day.
export function ageInDays(p: Protocol, asOfMs: number): number | null {
  if (p.listed_at === null) return null;
  const listedMs = Date.parse(`${p.listed_at}T00:00:00Z`);
  if (Number.isNaN(listedMs)) return null;
  return Math.round((asOfMs - listedMs) / 86400000);
}

// A protocol records a token when DefiLlama's record carries an id or a symbol
// for it. Recording none is not proof it has none — the wording matters.
export function recordsToken(p: Protocol): boolean {
  return !(p.gecko_id === null && p.symbol === null);
}

export function isPriced(p: Protocol): boolean {
  return p.mcap_usd !== null;
}

// A priced token the backtest can actually score: a positive market cap and a
// positive TVL, so the log of predicted over actual is defined. Sixteen of
// the 144 priced tokens record a market cap of $0 or -$1 — no usable price —
// and are excluded from the backtest and the bands, never silently.
export function isUsableComp(p: Protocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

// The usable multiples per category: every protocol with a usable price
// (positive market cap, positive TVL), grouped by category, each list sorted
// ascending. buildBacktest and peerBandFor share this one list.
function usableMultiplesByCategory(snapshot: Snapshot): Map<string, number[]> {
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols.filter(isUsableComp)) {
    const arr = byCategory.get(categoryOf(p)) ?? [];
    arr.push((p.mcap_usd as number) / p.tvl_usd);
    byCategory.set(categoryOf(p), arr);
  }
  for (const arr of byCategory.values()) arr.sort((a, b) => a - b);
  return byCategory;
}

// The board's rule, the watchlist's own product rule without its TVL floor: a
// protocol that records no token, in a category that is not itself a product
// of a traded token, whose name carries no version marker, no whole word
// wrapped / staked / staking, and no exchange's name at its head.
const PRODUCT_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_MARKER = /\s(?:V\d|v\d|\d+\.\d+)/;
const WRAPPED_WORD = /\b(?:wrapped|staked|staking)\b/i;

export function isRankable(p: Protocol): boolean {
  if (recordsToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSION_MARKER.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

// --- Peer multiples -------------------------------------------------------
// The benchmark set: every protocol that records a token with a market cap.
// Its multiple is what the market pays per dollar of its TVL.

export interface PeerStat {
  category: string;
  peers: number;
  peerMedian: number | null; // full precision; rounded only for display
  multiple: number; // the multiple the model uses, rounded to 4 places
}

export interface PeerTable {
  marketMedian: number; // full precision
  marketMedianRounded: number;
  byCategory: Map<string, PeerStat>;
  ordered: PeerStat[]; // every snapshot category, name order
}

export function buildPeerTable(snapshot: Snapshot): PeerTable {
  const multiplesByCategory = new Map<string, number[]>();
  const allMultiples: number[] = [];
  for (const p of snapshot.protocols) {
    if (!isPriced(p)) continue;
    const m = (p.mcap_usd as number) / p.tvl_usd;
    allMultiples.push(m);
    const cat = categoryOf(p);
    const arr = multiplesByCategory.get(cat);
    if (arr) arr.push(m);
    else multiplesByCategory.set(cat, [m]);
  }
  const marketMedian = medianOf(allMultiples);

  const categories = new Set<string>();
  for (const p of snapshot.protocols) categories.add(categoryOf(p));

  const byCategory = new Map<string, PeerStat>();
  const ordered: PeerStat[] = [];
  for (const category of [...categories].sort()) {
    const arr = multiplesByCategory.get(category) ?? [];
    const peerMedian = arr.length > 0 ? medianOf(arr) : null;
    let raw: number;
    if (peerMedian === null || arr.length < MODEL.peer_min_peers) {
      // Too few priced peers to speak for the category: the market speaks.
      raw = marketMedian;
    } else {
      const shrunk =
        (peerMedian * arr.length + marketMedian * MODEL.peer_prior_weight) /
        (arr.length + MODEL.peer_prior_weight);
      raw = clamp(shrunk, MODEL.peer_min, MODEL.peer_max);
    }
    const stat: PeerStat = { category, peers: arr.length, peerMedian, multiple: round4(raw) };
    byCategory.set(category, stat);
    ordered.push(stat);
  }
  return { marketMedian, marketMedianRounded: round4(marketMedian), byCategory, ordered };
}

// --- Out-of-sample backtest -----------------------------------------------
// The model is tested, not just fitted. Both tests predict a priced live
// token's market cap with the model's own formula, from peers the test token
// never entered: leave-one-out (fit on the other 127, predict the one held
// out) and a time split (fit on the older half by listing day plus the
// undated, predict the newer half). The headline is the median ratio —
// whether the model sits at the centre of what the market pays — and the
// median absolute error, because live multiples inside one category span an
// order of magnitude and no TVL-based value can be precise about one token.

export interface BacktestSplit {
  n: number;
  median_ratio: number;
  median_factor: number;
  within_2x_pct: number;
  within_3x_pct: number;
}

export interface BacktestResult {
  usable: number;
  excluded: number;
  loo: BacktestSplit;
  time_split: BacktestSplit & { train: number; test: number; cutoff: string };
  median_category_spread: number; // median IQR spread (q75/q25) across categories with >=5 usable peers
}

// The fitted multiple for a category given a peer set, by the model's own
// rule: the peers' median, shrunk toward the market median, clamped.
function fittedMultiple(catMultiples: number[], marketMedian: number): number {
  if (catMultiples.length === 0 || catMultiples.length < MODEL.peer_min_peers) return round4(marketMedian);
  const peerMedian = medianOf(catMultiples);
  const shrunk =
    (peerMedian * catMultiples.length + marketMedian * MODEL.peer_prior_weight) /
    (catMultiples.length + MODEL.peer_prior_weight);
  return round4(clamp(shrunk, MODEL.peer_min, MODEL.peer_max));
}

function predictComp(p: Protocol, asOfMs: number, multiple: number): number {
  const age = ageInDays(p, asOfMs);
  return Math.max(1, Math.round(p.tvl_usd * multiple * growthMultiplier(p.change_7d) * maturityMultiplier(age)));
}

function summariseErrors(logErrors: number[]): BacktestSplit {
  const n = logErrors.length;
  const medianRatio = round2(Math.exp(medianOf(logErrors)));
  const medianFactor = round2(Math.exp(medianOf(logErrors.map((e) => Math.abs(e)))));
  const within = (k: number): number =>
    round1((logErrors.filter((e) => Math.abs(e) <= Math.log(k)).length / n) * 100);
  return { n, median_ratio: medianRatio, median_factor: medianFactor, within_2x_pct: within(2), within_3x_pct: within(3) };
}

export function buildBacktest(snapshot: Snapshot): BacktestResult {
  const asOfMs = Date.parse(`${snapshot.as_of}T00:00:00Z`);
  const usable = snapshot.protocols.filter(isUsableComp);
  const excluded = snapshot.protocols.filter(isPriced).length - usable.length;

  // Leave-one-out over the usable comps.
  const looErrors: number[] = [];
  for (const p of usable) {
    const rest = usable.filter((q) => q !== p);
    const marketMedian = medianOf(rest.map((q) => (q.mcap_usd as number) / q.tvl_usd));
    const catRest = rest
      .filter((q) => categoryOf(q) === categoryOf(p))
      .map((q) => (q.mcap_usd as number) / q.tvl_usd);
    const multiple = fittedMultiple(catRest, marketMedian);
    looErrors.push(Math.log(predictComp(p, asOfMs, multiple) / (p.mcap_usd as number)));
  }
  const loo = summariseErrors(looErrors);

  // Time split: older half by listing day (plus the undated) trains, the
  // newer half is predicted. The cut is the median listing day.
  const dated = usable.filter((p) => p.listed_at !== null).sort((a, b) => ((a.listed_at as string) < (b.listed_at as string) ? -1 : 1));
  const undated = usable.filter((p) => p.listed_at === null);
  const half = Math.floor(dated.length / 2);
  const train = [...dated.slice(0, half), ...undated];
  const test = dated.slice(half);
  const cutoff = dated[half].listed_at as string;
  const trainMarketMedian = medianOf(train.map((q) => (q.mcap_usd as number) / q.tvl_usd));
  const splitErrors: number[] = [];
  for (const p of test) {
    const catTrain = train
      .filter((q) => categoryOf(q) === categoryOf(p))
      .map((q) => (q.mcap_usd as number) / q.tvl_usd);
    const multiple = fittedMultiple(catTrain, trainMarketMedian);
    splitErrors.push(Math.log(predictComp(p, asOfMs, multiple) / (p.mcap_usd as number)));
  }
  const split = summariseErrors(splitErrors);

  // How wide live multiples sit inside one category: the median, across
  // categories with at least five usable peers, of (75th percentile /
  // 25th percentile). This is the dispersion the backtest's error inherits.
  const byCategory = usableMultiplesByCategory(snapshot);
  const spreads: number[] = [];
  for (const arr of byCategory.values()) {
    if (arr.length < 5) continue;
    const sorted = [...arr].sort((a, b) => a - b);
    spreads.push(percentileOf(sorted, 0.75) / Math.max(1e-9, percentileOf(sorted, 0.25)));
  }
  const medianCategorySpread = round1(medianOf(spreads));

  return {
    usable: usable.length,
    excluded,
    loo,
    time_split: { ...split, train: train.length, test: test.length, cutoff },
    median_category_spread: medianCategorySpread,
  };
}

// --- The peer-spread band -------------------------------------------------
// An implied value is a central estimate; the band is what the live tokens
// in its own category actually trade at. For each row the band is the middle
// 50% of its category's usable peer multiples (25th to 75th percentile),
// the market's own quartiles when the category has fewer than three usable
// peers, carried through the same growth and maturity factors. It is wide
// because live multiples are wide — the band says so instead of hiding it.

export interface PeerBand {
  lo_usd: number;
  hi_usd: number;
  lo_multiple: number;
  hi_multiple: number;
  peers: number;
  fallback: boolean;
}

export function peerBandFor(
  category: string,
  tvlUsd: number,
  growthMultiplierValue: number,
  maturityMultiplierValue: number,
  snapshot: Snapshot,
): PeerBand {
  const byCategory = usableMultiplesByCategory(snapshot);
  const catMultiples = byCategory.get(category) ?? [];
  const fallback = catMultiples.length < MODEL.peer_min_peers;
  const pool = fallback
    ? [...byCategory.values()].flat().sort((a, b) => a - b)
    : catMultiples;
  const loMultiple = round4(percentileOf(pool, 0.25));
  const hiMultiple = round4(percentileOf(pool, 0.75));
  const factor = growthMultiplierValue * maturityMultiplierValue;
  return {
    lo_usd: Math.max(1, Math.round(tvlUsd * loMultiple * factor)),
    hi_usd: Math.max(1, Math.round(tvlUsd * hiMultiple * factor)),
    lo_multiple: loMultiple,
    hi_multiple: hiMultiple,
    peers: catMultiples.length,
    fallback,
  };
}

// --- The value model ------------------------------------------------------

export interface RowModel {
  peer_multiple: number;
  base_value_usd: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
}

export function growthMultiplier(change7d: number | null): number {
  const g = clamp(change7d ?? 0, MODEL.growth_floor, MODEL.growth_cap);
  return 1 + (g / 100) * MODEL.growth_weight;
}

export function maturityMultiplier(ageDays: number | null): number {
  const age = ageDays ?? MODEL.unknown_age_days;
  return MODEL.maturity_floor + (Math.min(Math.max(age, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
}

// Score one protocol. The multiple is the category's rounded peer multiple —
// the very number the dashboard prints — so a reader's recomputation lands on
// the board's figure exactly.
export function scoreRow(p: Protocol, asOfMs: number, peers: PeerTable): { model: RowModel; implied: number } {
  const stat = peers.byCategory.get(categoryOf(p));
  const multiple = stat ? stat.multiple : peers.marketMedianRounded;
  const age = ageInDays(p, asOfMs);
  const growth = growthMultiplier(p.change_7d);
  const maturity = maturityMultiplier(age);
  const base = Math.round(p.tvl_usd * multiple);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growth * maturity));
  return {
    implied,
    model: {
      peer_multiple: multiple,
      base_value_usd: base,
      growth_pct: clamp(p.change_7d ?? 0, MODEL.growth_floor, MODEL.growth_cap),
      growth_multiplier: round4(growth),
      maturity_multiplier: round4(maturity),
      age_days: age,
    },
  };
}

// --- Farm plans -----------------------------------------------------------
// Eight steps per protocol. The two protocol-specific steps follow its
// category; the capital follows its TVL and the hold its age. Every step
// carries what it costs and how long it takes.

export function capitalFor(p: Protocol): number {
  if (p.tvl_usd >= 5e9) return 250;
  if (p.tvl_usd >= 1e9) return 150;
  if (p.tvl_usd >= 1e8) return 100;
  return 50;
}

export function holdDaysFor(ageDays: number | null): number {
  if (ageDays === null) return 30;
  if (ageDays < 180) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

// The plan's whole cost in dollars: the capital the steps lock plus the gas
// the steps spend. The page nets every plan against its implied value with
// this number, so the net is the same derivation on both sides.
export function planCostUsd(p: Protocol): number {
  const capital = capitalFor(p);
  const gas = capital >= 150 ? 8 : 4;
  const halfGas = Math.max(2, Math.round(gas / 2));
  const totalGas = 3 + gas + halfGas + 2;
  return capital + totalGas;
}

export function planGasUsd(p: Protocol): number {
  const capital = capitalFor(p);
  const gas = capital >= 150 ? 8 : 4;
  const halfGas = Math.max(2, Math.round(gas / 2));
  return 3 + gas + halfGas + 2;
}

// How this protocol earns — one line per plan, from its category alone, the
// snapshot's own field. It names the mechanism the farm steps are built
// around (the fees, the yield, the interest), never an invented figure: a
// category the map does not name earns from the fees its users pay to use it.
export function mechanismFor(p: Protocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `${name} earns from the interest borrowers pay on the loans it issues.`;
  if (c.includes('dex'))
    return `${name} earns from the trading fees on every swap through its pools.`;
  if (c.includes('yield'))
    return `${name} earns from the yield its vaults harvest and the fees they charge on it.`;
  if (c.includes('bridge'))
    return `${name} earns from the fees on every transfer it bridges between chains.`;
  if (c.includes('staking') || c.includes('restak'))
    return `${name} earns from staking rewards and the commission it takes on them.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis'))
    return `${name} earns from trading fees and funding payments on its markets.`;
  if (c.includes('prediction'))
    return `${name} earns from the fees on every market it settles.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `${name} earns from the fees on the capital its vaults allocate.`;
  if (c.includes('stable'))
    return `${name} earns from the yield on the reserves behind its stable asset.`;
  if (c.includes('rwa'))
    return `${name} earns from the yield on the real-world assets it tokenizes.`;
  if (c.includes('insurance'))
    return `${name} earns from the premiums on the cover it sells.`;
  if (c.includes('chain'))
    return `${name} earns from the gas and the fees of the chain it runs.`;
  if (c.includes('farm'))
    return `${name} earns from the fees on the farms it runs.`;
  if (c.includes('index'))
    return `${name} earns from the management fee on its index.`;
  if (c.includes('payment') || c.includes('card'))
    return `${name} earns from the fees on the payments it processes.`;
  if (c.includes('otc'))
    return `${name} earns from the spread on the orders it settles.`;
  if (c.includes('governance'))
    return `${name} earns from the fees of the protocol its governance steers.`;
  if (c.includes('btc') || c.includes('anchor'))
    return `${name} earns from the yield on the BTC-backed value it holds.`;
  return `${name} earns from the fees its users pay to use it.`;
}

function chainOf(p: Protocol): string {
  return p.chains.length > 0 ? p.chains[0] : 'its main chain';
}

function openingAction(p: Protocol, capital: number): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const chain = chainOf(p);
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex'))
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield'))
    return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${name} and use it in one app built on the chain.`;
  if (c.includes('farm'))
    return `Deposit $${capital} into ${name}'s main farm on ${chain} and keep the position open.`;
  if (c.includes('index'))
    return `Buy $${capital} of ${name}'s index token on ${chain} and hold it through the next rebalance.`;
  if (c.includes('payment') || c.includes('card'))
    return `Spend $${capital} through ${name} on ${chain} and keep the receipt in the app.`;
  if (c.includes('otc')) return `Open one $${capital} order on ${name} and settle it through the protocol.`;
  if (c.includes('governance'))
    return `Lock $${capital} of voting power with ${name} on ${chain} and cast one vote.`;
  if (c.includes('btc') || c.includes('anchor'))
    return `Deposit $${capital} of BTC-backed value into ${name} on ${chain} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

function secondAction(p: Protocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const chain = chainOf(p);
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Borrow a small amount against the supply on ${name} and repay it within the week.`;
  if (c.includes('dex'))
    return `Swap a small amount through ${name}'s main pool on ${chain} so the wallet shows trading activity.`;
  if (c.includes('yield'))
    return `Harvest the vault's rewards on ${name} once a week and restake them instead of selling.`;
  if (c.includes('bridge'))
    return `Bridge a small amount back through ${name} so the wallet shows activity in both directions.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis'))
    return `Close the hedge on ${name} and reopen it the next week so the wallet shows repeated use.`;
  if (c.includes('prediction'))
    return `Settle one market on ${name} and claim any winnings from the protocol's own page.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Read ${name}'s allocation report and top up the vault by a small amount when it changes.`;
  if (c.includes('rwa'))
    return `Claim the yield the position earned on ${name} and leave the principal working.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Claim the staking rewards on ${name} once a week and restake them.`;
  if (c.includes('stable')) return `Use the stable asset in one lending pool on ${chain} through ${name}.`;
  if (c.includes('insurance'))
    return `Check the policy's coverage on ${name} once a week and renew it before it lapses.`;
  if (c.includes('index')) return `Check ${name}'s rebalance notice and hold the index through it.`;
  if (c.includes('governance'))
    return `Vote on one more proposal on ${name} so the wallet shows repeated governance activity.`;
  if (c.includes('btc') || c.includes('anchor'))
    return `Check the peg and the reserves ${name} publishes, and add a small amount while they hold.`;
  return `Use ${name} a second way — a swap, a vote or a claim — so the wallet shows more than one kind of activity.`;
}

function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

export function farmSteps(p: Protocol, ageDays: number | null): string[] {
  const capital = capitalFor(p);
  const gas = capital >= 150 ? 8 : 4;
  const hold = holdDaysFor(ageDays);
  const name = p.name;
  return [
    stepText(
      'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      'under $3 of gas for the first transaction',
      '5 minutes',
    ),
    stepText(openingAction(p, capital), `$${capital} of capital and about $${gas} of gas`, '15 minutes to set up'),
    stepText(secondAction(p), `about $${Math.max(2, Math.round(gas / 2))} of gas`, '10 minutes'),
    stepText(
      'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
      'about $2 of gas a week',
      '10 minutes a week',
    ),
    stepText(
      `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
    stepText(
      `Follow ${name}'s own announcements for snapshot dates, and take part in any vote or campaign it runs.`,
      'no fee to read, gas only if you vote',
      '10 minutes a week',
    ),
    stepText(
      "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.",
      'no fee to check, and never pay to claim',
      '10 minutes',
    ),
    stepText(
      'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      'nothing but the log',
      '5 minutes',
    ),
  ];
}

// --- The board --------------------------------------------------------------

export interface BoardRow {
  rank: number;
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
  token_status: string;
  age_days: number | null;
  implied_value_usd: number;
  model: RowModel;
  farm_steps: string[];
}

export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const asOfMs = Date.parse(`${snapshot.as_of}T00:00:00Z`);
  const peers = buildPeerTable(snapshot);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => {
      const { model, implied } = scoreRow(p, asOfMs, peers);
      return { p, model, implied };
    })
    .sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map(({ p, model, implied }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    age_days: model.age_days,
    implied_value_usd: implied,
    model,
    farm_steps: farmSteps(p, model.age_days),
  }));
}

// The gate's shape, checked before anything is written: a problem returns a
// sentence naming it, a sound board returns null.
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const watchlist = new Set(snapshot.watchlist);
  const covered = new Set(board.map((r) => r.slug));
  for (const slug of watchlist) if (!covered.has(slug)) return `watchlist slug ${slug} is not on the board`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i];
    if (r.rank !== i + 1) return `row ${r.slug} carries rank ${r.rank}, expected ${i + 1}`;
    if (i > 0 && board[i - 1].implied_value_usd < r.implied_value_usd)
      return `implied value rises at rank ${r.rank}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12)
      return `row ${r.slug} holds ${r.farm_steps.length} farm steps, outside 3..12`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${r.slug} holds a farm step of ${t.length} characters`;
    }
  }
  return null;
}

// --- The dashboard's dataset ------------------------------------------------

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  base_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  category_rank: number;
  category_size: number;
  peer_count: number;
  value_lo_usd: number;
  value_hi_usd: number;
  band_lo_multiple: number;
  band_hi_multiple: number;
  band_peers: number;
  band_fallback: boolean;
  plan_cost_usd: number;
  plan_capital_usd: number;
  plan_gas_usd: number;
  plan_net_usd: number;
  mechanism: string;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  multiple: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: typeof MODEL;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  universe_size: number;
  aside_size: number;
  token_recorded_size: number;
  unpriced_size: number;
  peer_multiples: { category: string; multiple: number; peers: number; peer_median: number | null }[];
  market_median_multiple: number;
  backtest: BacktestResult;
  watchlistSlugs: string[];
  rows: RadarRow[];
  live: LiveRow[];
}

export function buildRadar(snapshot: Snapshot, board: BoardRow[]): RadarData {
  const peers = buildPeerTable(snapshot);
  const watchlist = new Set(snapshot.watchlist);

  // Rank and size within each category, counted in board order.
  const catSeen = new Map<string, number>();
  const catRank = new Map<string, number>();
  const catSize = new Map<string, number>();
  for (const r of board) catSize.set(r.category ?? 'Other', (catSize.get(r.category ?? 'Other') ?? 0) + 1);
  for (const r of board) {
    const cat = r.category ?? 'Other';
    const n = (catSeen.get(cat) ?? 0) + 1;
    catSeen.set(cat, n);
    catRank.set(r.slug, n);
  }

  const rows: RadarRow[] = board.map((r) => {
    const cat = r.category ?? 'Other';
    const stat = peers.byCategory.get(cat);
    const band = peerBandFor(cat, r.tvl_usd, r.model.growth_multiplier, r.model.maturity_multiplier, snapshot);
    const cost = planCostUsd({ tvl_usd: r.tvl_usd } as Protocol);
    const capital = capitalFor({ tvl_usd: r.tvl_usd } as Protocol);
    const gas = planGasUsd({ tvl_usd: r.tvl_usd } as Protocol);
    return {
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      mcap_usd: r.mcap_usd,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      peer_multiple: r.model.peer_multiple,
      base_value_usd: r.model.base_value_usd,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      category_rank: catRank.get(r.slug) ?? 0,
      category_size: catSize.get(cat) ?? 0,
      peer_count: stat ? stat.peers : 0,
      value_lo_usd: band.lo_usd,
      value_hi_usd: band.hi_usd,
      band_lo_multiple: band.lo_multiple,
      band_hi_multiple: band.hi_multiple,
      band_peers: band.peers,
      band_fallback: band.fallback,
      plan_cost_usd: cost,
      plan_capital_usd: capital,
      plan_gas_usd: gas,
      plan_net_usd: r.implied_value_usd - cost,
      mechanism: mechanismFor({ name: r.name, category: r.category } as Protocol),
    };
  });

  // The benchmark set, whole: every priced live token with the multiple the
  // market gives it, largest market cap first.
  const live: LiveRow[] = snapshot.protocols
    .filter(isPriced)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      change_7d: p.change_7d,
      multiple: round4((p.mcap_usd as number) / p.tvl_usd),
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));

  const noToken = snapshot.protocols.filter((p) => !recordsToken(p)).length;
  const recorded = snapshot.protocols.length - noToken;
  const priced = live.length;

  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watchlist.has(r.slug)).length,
    live_size: priced,
    universe_size: snapshot.protocols.length,
    aside_size: noToken - board.length,
    token_recorded_size: recorded,
    unpriced_size: recorded - priced,
    peer_multiples: peers.ordered.map((s) => ({
      category: s.category,
      multiple: s.multiple,
      peers: s.peers,
      peer_median: s.peerMedian === null ? null : round4(s.peerMedian),
    })),
    market_median_multiple: peers.marketMedianRounded,
    backtest: buildBacktest(snapshot),
    watchlistSlugs: [...snapshot.watchlist],
    rows,
    live,
  };
}

// The dataset as the page reads it: one script that sets window.RADAR.
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
