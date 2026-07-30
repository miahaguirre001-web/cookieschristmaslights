/* Peak calculator + roof complexity tests — node tests/geometry.test.js
 * Reference values computed from the office's isosceles calculator:
 *   height = step table, side = √((base/2)² + height²) */
"use strict";
const {
  DEFAULT_PEAK_TABLE, peakHeightForBase, peakSides,
  complexityFromPitch, itemKeyForZone, ROOFLINE_ZONE_KINDS,
  satelliteFtPerNorm, satDistFt, computeSatFootprint, calibrationFactorFrom,
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

console.log("Satellite scale math (exact Google ground resolution)");
{
  // At the equator, zoom 20: 156543.03392 / 2^20 = 0.14929 m per logical px
  // × 640 px × 3.28084 = 313.49 ft full-image width
  approx("equator: image spans 313.5 ft", satelliteFtPerNorm(0), 313.49, 0.2);
  // cos(60°) = 0.5 → exactly half
  approx("lat 60°: half the span", satelliteFtPerNorm(60), 313.49 / 2, 0.2);
  // typical US lat 42°
  approx("lat 42°: ≈233 ft span", satelliteFtPerNorm(42), 313.49 * Math.cos(42 * Math.PI / 180), 0.3);
  // a 50 ft house at lat 42 occupies 50/233 ≈ 0.215 of the image
  const ftPer = satelliteFtPerNorm(42);
  approx("normalized 0.215 ≈ 50 ft at lat 42", satDistFt({ x: 0.4, y: 0.5 }, { x: 0.615, y: 0.5 }, 42), 0.215 * ftPer, 0.01);
  approx("diagonal distance uses hypot", satDistFt({ x: 0, y: 0 }, { x: 0.3, y: 0.4 }, 0), 0.5 * 313.49, 0.3);
}

console.log("Footprint → front width");
{
  const lat = 42;
  const ftPer = satelliteFtPerNorm(lat);
  // 52ft × 30ft rectangle centered in frame, front edge at the bottom (edge 2→3)
  const w = 52 / ftPer, h = 30 / ftPer;
  const fp = [
    { x: 0.5 - w / 2, y: 0.5 - h / 2 }, // 0 top-left
    { x: 0.5 + w / 2, y: 0.5 - h / 2 }, // 1 top-right
    { x: 0.5 + w / 2, y: 0.5 + h / 2 }, // 2 bottom-right
    { x: 0.5 - w / 2, y: 0.5 + h / 2 }, // 3 bottom-left
  ];
  const r = computeSatFootprint(fp, 2, lat);   // edge 2→3 is the 52 ft front
  approx("front edge = 52 ft", r.frontFt, 52, 0.2);
  approx("perimeter = 164 ft", r.perimeterFt, 164, 0.5);
  // bad frontEdge index falls back to longest edge (also 52 ft here)
  const r2 = computeSatFootprint(fp, 99, lat);
  approx("invalid front index → longest edge", r2.frontFt, 52, 0.2);
  eq("degenerate polygon rejected", computeSatFootprint([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0, lat), null);
}

console.log("Calibration factor guard rails");
{
  approx("sat 52 / ai 44 → ×1.182", calibrationFactorFrom(52, 44), 1.182, 0.001);
  eq("perfect agreement → ×1", calibrationFactorFrom(50, 50), 1);
  eq("implausibly small building rejected", calibrationFactorFrom(10, 44), null);
  eq("implausibly huge building rejected", calibrationFactorFrom(250, 44), null);
  eq("wild disagreement (×3) rejected", calibrationFactorFrom(150, 50), null);
  eq("wild disagreement (×0.3) rejected", calibrationFactorFrom(20, 66), null);
  eq("zero/missing input rejected", calibrationFactorFrom(0, 44), null);
  eq("edge of band accepted (×2.4)", calibrationFactorFrom(120, 50) !== null, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
