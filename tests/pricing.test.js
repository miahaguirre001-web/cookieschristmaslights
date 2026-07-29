/* Pricing engine tests — run: node tests/pricing.test.js */
"use strict";
const { DEFAULT_PRICING } = require("../js/01-core-config.js");
const { computeQuote, strandsForPlant, strandsFromFootage } = require("../js/08-pricing.js");

let passed = 0, failed = 0;
function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log("  ✓", name); }
  else { failed++; console.error("  ✗", name, "— expected", expected, "got", actual); }
}
function approx(name, actual, expected, tol = 0.01) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) { passed++; console.log("  ✓", name); }
  else { failed++; console.error("  ✗", name, "— expected ≈", expected, "got", actual); }
}

const cfg = structuredClone(DEFAULT_PRICING);
const opts = { colorScheme: "red_green", boomLift: false };

console.log("Roofline linear-foot pricing");
{
  const q = computeQuote([{ zoneLabel: "front eave", itemKey: "roofline_easy", value: 100, source: "User Entered", confidence: 1 }], [], opts, cfg);
  approx("100 lf easy roofline @ $10 = $1000", q.total, 1000);
  eq("no minimum applied above $750", q.minimumApplied, false);
  approx("deposit 50%", q.deposit, 500);
}

console.log("Job minimum auto-applied");
{
  const q = computeQuote([{ zoneLabel: "walk", itemKey: "ground_stake", value: 20, source: "User Entered", confidence: 1 }], [], opts, cfg);
  eq("minimum applied", q.minimumApplied, true);
  approx("$100 of stakes → $750 minimum", q.total, 750);
}

console.log("Garland rounds UP to whole 9 ft strands (Rule 16)");
{
  // 20 ft → 3 strands → $270 (the doc's own example)
  const strands = Math.ceil(20 / cfg.rules.garlandStrandFt);
  eq("20 ft → 3 strands", strands, 3);
  const q = computeQuote([{ zoneLabel: "garland run", itemKey: "garland_strand", value: 20, source: "User Entered", confidence: 1 }], [], opts, cfg);
  const li = q.lineItems[0];
  eq("garland 20 ft → 3 strands (9 ft each)", li.qty, 3);
  approx("3 × $90 = $270 line total", li.total, 270);
}

console.log("Strand math (Rule 11)");
{
  // 14 ft coverage — not 10 (the 30% overcharge bug)
  eq("strandsFromFootage 14 ft = 1 strand", strandsFromFootage(14, null, cfg.rules), 1);
  eq("strandsFromFootage 15 ft = 2 strands", strandsFromFootage(15, null, cfg.rules), 2);
  eq("small bush cap = 2", strandsFromFootage(100, "small", cfg.rules), 2);
  eq("xl bush cap = 6", strandsFromFootage(100, "xl", cfg.rules), 6);
  // plant formula: 4ft tall, 3ft wide small tree, 6" swirl
  const s = strandsForPlant({ heightFt: 4, widthFt: 3, sizeClass: "medium", spacingIn: 6 }, cfg.rules);
  eq("4ft plant lands within medium cap", s <= 3 && s >= 1, true);
}

console.log("Pillar wraps: 2 strands × $50 = $100 each");
{
  const marks = [
    { kind: "addon", addonId: "pillar_wrap", included: true },
    { kind: "addon", addonId: "pillar_wrap", included: true },
    { kind: "addon", addonId: "pillar_wrap", included: true },
  ];
  const q = computeQuote([], marks, opts, cfg);
  const li = q.lineItems.find((l) => l.key === "pillar_strand");
  eq("3 pillars = 6 strands", li.qty, 6);
  approx("6 × $50 = $300 → bumped to $750 min", q.total, 750);
}

console.log("Blank prices REFUSE to finalize (never silently guess)");
{
  const marks = [{ kind: "addon", addonId: "teardrop", included: true }];
  const q = computeQuote([], marks, opts, cfg);
  eq("finalizable = false", q.finalizable, false);
  eq("error mentions Pricing Guide", q.errors.some((e) => e.includes("Pricing Guide")), true);
}

console.log("Custom color upcharge");
{
  const q = computeQuote([{ zoneLabel: "eave", itemKey: "roofline_easy", value: 100, source: "User Entered", confidence: 1 }],
    [], { colorScheme: "custom", boomLift: false }, cfg);
  approx("$1000 + 15% = $1150", q.total, 1150);
}

console.log("Boom lift fee");
{
  const q = computeQuote([{ zoneLabel: "eave", itemKey: "roofline_hard", value: 100, source: "User Entered", confidence: 1 }],
    [], { colorScheme: "red_green", boomLift: true }, cfg);
  approx("$1400 + $400 = $1800", q.total, 1800);
}

console.log("Confidence from sources");
{
  const q = computeQuote([
    { zoneLabel: "a", itemKey: "roofline_easy", value: 50, source: "Verified Onsite", confidence: 0.5 },
    { zoneLabel: "b", itemKey: "roofline_easy", value: 50, source: "AI Estimated", confidence: 0.6 },
  ], [], opts, cfg);
  approx("avg of 1.0 and 0.6", q.confidence, 0.8);
}

console.log("Charge ONLY marked zones — excluded addon not billed");
{
  const marks = [{ kind: "addon", addonId: "wreath_lit", included: false }];
  const q = computeQuote([], marks, opts, cfg);
  eq("no line items for excluded addon", q.lineItems.length, 0);
}

console.log("Additive migration never overwrites office edits");
{
  const { migratePricingConfig } = require("../js/01-core-config.js");
  const stored = structuredClone(DEFAULT_PRICING);
  stored.items.roofline_easy.rate = 12.5;      // office edit
  delete stored.items.spritzer;                 // simulate older config
  delete stored.rules.otherColorUpchargePct;
  // migration needs localStorage shim in node
  global.localStorage = { setItem() {}, getItem() { return null; } };
  const out = migratePricingConfig(stored);
  approx("office-edited rate preserved", out.items.roofline_easy.rate, 12.5);
  eq("missing item re-added", !!out.items.spritzer, true);
  eq("missing rule re-added", out.rules.otherColorUpchargePct != null, true);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
