/* =========================================================================
 * 03-state.js — Project state + IndexedDB persistence.
 * The PROPERTY ADDRESS is the record identifier (anti-goal: no CRM).
 * Photos are large → IndexedDB for projects, localStorage for config only.
 * Rule 15: analysis IS the sign-off — changing markup after analysis
 * invalidates it (staleness flag) and mock-up/pricing show a re-analyze notice.
 * ========================================================================= */
"use strict";

const DB_NAME = "cookies-lights";
const DB_VERSION = 1;
const STORE = "projects";

let _db = null;
function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "address" });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(project) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(project);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}
async function dbGet(address) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction(STORE).objectStore(STORE).get(address);
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => rej(req.error);
  });
}
async function dbAll() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => rej(req.error);
  });
}
async function dbDelete(address) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(address);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

/* ---- The live project ---- */
function newProject() {
  return {
    address: "",
    lat: null, lng: null,
    propertyType: "single_family",
    notes: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    photo: null,          // dataURL — the house photo (Street View or upload)
    satellite: null,      // dataURL — roof reference, rides along
    photoSource: null,    // 'streetview' | 'upload'
    colorScheme: "red_green",
    customSequence: [],   // ordered swatch ids, max 4
    marks: [],            // see 05-canvas.js for mark shape
    markRevision: 0,      // bumped on every mark edit
    analyzedRevision: -1, // markRevision at last analysis; mismatch = stale (Rule 15)
    analysis: null,       // { zones, installNotes, ... }
    measurements: [],     // [{id, zoneLabel, itemKey, value, unit, source, confidence, markIds}]
    calibration: null,    // { realFt, aiFt, factor }
    boomLift: false,
    aiNote: "",
    mockups: [],          // [{dataUrl, createdAt, qa, prompt}] version history
    quote: null,          // last computed quote snapshot
    quotedConfigStamp: null, // config JSON hash at analysis; warn if changed
  };
}

let project = newProject();

async function saveProject() {
  if (!project.address) return; // address is the key — nothing to save yet
  project.updatedAt = Date.now();
  await dbPut(structuredClone(project));
}

async function loadProject(address) {
  const p = await dbGet(address);
  if (p) { project = p; window.dispatchEvent(new CustomEvent("project-loaded")); }
  return p;
}

function resetProject() {
  project = newProject();
  window.dispatchEvent(new CustomEvent("project-loaded"));
}

/* Mark mutation always goes through this so staleness tracking works */
function touchMarks() {
  project.markRevision++;
  window.dispatchEvent(new CustomEvent("marks-changed"));
  scheduleSave();
}

function isAnalysisStale() {
  return project.analysis && project.analyzedRevision !== project.markRevision;
}

let _saveTimer = null;
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => saveProject().catch(console.error), 800);
}

/* Simple config stamp to warn when prices changed since analysis */
function configStamp() {
  const cfg = loadPricingConfig();
  let h = 0;
  const s = JSON.stringify(cfg);
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return String(h);
}
