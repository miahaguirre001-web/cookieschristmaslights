/* =========================================================================
 * 13-dashboard.js — Saved properties dashboard + hash router + settings.
 * Address = record identifier. Views: #dashboard · #estimate · #pricing · #settings
 * ========================================================================= */
"use strict";

function initRouter() {
  window.addEventListener("hashchange", route);
  route();
}

function route() {
  const hash = location.hash || "#estimate";
  document.querySelectorAll(".view").forEach((v) => (v.style.display = "none"));
  document.querySelectorAll(".nav-link").forEach((a) => a.classList.toggle("sel", a.getAttribute("href") === hash));
  const view = document.querySelector(hash.replace("#", "#view-"));
  if (view) view.style.display = "";
  if (hash === "#dashboard") renderDashboard();
  if (hash === "#pricing") renderPricingGuide();
  if (hash === "#settings") renderSettings();
}

async function renderDashboard() {
  const host = document.getElementById("dash-list");
  const all = (await dbAll()).sort((a, b) => b.updatedAt - a.updatedAt);
  if (!all.length) {
    host.innerHTML = `<p class="hint">No saved properties yet. Start an estimate — it saves automatically under its address.</p>`;
    return;
  }
  host.innerHTML = all.map((p) => {
    const latest = p.mockups?.[p.mockups.length - 1];
    return `<div class="dash-card" data-addr="${esc(p.address)}">
      ${latest ? `<img src="${latest.dataUrl}" alt="">` : p.photo ? `<img src="${p.photo}" alt="">` : `<div class="dash-noimg">No photo</div>`}
      <div class="dash-info">
        <b>${esc(p.address)}</b>
        <small>${p.quote ? "$" + p.quote.total.toFixed(2) + " · " + Math.round((p.quote.confidence || 0) * 100) + "% conf" : "No quote yet"} · ${new Date(p.updatedAt).toLocaleDateString()}</small>
      </div>
      <div class="dash-actions">
        <button class="dash-open">Open</button>
        <button class="dash-export">Export</button>
        <button class="dash-del secondary">Delete</button>
      </div>
    </div>`;
  }).join("");
  host.querySelectorAll(".dash-card").forEach((card) => {
    const addr = card.dataset.addr;
    card.querySelector(".dash-open").addEventListener("click", async () => {
      await loadProject(addr);
      location.hash = "#estimate";
    });
    card.querySelector(".dash-export").addEventListener("click", async () => {
      const p = await dbGet(addr);
      const blob = new Blob([JSON.stringify(p, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `estimate-${addr.replace(/[^a-z0-9]+/gi, "-").slice(0, 50)}.json`;
      a.click(); URL.revokeObjectURL(a.href);
    });
    card.querySelector(".dash-del").addEventListener("click", async () => {
      if (confirm(`Delete estimate for ${addr}?`)) { await dbDelete(addr); renderDashboard(); }
    });
  });
}

async function renderSettings() {
  const host = document.getElementById("settings-status");
  host.innerHTML = `<p class="hint">Checking connections…</p>`;
  try {
    const h = await fetchHealth();
    host.innerHTML = `
      <div class="conn ${h.claude ? "ok" : "bad"}">Claude (analysis, QA, voice, detect): ${h.claude ? "Connected" : "Not configured"}</div>
      <div class="conn ${h.gemini ? "ok" : "bad"}">Gemini (mock-up images): ${h.gemini ? "Connected" : "Not configured"}</div>
      <div class="conn ${h.maps ? "ok" : "bad"}">Google Maps (address, Street View): ${h.maps ? "Connected" : "Not configured"}</div>
      <p class="hint">Keys are configured server-side by the site admin (Netlify → Environment variables). Office staff never handle keys.</p>`;
  } catch {
    host.innerHTML = `<div class="conn bad">Backend unreachable. Running without deployment? AI features need the Netlify functions — see README for deploy steps. The manual fallback prompt panel in the Mock-Up section still works.</div>`;
  }
}

function initNewEstimate() {
  document.getElementById("btn-new-estimate").addEventListener("click", () => {
    resetProject();
    location.hash = "#estimate";
    window.scrollTo(0, 0);
  });
}
