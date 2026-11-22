// farm.ts — what a reader should do about each row: a costed verdict and a
// concrete plan. Fees come from the row's own chains, the deposit from the
// reader's scenario, and the drop from the model's implied value; the same
// functions price the board, the stress column and the detail pages, so the
// page and board.json never disagree.

import type { Row, Built, Snapshot } from './model.ts';
import { breakdown } from './model.ts';

export interface Scenario { deposit: number; dropShare: number; weeks: number }
export const DEFAULT_SCENARIO: Scenario = { deposit: 10000, dropShare: 0.07, weeks: 12 };
export const WAGE = 25;      // dollars an hour of hands-on time is charged at
export const TBILL = 0.04;   // the risk-free alternative, per year

const GAS_TOKEN: Record<string, string> = {
  'Ethereum': 'ETH', 'Arbitrum': 'ETH', 'Base': 'ETH', 'Optimism': 'ETH', 'Linea': 'ETH',
  'Scroll': 'ETH', 'zkSync Era': 'ETH', 'Mantle': 'MNT', 'Blast': 'ETH', 'Mode': 'ETH',
  'Taiko': 'ETH', 'Ink': 'ETH', 'Unichain': 'ETH', 'Solana': 'SOL', 'Binance': 'BNB',
  'BSC': 'BNB', 'Tron': 'TRX', 'Avalanche': 'AVAX', 'Polygon': 'POL', 'Bitcoin': 'BTC',
  'Hyperliquid L1': 'HYPE', 'Sui': 'SUI', 'Monad': 'MON', 'Plasma': 'XPL', 'Fantom': 'FTM',
  'Gnosis': 'xDAI', 'Celo': 'CELO', 'Near': 'NEAR', 'Aptos': 'APT', 'Sei': 'SEI',
};
const OP_COST: Record<string, number> = {
  'Ethereum': 14, 'Bitcoin': 4, 'Tron': 1.2, 'Avalanche': 0.9, 'Binance': 0.5, 'BSC': 0.5,
  'Polygon': 0.15, 'Solana': 0.25, 'Hyperliquid L1': 0.1, 'Sui': 0.1,
};
const L2 = new Set(['Arbitrum', 'Base', 'Optimism', 'Linea', 'Scroll', 'zkSync Era', 'Blast', 'Mode', 'Taiko', 'Ink', 'Unichain', 'Mantle', 'Monad', 'Plasma']);

export function gasToken(chain: string): string { return GAS_TOKEN[chain] ?? 'its native gas token'; }
export function opCost(chain: string): number {
  if (OP_COST[chain] !== undefined) return OP_COST[chain];
  return L2.has(chain) ? 0.6 : 1.5;
}

export const usd = (n: number, dp = 0): string =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const money = (n: number): string => usd(Math.round(n * 100) / 100, n < 100 ? 2 : 0);

export interface Step { title: string; body: string; cost: number; minutes: number }
export const renderStep = (s: Step): string =>
  `${s.title} — ${s.body} (COST ${money(s.cost)}; TIME ${s.minutes} min)`;

function playKey(category: string | null): string {
  switch (category) {
    case 'Dexs': return 'dex';
    case 'Lending': case 'Uncollateralized Lending': return 'lending';
    case 'CDP': case 'CDP Manager': case 'Algo-Stables': case 'Dual-Token Stablecoin': case 'Stablecoin Issuer': return 'cdp';
    case 'Derivatives': case 'Options': case 'Options Vault': case 'Interest Rate Derivatives': case 'Basis Trading': case 'Synthetics': return 'perps';
    case 'Yield': case 'Yield Aggregator': case 'Farm': case 'Leveraged Farming': case 'Liquidity Manager': return 'yield';
    case 'Risk Curators': case 'Onchain Capital Allocator': return 'curator';
    case 'RWA': return 'rwa';
    case 'Prediction Market': return 'prediction';
    case 'Launchpad': return 'launchpad';
    case 'Staking Pool': case 'Restaking': return 'staking';
    default: return 'generic';
  }
}

const CORE: Record<string, (r: Row, sc: Scenario, chain: string) => string> = {
  dex: (r, sc, chain) => `Provide ${usd(sc.deposit)} of liquidity to ${r.p.name}'s busiest stable or blue-chip pool on ${chain}; concentrated ranges earn more but need weekly re-centring, so start with the widest range that still earns fees.`,
  lending: (r, sc, chain) => `Supply ${usd(sc.deposit)} of USDC (or the deepest stable market) to ${r.p.name} on ${chain}; lending balances are the activity most points programs count, and the position stays withdrawable.`,
  cdp: (r, sc, chain) => `Open a vault on ${chain}: deposit ${usd(sc.deposit)} of collateral and mint ${r.p.name}'s stablecoin at under half the liquidation ratio, so the position survives a sharp drawdown.`,
  perps: (r, sc, chain) => `Fund a ${chain} account with ${usd(sc.deposit)} and trade the majors with small, regular volume; keep leverage at or under 2x and hedge directional exposure on a second venue.`,
  yield: (r, sc, chain) => `Deposit ${usd(sc.deposit)} into ${r.p.name}'s flagship vault on ${chain}; pick the vault whose yield is paid in fees or interest, not in points alone.`,
  curator: (r, sc, chain) => `Allocate ${usd(sc.deposit)} to the largest vault this curator runs on ${chain}; curator vaults are the balance a launch would reward, and size beats spreading thin.`,
  rwa: (r, sc, chain) => `Complete onboarding and buy ${usd(sc.deposit)} of ${r.p.name}'s tokenised treasury or credit product on ${chain}; hold the receipt position untouched for the season.`,
  prediction: (r, sc, chain) => `Fund ${usd(sc.deposit)} on ${chain} and take small positions across the most liquid markets; regular two-sided volume, not one big bet, is what a points program sees.`,
  launchpad: (r, sc, chain) => `Hold ${usd(sc.deposit)} ready on ${chain} and take part in the next two launches at the smallest tier that records participation; do not chase allocations after the first day.`,
  staking: (r, sc, chain) => `Stake ${usd(sc.deposit)} through ${r.p.name} on ${chain} and hold the receipt token in the same wallet; restaked balances compound the record a launch would snapshot.`,
  generic: (r, sc, chain) => `Put ${usd(sc.deposit)} to work in ${r.p.name}'s main product on ${chain} — the balance or volume its own interface features — starting with a ${usd(100)} test position.`,
};
const DEEPEN: Record<string, (r: Row, sc: Scenario, chain: string) => string> = {
  dex: () => 'Add the second side of the pair or a second pool rather than looping the first; two pools diversify the fee record without doubling management.',
  lending: () => 'Borrow at most 30% against the supply and re-supply it once; one loop deepens the record, more loops mostly deepen liquidation risk.',
  cdp: () => 'Use part of the minted stablecoin inside the protocol\'s own pools or farms if it offers them; keep the vault ratio above twice the liquidation line.',
  perps: () => 'Add a second market and a standing hedge so weekly volume continues without directional bets; withdraw profits monthly, not the margin base.',
  yield: () => 'Split 20% into the protocol\'s second vault or its deployment on another chain it lists; the rest stays in the flagship vault.',
  curator: () => 'Add the curator\'s second vault only if it holds the same asset; two vaults with one asset read as one committed allocator, not a tourist.',
  rwa: () => 'Ladder a second purchase a month later rather than doubling today; two dated purchases read as a holder, not a snapshot sniper.',
  prediction: () => 'Keep a weekly cadence of small trades in new markets as they open; early positions in fresh markets are the cheapest record to build.',
  launchpad: () => 'Keep the wallet\'s balance history unbroken between launches; an empty wallet between events reads as rented, not committed.',
  staking: () => 'Restake or delegate the receipt token only where the protocol itself offers it; third-party wrappers can break the snapshot trail.',
  generic: () => 'Repeat the core action on the protocol\'s second chain if it lists one, at a fifth of the size; multichain activity is cheap breadth.',
};

/** The plan for one row. `extended` adds the risk, unwind and claim steps the detail page shows. */
export function planFor(r: Row, sc: Scenario, extended = false): Step[] {
  const chain = r.p.chains[0] ?? 'Ethereum';
  const gas = gasToken(chain);
  const op = opCost(chain);
  const share = (100 * sc.deposit / (r.p.tvl_usd + sc.deposit)).toFixed(3);
  const exitTvl = usd(r.p.tvl_usd * 0.83);
  const key = playKey(r.p.category);
  const steps: Step[] = [
    { title: 'SETUP', body: `Prepare an EVM wallet used only for this farm and fund it with ${gas} for gas on ${chain}; a hardware-backed wallet is worth the ten minutes at this size.`, cost: 1, minutes: 10 },
    { title: 'VERIFY', body: `Open ${r.p.name} from its DefiLlama page or official account and match the contract address against its documentation; never sign an approval that arrives by DM or a search ad.`, cost: 0, minutes: 6 },
    { title: 'CORE', body: CORE[key](r, sc, chain), cost: op * 2, minutes: 15 },
    { title: 'DEEPEN', body: DEEPEN[key](r, sc, chain), cost: op, minutes: 10 },
  ];
  if (extended) {
    steps.push({ title: 'RISK', body: `Read the protocol's risk and docs pages end to end: note what backs the position, who can pause withdrawals, and whether the yield is paid in cash flows or in unlisted points.`, cost: 0, minutes: 12 });
  }
  steps.push(
    { title: 'CADENCE', body: `${r.p.name} has run ${r.ageYears.toFixed(1)} years with no token recorded; touch the position once a week — a claim, a small top-up or a rebalance — so the record shows a holder, not a drive-by.`, cost: op * sc.weeks / 2, minutes: 5 * sc.weeks },
    { title: 'WATCH', body: `Exit rule, checked weekly: withdraw if TVL prints below ${exitTvl} (17% under the snapshot's ${usd(r.p.tvl_usd)}), if withdrawals are paused, or if the team says a snapshot has been taken.`, cost: 0, minutes: 5 * sc.weeks },
  );
  if (extended) {
    steps.push(
      { title: 'UNWIND', body: `Keep the exit rehearsed: know the withdrawal queue or pool depth for a position that is ${share}% of TVL, and never let the farm exceed what can leave in a day.`, cost: 0, minutes: 8 },
      { title: 'CLAIM', body: `If a token launches, claim only from the protocol's own site, check the allocation against the ledger below before selling anything, and treat the drop as taxable income in most places.`, cost: op, minutes: 10 },
    );
  }
  steps.push({ title: 'RECORD', body: `Keep a ledger from the first transaction: date, hash, asset, amount and dollar value of every deposit, top-up, claim and withdrawal; an airdrop is income in most jurisdictions and memory is not evidence.`, cost: 0, minutes: 10 });
  return steps;
}

export interface FarmResult {
  verdict: 'FARM' | 'MARGINAL' | 'SKIP'; drop: number; fees: number; hours: number;
  timeCost: number; net: number; netPerHour: number; tbill: number;
  stressVerdict: 'FARM' | 'MARGINAL' | 'SKIP'; holdsAtP25: boolean;
}

function verdictAt(r: Row, sc: Scenario, implied: number, fees: number, hours: number):
  { verdict: FarmResult['verdict']; drop: number; net: number; netPerHour: number; tbill: number } {
  const drop = implied * sc.dropShare * sc.deposit / (r.p.tvl_usd + sc.deposit);
  const timeCost = hours * WAGE;
  const net = drop - fees - timeCost;
  const tbill = sc.deposit * TBILL * sc.weeks / 52;
  const netPerHour = net / Math.max(hours, 0.01);
  const verdict = net >= tbill && netPerHour >= WAGE ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP';
  return { verdict, drop, net, netPerHour, tbill };
}

export function computeFarm(r: Row, sc: Scenario): FarmResult {
  const steps = planFor(r, sc);
  const fees = steps.reduce((s, x) => s + x.cost, 0);
  const hours = steps.reduce((s, x) => s + x.minutes, 0) / 60;
  const main = verdictAt(r, sc, r.implied, fees, hours);
  const stress = verdictAt(r, sc, r.p25, fees, hours);
  return {
    verdict: main.verdict, drop: main.drop, fees, hours, timeCost: hours * WAGE,
    net: main.net, netPerHour: main.netPerHour, tbill: main.tbill,
    stressVerdict: stress.verdict, holdsAtP25: stress.verdict === 'FARM',
  };
}

// ---------------------------------------------------------------- detail

export interface Detail {
  slug: string;
  valueFactors: { label: string; mult: number }[];
  oddsFactors: { label: string; logit: number }[];
  peers: { name: string; tvl: number; mcap: number; capTvl: number; vsModel: number }[];
  matrix: { shares: number[]; deposits: number[]; net: number[][] };
  breakEvenShare: number; breakEvenOdds: number; exitTvl: number;
  plan: Step[];
}

export function buildDetail(built: Built, snap: Snapshot, r: Row, sc: Scenario): Detail {
  const names = new Map(snap.protocols.map((p) => [p.slug, p.name]));
  const feat = { slug: r.p.slug, ageDays: r.ageDays, ageYears: r.ageYears, lnTvl: r.lnTvl, growth: r.growth, lnChains: r.lnChains, family: r.family, category: r.p.category ?? 'Uncategorised', listedMs: null };
  const vf = breakdown(built, feat, 'value');
  const of = breakdown(built, feat, 'odds');
  const valueFactors = vf.map((x, i) => ({
    label: x.label, mult: i === 0 ? Math.exp(x.factor) : Math.exp(x.factor),
  }));
  const oddsFactors = of.map((x) => ({ label: x.label, logit: x.factor }));
  const lnMult = vf.reduce((s, x) => s + x.factor, 0);
  const peers = built.pricedPeers
    .filter((pp) => pp.f.category === (r.p.category ?? 'Uncategorised') || pp.f.family === r.family)
    .map((pp) => ({
      name: names.get(pp.f.slug) ?? pp.f.slug, tvl: pp.tvl, mcap: pp.mcap,
      capTvl: pp.mcap / pp.tvl, vsModel: pp.mcap / (pp.tvl * Math.exp(lnMult)),
      dist: Math.abs(Math.log(pp.tvl / r.p.tvl_usd)),
    }))
    .sort((a, b) => a.dist - b.dist).slice(0, 6)
    .map(({ name, tvl, mcap, capTvl, vsModel }) => ({ name, tvl, mcap, capTvl, vsModel }));
  const steps = planFor(r, sc, true);
  const fees = steps.reduce((s, x) => s + x.cost, 0);
  const hours = steps.reduce((s, x) => s + x.minutes, 0) / 60;
  const shares = [0.035, 0.07, 0.14], deposits = [1000, 3000, 10000, 30000];
  const net = shares.map((sh) => deposits.map((dep) =>
    Math.round(r.implied * sh * dep / (r.p.tvl_usd + dep) - fees - hours * WAGE)));
  const unit = sc.dropShare * sc.deposit / (r.p.tvl_usd + sc.deposit);
  const breakEvenShare = (fees + hours * WAGE) / (r.implied * sc.deposit / (r.p.tvl_usd + sc.deposit));
  const breakEvenOdds = r.valueIf > 0 ? (fees + hours * WAGE) / (r.valueIf * unit) : 0;
  return {
    slug: r.p.slug, valueFactors, oddsFactors, peers,
    matrix: { shares, deposits, net },
    breakEvenShare, breakEvenOdds, exitTvl: r.p.tvl_usd * 0.83, plan: steps,
  };
}
