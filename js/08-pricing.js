/* =========================================================================
 * 08-pricing.js — Pricing engine. PURE function: (measurements, marks,
 * options, config) → quote. Charge ONLY marked zones. Every rate read from
 * config at calculation time (Rule 17). Bill in the units the business
 * actually sells (Rule 16): lf for rooflines, STRANDS for wraps/garland
 * (always round up), each for décor. Rule 11 strand math + caps.
 * Runs in node for tests (no DOM access inside computeQuote).
 * ========================================================================= */
"use strict";

/* Strand math lives in 06b-geometry.js (dimensional, spacing-driven).
 * In the browser those functions are globals; in node tests we require them. */
/* eslint-disable no-redeclare */
if (typeof module !== "undefined" && typeof bushStrandBreakdown === "undefined") {
  var { bushStrandBreakdown, treeStrandBreakdown, strandsFromFootage } = require("./06b-geometry.js");
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
    const materialCost = it.cost != null ? Math.round(qty * it.cost * 100) / 100 : null;
    if (it.rate === null || it.rate === undefined) {
      errors.push(`"${it.label}" has no price — set it in the Pricing Guide before finalizing.`);
      lineItems.push({ key, label: label || it.label, qty, unit: it.unit, rate: null, total: null, detail, materialCost });
      return;
    }
    lineItems.push({
      key, label: label || it.label, qty, unit: it.unit,
      rate: it.rate, total: Math.round(qty * it.rate * 100) / 100, detail, materialCost,
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
      // WHOLE strands, always rounded up (Rule 16). The selected spacing/gap
      // directly drives the count and is shown so the number is explainable.
      let strands, detail;
      if (m.manualStrands) {
        strands = m.manualStrands;
        detail = `${strands} strand${strands > 1 ? "s" : ""} (manual override)`;
        assumptions.push(`${m.zoneLabel}: strand count set manually (${strands})`);
      } else if (m.plant) {
        const bd = bushStrandBreakdown(m.plant, rules);
        strands = bd.strands;
        detail = `${strands} strand${strands > 1 ? "s" : ""} · ${bd.footage} ft light · ${bd.pattern} @ ${bd.spacingIn}" gap`;
        assumptions.push(`${m.zoneLabel}: ${m.plant.widthFt}×${m.plant.heightFt}×${m.plant.depthFt} ft ${bd.pattern} @ ${bd.spacingIn}" gap → ${bd.footage} ft → ${strands} strands (${m.plant.sizeClass || "medium"} cap)`);
      } else if (m.tree) {
        const td = treeStrandBreakdown(m.tree, rules);
        strands = td.strands;
        detail = `${strands} strand${strands > 1 ? "s" : ""} · ${td.footage} ft light · ${td.style} @ ${td.spacingIn}" gap`;
        assumptions.push(`${m.zoneLabel}: ${td.style} wrap @ ${td.spacingIn}" gap → ${td.footage} ft → ${strands} strands`);
      } else {
        // legacy/manual footage rows: garland at 9 ft strands, wraps at 14 ft
        const isGarland = m.itemKey === "garland_strand";
        const strandFt = isGarland ? (rules.garlandStrandFt || 9) : (rules.strandCoverageFt || 14);
        strands = isGarland ? Math.max(1, Math.ceil(m.value / strandFt)) : strandsFromFootage(m.value, m.sizeClass, rules);
        detail = `${strands} strand${strands > 1 ? "s" : ""}`;
        assumptions.push(`${m.zoneLabel}: ${m.value} ft → ${strands} × ${strandFt} ft strand${strands > 1 ? "s" : ""}${m.sizeClass ? ` (${m.sizeClass}, capped)` : ""}`);
      }
      addLine(m.itemKey, strands, `${it.label} — ${m.zoneLabel}`, detail);
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
  module.exports = { computeQuote };
}
