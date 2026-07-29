/* =========================================================================
 * 08-pricing.js — Pricing engine. PURE function: (measurements, marks,
 * options, config) → quote. Charge ONLY marked zones. Every rate read from
 * config at calculation time (Rule 17). Bill in the units the business
 * actually sells (Rule 16): lf for rooflines, STRANDS for wraps/garland
 * (always round up), each for décor. Rule 11 strand math + caps.
 * Runs in node for tests (no DOM access inside computeQuote).
 * ========================================================================= */
"use strict";

/* Strand math per Rule 11:
 * wraps = wrapped height ÷ spacing; length = wraps × circumference × 0.8 taper;
 * strands = length ÷ strandCoverageFt (14), round UP; capped by size class. */
function strandsForPlant({ heightFt = 3, widthFt = 3, sizeClass = "medium", spacingIn = 6 }, rules) {
  const spacingFt = spacingIn / 12;
  const wraps = Math.max(1, heightFt / spacingFt);
  const circumference = Math.PI * widthFt;
  const lengthFt = wraps * circumference * (rules.wrapSpacing?.taperFactor ?? 0.8);
  let strands = Math.ceil(lengthFt / (rules.strandCoverageFt || 14));
  const caps = rules.bushStrandCaps || { small: 2, medium: 3, large: 5, xl: 6 };
  const cap = caps[sizeClass] ?? caps.medium;
  return Math.max(1, Math.min(strands, cap));
}

/* Simple wrap-footage → strands for rows the AI already estimated in lf */
function strandsFromFootage(lengthFt, sizeClass, rules) {
  let strands = Math.ceil(lengthFt / (rules.strandCoverageFt || 14));
  if (sizeClass) {
    const caps = rules.bushStrandCaps || {};
    const cap = caps[sizeClass];
    if (cap) strands = Math.min(strands, cap);
  }
  return Math.max(1, strands);
}

/**
 * computeQuote — the whole engine.
 * @param measurements [{zoneLabel,itemKey,value,unit,source,confidence,sizeClass,manualStrands?}]
 * @param marks        project.marks (for add-on counts & pillar wraps)
 * @param options      {colorScheme, customSequence, boomLift, roofComplexity, stories}
 * @param config       pricing config
 */
function computeQuote(measurements, marks, options, config) {
  const { items, rules } = config;
  const lineItems = [];
  const assumptions = [];
  const errors = [];

  const addLine = (key, qty, label, detail) => {
    const it = items[key];
    if (!it) { errors.push(`Unknown price item "${key}"`); return; }
    if (it.rate === null || it.rate === undefined) {
      errors.push(`"${it.label}" has no price — set it in the Pricing Guide before finalizing.`);
      lineItems.push({ key, label: label || it.label, qty, unit: it.unit, rate: null, total: null, detail });
      return;
    }
    lineItems.push({
      key, label: label || it.label, qty, unit: it.unit,
      rate: it.rate, total: Math.round(qty * it.rate * 100) / 100, detail,
    });
  };

  /* ---- measured zones (charge ONLY what was marked) ---- */
  for (const m of measurements) {
    if (!m.itemKey || !(m.value > 0)) continue;
    const it = items[m.itemKey];
    if (!it) { errors.push(`Unknown price item "${m.itemKey}"`); continue; }

    if (it.unit === "lf") {
      addLine(m.itemKey, m.value, `${it.label} — ${m.zoneLabel}`, `${m.value} lf`);
    } else if (it.unit === "strand") {
      // Convert measured footage → WHOLE strands, always up (Rule 16).
      // Garland sells as 9 ft strands; wraps as 14 ft coverage strands.
      const isGarland = m.itemKey === "garland_strand";
      const strandFt = isGarland ? (rules.garlandStrandFt || 9) : (rules.strandCoverageFt || 14);
      const strands = m.manualStrands ??
        (isGarland ? Math.max(1, Math.ceil(m.value / strandFt)) : strandsFromFootage(m.value, m.sizeClass, rules));
      assumptions.push(`${m.zoneLabel}: ${m.value} ft → ${strands} × ${strandFt} ft strand${strands > 1 ? "s" : ""}${m.sizeClass ? ` (${m.sizeClass}, capped)` : ""}`);
      addLine(m.itemKey, strands, `${it.label} — ${m.zoneLabel}`, `${strands} strand${strands > 1 ? "s" : ""}`);
    } else {
      addLine(m.itemKey, 1, `${it.label} — ${m.zoneLabel}`);
    }
  }

  /* ---- add-on stamps ---- */
  const addonCounts = {};
  for (const mk of marks || []) {
    if (mk.kind !== "addon" || mk.included === false) continue;
    addonCounts[mk.addonId] = (addonCounts[mk.addonId] || 0) + 1;
  }
  for (const [addonId, count] of Object.entries(addonCounts)) {
    const a = (typeof ADDONS !== "undefined" ? ADDONS : NODE_ADDONS).find((x) => x.id === addonId);
    if (!a) continue;
    if (a.isWrapDesign) {
      // Pillar wrap: strands per wrap × count (2 × $50 = $100/pillar)
      const per = rules.pillarStrandsPerWrap || 2;
      assumptions.push(`Pillar wraps: ${count} × ${per} strands each`);
      addLine(a.priceItem, count * per, `Pillar / Column Wrap × ${count}`, `${count * per} strands`);
    } else if (addonId === "garland") {
      // Garland stamps: each stamp = 1 × 9ft strand unless measured separately
      addLine("garland_strand", count, `Garland × ${count}`, `${count} × ${rules.garlandStrandFt || 9} ft strand`);
    } else {
      addLine(a.priceItem, count, `${a.label} × ${count}`);
    }
  }

  /* ---- subtotal + adjustments ---- */
  let subtotal = lineItems.reduce((s, li) => s + (li.total || 0), 0);
  const adjustments = [];

  if (options.colorScheme === "custom") {
    const pct = rules.otherColorUpchargePct || 0;
    if (pct > 0) {
      const amt = Math.round(subtotal * (pct / 100) * 100) / 100;
      adjustments.push({ label: `Other Color Combination upcharge (${pct}%)`, amount: amt });
      subtotal += amt;
    }
  }
  if (options.boomLift) {
    adjustments.push({ label: "Boom lift", amount: rules.boomLiftFee || 400 });
    subtotal += rules.boomLiftFee || 400;
  }
  if (rules.travelFee > 0) {
    adjustments.push({ label: "Travel fee", amount: rules.travelFee });
    subtotal += rules.travelFee;
  }

  /* ---- job minimum (auto-applied) ---- */
  let minimumApplied = false;
  let total = subtotal;
  if (total > 0 && total < (rules.jobMinimum || 0)) {
    minimumApplied = true;
    adjustments.push({ label: `Job minimum ($${rules.jobMinimum})`, amount: Math.round((rules.jobMinimum - total) * 100) / 100 });
    total = rules.jobMinimum;
  }

  if (rules.taxRatePct > 0) {
    const tax = Math.round(total * (rules.taxRatePct / 100) * 100) / 100;
    adjustments.push({ label: `Tax (${rules.taxRatePct}%)`, amount: tax });
    total += tax;
  }
  total = Math.round(total * 100) / 100;

  const deposit = Math.round(total * ((rules.depositPct || 50) / 100) * 100) / 100;

  /* ---- confidence from measurement sources ---- */
  const confidences = measurements.filter((m) => m.value > 0).map((m) =>
    m.source === "Verified Onsite" ? 1 :
    m.source === "User Entered" ? 0.95 :
    m.source === "Drive-by" ? 0.85 :
    (m.confidence ?? 0.5));
  const confidence = confidences.length
    ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100
    : 0;

  return {
    lineItems, adjustments, subtotal: Math.round(subtotal * 100) / 100,
    total, deposit, minimumApplied, confidence, assumptions, errors,
    finalizable: errors.length === 0,
    createdAt: Date.now(),
  };
}

/* Minimal add-on catalog mirror for node tests (browser uses ADDONS) */
const NODE_ADDONS = [
  { id: "wreath_lit", priceItem: "wreath_36", label: "Wreath with lights" },
  { id: "wreath_unlit", priceItem: "wreath_unlit", label: "Wreath without lights" },
  { id: "pillar_wrap", priceItem: "pillar_strand", label: "Pillars (wrap lights)", isWrapDesign: true },
  { id: "bow_red", priceItem: "bow_red_lg", label: "Red Bow" },
  { id: "bow_striped", priceItem: "bow_striped", label: "Striped Bow" },
  { id: "garland", priceItem: "garland_strand", label: "Garland" },
  { id: "teardrop", priceItem: "teardrop", label: "Teardrop" },
  { id: "deer_buck_l", priceItem: "deer_buck", label: "Buck Deer (left)" },
];

if (typeof module !== "undefined") {
  module.exports = { computeQuote, strandsForPlant, strandsFromFootage };
}
