/* =========================================================================
 * 06-analysis.js — "Analyze Marked Areas": photo + markup → measurements
 * + install notes. Rule 12: real-world anchors + double sanity check.
 * Rule 15: running analysis IS the sign-off (unlocks mock-up + pricing).
 * Rule 5: analysis output later feeds the mock-up as one of three
 * redundant, non-conflicting views.
 * ========================================================================= */
"use strict";

const MEASUREMENT_ANCHORS = `Real-world anchors you MUST cross-check every length against (pick at least TWO per measurement):
- Front door height ≈ 6.8 ft
- Single garage door width ≈ 9 ft; double garage ≈ 16 ft
- Horizontal siding course: 4–8 inches per board
- Brick course: ≈ 2.7 inches
- One building story ≈ 9–10 ft

Typical plausible ranges — if your value falls outside, treat it as a SCALING ERROR and re-derive from anchors rather than reporting it:
- Single-story front roofline: 30–90 linear ft
- Two-story front roofline: 60–160 linear ft
- Ridge length ≤ front roofline length
- Window perimeter: 12–20 linear ft each
- Walkway: 10–45 linear ft`;

function buildAnalysisPrompt() {
  const marks = project.marks.filter((m) => m.included !== false);
  const geometry = marks.map((m) => describeMarkGeometry(m)).join("\n");
  return `You are estimating a Christmas-light installation from ONE street-level photo with the estimator's markup drawn on it.

MARKED DESIGN (marker colors: red=C9 roofline, blue=C7/windows, green=mini lights, purple=multi-color, pink=icicle; dashed rectangles=bush/shrub fill areas; yellow boxes=add-on decorations):
${geometry}

Zone labels above are DESCRIPTIVE LABELS ONLY — NOT placement instructions. The marks themselves are the complete and only definition of what gets lit.

${MEASUREMENT_ANCHORS}

Property type: ${project.propertyType}. ${project.aiNote ? "Estimator note: " + project.aiNote : ""}

Return ONLY compact JSON, no prose:
{
 "measurements": [
   {"markId":"mark_01","zoneLabel":"front eave","itemKey":"roofline_easy|roofline_mid|roofline_hard|roofline_side|ridge|icicle|c7_window|ground_stake|bush_strand|tree_strand|pillar_strand|garland_strand","lengthFt":46.0,"confidence":0.82,"basis":"≈5.1 door-heights wide; cross-checked against garage door"}
 ],
 "roofComplexity": "easy|mid|hard",
 "stories": 1,
 "installNotes": ["C9 bulbs along full front eave, ~46 ft"],
 "warnings": ["anything the estimator should verify"],
 "overallConfidence": 0.8
}
For bush/shrub AREA marks: report estimated plant height and width in ft in "basis", classify sizeClass small|medium|large|xl, and set lengthFt to estimated wrap footage. Add "sizeClass" field on those rows. Keep every note under 15 words. Be terse.`;
}

/* Concrete physical descriptions so the image model renders a real
 * decoration rather than a generic shape. */
const ADDON_RENDER_HINTS = {
  wreath_lit: "a round evergreen Christmas wreath hung flat against the surface, lit with warm white bulbs around the ring and a red velvet bow at the bottom",
  wreath_unlit: "a round evergreen Christmas wreath hung flat against the surface with a red bow, NO lights on it",
  bow_red: "a large red velvet ribbon bow with two loops and two tails",
  bow_striped: "a striped ribbon bow with two loops and two tails",
  garland: "a thick evergreen garland swag draped in a natural curve, wound with warm white bulbs",
  teardrop: "a hanging evergreen teardrop/swag spray pointing downward, lit with warm white bulbs",
  deer_baby_l: "a small lit wire-frame fawn lawn figure facing left, outlined in warm white bulbs",
  deer_baby_r: "a small lit wire-frame fawn lawn figure facing right, outlined in warm white bulbs",
  deer_buck_l: "a lit wire-frame buck lawn figure with antlers facing left, outlined in warm white bulbs",
  deer_buck_r: "a lit wire-frame buck lawn figure with antlers facing right, outlined in warm white bulbs",
  deer_doe_l: "a lit wire-frame doe lawn figure (no antlers) facing left, outlined in warm white bulbs",
  deer_doe_r: "a lit wire-frame doe lawn figure (no antlers) facing right, outlined in warm white bulbs",
};

function describeMarkGeometry(m) {
  const pct = (v) => (v * 100).toFixed(0) + "%";
  if (m.kind === "line" || m.kind === "curve") {
    const t = LIGHT_TYPES.find((x) => x.id === m.lightType)?.label || m.lightType;
    return `[${m.id}] ${t} ${m.kind === "curve" ? "draped" : "straight"} run from (${pct(m.a.x)}, ${pct(m.a.y)}) to (${pct(m.b.x)}, ${pct(m.b.y)}) — label: ${m.zoneLabel}`;
  }
  if (m.kind === "area") {
    const r = m.rect;
    return `[${m.id}] ${m.areaKind} fill area at (${pct(r.x)}, ${pct(r.y)}) size ${pct(r.w)}×${pct(r.h)} — light the real plants inside this region only — label: ${m.zoneLabel}`;
  }
  const a = ADDONS.find((x) => x.id === m.addonId);
  const r = m.rect;
  const desc = ADDON_RENDER_HINTS[m.addonId] || "";
  return `[${m.id}] add-on "${a?.label || m.addonId}" placed at (${pct(r.x + r.w / 2)}, ${pct(r.y + r.h / 2)}), approx ${pct(r.w)} wide × ${pct(r.h)} tall${desc ? " — " + desc : ""}${a?.isWrapDesign ? " — wrap lights around the EXISTING structure here; never add a new pillar/object" : ""}`;
}

function initAnalysis() {
  const btn = document.getElementById("btn-analyze");
  const status = document.getElementById("analysis-status");

  btn.addEventListener("click", () => withBusy(btn, async () => {
    if (!project.photo) { setStatus(status, "Import or upload a photo first.", "warn"); return; }
    const included = project.marks.filter((m) => m.included !== false);
    if (!included.length) { setStatus(status, "Draw at least one mark first.", "warn"); return; }

    setStatus(status, "Analyzing marked areas…");
    const onStatus = (msg) => { btn.textContent = msg; };

    // Send the ORIGINAL photo (full frame, no crop — Rule 10) + markup preview
    const markupImage = renderHumanMarkupSnapshot();
    const text = await callClaude({
      system: "You are a precise construction estimator. Respond with valid JSON only.",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Image 1: original property photo. Image 2: same photo with estimator markup." },
          imageBlock(project.photo),
          imageBlock(markupImage),
          { type: "text", text: buildAnalysisPrompt() },
        ],
      }],
      maxTokens: 3000,
    }, onStatus);

    const parsed = validateShape(extractJSON(text), {
      measurements: "array", installNotes: "array", warnings: "array",
      stories: "number", overallConfidence: "number",
    }, "Analysis");

    // Never mutate project data until validation passes — done. Now commit:
    applyAnalysis(parsed);
    setStatus(status, "Analysis complete — review measurements below.", "ok");
    document.getElementById("measure-section").scrollIntoView({ behavior: "smooth" });
  }));
}

/* Snapshot of the human markup canvas for ANALYSIS only. JPEG here is
 * deliberate and does NOT violate Rule 13: this image is read for geometry,
 * it never enters the mock-up image-editing chain (that pipeline in
 * 10-mockup.js stays strictly PNG). JPEG keeps the request under Netlify's
 * 6 MB function body limit for large uploaded photos. */
function renderHumanMarkupSnapshot() {
  redraw();
  return Canvas.el.toDataURL("image/jpeg", 0.9);
}

function applyAnalysis(parsed) {
  const rows = [];
  for (const m of parsed.measurements || []) {
    if (!m.markId || typeof m.lengthFt !== "number") continue;
    const mark = project.marks.find((x) => x.id === m.markId);
    if (mark && m.sizeClass) mark.sizeClass = m.sizeClass;
    rows.push({
      id: "meas_" + m.markId,
      markId: m.markId,
      zoneLabel: m.zoneLabel || mark?.zoneLabel || "run",
      itemKey: m.itemKey || defaultItemKey(mark),
      value: round1(m.lengthFt),
      rawAiValue: round1(m.lengthFt),
      unit: "lf",
      source: "AI Estimated",
      confidence: m.confidence ?? 0.5,
      basis: m.basis || "",
      sizeClass: m.sizeClass || mark?.sizeClass || null,
    });
  }
  project.analysis = {
    roofComplexity: parsed.roofComplexity || "mid",
    stories: parsed.stories || 1,
    installNotes: parsed.installNotes || [],
    warnings: parsed.warnings || [],
    overallConfidence: parsed.overallConfidence ?? 0.5,
    at: Date.now(),
  };
  project.measurements = rows;
  project.analyzedRevision = project.markRevision;   // Rule 15: sign-off
  project.quotedConfigStamp = configStamp();
  // client-side plausibility re-check (Rule 12 — enforced twice)
  project.analysis.clientWarnings = plausibilityCheck(rows);
  scheduleSave();
  window.dispatchEvent(new CustomEvent("analysis-complete"));
}

function defaultItemKey(mark) {
  if (!mark) return "roofline_mid";
  if (mark.kind === "area") return mark.areaKind === "bush" ? "bush_strand" : "bush_strand";
  if (mark.lightType === "icicle") return "icicle";
  if (mark.lightType === "c7") return "c7_window";
  if (mark.zoneLabel === "ground run") return "ground_stake";
  return "roofline_mid";
}

/* Rule 12, second enforcement: plain warnings BEFORE numbers reach pricing */
function plausibilityCheck(rows) {
  const warnings = [];
  const stories = project.analysis?.stories || 1;
  const roofKeys = ["roofline_easy", "roofline_mid", "roofline_hard", "roofline_side"];
  const roofTotal = rows.filter((r) => roofKeys.includes(r.itemKey)).reduce((s, r) => s + r.value, 0);
  const range = stories >= 2 ? PLAUSIBLE_RANGES.roofline_two_story : PLAUSIBLE_RANGES.roofline_single_story;
  if (roofTotal && (roofTotal < range[0] || roofTotal > range[1]))
    warnings.push(`Total roofline ${roofTotal.toFixed(0)} lf is outside the typical ${range[0]}–${range[1]} lf for a ${stories}-story home — verify or calibrate.`);
  const ridge = rows.filter((r) => r.itemKey === "ridge").reduce((s, r) => s + r.value, 0);
  if (ridge && roofTotal && ridge > roofTotal)
    warnings.push(`Ridge (${ridge.toFixed(0)} lf) longer than front roofline (${roofTotal.toFixed(0)} lf) — likely a scaling error.`);
  for (const r of rows) {
    if (r.itemKey === "c7_window" && (r.value < PLAUSIBLE_RANGES.per_window[0] || r.value > PLAUSIBLE_RANGES.per_window[1]))
      warnings.push(`${r.zoneLabel}: ${r.value} lf is unusual for one window (typical 12–20 lf).`);
    if (r.itemKey === "ground_stake" && (r.value < PLAUSIBLE_RANGES.walkway[0] || r.value > PLAUSIBLE_RANGES.walkway[1]))
      warnings.push(`${r.zoneLabel}: ${r.value} lf is outside the typical 10–45 lf walkway range.`);
  }
  return warnings;
}

const round1 = (v) => Math.round(v * 10) / 10;
