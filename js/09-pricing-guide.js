/* =========================================================================
 * 09-pricing-guide.js — The Pricing Guide screen. First-class feature:
 * office edits every rate/rule without a developer; changes save
 * immediately; export/import for seasonal backup (Rule 17).
 * Plus the Price Sheet section renderer for the estimate page.
 * ========================================================================= */
"use strict";

function initPricingGuide() {
  renderPricingGuide();
  document.getElementById("pg-export").addEventListener("click", exportPricingConfig);
  document.getElementById("pg-import").addEventListener("change", (e) => {
    if (!e.target.files[0]) return;
    importPricingConfig(e.target.files[0], (err) => {
      if (err) alert("Import failed: " + err.message);
      else { renderPricingGuide(); alert("Pricing config imported."); }
    });
  });
  window.addEventListener("pricing-config-changed", () => {
    renderPriceSheet();
  });
}

const RULE_FIELDS = [
  ["jobMinimum", "Job minimum ($)"],
  ["depositPct", "Deposit (%)"],
  ["boomLiftFee", "Boom lift fee ($)"],
  ["travelFee", "Travel fee ($)"],
  ["taxRatePct", "Tax rate (%)"],
  ["strandCoverageFt", "Strand coverage (ft per strand)"],
  ["garlandStrandFt", "Garland strand length (ft)"],
  ["pillarStrandsPerWrap", "Strands per pillar wrap"],
  ["otherColorUpchargePct", "Other Color Combination upcharge (%)"],
];

function renderPricingGuide() {
  const cfg = loadPricingConfig();
  const rulesHost = document.getElementById("pg-rules");
  rulesHost.innerHTML = RULE_FIELDS.map(([k, label]) => `
    <label class="pg-rule"><span>${label}</span>
      <input type="number" step="0.5" data-rule="${k}" value="${cfg.rules[k] ?? 0}">
    </label>`).join("");
  rulesHost.querySelectorAll("input").forEach((inp) =>
    inp.addEventListener("change", () => {
      const cfg2 = loadPricingConfig();
      cfg2.rules[inp.dataset.rule] = parseFloat(inp.value) || 0;
      savePricingConfig(cfg2);
    })
  );

  renderPeakTable(cfg);

  const itemsHost = document.getElementById("pg-items");
  itemsHost.innerHTML = `
    <table>
      <thead><tr><th>Item</th><th>Unit</th><th>Rate ($)</th><th>Cost ($)</th><th>Note</th></tr></thead>
      <tbody>${Object.entries(cfg.items).map(([k, it]) => `
        <tr data-key="${k}" class="${it.rate == null ? "needs-price" : ""}">
          <td><input class="pg-label" value="${esc(it.label)}"></td>
          <td><select class="pg-unit">${["lf", "strand", "each"].map((u) => `<option ${u === it.unit ? "selected" : ""}>${u}</option>`).join("")}</select></td>
          <td><input class="pg-rate" type="number" step="0.5" value="${it.rate ?? ""}" placeholder="SET PRICE"></td>
          <td><input class="pg-cost" type="number" step="0.5" value="${it.cost ?? ""}"></td>
          <td><input class="pg-note" value="${esc(it.note || "")}"></td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  itemsHost.querySelectorAll("tr[data-key]").forEach((tr) => {
    const key = tr.dataset.key;
    const commit = () => {
      const cfg2 = loadPricingConfig();
      const it = cfg2.items[key];
      it.label = tr.querySelector(".pg-label").value;
      it.unit = tr.querySelector(".pg-unit").value;
      const rate = tr.querySelector(".pg-rate").value;
      it.rate = rate === "" ? null : parseFloat(rate);
      const cost = tr.querySelector(".pg-cost").value;
      it.cost = cost === "" ? null : parseFloat(cost);
      it.note = tr.querySelector(".pg-note").value;
      savePricingConfig(cfg2);
      tr.classList.toggle("needs-price", it.rate == null);
    };
    tr.querySelectorAll("input,select").forEach((el) => el.addEventListener("change", commit));
  });
}

function renderPeakTable(cfg) {
  const host = document.getElementById("pg-peak");
  if (!host) return;
  const table = cfg.rules.peakHeightTable || DEFAULT_PEAK_TABLE;
  host.innerHTML = `
    <table>
      <thead><tr><th>Base width up to (ft)</th><th>Peak height (ft)</th><th>Implied pitch</th><th></th></tr></thead>
      <tbody>${table.map((row, i) => {
        const mid = row.maxBase == null ? null : row.maxBase;
        const pitch = mid ? ((row.height / (mid / 2)) * 12).toFixed(1) + "/12" : "—";
        return `<tr data-i="${i}">
          <td><input type="number" step="1" class="pk-base" value="${row.maxBase ?? ""}" placeholder="(anything larger)"></td>
          <td><input type="number" step="0.5" class="pk-height" value="${row.height}"></td>
          <td><small>${pitch}</small></td>
          <td><button class="pk-del secondary">✕</button></td>
        </tr>`;
      }).join("")}</tbody>
    </table>
    <button id="pk-add" class="secondary" style="margin-top:8px">＋ Add row</button>`;

  const commit = () => {
    const rows = [...host.querySelectorAll("tr[data-i]")].map((tr) => {
      const b = tr.querySelector(".pk-base").value;
      return { maxBase: b === "" ? null : parseFloat(b), height: parseFloat(tr.querySelector(".pk-height").value) || 0 };
    }).filter((r) => r.height > 0);
    const cfg2 = loadPricingConfig();
    cfg2.rules.peakHeightTable = rows;
    savePricingConfig(cfg2);
    renderPeakTable(cfg2);
  };
  host.querySelectorAll("input").forEach((el) => el.addEventListener("change", commit));
  host.querySelectorAll(".pk-del").forEach((b) =>
    b.addEventListener("click", () => { b.closest("tr").remove(); commit(); })
  );
  document.getElementById("pk-add").addEventListener("click", () => {
    const cfg2 = loadPricingConfig();
    cfg2.rules.peakHeightTable = [...(cfg2.rules.peakHeightTable || []), { maxBase: 60, height: 20 }];
    savePricingConfig(cfg2);
    renderPeakTable(cfg2);
  });
}

/* ---------------- Price Sheet (Section 5 of the estimate page) ---------------- */

function initPriceSheet() {
  window.addEventListener("measurements-changed", renderPriceSheet);
  window.addEventListener("analysis-complete", renderPriceSheet);
  window.addEventListener("project-loaded", renderPriceSheet);
  window.addEventListener("marks-changed", renderPriceSheet);
  document.getElementById("boom-lift").addEventListener("change", (e) => {
    project.boomLift = e.target.checked; scheduleSave(); renderPriceSheet();
  });
}

function renderPriceSheet() {
  const host = document.getElementById("price-sheet");
  document.getElementById("boom-lift").checked = !!project.boomLift;

  if (!project.measurements.length && !project.marks.some((m) => m.kind === "addon" && m.included !== false)) {
    host.innerHTML = `<p class="hint">Run <b>Analyze Marked Areas</b> to price the design.</p>`;
    return;
  }

  const cfg = loadPricingConfig();
  const quote = computeQuote(project.measurements, project.marks, {
    colorScheme: project.colorScheme,
    customSequence: project.customSequence,
    boomLift: project.boomLift,
  }, cfg);
  project.quote = quote;
  scheduleSave();

  const staleMarkup = isAnalysisStale();
  const stalePrices = project.quotedConfigStamp && project.quotedConfigStamp !== configStamp();

  host.innerHTML = `
    ${staleMarkup ? `<div class="warn-banner">Markup changed since analysis — <button id="ps-reanalyze" class="link-btn">re-analyze</button> before quoting.</div>` : ""}
    ${stalePrices ? `<div class="warn-banner">Pricing Guide changed since this analysis — prices may be stale.</div>` : ""}
    <table>
      <thead><tr><th>Line item</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead>
      <tbody>
        ${quote.lineItems.map((li) => `
          <tr class="${li.total == null ? "needs-price" : ""}">
            <td>${esc(li.label)}${li.detail ? `<br><small>${esc(li.detail)}</small>` : ""}</td>
            <td>${li.qty} ${li.unit}</td>
            <td>${li.rate == null ? "—" : "$" + li.rate.toFixed(2)}</td>
            <td>${li.total == null ? "SET PRICE" : "$" + li.total.toFixed(2)}</td>
          </tr>`).join("")}
        ${quote.adjustments.map((a) => `
          <tr class="adj"><td colspan="3">${esc(a.label)}</td><td>$${a.amount.toFixed(2)}</td></tr>`).join("")}
      </tbody>
      <tfoot>
        <tr class="total-row"><td colspan="3">Total${quote.minimumApplied ? " (job minimum applied)" : ""}</td><td><b>$${quote.total.toFixed(2)}</b></td></tr>
        <tr><td colspan="3">Deposit (${cfg.rules.depositPct}%)</td><td>$${quote.deposit.toFixed(2)}</td></tr>
        <tr><td colspan="3">Confidence</td><td><span class="conf ${quote.confidence < 0.6 ? "low" : ""}">${Math.round(quote.confidence * 100)}%</span></td></tr>
      </tfoot>
    </table>
    ${quote.errors.length ? `<div class="error-box">${quote.errors.map((e) => `<div>⛔ ${esc(e)}</div>`).join("")}<div><b>This quote cannot be finalized until prices are set in the Pricing Guide.</b></div></div>` : ""}
    ${quote.assumptions.length ? `<details class="assumptions"><summary>Assumptions (${quote.assumptions.length})</summary>${quote.assumptions.map((a) => `<div>· ${esc(a)}</div>`).join("")}</details>` : ""}
  `;
  const re = document.getElementById("ps-reanalyze");
  if (re) re.addEventListener("click", () => document.getElementById("btn-analyze").click());
}
