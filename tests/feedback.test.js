/* Ground-truth feedback loop tests — node tests/feedback.test.js */
"use strict";
const { correctionFactors } = require("../js/13b-feedback.js");

let pass = 0, fail = 0;
const eq = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  ok ? (pass++, console.log("  ✓", n)) : (fail++, console.error("  ✗", n, "— expected", e, "got", a));
};
const approx = (n, a, e, t = 0.01) => {
  const ok = Math.abs(a - e) <= t;
  ok ? (pass++, console.log("  ✓", n)) : (fail++, console.error("  ✗", n, "— expected ≈", e, "got", a));
};

const mk = (zoneKind, estimatedFt, actualFt) => ({
  zoneKind, estimatedFt, actualFt, ratio: Math.round((actualFt / estimatedFt) * 1000) / 1000,
});

console.log("Learns a consistent bias");
{
  // tool consistently estimates 20% short on eaves
  const list = [
    mk("eave", 100, 120), mk("eave", 50, 60), mk("eave", 80, 96),
    mk("eave", 40, 48), mk("eave", 60, 72),
  ];
  const f = correctionFactors(list);
  approx("median factor = 1.2 (tool runs 20% short)", f.eave.median, 1.2);
  eq("5 jobs → reliable", f.eave.reliable, true);
  approx("bias reported as +20%", f.eave.biasPct, 20, 0.1);
  approx("consistent data → tiny spread", f.eave.spread, 0, 0.001);
}

console.log("Needs a real sample before it's trusted");
{
  const f = correctionFactors([mk("tree", 100, 150), mk("tree", 100, 140)]);
  eq("2 jobs → NOT reliable", f.tree.reliable, false);
  eq("count still reported", f.tree.n, 2);
}

console.log("Median resists a single mis-typed job");
{
  // four sane jobs at 1.1, one typo where someone entered 1000 instead of 100
  const list = [
    mk("bush", 100, 110), mk("bush", 100, 110), mk("bush", 100, 110),
    mk("bush", 100, 110), mk("bush", 100, 1000),
  ];
  const f = correctionFactors(list);
  approx("median ignores the outlier (1.1)", f.bush.median, 1.1);
  eq("mean would have been wrecked (>2)", f.bush.mean > 2, true);
  eq("large spread flags the inconsistency", f.bush.spread > 0.4, true);
}

console.log("Per-zone independence");
{
  const list = [
    mk("eave", 100, 120), mk("eave", 100, 120), mk("eave", 100, 120),
    mk("eave", 100, 120), mk("eave", 100, 120),
    mk("bush", 100, 80), mk("bush", 100, 80), mk("bush", 100, 80),
    mk("bush", 100, 80), mk("bush", 100, 80),
  ];
  const f = correctionFactors(list);
  approx("eaves under-estimated → ×1.2", f.eave.median, 1.2);
  approx("bushes over-estimated → ×0.8", f.bush.median, 0.8);
  approx("bush bias reported negative", f.bush.biasPct, -20, 0.1);
  eq("zones don't contaminate each other", Object.keys(f).sort(), ["bush", "eave"]);
}

console.log("Even sample sizes average the two middle values");
{
  const list = [mk("ridge", 100, 100), mk("ridge", 100, 120)];
  approx("median of [1.0, 1.2] = 1.1", correctionFactors(list).ridge.median, 1.1);
}

console.log("Empty input is safe");
eq("no records → empty factors", correctionFactors([]), {});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
