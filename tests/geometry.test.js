/* Geometry tests: complexity, zone mapping, satellite scale, and the
 * dimensional plant/tree strand math. Run: node tests/geometry.test.js */
"use strict";
const {
  complexityFromPitch, itemKeyForZone, ROOFLINE_ZONE_KINDS,
  satelliteFtPerNorm, satDistFt, computeSatFootprint, calibrationFactorFrom,
  spacingInches, bushLightFootage, treeLightFootage, strandsFromFootage,
  bushStrandBreakdown, treeStrandBreakdown,
  pitchFactor, assumedPitch, applyPitchToPlanLength,
  footprintEdges, frontEdgeOf, rooflineFromEdge,
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

const RULES = {
  strandCoverageFt: 14, garlandStrandFt: 9,
  bushStrandCaps: { small: 2, medium: 3, large: 5, xl: 6 },
  wrapSpacing: { taperFactor: 0.8 },
  spacingTightIn: 4, spacingStandardIn: 6, spacingWideIn: 10,
};

console.log("Peak calculator is fully removed");
{
  const mod = require("../js/06b-geometry.js");
  eq("no peakSides export", mod.peakSides === undefined, true);
  eq("no peakHeightForBase export", mod.peakHeightForBase === undefined, true);
  eq("no DEFAULT_PEAK_TABLE export", mod.DEFAULT_PEAK_TABLE === undefined, true);
  const cfgMod = require("../js/01-core-config.js");
  eq("no peakHeightTable in default config", cfgMod.DEFAULT_PRICING.rules.peakHeightTable === undefined, true);
}

console.log("Complexity from pitch");
eq("3/12 → easy", complexityFromPitch(3), "easy");
eq("5/12 → mid", complexityFromPitch(5), "mid");
eq("7/12 → hard (price guide boundary)", complexityFromPitch(7), "hard");
eq("no pitch → null", complexityFromPitch(0), null);

console.log("Zone → price item mapping");
eq("garage eave is a ROOFLINE, not a window wrap", itemKeyForZone("garage", "easy"), "roofline_easy");
eq("rake follows complexity", itemKeyForZone("rake", "hard"), "roofline_hard");
eq("ridge keeps its own rate", itemKeyForZone("ridge", "hard"), "ridge");
eq("tree → tree strands", itemKeyForZone("tree", "mid"), "tree_strand");
eq("one complexity → one roofline rate",
  new Set(["eave", "rake", "gable", "peak", "dormer", "garage"].map((k) => itemKeyForZone(k, "hard"))).size, 1);
eq("roofline kinds re-map; ridge/window don't",
  ROOFLINE_ZONE_KINDS.has("eave") && !ROOFLINE_ZONE_KINDS.has("ridge") && !ROOFLINE_ZONE_KINDS.has("window"), true);

console.log("Satellite scale math (exact Google ground resolution)");
{
  approx("equator: image spans 313.5 ft", satelliteFtPerNorm(0), 313.49, 0.2);
  approx("lat 60°: half the span", satelliteFtPerNorm(60), 313.49 / 2, 0.2);
  const lat = 42, ftPer = satelliteFtPerNorm(lat);
  const w = 52 / ftPer, h = 30 / ftPer;
  const fp = [
    { x: 0.5 - w / 2, y: 0.5 - h / 2 }, { x: 0.5 + w / 2, y: 0.5 - h / 2 },
    { x: 0.5 + w / 2, y: 0.5 + h / 2 }, { x: 0.5 - w / 2, y: 0.5 + h / 2 },
  ];
  approx("52×30 footprint front = 52 ft", computeSatFootprint(fp, 2, lat).frontFt, 52, 0.2);
  approx("perimeter = 164 ft", computeSatFootprint(fp, 2, lat).perimeterFt, 164, 0.5);
  eq("degenerate polygon rejected", computeSatFootprint([{ x: 0, y: 0 }], 0, lat), null);
  approx("factor 52/44 → ×1.182", calibrationFactorFrom(52, 44), 1.182, 0.001);
  eq("wild disagreement rejected", calibrationFactorFrom(150, 50), null);
  eq("implausible building rejected", calibrationFactorFrom(10, 44), null);
}

console.log("Spacing presets read from config");
eq("tight = 4 in", spacingInches("tight", RULES), 4);
eq("standard = 6 in", spacingInches("standard", RULES), 6);
eq("wide = 10 in", spacingInches("wide", RULES), 10);
eq("unknown falls back to standard", spacingInches("bogus", RULES), 6);
eq("office-tuned value respected", spacingInches("tight", { ...RULES, spacingTightIn: 3 }), 3);

console.log("Bush footage: dimensional, never width-alone");
{
  // wrap: wraps = h/s × π×avg(w,d) × taper. 4w×3h×3d @6": wraps=6, avg=3.5
  // → 6 × π×3.5 × .8 = 52.78 ft
  approx("4×3×3 wrap @6\" = 52.8 ft", bushLightFootage({ widthFt: 4, heightFt: 3, depthFt: 3, pattern: "wrap", spacingKey: "standard" }, RULES), 52.8, 0.2);
  // same width, taller bush → more footage (width alone would say equal)
  const short = bushLightFootage({ widthFt: 4, heightFt: 2, depthFt: 3, pattern: "wrap" }, RULES);
  const tall = bushLightFootage({ widthFt: 4, heightFt: 5, depthFt: 3, pattern: "wrap" }, RULES);
  eq("taller bush needs more light than shorter (same width)", tall > short * 1.5, true);
  // deeper bush → more footage
  const shallow = bushLightFootage({ widthFt: 4, heightFt: 3, depthFt: 1.5, pattern: "wrap" }, RULES);
  const deep = bushLightFootage({ widthFt: 4, heightFt: 3, depthFt: 5, pattern: "wrap" }, RULES);
  eq("deeper bush needs more light (same width & height)", deep > shallow, true);
  // surface: area/s = (4×3 + 4×3/2)/0.5 = 36 ft
  approx("surface 4×3×3 @6\" = 36 ft", bushLightFootage({ widthFt: 4, heightFt: 3, depthFt: 3, pattern: "surface", spacingKey: "standard" }, RULES), 36, 0.2);
  approx("branch style = surface × 1.35", bushLightFootage({ widthFt: 4, heightFt: 3, depthFt: 3, pattern: "branch" }, RULES), 48.6, 0.3);
  // missing depth defaults to 0.8 × width
  approx("missing depth → 0.8×width assumed",
    bushLightFootage({ widthFt: 5, heightFt: 3, pattern: "surface" }, RULES),
    bushLightFootage({ widthFt: 5, heightFt: 3, depthFt: 4, pattern: "surface" }, RULES), 0.01);
}

console.log("Spacing directly drives strand count (tight > standard > wide)");
{
  // FOOTAGE always responds to spacing, regardless of any strand cap
  const plant = { widthFt: 5, heightFt: 4, depthFt: 4, pattern: "wrap" };
  const fT = bushLightFootage({ ...plant, spacingKey: "tight" }, RULES);
  const fS = bushLightFootage({ ...plant, spacingKey: "standard" }, RULES);
  const fW = bushLightFootage({ ...plant, spacingKey: "wide" }, RULES);
  eq(`footage: tight(${fT}) > standard(${fS}) > wide(${fW})`, fT > fS && fS > fW, true);

  // STRANDS respond too, on a plant small enough that the cap doesn't bind
  const small = { widthFt: 2.5, heightFt: 2, depthFt: 2, pattern: "wrap", sizeClass: "xl" };
  const sT = bushStrandBreakdown({ ...small, spacingKey: "tight" }, RULES);
  const sS = bushStrandBreakdown({ ...small, spacingKey: "standard" }, RULES);
  const sW = bushStrandBreakdown({ ...small, spacingKey: "wide" }, RULES);
  eq(`strands: tight(${sT.strands}) > standard(${sS.strands}) ≥ wide(${sW.strands})`,
    sT.strands > sS.strands && sS.strands >= sW.strands, true);
  eq("gap shown in breakdown (tight=4\")", sT.spacingIn, 4);
  eq("strands are whole numbers", Number.isInteger(sT.strands) && Number.isInteger(sW.strands), true);

  // And the cap deliberately clamps oversized results (Rule 11 anti-overcharge)
  const capped = bushStrandBreakdown({ widthFt: 5, heightFt: 4, depthFt: 4, pattern: "wrap", spacingKey: "tight", sizeClass: "medium" }, RULES);
  eq(`cap clamps a big/tight bush to the medium cap (${capped.strands} = 3)`, capped.strands, 3);
}

console.log("Bush caps and rounding");
{
  eq("14 ft → 1 strand", strandsFromFootage(14, null, RULES), 1);
  eq("14.1 ft → 2 strands (round UP, no partial strands)", strandsFromFootage(14.1, null, RULES), 2);
  eq("small cap = 2", strandsFromFootage(100, "small", RULES), 2);
  eq("xl cap = 6", strandsFromFootage(100, "xl", RULES), 6);
  eq("minimum 1 strand", strandsFromFootage(0.5, null, RULES), 1);
}

console.log("Tree footage: trunk/branch dimensional — NOT just height");
{
  // trunk: wraps = 8/0.5 = 16 × circ 3 × taper .8 = 38.4 ft
  approx("trunk wrap: 8ft trunk, 3ft circ @6\" = 38.4 ft",
    treeLightFootage({ heightFt: 18, trunkHeightFt: 8, trunkCircumFt: 3, style: "trunk", spacingKey: "standard" }, RULES), 38.4, 0.2);
  // branch: 6 branches × (5/0.5 wraps) × 1.2 circ × .8 = 57.6
  approx("branch wrap: 6 br × 5ft × 1.2 circ @6\" = 57.6 ft",
    treeLightFootage({ heightFt: 18, branchCount: 6, branchLenFt: 5, branchCircumFt: 1.2, style: "branch", spacingKey: "standard" }, RULES), 57.6, 0.3);
  // trunk_branch = both
  approx("trunk+branch = sum of both", treeLightFootage({ heightFt: 18, trunkHeightFt: 8, trunkCircumFt: 3, branchCount: 6, branchLenFt: 5, branchCircumFt: 1.2, style: "trunk_branch" }, RULES), 96, 0.5);
  // same height, fatter trunk → more light (height-only math would say equal)
  const thin = treeLightFootage({ heightFt: 18, trunkHeightFt: 8, trunkCircumFt: 2, style: "trunk" }, RULES);
  const fat = treeLightFootage({ heightFt: 18, trunkHeightFt: 8, trunkCircumFt: 4, style: "trunk" }, RULES);
  eq("fatter trunk (same height) needs more light", fat > thin * 1.5, true);
  // more branches → more light
  const few = treeLightFootage({ heightFt: 18, branchCount: 3, branchLenFt: 5, branchCircumFt: 1.2, style: "branch" }, RULES);
  const many = treeLightFootage({ heightFt: 18, branchCount: 9, branchLenFt: 5, branchCircumFt: 1.2, style: "branch" }, RULES);
  approx("3× branches ≈ 3× light", many / few, 3, 0.05);
  // spacing drives trees too
  const tight = treeStrandBreakdown({ heightFt: 18, trunkHeightFt: 8, trunkCircumFt: 3, style: "trunk", spacingKey: "tight" }, RULES);
  const wide = treeStrandBreakdown({ heightFt: 18, trunkHeightFt: 8, trunkCircumFt: 3, style: "trunk", spacingKey: "wide" }, RULES);
  eq(`tree: tight(${tight.strands}) > wide(${wide.strands}) strands`, tight.strands > wide.strands, true);
  // trees NOT capped by bush size classes
  const big = treeStrandBreakdown({ heightFt: 30, trunkHeightFt: 14, trunkCircumFt: 5, branchCount: 10, branchLenFt: 8, branchCircumFt: 2, style: "trunk_branch", spacingKey: "tight" }, RULES);
  eq("big tree can exceed bush caps (" + big.strands + " strands)", big.strands > 6, true);
  // sane defaults when only height known
  const bare = treeStrandBreakdown({ heightFt: 12 }, RULES);
  eq("height-only estimate still produces sane strands (1-6)", bare.strands >= 1 && bare.strands <= 6, true);
}

console.log("Zoom-aware scale (a wrong zoom would double every measurement)");
{
  const at20 = satelliteFtPerNorm(42, 20);
  const at21 = satelliteFtPerNorm(42, 21);
  approx("zoom 21 covers exactly half the ground of zoom 20", at21, at20 / 2, 0.01);
  const p1 = { x: 0.4, y: 0.5 }, p2 = { x: 0.6, y: 0.5 };
  approx("same drag = half the feet at zoom 21", satDistFt(p1, p2, 42, 21), satDistFt(p1, p2, 42, 20) / 2, 0.01);
  eq("default zoom is 20 (back-compat with saved projects)", satDistFt(p1, p2, 42), satDistFt(p1, p2, 42, 20));
}

console.log("Pitch correction (slope math, applied to MEASURED lengths)");
{
  eq("flat/no pitch → ×1", pitchFactor(0), 1);
  approx("6/12 → ×1.118", pitchFactor(6), 1.118, 0.001);
  approx("12/12 (45°) → ×1.414", pitchFactor(12), 1.414, 0.001);
  approx("9/12 → ×1.25", pitchFactor(9), 1.25, 0.001);
  eq("absurd pitch clamped at 18/12", pitchFactor(99), pitchFactor(18));
  // only sloped kinds are corrected
  eq("eave NOT corrected (already horizontal)", applyPitchToPlanLength(40, "eave", 9).applied, false);
  eq("ridge NOT corrected", applyPitchToPlanLength(40, "ridge", 9).applied, false);
  eq("ground run NOT corrected", applyPitchToPlanLength(40, "ground", 9).applied, false);
  eq("rake IS corrected", applyPitchToPlanLength(40, "rake", 9).applied, true);
  approx("rake 40 ft plan @9/12 → 50 ft true", applyPitchToPlanLength(40, "rake", 9).ft, 50, 0.1);
  eq("gable/dormer/peak also sloped",
    ["gable", "dormer", "peak"].every((k) => applyPitchToPlanLength(20, k, 8).applied), true);
  // assumed pitch per complexity
  eq("hard roof assumes 9/12", assumedPitch("hard"), 9);
  eq("mid assumes 5/12", assumedPitch("mid"), 5);
  eq("easy assumes 3/12", assumedPitch("easy"), 3);
}

console.log("Direct edge measurement from the footprint");
{
  const lat = 42, ftPer = satelliteFtPerNorm(lat, 20);
  const w = 52 / ftPer, h = 30 / ftPer;
  const fp = [
    { x: 0.5 - w / 2, y: 0.5 - h / 2 }, { x: 0.5 + w / 2, y: 0.5 - h / 2 },
    { x: 0.5 + w / 2, y: 0.5 + h / 2 }, { x: 0.5 - w / 2, y: 0.5 + h / 2 },
  ];
  const edges = footprintEdges(fp, lat, 20);
  eq("4 edges from a rectangle", edges.length, 4);
  approx("edge 0 (top) = 52 ft", edges[0].ft, 52, 0.2);
  approx("edge 1 (right) = 30 ft", edges[1].ft, 30, 0.2);
  eq("horizontal edge reads ~0°", edges[0].angleDeg < 5 || edges[0].angleDeg > 175, true);
  eq("vertical edge reads ~90°", Math.abs(edges[1].angleDeg - 90) < 5, true);
  // front edge selection
  approx("explicit front index honored", frontEdgeOf(edges, 2).ft, 52, 0.2);
  const auto = frontEdgeOf(edges, null);
  eq("auto-pick chooses a long street-facing edge", auto.ft > 40, true);
  eq("auto-pick prefers the lower (street-side) edge", auto.mid.y > 0.5, true);
  // overhang
  approx("52 ft edge + 12\" each side = 54 ft roofline", rooflineFromEdge(52, 12), 54, 0.01);
  approx("overhang configurable (6\")", rooflineFromEdge(52, 6), 53, 0.01);
  eq("empty footprint → no edges", footprintEdges([], lat, 20).length, 0);
  eq("frontEdgeOf handles empty", frontEdgeOf([], 0), null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
