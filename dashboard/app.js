// RADAR-9 dashboard — renders window.RADAR9 (written by main.ts beside this
// page) and re-prices verdicts client-side when the scenario controls move.
// No network, no libraries: the page is the program's own output.
'use strict';
const R = window.RADAR9;
const $ = (id) => document.getElementById(id);
const usd = (n) => (n === null || n === undefined ? '—' : '$' + Math.round(n).toLocaleString('en-US'));
const usd2 = (n) => (n === null || n === undefined ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
const pct = (n, d) => (n * 100).toFixed(d === undefined ? 0 : d) + '%';
const xf = (n) => 'x' + Number(n).toFixed(2);

// ------------------------------------------------ scenario verdicts (mirror of lib/farm.ts)
const WAGE = 25, TBILL = 0.04, REF = 10000, FARM_MAX = 250000, SEARCH_MAX = 1000000;
function netAt(implied, tvl, ds, fees, hours, D) { return implied * ds * (D / (tvl + D)) - fees - hours * WAGE; }
function priceRow(implied, tvl, ds, weeks, fees, hours) {
  const cap = Math.min(SEARCH_MAX, Math.max(REF, Math.min(1000000, 0.05 * tvl)));
  const hurdle = TBILL * (weeks / 52);
  const gain = (D) => netAt(implied, tvl, ds, fees, hours, D) - hurdle * D;
  let viable = null, prevD = 100, prevG = gain(prevD);
  for (let D = 150; D <= cap; D = Math.round(D * 1.25)) {
    const g = gain(D);
    if (prevG < 0 && g >= 0) {
      let lo = prevD, hi = D;
      while (hi - lo > 50) { const mid = (lo + hi) / 2; if (gain(mid) >= 0) hi = mid; else lo = mid; }
      viable = Math.ceil(hi / 50) * 50; break;
    }
    prevD = D; prevG = g;
  }
  let bestNet = -Infinity, bestD = REF;
  for (let D = 100; D <= cap; D = Math.round(D * 1.12)) {
    const n = netAt(implied, tvl, ds, fees, hours, D);
    if (n > bestNet) { bestNet = n; bestD = D; }
  }
  const atD = viable !== null ? viable : (bestNet > 0 ? bestD : REF);
  const net = netAt(implied, tvl, ds, fees, hours, atD);
  const be = ((fees + hours * WAGE + hurdle * atD) * (tvl + atD)) / (implied * atD);
  return {
    verdict: viable !== null && viable <= FARM_MAX ? 'FARM' : bestNet > 0 ? 'MARGINAL' : 'SKIP',
    viable, readAt: atD, net, nph: net / Math.max(hours, 0.25), be,
  };
}

// ------------------------------------------------ header + KPIs
$('meta-line').textContent =
  `Snapshot: DefiLlama protocols as of ${R.meta.asOf} (sealed; ${R.meta.protocols} protocols, watchlist ${R.meta.watchlist} at the ${usd(R.meta.floorUsd)} floor, ${R.meta.pricedPeers} priced peers fit the models). Scenario: drop share ${pct(R.meta.dropShare)}, horizon ${R.meta.horizonWeeks} weeks. ${R.meta.note}`;
const K = R.kpi;
const kpis = [
  ['Walk-forward miss', xf(K.missWf), `flat baseline ${xf(K.flatWf)} — later listings priced by earlier ones`],
  ['Leave-one-out miss', xf(K.missLoo), `flat baseline ${xf(K.flatLoo)}`],
  ['Leave-family-out', xf(K.missLofo), 'whole families held out'],
  ['Leave-chain-out', xf(K.missLoco), 'whole primary chains held out'],
  ['Conformal honesty', `${pct(K.coverage50)} / ${pct(K.coverage80)}`, 'measured coverage of the 50% / 80% bands'],
  ['Odds Brier', K.brier, `base rate ${K.brierBase} — lower is better`],
  ['FARM rows', K.farm, `of ${K.ranked} ranked protocols`],
  ['Multiple at $100M TVL', 'x' + K.multipleAt100M, 'the fitted base, before odds'],
];
$('kpis').innerHTML = kpis.map(([k, v, s]) => `<div class="kpi"><div class="v">${v}</div><div class="k">${k}</div><div class="s">${s}</div></div>`).join('');

// ------------------------------------------------ evidence tables
const S = (s) => [s.loo, s.wf, s.lofo, s.loco];
$('estimator-table').innerHTML =
  '<tr><th>estimator</th><th>LOO</th><th>walk-fwd</th><th>family-out</th><th>chain-out</th></tr>' +
  R.estimatorScores.map((e, i) => `<tr class="${i === 0 ? 'hl' : ''}"><td>${e.name}</td>${S(e.scores).map((v) => `<td>${xf(v)}</td>`).join('')}</tr>`).join('');
const termTable = (rows, fmt) =>
  '<tr><th>term</th><th>LOO</th><th>walk-fwd</th><th>family-out</th><th>chain-out</th><th>verdict</th></tr>' +
  rows.map((t) => `<tr><td>${t.label}</td>${S(t.solo).map((v) => `<td>${fmt(v)}</td>`).join('')}<td class="${t.kept ? 'kept' : 'refused'}">${t.kept ? 'KEPT' : 'refused'}</td></tr>`).join('');
$('value-terms').innerHTML = termTable(R.valueTerms, xf);
$('odds-terms').innerHTML = termTable(R.oddsTerms, (v) => Number(v).toFixed(3));
$('coef-table').innerHTML =
  '<tr><th>coefficient</th><th>estimate</th><th>+/- s.e.</th></tr>' +
  R.valueCoefs.map((c) => `<tr><td>value: ${c.name}</td><td>${c.coef}</td><td>${c.se}</td></tr>`).join('') +
  R.oddsCoefs.map((c) => `<tr><td>odds: ${c.name}</td><td>${c.coef}</td><td>${c.se}</td></tr>`).join('') +
  `<tr><td>conformal quantiles (log)</td><td>50%: ${R.conformal.q50}</td><td>80%: ${R.conformal.q80}</td></tr>` +
  `<tr><td>Platt calibration slope</td><td>${R.calib.slope}</td><td>Brier ${R.calib.brierRaw} -> ${R.calib.brierCal}</td></tr>`;
$('reading').innerHTML = R.reading.map((p) => `<p>${p}</p>`).join('');
const COLORS = ['#57c7ff', '#3fd68f', '#ffc357', '#ff6d6d', '#b48cff', '#4dd0c4', '#f28bb4', '#9fb6cc', '#7a8ba0'];
const ltotal = R.ledger.reduce((a, s) => a + s.n, 0);
$('ledger-total').textContent = ltotal;
$('ledger').innerHTML = R.ledger.map((s, i) => `<div style="width:${(s.n / ltotal * 100).toFixed(2)}%;background:${COLORS[i % COLORS.length]}" title="${s.label}: ${s.n}"></div>`).join('');
$('ledger').insertAdjacentHTML('afterend',
  `<p class="ledger-key">${R.ledger.map((s, i) => `<span style="color:${COLORS[i % COLORS.length]}">&#9632;</span> ${s.label}: ${s.n}`).join(' &nbsp; ')}</p>`);
const I = R.integrity;
$('integrity').textContent =
  `integrity: board recomputed from the raw snapshot at run time — ${I.rows} rows, total implied ${usd(I.totalImplied)}, watchlist covered ${I.watchlistCovered}/${R.meta.watchlist}, ledger ${I.ledgerTotal}/${R.meta.protocols}, main.ts checksum ${I.mainChecksum}`;

// ------------------------------------------------ controls + board
const state = { ds: R.meta.dropShare, weeks: R.meta.horizonWeeks, tier: '', q: '', cat: '', chain: '', sort: 'rank' };
const cats = [...new Set(R.rows.map((r) => r.category || '(none)'))].sort();
$('cat').innerHTML = '<option value="">all</option>' + cats.map((c) => `<option>${c}</option>`).join('');
const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
$('chain').innerHTML = '<option value="">all</option>' + chains.map((c) => `<option>${c}</option>`).join('');
$('ds').value = R.meta.dropShare * 100;
$('ds-val').textContent = pct(R.meta.dropShare, 1);
$('horizon').value = String(R.meta.horizonWeeks);

function priced(r) { return priceRow(r.implied, r.tvl, state.ds, state.weeks, r.fees, r.hours); }
function visible() {
  let rows = R.rows.map((r) => ({ r, v: priced(r) }));
  if (state.tier === 'WL') rows = rows.filter((x) => x.r.wl);
  else if (state.tier) rows = rows.filter((x) => x.v.verdict === state.tier);
  if (state.q) { const q = state.q.toLowerCase(); rows = rows.filter((x) => x.r.name.toLowerCase().includes(q) || x.r.slug.includes(q)); }
  if (state.cat) rows = rows.filter((x) => (x.r.category || '(none)') === state.cat);
  if (state.chain) rows = rows.filter((x) => x.r.chains.includes(state.chain));
  const by = {
    rank: (a, b) => a.r.rank - b.r.rank,
    nph: (a, b) => b.v.nph - a.v.nph,
    viable: (a, b) => (a.v.viable === null ? 1e18 : a.v.viable) - (b.v.viable === null ? 1e18 : b.v.viable),
    odds: (a, b) => b.r.odds - a.r.odds,
    tvl: (a, b) => b.r.tvl - a.r.tvl,
  }[state.sort];
  return rows.sort(by);
}
function rowHtml(x) {
  const { r, v } = x;
  const age = r.age >= 365 ? (r.age / 365).toFixed(1) + 'y' : r.age + 'd';
  const chg = r.chg === null ? '—' : (r.chg > 0 ? '+' : '') + r.chg.toFixed(1) + '%';
  return `<tr data-slug="${r.slug}">
    <td class="num">${r.rank}</td>
    <td><span class="pname">${r.name}</span>${r.wl ? '<span class="badge">watchlist</span>' : ''}${r.off ? '<span class="badge off">off-list</span>' : ''}</td>
    <td>${r.category || '(none)'}<br>${r.chains.join(', ')}</td>
    <td class="num">${usd(r.tvl)}</td><td class="num">${chg}</td><td class="num">${age}</td>
    <td class="num"><span class="oddsbar"><i style="width:${Math.round(r.odds * 100)}%"></i></span>${pct(r.odds)}</td>
    <td class="num">${usd(r.e1)} / ${usd(r.e2)} / ${usd(r.e3)}</td>
    <td class="num"><strong>${usd(r.implied)}</strong></td>
    <td class="num">${usd(r.lo80)} – ${usd(r.hi80)}</td>
    <td class="num">${usd(v.readAt)}${v.viable === null ? ' *' : ''}</td>
    <td class="num">${pct(v.be, 1)}</td>
    <td class="v-${v.verdict}">${v.verdict}</td>
    <td class="num ${v.net >= 0 ? 'pos' : 'neg'}">${usd2(v.net)}</td>
    <td class="num ${v.nph >= 0 ? 'pos' : 'neg'}">$${v.nph.toFixed(1)}</td></tr>`;
}
function renderBoard() {
  const rows = visible();
  $('board-count').textContent = `${rows.length} of ${R.rows.length} protocols shown`;
  $('board-table').querySelector('tbody').innerHTML = rows.map(rowHtml).join('');
  const farm = R.rows.map((r) => ({ r, v: priced(r) })).filter((x) => x.v.verdict === 'FARM').sort((a, b) => b.v.nph - a.v.nph);
  $('farm-table').querySelector('tbody').innerHTML = farm.map((x, i) =>
    `<tr><td class="num">${i + 1}</td><td><span class="pname">${x.r.name}</span></td><td class="num">${usd(x.r.tvl)}</td>` +
    `<td class="num">${pct(x.r.odds)}</td><td class="num">${usd(x.r.implied)}</td><td class="num">${usd(x.v.readAt)}</td>` +
    `<td class="num pos">${usd2(x.v.net)}</td><td class="num pos">$${x.v.nph.toFixed(1)}</td><td class="num">${pct(x.v.be, 1)}</td></tr>`).join('');
}
$('board-table').addEventListener('click', (ev) => {
  const tr = ev.target.closest('tr[data-slug]');
  if (!tr) return;
  const next = tr.nextElementSibling;
  if (next && next.classList.contains('steps')) { next.remove(); return; }
  const r = R.rows.find((x) => x.slug === tr.dataset.slug);
  const exp = document.createElement('tr');
  exp.className = 'steps';
  exp.innerHTML = `<td colspan="15"><strong>Farm plan for ${r.name}</strong> — plan fees ${usd(r.fees)}, hands-on ${r.hours}h at $25/h:<ol>${r.steps.map((s) => `<li>${s}</li>`).join('')}</ol></td>`;
  tr.after(exp);
});
$('ds').addEventListener('input', () => { state.ds = Number($('ds').value) / 100; $('ds-val').textContent = pct(state.ds, 1); renderBoard(); });
$('horizon').addEventListener('change', () => { state.weeks = Number($('horizon').value); renderBoard(); });
$('q').addEventListener('input', () => { state.q = $('q').value; renderBoard(); });
$('cat').addEventListener('change', () => { state.cat = $('cat').value; renderBoard(); });
$('chain').addEventListener('change', () => { state.chain = $('chain').value; renderBoard(); });
$('sort').addEventListener('change', () => { state.sort = $('sort').value; renderBoard(); });
$('tier-tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  state.tier = b.dataset.tier;
  [...$('tier-tabs').children].forEach((x) => x.classList.toggle('on', x === b));
  renderBoard();
});
$('reset').addEventListener('click', () => { location.reload(); });
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
$('csv').addEventListener('click', () => {
  const head = 'rank,slug,name,category,tvl_usd,odds,value_if_usd,implied_usd,verdict,viable_capital_usd,net_at_viable,net_per_hour,breakeven_drop_share\n';
  download('radar9-board.csv', head + visible().map((x) => [x.r.rank, x.r.slug, `"${x.r.name}"`, `"${x.r.category || ''}"`, x.r.tvl, x.r.odds, x.r.vif, x.r.implied, x.v.verdict, x.v.viable === null ? '' : x.v.viable, x.v.net.toFixed(2), x.v.nph.toFixed(2), x.v.be.toFixed(4)].join(',')).join('\n'), 'text/csv');
});
$('json').addEventListener('click', () => download('radar9-board.json', JSON.stringify({ rows: visible().map((x) => x.r) }, null, 1), 'application/json'));
renderBoard();

// ------------------------------------------------ detail pages
function detailHtml(d, idx) {
  const fh = (h) => String(Math.round(h * 100) / 100);
  const steps = d.steps.map((s, i) => `<li>${s.text} <em>(cost ${usd(s.costUsd)}, ${fh(s.hours)}h)</em></li>`).join('');
  const matrix = `<table class="matrix"><tr><th>drop share \\ deposit</th>${d.deposits.map((D) => `<th>${usd(D)}</th>`).join('')}</tr>` +
    d.shares.map((ds, i) => `<tr><th>${pct(ds)}</th>${d.matrix[i].map((n) => `<td class="${n >= 0 ? 'pos' : 'neg'}">${usd2(n)}</td>`).join('')}</tr>`).join('') + '</table>';
  return `<h2>Detail ${idx + 1} — ${d.name} <span class="sub" style="color:var(--dim);font-size:13px">(${d.kind})</span></h2>
  <div class="cols2"><div>
    <h3>How the number is built</h3>
    <table class="mini">${d.breakdown.map((b) => `<tr><td>${b.label}</td><td>${b.value}</td></tr>`).join('')}</table>
    <h3>Nearest priced peers</h3>
    <table class="mini"><tr><th>peer</th><th>category</th><th>TVL</th><th>cap</th><th>cap/TVL</th></tr>
    ${d.peers.map((p) => `<tr><td>${p.name}</td><td>${p.category || '(none)'}</td><td>${usd(p.tvl)}</td><td>${usd(p.mcap)}</td><td>x${p.multiple}</td></tr>`).join('')}</table>
    <h3>Break-evens</h3>
    <p class="note">Break-even drop share at the capital the verdict is read at: <strong>${pct(d.breakevens.dropShareAt10k, 1)}</strong>. Break-even launch odds at the viable capital (${usd(d.breakevens.viableCapital)}): <strong>${pct(Math.min(d.breakevens.oddsBreakeven, 9.99))}</strong> — above 100% means no odds rescue this row at that size. Exit rule: ${d.exitRule}</p>
  </div><div>
    <h3>Net by drop share x deposit (after fees and time)</h3>
    ${matrix}
    <h3>Farm plan — 10 steps, costed</h3>
    <ol class="steps">${steps}</ol>
  </div></div>`;
}
R.details.forEach((d, i) => { $('detail-' + i).innerHTML = detailHtml(d, i); });
$('nav-detail-0').textContent = 'Detail: ' + R.details[0].name;
$('nav-detail-1').textContent = 'Detail: ' + R.details[1].name;
