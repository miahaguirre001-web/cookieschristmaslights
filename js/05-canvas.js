/* =========================================================================
 * 05-canvas.js — THE MARKUP CANVAS. Build-order step 2; everything else
 * derives from it. All three input modes (manual, auto-detect, voice)
 * render into the same marks array.
 *
 * Mark shape (all coordinates normalized 0–1 relative to the photo):
 * {
 *   id: "mark_01",
 *   kind: "line" | "curve" | "area" | "addon",
 *   lightType: "c9"|"c7"|"mini"|"multi"|"icicle",   (line/curve/area)
 *   areaKind: "bush"|"shrub",                        (area only)
 *   addonId: "wreath_lit"|…,                         (addon only)
 *   a:{x,y}, b:{x,y},                                (line/curve endpoints)
 *   rect:{x,y,w,h},                                  (area/addon)
 *   zoneLabel: "front eave"…,   — label ONLY, never a placement instruction (Rule 4)
 *   source: "manual"|"detected"|"voice",
 *   confidence: 0–1|null,       — detected marks carry confidence badges
 *   included: true,             — detection candidates start false (nothing auto-included)
 *   wrapStyle: "wrap"|"branch"|null,
 * }
 * ========================================================================= */
"use strict";

const Canvas = {
  el: null, ctx: null, img: null,
  tool: "straight",          // straight | curve | bushes | shrubs | eraser
  lightType: "c9",
  drag: null,                // in-progress drag
  undoStack: [],
  addonDrag: null,
  markCounter: 0,
};

function initCanvas() {
  Canvas.el = document.getElementById("markup-canvas");
  Canvas.ctx = Canvas.el.getContext("2d");

  // color scheme radios + sequence builder
  renderColorSchemes();
  renderLightTypes();
  renderToolButtons();
  renderAddonPicker();

  const c = Canvas.el;
  c.addEventListener("pointerdown", onPointerDown);
  c.addEventListener("pointermove", onPointerMove);
  c.addEventListener("pointerup", onPointerUp);
  c.addEventListener("pointercancel", () => { Canvas.drag = null; Canvas.addonDrag = null; });

  document.getElementById("btn-undo").addEventListener("click", undoMark);
  document.getElementById("btn-clear").addEventListener("click", () => {
    if (!project.marks.length || confirm("Clear all marks?")) {
      pushUndo();
      project.marks = [];
      touchMarks(); redraw();
    }
  });

  window.addEventListener("photo-changed", loadPhoto);
  window.addEventListener("project-loaded", () => { loadPhoto(); renderColorSchemes(); });
  window.addEventListener("marks-changed", redraw);
}

function loadPhoto() {
  const wrap = document.getElementById("canvas-wrap");
  if (!project.photo) {
    wrap.classList.add("empty");
    Canvas.img = null;
    return;
  }
  const img = new Image();
  img.onload = () => {
    Canvas.img = img;
    wrap.classList.remove("empty");
    // Display size fits container; internal resolution = native photo pixels
    Canvas.el.width = img.naturalWidth;
    Canvas.el.height = img.naturalHeight;
    redraw();
  };
  img.src = project.photo;
}

/* ---------------- UI builders ---------------- */

function renderColorSchemes() {
  const host = document.getElementById("color-schemes");
  host.innerHTML = LIGHT_COLORS.map((c) => `
    <label class="scheme ${project.colorScheme === c.id ? "sel" : ""}" data-id="${c.id}">
      <input type="radio" name="scheme" value="${c.id}" ${project.colorScheme === c.id ? "checked" : ""}>
      <b>${c.label}</b><small>${c.desc}</small>
    </label>`).join("");
  host.querySelectorAll("input").forEach((r) =>
    r.addEventListener("change", () => {
      project.colorScheme = r.value;
      document.getElementById("sequence-builder").style.display = r.value === "custom" ? "" : "none";
      host.querySelectorAll(".scheme").forEach((s) => s.classList.toggle("sel", s.dataset.id === r.value));
      scheduleSave();
    })
  );
  // sequence builder: click swatches in order, up to 4, ordered removable chips
  const sb = document.getElementById("sequence-builder");
  sb.style.display = project.colorScheme === "custom" ? "" : "none";
  sb.innerHTML = `
    <div class="seq-swatches">${SEQUENCE_SWATCHES.map((s) =>
      `<button class="swatch" data-id="${s.id}" title="${s.label}" style="background:${s.hex}"></button>`).join("")}
    </div>
    <div class="seq-chips" id="seq-chips"></div>
    <small>Click colors in order (max 4). Cool White → Red gives a white-red-white-red strand. Upcharge set in Pricing Guide.</small>`;
  sb.querySelectorAll(".swatch").forEach((b) =>
    b.addEventListener("click", () => {
      if (project.customSequence.length >= 4) return;
      project.customSequence.push(b.dataset.id);
      renderSeqChips(); scheduleSave();
    })
  );
  renderSeqChips();
}

function renderSeqChips() {
  const host = document.getElementById("seq-chips");
  if (!host) return;
  host.innerHTML = project.customSequence.map((id, i) => {
    const s = SEQUENCE_SWATCHES.find((x) => x.id === id);
    return `<span class="chip" style="--c:${s.hex}">${i + 1}. ${s.label}<button data-i="${i}">✕</button></span>`;
  }).join("") || "<em>No colors chosen yet</em>";
  host.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      project.customSequence.splice(+b.dataset.i, 1);
      renderSeqChips(); scheduleSave();
    })
  );
}

function renderLightTypes() {
  const host = document.getElementById("light-types");
  host.innerHTML = LIGHT_TYPES.map((t) => `
    <button class="light-type ${Canvas.lightType === t.id ? "sel" : ""}" data-id="${t.id}">
      <span class="dot" style="background:${t.marker}"></span>
      <b>${t.label}</b><small>${t.desc}</small>
    </button>`).join("");
  host.querySelectorAll(".light-type").forEach((b) =>
    b.addEventListener("click", () => {
      Canvas.lightType = b.dataset.id;
      host.querySelectorAll(".light-type").forEach((x) => x.classList.toggle("sel", x.dataset.id === Canvas.lightType));
    })
  );
}

const TOOLS = [
  { id: "straight", label: "Straight", hint: "Click-drag A→B — rooflines, ridges, walkways" },
  { id: "curve",    label: "Curve",    hint: "A→B with a soft wave — draped runs" },
  { id: "bushes",   label: "Bushes",   hint: "Drag a rectangle — everything inside gets lit" },
  { id: "shrubs",   label: "Shrubs",   hint: "Rectangle for greenery" },
  { id: "eraser",   label: "Eraser",   hint: "Click a mark to remove it" },
];

function renderToolButtons() {
  const host = document.getElementById("draw-tools");
  host.innerHTML = TOOLS.map((t) =>
    `<button class="tool ${Canvas.tool === t.id ? "sel" : ""}" data-id="${t.id}" title="${t.hint}">${t.label}</button>`).join("");
  host.querySelectorAll(".tool").forEach((b) =>
    b.addEventListener("click", () => {
      Canvas.tool = b.dataset.id;
      host.querySelectorAll(".tool").forEach((x) => x.classList.toggle("sel", x.dataset.id === Canvas.tool));
    })
  );
}

function renderAddonPicker() {
  const sel = document.getElementById("addon-select");
  sel.innerHTML = ADDONS.map((a) => `<option value="${a.id}">${a.label}</option>`).join("");
  document.getElementById("addon-add").addEventListener("click", () => {
    if (!Canvas.img) { alert("Import or upload a photo first."); return; }
    pushUndo();
    const a = ADDONS.find((x) => x.id === sel.value);
    project.marks.push({
      id: nextMarkId(),
      kind: "addon",
      addonId: a.id,
      rect: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 },
      zoneLabel: a.label,
      source: "manual",
      confidence: null,
      included: true,
      wrapStyle: a.isWrapDesign ? "wrap" : null,
    });
    touchMarks();
  });
}

function nextMarkId() {
  Canvas.markCounter++;
  const used = new Set(project.marks.map((m) => m.id));
  let id;
  do { id = "mark_" + String(Canvas.markCounter).padStart(2, "0"); Canvas.markCounter++; }
  while (used.has(id));
  return id;
}

/* ---------------- pointer handling ---------------- */

function canvasPoint(e) {
  const r = Canvas.el.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
    y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
  };
}

function onPointerDown(e) {
  if (!Canvas.img) return;
  Canvas.el.setPointerCapture(e.pointerId);
  const p = canvasPoint(e);

  // 1) addon interactions first: ✕ delete, corner resize, body drag
  const hit = hitAddon(p);
  if (hit) {
    if (hit.zone === "delete") {
      pushUndo();
      project.marks = project.marks.filter((m) => m.id !== hit.mark.id);
      touchMarks(); return;
    }
    Canvas.addonDrag = { mark: hit.mark, zone: hit.zone, start: p, orig: { ...hit.mark.rect } };
    return;
  }

  if (Canvas.tool === "eraser") {
    const m = nearestMark(p, 0.02);
    if (m) { pushUndo(); project.marks = project.marks.filter((x) => x.id !== m.id); touchMarks(); }
    return;
  }

  Canvas.drag = { start: p, cur: p };
}

function onPointerMove(e) {
  if (!Canvas.img) return;
  const p = canvasPoint(e);
  if (Canvas.addonDrag) {
    const d = Canvas.addonDrag;
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    if (d.zone === "move") {
      d.mark.rect.x = Math.min(0.98, Math.max(0, d.orig.x + dx));
      d.mark.rect.y = Math.min(0.98, Math.max(0, d.orig.y + dy));
    } else { // resize via corner handle
      d.mark.rect.w = Math.max(0.03, d.orig.w + dx);
      d.mark.rect.h = Math.max(0.03, d.orig.h + dy);
    }
    redraw();
    return;
  }
  if (Canvas.drag) { Canvas.drag.cur = p; redraw(); }
}

function onPointerUp() {
  if (Canvas.addonDrag) { Canvas.addonDrag = null; touchMarks(); return; }
  if (!Canvas.drag) return;
  const { start, cur } = Canvas.drag;
  Canvas.drag = null;
  const dist = Math.hypot(cur.x - start.x, cur.y - start.y);
  if (dist < 0.01) { redraw(); return; } // too small — ignore

  pushUndo();
  if (Canvas.tool === "straight" || Canvas.tool === "curve") {
    project.marks.push({
      id: nextMarkId(),
      kind: Canvas.tool === "curve" ? "curve" : "line",
      lightType: Canvas.lightType,
      a: start, b: cur,
      zoneLabel: guessZoneLabel(start, cur),
      source: "manual", confidence: null, included: true, wrapStyle: null,
    });
  } else if (Canvas.tool === "bushes" || Canvas.tool === "shrubs") {
    project.marks.push({
      id: nextMarkId(),
      kind: "area",
      areaKind: Canvas.tool === "bushes" ? "bush" : "shrub",
      lightType: Canvas.lightType,
      rect: normRect(start, cur),
      zoneLabel: Canvas.tool === "bushes" ? "bush" : "shrub",
      source: "manual", confidence: null, included: true,
      wrapStyle: "wrap", sizeClass: "medium",
    });
  }
  touchMarks();
}

const normRect = (a, b) => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
  w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
});

/* Zone label is a LABEL only — never a placement instruction (Rule 4). */
function guessZoneLabel(a, b) {
  const midY = (a.y + b.y) / 2;
  const slope = Math.abs(b.y - a.y) / Math.max(0.001, Math.abs(b.x - a.x));
  if (midY > 0.75) return "ground run";
  if (slope > 0.4) return "rake / gable edge";
  if (midY < 0.45) return "roofline run";
  return "run";
}

/* ---------------- hit testing ---------------- */

function hitAddon(p) {
  // topmost first
  for (let i = project.marks.length - 1; i >= 0; i--) {
    const m = project.marks[i];
    if (m.kind !== "addon") continue;
    const r = m.rect, pad = 0.02;
    // delete ✕ at top-right
    if (Math.hypot(p.x - (r.x + r.w), p.y - r.y) < pad) return { mark: m, zone: "delete" };
    // resize handle bottom-right
    if (Math.hypot(p.x - (r.x + r.w), p.y - (r.y + r.h)) < pad) return { mark: m, zone: "resize" };
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return { mark: m, zone: "move" };
  }
  return null;
}

function nearestMark(p, tol) {
  let best = null, bestD = tol;
  for (const m of project.marks) {
    let d = Infinity;
    if (m.kind === "line" || m.kind === "curve") d = pointToSegment(p, m.a, m.b);
    else if (m.kind === "area" || m.kind === "addon") {
      const r = m.rect;
      const inX = p.x >= r.x - tol && p.x <= r.x + r.w + tol;
      const inY = p.y >= r.y - tol && p.y <= r.y + r.h + tol;
      if (inX && inY) d = 0;
    }
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

function pointToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/* ---------------- undo ---------------- */

function pushUndo() {
  Canvas.undoStack.push(JSON.stringify(project.marks));
  if (Canvas.undoStack.length > 50) Canvas.undoStack.shift();
}
function undoMark() {
  const prev = Canvas.undoStack.pop();
  if (prev === undefined) return;
  project.marks = JSON.parse(prev);
  touchMarks();
}

/* ---------------- rendering (HUMAN preview — pretty version) ----------------
 * The dotted/pretty preview is for the human ONLY. The AI-facing markup map
 * (10-mockup.js) renders clean washes + outlines instead (Rule 3). */

function redraw() {
  const ctx = Canvas.ctx;
  if (!Canvas.img) return;
  const W = Canvas.el.width, H = Canvas.el.height;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(Canvas.img, 0, 0, W, H);

  for (const m of project.marks) drawMark(ctx, m, W, H);

  // in-progress drag ghost
  if (Canvas.drag) {
    const { start, cur } = Canvas.drag;
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = markerColor(Canvas.lightType);
    ctx.lineWidth = Math.max(2, W / 300);
    if (Canvas.tool === "bushes" || Canvas.tool === "shrubs") {
      const r = normRect(start, cur);
      ctx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H);
    } else {
      ctx.beginPath();
      ctx.moveTo(start.x * W, start.y * H);
      ctx.lineTo(cur.x * W, cur.y * H);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function markerColor(lightType) {
  return (LIGHT_TYPES.find((t) => t.id === lightType) || LIGHT_TYPES[0]).marker;
}

function drawMark(ctx, m, W, H) {
  ctx.save();
  const lw = Math.max(2.5, W / 260);
  const excluded = m.included === false;
  ctx.globalAlpha = excluded ? 0.35 : 1;

  if (m.kind === "line" || m.kind === "curve") {
    ctx.strokeStyle = markerColor(m.lightType);
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    ctx.beginPath();
    if (m.kind === "line") {
      ctx.moveTo(m.a.x * W, m.a.y * H);
      ctx.lineTo(m.b.x * W, m.b.y * H);
    } else {
      drawWave(ctx, m.a, m.b, W, H);
    }
    ctx.stroke();
    // bulb dots along the run (human preview only)
    drawBulbDots(ctx, m, W, H);
  } else if (m.kind === "area") {
    ctx.strokeStyle = markerColor(m.lightType);
    ctx.setLineDash([10, 6]);
    ctx.lineWidth = lw;
    const r = m.rect;
    ctx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H);
    ctx.setLineDash([]);
    // sparkle dots inside (human preview only — NEVER sent to AI, Rule 3)
    ctx.fillStyle = markerColor(m.lightType);
    const step = Math.max(14, W / 60);
    for (let x = r.x * W + step / 2; x < (r.x + r.w) * W; x += step)
      for (let y = r.y * H + step / 2; y < (r.y + r.h) * H; y += step)
        ctx.fillRect(x, y, 2.5, 2.5);
  } else if (m.kind === "addon") {
    const a = ADDONS.find((x) => x.id === m.addonId);
    const r = m.rect;
    ctx.strokeStyle = "#ffcc33";
    ctx.lineWidth = lw;
    ctx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H);
    ctx.font = `${Math.max(16, r.h * H * 0.5)}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffcc33";
    ctx.fillText(a?.glyph || "?", (r.x + r.w / 2) * W, (r.y + r.h / 2) * H);
    ctx.font = `${Math.max(11, W / 90)}px system-ui`;
    ctx.fillText(a?.label || m.addonId, (r.x + r.w / 2) * W, (r.y + r.h) * H + 14);
    // handles: ✕ delete (top-right), resize (bottom-right)
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc((r.x + r.w) * W, r.y * H, 9, 0, 7); ctx.fill();
    ctx.fillStyle = "#c62828";
    ctx.font = "12px system-ui";
    ctx.fillText("✕", (r.x + r.w) * W, r.y * H + 1);
    ctx.fillStyle = "#ffcc33";
    ctx.fillRect((r.x + r.w) * W - 6, (r.y + r.h) * H - 6, 12, 12);
  }

  // confidence badge for detected marks
  if (m.source === "detected" && m.confidence != null) {
    const pt = m.kind === "addon" || m.kind === "area"
      ? { x: m.rect.x, y: m.rect.y }
      : m.a;
    const pct = Math.round(m.confidence * 100);
    const low = m.confidence < 0.6;
    ctx.globalAlpha = 1;
    ctx.fillStyle = low ? "#ff9800" : "#4caf50";
    const bx = pt.x * W, by = pt.y * H - 10;
    ctx.fillRect(bx, by - 12, low ? 64 : 40, 15);
    ctx.fillStyle = "#000";
    ctx.font = "11px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(low ? `${pct}% verify` : `${pct}%`, bx + 3, by - 1);
  }
  ctx.restore();
}

function drawWave(ctx, a, b, W, H) {
  const segs = 24;
  const dx = (b.x - a.x), dy = (b.y - a.y);
  const len = Math.hypot(dx * W, dy * H);
  const amp = Math.min(14, len / 18);
  const nx = -dy / Math.hypot(dx, dy) || 0, ny = dx / Math.hypot(dx, dy) || 0;
  ctx.moveTo(a.x * W, a.y * H);
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const wob = Math.sin(t * Math.PI * 4) * amp;
    ctx.lineTo((a.x + dx * t) * W + nx * wob, (a.y + dy * t) * H + ny * wob);
  }
}

function drawBulbDots(ctx, m, W, H) {
  const len = Math.hypot((m.b.x - m.a.x) * W, (m.b.y - m.a.y) * H);
  const n = Math.max(2, Math.floor(len / Math.max(10, W / 70)));
  ctx.fillStyle = "#fff";
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    ctx.beginPath();
    ctx.arc((m.a.x + (m.b.x - m.a.x) * t) * W, (m.a.y + (m.b.y - m.a.y) * t) * H, Math.max(1.5, W / 500), 0, 7);
    ctx.fill();
  }
}

/* Pixel length of a mark in normalized units → used by measurement estimates */
function markPixelLength(m, W, H) {
  if (m.kind === "line") return Math.hypot((m.b.x - m.a.x) * W, (m.b.y - m.a.y) * H);
  if (m.kind === "curve") return Math.hypot((m.b.x - m.a.x) * W, (m.b.y - m.a.y) * H) * 1.15;
  return 0;
}
