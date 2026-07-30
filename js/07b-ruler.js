/* =========================================================================
 * 07b-ruler.js — SATELLITE RULER. Drag on the satellite image, get exact
 * feet. No AI anywhere in this file: the ground resolution of the tile is
 * known exactly (see satelliteFtPerNorm), so a pixel distance converts to
 * feet by arithmetic. This is the most accurate measurement the tool can
 * produce, and it takes about three seconds.
 *
 * Two uses:
 *   1. "Use as measurement" — send the measured run straight into the
 *      measurements table (source: Verified Onsite-grade satellite measure).
 *   2. "Calibrate from this" — treat it as the known front width and rescale
 *      every AI estimate, replacing the door-height guess.
 * ========================================================================= */
"use strict";

const Ruler = {
  canvas: null, ctx: null, img: null,
  points: [],          // normalized 0–1 click points (polyline: 2+ points)
  dragging: false,
  zoom: 20,            // matches the imported satellite tile
};

function initRuler() {
  Ruler.canvas = document.getElementById("ruler-canvas");
  if (!Ruler.canvas) return;
  Ruler.ctx = Ruler.canvas.getContext("2d");

  Ruler.canvas.addEventListener("pointerdown", rulerDown);
  Ruler.canvas.addEventListener("pointermove", rulerMove);
  Ruler.canvas.addEventListener("pointerup", rulerUp);

  document.getElementById("ruler-clear").addEventListener("click", () => {
    Ruler.points = []; drawRuler(); renderRulerReadout();
  });
  document.getElementById("ruler-use").addEventListener("click", useRulerAsMeasurement);
  document.getElementById("ruler-cal").addEventListener("click", calibrateFromRuler);
  document.getElementById("ruler-toggle").addEventListener("click", () => {
    const box = document.getElementById("ruler-box");
    const open = box.style.display === "none";
    box.style.display = open ? "" : "none";
    if (open) loadRulerImage();
  });

  populateItemSelect(document.getElementById("ruler-item"));
  window.addEventListener("project-loaded", () => { Ruler.points = []; loadRulerImage(); });
  window.addEventListener("photo-changed", loadRulerImage);
}

function loadRulerImage() {
  const box = document.getElementById("ruler-box");
  const warn = document.getElementById("ruler-warn");
  if (!project.satellite) {
    warn.innerHTML = `<div class="warn-banner">No satellite image yet — press <b>Find</b> (or <b>Satellite only</b>) in the Property section to import one.</div>`;
    if (Ruler.canvas) Ruler.canvas.style.display = "none";
    return;
  }
  warn.innerHTML = "";
  Ruler.canvas.style.display = "";
  const img = new Image();
  img.onload = () => {
    Ruler.img = img;
    Ruler.canvas.width = img.naturalWidth;
    Ruler.canvas.height = img.naturalHeight;
    drawRuler();
    renderRulerReadout();
  };
  img.src = project.satellite;
}

function rulerPoint(e) {
  const r = Ruler.canvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
    y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
  };
}

function rulerDown(e) {
  if (!Ruler.img) return;
  Ruler.canvas.setPointerCapture(e.pointerId);
  const p = rulerPoint(e);
  if (e.shiftKey && Ruler.points.length) {
    Ruler.points.push(p);              // shift-click extends a multi-segment run
  } else {
    Ruler.points = [p, p];             // start a fresh drag
    Ruler.dragging = true;
  }
  drawRuler(); renderRulerReadout();
}

function rulerMove(e) {
  if (!Ruler.dragging || !Ruler.img) return;
  Ruler.points[Ruler.points.length - 1] = rulerPoint(e);
  drawRuler(); renderRulerReadout();
}

function rulerUp() { Ruler.dragging = false; }

/* Total length of the drawn polyline, in real feet. Pure arithmetic. */
function rulerLengthFt() {
  if (!project.lat || Ruler.points.length < 2) return 0;
  let ft = 0;
  for (let i = 0; i < Ruler.points.length - 1; i++) {
    ft += satDistFt(Ruler.points[i], Ruler.points[i + 1], project.lat, project.satelliteZoom || 20);
  }
  return Math.round(ft * 10) / 10;
}

function drawRuler() {
  const ctx = Ruler.ctx;
  if (!Ruler.img || !ctx) return;
  const W = Ruler.canvas.width, H = Ruler.canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(Ruler.img, 0, 0, W, H);
  if (Ruler.points.length < 1) return;

  ctx.strokeStyle = "#00e5ff";
  ctx.lineWidth = Math.max(2, W / 300);
  ctx.lineCap = "round";
  ctx.beginPath();
  Ruler.points.forEach((p, i) => (i ? ctx.lineTo(p.x * W, p.y * H) : ctx.moveTo(p.x * W, p.y * H)));
  ctx.stroke();

  ctx.fillStyle = "#00e5ff";
  for (const p of Ruler.points) {
    ctx.beginPath();
    ctx.arc(p.x * W, p.y * H, Math.max(3, W / 160), 0, Math.PI * 2);
    ctx.fill();
  }

  // running total near the last point
  const ft = rulerLengthFt();
  if (ft > 0) {
    const last = Ruler.points[Ruler.points.length - 1];
    const label = `${ft} ft`;
    ctx.font = `bold ${Math.max(13, W / 40)}px system-ui`;
    const tw = ctx.measureText(label).width;
    const bx = Math.min(Math.max(4, last.x * W + 10), W - tw - 12);
    const by = Math.min(Math.max(22, last.y * H - 10), H - 8);
    ctx.fillStyle = "rgba(0,0,0,.75)";
    ctx.fillRect(bx - 5, by - Math.max(15, W / 42), tw + 10, Math.max(20, W / 32));
    ctx.fillStyle = "#00e5ff";
    ctx.fillText(label, bx, by);
  }
}

function renderRulerReadout() {
  const el = document.getElementById("ruler-readout");
  if (!el) return;
  const ft = rulerLengthFt();
  const segs = Math.max(0, Ruler.points.length - 1);
  if (!ft) {
    el.innerHTML = `<small>Drag along a roof edge to measure it. Shift-click to add another segment for runs that turn a corner.</small>`;
    return;
  }
  el.innerHTML = `<b class="ruler-ft">${ft} ft</b> <small>· ${segs} segment${segs > 1 ? "s" : ""} · exact satellite math, no AI estimate</small>`;
}

function useRulerAsMeasurement() {
  const ft = rulerLengthFt();
  if (!ft) { alert("Drag on the satellite image to measure something first."); return; }
  const label = document.getElementById("ruler-label").value.trim() || "satellite-measured run";
  const itemKey = document.getElementById("ruler-item").value;
  const zoneKind = document.getElementById("ruler-zone").value;
  const applyPitch = document.getElementById("ruler-pitch").checked;

  let value = ft, basis = `measured on satellite (${ft} ft, exact scale)`;
  if (applyPitch) {
    const pitch = project.analysis?.roofPitchPer12 || assumedPitch(project.analysis?.roofComplexity);
    const res = applyPitchToPlanLength(ft, SLOPED_ZONE_KINDS.has(zoneKind) ? zoneKind : "rake", pitch);
    if (res.applied) {
      value = res.ft;
      basis += ` · slope ${pitch}/12 → ×${res.factor} (${ft}→${value} ft)`;
    }
  }

  project.measurements.push({
    id: "meas_ruler_" + Date.now(),
    markId: null,
    zoneKind,
    zoneLabel: label,
    itemKey,
    value,
    rawAiValue: null,
    unit: "lf",
    source: "Verified Onsite",     // satellite math is as good as a tape read
    imageSource: "satellite",
    confidence: 0.97,
    basis,
    measuredDirect: true,
    pitchApplied: applyPitch ? true : undefined,
  });
  scheduleSave();
  renderMeasurements();
  window.dispatchEvent(new CustomEvent("measurements-changed"));
  setStatus(document.getElementById("ruler-status"), `Added "${label}" — ${value} ft. This row is exact and won't be rescaled by calibration.`, "ok");
}

function calibrateFromRuler() {
  const ft = rulerLengthFt();
  if (!ft) { alert("Measure the building's front width on the satellite first."); return; }
  const aiFront = project.analysis?.houseFrontWidthFt;
  if (!(aiFront > 0)) {
    alert("Run Analyze Marked Areas first — calibration needs an AI estimate to compare against.");
    return;
  }
  const factor = calibrationFactorFrom(ft, aiFront);
  if (factor === null) {
    alert(`Measured ${ft} ft vs AI estimate ${aiFront} ft — that's too far apart to apply safely. Check you measured the full front wall.`);
    return;
  }
  applyCalibrationFactor(factor, "ruler");
  project.calibration = { source: "ruler", factor, realFt: ft, aiFt: aiFront };
  if (project.analysis) {
    project.analysis.satCheck = {
      satFrontFt: ft, aiFrontFt: Math.round(aiFront * 10) / 10,
      confidence: 0.97, factor, applied: true, byRuler: true,
    };
  }
  scheduleSave();
  renderMeasurements();
  window.dispatchEvent(new CustomEvent("measurements-changed"));
  setStatus(document.getElementById("ruler-status"), `Calibrated ×${factor} from your ${ft} ft measurement — all AI estimates rescaled.`, "ok");
}
