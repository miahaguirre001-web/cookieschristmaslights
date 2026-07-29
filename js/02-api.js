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
const RETRY_DELAYS = [1500, 4000, 9000];
const RETRYABLE = new Set([502, 503, 504, 429]);

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
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const res = await fetch(API_BASE + path, options);
      if (RETRYABLE.has(res.status) && attempt < RETRY_DELAYS.length) {
        if (onStatus) onStatus(`Service busy — retrying (${attempt + 1}/3)…`);
        await sleep(RETRY_DELAYS[attempt]);
        continue;
      }
      if (!res.ok) {
        // Read the REAL message. Previously this could yield an object and
        // render as "[object Object]", hiding the actual cause.
        let detail = "";
        try {
          const d = await res.json();
          detail = typeof d.error === "string" ? d.error
            : d.error?.message || d.message || JSON.stringify(d);
        } catch {
          try { detail = await res.text(); } catch { /* ignore */ }
        }
        throw new Error(`Request failed (${res.status})${detail ? ": " + String(detail).slice(0, 400) : ""}`);
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (e.name === "TypeError" && attempt < RETRY_DELAYS.length) {
        // network hiccup
        if (onStatus) onStatus(`Service busy — retrying (${attempt + 1}/3)…`);
        await sleep(RETRY_DELAYS[attempt]);
        continue;
      }
      if (attempt >= RETRY_DELAYS.length) break;
      throw e;
    }
  }
  throw lastErr || new Error("Request failed");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- Claude (vision/analysis/parsing) ---- */
async function callClaude({ system, messages, maxTokens = 4000 }, onStatus) {
  const imgs = [];
  for (const m of messages) for (const b of m.content || [])
    if (b.type === "image") imgs.push(b.source?.data || "");
  assertPayloadFits(imgs, "Analysis");
  const data = await apiFetch("/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages, max_tokens: maxTokens }),
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
