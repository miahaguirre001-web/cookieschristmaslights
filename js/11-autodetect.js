/* =========================================================================
 * 11-autodetect.js — Mode A: Auto-Detect Roofline & Features.
 * Detection PROPOSES; the estimator confirms. Detected items land as normal
 * editable marks with included:false (nothing auto-included), confidence
 * badges, <60% flagged "verify". One-click escape hatch. Honest about
 * low overall confidence.
 * ========================================================================= */
"use strict";

const DETECT_PROMPT = `Analyze this street-level photo of a house and return its lightable geometry for a Christmas-light install. All coordinates normalized 0–1 (x from left, y from top) relative to the FULL image. Target the main house in the frame; identify the garage separately.

Return ONLY JSON:
{
 "overallConfidence": 0.0-1.0,
 "features": [
  {"kind":"polyline","featureType":"eave|rake|peak|ridge|dormer|walkway|driveway","points":[{"x":..,"y":..},...],"confidence":0.0-1.0,"label":"front eave"},
  {"kind":"box","featureType":"window|column|railing|bush|shrub|tree|garage_eave","rect":{"x":..,"y":..,"w":..,"h":..},"confidence":0.0-1.0,"label":"left front window","heightFt":null,"widthFt":null}
 ]
}
Rules: trace the ACTUAL visible roof edges (perspective included). For bushes/trees estimate heightFt/widthFt. Mark garage rooflines featureType "garage_eave" (they are excluded by default). Keep labels under 4 words. If trees/shadows make edges uncertain, lower confidence honestly rather than guessing confidently.`;

function initAutoDetect() {
  const btn = document.getElementById("btn-autodetect");
  const status = document.getElementById("detect-status");

  btn.addEventListener("click", () => withBusy(btn, async () => {
    if (!project.photo) { setStatus(status, "Import or upload a photo first.", "warn"); return; }
    setStatus(status, "Detecting roofline & features…");
    const onStatus = (m) => { btn.textContent = m; };

    const text = await callClaude({
      system: "You are a precise architectural feature detector. Respond with valid JSON only.",
      messages: [{ role: "user", content: [imageBlock(project.photo), { type: "text", text: DETECT_PROMPT }] }],
      maxTokens: 4000,
    }, onStatus);

    const parsed = validateShape(extractJSON(text), { features: "array", overallConfidence: "number" }, "Detection");
    const added = applyDetection(parsed);

    if ((parsed.overallConfidence ?? 0) < 0.5) {
      setStatus(status, `Detection is LOW confidence (${Math.round((parsed.overallConfidence || 0) * 100)}%) on this photo — manual marking will likely be faster. Detected candidates are shown faded; use them or clear them.`, "warn");
    } else {
      setStatus(status, `${added} candidates detected. NOTHING is included yet — click "Select all roofline" or toggle items below, then edit on the canvas.`, "ok");
    }
    renderDetectionPanel();
  }));

  document.getElementById("btn-select-roofline").addEventListener("click", () => {
    let n = 0;
    for (const m of project.marks) {
      if (m.source === "detected" && ["eave", "rake", "peak", "ridge", "dormer"].includes(m.featureType) && m.featureType !== "garage_eave") {
        if (m.included === false) { m.included = true; n++; }
      }
    }
    touchMarks(); renderDetectionPanel();
  });

  document.getElementById("btn-clear-detection").addEventListener("click", () => {
    project.marks = project.marks.filter((m) => m.source !== "detected");
    touchMarks(); renderDetectionPanel();
    setStatus(status, "Detection cleared — draw manually.", "");
  });

  window.addEventListener("project-loaded", renderDetectionPanel);
}

function applyDetection(parsed) {
  // replace previous detection, keep manual marks
  project.marks = project.marks.filter((m) => m.source !== "detected");
  let n = 0;
  for (const f of parsed.features || []) {
    if (f.kind === "polyline" && Array.isArray(f.points) && f.points.length >= 2) {
      // break polyline into segment marks so each is draggable/editable
      for (let i = 0; i < f.points.length - 1; i++) {
        const a = f.points[i], b = f.points[i + 1];
        if (!isPt(a) || !isPt(b)) continue;
        project.marks.push({
          id: nextMarkId(), kind: "line",
          lightType: ["walkway", "driveway"].includes(f.featureType) ? "mini" : "c9",
          a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y },
          zoneLabel: f.label || f.featureType,
          featureType: f.featureType,
          source: "detected", confidence: f.confidence ?? 0.5,
          included: false,   // NOTHING auto-included
          wrapStyle: null,
        });
        n++;
      }
    } else if (f.kind === "box" && f.rect && isRect(f.rect)) {
      const isPlant = ["bush", "shrub", "tree"].includes(f.featureType);
      project.marks.push({
        id: nextMarkId(),
        kind: isPlant ? "area" : "line",
        ...(isPlant
          ? { areaKind: f.featureType === "shrub" ? "shrub" : "bush", rect: f.rect, wrapStyle: "wrap", sizeClass: sizeFromFt(f.heightFt) }
          : boxToPerimeterLine(f)),
        lightType: isPlant ? "mini" : "c7",
        zoneLabel: f.label || f.featureType,
        featureType: f.featureType,
        source: "detected", confidence: f.confidence ?? 0.5,
        included: false,
      });
      n++;
    }
  }
  touchMarks();
  return n;
}

const isPt = (p) => p && typeof p.x === "number" && typeof p.y === "number" && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
const isRect = (r) => typeof r.x === "number" && typeof r.y === "number" && r.w > 0 && r.h > 0;

function sizeFromFt(h) {
  if (!h) return "medium";
  if (h <= 3) return "small";
  if (h <= 5) return "medium";
  if (h <= 8) return "large";
  return "xl";
}

/* windows/columns/railings become a line across the top of the box (C7 style) */
function boxToPerimeterLine(f) {
  const r = f.rect;
  return { a: { x: r.x, y: r.y }, b: { x: r.x + r.w, y: r.y }, boxRect: r };
}

function renderDetectionPanel() {
  const host = document.getElementById("detect-list");
  const detected = project.marks.filter((m) => m.source === "detected");
  document.getElementById("detect-actions").style.display = detected.length ? "" : "none";
  if (!detected.length) { host.innerHTML = ""; return; }
  host.innerHTML = detected.map((m) => {
    const low = (m.confidence ?? 0) < 0.6;
    const isGarage = m.featureType === "garage_eave";
    return `<label class="detect-item ${low ? "low" : ""}">
      <input type="checkbox" data-id="${m.id}" ${m.included ? "checked" : ""}>
      ${esc(m.zoneLabel)} <span class="conf ${low ? "low" : ""}">${Math.round((m.confidence ?? 0) * 100)}%${low ? " — verify" : ""}</span>
      ${isGarage ? "<small>(garage — excluded by default)</small>" : ""}
    </label>`;
  }).join("");
  host.querySelectorAll("input").forEach((cb) =>
    cb.addEventListener("change", () => {
      const m = project.marks.find((x) => x.id === cb.dataset.id);
      if (m) { m.included = cb.checked; touchMarks(); }
    })
  );
}
