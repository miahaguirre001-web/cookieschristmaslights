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
    applyCalibrationFactor(real / marked, "manual");
    project.calibration = { realFt: real, aiFt: marked, factor: real / marked, source: "manual" };
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

/* Rescale every AI-estimated row by a factor. Used by BOTH the manual
 * door-height calibration and the automatic satellite calibration.
 * SAFEGUARD: rows the user has touched (source ≠ "AI Estimated") are never
 * modified — the tool must not silently change reviewed measurements.
 * Plant/tree rows scale their DIMENSIONS, then footage re-derives, so the
 * displayed dimensions and strand math always agree. */
function applyCalibrationFactor(factor, sourceLabel) {
  const rules = loadPricingConfig().rules;
  for (const r of project.measurements) {
    if (r.source !== "AI Estimated") continue;
    if (r.plant) {
      r.plant.widthFt = round1c(r.plant.widthFt * factor);
      r.plant.heightFt = round1c(r.plant.heightFt * factor);
      r.plant.depthFt = round1c(r.plant.depthFt * factor);
      r.value = bushStrandBreakdown(r.plant, rules).footage;
    } else if (r.tree) {
      for (const k of ["heightFt", "trunkHeightFt", "trunkCircumFt", "branchLenFt", "branchCircumFt", "canopyWidthFt"]) {
        if (r.tree[k]) r.tree[k] = round1c(r.tree[k] * factor);
      }
      r.value = treeStrandBreakdown(r.tree, rules).footage;
    } else {
      r.value = round1c(r.value * factor);
    }
    r.calibratedBy = sourceLabel;
    // Calibration corrects SCALE, not identification/occlusion uncertainty.
    // A row the AI was unsure about (shaded, distant, partly hidden) must
    // KEEP its "verify" flag — so the bump can't cross the 0.6 threshold.
    const prior = r.confidence ?? 0.5;
    const bumped = Math.min(0.95, prior + 0.15);
    r.confidence = prior < 0.6 ? Math.min(bumped, 0.59) : bumped;
  }
}

const round1c = (v) => Math.round(v * 10) / 10;

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

/* Satellite calibration banner — shows WHICH source set the scale, so the
 * estimator can see why numbers moved (spec §8: show the source used). */
function renderSatBanner() {
  const host = document.getElementById("sat-banner");
  if (!host) return;
  const sc = project.analysis?.satCheck;
  if (!sc) {
    host.innerHTML = (project.analysis && !project.satellite)
      ? `<div class="warn-banner">No satellite image — measurements rely on the front photo alone. Use <b>Find</b> on the address to import satellite for automatic scale calibration, or calibrate with a door height below.</div>`
      : "";
    return;
  }
  host.innerHTML = sc.applied
    ? `<div class="ok-banner">📐 <b>Satellite-calibrated.</b> Building front measures <b>${sc.satFrontFt} ft</b> on satellite (exact ft/pixel math); front-photo estimate was ${sc.aiFrontFt} ft — AI measurements rescaled ×${sc.factor}.</div>`
    : `<div class="warn-banner">📐 Satellite check ran but was <b>NOT applied</b> (satellite ${sc.satFrontFt} ft vs photo ${sc.aiFrontFt} ft, trace confidence ${Math.round((sc.confidence || 0) * 100)}%). Verify key lengths or calibrate with a door height.</div>`;
}

function renderMeasurements() {
  renderStaleNotice();
  renderComplexityPanel();
  renderSatBanner();
  const host = document.getElementById("meas-table");
  const rows = project.measurements;
  if (!rows.length) {
    host.innerHTML = `<p class="hint">No measurements yet — mark the design above, then hit <b>Analyze Marked Areas</b>.</p>`;
    renderAnalysisWarnings();
    return;
  }
  const cfg = loadPricingConfig();
  const changed = () => {
    scheduleSave(); renderMeasurements();
    window.dispatchEvent(new CustomEvent("measurements-changed"));
  };

  host.innerHTML = `
    <table>
      <thead><tr><th>Area</th><th>Item</th><th>AI est.</th><th>Final (edit)</th><th>Src</th><th>Conf.</th><th></th></tr></thead>
      <tbody>
      ${rows.map((r, i) => {
        const isPlant = !!r.plant, isTree = !!r.tree;
        const bd = isPlant ? bushStrandBreakdown(r.plant, cfg.rules)
          : isTree ? treeStrandBreakdown(r.tree, cfg.rules) : null;
        return `
        <tr data-i="${i}" class="${r.confidence < 0.6 ? "low-conf-row" : ""}">
          <td>${esc(r.zoneLabel)}${r.calibratedBy ? ` <small class="peak-tag">${esc(r.calibratedBy)}-cal</small>` : ""}</td>
          <td>${esc(cfg.items[r.itemKey]?.label || r.itemKey)}</td>
          <td><small>${r.rawAiValue ?? "—"} ${bd ? "ft light" : "ft"}</small></td>
          <td>${bd
            ? `<b>${r.manualStrands ?? bd.strands}</b> strand${(r.manualStrands ?? bd.strands) > 1 ? "s" : ""} <small>(${bd.footage} ft @ ${bd.spacingIn}" gap)</small>`
            : `<input type="number" step="0.5" class="meas-val" value="${r.value}">`}</td>
          <td><small title="Which image this came from">${esc(r.imageSource || "photo")}</small></td>
          <td><span class="conf ${r.confidence < 0.6 ? "low" : ""}">${Math.round(r.confidence * 100)}%${r.confidence < 0.6 ? " ⚠" : ""}</span></td>
          <td>${bd ? `<button class="meas-detail" title="Adjust dimensions & spacing">⚙</button>` : ""}<button class="meas-del" title="Remove">✕</button></td>
        </tr>
        ${r.basis ? `<tr class="basis-row"><td colspan="7"><small>↳ ${esc(r.basis)}</small></td></tr>` : ""}
        ${bd ? `<tr class="detail-row" data-detail="${i}" style="display:none"><td colspan="7">${isPlant ? plantEditor(r, i) : treeEditor(r, i)}</td></tr>` : ""}`;
      }).join("")}
      </tbody>
    </table>`;

  host.querySelectorAll("tr[data-i]").forEach((tr) => {
    const i = +tr.dataset.i;
    const valInput = tr.querySelector(".meas-val");
    if (valInput) valInput.addEventListener("change", (e) => {
      rows[i].value = parseFloat(e.target.value) || 0;
      rows[i].source = "User Entered";
      rows[i].confidence = 1;
      changed();
    });
    const detailBtn = tr.querySelector(".meas-detail");
    if (detailBtn) detailBtn.addEventListener("click", () => {
      const dr = host.querySelector(`tr[data-detail="${i}"]`);
      if (dr) dr.style.display = dr.style.display === "none" ? "" : "none";
    });
    tr.querySelector(".meas-del").addEventListener("click", () => {
      rows.splice(i, 1); changed();
    });
  });

  // plant/tree editors: any change re-derives footage + strands immediately
  host.querySelectorAll("[data-pfield]").forEach((el) =>
    el.addEventListener("change", () => {
      const i = +el.dataset.row, f = el.dataset.pfield;
      const r = rows[i];
      const obj = r.plant || r.tree;
      if (["pattern", "style", "spacingKey", "sizeClass", "density"].includes(f)) obj[f] = el.value;
      else obj[f] = parseFloat(el.value) || null;
      r.value = r.plant ? bushStrandBreakdown(r.plant, cfg.rules).footage
                        : treeStrandBreakdown(r.tree, cfg.rules).footage;
      r.source = "User Entered";
      r.confidence = 1;
      r.manualStrands = null;   // dimension edits re-derive; explicit strand override below wins
      changed();
    })
  );
  host.querySelectorAll("[data-strandoverride]").forEach((el) =>
    el.addEventListener("change", () => {
      const i = +el.dataset.strandoverride;
      const v = parseInt(el.value, 10);
      rows[i].manualStrands = Number.isInteger(v) && v > 0 ? v : null;
      rows[i].source = "User Entered";
      changed();
    })
  );
  renderAnalysisWarnings();
}

/* Bush/shrub editor: every dimension + pattern + spacing, per the spec */
function plantEditor(r, i) {
  const p = r.plant;
  const numF = (f, label, val) => `<label>${label} <input type="number" step="0.5" data-pfield="${f}" data-row="${i}" value="${val ?? ""}" style="width:70px"></label>`;
  return `<div class="pt-editor">
    ${numF("widthFt", "Width ft", p.widthFt)}
    ${numF("heightFt", "Height ft", p.heightFt)}
    ${numF("depthFt", "Depth ft", p.depthFt)}
    <label>Pattern <select data-pfield="pattern" data-row="${i}">
      <option value="wrap" ${p.pattern === "wrap" ? "selected" : ""}>Wrap around</option>
      <option value="surface" ${p.pattern === "surface" ? "selected" : ""}>Surface coverage</option>
      <option value="branch" ${p.pattern === "branch" ? "selected" : ""}>Branch style (dense)</option>
    </select></label>
    <label>Gap <select data-pfield="spacingKey" data-row="${i}">
      <option value="tight" ${p.spacingKey === "tight" ? "selected" : ""}>Tight</option>
      <option value="standard" ${p.spacingKey === "standard" ? "selected" : ""}>Standard</option>
      <option value="wide" ${p.spacingKey === "wide" ? "selected" : ""}>Wide</option>
    </select></label>
    <label>Size <select data-pfield="sizeClass" data-row="${i}">
      ${["small", "medium", "large", "xl"].map((s) => `<option ${p.sizeClass === s ? "selected" : ""}>${s}</option>`).join("")}
    </select></label>
    <label>Strand override <input type="number" min="1" step="1" data-strandoverride="${i}" value="${r.manualStrands ?? ""}" placeholder="auto" style="width:64px"></label>
  </div>`;
}

/* Tree editor: trunk/branch dimensions + style + spacing, per the spec */
function treeEditor(r, i) {
  const t = r.tree;
  const numF = (f, label, val) => `<label>${label} <input type="number" step="0.5" data-pfield="${f}" data-row="${i}" value="${val ?? ""}" placeholder="auto" style="width:70px"></label>`;
  return `<div class="pt-editor">
    ${numF("heightFt", "Tree ht ft", t.heightFt)}
    ${numF("trunkHeightFt", "Trunk ht ft", t.trunkHeightFt)}
    ${numF("trunkCircumFt", "Trunk circ ft", t.trunkCircumFt)}
    ${numF("branchCount", "# branches", t.branchCount)}
    ${numF("branchLenFt", "Branch len ft", t.branchLenFt)}
    ${numF("branchCircumFt", "Branch circ ft", t.branchCircumFt)}
    <label>Style <select data-pfield="style" data-row="${i}">
      <option value="trunk" ${t.style === "trunk" ? "selected" : ""}>Trunk wrap</option>
      <option value="branch" ${t.style === "branch" ? "selected" : ""}>Branch wrap</option>
      <option value="trunk_branch" ${t.style === "trunk_branch" ? "selected" : ""}>Trunk + branches</option>
      <option value="canopy" ${t.style === "canopy" ? "selected" : ""}>Canopy / net</option>
      <option value="spiral" ${t.style === "spiral" ? "selected" : ""}>Spiral / candy-cane</option>
    </select></label>
    <label>Gap <select data-pfield="spacingKey" data-row="${i}">
      <option value="tight" ${t.spacingKey === "tight" ? "selected" : ""}>Tight</option>
      <option value="standard" ${t.spacingKey === "standard" ? "selected" : ""}>Standard</option>
      <option value="wide" ${t.spacingKey === "wide" ? "selected" : ""}>Wide</option>
    </select></label>
    <label>Strand override <input type="number" min="1" step="1" data-strandoverride="${i}" value="${r.manualStrands ?? ""}" placeholder="auto" style="width:64px"></label>
  </div>`;
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
