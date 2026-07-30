/* =========================================================================
 * 14-app.js — boot. One scrolling estimate page, no gates (Section 2 of
 * the spec): Property → Design → Measurements → Mock-Up → Price Sheet,
 * with a sticky jump bar.
 * ========================================================================= */
"use strict";

let _appBooted = false;

document.addEventListener("DOMContentLoaded", () => {
  // Idempotence guard: if this ever runs twice, every button would get a
  // second listener and each click would fire two paid API calls.
  if (_appBooted) return;
  _appBooted = true;

  loadPricingConfig();          // seeds + migrates
  initProperty();
  initCanvas();
  initAutoDetect();
  initVoice();
  initAnalysis();
  initMeasurements();
  initRuler();
  initPricingGuide();
  initPriceSheet();
  initMockup();
  initFeedback();
  initRouter();
  initNewEstimate();

  // optional AI note (collapsed by default)
  const note = document.getElementById("ai-note");
  note.addEventListener("input", () => { project.aiNote = note.value; scheduleSave(); });
  window.addEventListener("project-loaded", () => { note.value = project.aiNote || ""; });

  // sticky jump bar highlights the section in view
  const sections = ["prop-section", "design-section", "measure-section", "mockup-section", "price-section"];
  const links = document.querySelectorAll("#jump-bar a");
  const obs = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        links.forEach((l) => l.classList.toggle("sel", l.getAttribute("href") === "#" + e.target.id));
      }
    }
  }, { rootMargin: "-40% 0px -55% 0px" });
  sections.forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); });
});
