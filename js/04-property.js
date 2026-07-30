/* =========================================================================
 * 04-property.js — Section 1: Property intake.
 * "Find" pulls BOTH Street View (house photo) + satellite (roof reference)
 * in one click. Manual upload alternative. NO crop tool (Rule 10), NO
 * upscaling (Rule 9). Uploads kept at high JPEG quality (0.92, max 1920w).
 * ========================================================================= */
"use strict";

function initProperty() {
  const $addr = document.getElementById("prop-address");
  const $find = document.getElementById("prop-find");
  const $sv = document.getElementById("prop-streetview-btn");
  const $sat = document.getElementById("prop-satellite-btn");
  const $upload = document.getElementById("prop-upload");
  const $type = document.getElementById("prop-type");
  const $notes = document.getElementById("prop-notes");
  const $status = document.getElementById("prop-status");

  $addr.addEventListener("change", () => {
    project.address = $addr.value.trim();
    scheduleSave();
  });
  $type.addEventListener("change", () => { project.propertyType = $type.value; scheduleSave(); });
  $notes.addEventListener("input", () => { project.notes = $notes.value; scheduleSave(); });

  async function geocode() {
    const address = $addr.value.trim();
    if (!address) { setStatus($status, "Enter an address first.", "warn"); return null; }
    project.address = address;
    setStatus($status, "Looking up address…");
    const geo = await geocodeAddress(address);
    if (geo.status !== "OK" || !geo.results?.length) {
      setStatus($status, "Address not found — check spelling or upload a photo instead.", "warn");
      return null;
    }
    const best = geo.results[0];
    project.address = best.formatted_address;
    $addr.value = best.formatted_address;
    project.lat = best.geometry.location.lat;
    project.lng = best.geometry.location.lng;
    return best;
  }

  /* One button imports BOTH — Street View becomes the house photo,
     satellite rides along as a roof reference. */
  $find.addEventListener("click", () => withBusy($find, async () => {
    if (!(await geocode())) return;
    setStatus($status, "Pulling Street View + satellite…");

    // Street View metadata tells us the true camera heading toward the house,
    // so the extra angles are offsets from a real bearing rather than guesses.
    let baseHeading = null;
    try {
      const meta = await fetchStreetViewMeta(project.lat, project.lng);
      if (meta.status === "OK" && meta.location) {
        baseHeading = bearingTo(meta.location.lat, meta.location.lng, project.lat, project.lng);
      }
    } catch { /* non-fatal */ }

    const zoom = document.getElementById("prop-sat-zoom")?.value || "20";
    const [sv, sat] = await Promise.allSettled([
      fetchStreetView(project.lat, project.lng, baseHeading != null ? { heading: baseHeading } : {}),
      fetchSatellite(project.lat, project.lng, zoom),
    ]);
    if (sv.status === "fulfilled") await setProjectPhoto(sv.value, "streetview");
    if (sat.status === "fulfilled") { project.satellite = sat.value; project.satelliteZoom = +zoom; }
    renderSatelliteThumb();

    // Extra angles: ±35° from the house-facing bearing. These give the AI
    // depth cues for bushes/trees and reveal side rooflines a single frame
    // can't show. Non-fatal — the main photo is what the workflow needs.
    if (sv.status === "fulfilled" && baseHeading != null) {
      setStatus($status, "Imported. Fetching extra angles…");
      const extras = await Promise.allSettled([
        fetchStreetView(project.lat, project.lng, { heading: (baseHeading + 325) % 360, fov: 90 }),
        fetchStreetView(project.lat, project.lng, { heading: (baseHeading + 35) % 360, fov: 90 }),
      ]);
      project.altViews = extras.filter((r) => r.status === "fulfilled").map((r) => r.value);
    } else {
      project.altViews = [];
    }
    renderAltViews();

    if (sv.status !== "fulfilled") {
      setStatus($status, "No Street View here — upload a photo instead.", "warn");
    } else {
      const n = (project.altViews || []).length;
      setStatus($status, `Imported${n ? ` (+${n} extra angle${n > 1 ? "s" : ""} for depth)` : ""}. Scroll down to design the lights.`, "ok");
    }
    scheduleSave();
  }));

  $sv.addEventListener("click", () => withBusy($sv, async () => {
    if (!project.lat && !(await geocode())) return;
    await setProjectPhoto(await fetchStreetView(project.lat, project.lng), "streetview");
    setStatus($status, "Street View imported.", "ok");
    scheduleSave();
  }));

  $sat.addEventListener("click", () => withBusy($sat, async () => {
    if (!project.lat && !(await geocode())) return;
    const zoom = document.getElementById("prop-sat-zoom")?.value || "20";
    project.satellite = await fetchSatellite(project.lat, project.lng, zoom);
    project.satelliteZoom = +zoom;
    renderSatelliteThumb();
    setStatus($status, `Satellite imported (zoom ${zoom}).`, "ok");
    scheduleSave();
  }));

  $upload.addEventListener("change", async () => {
    const file = $upload.files[0];
    if (!file) return;
    const dataUrl = await readFileAsDataURL(file);
    // High quality resize ONLY if oversized: max width 1920, JPEG q0.92 (Rule 9/13)
    const processed = await capUploadSize(dataUrl, 1920, 0.92);
    await setProjectPhoto(processed, "upload");
    setStatus($status, "Photo uploaded.", "ok");
    scheduleSave();
  });

  window.addEventListener("project-loaded", () => {
    $addr.value = project.address || "";
    $type.value = project.propertyType || "single_family";
    $notes.value = project.notes || "";
    renderSatelliteThumb();
  });
}

async function setProjectPhoto(dataUrl, source) {
  project.photo = dataUrl;
  project.photoSource = source;
  project.marks = [];
  project.analysis = null;
  project.measurements = [];
  project.mockups = [];
  touchMarks();
  window.dispatchEvent(new CustomEvent("photo-changed"));
}

function renderSatelliteThumb() {
  const el = document.getElementById("prop-satellite-thumb");
  el.innerHTML = project.satellite
    ? `<img src="${project.satellite}" alt="Satellite roof reference"><span class="thumb-label">Roof ref · z${project.satelliteZoom || 20}</span>`
    : "";
}

/* Extra Street View angles — click one to make it the working photo. */
function renderAltViews() {
  const el = document.getElementById("prop-alt-views");
  if (!el) return;
  const views = project.altViews || [];
  if (!views.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<small>Extra angles (used for depth; click to switch the working photo):</small><div class="alt-strip">` +
    views.map((v, i) => `<img src="${v}" data-i="${i}" alt="Alternate angle ${i + 1}">`).join("") + `</div>`;
  el.querySelectorAll("img").forEach((im) =>
    im.addEventListener("click", async () => {
      const chosen = views[+im.dataset.i];
      const previous = project.photo;
      await setProjectPhoto(chosen, "streetview");
      // keep the swapped-out frame available as an alternate
      project.altViews = views.map((v, i) => (i === +im.dataset.i ? previous : v));
      renderAltViews();
      scheduleSave();
    })
  );
}

/* Compass bearing from the camera position to the house (degrees, 0 = north) */
function bearingTo(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2), Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

/* Downscale ONLY when wider than maxW; single encode, never repeated. */
function capUploadSize(dataUrl, maxW, quality) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      if (img.width <= maxW) { res(dataUrl); return; }
      const c = document.createElement("canvas");
      c.width = maxW;
      c.height = Math.round((img.height / img.width) * maxW);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL("image/jpeg", quality));
    };
    img.src = dataUrl;
  });
}

/* ---- small UI helpers shared across modules ---- */
function setStatus(el, msg, kind = "") {
  if (!el) return;
  el.textContent = msg;
  el.className = "status " + kind;
}

/* Scrolling must never break a workflow — some browsers/embeds lack
 * smooth scrollIntoView, and a throw here would mask a successful result. */
function scrollToSection(id) {
  try {
    const el = document.getElementById(id);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth" });
    }
  } catch { /* non-fatal */ }
}

async function withBusy(btn, fn) {
  const orig = btn.textContent;
  btn.disabled = true;
  try { await fn(); }
  catch (e) { alert(e.message); }
  finally { btn.disabled = false; btn.textContent = orig; }
}
