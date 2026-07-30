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

ROOF COMPLEXITY — classify the PROPERTY ONCE (not per zone). Judge the dominant roof pitch of the main house:
- "easy": flat roof or very shallow pitch (under ~4/12). Walkable, no steep faces.
- "mid": moderate pitch, roughly 4/12 to 6/12. The typical suburban roof.
- "hard": steep, 7/12 or greater; and/or complex cut-up roof with multiple valleys, dormers, or steep gables requiring extra rigging.
Also estimate "roofPitchPer12" and give a one-line "complexityReason" citing what you SEE.

DUAL-SOURCE MEASUREMENT — you may receive a SATELLITE image after the street photo. Use BOTH:
1. From the satellite, read the building's real footprint dimensions (the front facade width especially).
2. From the street photo, identify which visible roof sections the marks select.
3. Match each marked section to its satellite counterpart; derive lengths from the satellite scale where possible, anchors otherwise.
4. Measure ONLY marked sections. Never count a section twice, never include rear-facing or hidden roof, never add unmarked dormers/ridges/windows/plants.
5. Set "source" on each row: "satellite" (footprint-derived), "photo" (anchor-derived), or "both" (cross-checked).
6. If the two sources disagree by more than ~20% on a length, still report your best value but add a warning naming the zone.
Rake/gable slopes: measure the visible diagonal edge itself, correcting for foreshortening using the satellite footprint of that gable where available.

Return ONLY compact JSON, no prose:
{
 "houseFrontWidthFt": 52.0,
 "measurements": [
   {"markId":"mark_01","zoneKind":"eave|rake|ridge|side|dormer|garage|window|icicle|ground|bush|shrub|tree|pillar|garland","zoneLabel":"front left eave","lengthFt":46.0,"source":"both","confidence":0.82,"basis":"satellite front 52ft; photo anchors agree"},
   {"markId":"mark_05","zoneKind":"bush","zoneLabel":"bush left of front door","lengthFt":null,"source":"photo","confidence":0.6,"plant":{"widthFt":4,"heightFt":3,"depthFt":3,"shape":"rounded","density":"dense","sizeClass":"medium"}},
   {"markId":"mark_06","zoneKind":"tree","zoneLabel":"maple right of driveway","lengthFt":null,"source":"photo","confidence":0.55,"tree":{"heightFt":18,"trunkHeightFt":8,"trunkCircumFt":3.1,"branchCount":6,"branchLenFt":5,"branchCircumFt":1.2,"canopyWidthFt":14}}
 ],
 "roofComplexity": "easy|mid|hard",
 "roofPitchPer12": 8,
 "complexityReason": "steep front gable ≈8/12",
 "stories": 1,
 "installNotes": ["C9 bulbs along full front eave, ~46 ft"],
 "warnings": ["left rake: photo and satellite disagree 25%"],
 "overallConfidence": 0.8
}
"houseFrontWidthFt" = FULL width of the street-facing facade wall-to-wall including attached garage — derive it from the satellite footprint when provided.
zoneKind decides pricing: a garage eave must be "garage" (a roofline), never "window".
ZONE LABELS must describe LOCATION so a human can find them: "bush left of front door", "front left bush", "tree right of driveway" — NEVER "bush 1" or "tree 2".
For bush/shrub rows fill the "plant" object (measure against door/window anchors; depth from satellite if visible). For tree rows fill the "tree" object. Leave lengthFt null for plants/trees — strand math is computed from dimensions, not by you.
HONESTY: if the images don't show enough (occlusion, distance, shadows), set confidence below 0.5 and say why in "basis" — do not guess confidently.
SPEED IS CRITICAL: single-line compact JSON, no whitespace. "basis" max 8 words, warnings max 3 items.`;
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

/* Core analysis, callable from the button AND the Auto-Estimate pipeline. */
async function runAnalysis(onStatus = () => {}) {
  if (!project.photo) throw new Error("Import or upload a photo first.");
  const included = project.marks.filter((m) => m.included !== false);
  if (!included.length) throw new Error("No marks to analyze — draw or auto-detect first.");

  // Send the ORIGINAL photo (full frame, no crop — Rule 10) + markup preview
  // + the SATELLITE image when available (dual-source measurement).
  const markupImage = renderHumanMarkupSnapshot();
  const content = [
    { type: "text", text: "Image 1: original property photo. Image 2: same photo with estimator markup." + (project.satellite ? " Image 3: satellite/top-down view of the same property (use it for real dimensions)." : "") },
    imageBlock(project.photo),
    imageBlock(markupImage),
  ];
  if (project.satellite) content.push(imageBlock(project.satellite));
  content.push({ type: "text", text: buildAnalysisPrompt() });

  const text = await callClaude({
    system: "You are a precise construction estimator. Respond with valid JSON only.",
    messages: [{ role: "user", content }],
    maxTokens: 1500,   // latency throttle — see note in 02-api.js
  }, onStatus);

  const parsed = validateShape(extractJSON(text), {
    measurements: "array", installNotes: "array", warnings: "array",
    stories: "number", overallConfidence: "number",
  }, "Analysis");

  // Never mutate project data until validation passes — done. Now commit:
  applyAnalysis(parsed);

  // Satellite auto-calibration: deterministic scale from known ft/pixel.
  // Non-fatal — analysis stands on its own if this can't run.
  try {
    await autoCalibrateFromSatellite(onStatus);
  } catch (e) {
    console.warn("Satellite calibration skipped:", e.message);
  }
  scheduleSave();
  // Re-fire analysis-complete: the measurements table (and its satellite
  // banner) render on this event, and the satCheck result lands AFTER the
  // first dispatch inside applyAnalysis.
  window.dispatchEvent(new CustomEvent("analysis-complete"));
  window.dispatchEvent(new CustomEvent("measurements-changed"));
}

/* ---- Satellite auto-calibration ----
 * The satellite tile's ft/pixel is exact (see 06b-geometry.js). The AI only
 * has to TRACE the roof outline — all length math is ours. The traced front
 * width then rescales every AI-estimated measurement, exactly like the
 * manual door-height calibration but with zero user effort. */
const SAT_FOOTPRINT_PROMPT = `Top-down satellite photo. Trace the roof outline of the MAIN building nearest the image center as a polygon of 4-10 points, normalized 0-1 (x right, y down). Include attached garages; exclude detached buildings, driveways, trees.
Identify which polygon edge faces the street (the road strip). "frontEdge" is the 0-based index i meaning the edge from point i to point i+1 (wrapping).
Return ONLY single-line compact JSON: {"footprint":[{"x":0.42,"y":0.38},...],"frontEdge":0,"confidence":0.0-1.0}`;

async function autoCalibrateFromSatellite(onStatus = () => {}) {
  if (!project.satellite || typeof project.lat !== "number") return;
  const aiFront = project.analysis?.houseFrontWidthFt;
  if (!(aiFront > 0)) return;

  onStatus("Checking scale against satellite…");
  const text = await callClaude({
    system: "You trace building footprints precisely. Respond with valid JSON only.",
    messages: [{ role: "user", content: [imageBlock(project.satellite), { type: "text", text: SAT_FOOTPRINT_PROMPT }] }],
    maxTokens: 500,
    model: FAST_MODEL,
  }, onStatus);
  const parsed = validateShape(extractJSON(text), { footprint: "array", confidence: "number" }, "Satellite footprint");

  const satZoom = project.satelliteZoom || 20;
  const fp = computeSatFootprint(parsed.footprint, parsed.frontEdge, project.lat, satZoom);
  if (!fp) return;

  // Keep the traced footprint so edges can be used as DIRECT measurements
  project.footprint = {
    points: parsed.footprint,
    frontEdge: parsed.frontEdge,
    confidence: parsed.confidence ?? 0.5,
    edges: footprintEdges(parsed.footprint, project.lat, satZoom),
    zoom: satZoom,
    lat: project.lat,
  };

  const factor = calibrationFactorFrom(fp.frontFt, aiFront);
  const satCheck = {
    satFrontFt: fp.frontFt,
    aiFrontFt: Math.round(aiFront * 10) / 10,
    perimeterFt: fp.perimeterFt,
    confidence: parsed.confidence ?? 0.5,
    factor,
    applied: false,
  };

  if (factor !== null && (parsed.confidence ?? 0) >= 0.5) {
    applyCalibrationFactor(factor, "satellite");
    project.calibration = { source: "satellite", factor, satFrontFt: fp.frontFt, aiFt: aiFront };
    satCheck.applied = true;
  } else if (factor === null) {
    project.analysis.warnings = [
      ...(project.analysis.warnings || []),
      `Satellite front width (${fp.frontFt} ft) disagrees strongly with the photo estimate (${satCheck.aiFrontFt} ft) — verify measurements or calibrate with a door height.`,
    ];
  }
  project.analysis.satCheck = satCheck;

  // Now that scale is settled, replace AI-estimated horizontal roofline
  // lengths with DIRECT footprint-edge measurements where they match.
  applyDirectEdgeMeasurements();
  applyPitchCorrections();
}

/* ---- Direct edge measurement ----
 * For the main street-facing roofline, the satellite footprint edge IS the
 * measurement (plus eave overhang). Replace the AI estimate when the two are
 * in the same ballpark; if they disagree wildly, keep the AI value and warn
 * rather than silently swapping in a possibly-mistraced edge. */
function applyDirectEdgeMeasurements() {
  const fpr = project.footprint;
  if (!fpr || !fpr.edges?.length) return;
  if ((fpr.confidence ?? 0) < 0.5) return;

  const cfg = loadPricingConfig();
  const overhangIn = cfg.rules.eaveOverhangIn ?? 12;
  const front = frontEdgeOf(fpr.edges, fpr.frontEdge);
  if (!front) return;
  const directFt = rooflineFromEdge(front.ft, overhangIn);

  // The longest marked front-facing horizontal roofline row
  const candidates = project.measurements.filter(
    (r) => r.source === "AI Estimated" && (r.zoneKind === "eave" || r.zoneKind === "garage")
  );
  if (!candidates.length) return;
  const target = candidates.reduce((a, b) => (b.value > a.value ? b : a));

  const ratio = directFt / (target.value || directFt);
  if (ratio < 0.6 || ratio > 1.7) {
    project.analysis.warnings = [
      ...(project.analysis.warnings || []),
      `Satellite front edge (${directFt} ft incl. overhang) differs from the photo estimate for "${target.zoneLabel}" (${target.value} ft) — verify which is right.`,
    ];
    return;
  }
  target.value = directFt;
  target.imageSource = "satellite";
  target.measuredDirect = true;
  target.confidence = Math.max(target.confidence ?? 0.5, 0.9);
  target.basis = `measured directly from satellite footprint edge (${front.ft} ft + ${overhangIn}" overhang each end)`;
}

/* ---- Pitch correction for sloped runs ----
 * Satellite/plan distances are horizontal; a rake's true surface length is
 * plan × √(1+(pitch/12)²). Applied ONLY to sloped zone kinds, once, and
 * always disclosed in the row's basis. */
function applyPitchCorrections() {
  const pitch = project.analysis?.roofPitchPer12 || assumedPitch(project.analysis?.roofComplexity);
  for (const r of project.measurements) {
    if (r.pitchApplied) continue;                  // never double-apply
    if (r.source !== "AI Estimated") continue;     // never touch reviewed rows
    const res = applyPitchToPlanLength(r.value, r.zoneKind, pitch);
    if (!res.applied) continue;
    r.planFt = r.value;
    r.value = res.ft;
    r.pitchApplied = res.factor;
    r.basis = `${r.basis ? r.basis + " · " : ""}slope ${pitch}/12 → ×${res.factor} (${r.planFt}→${r.value} ft)`;
  }
}

function initAnalysis() {
  const btn = document.getElementById("btn-analyze");
  const status = document.getElementById("analysis-status");

  btn.addEventListener("click", () => withBusy(btn, async () => {
    setStatus(status, "Analyzing marked areas…");
    try {
      await runAnalysis((msg) => { btn.textContent = msg; });
    } catch (e) {
      setStatus(status, e.message, "warn");
      return;
    }
    setStatus(status, "Analysis complete — review measurements below.", "ok");
    scrollToSection("measure-section");
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
  // One complexity for the whole property. Prefer an explicit pitch when the
  // model gave one, since that's checkable; fall back to its label.
  const fromPitch = complexityFromPitch(parsed.roofPitchPer12);
  const complexity = ROOF_COMPLEXITY[parsed.roofComplexity]
    ? parsed.roofComplexity
    : (fromPitch || "mid");

  const cfg = loadPricingConfig();
  const rows = [];
  const seenMarks = new Set();
  for (const m of parsed.measurements || []) {
    if (!m.markId) continue;
    // Safeguard: never count the same marked section twice
    if (seenMarks.has(m.markId)) continue;
    seenMarks.add(m.markId);
    const mark = project.marks.find((x) => x.id === m.markId);
    // Safeguard: never measure areas the estimator didn't select
    if (mark && mark.included === false) continue;

    const zoneKind = m.zoneKind || inferZoneKind(mark);
    const isPlant = zoneKind === "bush" || zoneKind === "shrub";
    const isTree = zoneKind === "tree";
    const itemKey = itemKeyForZone(zoneKind, complexity) || defaultItemKey(mark);

    const row = {
      id: "meas_" + m.markId,
      markId: m.markId,
      zoneKind,
      zoneLabel: m.zoneLabel || mark?.zoneLabel || "run",
      itemKey,
      unit: "lf",
      source: "AI Estimated",
      imageSource: ["photo", "satellite", "both"].includes(m.source) ? m.source : "photo",
      confidence: m.confidence ?? 0.5,
      basis: m.basis || "",
    };

    if (isPlant) {
      const p = m.plant || {};
      row.plant = {
        widthFt: num(p.widthFt, 3), heightFt: num(p.heightFt, 3),
        depthFt: num(p.depthFt, num(p.widthFt, 3) * 0.8),
        shape: p.shape || "rounded", density: p.density || "medium",
        sizeClass: p.sizeClass || mark?.sizeClass || "medium",
        pattern: mark?.wrapStyle === "branch" ? "branch" : "wrap",
        spacingKey: "standard",
      };
      const bd = bushStrandBreakdown(row.plant, cfg.rules);
      row.value = bd.footage;               // display footage; strands derive live
      row.rawAiValue = bd.footage;
      if (mark) mark.sizeClass = row.plant.sizeClass;
    } else if (isTree) {
      const t = m.tree || {};
      row.tree = {
        heightFt: num(t.heightFt, 12), trunkHeightFt: num(t.trunkHeightFt, null),
        trunkCircumFt: num(t.trunkCircumFt, null), branchCount: num(t.branchCount, null),
        branchLenFt: num(t.branchLenFt, null), branchCircumFt: num(t.branchCircumFt, null),
        canopyWidthFt: num(t.canopyWidthFt, null),
        style: mark?.wrapStyle === "branch" ? "trunk_branch" : "trunk",
        spacingKey: "standard",
      };
      const td = treeStrandBreakdown(row.tree, cfg.rules);
      row.value = td.footage;
      row.rawAiValue = td.footage;
    } else {
      if (typeof m.lengthFt !== "number") continue;   // nothing usable
      row.value = round1(m.lengthFt);
      row.rawAiValue = round1(m.lengthFt);
    }
    rows.push(row);
  }
  project.analysis = {
    roofComplexity: complexity,
    roofPitchPer12: parsed.roofPitchPer12 ?? null,
    complexityReason: parsed.complexityReason || "",
    stories: parsed.stories || 1,
    houseFrontWidthFt: typeof parsed.houseFrontWidthFt === "number" ? parsed.houseFrontWidthFt : null,
    installNotes: parsed.installNotes || [],
    warnings: parsed.warnings || [],
    overallConfidence: parsed.overallConfidence ?? 0.5,
    satCheck: null,
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
  if (mark.kind === "area") return "bush_strand";
  if (mark.lightType === "icicle") return "icicle";
  if (mark.zoneLabel === "ground run") return "ground_stake";
  if (mark.lightType === "c7") return "c7_window";
  return "roofline_mid";
}

/* Fall back to the mark's own metadata when the model omits zoneKind. */
function inferZoneKind(mark) {
  if (!mark) return "eave";
  if (mark.featureType) {
    const f = mark.featureType;
    if (f === "garage_eave") return "garage";
    if (["eave", "rake", "peak", "ridge", "dormer", "window", "bush", "shrub", "tree"].includes(f)) return f;
    if (f === "walkway" || f === "driveway") return "ground";
    if (f === "column" || f === "railing") return "pillar";
  }
  if (mark.kind === "area") return mark.areaKind === "shrub" ? "shrub" : "bush";
  if (mark.kind === "addon") return "pillar";
  const l = (mark.zoneLabel || "").toLowerCase();
  if (l.includes("garage")) return "garage";
  if (l.includes("ridge")) return "ridge";
  if (l.includes("rake") || l.includes("gable")) return "rake";
  if (l.includes("ground") || l.includes("walk") || l.includes("drive")) return "ground";
  if (l.includes("window")) return "window";
  if (mark.lightType === "icicle") return "icicle";
  return "eave";
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
const num = (v, fallback) => (typeof v === "number" && isFinite(v) && v > 0 ? v : fallback);
