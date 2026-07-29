/* =========================================================================
 * 01-core-config.js — Pricing config: defaults, storage, ADDITIVE migration.
 * Rule 17: pricing lives in config, never in code. Every rate below is a
 * SEED — the office edits them in the Pricing Guide screen and their edits
 * are never overwritten by app updates (additive migration only).
 * Seeded from "2026 Christmas Lights Price Guide.xlsx" + client-verified doc.
 * ========================================================================= */
"use strict";

const CONFIG_VERSION = 1;
const CONFIG_KEY = "clp_pricing_config_v1";

/* Units the business actually sells in (Rule 16):
 * lf = linear foot · strand = whole strand (always round UP) · each = per unit */
const DEFAULT_PRICING = {
  version: CONFIG_VERSION,
  rules: {
    jobMinimum: 750,          // auto-applied
    depositPct: 50,
    boomLiftFee: 400,         // when flagged
    travelFee: 0,
    taxRatePct: 0,
    strandCoverageFt: 14,     // ONE strand covers ~14 ft (not 10 — Rule 11)
    garlandStrandFt: 9,       // garland sold as 9 ft strands, round UP
    pillarStrandsPerWrap: 2,  // 2 strands × $50 = $100 per wrapped pillar
    otherColorUpchargePct: 15,   // "Other Color Combination" upcharge
    bushStrandCaps: { small: 2, medium: 3, large: 5, xl: 6 }, // Rule 11 caps
    wrapSpacing: {            // crew's real install spacing, inches (Rule 11)
      swirlSmallTree: 6, swirlLargeTreeMax: 24, branch: 6, bushFillRows: 3,
      taperFactor: 0.8,
    },
    /* Peak calculator table — company rule of thumb for gable height from
     * base width. Editable in the Pricing Guide. maxBase:null = "larger". */
    peakHeightTable: [
      { maxBase: 8,    height: 2 },
      { maxBase: 15,   height: 5 },
      { maxBase: 25,   height: 7 },
      { maxBase: 35,   height: 10 },
      { maxBase: 45,   height: 13 },
      { maxBase: null, height: 17 },
    ],
  },
  /* Every line item reads its rate from here at calculation time.
   * rate:null means "office must set a price" — the engine REFUSES to
   * finalize and says so plainly, never silently guesses. */
  items: {
    roofline_easy:  { label: "Easy Roofline",        unit: "lf",     rate: 10.0,  cost: null, note: "Flat roof or very small pitch" },
    roofline_mid:   { label: "In-Between Roofline",  unit: "lf",     rate: 11.5,  cost: null, note: "Moderate pitch" },
    roofline_hard:  { label: "Hard Roofline",        unit: "lf",     rate: 14.0,  cost: null, note: "Steep peaks — 7/12 slope or greater" },
    roofline_side:  { label: "Side Roofline",        unit: "lf",     rate: 10.0,  cost: null, note: "Side/secondary rooflines" },
    ridge:          { label: "Ridge Lights",         unit: "lf",     rate: 17.0,  cost: null, note: "2-story homes or bigger" },
    icicle:         { label: "Icicle Lights",        unit: "lf",     rate: 6.0,   cost: null, note: "" },
    c7_window:      { label: "C7 Window Wrap",       unit: "lf",     rate: 4.5,   cost: null, note: "$4–$5 depending on window" },
    bush_strand:    { label: "Bush Wrap",            unit: "strand", rate: 40.0,  cost: 13,   note: "1 strand ≈ 14 ft; capped by bush size" },
    tree_strand:    { label: "Tree Wrap",            unit: "strand", rate: 40.0,  cost: 13,   note: "Tree Wrap or Branch Style — same rate" },
    pillar_strand:  { label: "Pillar / Column Wrap", unit: "strand", rate: 50.0,  cost: 13,   note: "2 strands per wrap = $100/pillar" },
    ground_stake:   { label: "Ground Stake Lights",  unit: "lf",     rate: 5.0,   cost: null, note: "Walkways, garden beds, driveways" },
    garland_strand: { label: "Garland (9 ft strand)",unit: "strand", rate: 90.0,  cost: 68,   note: "Billed in WHOLE 9 ft strands, never per foot" },
    wreath_36:      { label: 'Wreath 36" (lit)',     unit: "each",   rate: 100.0, cost: null, note: "" },
    wreath_48:      { label: 'Wreath 48" (lit)',     unit: "each",   rate: 190.0, cost: null, note: "Commercial wreath" },
    wreath_60:      { label: 'Wreath 60" (lit)',     unit: "each",   rate: 310.0, cost: null, note: "Large statement wreath" },
    wreath_unlit:   { label: "Wreath (no lights)",   unit: "each",   rate: 80.0,  cost: null, note: "" },
    spritzer:       { label: "Spritzer",             unit: "each",   rate: 80.0,  cost: 30,   note: "From 2026 price guide" },
    bow_red_lg:     { label: 'Red Bow 18"',          unit: "each",   rate: 60.0,  cost: 20,   note: "Large — for big wreaths" },
    bow_red_md:     { label: 'Red Bow 12"',          unit: "each",   rate: 40.0,  cost: 20,   note: "Medium accent bow" },
    bow_striped:    { label: "Striped Bow",          unit: "each",   rate: null,  cost: null, note: "SET PRICE in Pricing Guide before quoting" },
    teardrop:       { label: "Teardrop",             unit: "each",   rate: null,  cost: null, note: "SET PRICE in Pricing Guide before quoting" },
    deer_baby:      { label: "Baby Deer",            unit: "each",   rate: 400.0, cost: null, note: "Seeded from Reindeer flat rate" },
    deer_buck:      { label: "Buck Deer",            unit: "each",   rate: 400.0, cost: null, note: "Seeded from Reindeer flat rate" },
    deer_doe:       { label: "Doe Deer",             unit: "each",   rate: 400.0, cost: null, note: "Seeded from Reindeer flat rate" },
    santa_set:      { label: "Santa + Elf + Reindeer set", unit: "each", rate: 2000.0, cost: null, note: "Full set, flat rate" },
  },
};

/* ---- storage with additive migration (Rule 17) ---- */
function loadPricingConfig() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(CONFIG_KEY)); } catch { /* corrupted → reseed */ }
  if (!stored) {
    const fresh = structuredClone(DEFAULT_PRICING);
    savePricingConfig(fresh);
    return fresh;
  }
  return migratePricingConfig(stored);
}

/* Merge new defaults in WITHOUT overwriting rates the office edited. */
function migratePricingConfig(stored) {
  let changed = false;
  stored.rules = stored.rules || {};
  for (const [k, v] of Object.entries(DEFAULT_PRICING.rules)) {
    if (!(k in stored.rules)) { stored.rules[k] = structuredClone(v); changed = true; }
  }
  stored.items = stored.items || {};
  for (const [k, v] of Object.entries(DEFAULT_PRICING.items)) {
    if (!(k in stored.items)) { stored.items[k] = structuredClone(v); changed = true; }
    else {
      // additive on fields too (e.g., a future "cost" field) — never touch rate
      for (const [f, fv] of Object.entries(v)) {
        if (!(f in stored.items[k])) { stored.items[k][f] = structuredClone(fv); changed = true; }
      }
    }
  }
  if (stored.version !== CONFIG_VERSION) { stored.version = CONFIG_VERSION; changed = true; }
  if (changed) savePricingConfig(stored);
  return stored;
}

function savePricingConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("pricing-config-changed"));
}

function exportPricingConfig() {
  const cfg = loadPricingConfig();
  const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pricing-config-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importPricingConfig(file, cb) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const cfg = JSON.parse(r.result);
      if (!cfg.items || !cfg.rules) throw new Error("Not a pricing config file");
      savePricingConfig(migratePricingConfig(cfg));
      cb(null);
    } catch (e) { cb(e); }
  };
  r.readAsText(file);
}

/* Customer light colors — client-verified list */
const LIGHT_COLORS = [
  { id: "red_green",  label: "Red & Green",        desc: "Traditional Christmas colors" },
  { id: "red_white",  label: "Red & Cool White",   desc: "Red with crisp white" },
  { id: "warm_white", label: "Warm White",         desc: "Soft, classic" },
  { id: "multi",      label: "Multicolor",         desc: "Variety of festive colors" },
  { id: "custom",     label: "Other Color Combination (Upcharge)", desc: "Build a custom sequence" },
];

const SEQUENCE_SWATCHES = [
  { id: "cool_white", label: "Cool White", hex: "#eaf6ff" },
  { id: "warm_white", label: "Warm White", hex: "#ffd98a" },
  { id: "red",        label: "Red",        hex: "#ff2a2a" },
  { id: "green",      label: "Green",      hex: "#19c93c" },
  { id: "blue",       label: "Blue",       hex: "#2a6bff" },
  { id: "gold",       label: "Gold",       hex: "#f5b942" },
  { id: "purple",     label: "Purple",     hex: "#a03df0" },
  { id: "pink",       label: "Pink",       hex: "#ff5fb0" },
];

/* Light options — marker color = light product */
const LIGHT_TYPES = [
  { id: "c9",     label: "C9 Roofline",   marker: "#e53935", desc: 'Large 3" bulbs, ~12" spacing' },
  { id: "c7",     label: "C7 / Windows",  marker: "#1e88e5", desc: '2.5" bulbs, ~10–12" spacing' },
  { id: "mini",   label: "Mini Lights",   marker: "#43a047", desc: "Dense sparkling strands" },
  { id: "multi",  label: "Multi-Color",   marker: "#8e24aa", desc: "Multicolor strands" },
  { id: "icicle", label: "Icicle",        marker: "#ec407a", desc: "Hanging icicle strands" },
];

/* Add-on catalog. "pillar_wrap" is a light DESIGN, not an object — it wraps
 * whatever already exists at that spot; never adds an artificial pillar. */
const ADDONS = [
  { id: "wreath_lit",   label: "Wreath with lights",    priceItem: "wreath_36", glyph: "◎" },
  { id: "wreath_unlit", label: "Wreath without lights", priceItem: "wreath_unlit", glyph: "○" },
  { id: "pillar_wrap",  label: "Pillars (wrap lights)", priceItem: "pillar_strand", glyph: "≋", isWrapDesign: true },
  { id: "bow_red",      label: "Red Bow",               priceItem: "bow_red_lg", glyph: "🎀" },
  { id: "bow_striped",  label: "Striped Bow",           priceItem: "bow_striped", glyph: "🎀" },
  { id: "garland",      label: "Garland",               priceItem: "garland_strand", glyph: "〰" },
  { id: "teardrop",     label: "Teardrop",              priceItem: "teardrop", glyph: "💧" },
  { id: "deer_baby_l",  label: "Baby Deer (left)",      priceItem: "deer_baby", glyph: "🦌" },
  { id: "deer_baby_r",  label: "Baby Deer (right)",     priceItem: "deer_baby", glyph: "🦌" },
  { id: "deer_buck_l",  label: "Buck Deer (left)",      priceItem: "deer_buck", glyph: "🦌" },
  { id: "deer_buck_r",  label: "Buck Deer (right)",     priceItem: "deer_buck", glyph: "🦌" },
  { id: "deer_doe_l",   label: "Doe Deer (left)",       priceItem: "deer_doe", glyph: "🦌" },
  { id: "deer_doe_r",   label: "Doe Deer (right)",      priceItem: "deer_doe", glyph: "🦌" },
];

/* Plausibility ranges (Rule 12) — checked client-side after analysis too */
const PLAUSIBLE_RANGES = {
  roofline_single_story: [30, 90],
  roofline_two_story: [60, 160],
  per_window: [12, 20],
  walkway: [10, 45],
};

/* Node test support */
if (typeof module !== "undefined") {
  module.exports = { DEFAULT_PRICING, migratePricingConfig, CONFIG_VERSION };
}
