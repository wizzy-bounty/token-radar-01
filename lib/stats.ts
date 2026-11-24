// RADAR-8 statistics toolkit — written for this entry, Node standard library only.
// Everything here is deterministic: the only randomness is a seeded generator, so two runs of
// main.ts over the same snapshot write byte-identical output.

/** mulberry32: a small seeded PRNG, stable across platforms and Node versions. */
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

/** FNV-1a hash of a string, as an unsigned 32-bit integer. Used for deterministic splits. */
export function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function mean(xs: number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** The p-quantile of xs with the conformal finite-sample correction: rank ceil((n+1)*p), clamped. */
export function conformalQuantile(xs: number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const rank = Math.min(s.length, Math.max(1, Math.ceil((s.length + 1) * p)));
  return s[rank - 1]!;
}

/** Plain p-quantile (nearest-rank), for tercile boundaries. */
export function quantile(xs: number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))]!;
}

/** Solve A x = b for a small dense A by Gaussian elimination with partial pivoting. */
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    const tmp = M[col]!; M[col] = M[piv]!; M[piv] = tmp;
    const d = M[col]![col]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / d;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return M.map((row, i) => (Math.abs(row[i]!) < 1e-12 ? 0 : row[n]! / row[i]!));
}

/**
 * Ridge-stabilised least squares: minimises |y - Xb|^2 + ridge * sum_{j>0} b_j^2 (the intercept is
 * never penalised). X rows already carry their leading 1 when an intercept is wanted.
 */
export function fitOLS(X: number[][], y: number[], ridge = 1e-8): number[] {
  const p = X[0]!.length;
  const A: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const b = new Array<number>(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    const xi = X[i]!;
    for (let j = 0; j < p; j++) {
      b[j]! += xi[j]! * y[i]!;
      for (let k = 0; k < p; k++) A[j]![k]! += xi[j]! * xi[k]!;
    }
  }
  for (let j = 1; j < p; j++) A[j]![j]! += ridge;
  return solveLinear(A, b);
}

export function predictOLS(beta: number[], x: number[]): number {
  let s = 0;
  for (let j = 0; j < beta.length; j++) s += beta[j]! * x[j]!;
  return s;
}

const sigmoid = (z: number): number => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

/**
 * Logistic regression by IRLS (Newton steps on the ridge-penalised likelihood). Features should be
 * roughly standardised by the caller; the intercept is never penalised.
 */
export function fitLogistic(X: number[][], y: number[], ridge = 1e-3, iters = 60): number[] {
  const p = X[0]!.length;
  let beta = new Array<number>(p).fill(0);
  // Start the intercept at the base-rate logit so IRLS begins near the solution.
  const base = Math.min(0.999, Math.max(0.001, mean(y)));
  beta[0] = Math.log(base / (1 - base));
  for (let it = 0; it < iters; it++) {
    const A: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const g = new Array<number>(p).fill(0);
    for (let i = 0; i < X.length; i++) {
      const xi = X[i]!;
      let z = 0;
      for (let j = 0; j < p; j++) z += beta[j]! * xi[j]!;
      const mu = sigmoid(z);
      const w = Math.max(1e-6, mu * (1 - mu));
      for (let j = 0; j < p; j++) {
        g[j]! += xi[j]! * (y[i]! - mu);
        for (let k = 0; k < p; k++) A[j]![k]! += w * xi[j]! * xi[k]!;
      }
    }
    for (let j = 1; j < p; j++) { A[j]![j]! += ridge; g[j]! -= ridge * beta[j]!; }
    const step = solveLinear(A, g);
    let maxStep = 0;
    for (let j = 0; j < p; j++) { beta[j]! += step[j]!; maxStep = Math.max(maxStep, Math.abs(step[j]!)); }
    if (maxStep < 1e-9) break;
  }
  return beta;
}

export function predictLogistic(beta: number[], x: number[]): number {
  let z = 0;
  for (let j = 0; j < beta.length; j++) z += beta[j]! * x[j]!;
  return sigmoid(z);
}

/** Brier score of probabilistic predictions against 0/1 outcomes. */
export function brier(preds: number[], ys: number[]): number {
  let s = 0;
  for (let i = 0; i < ys.length; i++) s += (preds[i]! - ys[i]!) ** 2;
  return ys.length === 0 ? NaN : s / ys.length;
}

/** Standard deviation of a sample (population form; used for bootstrap spreads). */
export function stdev(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
}

/** Bootstrap standard errors of a fit: resample rows with a seeded generator, refit, spread per coef. */
export function bootstrapSE<T>(
  n: number,
  refits: number,
  seed: number,
  refit: (sampleIdx: number[]) => number[] | null,
): { se: number[]; coefs: number[][] } {
  const rand = rng(seed);
  const coefs: number[][] = [];
  for (let r = 0; r < refits; r++) {
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push(Math.floor(rand() * n));
    const c = refit(idx);
    if (c !== null) coefs.push(c);
  }
  if (coefs.length === 0) return { se: [], coefs };
  const p = coefs[0]!.length;
  const se: number[] = [];
  for (let j = 0; j < p; j++) se.push(stdev(coefs.map((c) => c[j]!)));
  return { se, coefs };
}
