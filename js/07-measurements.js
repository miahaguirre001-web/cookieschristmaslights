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
    const table = loadPricingConfig().rules.peakHeightTable;
    for (const r of project.measurements) {
      if (r.source !== "AI Estimated") continue;
      if (r.baseWidthFt) {
        // Peak rows: rescale the BASE, then re-derive — otherwise the rake
        // length and its stated base would disagree.
        const p = peakSides(r.baseWidthFt * factor, table);
        r.baseWidthFt = p.base;
        r.value = r.coversBothRakes ? p.total : p.side;
        r.basis = `${p.base} ft base → peak ${p.height} ft → ${r.coversBothRakes ? "both rakes" : "one rake"} ${r.value} ft (calibrated)`;
      } else {
        r.value = Math.round(r.value * factor * 10) / 10;
      }
      r.confidence = Math.min(0.95, r.confidence + 0.15);
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
  initPeakCalc();
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

/* ---- Roof complexity: ONE setting drives every roofline line item ---- */
function renderComplexityPanel() {
  const host = document.getElementById("roof-complexity");
  if (!host) return;
  if (!project.analysis) { host.innerHTML = ""; return; }
  const cur = project.analysis.roofComplexity || "mid";
  const pitch = project.analysis.roofPitchPer12;
  host.innerHTML = `
    <div class="complexity-box">
      <b>Roof complexity</b> — one setting prices every roofline on this house.
      <div class="row">
        ${Object.values(ROOF_COMPLEXITY).map((c) => `
          <button class="cx ${c.key === cur ? "sel" : ""}" data-cx="${c.key}">
            ${c.label}<small>${c.desc}</small>
          </button>`).join("")}
      </div>
      <small>
        ${pitch ? `AI estimated pitch <b>${pitch}/12</b>. ` : ""}
        ${project.analysis.complexityReason ? esc(project.analysis.complexityReason) : ""}
      </small>
    </div>`;
  host.querySelectorAll(".cx").forEach((b) =>
    b.addEventListener("click", () => {
      setRoofComplexity(b.dataset.cx);
    })
  );
}

function setRoofComplexity(key) {
  if (!ROOF_COMPLEXITY[key] || !project.analysis) return;
  project.analysis.roofComplexity = key;
  // Re-map every roofline-priced row so the house can't be easy AND hard
  for (const r of project.measurements) {
    if (ROOFLINE_ZONE_KINDS.has(r.zoneKind)) {
      r.itemKey = itemKeyForZone(r.zoneKind, key);
    }
  }
  scheduleSave();
  renderMeasurements();
  window.dispatchEvent(new CustomEvent("measurements-changed"));
}

/* ---- Peak calculator: base width → rake lengths ---- */
function initPeakCalc() {
  const calc = () => {
    const base = parseFloat(document.getElementById("peak-base").value);
    const out = document.getElementById("peak-out");
    if (!(base > 0)) { out.innerHTML = `<small>Enter the gable's base width.</small>`; return; }
    const p = peakSides(base, loadPricingConfig().rules.peakHeightTable);
    out.innerHTML = `
      <div class="peak-metrics">
        <div><span>Peak height</span><b>${p.height} ft</b></div>
        <div><span>Each rake side</span><b class="gold">${p.side} ft</b></div>
        <div><span>Both sides</span><b class="gold">${p.total} ft</b></div>
        <div><span>Implied pitch</span><b>${p.pitchPer12}/12</b></div>
      </div>
      <small>side = √((base ÷ 2)² + height²) · height from the peak table in the Pricing Guide</small>`;
  };
  document.getElementById("peak-base").addEventListener("input", calc);
  document.getElementById("peak-add").addEventListener("click", () => {
    const base = parseFloat(document.getElementById("peak-base").value);
    if (!(base > 0)) { alert("Enter a base width first."); return; }
    const both = document.getElementById("peak-both").checked;
    const p = peakSides(base, loadPricingConfig().rules.peakHeightTable);
    const complexity = project.analysis?.roofComplexity || "mid";
    project.measurements.push({
      id: "meas_peak_" + Date.now(),
      markId: null,
      zoneKind: "rake",
      zoneLabel: document.getElementById("peak-label").value.trim() || "gable rake",
      itemKey: itemKeyForZone("rake", complexity),
      value: both ? p.total : p.side,
      baseWidthFt: p.base,
      coversBothRakes: both,
      unit: "lf",
      source: "User Entered",
      confidence: 1,
      basis: `${p.base} ft base → peak ${p.height} ft → ${both ? "both rakes" : "one rake"} ${both ? p.total : p.side} ft`,
    });
    scheduleSave(); renderMeasurements();
    window.dispatchEvent(new CustomEvent("measurements-changed"));
  });
  calc();
}

function renderMeasurements() {
  renderStaleNotice();
  renderComplexityPanel();
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
          <td>${esc(r.zoneLabel)}${r.sizeClass ? ` <small>(${r.sizeClass})</small>` : ""}${r.baseWidthFt ? ` <small class="peak-tag">peak calc</small>` : ""}</td>
          <td>${esc(cfg.items[r.itemKey]?.label || r.itemKey)}</td>
          <td>${r.baseWidthFt
            ? `<input type="number" step="0.5" class="meas-base" value="${r.baseWidthFt}" title="Gable base width (ft) — rake length is derived from it"><small>base → <b>${r.value}</b> ft</small>`
            : `<input type="number" step="0.5" class="meas-val" value="${r.value}">`}</td>
          <td><select class="meas-src">${SOURCES.map((s) => `<option ${s === r.source ? "selected" : ""}>${s}</option>`).join("")}</select></td>
          <td><span class="conf ${r.confidence < 0.6 ? "low" : ""}">${Math.round(r.confidence * 100)}%</span></td>
          <td><button class="meas-del" title="Remove">✕</button></td>
        </tr>
        ${r.basis ? `<tr class="basis-row"><td colspan="6"><small>↳ ${esc(r.basis)}</small></td></tr>` : ""}`).join("")}
      </tbody>
    </table>`;
  host.querySelectorAll("tr[data-i]").forEach((tr) => {
    const i = +tr.dataset.i;
    const valInput = tr.querySelector(".meas-val");
    if (valInput) valInput.addEventListener("change", (e) => {
      rows[i].value = parseFloat(e.target.value) || 0;
      rows[i].source = "User Entered";
      rows[i].confidence = 1;
      scheduleSave(); renderMeasurements();
      window.dispatchEvent(new CustomEvent("measurements-changed"));
    });
    // Peak rows: editing the BASE re-derives the rake length
    const baseInput = tr.querySelector(".meas-base");
    if (baseInput) baseInput.addEventListener("change", (e) => {
      const base = parseFloat(e.target.value) || 0;
      const p = peakSides(base, loadPricingConfig().rules.peakHeightTable);
      rows[i].baseWidthFt = p.base;
      rows[i].value = rows[i].coversBothRakes ? p.total : p.side;
      rows[i].basis = `${p.base} ft base → peak ${p.height} ft → ${rows[i].coversBothRakes ? "both rakes" : "one rake"} ${rows[i].value} ft`;
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
