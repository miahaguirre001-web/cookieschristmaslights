/* =========================================================================
 * 06b-geometry.js — Roof geometry: the PEAK CALCULATOR and roof-complexity
 * classification.
 *
 * WHY THIS EXISTS: asking a vision model for a diagonal rake length off a
 * single photo is the least reliable thing we ask it (foreshortening makes
 * diagonals read short). Asking for a HORIZONTAL base width is much more
 * reliable — it sits in the same plane as the eave we already measure well.
 * So: AI estimates the gable's base width, and we DERIVE both rake lengths
 * from the company's peak table. Same math as the office's isosceles
 * calculator: side = √((base ÷ 2)² + height²).
 *
 * The height lookup is a company rule of thumb, so it lives in config and is
 * editable in the Pricing Guide (Rule 17) — never hard-coded here.
 * ========================================================================= */
"use strict";

/* Company peak-height table. maxBase:null = "anything larger".
 * Seeded from the office's isosceles calculator. */
const DEFAULT_PEAK_TABLE = [
  { maxBase: 8,    height: 2 },
  { maxBase: 15,   height: 5 },
  { maxBase: 25,   height: 7 },
  { maxBase: 35,   height: 10 },
  { maxBase: 45,   height: 13 },
  { maxBase: null, height: 17 },
];

/* Peak height for a given base width, per the table (step function — matches
 * the office calculator exactly; do not interpolate without asking them). */
function peakHeightForBase(base, table) {
  const t = (table && table.length ? table : DEFAULT_PEAK_TABLE)
    .slice()
    .sort((a, b) => (a.maxBase == null ? 1 : b.maxBase == null ? -1 : a.maxBase - b.maxBase));
  for (const row of t) {
    if (row.maxBase == null || base <= row.maxBase) return row.height;
  }
  return t[t.length - 1].height;
}

/* The calculator: base width → peak height, each rake side, both sides total. */
function peakSides(base, table) {
  const b = Math.max(0, Number(base) || 0);
  const height = peakHeightForBase(b, table);
  const side = Math.sqrt(Math.pow(b / 2, 2) + Math.pow(height, 2));
  return {
    base: r2(b),
    height: r2(height),
    side: r2(side),
    total: r2(side * 2),
    pitchPer12: b > 0 ? r2((height / (b / 2)) * 12) : 0,   // rise per 12" run
  };
}

const r2 = (n) => Math.round(n * 100) / 100;

/* ---- Roof complexity ----
 * ONE classification per property drives ALL roofline line items, so a house
 * can't be "easy" and "hard" at the same time. Criteria mirror the price
 * guide: Easy = flat/very low pitch, In-Between = moderate, Hard = steep
 * (7/12 or greater). */
const ROOF_COMPLEXITY = {
  easy: { key: "easy", label: "Easy", itemKey: "roofline_easy", desc: "Flat roof or very small pitch" },
  mid:  { key: "mid",  label: "In-Between", itemKey: "roofline_mid", desc: "Moderate pitch — between flat and steep" },
  hard: { key: "hard", label: "Hard", itemKey: "roofline_hard", desc: "Steep peaks — 7/12 slope or greater" },
};

/* Derive complexity from an estimated pitch when the AI gives us one. */
function complexityFromPitch(pitchPer12) {
  if (!(pitchPer12 > 0)) return null;
  if (pitchPer12 >= 7) return "hard";
  if (pitchPer12 >= 4) return "mid";
  return "easy";
}

/* Map a zone kind + the property's complexity → the correct price item.
 * This is what stops a garage eave being billed as a window wrap. */
function itemKeyForZone(zoneKind, complexity) {
  const c = ROOF_COMPLEXITY[complexity] ? complexity : "mid";
  switch (zoneKind) {
    case "ridge":   return "ridge";
    case "side":    return "roofline_side";
    case "eave":
    case "rake":
    case "gable":
    case "peak":
    case "dormer":
    case "garage":  return ROOF_COMPLEXITY[c].itemKey;
    case "window":  return "c7_window";
    case "icicle":  return "icicle";
    case "ground":  return "ground_stake";
    case "bush":
    case "shrub":
    case "plant":   return "bush_strand";
    case "tree":    return "tree_strand";
    case "pillar":  return "pillar_strand";
    case "garland": return "garland_strand";
    default:        return null;
  }
}

/* Zone kinds that are roofline-priced and therefore re-map when the
 * estimator changes the property's complexity. */
const ROOFLINE_ZONE_KINDS = new Set(["eave", "rake", "gable", "peak", "dormer", "garage"]);

/* ---- Satellite scale math ----
 * Google Static Maps ground resolution is EXACT and latitude-dependent:
 *   meters per logical pixel = 156543.03392 × cos(lat) / 2^zoom
 * Our satellite import is zoom 20, size 640 logical px (scale=2 doubles the
 * pixels but not the coverage). So a normalized 0–1 distance across the
 * image converts to real feet with NO AI involved — this is the same
 * principle roof-measurement services are built on. */
const SAT_ZOOM = 20;
const SAT_LOGICAL_PX = 640;
const M_TO_FT = 3.28084;

function satelliteFtPerNorm(lat, zoom = SAT_ZOOM, logicalPx = SAT_LOGICAL_PX) {
  const mPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  return logicalPx * mPerPx * M_TO_FT;   // feet spanned by the full image width
}

/* Distance in feet between two normalized points on the satellite image
 * (square image → same scale on both axes). */
function satDistFt(p1, p2, lat) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y) * satelliteFtPerNorm(lat);
}

/* Given a footprint polygon + which edge faces the street, return real-world
 * sizes. Falls back to the longest edge when frontIdx is missing/invalid. */
function computeSatFootprint(footprint, frontIdx, lat) {
  if (!Array.isArray(footprint) || footprint.length < 3) return null;
  const n = footprint.length;
  const edges = [];
  for (let i = 0; i < n; i++) {
    edges.push({ i, ft: satDistFt(footprint[i], footprint[(i + 1) % n], lat) });
  }
  const perimeterFt = edges.reduce((s, e) => s + e.ft, 0);
  let front = (Number.isInteger(frontIdx) && frontIdx >= 0 && frontIdx < n)
    ? edges[frontIdx]
    : null;
  if (!front || front.ft < 8) {
    front = edges.reduce((a, b) => (b.ft > a.ft ? b : a));
  }
  return {
    frontFt: Math.round(front.ft * 10) / 10,
    perimeterFt: Math.round(perimeterFt * 10) / 10,
    edgesFt: edges.map((e) => Math.round(e.ft * 10) / 10),
  };
}

/* Guard rails for the auto-calibration factor: outside this band the
 * footprint read is more likely wrong than the analysis. */
function calibrationFactorFrom(satFrontFt, aiFrontFt) {
  if (!(satFrontFt > 0) || !(aiFrontFt > 0)) return null;
  if (satFrontFt < 15 || satFrontFt > 200) return null;   // implausible building
  const factor = satFrontFt / aiFrontFt;
  if (factor < 0.4 || factor > 2.5) return null;          // disagreement too wild
  return Math.round(factor * 1000) / 1000;
}

if (typeof module !== "undefined") {
  module.exports = {
    DEFAULT_PEAK_TABLE, peakHeightForBase, peakSides,
    complexityFromPitch, itemKeyForZone, ROOF_COMPLEXITY, ROOFLINE_ZONE_KINDS,
    satelliteFtPerNorm, satDistFt, computeSatFootprint, calibrationFactorFrom,
  };
}
