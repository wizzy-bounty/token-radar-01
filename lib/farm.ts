// farm.ts — RADAR-9's farm plans and break-even pricing, written for this entry.
// A plan is generated from the protocol's own primary chain, category and TVL;
// the same fees and hours the plan quotes are the ones the verdict maths
// charges, so the board, the detail pages and board.json never disagree.

export interface Proto {
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

interface ChainInfo { gas: string; swap: number; bridge: number; kind: string }
const CHAINS: Record<string, ChainInfo> = {
  Ethereum: { gas: 'ETH', swap: 9, bridge: 14, kind: 'L1' },
  Solana: { gas: 'SOL', swap: 1, bridge: 6, kind: 'L1' },
  Base: { gas: 'ETH', swap: 1, bridge: 5, kind: 'L2' },
  Arbitrum: { gas: 'ETH', swap: 1, bridge: 5, kind: 'L2' },
  Optimism: { gas: 'ETH', swap: 1, bridge: 5, kind: 'L2' },
  Binance: { gas: 'BNB', swap: 2, bridge: 6, kind: 'L1' },
  Polygon: { gas: 'POL', swap: 1, bridge: 5, kind: 'L2' },
  Avalanche: { gas: 'AVAX', swap: 2, bridge: 7, kind: 'L1' },
  'Hyperliquid L1': { gas: 'HYPE', swap: 2, bridge: 8, kind: 'L1' },
  Bitcoin: { gas: 'BTC', swap: 6, bridge: 12, kind: 'L1' },
  Tron: { gas: 'TRX', swap: 2, bridge: 6, kind: 'L1' },
  Sui: { gas: 'SUI', swap: 1, bridge: 6, kind: 'L1' },
  Aptos: { gas: 'APT', swap: 1, bridge: 6, kind: 'L1' },
  Near: { gas: 'NEAR', swap: 1, bridge: 6, kind: 'L1' },
  Monad: { gas: 'MON', swap: 1, bridge: 6, kind: 'L1' },
};
export const chainInfo = (chain: string): ChainInfo =>
  CHAINS[chain] ?? { gas: 'the native gas token', swap: 3, bridge: 8, kind: 'chain' };

export const WAGE = 25;               // hands-on time, dollars per hour
export const TBILL = 0.04;            // the hurdle: a 4% annual risk-free rate
export const DROP_SHARE = 0.06;       // scenario: the drop gives farmers 6% of supply value
export const HORIZON_WEEKS = 26;      // scenario horizon
export const REF_DEPOSIT = 10_000;    // reference deposit for break-even share
export const FARM_MAX = 250_000;      // a FARM verdict must break even at or under this
export const SEARCH_MAX = 1_000_000;  // the search never sizes past this

const usd = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');

interface Action { do: string; venue: string; exit: string }
function actionFor(category: string | null): Action {
  switch (category) {
    case 'Dexs': return { do: 'route real swaps through its pools and hold a small LP position', venue: 'its deepest pair', exit: 'its share of chain volume halves for two straight weeks' };
    case 'Lending': return { do: 'supply its main market and take one modest borrow against it', venue: 'its largest supply market', exit: 'utilisation sits under 20% for two weeks' };
    case 'Derivatives': return { do: 'trade small hedged perpetuals and roll them weekly', venue: 'its most liquid perpetual', exit: 'open interest halves from its peak' };
    case 'Yield': case 'Yield Aggregator': return { do: 'deposit in its flagship vault and compound weekly', venue: 'its flagship vault', exit: 'vault yield falls under the 4% T-bill line' };
    case 'CDP': return { do: 'open a collateral vault and mint a small stablecoin position', venue: 'its main collateral vault', exit: 'the collateral ratio drifts near liquidation' };
    case 'RWA': return { do: 'complete onboarding and hold its tokenised asset', venue: 'its primary asset pool', exit: 'redemption queues stretch past a week' };
    case 'Risk Curators': case 'Onchain Capital Allocator': return { do: 'allocate across its curated vaults and rebalance monthly', venue: 'its largest curated vault', exit: 'curator share of TVL falls two months running' };
    case 'Basis Trading': return { do: 'hold its basis trade through one full funding cycle', venue: 'its main basis vault', exit: 'funding stays negative for a full week' };
    case 'Leveraged Farming': return { do: 'run a small leveraged position and rebalance weekly', venue: 'its main leveraged pair', exit: 'position health nears the unwind line' };
    case 'Options': case 'Options Vault': return { do: 'sell into its options vault on the weekly cycle', venue: 'its flagship options vault', exit: 'vault drawdowns exceed two weeks of premium' };
    case 'Prediction Market': return { do: 'take small positions on its liquid markets each week', venue: 'its highest-volume market', exit: 'market spreads widen past usefulness' };
    default: return { do: 'use its core product on a weekly cadence, the way a real user would', venue: 'its main market', exit: 'its TVL falls 30% from the entry reading' };
  }
}

export interface Step { text: string; costUsd: number; hours: number }
export interface Plan { steps: Step[]; feesUsd: number; hours: number }

/** Ten concrete steps for one protocol; every cost and hour is charged to the verdict. */
export function buildPlan(p: Proto, sizedDeposit: number | null): Plan {
  const chain = p.chains[0] ?? 'Ethereum';
  const ci = chainInfo(chain);
  const act = actionFor(p.category);
  const cat = p.category ?? 'uncategorised';
  const deposit = sizedDeposit !== null && sizedDeposit >= 500 ? sizedDeposit : REF_DEPOSIT;
  const tranche = Math.max(100, Math.round((deposit / 4) / 50) * 50);
  const others = p.chains.slice(1, 3);
  const steps: Step[] = [
    { text: `Create a dedicated wallet for ${p.name}; fund it with ${ci.gas} on ${chain} for gas and keep the seed phrase offline. Funding cost ~${usd(ci.bridge)}, about 20 minutes.`, costUsd: ci.bridge, hours: 1 / 3 },
    { text: `Move the first ${usd(tranche)} tranche onto ${chain}. ${p.name} is a ${cat} protocol holding ${usd(p.tvl_usd)} of TVL, so enter in four tranches rather than one block. Cost ~${usd(ci.bridge)}, about 15 minutes.`, costUsd: ci.bridge, hours: 0.25 },
    { text: `On ${p.name}, ${act.do} in ${act.venue}; log the position, the date and the TVL you entered at. Cost ~${usd(ci.swap)} per action, about 30 minutes.`, costUsd: ci.swap, hours: 0.5 },
    { text: `Add the second ${usd(tranche)} tranche after the first settles; read the protocol's own pages for points, seasons or multiplier wording and note what actually counts. Cost ~${usd(ci.swap)}, about 15 minutes.`, costUsd: ci.swap, hours: 0.25 },
    { text: `Hold the weekly cadence for the whole ${HORIZON_WEEKS}-week horizon: one genuine use of ${p.name} per week, never wash activity, compounding or rebalancing as the ${cat} flow needs. Cost ~${usd(ci.swap)} a week, about 20 minutes a week.`, costUsd: ci.swap * 4, hours: 8.67 },
    { text: others.length > 0
      ? `Spread some activity to ${p.name}'s other chains (${others.join(', ')}) so the record reads as a real multi-chain user, not a script. Cost ~${usd(ci.bridge)}, about 30 minutes.`
      : `Keep all activity on ${chain} and vary times and sizes week to week so the record reads as a person, not a script. Cost $0, about 30 minutes.`, costUsd: others.length > 0 ? ci.bridge : 0, hours: 0.5 },
    { text: `Add tranches three and four (to ${usd(tranche * 4)} in total) only while TVL holds above ${usd(p.tvl_usd * 0.8)}; stop adding the week it falls under that line. Cost ~${usd(ci.swap * 2)}, about 20 minutes.`, costUsd: ci.swap * 2, hours: 1 / 3 },
    { text: `Take part in ${p.name}'s governance or feedback channels once a month with a substantive post; several launches weight this. Cost $0, about 30 minutes a month.`, costUsd: 0, hours: 3 },
    { text: `Check weekly for a snapshot or token announcement; if a claim opens, verify the contract address on the official channel before signing anything. Cost $0, about 10 minutes a week.`, costUsd: 0, hours: 4.33 },
    { text: `Exit when ${act.exit}, or when the position clears the break-even drop share printed on this row; if a token lands, claim and sell in tranches. Cost ~${usd(ci.swap * 2)}, about 45 minutes.`, costUsd: ci.swap * 2, hours: 0.75 },
  ];
  return {
    steps,
    feesUsd: steps.reduce((a, s) => a + s.costUsd, 0),
    hours: Math.round(steps.reduce((a, s) => a + s.hours, 0) * 100) / 100,
  };
}

/** Net dollars from deposit D once the drop lands: the farmer's share of the
 *  implied value, less the plan's fees and hands-on time at $25 an hour. */
export function netAt(implied: number, tvl: number, dropShare: number, fees: number, hours: number, D: number): number {
  return implied * dropShare * (D / (tvl + D)) - fees - hours * WAGE;
}

export interface Verdict {
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  viableCapital: number | null;
  readAt: number; // the deposit the printed net is read at: the viable capital when one exists, else the best-net deposit
  netAtViable: number;
  netPerHour: number;
  bestNet: number;
  breakevenDropShare: number;
}

/** Price one row break-even-first: find the smallest deposit whose net clears
 *  the T-bill return on the same money over the same horizon, and read the
 *  verdict at that deposit — never at a flat $10,000. */
export function priceRow(implied: number, tvl: number, dropShare: number, horizonWeeks: number, fees: number, hours: number, domainCap: number = SEARCH_MAX): Verdict {
  const cap = Math.min(SEARCH_MAX, Math.max(REF_DEPOSIT, domainCap));
  const hurdle = TBILL * (horizonWeeks / 52);
  const gain = (D: number): number => netAt(implied, tvl, dropShare, fees, hours, D) - hurdle * D;
  let viable: number | null = null;
  let prevD = 100, prevG = gain(prevD);
  for (let D = 150; D <= cap; D = Math.round(D * 1.25)) {
    const g = gain(D);
    if (prevG < 0 && g >= 0) {
      let lo = prevD, hi = D;
      while (hi - lo > 50) { const mid = (lo + hi) / 2; if (gain(mid) >= 0) hi = mid; else lo = mid; }
      viable = Math.ceil(hi / 50) * 50;
      break;
    }
    prevD = D; prevG = g;
  }
  let bestNet = -Infinity, bestD = REF_DEPOSIT;
  for (let D = 100; D <= cap; D = Math.round(D * 1.12)) {
    const n = netAt(implied, tvl, dropShare, fees, hours, D);
    if (n > bestNet) { bestNet = n; bestD = D; }
  }
  const atD = viable ?? (bestNet > 0 ? bestD : REF_DEPOSIT);
  const net = netAt(implied, tvl, dropShare, fees, hours, atD);
  // The break-even drop share is quoted at the same capital the verdict is
  // read at, so the two columns can never contradict each other.
  const be = ((fees + hours * WAGE + hurdle * atD) * (tvl + atD)) / (implied * atD);
  return {
    verdict: viable !== null && viable <= FARM_MAX ? 'FARM' : bestNet > 0 ? 'MARGINAL' : 'SKIP',
    viableCapital: viable,
    readAt: atD,
    netAtViable: Math.round(net * 100) / 100,
    netPerHour: Math.round((net / Math.max(hours, 0.25)) * 100) / 100,
    bestNet: Math.round(bestNet * 100) / 100,
    breakevenDropShare: Math.round(be * 10000) / 10000,
  };
}
