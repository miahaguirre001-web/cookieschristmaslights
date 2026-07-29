/* =========================================================================
 * 11-autodetect.js — Mode A: Auto-Detect + the one-click AUTO-ESTIMATE
 * pipeline (detect → snap → verify → measure → price → mock-up).
 *
 * Detection accuracy is attacked three ways, because raw vision-model
 * coordinates drift (the floating-roofline problem):
 *   1. GRID ANCHORING — the photo sent for detection carries a labeled 10%
 *      grid, so the model reports coordinates against visible reference
 *      lines instead of guessing proportions.
 *   2. EDGE SNAPPING — client-side Sobel edge detection shifts each detected
 *      line onto the strongest real image edge nearby (roof-vs-sky edges are
 *      the strongest in the frame). Free, deterministic, no API call.
 *   3. AI VERIFICATION PASS — the detected lines are rendered ON the photo
 *      and sent back once: "do the red lines sit exactly on the edges?
 *      correct any that don't." Models are far better at judging an overlay
 *      than at emitting blind coordinates.
 *
 * Auto-Estimate honors the shop's workflow: AI does the whole chain in one
 * click; the manual tools remain underneath as the correction layer.
 * ========================================================================= */
"use strict";

const DETECT_PROMPT = `Analyze this street-level photo of a house and return its lightable geometry for a Christmas-light install.

COORDINATES: the image has a labeled reference grid drawn on it — thin cyan lines every 10% with x/y percentage labels on the edges. Use the grid to report PRECISE normalized coordinates (0–1). Before writing each coordinate, locate the feature relative to the nearest grid lines (e.g. "ridge sits just below the y=0.30 line ≈ 0.31"). Trace the ACTUAL visible edges — a roofline point must sit ON the roof edge in the photo, never above the roof or in the sky.

Target the main house in the frame (largest/most central); identify the garage separately; IGNORE neighboring houses entirely.

Return ONLY JSON:
{
 "overallConfidence": 0.0-1.0,
 "features": [
  {"kind":"polyline","featureType":"eave|rake|peak|ridge|dormer|walkway|driveway","points":[{"x":..,"y":..},...],"confidence":0.0-1.0,"label":"front eave"},
  {"kind":"box","featureType":"window|column|railing|bush|shrub|tree|garage_eave","rect":{"x":..,"y":..,"w":..,"h":..},"confidence":0.0-1.0,"label":"left front window","heightFt":null,"widthFt":null}
 ]
}
Rules: polylines follow perspective (a receding eave slopes in image space — trace what you SEE). Bush/shrub/tree boxes must fit TIGHTLY around the actual plant, not the whole garden bed. Estimate heightFt/widthFt for plants. Garage rooflines use featureType "garage_eave" (excluded by default). Labels under 4 words. If trees or shadows hide an edge, lower that feature's confidence honestly rather than guessing confidently.`;

/* ---------- 1. grid-anchored detection ---------- */

function makeGridReference(photoDataUrl) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const W = c.width, H = c.height;
      ctx.strokeStyle = "rgba(0, 229, 255, 0.55)";
      ctx.fillStyle = "rgba(0, 229, 255, 0.95)";
      ctx.lineWidth = Math.max(1, W / 900);
      ctx.font = `${Math.max(11, W / 70)}px system-ui`;
      for (let i = 1; i < 10; i++) {
        const x = (i / 10) * W, y = (i / 10) * H;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        ctx.fillText(`${i * 10}`, x + 3, Math.max(14, W / 70));
        ctx.fillText(`${i * 10}`, 3, y - 4);
      }
      res(c.toDataURL("image/jpeg", 0.9));   // detection-only image, not in the mock-up chain
    };
    img.src = photoDataUrl;
  });
}

async function runDetection(onStatus = () => {}) {
  const gridImage = await makeGridReference(project.photo);
  const text = await callClaude({
    system: "You are a precise architectural feature detector. Respond with valid JSON only.",
    messages: [{ role: "user", content: [imageBlock(gridImage), { type: "text", text: DETECT_PROMPT }] }],
    maxTokens: 4000,
  }, onStatus);
  const parsed = validateShape(extractJSON(text), { features: "array", overallConfidence: "number" }, "Detection");
  const added = applyDetection(parsed);
  return { parsed, added };
}

/* ---------- 2. client-side edge snapping (Sobel) ---------- */

function snapDetectedMarksToEdges() {
  if (!Canvas.img) return 0;
  const W = 640;
  const scale = W / Canvas.img.naturalWidth;
  const H = Math.max(2, Math.round(Canvas.img.naturalHeight * scale));
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.drawImage(Canvas.img, 0, 0, W, H);
  let data;
  try { data = ctx.getImageData(0, 0, W, H).data; } catch { return 0; }

  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  const mag = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const gx = gray[y * W + x + 1] - gray[y * W + x - 1];
      const gy = gray[(y + 1) * W + x] - gray[(y - 1) * W + x];
      mag[y * W + x] = Math.abs(gx) + Math.abs(gy);
    }
  }

  let snapped = 0;
  for (const m of project.marks) {
    if (m.source !== "detected" || m.kind !== "line") continue;
    const dxN = m.b.x - m.a.x, dyN = m.b.y - m.a.y;
    const lenPx = Math.hypot(dxN * W, dyN * H);
    if (lenPx < 8) continue;
    // unit perpendicular in pixel space
    const nx = -(dyN * H) / lenPx, ny = (dxN * W) / lenPx;
    const R = Math.round(H * 0.08);          // search ±8% of image height
    const samples = 14;
    let bestT = 0, bestScore = -1, zeroScore = 0;
    for (let t = -R; t <= R; t++) {
      let s = 0, n = 0;
      for (let i = 0; i <= samples; i++) {
        const f = i / samples;
        const px = Math.round((m.a.x + dxN * f) * W + nx * t);
        const py = Math.round((m.a.y + dyN * f) * H + ny * t);
        if (px < 1 || px >= W - 1 || py < 1 || py >= H - 1) continue;
        s += mag[py * W + px]; n++;
      }
      if (n > samples * 0.7) {
        const avg = s / n;
        if (t === 0) zeroScore = avg;
        // slight preference for smaller moves so we don't jump to a far edge
        const weighted = avg * (1 - Math.abs(t) / (R * 3));
        if (weighted > bestScore) { bestScore = weighted; bestT = t; }
      }
    }
    // move only when there's a clearly stronger edge than where we are
    if (bestT !== 0 && bestScore > 22 && bestScore > zeroScore * 1.15) {
      const ox = (nx * bestT) / W, oy = (ny * bestT) / H;
      m.a.x = clamp01(m.a.x + ox); m.a.y = clamp01(m.a.y + oy);
      m.b.x = clamp01(m.b.x + ox); m.b.y = clamp01(m.b.y + oy);
      m.snapped = true;
      snapped++;
    }
  }
  if (snapped) touchMarks();
  return snapped;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/* ---------- 3. AI verification pass ---------- */

const REFINE_PROMPT = `Image 1 is a house photo with detected light-placement lines drawn on it (bright red lines, each labeled [mark_xx]). These lines are SUPPOSED to sit exactly ON the physical edges they trace (rooflines on roof edges, walkway lines on walkway edges).

Inspect each labeled line. For any line that is offset from its real edge, floating in the sky, on a tree, or on the wrong feature, output corrected endpoints (normalized 0–1, using the cyan 10% reference grid). For lines that are already correct, list them in "ok". For lines that should not exist at all (nothing lightable there), list them in "remove".

Return ONLY JSON:
{"ok":["mark_01"],"remove":["mark_07"],"corrections":[{"markId":"mark_02","a":{"x":0.12,"y":0.31},"b":{"x":0.44,"y":0.30}}]}`;

async function refineDetectionWithAI(onStatus = () => {}) {
  const lines = project.marks.filter((m) => m.source === "detected" && m.kind === "line" && m.included !== false);
  if (!lines.length) return 0;

  // render current lines on a grid copy so the model judges the overlay
  const overlay = await new Promise((res) => {
    makeGridReference(project.photo).then((gridUrl) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const W = c.width, H = c.height;
        ctx.strokeStyle = "#ff1744";
        ctx.lineWidth = Math.max(2.5, W / 300);
        ctx.lineCap = "round";
        ctx.font = `bold ${Math.max(12, W / 85)}px system-ui`;
        for (const m of lines) {
          ctx.beginPath();
          ctx.moveTo(m.a.x * W, m.a.y * H);
          ctx.lineTo(m.b.x * W, m.b.y * H);
          ctx.stroke();
          ctx.fillStyle = "#fff";
          ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.lineWidth = 3;
          ctx.strokeText(`[${m.id}]`, m.a.x * W, m.a.y * H - 6);
          ctx.fillText(`[${m.id}]`, m.a.x * W, m.a.y * H - 6);
          ctx.strokeStyle = "#ff1744"; ctx.lineWidth = Math.max(2.5, W / 300);
        }
        res(c.toDataURL("image/jpeg", 0.9));
      };
      img.src = gridUrl;
    });
  });

  const text = await callClaude({
    system: "You are a strict placement inspector. Respond with valid JSON only.",
    messages: [{ role: "user", content: [imageBlock(overlay), { type: "text", text: REFINE_PROMPT }] }],
    maxTokens: 2500,
  }, onStatus);
  const parsed = validateShape(extractJSON(text), { ok: "array", remove: "array", corrections: "array" }, "Refinement");

  let changed = 0;
  for (const cor of parsed.corrections || []) {
    const m = project.marks.find((x) => x.id === cor.markId && x.source === "detected");
    if (m && isPt(cor.a) && isPt(cor.b)) {
      m.a = cor.a; m.b = cor.b;
      m.confidence = Math.min(0.9, (m.confidence ?? 0.5) + 0.2);
      changed++;
    }
  }
  for (const id of parsed.remove || []) {
    const before = project.marks.length;
    project.marks = project.marks.filter((x) => !(x.id === id && x.source === "detected"));
    if (project.marks.length < before) changed++;
  }
  for (const id of parsed.ok || []) {
    const m = project.marks.find((x) => x.id === id && x.source === "detected");
    if (m) m.confidence = Math.min(0.92, (m.confidence ?? 0.5) + 0.25);
  }
  if (changed) touchMarks();
  return changed;
}

/* ---------- apply detection results as editable marks ---------- */

function applyDetection(parsed) {
  project.marks = project.marks.filter((m) => m.source !== "detected");
  let n = 0;
  for (const f of parsed.features || []) {
    if (f.kind === "polyline" && Array.isArray(f.points) && f.points.length >= 2) {
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
          included: false,
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

function boxToPerimeterLine(f) {
  const r = f.rect;
  return { a: { x: r.x, y: r.y }, b: { x: r.x + r.w, y: r.y }, boxRect: r };
}

/* ---------- AUTO-ESTIMATE: the one-click pipeline ---------- */

const AUTO_ZONE_GROUPS = {
  roofline: { label: "Roofline & peaks", types: ["eave", "rake", "peak", "dormer"], default: true },
  ridge:    { label: "Ridge",            types: ["ridge"], default: false },
  windows:  { label: "Windows",          types: ["window"], default: false },
  plants:   { label: "Bushes & shrubs",  types: ["bush", "shrub", "tree"], default: false },
  walkway:  { label: "Walkway / drive",  types: ["walkway", "driveway"], default: false },
  garage:   { label: "Garage",           types: ["garage_eave", "column", "railing"], default: false },
};

async function runAutoEstimate(groups, onStatus) {
  const wanted = new Set(groups.flatMap((g) => AUTO_ZONE_GROUPS[g]?.types || []));

  onStatus("Step 1/4 — detecting features…");
  const { parsed } = await runDetection(onStatus);

  // include exactly what the estimator asked for
  let included = 0;
  for (const m of project.marks) {
    if (m.source !== "detected") continue;
    m.included = wanted.has(m.featureType);
    if (m.included) included++;
  }
  touchMarks();
  if (!included) {
    throw new Error(
      `Detection found nothing in the selected zones (overall confidence ${Math.round((parsed.overallConfidence || 0) * 100)}%). ` +
      `This photo may be too obstructed — mark the design manually below.`
    );
  }

  onStatus("Step 1/4 — snapping lines to real edges…");
  const snapped = snapDetectedMarksToEdges();

  onStatus("Step 2/4 — AI verifying placement…");
  let refined = 0;
  try { refined = await refineDetectionWithAI(onStatus); }
  catch (e) { console.warn("Refinement pass skipped:", e.message); }

  onStatus("Step 3/4 — measuring & pricing…");
  try {
    await runAnalysis(onStatus);   // pricing renders off the analysis event
  } catch (e) {
    throw new Error(
      `Detected ${included} zones OK, but measuring failed: ${e.message} ` +
      `Your marks are saved — press "Analyze Marked Areas" to retry just that step.`
    );
  }

  onStatus("Step 4/4 — generating mock-up…");
  const genBtn = document.getElementById("btn-generate");
  const genStatus = document.getElementById("mockup-status");
  try {
    await generateMockup(genBtn, genStatus);
    renderMockups();
    renderFallbackPanel();
  } catch (e) {
    // Measurements and pricing are already done and saved — say so, so the
    // estimator doesn't think the whole run was wasted.
    throw new Error(
      `Measured and priced successfully, but the mock-up image failed: ${e.message} ` +
      `Press "Generate Mock-Up" to retry, or use the manual fallback panel.`
    );
  }

  return { included, snapped, refined };
}

/* ---------- UI ---------- */

function initAutoDetect() {
  const btn = document.getElementById("btn-autodetect");
  const status = document.getElementById("detect-status");

  /* Auto-Estimate panel */
  const zoneHost = document.getElementById("auto-zones");
  zoneHost.innerHTML = Object.entries(AUTO_ZONE_GROUPS).map(([k, g]) =>
    `<label class="auto-zone"><input type="checkbox" value="${k}" ${g.default ? "checked" : ""}> ${g.label}</label>`).join("");

  const autoBtn = document.getElementById("btn-auto-estimate");
  const autoStatus = document.getElementById("auto-status");
  autoBtn.addEventListener("click", () => withBusy(autoBtn, async () => {
    if (!project.photo) { setStatus(autoStatus, "Import or upload a photo first.", "warn"); return; }
    const groups = [...zoneHost.querySelectorAll("input:checked")].map((c) => c.value);
    if (!groups.length) { setStatus(autoStatus, "Pick at least one zone to light.", "warn"); return; }
    try {
      const r = await runAutoEstimate(groups, (msg) => { autoBtn.textContent = msg; setStatus(autoStatus, msg); });
      setStatus(autoStatus,
        `Done — ${r.included} zones detected (${r.snapped} edge-snapped, ${r.refined} AI-corrected), measured, priced, and mocked up. ` +
        `Glance over the marks and price; fix anything with the tools below.`, "ok");
      scrollToSection("mockup-section");
    } catch (e) {
      setStatus(autoStatus, e.message, "warn");
    }
  }));

  /* Detect-only button (kept for partial use) */
  btn.addEventListener("click", () => withBusy(btn, async () => {
    if (!project.photo) { setStatus(status, "Import or upload a photo first.", "warn"); return; }
    setStatus(status, "Detecting roofline & features…");
    const { parsed, added } = await runDetection((m) => { btn.textContent = m; });
    const snapped = snapDetectedMarksToEdges();
    if ((parsed.overallConfidence ?? 0) < 0.5) {
      setStatus(status, `Detection is LOW confidence (${Math.round((parsed.overallConfidence || 0) * 100)}%) on this photo — manual marking will likely be faster.`, "warn");
    } else {
      setStatus(status, `${added} candidates detected (${snapped} snapped to edges). Toggle what gets lit below, then Analyze.`, "ok");
    }
    renderDetectionPanel();
  }));

  document.getElementById("btn-select-roofline").addEventListener("click", () => {
    for (const m of project.marks) {
      if (m.source === "detected" && ["eave", "rake", "peak", "ridge", "dormer"].includes(m.featureType)) {
        m.included = true;
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
      ${m.snapped ? "<small>· snapped</small>" : ""}
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
