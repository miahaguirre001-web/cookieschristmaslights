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
  { id: "target", label: "🎯 Target house", hint: "Circle the customer's house so the AI ignores the neighbours" },
  { id: "straight", label: "Straight", hint: "Click-drag A→B — rooflines, ridges, walkways" },
  { id: "curve",    label: "Curve",    hint: "A→B with a soft wave — draped runs" },
  { id: "bushes",   label: "Bushes",   hint: "Drag a rectangle — everything inside gets lit (mini lights)" },
  { id: "shrubs",   label: "Shrubs",   hint: "Rectangle for greenery (mini lights)" },
  { id: "trees",    label: "🌳 Tree",  hint: "Box ONLY the part of the tree to light — trunk, or trunk + branches" },
  { id: "wall",     label: "🧱 Wall of lights", hint: "Drag over a building face for a dense fill of lights" },
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
      renderToolOptions();
    })
  );
  renderToolOptions();
}

/* Contextual options for the selected tool (tree wrap style, wall density). */
function renderToolOptions() {
  const host = document.getElementById("tool-options");
  if (!host) return;
  if (Canvas.tool === "trees") {
    host.innerHTML = `
      <label>Wrap style
        <select id="tool-tree-style">${TREE_WRAP_STYLES.map((s) =>
          `<option value="${s.id}" ${s.id === (Canvas.treeStyle || DEFAULT_TREE_STYLE) ? "selected" : ""}>${s.label}</option>`).join("")}
        </select>
      </label>
      <small>Box only the part you'll light — just the trunk, or the trunk and limbs. Trees are always <b>mini lights</b>; the colour follows the scheme above.</small>`;
    document.getElementById("tool-tree-style").addEventListener("change", (e) => {
      Canvas.treeStyle = e.target.value;
    });
  } else if (Canvas.tool === "wall") {
    host.innerHTML = `
      <label>Density
        <select id="tool-wall-gap">
          <option value="tight">Tight — dense wall</option>
          <option value="standard" selected>Standard</option>
          <option value="wide">Wide — sparse</option>
        </select>
      </label>
      <small>Drag across the face you want covered (roof face, fascia, wall). Density sets how many strands the fill needs.</small>`;
    document.getElementById("tool-wall-gap").addEventListener("change", (e) => {
      Canvas.wallGap = e.target.value;
    });
  } else if (Canvas.tool === "bushes" || Canvas.tool === "shrubs") {
    host.innerHTML = `<small>Bushes and shrubs are always <b>mini lights</b> — only the colour scheme changes them.</small>`;
  } else {
    host.innerHTML = "";
  }
}

function renderAddonPicker() {
  const sel = document.getElementById("addon-select");
  sel.innerHTML = ADDONS.map((a) => `<option value="${a.id}">${a.label}</option>`).join("");

  const sizeSel = document.getElementById("addon-size");
  sizeSel.innerHTML = WREATH_SIZES.map((s) =>
    `<option value="${s.id}" ${s.id === DEFAULT_WREATH_SIZE ? "selected" : ""}>${s.label}</option>`).join("");

  const syncSizeVisibility = () => {
    const wrap = document.getElementById("addon-size-wrap");
    wrap.style.display = isWreath(sel.value) ? "" : "none";
  };
  sel.addEventListener("change", syncSizeVisibility);
  syncSizeVisibility();

  document.getElementById("addon-add").addEventListener("click", () => {
    if (!Canvas.img) { alert("Import or upload a photo first."); return; }
    pushUndo();
    const a = ADDONS.find((x) => x.id === sel.value);
    const size = isWreath(a.id) ? sizeSel.value : null;
    // bigger wreaths are drawn bigger, so the mock-up reflects the real size
    const base = 0.09;
    const scale = size ? (WREATH_SIZES.find((s) => s.id === size)?.relScale || 1) : 1;
    const dim = base * scale;
    project.marks.push({
      id: nextMarkId(),
      kind: "addon",
      addonId: a.id,
      addonSize: size,
      rect: { x: 0.45, y: 0.45, w: dim, h: dim },
      zoneLabel: size ? `${a.label} ${WREATH_SIZES.find((s) => s.id === size).label}` : a.label,
      source: "manual",
      confidence: null,
      included: true,
      wrapStyle: a.isWrapDesign ? "wrap" : null,
    });
    touchMarks();
  });

  window.addEventListener("marks-changed", renderAddonList);
  window.addEventListener("project-loaded", renderAddonList);
  renderAddonList();
}

/* Placed add-ons list — lets the estimator change a wreath's size AFTER
 * placing it, which is what actually changes the price. */
function renderAddonList() {
  const host = document.getElementById("addon-list");
  if (!host) return;
  const addons = project.marks.filter((m) => m.kind === "addon");
  if (!addons.length) { host.innerHTML = ""; return; }
  const cfg = loadPricingConfig();
  host.innerHTML = `<div class="addon-list-head">Placed add-ons</div>` + addons.map((m) => {
    const a = ADDONS.find((x) => x.id === m.addonId);
    const key = addonPriceItem(m);
    const rate = cfg.items[key]?.rate;
    return `<div class="addon-row" data-id="${m.id}">
      <span>${esc(a?.label || m.addonId)}</span>
      ${isWreath(m.addonId)
        ? `<select class="addon-row-size">${WREATH_SIZES.map((s) =>
            `<option value="${s.id}" ${s.id === (m.addonSize || DEFAULT_WREATH_SIZE) ? "selected" : ""}>${s.label}</option>`).join("")}</select>`
        : `<span class="hint">—</span>`}
      <span class="addon-rate">${rate == null ? "<b class='conf low'>SET PRICE</b>" : "$" + rate.toFixed(2)}</span>
      <button class="addon-row-del secondary">✕</button>
    </div>`;
  }).join("");

  host.querySelectorAll(".addon-row").forEach((row) => {
    const m = project.marks.find((x) => x.id === row.dataset.id);
    const sizeSel = row.querySelector(".addon-row-size");
    if (sizeSel) sizeSel.addEventListener("change", () => {
      pushUndo();
      m.addonSize = sizeSel.value;
      const s = WREATH_SIZES.find((x) => x.id === sizeSel.value);
      const a = ADDONS.find((x) => x.id === m.addonId);
      m.zoneLabel = `${a.label} ${s.label}`;
      // resize the drawn wreath so 60" looks bigger than 36"
      const cx = m.rect.x + m.rect.w / 2, cy = m.rect.y + m.rect.h / 2;
      const dim = 0.09 * s.relScale;
      m.rect = { x: cx - dim / 2, y: cy - dim / 2, w: dim, h: dim };
      touchMarks();
      window.dispatchEvent(new CustomEvent("measurements-changed"));
    });
    row.querySelector(".addon-row-del").addEventListener("click", () => {
      pushUndo();
      project.marks = project.marks.filter((x) => x.id !== m.id);
      touchMarks();
      window.dispatchEvent(new CustomEvent("measurements-changed"));
    });
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

  // Freehand lasso around the target building
  if (Canvas.tool === "target") {
    Canvas.lasso = [p];
    return;
  }

  Canvas.drag = { start: p, cur: p };
}

function onPointerMove(e) {
  if (!Canvas.img) return;
  const p = canvasPoint(e);
  if (Canvas.lasso) {
    const last = Canvas.lasso[Canvas.lasso.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) > 0.004) Canvas.lasso.push(p);
    redraw();
    return;
  }
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
  if (Canvas.lasso) {
    const pts = Canvas.lasso;
    Canvas.lasso = null;
    if (pts.length >= 6) {
      project.targetRegion = { points: pts };
      // Anything already detected outside the target is the neighbour's house
      const before = project.marks.length;
      project.marks = project.marks.filter((m) => m.source !== "detected" || markInTarget(m));
      const dropped = before - project.marks.length;
      touchMarks();
      window.dispatchEvent(new CustomEvent("target-changed", { detail: { dropped } }));
    } else {
      redraw();
    }
    return;
  }
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
      lightType: GREENERY_LIGHT_TYPE,      // greenery is always mini lights
      rect: normRect(start, cur),
      zoneLabel: Canvas.tool === "bushes" ? "bush" : "shrub",
      source: "manual", confidence: null, included: true,
      wrapStyle: "wrap", sizeClass: "medium",
    });
  } else if (Canvas.tool === "trees") {
    // The box marks ONLY the part of the tree that gets lit.
    project.marks.push({
      id: nextMarkId(),
      kind: "area",
      areaKind: "tree",
      lightType: GREENERY_LIGHT_TYPE,      // trees are always mini lights
      rect: normRect(start, cur),
      zoneLabel: "tree",
      source: "manual", confidence: null, included: true,
      wrapStyle: Canvas.treeStyle || DEFAULT_TREE_STYLE,
      spacingKey: "standard",
    });
  } else if (Canvas.tool === "wall") {
    project.marks.push({
      id: nextMarkId(),
      kind: "area",
      areaKind: "wall",
      lightType: Canvas.lightType === "c9" ? "mini" : Canvas.lightType,
      rect: normRect(start, cur),
      zoneLabel: "wall of lights",
      source: "manual", confidence: null, included: true,
      wrapStyle: null,
      spacingKey: Canvas.wallGap || "standard",
      coverage: 1,
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

/* ---- target region helpers ----
 * The lasso defines WHICH BUILDING is the customer's. Everything the AI does
 * is constrained to it, which is what stops a neighbour's roofline being
 * detected, measured, or lit in the mock-up. */

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const hit = (yi > p.y) !== (yj > p.y) &&
      p.x < ((xj - xi) * (p.y - yi)) / ((yj - yi) || 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/* Bounding box of the target, as fractions — used in AI prompts */
function targetBounds() {
  const pts = project.targetRegion?.points;
  if (!pts?.length) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return {
    x: Math.min(...xs), y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

/* Is this mark on the target building? Uses the mark's representative point,
 * with a small tolerance so an eave that runs just past the lasso still counts. */
function markInTarget(m, tol = 0.03) {
  const pts = project.targetRegion?.points;
  if (!pts?.length) return true;              // no target set → nothing filtered
  const probe = [];
  if (m.kind === "line" || m.kind === "curve") {
    probe.push(m.a, m.b, { x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2 });
  } else if (m.rect) {
    const r = m.rect;
    probe.push({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y + r.h });
  }
  if (!probe.length) return true;
  // inside if any probe point is in the polygon, or near it via the bbox
  if (probe.some((q) => pointInPolygon(q, pts))) return true;
  const b = targetBounds();
  return probe.some((q) =>
    q.x >= b.x - tol && q.x <= b.x + b.w + tol &&
    q.y >= b.y - tol && q.y <= b.y + b.h + tol);
}

function clearTargetRegion() {
  project.targetRegion = null;
  touchMarks();
  window.dispatchEvent(new CustomEvent("target-changed", { detail: { dropped: 0 } }));
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

  // Badge placement bookkeeping — prevents the wall of overlapping
  // "50% verify" chips when detection returns many candidates.
  Canvas._badges = [];
  drawTargetRegion(ctx, W, H);
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

/* Target lasso: bright outline + dimming of everything outside it, so the
 * estimator can see at a glance which building the tool is working on. */
function drawTargetRegion(ctx, W, H) {
  const pts = Canvas.lasso || project.targetRegion?.points;
  if (!pts || pts.length < 2) return;
  const live = !!Canvas.lasso;

  const path = new Path2D();
  pts.forEach((p, i) => (i ? path.lineTo(p.x * W, p.y * H) : path.moveTo(p.x * W, p.y * H)));
  if (!live) path.closePath();

  if (!live) {
    // dim everything outside the target
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip(path, "evenodd");
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = "#ffe600";
  ctx.lineWidth = Math.max(3, W / 220);
  ctx.setLineDash(live ? [10, 6] : []);
  ctx.stroke(path);
  ctx.setLineDash([]);
  if (!live) {
    const b = targetBounds();
    ctx.fillStyle = "#ffe600";
    ctx.font = `bold ${Math.max(12, W / 70)}px system-ui`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    const label = "TARGET HOUSE";
    ctx.strokeStyle = "rgba(0,0,0,.8)";
    ctx.lineWidth = 3;
    ctx.strokeText(label, b.x * W, Math.max(16, b.y * H - 6));
    ctx.fillText(label, b.x * W, Math.max(16, b.y * H - 6));
  }
  ctx.restore();
}

function markerColor(lightType) {
  return (LIGHT_TYPES.find((t) => t.id === lightType) || LIGHT_TYPES[0]).marker;
}

function drawMark(ctx, m, W, H) {
  ctx.save();
  const lw = Math.max(2.5, W / 260);
  const excluded = m.included === false;
  // Candidates the estimator hasn't accepted stay faint so they never
  // compete with the actual design.
  ctx.globalAlpha = excluded ? 0.18 : 1;

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
    const r = m.rect;
    const isWall = m.areaKind === "wall";
    const isTree = m.areaKind === "tree";
    ctx.strokeStyle = isWall ? "#ff9800" : isTree ? "#66bb6a" : markerColor(m.lightType);
    ctx.setLineDash(isWall ? [4, 3] : [10, 6]);
    ctx.lineWidth = lw;
    ctx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H);
    ctx.setLineDash([]);
    // Preview dots — human only, NEVER sent to the AI (Rule 3). Wall fills
    // draw a denser grid so a wall reads differently from a bush at a glance.
    ctx.fillStyle = isWall ? "#ffd76a" : markerColor(m.lightType);
    const step = isWall ? Math.max(8, W / 110) : Math.max(14, W / 60);
    for (let x = r.x * W + step / 2; x < (r.x + r.w) * W; x += step)
      for (let y = r.y * H + step / 2; y < (r.y + r.h) * H; y += step)
        ctx.fillRect(x, y, isWall ? 2 : 2.5, isWall ? 2 : 2.5);
    // label the kind + style so the design is readable on the canvas
    const tag = isWall ? `wall · ${m.spacingKey || "standard"}`
      : isTree ? `tree · ${TREE_WRAP_STYLES.find((s) => s.id === m.wrapStyle)?.label || m.wrapStyle || "swirl"}`
      : null;
    if (tag) {
      ctx.font = `bold ${Math.max(10, W / 95)}px system-ui`;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.strokeStyle = "rgba(0,0,0,.8)";
      ctx.lineWidth = 3;
      ctx.strokeText(tag, r.x * W + 3, r.y * H - 3);
      ctx.fillStyle = isWall ? "#ff9800" : "#66bb6a";
      ctx.fillText(tag, r.x * W + 3, r.y * H - 3);
    }
  } else if (m.kind === "addon") {
    const a = ADDONS.find((x) => x.id === m.addonId);
    const r = m.rect;
    const x = r.x * W, y = r.y * H, w = r.w * W, h = r.h * H;

    // Draw the ACTUAL decoration shape so the estimator sees a wreath that
    // looks like a wreath, not a labelled box.
    drawAddonShape(ctx, m.addonId, x, y, w, h);

    // subtle selection frame (not the decoration itself)
    ctx.strokeStyle = "rgba(255,204,51,.55)";
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = Math.max(1, lw * 0.4);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    ctx.font = `${Math.max(11, W / 90)}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffcc33";
    const sizeTag = m.addonSize ? ` ${WREATH_SIZES.find((s) => s.id === m.addonSize)?.label || ""}` : "";
    ctx.fillText((a?.label || m.addonId) + sizeTag, x + w / 2, y + h + 14);
    // handles: ✕ delete (top-right), resize (bottom-right)
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(x + w, y, 9, 0, 7); ctx.fill();
    ctx.fillStyle = "#c62828";
    ctx.font = "bold 12px system-ui";
    ctx.fillText("✕", x + w, y + 1);
    ctx.fillStyle = "#ffcc33";
    ctx.fillRect(x + w - 6, y + h - 6, 12, 12);
  }

  // Confidence badge — INCLUDED detected marks only, de-overlapped, compact.
  // Excluded candidates get no badge at all; their status lives in the list.
  if (m.source === "detected" && m.confidence != null && !excluded) {
    const pt = (m.kind === "addon" || m.kind === "area") ? { x: m.rect.x, y: m.rect.y } : m.a;
    const pct = Math.round(m.confidence * 100);
    const low = m.confidence < 0.6;
    const bw = Math.max(26, W / 26), bh = Math.max(13, W / 55);
    const step = bh + 4;                       // MUST exceed the collision
    const overlaps = (x, y) => (Canvas._badges || []).some((b) =>
      Math.abs(b.x - x) < bw && Math.abs(b.y - y) < bh);   // threshold < step
    let bx = Math.min(Math.max(0, pt.x * W), W - bw);
    let by = Math.min(Math.max(0, pt.y * H - bh - 4), H - bh);
    let placed = !overlaps(bx, by);
    for (let tries = 0; !placed && tries < 20; tries++) {
      by += step;
      if (by > H - bh) break;
      if (!overlaps(bx, by)) placed = true;
    }
    // If it still can't find clear space, skip the badge entirely rather than
    // stacking chips on top of each other — the list below carries the detail.
    if (!placed) { ctx.restore(); return; }
    (Canvas._badges || []).push({ x: bx, y: by });
    ctx.globalAlpha = 1;
    ctx.fillStyle = low ? "#ff9800" : "#4caf50";
    roundRect(ctx, bx, by, bw, bh, 3);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.font = `bold ${Math.max(9, W / 95)}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${pct}%`, bx + bw / 2, by + bh / 2 + 0.5);
  }
  ctx.restore();
}

/* ---------------- add-on vector art ----------------
 * Recognizable shapes drawn to fit the mark's box. These are for the human
 * preview; the AI-facing map still sends clean boxes + [mark_id] labels, and
 * the prompt names the decoration type (Rules 3 & 4 unaffected). */
function drawAddonShape(ctx, id, x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2;
  const R = Math.min(w, h) / 2;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const GREEN = "#1f7a35", GREEN_HI = "#2fb356", RED = "#d81b1b", GOLD = "#f5c542", WARM = "#fff3b0";

  if (id === "wreath_lit" || id === "wreath_unlit") {
    // foliage ring built from overlapping arcs
    ctx.lineWidth = Math.max(3, R * 0.42);
    ctx.strokeStyle = GREEN;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.72, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = Math.max(1.5, R * 0.18);
    ctx.strokeStyle = GREEN_HI;
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.72, a0, a0 + 0.38);
      ctx.stroke();
    }
    if (id === "wreath_lit") {
      // warm bulbs around the ring
      for (let i = 0; i < 14; i++) {
        const a0 = (i / 14) * Math.PI * 2;
        const bx = cx + Math.cos(a0) * R * 0.72, by = cy + Math.sin(a0) * R * 0.72;
        ctx.beginPath();
        ctx.fillStyle = WARM;
        ctx.arc(bx, by, Math.max(1.6, R * 0.11), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    drawBow(ctx, cx, y + h * 0.94, R * 0.75, RED);   // bow at the bottom
  } else if (id === "bow_red" || id === "bow_striped") {
    drawBow(ctx, cx, cy, R * 1.5, id === "bow_striped" ? GOLD : RED, id === "bow_striped");
  } else if (id === "garland") {
    // draped swag with bulbs
    ctx.lineWidth = Math.max(3, h * 0.3);
    ctx.strokeStyle = GREEN;
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.25);
    ctx.quadraticCurveTo(cx, y + h * 1.15, x + w, y + h * 0.25);
    ctx.stroke();
    ctx.lineWidth = Math.max(1.5, h * 0.12);
    ctx.strokeStyle = GREEN_HI;
    ctx.stroke();
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const bx = x + w * t;
      const by = (1 - t) * (1 - t) * (y + h * 0.25) + 2 * (1 - t) * t * (y + h * 1.15) + t * t * (y + h * 0.25);
      ctx.beginPath(); ctx.fillStyle = WARM;
      ctx.arc(bx, by, Math.max(1.5, h * 0.09), 0, Math.PI * 2); ctx.fill();
    }
  } else if (id === "pillar_wrap") {
    // spiral wrap around whatever exists here — no pillar drawn (Rule 7)
    ctx.lineWidth = Math.max(2, w * 0.09);
    ctx.strokeStyle = WARM;
    ctx.globalAlpha = 0.95;
    const turns = 7;
    ctx.beginPath();
    for (let i = 0; i <= turns * 20; i++) {
      const t = i / (turns * 20);
      const px = cx + Math.sin(t * Math.PI * 2 * turns) * (w * 0.42);
      const py = y + h * t;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
    for (let i = 0; i <= turns; i++) {
      const t = i / turns;
      ctx.beginPath(); ctx.fillStyle = GOLD;
      ctx.arc(cx + Math.sin(t * Math.PI * 2 * turns) * (w * 0.42), y + h * t, Math.max(1.5, w * 0.07), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (id === "teardrop") {
    ctx.fillStyle = GREEN;
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.quadraticCurveTo(x + w, cy, cx, y + h);
    ctx.quadraticCurveTo(x, cy, cx, y);
    ctx.fill();
    for (let i = 1; i < 6; i++) {
      ctx.beginPath(); ctx.fillStyle = WARM;
      ctx.arc(cx, y + (h * i) / 6, Math.max(1.4, w * 0.07), 0, Math.PI * 2); ctx.fill();
    }
  } else if (id.startsWith("deer_")) {
    // Only a BUCK has antlers — doe and fawn must not.
    drawDeer(ctx, x, y, w, h, {
      facingLeft: id.endsWith("_l"),
      isBaby: id.includes("baby"),
      hasAntlers: id.includes("buck"),
    });
  } else {
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }
  ctx.restore();
}

function drawBow(ctx, cx, cy, size, color, striped = false) {
  const s = size * 0.5;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,.35)";
  ctx.lineWidth = 1;
  // left loop
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.quadraticCurveTo(cx - s * 1.5, cy - s, cx - s * 1.1, cy);
  ctx.quadraticCurveTo(cx - s * 1.5, cy + s * 0.8, cx, cy);
  ctx.fill(); ctx.stroke();
  // right loop
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.quadraticCurveTo(cx + s * 1.5, cy - s, cx + s * 1.1, cy);
  ctx.quadraticCurveTo(cx + s * 1.5, cy + s * 0.8, cx, cy);
  ctx.fill(); ctx.stroke();
  // tails
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx - s * 0.55, cy + s * 1.5);
  ctx.lineTo(cx - s * 0.12, cy + s * 1.3);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + s * 0.55, cy + s * 1.5);
  ctx.lineTo(cx + s * 0.12, cy + s * 1.3);
  ctx.closePath(); ctx.fill();
  if (striped) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(1, s * 0.16);
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + i * s * 0.5 - s * 0.2, cy - s * 0.45);
      ctx.lineTo(cx + i * s * 0.5 + s * 0.2, cy + s * 0.45);
      ctx.stroke();
    }
  }
  // knot
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(cx, cy, s * 0.3, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

/* Lit wire-frame deer silhouette (warm bulb outline, like the real product) */
function drawDeer(ctx, x, y, w, h, { facingLeft, isBaby, hasAntlers }) {
  ctx.save();
  if (facingLeft) { ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.translate(-x, -y); }
  const bodyTop = y + h * (isBaby ? 0.42 : 0.34);
  const bodyH = h * (isBaby ? 0.3 : 0.32);
  const bodyW = w * 0.62;
  const bx = x + w * 0.06;
  ctx.strokeStyle = "#fff3b0";
  ctx.lineWidth = Math.max(1.8, w * 0.045);
  // body
  ctx.beginPath();
  ctx.ellipse(bx + bodyW / 2, bodyTop + bodyH / 2, bodyW / 2, bodyH / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  // legs
  ctx.beginPath();
  for (const t of [0.2, 0.42, 0.62, 0.84]) {
    ctx.moveTo(bx + bodyW * t, bodyTop + bodyH * 0.85);
    ctx.lineTo(bx + bodyW * t, y + h * 0.97);
  }
  ctx.stroke();
  // neck + head
  const nx = bx + bodyW * 0.92, ny = bodyTop + bodyH * 0.15;
  ctx.beginPath();
  ctx.moveTo(nx, ny);
  ctx.lineTo(x + w * 0.82, y + h * (isBaby ? 0.26 : 0.16));
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x + w * 0.86, y + h * (isBaby ? 0.22 : 0.13), w * 0.09, h * 0.05, -0.4, 0, Math.PI * 2);
  ctx.stroke();
  // antlers — bucks only
  if (hasAntlers) {
    ctx.beginPath();
    const ax = x + w * 0.84, ay = y + h * 0.1;
    ctx.moveTo(ax, ay); ctx.lineTo(ax - w * 0.06, y + h * 0.02);
    ctx.moveTo(ax - w * 0.04, y + h * 0.06); ctx.lineTo(ax - w * 0.13, y + h * 0.04);
    ctx.moveTo(ax, ay); ctx.lineTo(ax + w * 0.07, y + h * 0.01);
    ctx.stroke();
  }
  // bulbs along the body outline
  ctx.fillStyle = "#ffd76a";
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(bx + bodyW / 2 + Math.cos(a0) * bodyW / 2, bodyTop + bodyH / 2 + Math.sin(a0) * bodyH / 2, Math.max(1.2, w * 0.028), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
