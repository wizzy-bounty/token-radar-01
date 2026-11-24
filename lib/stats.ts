// stats.ts — RADAR-9's small statistics toolkit, written for this entry.
// Seeded RNG, order statistics, a ridge solver with per-column penalties,
// an IRLS median (L1) regression, an IRLS logistic fit, and the scoring
// helpers the model tests use. Node standard library only (no imports).

/** mulberry32: a tiny deterministic RNG so every run writes the same bytes. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Linear-interpolation quantile, q in [0,1]. */
export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const at = clamp(q, 0, 1) * (s.length - 1);
  const lo = Math.floor(at), hi = Math.ceil(at);
  return lo === hi ? s[lo]! : s[lo]! + (s[hi]! - s[lo]!) * (at - lo);
}

export function meanSd(xs: number[]): { mean: number; sd: number } {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length) || 1;
  return { mean, sd };
}

/** Weighted median: the value where cumulative weight first reaches half the total. */
export function weightedMedian(pairs: { v: number; w: number }[]): number {
  const s = [...pairs].sort((a, b) => a.v - b.v);
  const total = s.reduce((a, p) => a + p.w, 0);
  let acc = 0;
  for (const p of s) { acc += p.w; if (acc >= total / 2) return p.v; }
  return s[s.length - 1]!.v;
}

/** FNV-1a hash of a string, for deterministic fold assignment. */
export function fnv(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ------------------------------------------------------------ linear algebra

/** Solve (X'X + diag(pen)) beta = X'y by Gaussian elimination with partial pivoting.
 *  Returns beta and the inverse of the penalised normal matrix (for hat diagonals). */
export function ridgeSolve(X: number[][], y: number[], pen: number[]): { beta: number[]; inv: number[][] } {
  const p = X[0]!.length;
  const A: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const b = new Array<number>(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    const xi = X[i]!;
    for (let j = 0; j < p; j++) {
      b[j] += xi[j]! * y[i]!;
      for (let k = j; k < p; k++) A[j]![k] += xi[j]! * xi[k]!;
    }
  }
  for (let j = 0; j < p; j++) { for (let k = 0; k < j; k++) A[j]![k] = A[k]![j]!; A[j]![j] += pen[j]! + 1e-9; }
  // Augment with identity and eliminate once: gives both beta and the inverse.
  const M = A.map((row, j) => [...row, ...Array.from({ length: p }, (_, k) => (k === j ? 1 : 0)), b[j]!]);
  for (let col = 0; col < p; col++) {
    let piv = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (piv !== col) { const t = M[col]!; M[col] = M[piv]!; M[piv] = t; }
    const d = M[col]![col]!;
    for (let k = col; k < 2 * p + 1; k++) M[col]![k] /= d;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = M[r]![col]!;
      if (f === 0) continue;
      for (let k = col; k < 2 * p + 1; k++) M[r]![k] -= f * M[col]![k]!;
    }
  }
  const beta = M.map((row) => row[2 * p]!);
  const inv = M.map((row) => row.slice(p, 2 * p));
  return { beta, inv };
}

/** Hat diagonals h_i = x_i' (X'X + pen)^-1 x_i for the rows of X. */
export function hatDiag(X: number[][], inv: number[][]): number[] {
  return X.map((xi) => {
    let h = 0;
    for (let j = 0; j < xi.length; j++) {
      let s = 0;
      for (let k = 0; k < xi.length; k++) s += inv[j]![k]! * xi[k]!;
      h += xi[j]! * s;
    }
    return h;
  });
}

export const dot = (a: number[], b: number[]): number => a.reduce((s, x, j) => s + x * b[j]!, 0);

// ------------------------------------------------------------ estimators

/** Median regression by IRLS: repeatedly reweighted ridge fits whose weights
 *  1/max(|resid|, eps) pull the fit toward the conditional median instead of
 *  the mean. eps is a quarter of the residuals' median absolute size, floored
 *  so a perfect fit cannot divide by zero. */
export function fitMedianIRLS(X: number[][], y: number[], pen: number[], start?: number[]): number[] {
  let beta = start ?? ridgeSolve(X, y, pen).beta;
  for (let iter = 0; iter < 20; iter++) {
    const resid = y.map((yi, i) => yi - dot(X[i]!, beta));
    const eps = Math.max(0.05, 0.25 * median(resid.map((r) => Math.abs(r))));
    const sw = resid.map((r) => 1 / Math.sqrt(Math.max(Math.abs(r), eps)));
    const Xw = X.map((xi, i) => xi.map((x) => x * sw[i]!));
    const yw = y.map((yi, i) => yi * sw[i]!);
    const next = ridgeSolve(Xw, yw, pen).beta;
    const shift = Math.max(...next.map((v, j) => Math.abs(v - beta[j]!)));
    beta = next;
    if (shift < 1e-7) break;
  }
  return beta;
}

export interface LogFit { beta: number[]; prob: number[]; inv: number[][]; w: number[] }

/** Logistic regression by IRLS (Newton) with a ridge penalty on every
 *  coefficient except the intercept. */
export function fitLogistic(X: number[][], y: number[], ridge = 1, start?: number[], maxIter = 40): LogFit {
  const p = X[0]!.length;
  let beta = start ? [...start] : new Array<number>(p).fill(0);
  let prob = y.map(() => 0.5), w = y.map(() => 0.25), inv: number[][] = [];
  for (let iter = 0; iter < maxIter; iter++) {
    prob = X.map((xi) => 1 / (1 + Math.exp(-clamp(dot(xi, beta), -30, 30))));
    w = prob.map((pr) => Math.max(pr * (1 - pr), 1e-6));
    // Weighted normal equations for the Newton step.
    const A: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const g = new Array<number>(p).fill(0);
    for (let i = 0; i < X.length; i++) {
      const xi = X[i]!;
      for (let j = 0; j < p; j++) {
        g[j] += xi[j]! * (y[i]! - prob[i]!);
        for (let k = j; k < p; k++) A[j]![k] += w[i]! * xi[j]! * xi[k]!;
      }
    }
    for (let j = 0; j < p; j++) { for (let k = 0; k < j; k++) A[j]![k] = A[k]![j]!; if (j > 0) A[j]![j] += ridge; A[j]![j] += 1e-9; }
    // Solve A step = g via the augmented inverse trick.
    const sol = ridgeSolveFromSystem(A, g);
    inv = sol.inv;
    const step = sol.beta;
    for (let j = 0; j < p; j++) { beta[j] += step[j]!; g[j] = step[j]!; }
    if (Math.max(...g.map((v) => Math.abs(v))) < 1e-6) break;
  }
  prob = X.map((xi) => 1 / (1 + Math.exp(-clamp(dot(xi, beta), -30, 30))));
  return { beta, prob, inv, w };
}

/** Solve A x = b for a symmetric system, returning x and A^-1. */
export function ridgeSolveFromSystem(Ain: number[][], b: number[]): { beta: number[]; inv: number[][] } {
  const p = Ain.length;
  const A = Ain.map((row) => [...row]);
  const M = A.map((row, j) => [...row, ...Array.from({ length: p }, (_, k) => (k === j ? 1 : 0)), b[j]!]);
  for (let col = 0; col < p; col++) {
    let piv = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (piv !== col) { const t = M[col]!; M[col] = M[piv]!; M[piv] = t; }
    const d = M[col]![col]!;
    for (let k = col; k < 2 * p + 1; k++) M[col]![k] /= d;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = M[r]![col]!;
      if (f === 0) continue;
      for (let k = col; k < 2 * p + 1; k++) M[r]![k] -= f * M[col]![k]!;
    }
  }
  return { beta: M.map((row) => row[2 * p]!), inv: M.map((row) => row.slice(p, 2 * p)) };
}

export const predictLogistic = (beta: number[], x: number[]): number =>
  1 / (1 + Math.exp(-clamp(dot(x, beta), -30, 30)));

/** Brier score of probabilistic predictions against 0/1 outcomes. */
export function brier(preds: number[], ys: number[]): number {
  return preds.reduce((a, pr, i) => a + (pr - ys[i]!) ** 2, 0) / preds.length;
}

/** The value miss used everywhere on the cover: exp of the median absolute
 *  log error — "the typical prediction is off by a factor of this". */
export function typicalMiss(logErrs: number[]): number {
  return Math.exp(median(logErrs.map((e) => Math.abs(e))));
}

/** Conformal quantile of absolute residuals: the ceil((n+1)*level)-th smallest. */
export function conformalQuantile(absResid: number[], level: number): number {
  const s = [...absResid].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((s.length + 1) * level) - 1));
  return s[idx]!;
}

/** Bootstrap standard errors: refit on seeded resamples, take the sd of each coefficient. */
export function bootstrapSE(n: number, B: number, seed: number, refit: (idx: number[]) => number[] | null): number[] {
  const rand = rng(seed);
  const cols: number[][] = [];
  for (let b = 0; b < B; b++) {
    const idx = Array.from({ length: n }, () => Math.floor(rand() * n));
    let beta: number[] | null = null;
    try { beta = refit(idx); } catch { beta = null; }
    if (beta === null) continue;
    beta.forEach((v, j) => { (cols[j] ??= []).push(v); });
  }
  return cols.map((c) => (c.length > 1 ? meanSd(c).sd : NaN));
}
