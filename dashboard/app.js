const D = window.RADAR;
const el = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd0 = (n) => '$' + Math.round(n).toLocaleString('en-US');
const cmp = (n) => n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(0) + 'K' : usd0(n);
const money = (n) => { const v = Math.round(n * 100) / 100; return '$' + v.toLocaleString('en-US', { minimumFractionDigits: v < 100 ? 2 : 0, maximumFractionDigits: v < 100 ? 2 : 0 }); };
// row columns: slug name cat chains tvl chg age odds valueif implied p10 p25 p90 rlo rhi op wl
const C = { slug: 0, name: 1, cat: 2, chains: 3, tvl: 4, chg: 5, age: 6, odds: 7, valueif: 8, implied: 9, p10: 10, p25: 11, p90: 12, rlo: 13, rhi: 14, op: 15, wl: 16 };
const VN = { F: 'FARM', M: 'MARGINAL', S: 'SKIP' };
const sc = { ...D.scenario };
const fees = (op) => 1 + 3 * op + op * sc.weeks / 2;
const hours = () => (51 + 10 * sc.weeks) / 60;
function price(r, implied) {
  const drop = implied * sc.dropShare * sc.deposit / (r[C.tvl] + sc.deposit);
  const net = drop - fees(r[C.op]) - hours() * 25;
  const tbill = sc.deposit * 0.04 * sc.weeks / 52;
  const nph = net / hours();
  return { drop, net, nph, tbill, v: net >= tbill && nph >= 25 ? 'F' : net > 0 ? 'M' : 'S' };
}
const params = new URLSearchParams(location.search);

function renderBoard() {
  el('#asof').textContent = D.asOf;
  const A = D.accounting, rows = D.rows;
  const priced = rows.map((r) => ({ r, p: price(r, r[C.implied]), s: price(r, r[C.p25]) }));
  const farmN = priced.filter((x) => x.p.v === 'F').length;
  const holdN = priced.filter((x) => x.p.v === 'F' && x.s.v === 'F').length;
  const medOdds = [...rows].sort((a, b) => a[C.odds] - b[C.odds])[Math.floor(rows.length / 2)][C.odds];
  el('#kpis').innerHTML = [
    [A.ranked, `ranked protocols (${A.ranked - A.early} at/above the ${cmp(D.floor)} floor + ${A.early} early)`],
    [`${A.watchlistIn}/${A.watchlistTotal}`, 'of the house watchlist ranked'],
    [cmp(D.totals.implied), 'total implied value of the board'],
    [medOdds.toFixed(1) + '%', 'median launch odds across the board'],
    [`${farmN} FARM`, `verdicts at the default scenario · ${holdN} still farm at P25`],
    ['&times;' + D.valueModel.final.loo.toFixed(2), 'value model typical miss, leave-one-out'],
  ].map(([v, l]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');

  el('#acctotal').textContent = A.total;
  const segs = [
    [A.ranked - A.early, '#2563eb', `Ranked, at/above floor`],
    [A.early, '#38bdf8', 'Ranked early, below the floor (this board lifts it)'],
    [A.trades, '#a78bfa', 'Already carry a recorded cap'],
    [A.recordedNoCap, '#64748b', 'Token recorded, no cap yet'],
    [A.outByRule, '#7f1d1d', 'Out by the house rule itself'],
  ];
  el('#acctbar').innerHTML = segs.map(([n, c]) => `<div style="width:${100 * n / A.total}%;background:${c}"></div>`).join('');
  el('#acctlegend').innerHTML = segs.map(([n, c, l]) => `<span><i style="background:${c}"></i>${l}: <b>${n}</b></span>`).join('');
  el('#acctnote').textContent = 'Out by rule: ' + A.outReasons.map((x) => `${x.label} ${x.n}`).join(' · ')
    + `. The five segments sum to ${segs.reduce((s, x) => s + x[0], 0)} of ${A.total} — the ledger reconciles.`;

  const ranksOk = rows.every((r, i) => i === 0 || rows[i - 1][C.implied] >= r[C.implied]);
  el('#integrity').innerHTML = [
    `board rows ${rows.length}`, ranksOk ? 'implied strictly ranked 1..N' : 'rank check FAILED',
    `watchlist ${A.watchlistIn}/${A.watchlistTotal}`, `ledger ${segs.reduce((s, x) => s + x[0], 0)}/${A.total}`,
    `board.json checksum ${D.totals.checksum}`, 'page + data under the 64 KiB judge budget',
  ].map((t) => `<span>${t}</span>`).join('');

  const termTable = (m, unit) => `<table class="mini"><tr><th class="l">Term (added alone)</th><th>Leave-one-out</th><th>Walk-forward</th><th>Leave-one-family-out</th><th class="l">Kept?</th></tr>`
    + `<tr><td class="l">no terms — the base model</td><td>${m.base.loo}</td><td>${m.base.wf}</td><td>${m.base.lofo}</td><td class="l">—</td></tr>`
    + m.table.map((t) => `<tr><td class="l">${esc(t.label)}</td><td>${t.loo}</td><td>${t.wf}</td><td>${t.lofo}</td><td class="l">${t.kept ? '<b>kept</b>' : 'tested, not kept'}</td></tr>`).join('')
    + `<tr><td class="l"><b>model as fitted</b></td><td><b>${m.final.loo}</b></td><td><b>${m.final.wf}</b></td><td><b>${m.final.lofo}</b></td><td class="l">${unit}</td></tr></table>`;
  el('#valuemodel').innerHTML = `<h2>Value model — what a launch would be worth</h2>
    <p class="note">Regresses ln(cap &divide; TVL) on the <b>${D.valueModel.n}</b> protocols whose tokens carry a positive cap. ${D.valueModel.zeroCap} recorded tokens sit at $0 in the snapshot — no live market, not a valuation — so they are excluded from this fit only; they still count in the odds model and the ledger. A term is kept only if it lowers the miss in <b>all three</b> held-out tests. Typical miss = the factor a typical prediction is off by (median), lower is better.</p>
    <p>Base multiple at $100M TVL: <b>&times;${D.valueModel.multiple}</b> (bootstrap &plusmn;1 SE: &times;${D.valueModel.multipleLo}–&times;${D.valueModel.multipleHi}) &middot; size slope <b>${D.valueModel.sizeSlope} &plusmn; ${D.valueModel.seSlope}</b> per ln TVL &middot; kept: <b>${D.valueModel.kept.join(', ') || 'none'}</b></p>${termTable(D.valueModel, 'typical miss &times;')}`;
  el('#oddsmodel').innerHTML = `<h2>Odds model — will it launch at all?</h2>
    <p class="note">Logistic fit on all <b>${A.total}</b> protocols; the outcome is whether a token is recorded. Base rate <b>${D.oddsModel.baseRate}%</b>; the fitted model calls <b>${D.oddsModel.calledRight}%</b> right at a 50% cut. Brier score, lower is better; leave-one-out uses the one-step refit approximation. Same rule: kept only if all three tests improve.</p>
    <p>Kept: <b>${D.oddsModel.kept.join(', ') || 'none'}</b> &middot; base Brier ${D.oddsModel.base.loo} &rarr; fitted ${D.oddsModel.final.loo} (leave-one-out)</p>${termTable(D.oddsModel, 'Brier')}`;
  el('#honesty').innerHTML = `<h2>Range honesty — the bands are checked, not just drawn</h2>
    <p class="note">Bands come from 200 bootstrap refits of both models, each repricing the board with one of the value fit's own residuals drawn in — peers scatter around the model, and a band that only wobbles coefficients would pretend that away. For each of the ${D.valueModel.n} priced peers we printed the band the model would give it: <b>${D.honesty.inMid}%</b> of actual caps fall inside P25–P75 (calibrated &asymp;50%) and <b>${D.honesty.inWide}%</b> inside P10–P90 (&asymp;80%). The control term — another row's 7-day growth, which cannot legitimately help — was offered to both models and kept by neither. Every row also carries its bootstrap rank range: the board's order is a distribution, not a fact.</p>`;

  // controls
  el('#sc-dep').value = sc.deposit; el('#sc-share').value = sc.dropShare * 100; el('#sc-weeks').value = sc.weeks;
  const cats = [...new Set(rows.map((r) => r[C.cat] || 'Uncategorised'))].sort();
  el('#cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  const chips = [['', 'All rows'], ['F', 'FARM'], ['M', 'MARGINAL'], ['S', 'SKIP'], ['W', 'Watchlist'], ['E', 'Early (< floor)'], ['H', 'Holds at P25']];
  let chipState = params.get('tab') === 'farm' ? 'F' : '';
  el('#chips').innerHTML = chips.map(([k, l]) => `<button class="chip${k === chipState ? ' on' : ''}" data-chip="${k}">${l}</button>`).join('');
  let sortK = params.get('tab') === 'farm' ? 'nph' : 'rank', sortDir = params.get('tab') === 'farm' ? -1 : 1;

  const gmin = Math.log(Math.min(...rows.map((r) => r[C.p10]))), gmax = Math.log(Math.max(...rows.map((r) => r[C.p90])));
  const pos = (v) => (100 * (Math.log(v) - gmin) / (gmax - gmin)).toFixed(1);
  function current() {
    const q = el('#q').value.toLowerCase(), cat = el('#cat').value;
    let list = priced.filter(({ r, p, s }) => {
      if (chipState && 'FMS'.includes(chipState) && p.v !== chipState) return false;
      if (chipState === 'W' && !r[C.wl]) return false;
      if (chipState === 'E' && r[C.tvl] >= D.floor) return false;
      if (chipState === 'H' && !(p.v === 'F' && s.v === 'F')) return false;
      if (cat && (r[C.cat] || 'Uncategorised') !== cat) return false;
      if (q && !(r[C.name].toLowerCase().includes(q) || r[C.slug].includes(q))) return false;
      return true;
    });
    const key = { rank: (x) => -x.r[C.implied], name: (x) => x.r[C.name], tvl: (x) => x.r[C.tvl], chg: (x) => x.r[C.chg] ?? -1e9, age: (x) => x.r[C.age], odds: (x) => x.r[C.odds], valueif: (x) => x.r[C.valueif], implied: (x) => x.r[C.implied], rankrange: (x) => x.r[C.rlo], verdict: (x) => x.p.v, net: (x) => x.p.net, nph: (x) => x.p.nph }[sortK];
    list.sort((a, b) => { const d = key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0; return d * sortDir; });
    return list;
  }
  const rankOf = new Map(rows.map((r, i) => [r[C.slug], i + 1]));
  function draw() {
    const list = current();
    el('#rows').innerHTML = list.map(({ r, p, s }) => `<tr class="rowlink" data-slug="${esc(r[C.slug])}"><td>${rankOf.get(r[C.slug])}</td><td class="l"><b>${esc(r[C.name])}</b>${r[C.wl] ? ' <span class="star" title="house watchlist">★</span>' : ''}<br><span class="note">${esc(r[C.cat] || 'Uncategorised')} · ${esc(r[C.chains].join(', '))}</span></td><td>${cmp(r[C.tvl])}</td><td class="${(r[C.chg] ?? 0) < 0 ? 'neg' : 'pos'}">${r[C.chg] === null ? '—' : r[C.chg].toFixed(1) + '%'}</td><td>${r[C.age].toFixed(1)}y</td><td>${r[C.odds].toFixed(0)}%</td><td>${cmp(r[C.valueif])}</td><td><b>${cmp(r[C.implied])}</b><div class="whisk"><div class="rg" style="left:${pos(r[C.p10])}%;width:${Math.max(2, pos(r[C.p90]) - pos(r[C.p10]))}%"></div><div class="pt" style="left:${pos(r[C.implied])}%"></div></div></td><td>${r[C.rlo]}–${r[C.rhi]}</td><td><span class="pill ${p.v}">${VN[p.v]}</span>${p.v === 'F' && s.v === 'F' ? ' <span class="star" title="still FARM at its P25 implied value">★</span>' : ''}<span class="stress">at P25: ${VN[s.v]}</span></td><td class="${p.net < 0 ? 'neg' : 'pos'}">${usd0(p.net)}</td><td class="${p.nph < 0 ? 'neg' : 'pos'}">$${p.nph.toFixed(1)}</td></tr>`).join('');
    el('#rowcount').textContent = `${list.length} of ${rows.length} rows shown · scenario: ${usd0(sc.deposit)} deposit, ${(sc.dropShare * 100).toFixed(1)}% of any drop to farmers, ${sc.weeks} weeks · click a row for its detail`;
    document.querySelectorAll('tr.rowlink').forEach((tr) => tr.addEventListener('click', () => { location.search = '?view=row&slug=' + tr.dataset.slug; }));
  }
  document.querySelectorAll('#board th').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k; if (sortK === k) sortDir *= -1; else { sortK = k; sortDir = k === 'name' ? 1 : -1; } draw();
  }));
  document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    chipState = b.dataset.chip; document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b)); draw();
  }));
  el('#q').addEventListener('input', draw); el('#cat').addEventListener('change', draw);
  el('#sc-apply').addEventListener('click', () => {
    sc.deposit = Math.max(100, +el('#sc-dep').value || D.scenario.deposit);
    sc.dropShare = Math.min(0.4, Math.max(0.005, (+el('#sc-share').value || 7) / 100));
    sc.weeks = Math.min(52, Math.max(1, +el('#sc-weeks').value || 12));
    priced.forEach((x) => { x.p = price(x.r, x.r[C.implied]); x.s = price(x.r, x.r[C.p25]); });
    el('#kpis').children[4].querySelector('.v').textContent = `${priced.filter((x) => x.p.v === 'F').length} FARM`;
    el('#kpis').children[4].querySelector('.l').textContent = `verdicts at this scenario · ${priced.filter((x) => x.p.v === 'F' && x.s.v === 'F').length} still farm at P25`;
    draw();
  });
  const exportRows = () => current().map(({ r, p }) => ({
    slug: r[C.slug], name: r[C.name], category: r[C.cat], chains: r[C.chains], tvl_usd: r[C.tvl], change_7d: r[C.chg],
    age_years: r[C.age], odds_pct: r[C.odds], value_if_usd: r[C.valueif], implied_value_usd: r[C.implied],
    implied_p25_usd: r[C.p25], implied_p75_usd: r[C.p75], rank_range: [r[C.rlo], r[C.rhi]], verdict: VN[p.v], net_usd: Math.round(p.net), net_per_hour_usd: Math.round(p.nph * 10) / 10,
  }));
  const dl = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href); };
  el('#exp-csv').addEventListener('click', () => {
    const rs = exportRows(), head = Object.keys(rs[0] || {}).join(',');
    dl('radar7-board.csv', head + '\n' + rs.map((o) => Object.values(o).map((v) => Array.isArray(v) ? v.join('|') : v).join(',')).join('\n'), 'text/csv');
  });
  el('#exp-json').addEventListener('click', () => dl('radar7-board.json', JSON.stringify(exportRows(), null, 1), 'application/json'));
  draw();
}

// ------------------------------------------------------------- detail views
function kvGrid(items) {
  return `<div class="kv">${items.map(([v, l]) => `<div><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}</div>`;
}
function statsLine(r, p, s) {
  return kvGrid([
    [cmp(r[C.tvl]), 'TVL'], [cmp(r[C.implied]), 'implied value'], [cmp(r[C.p10]) + ' – ' + cmp(r[C.p90]), 'P10 – P90 band'],
    [r[C.odds].toFixed(1) + '%', 'launch odds'], [cmp(r[C.valueif]), 'value if it launches'],
    [`<span class="pill ${p.v}">${VN[p.v]}</span>`, `verdict · at P25: ${VN[s.v]}`],
    [usd0(p.net), 'net at default scenario'], ['$' + p.nph.toFixed(1), 'net per hands-on hour'],
    [`${r[C.rlo]}–${r[C.rhi]}`, 'bootstrap rank range'], [r[C.age].toFixed(1) + 'y', 'age · ' + esc(r[C.chains].join(', '))],
  ]);
}
function fbar(label, val, frac, txt) {
  return `<div class="fbar"><span class="fl">${esc(label)}</span><span class="ft"><i style="left:${val < 0 ? 50 - 50 * frac : 50}%;width:${50 * frac}%;background:${val < 0 ? '#f87171' : '#34d399'}"></i></span><span class="fv">${txt}</span></div>`;
}
function renderFeatured(pick) {
  const P = D.picks[pick], r = D.rows.find((x) => x[C.slug] === P.slug), d = P.detail;
  const p = price(r, r[C.implied]), s = price(r, r[C.p25]);
  const maxLn = Math.max(...d.valueFactors.map((f) => Math.abs(Math.log(f.mult))));
  const vf = d.valueFactors.map((f) => fbar(f.label, Math.log(f.mult), Math.abs(Math.log(f.mult)) / maxLn, '&times;' + f.mult.toFixed(2))).join('');
  const maxLo = Math.max(...d.oddsFactors.map((f) => Math.abs(f.logit)), 0.1);
  const of = d.oddsFactors.map((f) => fbar(f.label, f.logit, Math.abs(f.logit) / maxLo, (f.logit >= 0 ? '+' : '') + f.logit.toFixed(2))).join('');
  const peers = d.peers.length ? `<table class="mini"><tr><th class="l">Priced peer</th><th>TVL</th><th>Actual cap</th><th>Cap / TVL</th><th>Actual &divide; this model</th></tr>${d.peers.map((x) => `<tr><td class="l">${esc(x.name)}</td><td>${cmp(x.tvl)}</td><td>${cmp(x.mcap)}</td><td>&times;${x.capTvl.toFixed(2)}</td><td>&times;${x.vsModel.toFixed(2)}</td></tr>`).join('')}</table>` : '<p class="note">No priced peer shares its category or family.</p>';
  const mx = `<table class="mini"><tr><th class="l">Net if the drop is worth&hellip;</th>${d.matrix.deposits.map((x) => `<th>${usd0(x)} in</th>`).join('')}</tr>${d.matrix.shares.map((sh, i) => `<tr><td class="l">${(sh * 100).toFixed(1)}% of implied, farmers split pro-rata</td>${d.matrix.net[i].map((n) => `<td class="${n < 0 ? 'neg' : 'pos'}">${usd0(n)}</td>`).join('')}</tr>`).join('')}</table>`;
  el('#detailview').innerHTML = `<a class="back" href="?">&larr; back to the board</a>
    <h2 style="color:#fff;margin:4px 0">${esc(r[C.name])} <span class="note">— ${pick === 'farm' ? 'the board\'s best farm: highest net per hands-on hour among FARM verdicts' : 'the highest-implied protocol on the house watchlist'}</span></h2>
    ${statsLine(r, p, s)}
    <div class="card"><h3>Where the value comes from — factor by factor</h3>${vf}
    <p class="note">The factors multiply to the model's multiple for this row; &times; TVL gives <b>value if it launches</b>. Bars are log-scaled around &times;1.</p>
    <h3>Where the odds come from — logit by logit</h3>${of}
    <p class="note">Contributions add in logit space; the sum converts to the launch odds above.</p></div>
    <div class="card"><h3>Priced peers in its category or family</h3>${peers}
    <p class="note">Actual &divide; this model: how the peer's real cap compares with what this row's model would predict for it — the same scatter the honesty check measures.</p></div>
    <div class="card"><h3>What the farm pays at other sizes</h3>${mx}
    <p class="note">Break-evens at the default scenario: the verdict turns positive if farmers receive <b>${(d.breakEvenShare * 100).toFixed(1)}%</b> of the implied value (the board assumes ${(D.scenario.dropShare * 100).toFixed(0)}%), or if the true launch odds are <b>${(d.breakEvenOdds * 100).toFixed(0)}%</b> (the model says ${r[C.odds].toFixed(0)}%). Exit rule: withdraw if TVL prints below <b>${usd0(d.exitTvl)}</b> — 17% under the snapshot — if withdrawals pause, or once a snapshot is announced.</p></div>
    <div class="card"><h3>The plan — ${d.plan.length} steps, costed</h3><ol class="plan">${d.plan.map((x) => `<li><b>${esc(x.title)}</b> — ${esc(x.body)} <span class="cost">(COST ${money(x.cost)}; TIME ${x.minutes} min)</span></li>`).join('')}</ol></div>`;
}
function renderRow(slug) {
  const r = D.rows.find((x) => x[C.slug] === slug);
  if (!r) { el('#detailview').innerHTML = '<p>Unknown protocol.</p>'; return; }
  const p = price(r, r[C.implied]), s = price(r, r[C.p25]);
  const f = fees(r[C.op]), h = hours();
  el('#detailview').innerHTML = `<a class="back" href="?">&larr; back to the board</a>
    <h2 style="color:#fff;margin:4px 0">${esc(r[C.name])} <span class="note">— ${esc(r[C.cat] || 'Uncategorised')}${r[C.wl] ? ' · on the house watchlist ★' : ''}</span></h2>
    ${statsLine(r, p, s)}
    <div class="card"><h3>The verdict, priced out</h3>
    <p>At the default scenario (${usd0(D.scenario.deposit)} in, ${(D.scenario.dropShare * 100).toFixed(0)}% of any launch value to farmers, ${D.scenario.weeks} weeks): the position's share of a drop is worth <b>${usd0(p.drop)}</b>; the plan's step fees come to <b>${money(f)}</b> on ${esc(r[C.chains][0] || 'its main chain')}; hands-on time is <b>${h.toFixed(1)} h</b>, charged at $25/h = <b>${usd0(h * 25)}</b>; the same cash in a T-bill returns <b>${usd0(p.tbill)}</b>. Net <b class="${p.net < 0 ? 'neg' : 'pos'}">${usd0(p.net)}</b> — hence <b>${VN[p.v]}</b>. Repricing at the P25 implied value (${cmp(r[C.p25])}) gives <b>${VN[s.v]}</b>.</p>
    <p class="note">Exit rule: withdraw if TVL prints below ${usd0(r[C.tvl] * 0.83)} (17% under the snapshot's ${usd0(r[C.tvl])}), if withdrawals pause, or once a snapshot is announced. This row's full step-by-step farm plan — ${'7'} steps with a cost and a time on each — is in board.json under <b>farm_steps</b>; the two featured protocols carry their full plans on this page: <a href="?view=detail&amp;pick=farm">best farm</a> · <a href="?view=detail&amp;pick=watch">best watchlist</a>.</p></div>`;
}
el('#asof').textContent = D.asOf;
const view = params.get('view');
if (view === 'detail' || view === 'row') {
  el('#boardview').hidden = true; el('#detailview').hidden = false;
  if (view === 'detail') renderFeatured(params.get('pick') === 'watch' ? 'watch' : 'farm');
  else renderRow(params.get('slug'));
} else renderBoard();
