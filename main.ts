// RADAR-8 "BREAK-EVEN FIRST" — token-radar-01 entry. Node 22, standard library only.
//
// Reads the sealed snapshot, fits both models on its figures, prices every ranked protocol at
// its own minimum viable capital, and writes /output/board.json, /output/data.js, the dashboard
// and screenshots copies, and /output/dossier.json — the dossier written exactly as the vendored
// buildDossier returns it, never parsed or amended.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|dir>

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`radar-8: no snapshot at ${inputFile}\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const mainChecksum = createHash('sha256').update(readFileSync(join(here, 'main.ts'))).digest('hex').slice(0, 16);
const { board, radar } = buildRadar(snapshot, mainChecksum);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`radar-8: board refused: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const boardRows = board.map((r) => ({
  slug: r.slug, name: r.name, rank: r.rank, implied_value_usd: r.implied_value_usd, farm_steps: r.farm_steps,
  category: r.category, chains: r.chains, tvl_usd: r.tvl_usd, change_7d: r.change_7d, age_days: r.age_days,
  watchlist: r.watchlist, odds: r.odds, value_if_usd: r.value_if_usd, interval_80: [r.lo80, r.hi80],
  verdict: r.verdict, viable_capital_usd: r.viable_capital_usd, net_at_viable_usd: r.net_at_viable,
  net_per_hour_usd: r.net_per_hour, breakeven_drop_share: r.breakeven_drop_share, fees_usd: r.fees_usd, hours: r.hours,
}));
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: boardRows })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`radar-8: screenshots/ holds ${shots.length} images, need 3\n`);
  process.exit(1);
}

// The dossier is written last and exactly as buildDossier returns it.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
}));

process.stdout.write(
  `radar-8: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} watchlist, ${board.length} ranked ` +
  `(FARM ${radar.verdictCounts.FARM}, MARGINAL ${radar.verdictCounts.MARGINAL}, SKIP ${radar.verdictCounts.SKIP})\n` +
  `radar-8: miss LOO x${radar.kpi.missLoo} WF x${radar.kpi.missWf} LOFO x${radar.kpi.missLofo} LOCO x${radar.kpi.missLoco}; ` +
  `conformal coverage ${(radar.kpi.coverage50 * 100).toFixed(0)}%/${(radar.kpi.coverage80 * 100).toFixed(0)}%; Brier ${radar.kpi.brier} vs base ${radar.kpi.brierBase}\n`,
);
