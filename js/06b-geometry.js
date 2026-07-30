/* =========================================================================
 * 06b-geometry.js — Roof complexity, satellite scale math, and the
 * dimensional strand calculators for bushes/shrubs/trees.
 *
 * NOTE: the former "peak calculator" (base width → derived rake length) has
 * been REMOVED at the office's request. Rooflines are now measured as they
 * appear, cross-checked against the satellite footprint.
 * ========================================================================= */
"use strict";

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

const ROOFLINE_ZONE_KINDS = new Set(["eave", "rake", "gable", "peak", "dormer", "garage"]);

/* ---- Satellite scale math ----
 * Google Static Maps ground resolution is EXACT and latitude-dependent:
 *   meters per logical pixel = 156543.03392 × cos(lat) / 2^zoom
 * Our satellite import is zoom 20, size 640 logical px (scale=2 doubles the
 * pixels but not the coverage). So a normalized 0–1 distance across the
 * image converts to real feet with NO AI involved. */
const SAT_ZOOM = 20;
const SAT_LOGICAL_PX = 640;
const M_TO_FT = 3.28084;

function satelliteFtPerNorm(lat, zoom = SAT_ZOOM, logicalPx = SAT_LOGICAL_PX) {
  const mPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  return logicalPx * mPerPx * M_TO_FT;
}

/* zoom MUST match the tile that was actually fetched — zoom 21 covers half
 * the ground of zoom 20, so using the wrong one doubles every measurement. */
function satDistFt(p1, p2, lat, zoom = SAT_ZOOM) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y) * satelliteFtPerNorm(lat, zoom);
}

function computeSatFootprint(footprint, frontIdx, lat, zoom = SAT_ZOOM) {
  if (!Array.isArray(footprint) || footprint.length < 3) return null;
  const n = footprint.length;
  const edges = [];
  for (let i = 0; i < n; i++) {
    edges.push({ i, ft: satDistFt(footprint[i], footprint[(i + 1) % n], lat, zoom) });
  }
  const perimeterFt = edges.reduce((s, e) => s + e.ft, 0);
  let front = (Number.isInteger(frontIdx) && frontIdx >= 0 && frontIdx < n) ? edges[frontIdx] : null;
  if (!front || front.ft < 8) {
    front = edges.reduce((a, b) => (b.ft > a.ft ? b : a));
  }
  return {
    frontFt: Math.round(front.ft * 10) / 10,
    perimeterFt: Math.round(perimeterFt * 10) / 10,
    edgesFt: edges.map((e) => Math.round(e.ft * 10) / 10),
  };
}

function calibrationFactorFrom(satFrontFt, aiFrontFt) {
  if (!(satFrontFt > 0) || !(aiFrontFt > 0)) return null;
  if (satFrontFt < 15 || satFrontFt > 200) return null;
  const factor = satFrontFt / aiFrontFt;
  if (factor < 0.4 || factor > 2.5) return null;
  return Math.round(factor * 1000) / 1000;
}

/* ---- Pitch correction for SLOPED runs ----
 * Satellite measures PLAN (horizontal) distance. A rake/gable/dormer slope's
 * true length along the roof surface is longer:
 *     true = plan × √(1 + (pitch/12)²)
 * This corrects a MEASURED length; it does not invent a height. Eaves,
 * gutters, ridges and ground runs are already horizontal — no correction. */
const SLOPED_ZONE_KINDS = new Set(["rake", "gable", "peak", "dormer"]);

function pitchFactor(pitchPer12) {
  const p = Number(pitchPer12);
  if (!(p > 0)) return 1;
  const clamped = Math.min(p, 18);          // 18/12 is about as steep as roofs get
  return Math.round(Math.sqrt(1 + Math.pow(clamped / 12, 2)) * 1000) / 1000;
}

/* Typical pitch to assume per complexity when the model gives no number */
function assumedPitch(complexity) {
  return complexity === "hard" ? 9 : complexity === "easy" ? 3 : 5;
}

/* Apply only to sloped zone kinds; returns {ft, factor, applied}. */
function applyPitchToPlanLength(planFt, zoneKind, pitchPer12) {
  if (!SLOPED_ZONE_KINDS.has(zoneKind) || !(planFt > 0)) {
    return { ft: planFt, factor: 1, applied: false };
  }
  const f = pitchFactor(pitchPer12);
  return { ft: Math.round(planFt * f * 10) / 10, factor: f, applied: f > 1 };
}

/* ---- Direct edge measurement ----
 * The traced footprint already contains every edge length. For horizontal
 * roof runs the footprint edge IS the measurement (plus eave overhang on
 * each end), so we can price from arithmetic instead of AI estimation.
 * Matching is by orientation + position: a marked run's direction and
 * midpoint in the street photo maps to the footprint edge that faces the
 * street and runs the same way. */

/* Edge list with lengths, midpoints and compass-ish orientation. */
function footprintEdges(footprint, lat, zoom = SAT_ZOOM) {
  if (!Array.isArray(footprint) || footprint.length < 3) return [];
  const n = footprint.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = footprint[i], b = footprint[(i + 1) % n];
    const ft = satDistFt(a, b, lat, zoom);
    out.push({
      i, a, b, ft: Math.round(ft * 10) / 10,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      // angle in image space, 0 = horizontal (east-west), 90 = vertical
      angleDeg: Math.round(Math.abs(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI) % 180),
    });
  }
  return out;
}

/* The street-facing edge: prefer the caller's index, else the longest edge
 * closest to the bottom of the frame (Street View is shot from the road). */
function frontEdgeOf(edges, frontIdx) {
  if (!edges.length) return null;
  if (Number.isInteger(frontIdx) && edges[frontIdx] && edges[frontIdx].ft >= 8) return edges[frontIdx];
  const maxFt = Math.max(...edges.map((e) => e.ft));
  const longish = edges.filter((e) => e.ft >= maxFt * 0.6);
  return longish.reduce((best, e) => (e.mid.y > best.mid.y ? e : best), longish[0]);
}

/* Roofline length from a footprint edge, adding eave overhang at both ends.
 * overhangIn defaults to 12" per side (typical residential). */
function rooflineFromEdge(edgeFt, overhangIn = 12) {
  return Math.round((edgeFt + (2 * overhangIn) / 12) * 10) / 10;
}



/* =========================================================================
 * PLANT & TREE STRAND MATH — dimensional, spacing-driven.
 * The selected gap DIRECTLY drives strand count: tighter wrap = more lights.
 * Strand coverage (default 14 ft) and caps come from config (Rule 11/16/17).
 * ========================================================================= */

/* Spacing presets (inches between wraps / light rows). Values come from
 * config rules so the office can tune them. */
const SPACING_KEYS = ["tight", "standard", "wide"];
function spacingInches(spacingKey, rules) {
  const map = {
    tight: rules?.spacingTightIn ?? 4,
    standard: rules?.spacingStandardIn ?? 6,
    wide: rules?.spacingWideIn ?? 10,
  };
  return map[spacingKey] ?? map.standard;
}

const round1g = (v) => Math.round(v * 10) / 10;

/**
 * Bush/shrub footage from real dimensions — never from width alone.
 * pattern:
 *  "wrap"    — strands circle the plant: wraps = height/spacing,
 *              each wrap ≈ ellipse circumference of (width, depth)
 *  "surface" — light lines laid across the visible surface:
 *              area ≈ front face (w×h) + half the top (w×d/2), length = area/spacing
 *  "branch"  — woven through the plant, denser: surface × 1.35
 * Missing depth defaults to 0.8 × width (typical trimmed shrub).
 */
function bushLightFootage({ widthFt, heightFt, depthFt, pattern = "wrap", spacingKey = "standard" }, rules) {
  const w = Math.max(0.5, widthFt || 3);
  const h = Math.max(0.5, heightFt || 3);
  const d = Math.max(0.5, depthFt || w * 0.8);
  const sFt = spacingInches(spacingKey, rules) / 12;
  const taper = rules?.wrapSpacing?.taperFactor ?? 0.8;
  let footage;
  if (pattern === "wrap") {
    // wraps = height ÷ spacing; each wrap ≈ ellipse circumference π×avg(w,d)
    const wraps = Math.max(1, h / sFt);
    footage = wraps * (Math.PI * ((w + d) / 2)) * taper;
  } else {
    const surfaceArea = w * h + (w * d) / 2;
    footage = surfaceArea / sFt;
    if (pattern === "branch") footage *= 1.35;
  }
  return round1g(footage);
}

/**
 * Tree footage from trunk/branch dimensions — NEVER just tree height.
 * style:
 *  "trunk"        — wraps = trunkHeight/spacing, each wrap = trunk circumference
 *  "branch"       — per branch: branchCircum × (branchLen/spacing)
 *  "trunk_branch" — both
 *  "canopy"/"net" — surface: π×(canopyW/2)² / spacing (projected canopy area)
 * Missing values fall back to proportions of tree height so a bare estimate
 * still prices sanely — flagged low confidence by the caller.
 */
function treeLightFootage(tree, rules) {
  const heightFt = Math.max(2, tree.heightFt || 10);
  const style = tree.style || "trunk";
  const sFt = spacingInches(tree.spacingKey || "standard", rules) / 12;
  const trunkH = tree.trunkHeightFt || heightFt * 0.45;
  const trunkC = tree.trunkCircumFt || Math.max(1, heightFt / 8);
  const branchN = tree.branchCount ?? Math.round(3 + heightFt / 6);
  const branchL = tree.branchLenFt || heightFt * 0.3;
  const branchC = tree.branchCircumFt || Math.max(0.5, trunkC * 0.35);

  let footage = 0;
  if (style === "trunk" || style === "trunk_branch" || style === "spiral") {
    const wraps = Math.max(1, trunkH / sFt);
    footage += wraps * trunkC;
  }
  if (style === "branch" || style === "trunk_branch") {
    const perBranchWraps = Math.max(1, branchL / sFt);
    footage += branchN * perBranchWraps * branchC;
  }
  if (style === "canopy" || style === "net") {
    const canopyW = tree.canopyWidthFt || heightFt * 0.6;
    footage += (Math.PI * Math.pow(canopyW / 2, 2)) / sFt;
  }
  if (footage === 0) { // unknown style — treat as trunk wrap
    footage = Math.max(1, trunkH / sFt) * trunkC;
  }
  const taper = rules?.wrapSpacing?.taperFactor ?? 0.8;
  return round1g(footage * taper);
}

/* footage → whole strands, capped for bushes by size class (Rule 11),
 * ALWAYS rounded up — never partial strands (Rule 16). */
function strandsFromFootage(lengthFt, sizeClass, rules) {
  let strands = Math.ceil(lengthFt / (rules?.strandCoverageFt || 14));
  if (sizeClass) {
    const caps = rules?.bushStrandCaps || {};
    const cap = caps[sizeClass];
    if (cap) strands = Math.min(strands, cap);
  }
  return Math.max(1, strands);
}

/* Full bush breakdown for display + pricing */
function bushStrandBreakdown(plant, rules) {
  const footage = bushLightFootage(plant, rules);
  const strands = strandsFromFootage(footage, plant.sizeClass, rules);
  return {
    footage, strands,
    spacingIn: spacingInches(plant.spacingKey || "standard", rules),
    pattern: plant.pattern || "wrap",
  };
}

/* Full tree breakdown for display + pricing (trees are NOT capped by bush
 * size classes; big trees legitimately need many strands) */
function treeStrandBreakdown(tree, rules) {
  const footage = treeLightFootage(tree, rules);
  const strands = Math.max(1, Math.ceil(footage / (rules?.strandCoverageFt || 14)));
  return {
    footage, strands,
    spacingIn: spacingInches(tree.spacingKey || "standard", rules),
    style: tree.style || "trunk",
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    complexityFromPitch, itemKeyForZone, ROOF_COMPLEXITY, ROOFLINE_ZONE_KINDS,
    satelliteFtPerNorm, satDistFt, computeSatFootprint, calibrationFactorFrom,
    spacingInches, bushLightFootage, treeLightFootage, strandsFromFootage,
    bushStrandBreakdown, treeStrandBreakdown, SPACING_KEYS,
    pitchFactor, assumedPitch, applyPitchToPlanLength, SLOPED_ZONE_KINDS,
    footprintEdges, frontEdgeOf, rooflineFromEdge,
  };
}
