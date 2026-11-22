// stats.ts — small deterministic numerical helpers for the radar-7 models.
// Everything here is seeded and reproducible: the same snapshot always
// produces the same numbers, run after run.

/** mulberry32: tiny seeded PRNG, good enough for bootstrap resampling. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Solve A x = b for a small dense A by Gauss-Jordan with partial pivoting. */
export function solve(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (piv !== col) [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / d;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / (M[i][i] || 1e-12));
}

/** Inverse of a small dense matrix via repeated solves. */
export function inverse(A: number[][]): number[][] {
  const n = A.length;
  const cols: number[][] = [];
  for (let j = 0; j < n; j++) {
    const e = new Array(n).fill(0); e[j] = 1;
    cols.push(solve(A, e));
  }
  return A.map((_, i) => cols.map((c) => c[i]));
}

export interface LinFit {
  beta: number[];
  /** (X'X + ridge)^-1, for hat diagonals and standard errors. */
  inv: number[][];
  fitted: number[];
  resid: number[];
}

/**
 * Ridge-penalised least squares. `penalty[j]` is the ridge weight on
 * coefficient j (0 = unpenalised). Returns the fit plus the inverse of the
 * penalised Gram matrix, which gives exact leave-one-out residuals for any
 * linear smoother: e_loo,i = e_i / (1 - h_ii).
 */
export function fitLinear(X: number[][], y: number[], penalty: number[]): LinFit {
  const n = X.length, p = X[0].length;
  const G: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const v = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const xi = X[i];
    for (let a = 0; a < p; a++) {
      v[a] += xi[a] * y[i];
      for (let b = a; b < p; b++) G[a][b] += xi[a] * xi[b];
    }
  }
  for (let a = 0; a < p; a++) {
    for (let b = 0; b < a; b++) G[a][b] = G[b][a];
    G[a][a] += penalty[a];
  }
  const inv = inverse(G);
  const beta = inv.map((row) => row.reduce((s, g, j) => s + g * v[j], 0));
  const fitted = X.map((xi) => xi.reduce((s, x, j) => s + x * beta[j], 0));
  const resid = y.map((yi, i) => yi - fitted[i]);
  return { beta, inv, fitted, resid };
}

/** Diagonal of the hat matrix H = X (X'X + ridge)^-1 X'. */
export function hatDiag(X: number[][], inv: number[][]): number[] {
  const p = X[0].length;
  return X.map((xi) => {
    let h = 0;
    for (let a = 0; a < p; a++) {
      let s = 0;
      for (let b = 0; b < p; b++) s += inv[a][b] * xi[b];
      h += xi[a] * s;
    }
    return Math.min(h, 0.999999);
  });
}

/** One Huber IRLS reweighting pass over a linear fit; returns new beta. */
export function huberRefit(X: number[][], y: number[], penalty: number[], fit: LinFit): number[] {
  const mad = median(fit.resid.map((r) => Math.abs(r - median(fit.resid)))) || 1e-9;
  const k = 1.345 * 1.4826 * mad;
  const w = fit.resid.map((r) => (Math.abs(r) <= k ? 1 : k / Math.abs(r)));
  const n = X.length, p = X[0].length;
  const G: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const v = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const xi = X[i];
    for (let a = 0; a < p; a++) {
      v[a] += w[i] * xi[a] * y[i];
      for (let b = a; b < p; b++) G[a][b] += w[i] * xi[a] * xi[b];
    }
  }
  for (let a = 0; a < p; a++) {
    for (let b = 0; b < a; b++) G[a][b] = G[b][a];
    G[a][a] += penalty[a];
  }
  const inv = inverse(G);
  return inv.map((row) => row.reduce((s, g, j) => s + g * v[j], 0));
}

export interface LogFit {
  beta: number[];
  prob: number[];
  /** Inverse of the final IRLS Gram matrix (X'WX + ridge)^-1. */
  inv: number[][];
  /** Final IRLS weights p(1-p), for the one-step LOO approximation. */
  w: number[];
}

/** Logistic regression by IRLS with a ridge on every coefficient but the intercept. */
export function fitLogistic(X: number[][], y: number[], ridge = 1, start?: number[], maxIter = 40): LogFit {
  const n = X.length, p = X[0].length;
  let beta = start ? [...start] : new Array(p).fill(0);
  let inv: number[][] = [], w: number[] = new Array(n).fill(0.25), prob: number[] = new Array(n).fill(0.5);
  for (let iter = 0; iter < maxIter; iter++) {
    prob = X.map((xi) => {
      const z = xi.reduce((s, x, j) => s + x * beta[j], 0);
      return 1 / (1 + Math.exp(-clamp(z, -30, 30)));
    });
    w = prob.map((pi) => Math.max(pi * (1 - pi), 1e-9));
    const G: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
    const v = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const xi = X[i], ri = y[i] - prob[i];
      for (let a = 0; a < p; a++) {
        v[a] += xi[a] * ri;
        for (let b = a; b < p; b++) G[a][b] += w[i] * xi[a] * xi[b];
      }
    }
    for (let a = 0; a < p; a++) {
      for (let b = 0; b < a; b++) G[a][b] = G[b][a];
      if (a > 0) G[a][a] += ridge;
    }
    inv = inverse(G);
    const step = inv.map((row) => row.reduce((s, g, j) => s + g * v[j], 0));
    let move = 0;
    beta = beta.map((bj, j) => { const nb = bj + step[j]; move = Math.max(move, Math.abs(step[j])); return nb; });
    if (move < 1e-8) break;
  }
  prob = X.map((xi) => {
    const z = xi.reduce((s, x, j) => s + x * beta[j], 0);
    return 1 / (1 + Math.exp(-clamp(z, -30, 30)));
  });
  w = prob.map((pi) => Math.max(pi * (1 - pi), 1e-9));
  return { beta, prob, inv, w };
}

export function brier(y: number[], prob: number[]): number {
  return y.reduce((s, yi, i) => s + (yi - prob[i]) * (yi - prob[i]), 0) / y.length;
}

/** Typical multiplicative miss: exp(median |log error|), reported as a ×factor. */
export function typicalMiss(actual: number[], pred: number[]): number {
  const errs = actual.map((a, i) => Math.abs(Math.log(a / Math.max(pred[i], 1e-9))));
  return Math.exp(median(errs));
}
