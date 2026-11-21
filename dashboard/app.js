// Launch Radar — renders window.RADAR_DATA (written by main.ts beside this
// page) into the board, the live-token comp table, the audit tables and the
// per-protocol detail view. No network, no framework: the page is the data.

'use strict';

const D = window.RADAR_DATA;
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(x) {
  if (x === null || x === undefined) return '—';
  if (Math.abs(x) >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
  if (Math.abs(x) >= 1e6) return '$' + (x / 1e6).toFixed(1) + 'M';
  if (Math.abs(x) >= 1e3) return '$' + (x / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(x).toString();
}
function mult(x) { return x === null || x === undefined ? '—' : x.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + 'x'; }
function pct(x) { return x === null || x === undefined ? '—' : (x >= 0 ? '+' : '') + x.toFixed(1) + '%'; }
function tenure(days) {
  if (days === null || days === undefined) return '—';
  if (days >= 730) return (days / 365).toFixed(1) + 'y';
  if (days >= 60) return Math.round(days / 30.4) + 'mo';
  return days + 'd';
}
function factor(x) { return 'x' + x.toFixed(2); }

// ------------------------------------------------------------- masthead

const C = D.census;
$('eyebrow').textContent = `Token launch radar — snapshot of ${D.asOf}, ${C.universe} protocols`;
$('headline').textContent = `${C.ranked} pre-token protocols, ranked by launch score`;
$('lede').innerHTML =
  `Every protocol in the snapshot that records no token and is not a wrapped, staked or bridged product of one that ` +
  `trades — <strong>${C.ranked} ranked</strong>, ${C.setAside} set aside by that product rule, and ` +
  `<strong>${C.tokenRecording} that already record a token</strong> kept off the board and used as the pricing ` +
  `evidence. Launch score = implied value × (0.5 + readiness/100): value says what a launch would be worth, ` +
  `readiness — scale, momentum, tenure, breadth, the watchlist, priced-peer evidence — says how close the protocol ` +
  `looks to being able to launch it. Values come from a size curve fitted on the priced tokens, not from a flat multiple.`;
$('facts').innerHTML = [
  [String(C.ranked), 'pre-token ranked'],
  [`${D.rows.filter((r) => r.watchlist).length}/40`, 'watchlist covered'],
  [String(C.pricedUsable), 'priced comps fitted'],
  [factor(D.backtest.newLoo.medianFactor), 'backtest median error'],
  [factor(D.backtest.oldLoo.medianFactor), 'old model error'],
  [money(Math.max(...D.rows.map((r) => r.impliedValueUsd))), 'top implied value'],
].map(([n, l]) => `<div class="fact"><span class="num">${esc(n)}</span><span class="lab">${esc(l)}</span></div>`).join('');

function pct1(x) { return (x * 100).toFixed(1) + '%'; }

// ------------------------------------------- evidence strip (first screen)

const O = D.odds;
const BT = D.backtest;
const farmable = D.rows.filter((r) => r.verdict === 'Farm' || r.verdict === 'Thin').length;
$('ev-grid').innerHTML = [
  [factor(BT.newLoo.medianFactor), 'out-of-sample miss, LOO'],
  [BT.withinBandPct.toFixed(0) + '%', 'of real caps inside the printed band (stated 50%)'],
  [O.brier.toFixed(3) + ' vs ' + O.baseBrier.toFixed(3), 'token-odds Brier vs base rate'],
  [`${D.rows.filter((r) => r.watchlist).length}/40`, 'watchlist ranked'],
  [String(farmable), 'worth farming at the band low end'],
  [money(D.rows[0].scoreUsd), 'top launch score — ' + D.rows[0].name],
].map(([n, l]) => `<div class="ev"><span class="num">${esc(n)}</span><span class="lab">${esc(l)}</span></div>`).join('');
$('ev-note').innerHTML =
  `Every number above is recomputed from the snapshot by the program, not typed in. The band honesty is leave-one-out: ` +
  `each priced token is priced by a model fitted without it, and ${BT.withinBandPct.toFixed(1)}% of the real market caps land ` +
  `inside the P25–P75 band the page prints (stated 50%), ${BT.withinWidePct.toFixed(1)}% inside the P10–P90 band (stated 80%). ` +
  `Token odds are the share of a protocol's own category peers that already record a token, smoothed toward the global ` +
  `${pct1(O.globalRate)}; the category odds beat the base rate on Brier score (${O.brier.toFixed(3)} vs ${O.baseBrier.toFixed(3)}), ` +
  `so they carry signal — but odds are not a promise: most categories sit well below even odds.`;

// ------------------------------------------------------------ model band

const F = D.fit;
$('model-sub').innerHTML =
  `Fitted on the <strong>${F.compCount} priced tokens with a usable price</strong> (a recorded market cap above zero). ` +
  `A further ${C.pricedDead} records name a token but a price of zero, and ${C.pricedNone} record a token with no ` +
  `price at all — neither is used as evidence. Growth and tenure were tested as value terms and dropped: they are ` +
  `shown as signals on each row, never priced in.`;
$('formula').textContent = `log10(value) = ${F.intercept.toFixed(2)} + ${F.slope.toFixed(2)} x log10(TVL) + category offset`;
$('fit-note').innerHTML =
  `R&sup2; ${F.r2.toFixed(2)} on the fitted tokens. The multiple falls as a protocol grows — the market pays ` +
  `proportionally less for the next dollar of TVL at size. The old flat model used one median multiple per ` +
  `category (market median ${mult(F.marketMedianMultiple)}) at any size.`;
$('curve-range').innerHTML =
  `Along the curve the multiple runs from <strong>${mult(D.curveTable[0].multiple)}</strong> at ` +
  `${money(D.curveTable[0].tvlUsd)} of TVL to <strong>${mult(D.curveTable[D.curveTable.length - 1].multiple)}</strong> ` +
  `at ${money(D.curveTable[D.curveTable.length - 1].tvlUsd)} — the full table is in the audit section below.`;
$('curve-table').innerHTML =
  `<tr><th>Protocol TVL</th><th>Curve multiple</th><th>Implied value</th></tr>` +
  D.curveTable.map((r) => `<tr><td>${money(r.tvlUsd)}</td><td>${mult(r.multiple)}</td><td>${money(r.tvlUsd * r.multiple)}</td></tr>`).join('');

const B = D.backtest;
$('backtest-table').innerHTML =
  `<tr><th>Model</th><th>Median error</th><th>Mean |log err|</th><th>Within x2</th></tr>` +
  `<tr class="win"><td>Size curve + offset (this board)</td><td>${factor(B.newLoo.medianFactor)}</td><td>${B.newLoo.meanLogError.toFixed(3)}</td><td>${B.newLoo.within2Pct.toFixed(0)}%</td></tr>` +
  `<tr><td>Category median multiple (old)</td><td>${factor(B.oldLoo.medianFactor)}</td><td>${B.oldLoo.meanLogError.toFixed(3)}</td><td>${B.oldLoo.within2Pct.toFixed(0)}%</td></tr>`;
$('backtest-note').innerHTML =
  `Leave-one-out over all ${B.n} priced tokens: each is priced by a model fitted without it, then compared with ` +
  `the market cap it actually carries. Time split (fit the older half, price the newer): median error ` +
  `<strong>${factor(B.newSplitMedianFactor)}</strong> curve against <strong>${factor(B.oldSplitMedianFactor)}</strong> median model. ` +
  `Each row's band is the curve model's own leave-one-out spread — and the band is honest: ` +
  `<strong>${B.withinBandPct.toFixed(1)}%</strong> of the real market caps land inside the P25–P75 band the page prints ` +
  `(stated 50%), ${B.withinWidePct.toFixed(1)}% inside the P10–P90 band (stated 80%).`;

// ------------------------------------------------------------ start here

function pickReason(r) {
  if (r.categoryRank === 1) return `The curve's #1 in ${esc(r.category)} of ${r.categoryCount} on the board.`;
  if (r.watchlist) return 'On the 40-protocol watchlist — above the $50M floor with no token recorded.';
  if (r.change7d !== null && r.change7d >= 15) return `TVL up ${r.change7d.toFixed(1)}% in seven days — momentum the curve does not price.`;
  if (r.ageDays !== null && r.ageDays >= 730) return `Token-free for ${(r.ageDays / 365).toFixed(1)} years at ${money(r.tvlUsd)} of TVL.`;
  return `Band low end still ${money(r.bandLowUsd)} — the plan stays cheap against it.`;
}
function bandBar(r) {
  // Log-scale bar across the row's own value band, marker at the implied value.
  const lo = Math.log10(Math.max(r.bandLowUsd, 1));
  const hi = Math.log10(Math.max(r.bandHighUsd, r.bandLowUsd + 1));
  const mid = Math.log10(Math.max(r.impliedValueUsd, 1));
  const x = Math.round(((mid - lo) / (hi - lo)) * 100);
  return `<svg class="bandbar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">` +
    `<rect x="0" y="4" width="100" height="2" rx="1" fill="#31405a"/>` +
    `<rect x="0" y="4" width="${x}" height="2" rx="1" fill="#3ec6b8"/>` +
    `<circle cx="${x}" cy="5" r="3.2" fill="#f2b544"/></svg>`;
}
function gaugeBar(v) {
  return `<span class="gauge"><span class="gauge-fill" style="width:${v}%"></span></span>`;
}
$('picks').innerHTML = D.rows.slice(0, 5).map((r) =>
  `<button class="pick feature" type="button" data-slug="${esc(r.slug)}">
     <span class="p-rank">#${r.rank} — ${esc(r.verdict.toUpperCase())} · value rank #${r.valueRank}</span>
     <span class="p-name">${esc(r.name)}</span>
     <span class="p-val">Score ${money(r.scoreUsd)}</span> <span class="sub">implied ${money(r.impliedValueUsd)} · band ${money(r.bandLowUsd)} – ${money(r.bandHighUsd)}</span>
     ${bandBar(r)}
     <span class="p-odds">Token odds ${pct1(r.tokenOdds)} <span class="odds-bar"><span style="width:${Math.round(r.tokenOdds * 100)}%"></span></span></span>
     <span class="p-ready">Readiness ${r.readiness}/100 ${gaugeBar(r.readiness)}</span>
     <span class="p-why">${pickReason(r)}</span>
   </button>`).join('');

// ----------------------------------------------------------------- board

const state = { q: '', cat: '', watchOnly: false, sort: 'score', tab: 'board' };

const cats = [...new Set(D.rows.map((r) => r.category ?? 'Uncategorised'))].sort();
$('cat').innerHTML = `<option value="">All categories</option>` + cats.map((c) => `<option>${esc(c)}</option>`).join('');

function rowMatches(r) {
  if (state.watchOnly && !r.watchlist) return false;
  if (state.cat && (r.category ?? 'Uncategorised') !== state.cat) return false;
  if (state.q && !(r.name.toLowerCase().includes(state.q) || r.slug.includes(state.q))) return false;
  return true;
}
function sortedRows(list) {
  const by = {
    score: (a, b) => b.scoreUsd - a.scoreUsd,
    rank: (a, b) => a.rank - b.rank,
    readiness: (a, b) => b.readiness - a.readiness,
    tvl: (a, b) => b.tvlUsd - a.tvlUsd,
    growth: (a, b) => (b.change7d ?? -1e9) - (a.change7d ?? -1e9),
    tenure: (a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1),
    band: (a, b) => b.bandLowUsd - a.bandLowUsd,
  }[state.sort];
  return [...list].sort(by);
}
function verdictChip(v) {
  const cls = v === 'Farm' ? 'farm' : v === 'Thin' ? 'thin' : 'skip';
  return `<span class="chip ${cls}">${esc(v)}</span>`;
}
function renderBoard() {
  const list = sortedRows(D.rows.filter(rowMatches));
  $('row-count').textContent = `${list.length} of ${D.rows.length} protocols`;
  $('board-table').innerHTML =
    `<thead><tr><th>#</th><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">7d</th>` +
    `<th class="num">Token-free</th><th class="num">Token odds</th><th class="num">Readiness</th>` +
    `<th class="num">Implied value</th><th class="num">Band</th><th class="num">Score</th><th>Verdict</th></tr></thead><tbody>` +
    list.map((r) => `<tr data-slug="${esc(r.slug)}">
      <td>${r.rank}</td>
      <td><span class="name">${esc(r.name)}</span>${r.watchlist ? ' <span class="chip watch">watchlist</span>' : ''}<span class="sub">${esc(r.signal)}</span></td>
      <td>${esc(r.category ?? '—')}</td>
      <td class="num">${money(r.tvlUsd)}</td>
      <td class="num ${r.change7d === null ? '' : r.change7d >= 0 ? 'pos' : 'neg'}">${pct(r.change7d)}</td>
      <td class="num">${tenure(r.ageDays)}</td>
      <td class="num">${pct1(r.tokenOdds)}</td>
      <td class="num"><span class="rnum">${r.readiness}</span>${gaugeBar(r.readiness)}</td>
      <td class="num val">${money(r.impliedValueUsd)}</td>
      <td class="num band-cell">${money(r.bandLowUsd)} – ${money(r.bandHighUsd)}</td>
      <td class="num val">${money(r.scoreUsd)}</td>
      <td>${verdictChip(r.verdict)}</td></tr>`).join('') + `</tbody>`;
  for (const tr of $('board-table').querySelectorAll('tbody tr')) {
    tr.addEventListener('click', () => openDetail(tr.dataset.slug));
  }
}

function renderLive() {
  $('live-table').innerHTML =
    `<thead><tr><th>Live token</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th>` +
    `<th class="num">Actual</th><th class="num">Curve fit</th><th class="num">Actual / fit</th></tr></thead><tbody>` +
    D.comps.map((c) => `<tr>
      <td><span class="name">${esc(c.name)}</span></td><td>${esc(c.category ?? '—')}</td>
      <td class="num">${money(c.tvlUsd)}</td><td class="num">${money(c.mcapUsd)}</td>
      <td class="num">${mult(c.multiple)}</td><td class="num">${mult(c.fittedMultiple)}</td>
      <td class="num ${c.residualFactor >= 1 ? 'pos' : 'neg'}">${factor(c.residualFactor)}</td></tr>`).join('') + `</tbody>`;
  $('live-note').innerHTML =
    `The comp set: <strong>${C.pricedUsable} tokens with a usable price</strong>, each shown with the multiple it ` +
    `actually trades at and the multiple the curve assigns its size — the fit the board's values come from. ` +
    `${C.pricedDead} further records name a token but carry a price of zero and are excluded as evidence; ` +
    `${C.pricedNone} record a token with no price at all.`;
}

function setTab(tab) {
  state.tab = tab;
  $('tab-board').classList.toggle('active', tab === 'board');
  $('tab-live').classList.toggle('active', tab === 'live');
  $('board-table').classList.toggle('hidden', tab !== 'board');
  $('live-table').classList.toggle('hidden', tab !== 'live');
  $('controls').classList.toggle('hidden', tab !== 'board');
  $('live-note').classList.toggle('hidden', tab !== 'live');
  $('board-title').textContent = tab === 'board' ? 'The board' : 'Live tokens — the comp set';
}

// ---------------------------------------------------------------- detail

function openDetail(slug) {
  const r = D.rows.find((x) => x.slug === slug);
  if (!r) return;
  const dlg = $('detail');
  const facts = [
    [money(r.scoreUsd), 'launch score'],
    [money(r.impliedValueUsd), 'implied value'],
    [`${money(r.bandLowUsd)} – ${money(r.bandHighUsd)}`, 'value band'],
    [money(r.tvlUsd), 'TVL'],
    [mult(r.curveMultiple), 'curve multiple'],
    [r.categoryMedianMultiple === null ? '—' : mult(r.categoryMedianMultiple), 'category median (old)'],
    [`#${r.categoryRank} of ${r.categoryCount}`, `in ${r.category ?? 'its category'}`],
    [tenure(r.ageDays), 'token-free'],
    [pct1(r.tokenOdds), 'token odds (category peers)'],
    [`$${r.planCostUsd.toFixed(2)} / ${r.planHours.toFixed(1)}h`, 'farm plan cost'],
    [money(Math.max(r.netLowUsd, 0)), 'net at band low'],
  ];
  const parts = [
    ['Scale — TVL tier', r.readinessParts.scale, 25],
    ['Momentum — 7d TVL change', r.readinessParts.momentum, 20],
    ['Tenure — token-free age', r.readinessParts.tenure, 20],
    ['Breadth — chains deployed', r.readinessParts.breadth, 10],
    ['House — on the watchlist', r.readinessParts.house, 15],
    ['Evidence — priced peers in category', r.readinessParts.evidence, 10],
  ];
  dlg.innerHTML =
    `<div class="close-row"><button class="close" type="button" id="d-close">Close</button></div>
     <h2>${esc(r.name)} ${verdictChip(r.verdict)}</h2>
     <p class="d-sub">Rank #${r.rank} of ${D.rows.length} — ${esc(r.category ?? 'uncategorised')} — on ${esc(r.chains.join(', ') || '—')} — ${esc(r.signal.toLowerCase())}</p>
     <div class="d-grid">${facts.map(([n, l]) => `<div class="d-fact"><span class="num">${esc(n)}</span><span class="lab">${esc(l)}</span></div>`).join('')}</div>
     <h3>How the value is built</h3>
     <p class="note">The curve gives ${esc(r.name)} a multiple of <strong>${mult(r.curveMultiple)}</strong> at its size ` +
     `(${money(r.tvlUsd)} of TVL). Its category offset is <strong>${r.categoryOffsetLog >= 0 ? '+' : ''}${r.categoryOffsetLog.toFixed(3)}</strong> ` +
     `in log10 — a factor of ${factor(Math.pow(10, r.categoryOffsetLog))} — shrunk from the raw residual of its ` +
     `category's priced tokens. The old model would have used the flat category median of ` +
     `<strong>${r.categoryMedianMultiple === null ? '—' : mult(r.categoryMedianMultiple)}</strong> at any size. ` +
     `The band is the curve model's own leave-one-out spread, and the farm verdict is netted at the band's low end.</p>
     <h3>Launch readiness — ${r.readiness}/100</h3>
     <p class="note">Six public signals, each on a stated scale. Score = implied value × (0.5 + readiness/100) = ` +
     `${money(r.impliedValueUsd)} × ${(0.5 + r.readiness / 100).toFixed(2)} = <strong>${money(r.scoreUsd)}</strong>. ` +
     `Token odds ${pct1(r.tokenOdds)}: the share of ${esc(r.category ?? 'its category')} peers that already record a token, ` +
     `smoothed toward the global ${(O.globalRate * 100).toFixed(1)}% — odds, not a promise.</p>
     <table class="mini"><tr><th>Signal</th><th class="num">Points</th><th class="num">Max</th></tr>` +
     parts.map(([n, v, m]) => `<tr><td>${esc(n)}</td><td class="num">${v}</td><td class="num">${m}</td></tr>`).join('') + `</table>
     ${r.watchOuts.length ? `<h3>Watch-outs</h3><p class="warn">${r.watchOuts.map(esc).join(' · ')}</p>` : ''}
     <h3>Farm plan — ${r.farmSteps.length} steps, $${r.planCostUsd.toFixed(2)}, about ${r.planHours.toFixed(1)}h</h3>
     <ol class="steps">${r.farmSteps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  $('d-close').addEventListener('click', () => dlg.close());
  if (!dlg.open) dlg.showModal();
}

// ---------------------------------------------------------------- wiring

$('q').addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); renderBoard(); });
$('cat').addEventListener('change', (e) => { state.cat = e.target.value; renderBoard(); });
$('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderBoard(); });
$('watch-only').addEventListener('change', (e) => { state.watchOnly = e.target.checked; renderBoard(); });
$('tab-board').addEventListener('click', () => setTab('board'));
$('tab-live').addEventListener('click', () => setTab('live'));
for (const b of $('picks').querySelectorAll('.pick')) {
  b.addEventListener('click', () => openDetail(b.dataset.slug));
}

// Audit table — category medians against the curve offsets.
$('category-table').innerHTML =
  `<thead><tr><th>Category</th><th class="num">Priced comps</th><th class="num">Median multiple (old model)</th><th class="num">Curve offset</th></tr></thead><tbody>` +
  D.categoryStats.map((s) => `<tr><td>${esc(s.category || 'Uncategorised')}</td><td class="num">${s.comps}</td>` +
    `<td class="num">${mult(s.medianMultiple)}</td><td class="num">${factor(Math.pow(10, s.offsetLog))}</td></tr>`).join('') + `</tbody>`;
$('method-note').innerHTML =
  `Method, in one breath: take the ${C.pricedUsable} tokens that already trade with a usable price; fit ` +
  `log10(market cap) on log10(TVL); add each category's mean residual, shrunk by n/(n+15); price every pre-token ` +
  `protocol off that fit; band each price by the fit's own leave-one-out spread; score each protocol's launch ` +
  `readiness from its scale, momentum, token-free tenure, chain breadth, watchlist place and priced-peer evidence; ` +
  `rank by implied value × (0.5 + readiness/100); and net every farm plan at the ` +
  `band's low end. Nothing on this page is a hand-kept list — rerun the program on the snapshot and every number ` +
  `above is rebuilt. Model ${esc(D.version)}.`;

// Screenshot / deep-link state: #p=<slug> opens a detail, #live shows the
// comp set, #cat=<category> filters the board.
function applyHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.get('live')) setTab('live');
  if (h.get('cat')) {
    state.cat = h.get('cat');
    $('cat').value = state.cat;
    renderBoard();
    requestAnimationFrame(() => window.scrollTo(0, $('board-section').offsetTop - 6));
  }
  if (h.get('p')) openDetail(h.get('p'));
}

renderBoard();
renderLive();
applyHash();
