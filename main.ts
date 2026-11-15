// Token Radar — entry point.
//
// Reads the sealed snapshot, builds the radar with lib/model.ts, and writes
// the four outputs the gate expects: board.json (the ranked board), data.js
// (the dashboard's data, beside the page), dashboard/ and screenshots/
// copied through, and dossier.json from vendor/makefun-board.ts. The build
// is a pure function of the snapshot: two runs write the same bytes.

import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, type Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const inputPath =
  argValue('--input') ?? process.env.MAKEFUN_INPUT ?? (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '/input/snapshot.json');
const outputDir = argValue('--output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const root = dirname(fileURLToPath(import.meta.url));

const snapshot = JSON.parse(readFileSync(inputPath, 'utf8')) as Snapshot;
const radar = buildRadar(snapshot);

mkdirSync(outputDir, { recursive: true });

// board.json — the ranked board the gate reads.
const board = {
  model: radar.version,
  as_of: radar.asOf,
  rows: radar.rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.impliedValueUsd,
    band_low_usd: r.bandLowUsd,
    band_high_usd: r.bandHighUsd,
    tvl_usd: r.tvlUsd,
    category: r.category,
    verdict: r.verdict,
    farm_steps: r.farmSteps,
  })),
};
writeFileSync(join(outputDir, 'board.json'), JSON.stringify(board, null, 1) + '\n');

// data.js — everything the dashboard renders, beside the page.
writeFileSync(join(outputDir, 'data.js'), 'window.RADAR_DATA = ' + JSON.stringify(radar) + ';\n');

// The dashboard and the screenshots are handed in as they stand in the repo.
cpSync(join(root, 'dashboard'), join(outputDir, 'dashboard'), { recursive: true });
cpSync(join(root, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });

// dossier.json — the judge's view, built by the kit's own library.
const dossier = buildDossier(outputDir, { text_max_bytes: 65536 });
writeFileSync(join(outputDir, 'dossier.json'), dossier);

console.log(
  `radar-5: ${radar.rows.length} rows, ${radar.comps.length} comps, dossier ${dossier.length} bytes -> ${outputDir}`,
);
