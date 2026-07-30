/* =========================================================================
 * 02-api.js — API client. All provider keys live server-side in Netlify
 * Functions; this file only talks to /.netlify/functions/*.
 * Rule 14: auto-retry transient failures 3x with 1.5s/4s/9s backoff and a
 * visible "Service busy — retrying (n/3)…" status.
 * Hardened JSON parsing: strip fences, bracket-balance repair,
 * schema-validate — never mutate project data until validation passes.
 * ========================================================================= */
"use strict";

const API_BASE = "/.netlify/functions";

/* Retry schedule. Anthropic returns 529 "Overloaded" under load and Gemini
 * returns 503/500 — these are capacity blips, not real failures, and they
 * clear in seconds. Four attempts with jittered backoff (~26s worst case)
 * turns almost all of them into a successful call the user never sees. */
const RETRY_DELAYS = [1200, 3500, 8000, 15000];

function isRetryableStatus(status) {
  if (status === 408 || status === 425 || status === 429) return true;
  return status >= 500;          // 500/502/503/504/522/524/529 …
}

/* Optional access code (only needed if APP_ACCESS_CODE is set on the server) */
const ACCESS_CODE_KEY = "clp_access_code";
const getAccessCode = () => localStorage.getItem(ACCESS_CODE_KEY) || "";
const setAccessCode = (v) => localStorage.setItem(ACCESS_CODE_KEY, v);

/* Netlify synchronous functions reject request bodies over ~6 MB. Check
 * BEFORE sending so the user gets a clear message instead of a cryptic 413. */
const NETLIFY_BODY_LIMIT = 6 * 1024 * 1024;
function assertPayloadFits(dataUrls, context) {
  // base64 dataURL length ≈ bytes × 1.37; JSON-wrapped, so compare directly
  const total = dataUrls.reduce((s, u) => s + (u ? u.length : 0), 0);
  if (total > NETLIFY_BODY_LIMIT * 0.92) {
    throw new Error(
      `${context}: the images are too large to send (~${(total / 1e6).toFixed(1)} MB, limit ~6 MB). ` +
      `Use the Street View import (smaller frames), or re-upload a smaller photo. ` +
      `For big photos, use the manual fallback panel instead — it has no size limit.`
    );
  }
}

async function apiFetch(path, options = {}, onStatus = null) {
  options.headers = { ...(options.headers || {}) };
  const code = getAccessCode();
  if (code) options.headers["x-app-code"] = code;

  const MAX = RETRY_DELAYS.length;
  let lastErr;

  for (let attempt = 0; attempt <= MAX; attempt++) {
    try {
      const res = await fetch(API_BASE + path, options);

      // Read the body ONCE — it can't be consumed twice.
      const raw = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { /* non-JSON error page */ }

      if (res.ok) return parsed !== null ? parsed : {};

      const detail = parsed
        ? (typeof parsed.error === "string" ? parsed.error
           : parsed.error?.message || parsed.message || JSON.stringify(parsed))
        : raw;

      // A missing API key is NOT transient — fail immediately instead of
      // making the user wait through the whole backoff for a certain error.
      const configError = parsed?.configError === true;

      // A timeout means THIS REQUEST is too slow for the 30s window. Unlike
      // an overload, retrying the identical payload usually times out again —
      // and every retry costs the user ~30 more seconds of waiting. Allow ONE
      // quick retry (generation speed varies), then stop with real advice.
      const isTimeout = /Sandbox\.Timeout|Task timed out|exceeded the time budget/i.test(detail || "");
      if (isTimeout) {
        if (attempt < 1) {
          if (onStatus) onStatus("AI ran long — one more try…");
          await sleep(1000);
          continue;
        }
        throw new Error(
          "The AI took longer than the server's 30-second limit, twice. " +
          "Reduce the job (fewer marked zones per analysis) or use the manual fallback panel. " +
          "The site admin can also ask Netlify support to raise the function timeout."
        );
      }

      if (!configError && isRetryableStatus(res.status) && attempt < MAX) {
        if (onStatus) onStatus(busyMessage(res.status, attempt + 1, MAX));
        await sleep(jitter(RETRY_DELAYS[attempt]));
        continue;
      }

      throw new Error(friendlyError(res.status, detail, attempt, configError));
    } catch (e) {
      lastErr = e;
      // Network-level failure (offline, DNS, connection reset)
      const isNetwork = e.name === "TypeError";
      if (isNetwork && attempt < MAX) {
        if (onStatus) onStatus(`Connection problem — retrying (${attempt + 1}/${MAX})…`);
        await sleep(jitter(RETRY_DELAYS[attempt]));
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("Request failed");
}

function busyMessage(status, n, max) {
  const why = status === 529 || status === 503 ? "AI service busy" : `Service error ${status}`;
  return `${why} — retrying (${n}/${max})…`;
}

/* Plain-language errors an estimator can act on. */
function friendlyError(status, detail, attempts, configError) {
  // A setup problem must show its own message — never get relabeled as a
  // transient outage, or the admin will never find the real cause.
  if (configError) return String(detail || `Configuration error (${status})`);
  const tried = attempts > 0 ? ` after ${attempts + 1} attempts` : "";
  if (status === 529 || status === 503) {
    return `The AI service is overloaded right now${tried}. This is temporary — wait a minute and try again. ` +
           `If it keeps happening, use the manual fallback panel in the Mock-Up section.`;
  }
  if (status === 429) {
    return `Rate limit reached${tried}. Wait a minute before the next estimate, or check your API plan limits.`;
  }
  if (status === 401) return `Access code required or incorrect — set it in Settings.`;
  if (status === 400 && /credit|billing|quota/i.test(detail || "")) {
    return `API billing problem: ${detail}. Check credits in your provider console.`;
  }
  return `Request failed (${status})${detail ? ": " + String(detail).slice(0, 400) : ""}`;
}

/* ±25% jitter so parallel calls don't retry in lockstep. */
const jitter = (ms) => Math.round(ms * (0.75 + Math.random() * 0.5));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- Claude (vision/analysis/parsing) ----
 * TIMEOUT BUDGET: Netlify kills functions at 30s (Sandbox.Timeout). Output
 * tokens dominate latency (~60-100 tok/s), so maxTokens is the throttle:
 * 1500 tokens ≈ 15-25s ≈ safely inside the window. Never raise these limits
 * without confirming the call still fits. FAST_MODEL handles structured
 * look-at-the-picture tasks in a fraction of the time. */
const FAST_MODEL = "claude-haiku-4-5";     // detect / refine / QA
const SMART_MODEL = null;                   // measurement analysis → server default (sonnet)

async function callClaude({ system, messages, maxTokens = 1500, model = null }, onStatus) {
  const imgs = [];
  for (const m of messages) for (const b of m.content || [])
    if (b.type === "image") imgs.push(b.source?.data || "");
  assertPayloadFits(imgs, "Analysis");
  const data = await apiFetch("/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages, max_tokens: Math.min(maxTokens, 2000), model: model || undefined }),
  }, onStatus);
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return text;
}

/* Build an image content block from a dataURL */
function imageBlock(dataUrl) {
  const [meta, b64] = dataUrl.split(",");
  const mime = meta.match(/data:(.*?);/)[1];
  return { type: "image", source: { type: "base64", media_type: mime, data: b64 } };
}

/* ---- Gemini image generation ---- */
async function callGeminiImage({ prompt, imageDataUrls }, onStatus) {
  assertPayloadFits(imageDataUrls, "Mock-up generation");
  const images = imageDataUrls.map((u) => {
    const [meta, b64] = u.split(",");
    return { mimeType: meta.match(/data:(.*?);/)[1], data: b64 };
  });
  const data = await apiFetch("/gemini-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, images }),
  }, onStatus);
  return `data:${data.image.mimeType};base64,${data.image.data}`;
}

/* ---- Maps ---- */
const geocodeAddress = (address) =>
  apiFetch(`/maps?op=geocode&address=${encodeURIComponent(address)}`);
const fetchStreetView = (lat, lng) =>
  apiFetch(`/maps?op=streetview&lat=${lat}&lng=${lng}`).then((d) => `data:${d.mimeType};base64,${d.image}`);
const fetchSatellite = (lat, lng) =>
  apiFetch(`/maps?op=satellite&lat=${lat}&lng=${lng}`).then((d) => `data:${d.mimeType};base64,${d.image}`);
const fetchHealth = () => apiFetch("/health");

/* Live end-to-end check used by the Settings "Test connections" button.
 * Makes one tiny real call per provider and reports the exact error. */
async function testConnections() {
  const results = {};
  // 1x1 white pixel PNG — smallest valid image for a vision round-trip
  const px = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
  try {
    const t = await callClaude({
      messages: [{ role: "user", content: [imageBlock(px), { type: "text", text: "Reply with the single word OK." }] }],
      maxTokens: 16,
    });
    results.claude = { ok: true, detail: (t || "").trim().slice(0, 40) };
  } catch (e) { results.claude = { ok: false, detail: e.message }; }

  try {
    const r = await apiFetch("/maps?op=geocode&address=1600+Amphitheatre+Parkway+Mountain+View+CA");
    results.maps = r.status === "OK"
      ? { ok: true, detail: "Geocoding OK" }
      : { ok: false, detail: `Google returned status "${r.status}"${r.error_message ? ": " + r.error_message : ""}` };
  } catch (e) { results.maps = { ok: false, detail: e.message }; }

  return results;   // Gemini is NOT auto-tested — image calls cost real credits
}

/* ---- Hardened JSON extraction ---- */
function extractJSON(text) {
  if (!text) throw new Error("Empty AI response");
  let t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = t.search(/[{[]/);
  if (start === -1) throw new Error("No JSON found in AI response");
  t = t.slice(start);
  try { return JSON.parse(t); } catch { /* attempt repair */ }
  // bracket-balance repair for truncated responses
  let repaired = t, depth = 0, inStr = false, esc = false;
  const stack = [];
  for (const ch of repaired) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    if (ch === "}" || ch === "]") stack.pop();
  }
  if (inStr) repaired += '"';
  repaired = repaired.replace(/,\s*$/, "");
  while (stack.length) {
    repaired += stack.pop() === "{" ? "}" : "]";
  }
  try { return JSON.parse(repaired); } catch (e) {
    throw new Error("Could not parse AI response as JSON");
  }
}

/* Validate against a minimal shape spec before any state mutation.
 * spec: { key: "array" | "object" | "string" | "number" } (keys optional-safe) */
function validateShape(obj, spec, label = "AI response") {
  if (typeof obj !== "object" || obj === null) throw new Error(`${label}: not an object`);
  for (const [k, type] of Object.entries(spec)) {
    if (obj[k] === undefined || obj[k] === null) continue;
    const actual = Array.isArray(obj[k]) ? "array" : typeof obj[k];
    if (actual !== type) throw new Error(`${label}: field "${k}" should be ${type}, got ${actual}`);
  }
  return obj;
}
