/* =========================================================================
 * 07-measurements.js — Section 3: Measurements.
 * ONLY fields for what was actually marked. Every value editable with a
 * source tag + confidence. Calibration box: one real measurement rescales
 * every AI length proportionally (the single highest-value accuracy feature).
 * ========================================================================= */
"use strict";

const SOURCES = ["AI Estimated", "User Entered", "Verified Onsite", "Drive-by"];

function initMeasurements() {
  window.addEventListener("analysis-complete", renderMeasurements);
  window.addEventListener("project-loaded", renderMeasurements);
  window.addEventListener("marks-changed", renderStaleNotice);

  // Calibration — prominent, not buried (recommendation #4)
  const calBtn = document.getElementById("cal-apply");
  calBtn.addEventListener("click", () => {
    const real = parseFloat(document.getElementById("cal-real").value);
    const marked = parseFloat(document.getElementById("cal-ai").value);
    if (!(real > 0) || !(marked > 0)) { alert("Enter both the AI value and the real measurement."); return; }
    const factor = real / marked;
    for (const r of project.measurements) {
      if (r.source === "AI Estimated") {
        r.value = Math.round(r.value * factor * 10) / 10;
        r.confidence = Math.min(0.95, r.confidence + 0.15);
      }
    }
    project.calibration = { realFt: real, aiFt: marked, factor };
    scheduleSave();
    renderMeasurements();
    window.dispatchEvent(new CustomEvent("measurements-changed"));
  });

  // "＋ Add a measurement" drawer
  document.getElementById("meas-add-toggle").addEventListener("click", () => {
    document.getElementById("meas-add-drawer").classList.toggle("open");
  });
  document.getElementById("meas-add-btn").addEventListener("click", () => {
    const label = document.getElementById("meas-add-label").value.trim() || "extra";
    const itemKey = document.getElementById("meas-add-item").value;
    const value = parseFloat(document.getElementById("meas-add-value").value) || 0;
    project.measurements.push({
      id: "meas_extra_" + Date.now(), markId: null, zoneLabel: label, itemKey,
      value, unit: "lf", source: "User Entered", confidence: 1, basis: "manual entry",
    });
    scheduleSave(); renderMeasurements();
    window.dispatchEvent(new CustomEvent("measurements-changed"));
  });

  populateItemSelect(document.getElementById("meas-add-item"));
}

function populateItemSelect(sel) {
  const cfg = loadPricingConfig();
  sel.innerHTML = Object.entries(cfg.items)
    .filter(([, it]) => it.unit === "lf" || it.unit === "strand")
    .map(([k, it]) => `<option value="${k}">${it.label}</option>`).join("");
}

function renderStaleNotice() {
  const el = document.getElementById("stale-notice");
  if (!el) return;
  el.style.display = isAnalysisStale() ? "" : "none";
}

function renderMeasurements() {
  renderStaleNotice();
  const host = document.getElementById("meas-table");
  const rows = project.measurements;
  if (!rows.length) {
    host.innerHTML = `<p class="hint">No measurements yet — mark the design above, then hit <b>Analyze Marked Areas</b>.</p>`;
    renderAnalysisWarnings();
    return;
  }
  const cfg = loadPricingConfig();
  host.innerHTML = `
    <table>
      <thead><tr><th>Zone</th><th>Item</th><th>Length (ft)</th><th>Source</th><th>Conf.</th><th></th></tr></thead>
      <tbody>
      ${rows.map((r, i) => `
        <tr data-i="${i}">
          <td>${esc(r.zoneLabel)}${r.sizeClass ? ` <small>(${r.sizeClass})</small>` : ""}</td>
          <td>${esc(cfg.items[r.itemKey]?.label || r.itemKey)}</td>
          <td><input type="number" step="0.5" class="meas-val" value="${r.value}"></td>
          <td><select class="meas-src">${SOURCES.map((s) => `<option ${s === r.source ? "selected" : ""}>${s}</option>`).join("")}</select></td>
          <td><span class="conf ${r.confidence < 0.6 ? "low" : ""}">${Math.round(r.confidence * 100)}%</span></td>
          <td><button class="meas-del" title="Remove">✕</button></td>
        </tr>
        ${r.basis ? `<tr class="basis-row"><td colspan="6"><small>↳ ${esc(r.basis)}</small></td></tr>` : ""}`).join("")}
      </tbody>
    </table>`;
  host.querySelectorAll("tr[data-i]").forEach((tr) => {
    const i = +tr.dataset.i;
    tr.querySelector(".meas-val").addEventListener("change", (e) => {
      rows[i].value = parseFloat(e.target.value) || 0;
      rows[i].source = "User Entered";
      rows[i].confidence = 1;
      scheduleSave(); renderMeasurements();
      window.dispatchEvent(new CustomEvent("measurements-changed"));
    });
    tr.querySelector(".meas-src").addEventListener("change", (e) => {
      rows[i].source = e.target.value; scheduleSave();
      window.dispatchEvent(new CustomEvent("measurements-changed"));
    });
    tr.querySelector(".meas-del").addEventListener("click", () => {
      rows.splice(i, 1); scheduleSave(); renderMeasurements();
      window.dispatchEvent(new CustomEvent("measurements-changed"));
    });
  });
  renderAnalysisWarnings();
}

function renderAnalysisWarnings() {
  const el = document.getElementById("meas-warnings");
  const w = [...(project.analysis?.warnings || []), ...(project.analysis?.clientWarnings || [])];
  el.innerHTML = w.map((x) => `<div class="warn-line">⚠ ${esc(x)}</div>`).join("");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
