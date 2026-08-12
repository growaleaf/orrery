// ORRERY — gear-train continued-fraction core (pure, deterministic, headless-testable)
//
// A "train" is an even-length array of tooth counts [a0,b0, a1,b1, ...]. Each
// (a,b) pair is one meshing gear pair; consecutive pairs share an arbor (1:1
// coupling), so the train's overall ratio is the exact product of b_i/a_i.
// All ratio math is done as exact BigInt fractions — never a running float —
// so tolerance verdicts never depend on floating-point rounding.

export const TEETH_MIN = 8;
export const TEETH_MAX = 120;

// ---------- exact fraction arithmetic (BigInt) ----------

function babs(x) { return x < 0n ? -x : x; }

function gcdBig(a, b) {
  a = babs(a); b = babs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a === 0n ? 1n : a;
}

export function reduceFrac(f) {
  let { n, d } = f;
  if (d < 0n) { n = -n; d = -d; }
  const g = gcdBig(n, d);
  return { n: n / g, d: d / g };
}

export function fracFromInts(n, d) {
  return reduceFrac({ n: BigInt(n), d: BigInt(d) });
}

// Exact fraction from a plain decimal string, e.g. "365.2422" -> 1826211/5000.
export function fracFromDecimalString(s) {
  const str = String(s).trim();
  const neg = str.startsWith('-');
  const body = neg ? str.slice(1) : str;
  const [intPart, fracPart = ''] = body.split('.');
  const digits = (intPart || '0') + fracPart;
  const n = BigInt(digits) * (neg ? -1n : 1n);
  const d = 10n ** BigInt(fracPart.length);
  return reduceFrac({ n, d });
}

export function mulFrac(a, b) {
  return reduceFrac({ n: a.n * b.n, d: a.d * b.d });
}

export function divFrac(a, b) {
  return reduceFrac({ n: a.n * b.d, d: a.d * b.n });
}

export function subFrac(a, b) {
  return reduceFrac({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
}

export function cmpFrac(a, b) {
  const l = a.n * b.d, r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
}

export function fracToFloat(f) {
  return Number(f.n) / Number(f.d);
}

export const ONE = { n: 1n, d: 1n };
export const DAYS_PER_YEAR = fracFromDecimalString('365.2422');

// ---------- train ratio ----------

export function validateTrain(train) {
  if (!Array.isArray(train) || train.length === 0 || train.length % 2 !== 0) {
    return { valid: false, reason: 'train must be a non-empty even-length list of teeth counts' };
  }
  for (const t of train) {
    if (!Number.isInteger(t) || t < TEETH_MIN || t > TEETH_MAX) {
      return { valid: false, reason: `tooth count ${t} out of range [${TEETH_MIN},${TEETH_MAX}]` };
    }
  }
  return { valid: true };
}

// Exact product of driven/driver across each meshing pair.
export function trainRatio(train) {
  const v = validateTrain(train);
  if (!v.valid) throw new Error(v.reason);
  let f = ONE;
  for (let i = 0; i < train.length; i += 2) {
    f = mulFrac(f, fracFromInts(train[i + 1], train[i]));
  }
  return f;
}

export function pairCount(train) {
  return train.length / 2;
}

// ---------- tolerance (exact, cross-multiplied — no float in the verdict) ----------

// relErr = |achieved-target|/target, compared to tol without ever forming
// relErr as a float: |n_a*d_t - n_t*d_a| * tol.d  <=  tol.n * d_a * n_t
export function withinTolerance(achieved, target, tol) {
  const lhs = babs(achieved.n * target.d - target.n * achieved.d) * tol.d;
  const rhs = tol.n * achieved.d * target.n;
  return lhs <= rhs;
}

export function relErrorFrac(achieved, target) {
  const n = babs(achieved.n * target.d - target.n * achieved.d);
  const d = achieved.d * target.n;
  return reduceFrac({ n, d });
}

// ---------- drift ----------
// Over `years` real years (D = years * DAYS_PER_YEAR real days elapsed), a
// clock geared to complete one cycle every `achieved` days against a true
// cycle length of `target` days accumulates a phase error of, to first
// order, D * (achieved-target)/target days.
export function driftDaysFrac(achieved, target, years) {
  const D = mulFrac(DAYS_PER_YEAR, fracFromInts(years, 1));
  const err = divFrac(subFrac(achieved, target), target);
  return mulFrac(D, err);
}

export function driftLabel(driftFrac) {
  const days = Math.abs(fracToFloat(driftFrac));
  const sign = fracToFloat(driftFrac) < 0 ? 'early' : 'late';
  const secs = days * 86400;
  let mag;
  if (secs < 60) mag = `${secs.toFixed(1)} s`;
  else if (secs < 3600) mag = `${(secs / 60).toFixed(1)} min`;
  else if (days < 1) mag = `${(secs / 3600).toFixed(1)} hr`;
  else if (days < 365) mag = `${days.toFixed(1)} days`;
  else mag = `${(days / 365.2422).toFixed(1)} yrs`;
  return `${mag} ${sign}`;
}

// ---------- continued fractions (the apprentice's hint machine) ----------
// Standard convergent recurrence, run on the target's own exact fraction —
// no floats anywhere. Terminates naturally when the remainder hits zero
// (the target fraction fully consumed) or maxTerms is reached.
export function convergents(target, maxTerms = 12) {
  let n = target.n, d = target.d;
  let p_2 = 0n, p_1 = 1n, q_2 = 1n, q_1 = 0n;
  const out = [];
  for (let i = 0; i < maxTerms && d !== 0n; i++) {
    const a = n / d;
    const rem = n - a * d;
    const p = a * p_1 + p_2;
    const q = a * q_1 + q_2;
    out.push({ a, p, q });
    p_2 = p_1; p_1 = p; q_2 = q_1; q_1 = q;
    n = d; d = rem;
  }
  return out;
}

// ---------- deterministic PRNG (mulberry32) ----------

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- greedy train construction (deterministic, no rng) ----------
// At each of `maxPairs` steps, pick the (a,b) in [TEETH_MIN,TEETH_MAX]^2
// whose log-ratio is closest to the ideal per-step contribution (the
// geometric mean of the remaining residual) — this is the mechanical
// analogue of building a continued-fraction approximation stage by stage.
export function constructTrain(targetFrac, maxPairs) {
  let residual = fracToFloat(targetFrac);
  const chosen = [];
  for (let step = 0; step < maxPairs; step++) {
    const remaining = maxPairs - step;
    const idealLog = Math.log(residual) / remaining;
    let best = null, bestDist = Infinity;
    for (let a = TEETH_MIN; a <= TEETH_MAX; a++) {
      for (let b = TEETH_MIN; b <= TEETH_MAX; b++) {
        const dist = Math.abs(Math.log(b / a) - idealLog);
        if (dist < bestDist) { bestDist = dist; best = [a, b]; }
      }
    }
    chosen.push(best);
    residual = residual / (best[1] / best[0]);
  }
  const train = chosen.flat();
  return { train, ratio: trainRatio(train) };
}

// ---------- commission stock generation (solver-guaranteed solvable) ----------

export const COMMISSIONS = [
  { id: 'moon1', name: 'The Moon', days: '29.5306', tol: [1, 500], years: 10, par: 2 },
  { id: 'mercury1', name: 'Mercury', days: '87.9691', tol: [1, 500], years: 10, par: 2 },
  { id: 'venus1', name: 'Venus', days: '224.701', tol: [1, 300], years: 10, par: 2 },
  { id: 'sun1', name: 'The Sun', days: '365.2422', tol: [1, 500], years: 10, par: 3 },
  { id: 'mars1', name: 'Mars', days: '686.980', tol: [1, 2000], years: 10, par: 3 },
  { id: 'moon2', name: 'The Moon, Cut Finer', days: '29.5306', tol: [1, 5000], years: 20, par: 3 },
  { id: 'venus2', name: 'Venus, Cut Finer', days: '224.701', tol: [1, 2000], years: 20, par: 3 },
  { id: 'mercury2', name: 'Mercury, Cut Finer', days: '87.9691', tol: [1, 1000], years: 20, par: 3 },
  { id: 'jupiter1', name: 'Jupiter', days: '4332.59', tol: [1, 700], years: 30, par: 4 },
  { id: 'saturn1', name: 'Saturn', days: '10759.22', tol: [1, 700], years: 30, par: 4 },
  { id: 'sun2', name: 'The Sun, Cut Finer', days: '365.2422', tol: [1, 5000], years: 30, par: 4 },
  { id: 'metonic', name: 'The Metonic Bonus', days: '6939.6882', tol: [1, 600], years: 19, par: 4, metonic: true },
];

export function commissionTarget(c) {
  return fracFromDecimalString(c.days);
}
export function commissionTol(c) {
  return fracFromInts(c.tol[0], c.tol[1]);
}

const DECOYS_BY_PAR = { 2: 4, 3: 4, 4: 3 };

// Deterministic per (seed, commission id). Returns a stock guaranteed to
// contain at least one within-tolerance train (the embedded solution),
// padded with decoy gears and shuffled.
export function generateStock(seed, commission) {
  const target = commissionTarget(commission);
  const tol = commissionTol(commission);
  const rng = mulberry32((seed ^ hashId(commission.id)) >>> 0);

  let par = commission.par;
  let solution = null;
  for (let tryPar = par; tryPar <= 5; tryPar++) {
    const built = constructTrain(target, tryPar);
    if (withinTolerance(built.ratio, target, tol)) { solution = built; par = tryPar; break; }
  }
  if (!solution) throw new Error(`no construction found for ${commission.id}`);

  const decoyCount = DECOYS_BY_PAR[par] ?? 4;
  const gears = solution.train.slice();
  for (let i = 0; i < decoyCount; i++) {
    gears.push(TEETH_MIN + Math.floor(rng() * (TEETH_MAX - TEETH_MIN + 1)));
  }
  // seeded shuffle (Fisher-Yates)
  for (let i = gears.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [gears[i], gears[j]] = [gears[j], gears[i]];
  }
  return {
    gears: gears.map((teeth, i) => ({ id: i, teeth })),
    parGearCount: par * 2,
  };
}

function hashId(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------- solver (proves a stock is solvable; also usable as an in-game hint) ----------
// Depth-first, best-first ordering (same log-closeness heuristic as
// construction) with a hard node-visit cap so pathological stocks fail fast
// instead of hanging. Tries increasing depth so the first success found is
// also the minimal gear count (useful for both proofs and scoring).
export function solverVerify(stockGears, target, tol, maxPairs, nodeCap = 20000) {
  const teeth = stockGears.map(g => g.teeth);
  const n = teeth.length;
  let nodes = 0;

  function search(depth, remainingMask, usedTrain, residualTarget) {
    if (nodes++ > nodeCap) return null;
    const ratioSoFar = usedTrain.length ? trainRatio(usedTrain) : ONE;
    if (usedTrain.length > 0 && withinTolerance(ratioSoFar, target, tol)) {
      return usedTrain.slice();
    }
    if (depth === 0) return null;

    const idealLog = Math.log(fracToFloat(residualTarget)) / depth;
    const candidates = [];
    for (let i = 0; i < n; i++) {
      if (!(remainingMask & (1 << i))) continue;
      for (let j = 0; j < n; j++) {
        if (i === j || !(remainingMask & (1 << j))) continue;
        const dist = Math.abs(Math.log(teeth[j] / teeth[i]) - idealLog);
        candidates.push({ i, j, dist });
      }
    }
    candidates.sort((x, y) => x.dist - y.dist);

    for (const { i, j } of candidates) {
      const nextMask = remainingMask & ~(1 << i) & ~(1 << j);
      const nextResidual = divFrac(residualTarget, fracFromInts(teeth[j], teeth[i]));
      const result = search(depth - 1, nextMask, [...usedTrain, teeth[i], teeth[j]], nextResidual);
      if (result) return result;
      if (nodes > nodeCap) return null;
    }
    return null;
  }

  const fullMask = n >= 31 ? -1 : (1 << n) - 1;
  return search(maxPairs, fullMask, [], target);
}

// ---------- par scorer ----------
// Strictly non-increasing in gear count used; ties broken by nothing (pure
// function of the count relative to par).
export function scoreForGearCount(usedGearCount, parGearCount) {
  const over = Math.max(0, usedGearCount - parGearCount);
  return Math.max(0, 100 - over * 20);
}

export function verdictLabel(usedGearCount, parGearCount) {
  if (usedGearCount <= parGearCount) return 'the clockmaker bows';
  if (usedGearCount <= parGearCount + 2) return 'sound work';
  return 'it runs, at least';
}
