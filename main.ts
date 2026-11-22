// main.ts — radar-7 entry point. Reads the snapshot, fits both models from
// its own figures, ranks every protocol the house rule would rank without
// the TVL floor, prices a default farm scenario for each row, and writes
// board.json, the dashboard (with data.js) and the dossier into the output
// directory. Node 22, standard library only.

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { buildModel, type Snapshot, type Scores } from './lib/model.ts';
import {
  planFor, computeFarm, buildDetail, renderStep, DEFAULT_SCENARIO, opCost,
} from './lib/farm.ts';

const args = process.argv.slice(2);
const inIdx = args.indexOf('--input');
const inputPath = inIdx >= 0 ? args[inIdx + 1] : '/input/snapshot.json';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const root = dirname(fileURLToPath(import.meta.url));

const snap = JSON.parse(readFileSync(inputPath, 'utf8')) as Snapshot;
const built = buildModel(snap);
const sc = DEFAULT_SCENARIO;
const watch = new Set(snap.watchlist);

mkdirSync(join(outDir, 'dashboard'), { recursive: true });
cpSync(join(root, 'dashboard'), join(outDir, 'dashboard'), { recursive: true });
if (existsSync(join(root, 'screenshots'))) {
  cpSync(join(root, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

// ------------------------------------------------------------- board.json
const boardRows = built.rows.map((r) => {
  const farm = computeFarm(r, sc);
  return {
    slug: r.p.slug,
    rank: r.rank,
    name: r.p.name,
    category: r.p.category,
    chains: r.p.chains,
    tvl_usd: Math.round(r.p.tvl_usd),
    change_7d: r.p.change_7d,
    age_years: Math.round(r.ageYears * 100) / 100,
    odds_pct: Math.round(r.odds * 1000) / 10,
    value_if_usd: Math.round(r.valueIf),
    implied_value_usd: r.implied,
    implied_p25_usd: r.p25,
    implied_p75_usd: r.p75,
    rank_range: [r.rankLo, r.rankHi],
    verdict: farm.verdict,
    stress_verdict: farm.stressVerdict,
    net_usd: Math.round(farm.net),
    net_per_hour_usd: Math.round(farm.netPerHour * 10) / 10,
    farm_steps: planFor(r, sc).map(renderStep),
  };
});
const boardJson = JSON.stringify(boardRows, null, 1);
writeFileSync(join(outDir, 'board.json'), boardJson);

// ------------------------------------------------------------- dashboard data
const r3 = (n: number): number => Number(n.toPrecision(3));
const scores = (s: Scores, dp: number) => ({
  loo: Number(s.loo.toFixed(dp)), wf: Number(s.wf.toFixed(dp)), lofo: Number(s.lofo.toFixed(dp)),
});
const farms = built.rows.map((r) => computeFarm(r, sc));
const farmIdx = farms.map((f, i) => [f.netPerHour, i] as [number, number])
  .filter(([_, i]) => farms[i].verdict === 'FARM').sort((a, b) => b[0] - a[0]);
const farmPickIdx = farmIdx.length ? farmIdx[0][1]
  : farms.map((f, i) => [f.netPerHour, i] as [number, number]).sort((a, b) => b[0] - a[0])[0][1];
const watchPickIdx = built.rows.filter((r) => watch.has(r.p.slug))
  .sort((a, b) => b.implied - a.implied)[0];
const watchIdx = built.rows.indexOf(watchPickIdx);

let hash = 0x811c9dc5;
for (let i = 0; i < boardJson.length; i++) { hash ^= boardJson.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }

const data = {
  asOf: snap.as_of, floor: snap.floor_usd, scenario: sc,
  accounting: built.accounting,
  totals: {
    implied: built.totalImplied, tvl: built.totalTvl,
    checksum: hash.toString(16).padStart(8, '0'),
    farmCount: farms.filter((f) => f.verdict === 'FARM').length,
    stressCount: farms.filter((f) => f.holdsAtP25).length,
  },
  valueModel: {
    n: built.value.nPriced, zeroCap: built.value.zeroCap,
    multiple: Math.round(built.value.multipleAt100M * 100) / 100,
    multipleLo: Math.round(built.value.multipleAt100M * Math.exp(-built.value.seIntercept) * 100) / 100,
    multipleHi: Math.round(built.value.multipleAt100M * Math.exp(built.value.seIntercept) * 100) / 100,
    sizeSlope: Math.round(built.value.sizeSlope * 1000) / 1000,
    seSlope: Math.round(built.value.seSlope * 1000) / 1000,
    kept: built.value.kept, base: scores(built.value.base, 2), final: scores(built.value.final, 2),
    table: built.value.table.map((t) => ({ label: t.label, kept: t.kept, ...scores(t.solo, 2) })),
  },
  oddsModel: {
    baseRate: Math.round(built.odds.baseRate * 1000) / 10,
    calledRight: Math.round(built.odds.calledRight * 1000) / 10,
    kept: built.odds.kept, base: scores(built.odds.baseBrier, 3), final: scores(built.odds.final, 3),
    table: built.odds.table.map((t) => ({ label: t.label, kept: t.kept, ...scores(t.solo, 3) })),
  },
  honesty: {
    inMid: Math.round(built.honesty.inP2575 * 1000) / 10,
    inWide: Math.round(built.honesty.inP1090 * 1000) / 10,
  },
  // slug, name, category, chains, tvl, change7d, ageYears, oddsPct, valueIf,
  // implied, p10, p25, p90, rankLo, rankHi, opCost, watchlist — verdicts and
  // nets are exact functions of these plus the scenario, so the page derives
  // them (fees and hours are functions of opCost and weeks).
  rows: built.rows.map((r) => [
    r.p.slug, r.p.name, r.p.category, r.p.chains.slice(0, 4), r3(r.p.tvl_usd),
    r.p.change_7d === null ? null : Math.round(r.p.change_7d * 100) / 100,
    Math.round(r.ageYears * 10) / 10, Math.round(r.odds * 1000) / 10, r3(r.valueIf), r.implied,
    r3(r.p10), r3(r.p25), r3(r.p90), r.rankLo, r.rankHi,
    opCost(r.p.chains[0] ?? 'Ethereum'), watch.has(r.p.slug) ? 1 : 0,
  ]),
  picks: {
    farm: { slug: built.rows[farmPickIdx].p.slug, detail: buildDetail(built, snap, built.rows[farmPickIdx], sc) },
    watch: { slug: built.rows[watchIdx].p.slug, detail: buildDetail(built, snap, built.rows[watchIdx], sc) },
  },
};
writeFileSync(join(outDir, 'dashboard', 'data.js'), 'window.RADAR=' + JSON.stringify(data) + ';\n');

// ------------------------------------------------------------- dossier
// Written exactly as buildDossier returns it — no parsing, no added keys.
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, { text_max_bytes: 65536 }));

console.log(`radar-7: ${built.rows.length} rows · value kept [${built.value.kept.join(', ')}] · odds kept [${built.odds.kept.join(', ')}]`);
console.log(`value miss LOO/WF/LOFO ${built.value.final.loo.toFixed(2)}/${built.value.final.wf.toFixed(2)}/${built.value.final.lofo.toFixed(2)} (base ${built.value.base.loo.toFixed(2)}/${built.value.base.wf.toFixed(2)}/${built.value.base.lofo.toFixed(2)})`);
console.log(`odds Brier LOO/WF/LOFO ${built.odds.final.loo.toFixed(3)}/${built.odds.final.wf.toFixed(3)}/${built.odds.final.lofo.toFixed(3)} (base ${built.odds.baseBrier.loo.toFixed(3)}/${built.odds.baseBrier.wf.toFixed(3)}/${built.odds.baseBrier.lofo.toFixed(3)})`);
console.log(`honesty: ${data.honesty.inMid}% inside P25–P75, ${data.honesty.inWide}% inside P10–P90 · FARM rows ${data.totals.farmCount}, stress-proof ${data.totals.stressCount}`);
