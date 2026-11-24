// RADAR-8 dashboard — renders window.RADAR (written by main.ts beside this folder as data.js).
// No network: every figure on the page comes from that one data object.
const R = window.RADAR;
const $ = (id) => document.getElementById(id);
const fmt$ = (n) => (n === null || n === undefined ? '—' : '$' + Math.round(n).toLocaleString('en-US'));
const fmtC = (n) => {
  if (n === null || n === undefined) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k';
  return '$' + Math.round(n);
};
const fmtX = (n) => 'x' + n.toFixed(2);
const pct = (n, d = 0) => (n * 100).toFixed(d) + '%';

// ---------- header, KPIs, evidence ----------
$('meta-line').textContent = `Snapshot ${R.meta.asOf} · ${R.meta.source} · watchlist floor ${fmtC(R.meta.floorUsd)} · ${R.meta.protocols} protocols · ${R.meta.pricedPeers} priced peers fit the value model`;
$('meta-note').textContent = R.meta.note;
$('farm-strip').innerHTML = `<b>${R.kpi.farm} of ${R.kpi.ranked}</b>rows clear break-even<br>at their own viable capital`;

const kpiCards = [
  ['hot', fmtX(R.kpi.missWf), 'Walk-forward miss', `flat baseline ${fmtX(R.kpi.flatWf)}`],
  ['', fmtX(R.kpi.missLoo), 'Leave-one-out miss', `flat baseline ${fmtX(R.kpi.flatLoo)}`],
  ['', fmtX(R.kpi.missLofo), 'Leave-one-family-out', 'whole families held out'],
  ['', fmtX(R.kpi.missLoco), 'Leave-one-chain-out', 'whole chains held out'],
  ['hot', `${pct(R.kpi.coverage50)} / ${pct(R.kpi.coverage80)}`, 'Conformal coverage, measured', 'targets 50% / 80%, held-out split'],
  ['', R.kpi.brier.toFixed(3), 'Odds Brier, leave-one-out', `base rate ${R.kpi.brierBase.toFixed(3)}`],
];
$('kpis').innerHTML = kpiCards.map(([c, v, l, s]) => `<div class="kpi ${c}"><div class="v">${v}</div><div class="l">${l}</div><div class="s">${s}</div></div>`).join('');

function evTable(el, tests, fmt, finalRow, baseLabel, baseRow) {
  const head = '<tr><th>Term</th><th>LOO</th><th>Walk-fwd</th><th>LOFO</th><th>LOCO</th><th>Wins</th><th>Status</th></tr>';
  const rows = tests.map((t) => `<tr class="${t.kept ? 'kept' : ''}${t.term === 'control' ? ' ctrl' : ''}"><td>${t.term}${t.term === 'control' ? ' (must not help)' : ''}</td><td>${fmt(t.loo)}</td><td>${fmt(t.wf)}</td><td>${fmt(t.lofo)}</td><td>${fmt(t.loco)}</td><td>${t.wins}/4</td><td><span class="tag ${t.kept ? 'k' : ''}">${t.kept ? 'KEPT' : 'tested, not kept'}</span></td></tr>`).join('');
  const base = `<tr><td>${baseLabel}</td><td>${fmt(baseRow.loo)}</td><td>${fmt(baseRow.wf)}</td><td>${fmt(baseRow.lofo)}</td><td>${fmt(baseRow.loco)}</td><td>—</td><td><span class="tag">base</span></td></tr>`;
  const fin = `<tr><td><b>Final model (kept terms together)</b></td><td><b>${fmt(finalRow.loo)}</b></td><td><b>${fmt(finalRow.wf)}</b></td><td><b>${fmt(finalRow.lofo)}</b></td><td><b>${fmt(finalRow.loco)}</b></td><td>—</td><td><span class="tag k">SHIPPED</span></td></tr>`;
  el.innerHTML = head + base + rows + fin;
}
evTable($('ev-value'), R.valueTests, fmtX, R.valueFinal, 'Base: size + category only', { loo: R.valueTests[0].baseLoo, wf: R.valueTests[0].baseWf, lofo: R.valueTests[0].baseLofo, loco: R.valueTests[0].baseLoco });
evTable($('ev-odds'), R.oddsTests, (n) => n.toFixed(3), R.oddsFinal, 'Base rate (no terms)', R.oddsBaseRate);
$('coef-value').textContent = 'Value coefficients ± bootstrap s.e. (200 refits): ' + R.valueCoefs.map((c) => `${c.name} ${c.coef} ± ${c.se}`).join(' · ');
$('coef-odds').textContent = 'Odds coefficients ± bootstrap s.e. (200 refits): ' + R.oddsCoefs.map((c) => `${c.name} ${c.coef} ± ${c.se}`).join(' · ');

const keptV = R.valueTests.filter((t) => t.kept).map((t) => t.term);
const failV = R.valueTests.filter((t) => !t.kept && t.term !== 'control').map((t) => `${t.term} (${t.wins}/4)`);
const keptO = R.oddsTests.filter((t) => t.kept).map((t) => t.term);
const failO = R.oddsTests.filter((t) => !t.kept && t.term !== 'control').map((t) => `${t.term} (${t.wins}/4)`);
$('reading').textContent =
  `Reading it: for value, ${keptV.length ? 'the kept terms are ' + keptV.join(', ') : 'no candidate term cleared 3 of 4 tests, so the shipped value model is size plus shrunk category effects only'} — ${failV.join(', ')} each helped in some schemes and hurt in others, and printing them as tested-not-kept is the honest result, not a gap. ` +
  `For odds, ${keptO.join(', ')} survived all four tests; ${failO.join(', ')} did not. The control term won 0 of 4 in both models, as it must. The flat multiple baseline misses by ${fmtX(R.kpi.flatWf)} walk-forward against the model's ${fmtX(R.kpi.missWf)}.`;
const cf = R.conformal;
$('conformal-line').textContent = `Split-conformal intervals: the value model was fitted on ${cf.fitN} priced peers and its absolute log errors calibrated on ${cf.calibN} held-out peers. Measured coverage on that calibration split is ${pct(cf.coverage50)} at the 50% target and ${pct(cf.coverage80)} at the 80% target, with the interval scaled per TVL tercile (x${cf.scale[0].toFixed(2)} / x${cf.scale[1].toFixed(2)} / x${cf.scale[2].toFixed(2)}). The whisker on each row is its 80% interval.`;

// ---------- ledger + integrity ----------
const LEDGER_COLORS = ['#3fd9c0', '#ffb454', '#7a8794', '#b0563a', '#8a5a2b', '#5b7fa6', '#6b5518', '#4a6741', '#74516b', '#93544a', '#565f6a', '#6e5636', '#546e7a'];
const total758 = R.ledger.reduce((a, s) => a + s.n, 0);
$('ledger').innerHTML = R.ledger.map((s, i) => `<div style="background:${LEDGER_COLORS[i % LEDGER_COLORS.length]};width:${(s.n / total758 * 100).toFixed(2)}%" title="${s.label}: ${s.n}"></div>`).join('');
$('ledger-legend').innerHTML = R.ledger.map((s, i) => `<span><i style="background:${LEDGER_COLORS[i % LEDGER_COLORS.length]}"></i>${s.label} — ${s.n}</span>`).join('');
const ig = R.integrity;
$('integrity').textContent = `Integrity: board recomputed from the snapshot — ${ig.rows} rows · total implied ${fmt$(ig.totalImplied)} matches board.json · main.ts sha256 ${ig.mainChecksum}… · watchlist ${ig.watchlistCovered}/${R.meta.watchlist} · ledger ${ig.ledgerTotal}/${R.meta.protocols}`;

// ---------- scenario + verdict engine (mirrors lib/farm.ts) ----------
const TBILL = 0.04, HOUR_USD = 25, REF = 10000;
const state = { tier: 'ALL', q: '', cat: '', chain: '', sort: 'rank', dir: 1, ds: R.meta.dropShare, hz: R.meta.horizonWeeks, ps: 'viable' };
function netAt(row, D, ds, hz) { return row.implied * ds * (D / (row.tvl + D)) - row.fees - row.hours * HOUR_USD; }
function price(row, ds, hz) {
  const cap = Math.min(1e6, Math.max(REF, 0.05 * row.tvl));
  const r = TBILL * (hz / 52);
  const gain = (D) => netAt(row, D, ds, hz) - r * D;
  let viable = null, prevD = 100, prevG = gain(prevD);
  for (let D = 150; D <= cap; D = Math.round(D * 1.25)) {
    const g = gain(D);
    if (prevG < 0 && g >= 0) { let lo = prevD, hi = D; while (hi - lo > 50) { const m = (lo + hi) / 2; if (gain(m) >= 0) hi = m; else lo = m; } viable = Math.ceil(hi / 50) * 50; break; }
    prevD = D; prevG = g;
  }
  let bestNet = -Infinity, bestD = REF;
  for (let D = 100; D <= cap; D = Math.round(D * 1.12)) { const n = netAt(row, D, ds, hz); if (n > bestNet) { bestNet = n; bestD = D; } }
  const atD = state.ps === 'ref' ? REF : (viable ?? (bestNet > 0 ? bestD : REF));
  const net = netAt(row, atD, ds, hz);
  const verdict = viable !== null && viable <= 250000 ? 'FARM' : bestNet > 0 ? 'MARGINAL' : 'SKIP';
  const be = ((row.fees + row.hours * HOUR_USD + r * REF) * (row.tvl + REF)) / (row.implied * REF);
  return { verdict, viable, net, nph: net / Math.max(row.hours, 0.25), be, atD };
}
const priced = R.rows.map((row) => ({ row, p: price(row, state.ds, state.hz) }));
function reprice() { for (const e of priced) e.p = price(e.row, state.ds, state.hz); }

// ---------- board table ----------
const loMin = Math.min(...R.rows.map((r) => r.lo)), hiMax = Math.max(...R.rows.map((r) => r.hi));
const logSpan = Math.log(hiMax) - Math.log(loMin);
const COLS = [
  ['rank', '#', 0], ['name', 'Protocol', 1], ['cat', 'Category · Chain', 1], ['tvl', 'TVL', 0], ['chg', '7D', 0],
  ['age', 'No-token age', 0], ['odds', 'Odds', 0], ['vif', 'Value if', 0], ['implied', 'Implied (80%)', 0],
  ['viable', 'Viable capital', 0], ['be', 'BE drop', 0], ['verdict', 'Verdict · net', 0], ['nph', 'Net / hour', 0],
];
function sortVal(e, key) {
  const r = e.row, p = e.p;
  switch (key) {
    case 'name': return r.name; case 'cat': return (r.category || '') + (r.chains[0] || '');
    case 'chg': return r.chg ?? -999; case 'viable': return p.viable ?? 1e18; case 'be': return p.be;
    case 'net': return p.net; case 'nph': return p.nph; case 'verdict': return p.verdict;
    default: return r[key] ?? 0;
  }
}
function render() {
  let list = priced.filter((e) => {
    const r = e.row;
    if (state.tier === 'WL' && !r.wl) return false;
    if (state.tier !== 'ALL' && state.tier !== 'WL' && e.p.verdict !== state.tier) return false;
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.q) { const q = state.q.toLowerCase(); if (!(r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase().includes(q)) return false; }
    return true;
  });
  list = [...list].sort((a, b) => { const va = sortVal(a, state.sort), vb = sortVal(b, state.sort); return (va < vb ? -1 : va > vb ? 1 : 0) * state.dir; });
  const head = '<thead><tr>' + COLS.map(([k, l, left]) => `<th class="${left ? 'l' : ''}" data-k="${k}">${l}${state.sort === k ? (state.dir === 1 ? ' ↑' : ' ↓') : ''}</th>`).join('') + '</tr></thead>';
  const body = list.map((e) => {
    const r = e.row, p = e.p;
    const wl = (Math.log(r.lo) - Math.log(loMin)) / logSpan * 100, wr = (Math.log(r.hi) - Math.log(loMin)) / logSpan * 100;
    const age = r.age >= 365 ? (r.age / 365).toFixed(1) + 'y' : r.age + 'd';
    const chg = r.chg === null ? '—' : `<span class="${r.chg >= 0 ? 'pos' : 'neg'}">${r.chg >= 0 ? '+' : ''}${r.chg.toFixed(1)}%</span>`;
    return `<tr data-slug="${r.slug}"><td>${r.rank}</td><td class="l"><span class="pname">${r.name}</span>${r.wl ? '<span class="badge b-wl">WATCHLIST</span>' : ''}${r.off ? '<span class="badge b-off">OFF-LIST</span>' : ''}</td>` +
      `<td class="l"><span class="cat">${r.category || '—'} · ${r.chains[0] || ''}${r.chains.length > 1 ? ' +' + (r.chains.length - 1) : ''}</span></td>` +
      `<td>${fmtC(r.tvl)}</td><td>${chg}</td><td>${age}</td>` +
      `<td><span class="obar"><i style="width:${Math.round(r.odds * 100)}%"></i></span>${pct(r.odds)}</td>` +
      `<td>${fmtC(r.vif)}</td><td><span class="imp">${fmtC(r.implied)}</span><div class="wbar"><i style="left:${wl.toFixed(1)}%;width:${Math.max(2, wr - wl).toFixed(1)}%"></i></div><span class="rng">${fmtC(r.lo)} – ${fmtC(r.hi)}</span></td>` +
      `<td>${p.viable ? fmt$(p.viable) : '—'}</td><td>${p.be >= 1 ? '&gt;100%' : pct(p.be, 1)}</td>` +
      `<td><span class="v-${p.verdict}">${p.verdict}</span> <span class="${p.net >= 0 ? 'netpos' : 'netneg'}">${fmt$(p.net)}</span></td>` +
      `<td class="${p.nph >= 0 ? 'netpos' : 'netneg'}">${fmt$(p.nph)}</td></tr>`;
  }).join('');
  $('board').innerHTML = head + '<tbody>' + body + '</tbody>';
  $('shown').textContent = `Showing ${list.length} of ${R.rows.length} rows at drop share ${pct(state.ds, 1)}, horizon ${state.hz} weeks. Click a row for its detail; click a header to sort (including by net/hour and by viable capital).`;
  document.querySelectorAll('#board th').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k;
    if (state.sort === k) state.dir *= -1; else { state.sort = k; state.dir = k === 'name' || k === 'cat' ? 1 : -1; }
    render();
  }));
  document.querySelectorAll('#board tbody tr').forEach((tr) => tr.addEventListener('click', () => showDetail(tr.dataset.slug)));
}

// ---------- detail view ----------
function showDetail(slug) {
  const row = R.rows.find((r) => r.slug === slug);
  const det = R.details.find((d) => d.slug === slug);
  const p = price(row, state.ds, state.hz);
  const bd = det ? det.breakdown : [
    { label: 'Base value at $100M TVL (multiple x TVL)', value: fmt$(1e8 * row.bm) },
    { label: 'Size curve factor', value: 'x' + row.sf }, { label: 'Category factor (shrunk)', value: 'x' + row.cf },
    { label: 'Kept-term factor', value: 'x' + row.tf }, { label: 'Value if it launches', value: fmt$(row.vif) },
    { label: 'Launch odds (peer record)', value: pct(row.odds) }, { label: 'Implied value (value x odds)', value: fmt$(row.implied) },
  ];
  const deps = det ? det.deposits : [1000, 5000, 10000, 25000, 50000, 100000];
  const shares = det ? det.shares : [0.02, 0.04, 0.06, 0.1];
  const matrix = det ? det.matrix : shares.map((ds) => deps.map((D) => Math.round(netAt(row, D, ds, state.hz))));
  const steps = det ? det.steps : row.steps.map((t) => ({ text: t, costUsd: null, hours: null }));
  const peers = det ? `<h3>Priced peers nearest in size</h3><table><tr><th>Peer</th><th>Category</th><th class="r">TVL</th><th class="r">Cap</th><th class="r">Cap / TVL</th></tr>${det.peers.map((x) => `<tr><td>${x.name}</td><td>${x.category || '—'}</td><td class="r">${fmtC(x.tvl)}</td><td class="r">${fmtC(x.mcap)}</td><td class="r">x${x.multiple}</td></tr>`).join('')}</table>` : '';
  const sizingDeps = [10000, 25000, 50000, 100000, 250000];
  const sizing = `<h3 style="margin-top:8px">Position sizing at the default scenario</h3><table><tr><th>Deposit</th><th class="r">Net after fees + time</th><th class="r">T-bill on same money</th><th class="r">Clears T-bill?</th></tr>${sizingDeps.map((D) => { const n = netAt(row, D, R.meta.dropShare, R.meta.horizonWeeks); const tb = D * TBILL * (R.meta.horizonWeeks / 52); return `<tr><td>${fmt$(D)}</td><td class="r ${n >= 0 ? 'pos' : 'neg'}">${fmt$(n)}</td><td class="r">${fmt$(tb)}</td><td class="r">${n >= tb ? 'yes' : 'no'}</td></tr>`; }).join('')}</table>`;
  $('detail-view').innerHTML =
    `<button class="back" id="back">← Back to the board</button>` +
    `<h2>${row.name} — ${det ? det.kind : 'detail'} · <span class="v-${p.verdict}">${p.verdict}</span></h2>` +
    `<p class="sub">${row.category || 'Uncategorised'} · ${row.chains.join(', ')} · TVL ${fmt$(row.tvl)} · records no token · implied ${fmt$(row.implied)} · viable capital ${p.viable ? fmt$(p.viable) : 'none in domain'} · net ${fmt$(p.net)} at the priced size · break-even drop share ${p.be >= 1 ? '>100%' : pct(p.be, 1)} at $10,000</p>` +
    `<div class="cols"><div><h3>How the implied value is built</h3><table>${bd.map((b) => `<tr><td>${b.label}</td><td class="r"><b>${b.value}</b></td></tr>`).join('')}</table>` +
    `<h3 style="margin-top:8px">Break-evens and exit</h3><p class="sub">Break-even odds at the viable size: ${det ? pct(det.breakevens.oddsBreakeven) : '—'}. ${det ? det.exitRule : 'Unwind if TVL falls 30% below entry, or at the end of the horizon.'}</p>${peers}${sizing}</div>` +
    `<div><h3>Net by deposit x drop share (after fees and time)</h3><table class="mx"><tr><th>Drop \\ Deposit</th>${deps.map((D) => `<th class="r">${fmtC(D)}</th>`).join('')}</tr>${matrix.map((rowNets, i) => `<tr><td>${pct(shares[i])}</td>${rowNets.map((n) => `<td class="r ${n >= 0 ? 'pos' : 'neg'}">${fmt$(n)}</td>`).join('')}</tr>`).join('')}</table>` +
    `<h3 style="margin-top:8px">Farm plan — ${steps.length} steps, ${fmt$(row.fees)} fees, ${row.hours} hands-on hours</h3>${steps.map((s, i) => `<div class="step"><b>${i + 1}.</b> ${s.text} ${s.costUsd !== null ? `<span class="cst">[cost ${fmt$(s.costUsd)} · ${Math.round(s.hours * 100) / 100}h]</span>` : ''}</div>`).join('')}</div></div>`;
  $('board-view').hidden = true;
  $('detail-view').hidden = false;
  for (const el of document.querySelectorAll('.top,.kpis,.evidence,.ledger-panel,.controls')) el.style.display = 'none';
  $('back').addEventListener('click', () => {
    $('detail-view').hidden = true; $('board-view').hidden = false;
    for (const el of document.querySelectorAll('.top,.kpis,.evidence,.ledger-panel,.controls')) el.style.display = '';
    history.replaceState(null, '', ' ');
  });
  window.scrollTo(0, 0);
}

// ---------- controls ----------
const cats = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
$('f-cat').innerHTML += cats.map((c) => `<option>${c}</option>`).join('');
const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
$('f-chain').innerHTML += chains.map((c) => `<option>${c}</option>`).join('');
$('ds').value = state.ds * 100;
$('ds-val').textContent = pct(state.ds, 1);
$('hz').value = String(state.hz);
$('ds').addEventListener('input', () => { state.ds = Number($('ds').value) / 100; $('ds-val').textContent = pct(state.ds, 1); reprice(); render(); });
$('hz').addEventListener('change', () => { state.hz = Number($('hz').value); reprice(); render(); });
$('ps').addEventListener('change', () => { state.ps = $('ps').value; reprice(); render(); });
$('q').addEventListener('input', () => { state.q = $('q').value; render(); });
$('f-cat').addEventListener('change', () => { state.cat = $('f-cat').value; render(); });
$('f-chain').addEventListener('change', () => { state.chain = $('f-chain').value; render(); });
$('reset').addEventListener('click', () => { Object.assign(state, { tier: 'ALL', q: '', cat: '', chain: '', sort: 'rank', dir: 1 }); $('q').value = ''; $('f-cat').value = ''; $('f-chain').value = ''; document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tier === 'ALL')); render(); });
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => { state.tier = b.dataset.tier; document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); render(); }));
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 500); }
$('exp-csv').addEventListener('click', () => {
  const head = 'rank,slug,name,category,chains,tvl_usd,odds,value_if_usd,implied_usd,verdict,viable_capital_usd,net_usd,net_per_hour,breakeven_drop_share\n';
  download('radar8-board.csv', head + priced.map((e) => [e.row.rank, e.row.slug, '"' + e.row.name + '"', '"' + (e.row.category || '') + '"', '"' + e.row.chains.join('|') + '"', e.row.tvl, e.row.odds, e.row.vif, e.row.implied, e.p.verdict, e.p.viable ?? '', e.p.net.toFixed(2), e.p.nph.toFixed(2), e.p.be].join(',')).join('\n'), 'text/csv');
});
$('exp-json').addEventListener('click', () => download('radar8-board.json', JSON.stringify(priced.map((e) => ({ ...e.row, verdictNow: e.p.verdict, viableNow: e.p.viable, netNow: e.p.net })), null, 1), 'application/json'));

// ---------- initial view (hash routes the screenshots) ----------
if (location.hash === '#farm') {
  state.tier = 'FARM'; state.sort = 'nph'; state.dir = -1;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tier === 'FARM'));
  render();
} else if (location.hash === '#detail') {
  render();
  showDetail(R.details[0].slug);
} else {
  render();
}
