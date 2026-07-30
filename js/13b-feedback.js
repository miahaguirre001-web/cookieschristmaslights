/* =========================================================================
 * 13b-feedback.js — GROUND-TRUTH FEEDBACK LOOP.
 * After a job is installed, record what the crew ACTUALLY used. Over ~15-20
 * jobs this produces empirical correction factors per zone type — measured,
 * not guessed, and worth more than any amount of prompt tuning.
 *
 * Storage: localStorage (small records, survives across sessions).
 * Nothing here changes a quote automatically; factors are shown as guidance
 * and applied only when the estimator opts in.
 * ========================================================================= */
"use strict";

const ACTUALS_KEY = "clp_actuals_v1";

function loadActuals() {
  try { return JSON.parse(localStorage.getItem(ACTUALS_KEY)) || []; }
  catch { return []; }
}
function saveActuals(list) {
  localStorage.setItem(ACTUALS_KEY, JSON.stringify(list));
}

/* One record per zone type per job: what we estimated vs what was installed */
function recordActual({ address, zoneKind, estimatedFt, actualFt, note }) {
  if (!(estimatedFt > 0) || !(actualFt > 0)) throw new Error("Both estimated and actual must be positive numbers.");
  const list = loadActuals();
  list.push({
    id: "act_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    address: address || "(unnamed)",
    zoneKind: zoneKind || "eave",
    estimatedFt: Math.round(estimatedFt * 10) / 10,
    actualFt: Math.round(actualFt * 10) / 10,
    ratio: Math.round((actualFt / estimatedFt) * 1000) / 1000,
    note: note || "",
    at: Date.now(),
  });
  saveActuals(list);
  return list;
}

/* Correction factors per zone kind. Uses the MEDIAN ratio, which resists a
 * single mis-typed job far better than a mean would. */
function correctionFactors(list = loadActuals()) {
  const byKind = {};
  for (const r of list) {
    (byKind[r.zoneKind] = byKind[r.zoneKind] || []).push(r.ratio);
  }
  const out = {};
  for (const [kind, ratios] of Object.entries(byKind)) {
    const sorted = ratios.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    const spread = sorted.length > 1 ? sorted[sorted.length - 1] - sorted[0] : 0;
    out[kind] = {
      n: sorted.length,
      median: Math.round(median * 1000) / 1000,
      mean: Math.round(mean * 1000) / 1000,
      spread: Math.round(spread * 1000) / 1000,
      // Only trust a factor once there's a real sample behind it
      reliable: sorted.length >= 5,
      biasPct: Math.round((median - 1) * 1000) / 10,
    };
  }
  return out;
}

/* Apply the learned factors to the current project's AI-estimated rows. */
function applyCorrectionFactors() {
  const factors = correctionFactors();
  let applied = 0;
  for (const r of project.measurements) {
    if (r.source !== "AI Estimated") continue;      // never touch reviewed rows
    if (r.measuredDirect) continue;                 // never touch exact measurements
    const f = factors[r.zoneKind];
    if (!f || !f.reliable) continue;
    r.value = Math.round(r.value * f.median * 10) / 10;
    r.basis = `${r.basis ? r.basis + " · " : ""}corrected ×${f.median} from ${f.n} past jobs`;
    r.correctedBy = f.median;
    applied++;
  }
  if (applied) {
    scheduleSave();
    renderMeasurements();
    window.dispatchEvent(new CustomEvent("measurements-changed"));
  }
  return applied;
}

/* ---------------- UI ---------------- */

function initFeedback() {
  const add = document.getElementById("fb-add");
  if (!add) return;
  add.addEventListener("click", () => {
    try {
      recordActual({
        address: document.getElementById("fb-address").value.trim() || project.address,
        zoneKind: document.getElementById("fb-zone").value,
        estimatedFt: parseFloat(document.getElementById("fb-est").value),
        actualFt: parseFloat(document.getElementById("fb-act").value),
        note: document.getElementById("fb-note").value.trim(),
      });
      document.getElementById("fb-est").value = "";
      document.getElementById("fb-act").value = "";
      document.getElementById("fb-note").value = "";
      renderFeedback();
    } catch (e) { alert(e.message); }
  });
  document.getElementById("fb-export-actuals").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(loadActuals(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `installed-actuals-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  });
  renderFeedback();
}

function renderFeedback() {
  const host = document.getElementById("fb-report");
  if (!host) return;
  const list = loadActuals();
  const factors = correctionFactors(list);
  const prefill = document.getElementById("fb-address");
  if (prefill && !prefill.value) prefill.value = project.address || "";

  if (!list.length) {
    host.innerHTML = `<p class="hint">No jobs recorded yet. After each install, enter what the tool estimated and what the crew actually used. Around 5 jobs per zone type is enough for a usable correction factor; 15–20 makes it solid.</p>`;
    return;
  }

  const rows = Object.entries(factors).sort((a, b) => b[1].n - a[1].n);
  host.innerHTML = `
    <table>
      <thead><tr><th>Zone type</th><th>Jobs</th><th>Tool bias</th><th>Suggested factor</th><th>Spread</th></tr></thead>
      <tbody>${rows.map(([kind, f]) => `
        <tr class="${f.reliable ? "" : "low-conf-row"}">
          <td>${esc(kind)}</td>
          <td>${f.n}${f.reliable ? "" : " <small>(need 5)</small>"}</td>
          <td>${f.biasPct === 0 ? "on target" : f.biasPct > 0 ? `under by ${f.biasPct}%` : `over by ${Math.abs(f.biasPct)}%`}</td>
          <td><b>×${f.median}</b></td>
          <td>${f.spread > 0.4 ? `<span class="conf low">±${f.spread} — inconsistent</span>` : `±${f.spread}`}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    <div class="row" style="margin-top:10px">
      <button id="fb-apply" class="primary">Apply factors to the current estimate</button>
      <small>Only zone types with 5+ jobs are applied. Rows you've edited and satellite-measured rows are never touched.</small>
    </div>
    <details style="margin-top:10px"><summary class="hint">Recorded jobs (${list.length})</summary>
      <table><thead><tr><th>Address</th><th>Zone</th><th>Est.</th><th>Actual</th><th>Ratio</th><th></th></tr></thead>
      <tbody>${list.slice().reverse().map((r) => `
        <tr data-id="${r.id}"><td>${esc(r.address)}</td><td>${esc(r.zoneKind)}</td>
        <td>${r.estimatedFt}</td><td>${r.actualFt}</td><td>×${r.ratio}</td>
        <td><button class="fb-del secondary">✕</button></td></tr>`).join("")}
      </tbody></table>
    </details>`;

  document.getElementById("fb-apply").addEventListener("click", () => {
    if (!project.measurements.length) { alert("Open an estimate with measurements first."); return; }
    const n = applyCorrectionFactors();
    alert(n ? `Applied learned corrections to ${n} measurement${n > 1 ? "s" : ""}.`
            : "No rows were eligible — either no zone type has 5+ recorded jobs yet, or every row is already reviewed/exact.");
  });
  host.querySelectorAll(".fb-del").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.closest("tr").dataset.id;
      saveActuals(loadActuals().filter((r) => r.id !== id));
      renderFeedback();
    })
  );
}

if (typeof module !== "undefined") {
  module.exports = { correctionFactors };
}
