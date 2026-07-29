/* Peak calculator + roof complexity tests — node tests/geometry.test.js
 * Reference values computed from the office's isosceles calculator:
 *   height = step table, side = √((base/2)² + height²) */
"use strict";
const {
  DEFAULT_PEAK_TABLE, peakHeightForBase, peakSides,
  complexityFromPitch, itemKeyForZone, ROOFLINE_ZONE_KINDS,
} = require("../js/06b-geometry.js");

let pass = 0, fail = 0;
const eq = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  ok ? (pass++, console.log("  ✓", n)) : (fail++, console.error("  ✗", n, "— expected", e, "got", a));
};
const approx = (n, a, e, t = 0.01) => {
  const ok = Math.abs(a - e) <= t;
  ok ? (pass++, console.log("  ✓", n)) : (fail++, console.error("  ✗", n, "— expected ≈", e, "got", a));
};

const T = DEFAULT_PEAK_TABLE;

console.log("Height lookup matches the office table exactly");
eq("base 5 → 2 ft", peakHeightForBase(5, T), 2);
eq("base 8 (boundary) → 2 ft", peakHeightForBase(8, T), 2);
eq("base 8.1 → 5 ft", peakHeightForBase(8.1, T), 5);
eq("base 15 (boundary) → 5 ft", peakHeightForBase(15, T), 5);
eq("base 20 → 7 ft", peakHeightForBase(20, T), 7);
eq("base 25 (boundary) → 7 ft", peakHeightForBase(25, T), 7);
eq("base 30 → 10 ft", peakHeightForBase(30, T), 10);
eq("base 40 → 13 ft", peakHeightForBase(40, T), 13);
eq("base 46 → 17 ft (null row)", peakHeightForBase(46, T), 17);
eq("base 500 → 17 ft", peakHeightForBase(500, T), 17);

console.log("Side length matches √((base/2)² + h²)");
{
  // base 20 → h 7 → side √(100+49)=√149=12.2066
  const p = peakSides(20, T);
  approx("base 20: peak height 7", p.height, 7);
  approx("base 20: each side 12.21", p.side, 12.21);
  approx("base 20: both sides 24.41", p.total, 24.41);
  approx("base 20: implied pitch 8.4/12", p.pitchPer12, 8.4, 0.05);
}
{
  // base 30 → h 10 → side √(225+100)=√325=18.0278
  const p = peakSides(30, T);
  approx("base 30: each side 18.03", p.side, 18.03);
  approx("base 30: both sides 36.06", p.total, 36.06);
}
{
  // base 12 → h 5 → side √(36+25)=√61=7.8102
  const p = peakSides(12, T);
  approx("base 12: each side 7.81", p.side, 7.81);
}
{
  // matches the calculator's default view: base 20
  const p = peakSides(20, T);
  eq("default base 20 returns all four metrics", [p.base, p.height, p.side, p.total].every((v) => typeof v === "number"), true);
}

console.log("Edge cases don't produce garbage");
{
  const p = peakSides(0, T);
  eq("base 0 → side 2 (height only), no NaN", isFinite(p.side), true);
  const q = peakSides(-5, T);
  eq("negative base clamped, no NaN", isFinite(q.side) && q.base === 0, true);
  const r = peakSides("abc", T);
  eq("non-numeric base handled", isFinite(r.side), true);
}

console.log("Custom (office-edited) table is respected");
{
  const custom = [{ maxBase: 10, height: 3 }, { maxBase: null, height: 25 }];
  eq("base 9 uses custom 3 ft", peakHeightForBase(9, custom), 3);
  eq("base 11 uses custom 25 ft", peakHeightForBase(11, custom), 25);
  // unsorted table still works
  const unsorted = [{ maxBase: null, height: 30 }, { maxBase: 12, height: 4 }];
  eq("unsorted table sorts correctly", peakHeightForBase(5, unsorted), 4);
}

console.log("Complexity from pitch");
eq("3/12 → easy", complexityFromPitch(3), "easy");
eq("5/12 → mid", complexityFromPitch(5), "mid");
eq("7/12 → hard (price guide boundary)", complexityFromPitch(7), "hard");
eq("12/12 → hard", complexityFromPitch(12), "hard");
eq("no pitch → null", complexityFromPitch(0), null);

console.log("Zone → price item mapping (the garage bug)");
eq("garage eave is a ROOFLINE, not a window wrap", itemKeyForZone("garage", "easy"), "roofline_easy");
eq("garage follows complexity", itemKeyForZone("garage", "hard"), "roofline_hard");
eq("window → c7", itemKeyForZone("window", "hard"), "c7_window");
eq("ridge ignores complexity", itemKeyForZone("ridge", "hard"), "ridge");
eq("side roofline ignores complexity", itemKeyForZone("side", "hard"), "roofline_side");
eq("rake follows complexity", itemKeyForZone("rake", "mid"), "roofline_mid");
eq("eave follows complexity", itemKeyForZone("eave", "easy"), "roofline_easy");
eq("ground → stakes", itemKeyForZone("ground", "mid"), "ground_stake");
eq("bush → strands", itemKeyForZone("bush", "mid"), "bush_strand");
eq("tree → tree strands", itemKeyForZone("tree", "mid"), "tree_strand");
eq("pillar → pillar strands", itemKeyForZone("pillar", "mid"), "pillar_strand");
eq("unknown zone → null (caller falls back)", itemKeyForZone("nonsense", "mid"), null);
eq("bad complexity defaults to mid", itemKeyForZone("eave", "bogus"), "roofline_mid");

console.log("Complexity re-map covers every roofline zone kind");
{
  const kinds = ["eave", "rake", "gable", "peak", "dormer", "garage"];
  eq("all roofline kinds re-map", kinds.every((k) => ROOFLINE_ZONE_KINDS.has(k)), true);
  eq("ridge does NOT re-map (own rate)", ROOFLINE_ZONE_KINDS.has("ridge"), false);
  eq("window does NOT re-map", ROOFLINE_ZONE_KINDS.has("window"), false);
  // a house can never be easy AND hard: same kind+complexity is deterministic
  const a = kinds.map((k) => itemKeyForZone(k, "hard"));
  eq("one complexity → one roofline rate for all zones", new Set(a).size, 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
