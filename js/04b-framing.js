/* =========================================================================
 * 04b-framing.js — FRAMING CONTROL. Centre the customer's house in the shot.
 *
 * WHY RE-AIM INSTEAD OF CROP: cropping a 640px Street View frame throws away
 * most of the pixels and everything downstream is upscaled blur (Rule 10).
 * Street View can be re-shot at any heading/pitch/fov, so panning and zooming
 * fetch a NEW full-resolution 640×640 frame pointed at the house. The house
 * fills more of the frame at full quality — better mock-up AND better
 * measurements, since the AI has more pixels of the actual building.
 *
 * Uploaded photos can't be re-shot, so those fall back to a crop-zoom with an
 * honest resolution warning.
 * ========================================================================= */
"use strict";

const Framing = {
  heading: null,     // degrees, null = Google's default aim
  pitch: 0,          // + looks up
  fov: 80,           // smaller = more zoomed in
  timer: null,
  busy: false,
  baseHeading: null, // the auto-computed house bearing, for Reset
};

const FOV_MIN = 25, FOV_MAX = 110;

function initFraming() {
  const toggle = document.getElementById("frame-toggle");
  if (!toggle) return;

  toggle.addEventListener("click", () => {
    const box = document.getElementById("frame-box");
    const open = box.style.display === "none";
    box.style.display = open ? "" : "none";
    toggle.textContent = open ? "Close framing controls" : "📐 Adjust framing — centre the house";
    if (open) syncFramingFromProject();
  });

  document.querySelectorAll("[data-frame]").forEach((b) =>
    b.addEventListener("click", () => applyFrameStep(b.dataset.frame))
  );
  document.getElementById("frame-reset").addEventListener("click", () => {
    Framing.heading = Framing.baseHeading;
    Framing.pitch = 0;
    Framing.fov = 80;
    requestFrame();
  });

  window.addEventListener("project-loaded", syncFramingFromProject);
  window.addEventListener("photo-changed", renderFramingState);
}

function syncFramingFromProject() {
  const f = project.framing || {};
  Framing.heading = f.heading ?? project.baseHeading ?? null;
  Framing.pitch = f.pitch ?? 0;
  Framing.fov = f.fov ?? 80;
  Framing.baseHeading = project.baseHeading ?? f.heading ?? null;
  renderFramingState();
}

function applyFrameStep(kind) {
  const STEP_DEG = 8;          // pan/tilt increment
  const ZOOM_STEP = 12;        // fov increment
  if (Framing.heading === null) Framing.heading = project.baseHeading ?? 0;
  switch (kind) {
    case "left":  Framing.heading = (Framing.heading - STEP_DEG + 360) % 360; break;
    case "right": Framing.heading = (Framing.heading + STEP_DEG) % 360; break;
    case "up":    Framing.pitch = Math.min(35, Framing.pitch + 5); break;
    case "down":  Framing.pitch = Math.max(-35, Framing.pitch - 5); break;
    case "in":    Framing.fov = Math.max(FOV_MIN, Framing.fov - ZOOM_STEP); break;
    case "out":   Framing.fov = Math.min(FOV_MAX, Framing.fov + ZOOM_STEP); break;
    default: return;
  }
  requestFrame();
}

/* Debounced so holding down a button doesn't fire a fetch per click. */
function requestFrame() {
  renderFramingState();
  clearTimeout(Framing.timer);
  Framing.timer = setTimeout(fetchFramedPhoto, 350);
}

async function fetchFramedPhoto() {
  const status = document.getElementById("frame-status");
  if (project.photoSource !== "streetview") {
    applyCropZoom();
    return;
  }
  if (!project.lat || !project.lng) {
    setStatus(status, "Find the address first so the camera can be re-aimed.", "warn");
    return;
  }
  if (Framing.busy) return;

  // Re-framing invalidates marks drawn on the old view — they're stored in
  // image coordinates, so they'd land in the wrong place.
  if (!confirmFramingLoss()) return;

  Framing.busy = true;
  setStatus(status, "Re-aiming camera…");
  try {
    const url = await fetchStreetView(project.lat, project.lng, {
      heading: Framing.heading,
      pitch: Framing.pitch,
      fov: Framing.fov,
    });
    project.framing = { heading: Framing.heading, pitch: Framing.pitch, fov: Framing.fov };
    await setProjectPhoto(url, "streetview");
    setStatus(status, `Re-framed (${Math.round(Framing.heading)}° · ${Framing.fov}° view). Full resolution — not a crop.`, "ok");
  } catch (e) {
    setStatus(status, e.message, "warn");
  } finally {
    Framing.busy = false;
    renderFramingState();
  }
}

/* Warn once per framing session if there's work that would be invalidated. */
let _framingWarned = false;
function confirmFramingLoss() {
  const hasWork = project.marks.length || project.targetRegion;
  if (!hasWork || _framingWarned) return true;
  const ok = confirm(
    "Re-framing gives you a new photo, so any marks or target outline drawn on the old view will be cleared.\n\nFrame the house first, then draw. Continue?"
  );
  if (ok) _framingWarned = true;
  return ok;
}

/* Uploaded photos can't be re-shot — crop-zoom instead, and say plainly that
 * this costs resolution (unlike the Street View path). */
function applyCropZoom() {
  const status = document.getElementById("frame-status");
  if (!project.photo) { setStatus(status, "No photo to adjust.", "warn"); return; }
  if (!confirmFramingLoss()) return;
  if (!project.uncroppedPhoto) project.uncroppedPhoto = project.photo;

  const img = new Image();
  img.onload = () => {
    // fov maps to a zoom factor: 80° = full frame, 25° ≈ 3.2× in
    const zoom = 80 / Math.max(FOV_MIN, Framing.fov);
    const sw = img.naturalWidth / zoom, sh = img.naturalHeight / zoom;
    // heading offset pans horizontally, pitch pans vertically
    const panX = ((Framing.heading ?? 0) - (Framing.baseHeading ?? 0)) / 40;
    const panY = -Framing.pitch / 40;
    let sx = (img.naturalWidth - sw) / 2 + panX * sw;
    let sy = (img.naturalHeight - sh) / 2 + panY * sh;
    sx = Math.max(0, Math.min(img.naturalWidth - sw, sx));
    sy = Math.max(0, Math.min(img.naturalHeight - sh, sy));

    const c = document.createElement("canvas");
    c.width = Math.round(sw); c.height = Math.round(sh);
    c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    project.framing = { heading: Framing.heading, pitch: Framing.pitch, fov: Framing.fov, cropped: true };
    setProjectPhoto(c.toDataURL("image/jpeg", 0.95), project.photoSource || "upload");
    setStatus(status,
      zoom > 1.6
        ? `Cropped ${zoom.toFixed(1)}× — this reduces resolution. For best mock-up quality use a Street View photo (re-aimed at full quality) or upload a closer shot.`
        : `Cropped ${zoom.toFixed(1)}×.`,
      zoom > 1.6 ? "warn" : "ok");
    renderFramingState();
  };
  img.src = project.uncroppedPhoto;
}

function renderFramingState() {
  const el = document.getElementById("frame-readout");
  if (!el) return;
  const isSV = project.photoSource === "streetview";
  const zoomPct = Math.round((80 / Framing.fov) * 100);
  el.innerHTML = `
    <small>
      ${isSV
        ? `Aim <b>${Framing.heading === null ? "auto" : Math.round(Framing.heading) + "°"}</b> ·
           tilt <b>${Framing.pitch > 0 ? "+" : ""}${Framing.pitch}°</b> ·
           zoom <b>${zoomPct}%</b> — each change re-shoots at full 640×640, no quality loss.`
        : `Uploaded photo — panning crops instead of re-aiming, which costs resolution. Zoom <b>${zoomPct}%</b>.`}
    </small>`;
  const reset = document.getElementById("frame-reset");
  if (reset) reset.disabled = !!Framing.busy;
}
