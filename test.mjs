// ORRERY headless tests — node test.mjs, exit 0 = green.
import * as G from './gears.mjs';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${name}${detail !== undefined ? ' — ' + bigJson(detail) : ''}`); }
}
const bigJson = (v) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? `${x}n` : x);
function deepEq(a, b) { return bigJson(a) === bigJson(b); }

// 1. exact decimal->fraction parsing
check('fracFromDecimalString exact', deepEq(G.fracFromDecimalString('365.2422'), { n: 1826211n, d: 5000n }));

// 2. reduceFrac reduces
check('reduceFrac reduces 4/8 to 1/2', deepEq(G.reduceFrac({ n: 4n, d: 8n }), { n: 1n, d: 2n }));

// 3. trainRatio exact product
{
  const r = G.trainRatio([10, 30, 20, 40]); // (30/10)*(40/20) = 3*2 = 6
  check('trainRatio exact product', deepEq(r, { n: 6n, d: 1n }), r);
}

// 4. trainRatio determinism
{
  const a = G.trainRatio([15, 90, 8, 100, 33, 71]);
  const b = G.trainRatio([15, 90, 8, 100, 33, 71]);
  check('trainRatio deterministic', deepEq(a, b));
}

// 5. validateTrain rejects bad shapes
check('validateTrain rejects odd length', !G.validateTrain([10, 20, 30]).valid);
check('validateTrain rejects out-of-range teeth', !G.validateTrain([5, 20]).valid);
check('validateTrain accepts valid train', G.validateTrain([8, 120, 60, 60]).valid);

// 6. withinTolerance exact boundary (cross-multiplied, no float)
{
  const target = G.fracFromInts(100, 1);
  const tol = G.fracFromInts(1, 100); // 1%
  const exactlyAtBound = G.fracFromInts(101, 1); // relErr exactly 1%
  const justOver = G.fracFromInts(1011, 10); // relErr 1.1%
  check('withinTolerance true at exact boundary', G.withinTolerance(exactlyAtBound, target, tol));
  check('withinTolerance false just over boundary', !G.withinTolerance(justOver, target, tol));
}

// 7. relErrorFrac matches hand-computed value
{
  const achieved = G.fracFromInts(11, 10); // 1.1
  const target = G.fracFromInts(1, 1);     // 1.0
  const rel = G.relErrorFrac(achieved, target); // |1.1-1|/1 = 0.1 = 1/10
  check('relErrorFrac exact', deepEq(rel, { n: 1n, d: 10n }), rel);
}

// 8. driftDaysFrac zero when achieved === target
{
  const t = G.fracFromDecimalString('29.5306');
  const d = G.driftDaysFrac(t, t, 10);
  check('driftDaysFrac zero at exact match', d.n === 0n, d);
}

// 9. driftDaysFrac sign flips with achieved above/below target
{
  const target = G.fracFromInts(30, 1);
  const above = G.fracFromInts(31, 1);
  const below = G.fracFromInts(29, 1);
  const dAbove = G.driftDaysFrac(above, target, 5);
  const dBelow = G.driftDaysFrac(below, target, 5);
  check('driftDaysFrac positive when achieved>target', G.fracToFloat(dAbove) > 0, dAbove);
  check('driftDaysFrac negative when achieved<target', G.fracToFloat(dBelow) < 0, dBelow);
}

// 10. driftDaysFrac scales linearly with years (exact fraction doubling)
{
  const target = G.fracFromInts(30, 1);
  const achieved = G.fracFromInts(31, 1);
  const d5 = G.driftDaysFrac(achieved, target, 5);
  const d10 = G.driftDaysFrac(achieved, target, 10);
  const doubled = G.mulFrac(d5, G.fracFromInts(2, 1));
  check('driftDaysFrac linear in years (exact)', deepEq(G.reduceFrac(doubled), G.reduceFrac(d10)), { doubled, d10 });
}

// 11. convergents satisfy the fundamental convergent identity (proves they
//     are TRUE convergents, not an arbitrary approximation sequence):
//     p_k*q_{k-1} - p_{k-1}*q_k = (-1)^(k-1)
{
  const target = G.fracFromDecimalString('3.14159265358979');
  const conv = G.convergents(target, 10);
  let ok = true;
  for (let k = 1; k < conv.length; k++) {
    const identity = conv[k].p * conv[k - 1].q - conv[k - 1].p * conv[k].q;
    const expected = (k % 2 === 1) ? 1n : -1n;
    if (identity !== expected) ok = false;
  }
  check('convergents satisfy Cassini-style identity', ok && conv.length > 5, conv);
}

// 12. convergents of a small known fraction match hand computation
//     7/3 = [2; 3] -> convergents 2/1, 7/3
{
  const conv = G.convergents(G.fracFromInts(7, 3), 5);
  check('convergents of 7/3 match hand computation',
    conv.length === 2 && conv[0].p === 2n && conv[0].q === 1n && conv[1].p === 7n && conv[1].q === 3n,
    conv);
}

// 13. mulberry32 determinism
{
  const seq = (seed) => { const r = G.mulberry32(seed); return [r(), r(), r()]; };
  check('mulberry32 deterministic per seed', deepEq(seq(42), seq(42)));
  check('mulberry32 differs across seeds', !deepEq(seq(1), seq(2)));
}

// 14. constructTrain is deterministic (pure function of target+maxPairs, no rng)
{
  const t = G.fracFromDecimalString('224.701');
  const a = G.constructTrain(t, 3);
  const b = G.constructTrain(t, 3);
  check('constructTrain deterministic', deepEq(a, b));
}

// 15. generateStock determinism (same seed+commission -> identical stock)
{
  const c = G.COMMISSIONS[0];
  const s1 = G.generateStock(7, c);
  const s2 = G.generateStock(7, c);
  check('generateStock deterministic per seed', deepEq(s1, s2));
  const s3 = G.generateStock(8, c);
  check('generateStock differs across seeds', !deepEq(s1, s3));
}

// 16. REQUIRED: every commission's stock admits a within-tolerance solution,
//     over 100 regenerations each (solver-proven, not just asserted).
{
  let allSolved = true;
  const failures = [];
  for (const c of G.COMMISSIONS) {
    const target = G.commissionTarget(c);
    const tol = G.commissionTol(c);
    for (let seed = 0; seed < 100; seed++) {
      const stock = G.generateStock(seed, c);
      const maxPairs = stock.parGearCount / 2;
      const found = G.solverVerify(stock.gears, target, tol, maxPairs);
      if (!found) { allSolved = false; failures.push([c.id, seed]); }
    }
  }
  check('every commission stock solvable across 100 regenerations', allSolved, failures.slice(0, 5));
}

// 17. a solver-found train genuinely satisfies tolerance when checked
//     independently via trainRatio + withinTolerance (no shortcut trust)
{
  const c = G.COMMISSIONS.find(x => x.id === 'sun1');
  const target = G.commissionTarget(c);
  const tol = G.commissionTol(c);
  const stock = G.generateStock(3, c);
  const found = G.solverVerify(stock.gears, target, tol, stock.parGearCount / 2);
  const ratio = G.trainRatio(found);
  check('solver-found train independently passes tolerance', G.withinTolerance(ratio, target, tol), { found, ratio });
}

// 18. par scorer is strictly non-increasing as gear count grows
{
  const par = 6;
  const scores = [4, 6, 8, 10, 14].map(n => G.scoreForGearCount(n, par));
  let monotonic = true;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[i - 1]) monotonic = false;
  check('scoreForGearCount non-increasing with gear count', monotonic, scores);
  check('scoreForGearCount at par is the max (100)', G.scoreForGearCount(par, par) === 100);
}

// 19. verdictLabel boundaries
check('verdictLabel at par', G.verdictLabel(6, 6) === 'the clockmaker bows');
check('verdictLabel well over par', G.verdictLabel(12, 6) === 'it runs, at least');

// 20. driftLabel picks sane units and correct early/late direction
{
  const target = G.fracFromInts(30, 1);
  const late = G.driftDaysFrac(G.fracFromInts(31, 1), target, 1); // achieved>target -> late
  const early = G.driftDaysFrac(G.fracFromInts(29, 1), target, 1); // achieved<target -> early
  check('driftLabel marks late correctly', G.driftLabel(late).endsWith('late'), G.driftLabel(late));
  check('driftLabel marks early correctly', G.driftLabel(early).endsWith('early'), G.driftLabel(early));
}

// 21. solverVerify correctly reports no solution on an impossible tiny stock
//     (guards against a false-positive solver)
{
  const target = G.fracFromDecimalString('365.2422');
  const tol = G.fracFromInts(1, 100000); // absurdly tight
  const tinyStock = [{ id: 0, teeth: 10 }, { id: 1, teeth: 11 }];
  const found = G.solverVerify(tinyStock, target, tol, 1);
  check('solverVerify returns null when genuinely unsolvable', found === null, found);
}

// 22. commission data integrity: 12 commissions, unique ids, par 2-4
check('exactly 12 commissions', G.COMMISSIONS.length === 12, G.COMMISSIONS.length);
check('commission ids unique', new Set(G.COMMISSIONS.map(c => c.id)).size === 12);
check('commission par within [2,4]', G.COMMISSIONS.every(c => c.par >= 2 && c.par <= 4));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
