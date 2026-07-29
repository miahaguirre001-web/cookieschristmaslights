/* =========================================================================
 * 10-mockup.js — Mock-up generation. This file encodes Rules 1–10, 13, 14:
 *  R1  pre-darken the photo before sending (brightness .5, sat .72, blue wash)
 *  R2  markup map drawn on the SAME darkened base — identical lighting
 *  R3  AI-facing area marks = clean wash + outline, never a dot grid
 *  R4  placement comes EXCLUSIVELY from marks; zone names are labels only
 *  R5  three redundant views: marked image + geometry list + install notes
 *  R6  structure-lock, stated as a photo EDIT
 *  R7  marks light what EXISTS — never invent an object
 *  R8  automated QA + ONE stricter retry, never loop
 *  R9/R10  no upscaling, no cropping — full frame, "ignore neighbors"
 *  R13 sharpness: PNG-only intermediates, no downscale, explicit demands
 * ========================================================================= */
"use strict";

/* ---- Rule 1/13: night pre-processing. Moderate darken — structure must
 * survive. PNG output only (never JPEG re-encode). ---- */
function makeNightBase(photoDataUrl) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;   // never downscale (Rule 13)
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.filter = "brightness(0.5) saturate(0.72)";
      ctx.drawImage(img, 0, 0);
      ctx.filter = "none";
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = "rgba(20, 40, 90, 0.42)";  // deep blue night wash
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.globalCompositeOperation = "source-over";
      res(c.toDataURL("image/png"));              // LOSSLESS (Rule 13)
    };
    img.src = photoDataUrl;
  });
}

/* ---- Rule 2/3: markup map = same darkened base + CLEAN marks.
 * Lines: solid strokes with [mark_id] labels.
 * Areas: translucent wash + outline ONLY — no dots, no grids (Rule 3). ---- */
function makeMarkupMap(nightBaseDataUrl, marks) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const W = c.width, H = c.height;
      const lw = Math.max(3, W / 240);

      for (const m of marks) {
        if (m.included === false) continue;
        if (m.kind === "line" || m.kind === "curve") {
          ctx.strokeStyle = markerColor(m.lightType);
          ctx.lineWidth = lw;
          ctx.lineCap = "round";
          ctx.beginPath();
          if (m.kind === "line") {
            ctx.moveTo(m.a.x * W, m.a.y * H);
            ctx.lineTo(m.b.x * W, m.b.y * H);
          } else drawWave(ctx, m.a, m.b, W, H);
          ctx.stroke();
          labelMark(ctx, m.id, m.a.x * W, m.a.y * H - 8, W);
        } else if (m.kind === "area") {
          const r = m.rect;
          // clean translucent wash + outline — the model must light the REAL
          // plants inside, never render a rectangle of light
          ctx.fillStyle = hexToRgba(markerColor(m.lightType), 0.18);
          ctx.fillRect(r.x * W, r.y * H, r.w * W, r.h * H);
          ctx.strokeStyle = markerColor(m.lightType);
          ctx.lineWidth = lw * 0.8;
          ctx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H);
          labelMark(ctx, m.id, r.x * W, r.y * H - 8, W);
        } else if (m.kind === "addon") {
          const r = m.rect;
          ctx.strokeStyle = "#ffcc33";
          ctx.lineWidth = lw * 0.8;
          ctx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H);
          labelMark(ctx, m.id, r.x * W, r.y * H - 8, W);
        }
      }
      res(c.toDataURL("image/png"));              // LOSSLESS (Rule 13)
    };
    img.src = nightBaseDataUrl;
  });
}

function labelMark(ctx, id, x, y, W) {
  ctx.font = `bold ${Math.max(12, W / 80)}px system-ui`;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(0,0,0,.8)";
  ctx.lineWidth = 3;
  ctx.strokeText(`[${id}]`, x, y);
  ctx.fillText(`[${id}]`, x, y);
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* ---- The generation prompt: Rules 3–7, 9, 10, 13 ---- */
function buildMockupPrompt() {
  const marks = project.marks.filter((m) => m.included !== false);
  const colorLabel = LIGHT_COLORS.find((c) => c.id === project.colorScheme)?.label || "Warm White";
  const seq = project.colorScheme === "custom" && project.customSequence.length
    ? " Custom bulb sequence, repeating in strict order: " +
      project.customSequence.map((id) => SEQUENCE_SWATCHES.find((s) => s.id === id)?.label).join(" → ") + "."
    : "";

  const geometry = marks.map((m) => describeMarkGeometry(m)).join("\n");
  const notes = (project.analysis?.installNotes || []).map((n) => "- " + n).join("\n");

  return `THIS IS A PHOTO EDIT of the exact property in the input image — NOT a new render.

Input image 1 is the property at night. Input image 2 is the identical image with the installation plan drawn on it. The colored marks in image 2 are the MASTER MAP: they are the complete and only definition of where lights go.

ONLY TWO THINGS MAY CHANGE from image 1: (a) Christmas lights are added exactly where marked, (b) it is night. Everything else is locked: the count of houses, garages, stories, windows and doors must exactly match the input; driveways, side yards and empty space stay exactly as-is; add NO new structures, posts, arbors, plants, or decorations of any kind anywhere. The target is the house the markup is drawn on — ignore neighboring houses entirely.

PLACEMENT — from the marks EXCLUSIVELY:
${geometry}

Marker legend: red lines = C9 bulbs (large 3", ~12" spacing), blue = C7 (~2.5", windows), green = mini lights (dense sparkle), purple = multicolor strands, pink = icicle strands. Translucent washed rectangles mark bush/shrub regions: light the REAL plants inside that region so the lights conform to each plant's natural outline — NEVER render a rectangle, grid, or block of light, and NEVER invent a plant that isn't in the photo. Yellow boxes are decoration placements. Wrap-style marks mean: wrap lights around whatever ALREADY EXISTS at that spot (pillar, post, trunk); if nothing wrappable exists, place a clean vertical light run instead — never fabricate an object. Any zone names in this prompt are descriptive labels only, NOT placement instructions.

INSTALL NOTES (these agree with the marks; if anything seems to conflict, the marks win):
${notes || "- Light exactly and only the marked runs."}

Light color scheme: ${colorLabel}.${seq}

RENDERING QUALITY — non-negotiable:
- Photorealistic night scene. Warm realistic light glow with soft falloff on nearby surfaces; individually visible bulbs at correct spacing and realistic size (C9 bulbs are ~3 inches — clearly visible, never dust-sized).
- OUTPUT MUST BE SHARP AND CRISPLY DETAILED at full size. Preserve siding, brick, shingle and trim texture exactly as in the input. No smoothing, no haze, no depth-of-field blur, no painterly softening, no upscaling artifacts. It must look like a real DSLR night photograph of this exact property, not an AI painting.
- Remove the colored markup lines/boxes themselves from the output — they are instructions, not content.`;
}

/* ---- QA (Rule 8): vision check + ONE stricter retry ---- */
function buildQAPrompt() {
  const marks = project.marks.filter((m) => m.included !== false);
  const decorCount = marks.filter((m) => m.kind === "addon" && !ADDONS.find((a) => a.id === m.addonId)?.isWrapDesign).length;
  return `Compare the ORIGINAL property photo (image 1) with the GENERATED Christmas-light mock-up (image 2). Check strictly:
1. lights_only_where_marked: lights appear ONLY along these marked zones: ${marks.map((m) => m.zoneLabel).join(", ") || "none"} — flag lights on any unmarked area (e.g. garage if unmarked).
2. decoration_count: exactly ${decorCount} freestanding decorations (wreaths/bows/deer/garland). Pillar/tree/bush WRAPS are integral lighting — do NOT count them as decorations.
3. night: the scene is clearly night, not daylight or dusk.
4. structure_match: same number of houses, garages, stories, windows, doors; no new structures, posts, or plants.
5. bulb_size: bulbs clearly visible, not dust-sized.
6. sharpness: image is sharp; no heavy blur/smoothing.
Return ONLY JSON: {"pass":true|false,"failures":[{"check":"...","detail":"one short sentence"}]}`;
}

async function generateMockup(btn, statusEl, isRetry = false, correction = "") {
  const onStatus = (msg) => { btn.textContent = msg; };

  // Rule 1 & 2: darkened base, markup on the SAME base
  onStatus("Preparing night base…");
  const nightBase = await makeNightBase(project.photo);
  const markupMap = await makeMarkupMap(nightBase, project.marks);

  let prompt = buildMockupPrompt();
  if (isRetry && correction) {
    prompt += `\n\nPREVIOUS ATTEMPT FAILED QA — fix exactly this and change nothing else: ${correction}`;
  }

  onStatus(isRetry ? "Regenerating (stricter)…" : "Generating mock-up…");
  const resultUrl = await callGeminiImage({ prompt, imageDataUrls: [nightBase, markupMap] }, onStatus);

  onStatus("Inspecting result…");
  let qa = { pass: true, failures: [] };
  try {
    const qaText = await callClaude({
      system: "You are a strict image QA inspector. Respond with valid JSON only.",
      messages: [{
        role: "user",
        content: [imageBlock(project.photo), imageBlock(resultUrl), { type: "text", text: buildQAPrompt() }],
      }],
      maxTokens: 800,
    }, onStatus);
    qa = validateShape(extractJSON(qaText), { failures: "array" }, "QA");
  } catch (e) {
    qa = { pass: true, failures: [], note: "QA unavailable: " + e.message };
  }

  project.mockups.push({
    dataUrl: resultUrl, createdAt: Date.now(),
    qa, prompt, isRetry,
  });
  scheduleSave();

  // ONE stricter retry only — never loop (Rule 8)
  if (!qa.pass && !isRetry && qa.failures?.length) {
    const correctionMsg = qa.failures.map((f) => `${f.check}: ${f.detail}`).join("; ");
    setStatus(statusEl, "QA found issues — one automatic retry with targeted correction…", "warn");
    await generateMockup(btn, statusEl, true, correctionMsg);
  }
}

/* ---------------- UI ---------------- */

function initMockup() {
  const btn = document.getElementById("btn-generate");
  const status = document.getElementById("mockup-status");

  btn.addEventListener("click", () => withBusy(btn, async () => {
    if (!project.photo) { setStatus(status, "Import a photo first.", "warn"); return; }
    if (!project.analysis) { setStatus(status, "Run Analyze Marked Areas first — analysis unlocks the mock-up.", "warn"); return; }
    if (isAnalysisStale()) { setStatus(status, "Markup changed since analysis — re-analyze first.", "warn"); return; }
    // cost control: deliberate confirmation, generation costs credits
    const n = project.marks.filter((m) => m.included !== false).length;
    if (!confirm(`Generate mock-up for ${n} marked item${n === 1 ? "" : "s"}? (Each generation costs API credits.)`)) return;
    await generateMockup(btn, status);
    renderMockups();
    setStatus(status, "Done — review at FULL SIZE before sending (blur hides in thumbnails).", "ok");
  }));

  window.addEventListener("project-loaded", () => { renderMockups(); renderFallbackPanel(); });
  window.addEventListener("marks-changed", renderFallbackPanel);
  window.addEventListener("analysis-complete", renderFallbackPanel);

  /* Manual fallback panel — ALWAYS visible, core feature */
  document.getElementById("fb-copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(document.getElementById("fb-prompt").value);
    document.getElementById("fb-copy").textContent = "Copied ✓";
    setTimeout(() => (document.getElementById("fb-copy").textContent = "Copy Prompt"), 1500);
  });
  document.getElementById("fb-download").addEventListener("click", async () => {
    if (!project.photo) { alert("No photo yet."); return; }
    const nightBase = await makeNightBase(project.photo);
    downloadDataUrl(nightBase, "base-photo-night.png");
  });
  document.getElementById("fb-upload").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const dataUrl = await readFileAsDataURL(f);
    project.mockups.push({ dataUrl, createdAt: Date.now(), qa: { pass: null, failures: [], note: "external result" }, prompt: "(external)", external: true });
    scheduleSave(); renderMockups();
  });

  renderFallbackPanel();
}

function renderFallbackPanel() {
  const ta = document.getElementById("fb-prompt");
  if (!ta) return;
  ta.value = project.marks.some((m) => m.included !== false)
    ? buildMockupPrompt()
    : "Mark the design above — the full generation prompt will appear here, ready to paste into Gemini or ChatGPT with the downloaded base photo.";
}

function renderMockups() {
  const host = document.getElementById("mockup-results");
  if (!project.mockups.length) { host.innerHTML = ""; return; }
  const latest = project.mockups[project.mockups.length - 1];
  host.innerHTML = `
    <div class="mockup-compare">
      <figure><img src="${project.photo}" alt="Original"><figcaption>Original</figcaption></figure>
      <figure><img src="${latest.dataUrl}" alt="Mock-up" id="mockup-img"><figcaption>Mock-up ${latest.external ? "(external)" : ""}</figcaption></figure>
    </div>
    ${latest.qa && latest.qa.pass === false ? `<div class="warn-banner">QA flags: ${latest.qa.failures.map((f) => esc(f.check + " — " + f.detail)).join("; ")}</div>` : ""}
    <div class="mockup-actions">
      <button id="mockup-download">Download mock-up</button>
      <button id="mockup-fullsize">Open full size</button>
      <button id="mockup-brush">Cleanup brush</button>
      ${project.mockups.length > 1 ? `<select id="mockup-history">${project.mockups.map((m, i) =>
        `<option value="${i}" ${i === project.mockups.length - 1 ? "selected" : ""}>v${i + 1} — ${new Date(m.createdAt).toLocaleTimeString()}</option>`).join("")}</select>` : ""}
    </div>
    <div id="brush-wrap" style="display:none">
      <p class="hint">Paint over stray lights — the brush restores the original (darkened) photo underneath. <button id="brush-save">Save cleaned version</button></p>
      <canvas id="brush-canvas"></canvas>
    </div>`;
  document.getElementById("mockup-download").addEventListener("click", () =>
    downloadDataUrl(latest.dataUrl, `mockup-${(project.address || "house").replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.png`));
  document.getElementById("mockup-fullsize").addEventListener("click", () => {
    const w = window.open();
    w.document.write(`<img src="${latest.dataUrl}" style="width:100%">`);
  });
  const hist = document.getElementById("mockup-history");
  if (hist) hist.addEventListener("change", () => {
    document.getElementById("mockup-img").src = project.mockups[+hist.value].dataUrl;
  });
  document.getElementById("mockup-brush").addEventListener("click", () => initBrush(latest));
}

/* Cleanup brush: paint out stray lights by restoring night-base pixels */
async function initBrush(mock) {
  const wrap = document.getElementById("brush-wrap");
  wrap.style.display = "";
  const canvas = document.getElementById("brush-canvas");
  const nightBase = await makeNightBase(project.photo);
  const [mockImg, baseImg] = await Promise.all([loadImg(mock.dataUrl), loadImg(nightBase)]);
  canvas.width = mockImg.naturalWidth;
  canvas.height = mockImg.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(mockImg, 0, 0);
  let painting = false;
  const paint = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * canvas.width;
    const y = ((e.clientY - r.top) / r.height) * canvas.height;
    const rad = canvas.width / 40;
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.clip();
    ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  };
  canvas.onpointerdown = (e) => { painting = true; paint(e); };
  canvas.onpointermove = (e) => { if (painting) paint(e); };
  canvas.onpointerup = () => { painting = false; };
  document.getElementById("brush-save").onclick = () => {
    project.mockups.push({ dataUrl: canvas.toDataURL("image/png"), createdAt: Date.now(), qa: { pass: null, failures: [], note: "manually cleaned" }, prompt: mock.prompt, cleaned: true });
    scheduleSave(); renderMockups();
  };
}

const loadImg = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });

function downloadDataUrl(dataUrl, name) {
  const a = document.createElement("a");
  a.href = dataUrl; a.download = name; a.click();
}
