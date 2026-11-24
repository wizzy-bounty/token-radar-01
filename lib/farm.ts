// RADAR-8 farm plans and break-even economics — written for this entry.
// Every figure a plan quotes is derived here from the row's own chain, category and TVL, so the
// plan in board.json, the fees in the verdict and the steps on the page are one computation.

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

/** Gas asset and a plain cost class per chain the snapshot names; anything else is "other L1/L2". */
const CHAIN_PROFILE: Record<string, { gas: string; swapUsd: number; bridgeUsd: number; tier: string }> = {
  Ethereum: { gas: 'ETH', swapUsd: 9, bridgeUsd: 14, tier: 'L1' },
  Solana: { gas: 'SOL', swapUsd: 1, bridgeUsd: 6, tier: 'L1' },
  Base: { gas: 'ETH', swapUsd: 1, bridgeUsd: 5, tier: 'L2' },
  Arbitrum: { gas: 'ETH', swapUsd: 1, bridgeUsd: 5, tier: 'L2' },
  Optimism: { gas: 'ETH', swapUsd: 1, bridgeUsd: 5, tier: 'L2' },
  Binance: { gas: 'BNB', swapUsd: 2, bridgeUsd: 6, tier: 'L1' },
  Polygon: { gas: 'POL', swapUsd: 1, bridgeUsd: 5, tier: 'L2' },
  Avalanche: { gas: 'AVAX', swapUsd: 2, bridgeUsd: 7, tier: 'L1' },
  'Hyperliquid L1': { gas: 'HYPE', swapUsd: 2, bridgeUsd: 8, tier: 'L1' },
  Monad: { gas: 'MON', swapUsd: 1, bridgeUsd: 6, tier: 'L1' },
  Bitcoin: { gas: 'BTC', swapUsd: 6, bridgeUsd: 12, tier: 'L1' },
  Tron: { gas: 'TRX', swapUsd: 2, bridgeUsd: 6, tier: 'L1' },
  Sui: { gas: 'SUI', swapUsd: 1, bridgeUsd: 6, tier: 'L1' },
  Aptos: { gas: 'APT', swapUsd: 1, bridgeUsd: 6, tier: 'L1' },
  Near: { gas: 'NEAR', swapUsd: 1, bridgeUsd: 6, tier: 'L1' },
};

export function chainProfile(chain: string): { gas: string; swapUsd: number; bridgeUsd: number; tier: string } {
  return CHAIN_PROFILE[chain] ?? { gas: 'the chain gas token', swapUsd: 3, bridgeUsd: 8, tier: 'chain' };
}

export const HANDS_ON_USD_PER_HOUR = 25;
export const TBILL_ANNUAL = 0.04;
export const DEFAULT_DROP_SHARE = 0.06;
export const DEFAULT_HORIZON_WEEKS = 26;
export const REFERENCE_DEPOSIT = 10_000;
export const FARM_CAPITAL_CAP = 250_000;
export const SEARCH_CAPITAL_CAP = 1_000_000;

export interface PlanStep { text: string; costUsd: number; hours: number }
export interface Plan { steps: PlanStep[]; feesUsd: number; hours: number }

/** The core action a category asks of a farmer, in the category's own terms. */
function coreAction(category: string | null): { verb: string; venue: string; exit: string } {
  switch (category) {
    case 'Dexs': return { verb: 'trade spot pairs and route swaps through its pools', venue: 'its highest-volume pair', exit: 'when weekly volume share falls two weeks running' };
    case 'Lending': return { verb: 'supply the main lending market and borrow once against it', venue: 'its largest supply market', exit: 'when utilisation stays under 20% for two weeks' };
    case 'Derivatives': return { verb: 'open and roll small hedged perpetual positions', venue: 'its most liquid perpetual market', exit: 'when open interest halves from its peak' };
    case 'Yield': case 'Yield Aggregator': return { verb: 'deposit into its flagship vault and compound the yield weekly', venue: 'its flagship vault', exit: 'when vault APY falls under the T-bill rate' };
    case 'CDP': return { verb: 'mint its stablecoin against collateral and hold a vault position', venue: 'its main collateral vault', exit: 'when collateral ratio nears the liquidation line' };
    case 'RWA': return { verb: 'onboard, verify and hold its tokenised asset position', venue: 'its primary asset pool', exit: 'when redemption queues exceed a week' };
    case 'Risk Curators': case 'Onchain Capital Allocator': return { verb: 'allocate into its curated vaults and rebalance monthly', venue: 'its largest curated vault', exit: 'when curator TVL share drops two months running' };
    case 'Basis Trading': return { verb: 'hold its basis position through one full funding cycle', venue: 'its main basis vault', exit: 'when funding turns negative for a full week' };
    case 'Leveraged Farming': return { verb: 'open a small leveraged farm position and rebalance weekly', venue: 'its main leveraged pair', exit: 'when leverage health nears the unwind line' };
    default: return { verb: 'use its core product on a weekly cadence', venue: 'its main market', exit: 'when its TVL falls 30% from entry' };
  }
}

const fmtUsd = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');

/**
 * A concrete 10-step plan for one protocol. Steps quote the row's own primary chain, gas asset,
 * category action and TVL-sized tranches; each step carries the cost and hands-on time the
 * break-even maths charges for it.
 */
export function buildPlan(p: Proto, viableHint: number | null): Plan {
  const chain = p.chains[0] ?? 'Ethereum';
  const prof = chainProfile(chain);
  const act = coreAction(p.category);
  const cat = p.category ?? 'uncategorised';
  const deposit = viableHint !== null && viableHint >= 500 ? viableHint : REFERENCE_DEPOSIT;
  const tranche = Math.max(100, Math.round(deposit / 4 / 50) * 50);
  const steps: PlanStep[] = [
    { text: `Set up a fresh wallet for ${p.name} and fund it with ${prof.gas} on ${chain} for gas; keep the seed offline. Cost ~${fmtUsd(prof.bridgeUsd)} in funding fees, ~20 min.`, costUsd: prof.bridgeUsd, hours: 1 / 3 },
    { text: `Bridge or on-ramp the first ${fmtUsd(tranche)} tranche to ${chain}; ${p.name} is a ${cat} protocol with ${fmtUsd(p.tvl_usd)} TVL, so size in four tranches, not one. Cost ~${fmtUsd(prof.bridgeUsd)}, ~15 min.`, costUsd: prof.bridgeUsd, hours: 0.25 },
    { text: `Open ${p.name} and ${act.verb} in ${act.venue}; record the position size and entry TVL in a log. Cost ~${fmtUsd(prof.swapUsd)} per action, ~30 min.`, costUsd: prof.swapUsd, hours: 0.5 },
    { text: `Add the second ${fmtUsd(tranche)} tranche once the first position settles cleanly; check the protocol dashboard for points, seasons or multiplier language. Cost ~${fmtUsd(prof.swapUsd)}, ~15 min.`, costUsd: prof.swapUsd, hours: 0.25 },
    { text: `Run the weekly cadence for the full 26-week horizon: one real use of ${p.name} per week (never wash volume), compounding or rebalancing as the ${cat} flow requires. Cost ~${fmtUsd(prof.swapUsd)} a week, ~20 min a week.`, costUsd: prof.swapUsd * 4, hours: 8.67 },
    { text: `Spread activity across ${p.chains.length > 1 ? `its other chains (${p.chains.slice(1, 3).join(', ')})` : 'a second wallet only if the rules allow it'} to look like a genuine user, not a script. Cost ~${fmtUsd(prof.bridgeUsd)}, ~30 min.`, costUsd: prof.bridgeUsd, hours: 0.5 },
    { text: `Add the third and fourth tranches (to ${fmtUsd(tranche * 4)} total) only while TVL holds above ${fmtUsd(p.tvl_usd * 0.8)}; stop adding if it falls under that line. Cost ~${fmtUsd(prof.swapUsd * 2)}, ~20 min.`, costUsd: prof.swapUsd * 2, hours: 1 / 3 },
    { text: `Join ${p.name}'s official community channels and any governance or feedback forum; one substantive post a month. Cost $0, ~30 min a month.`, costUsd: 0, hours: 3 },
    { text: `Watch for a snapshot or token announcement weekly; if a claim opens, verify the contract on the official channel before signing anything. Cost $0, ~10 min a week.`, costUsd: 0, hours: 4.33 },
    { text: `Exit rule: unwind ${act.exit}, or when the position passes the break-even drop share printed on this row; claim and sell in tranches if a token lands. Cost ~${fmtUsd(prof.swapUsd * 2)}, ~45 min.`, costUsd: prof.swapUsd * 2, hours: 0.75 },
  ];
  const feesUsd = steps.reduce((a, s) => a + s.costUsd, 0);
  const hours = steps.reduce((a, s) => a + s.hours, 0);
  return { steps, feesUsd, hours: Math.round(hours * 100) / 100 };
}

/** Net of a deposit D after the drop, the plan's fees and hands-on time at $25/h. */
export function netAt(implied: number, tvl: number, dropShare: number, fees: number, hours: number, D: number): number {
  return implied * dropShare * (D / (tvl + D)) - fees - hours * HANDS_ON_USD_PER_HOUR;
}

export interface Verdict {
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  viableCapital: number | null;
  netAtViable: number;
  netPerHour: number;
  bestNet: number;
  breakevenDropShare: number;
}

/**
 * Break-even-first pricing of one row. The minimum viable capital is the smallest deposit whose
 * net clears the T-bill return on the same money over the same horizon; the verdict is read at
 * that capital, never at a flat deposit.
 */
export function priceRow(implied: number, tvl: number, dropShare: number, horizonWeeks: number, fees: number, hours: number, domainCap: number = SEARCH_CAPITAL_CAP): Verdict {
  const cap = Math.min(SEARCH_CAPITAL_CAP, Math.max(REFERENCE_DEPOSIT, domainCap));
  const tbillRate = TBILL_ANNUAL * (horizonWeeks / 52);
  const gain = (D: number): number => netAt(implied, tvl, dropShare, fees, hours, D) - tbillRate * D;
  // Scan a log grid for the first break-even crossing, then bisect it to the nearest $50.
  let viable: number | null = null;
  let prevD = 100;
  let prevG = gain(prevD);
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
  // Best achievable net inside the domain (for MARGINAL): scan the same capped range.
  let bestNet = -Infinity; let bestD = REFERENCE_DEPOSIT;
  for (let D = 100; D <= cap; D = Math.round(D * 1.12)) {
    const n = netAt(implied, tvl, dropShare, fees, hours, D);
    if (n > bestNet) { bestNet = n; bestD = D; }
  }
  const atD = viable ?? (bestNet > 0 ? bestD : REFERENCE_DEPOSIT);
  const net = netAt(implied, tvl, dropShare, fees, hours, atD);
  const verdict: Verdict['verdict'] = viable !== null && viable <= FARM_CAPITAL_CAP ? 'FARM' : bestNet > 0 ? 'MARGINAL' : 'SKIP';
  // Break-even drop share at the $10,000 reference deposit: solve net(10k) = T-bill(10k) for the share.
  const be = ((fees + hours * HANDS_ON_USD_PER_HOUR + tbillRate * REFERENCE_DEPOSIT) * (tvl + REFERENCE_DEPOSIT)) / (implied * REFERENCE_DEPOSIT);
  return {
    verdict,
    viableCapital: viable,
    netAtViable: Math.round(net * 100) / 100,
    netPerHour: Math.round((net / Math.max(hours, 0.25)) * 100) / 100,
    bestNet: Math.round(bestNet * 100) / 100,
    breakevenDropShare: Math.round(be * 10000) / 10000,
  };
}
