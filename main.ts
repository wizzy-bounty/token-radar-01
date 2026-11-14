// Token launch radar — the program.
//
// Reads the sealed snapshot, scores every farmable pre-token protocol with
// the model in lib/model.ts, and writes the handover into the output
// directory: board.json (the ranked board), data.js (the dashboard's
// dataset), dashboard/ and screenshots/ (copied from this repository) and
// dossier.json (built with the kit's vendor library). Standard library
// only, no network, deterministic: two runs write the same bytes.

import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, buildRadar, dataScript, type Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = '/input/snapshot.json';
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && argv[i + 1]) input = argv[++i];
    else if (argv[i] === '--output' && argv[i + 1]) output = argv[++i];
  }
  return { input, output };
}

function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));
  const snapshot = JSON.parse(readFileSync(input, 'utf8')) as Snapshot;

  const board = buildBoard(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    console.error(`board self-check failed: ${issue}`);
    process.exit(1);
  }
  const radar = buildRadar(snapshot, board);

  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(output, 'data.js'), dataScript(radar));
  cpSync(join(here, 'dashboard'), join(output, 'dashboard'), { recursive: true });
  cpSync(join(here, 'screenshots'), join(output, 'screenshots'), { recursive: true });
  const dossier = buildDossier(output, { text_max_bytes: 65536 });
  writeFileSync(join(output, 'dossier.json'), dossier);

  console.log(
    `token radar: ${board.length} rows, ${radar.live_size} live comps, dossier ${dossier.length} bytes -> ${output}`,
  );
}

main();
