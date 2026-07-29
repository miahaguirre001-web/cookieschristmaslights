// Proxy to Gemini image generation (photo EDIT of the darkened base + markup map).
// Body: { prompt, images: [{mimeType, data(base64)}] } → { image: {mimeType, data} }
//
// Gemini moved to the /v1beta/interactions endpoint. We call that first and
// fall back to the legacy :generateContent shape if the model/endpoint pair
// isn't available, so this keeps working across model generations.
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-image";
const FALLBACK_MODEL = "gemini-2.5-flash-image";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };
  const denied = accessGate(event);
  if (denied) return denied;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return json(503, { error: "GEMINI_API_KEY not configured" });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: "Bad JSON" }); }
  const model = body.model || DEFAULT_MODEL;

  // 1) current API: /v1beta/interactions
  let firstError;
  try {
    const out = await viaInteractions(key, model, body);
    if (out) return json(200, { image: out, model, api: "interactions" });
  } catch (e) { firstError = e; }

  // 2) legacy API: :generateContent
  try {
    const out = await viaGenerateContent(key, model, body);
    if (out) return json(200, { image: out, model, api: "generateContent" });
  } catch (e) {
    // 3) legacy API with the older known-good model
    try {
      const out = await viaGenerateContent(key, FALLBACK_MODEL, body);
      if (out) return json(200, { image: out, model: FALLBACK_MODEL, api: "generateContent-fallback" });
    } catch (e3) {
      return json(502, {
        error: `Image generation failed. ${firstError ? "interactions: " + firstError.message + " | " : ""}generateContent: ${e.message} | fallback(${FALLBACK_MODEL}): ${e3.message}`,
      });
    }
  }
  return json(502, { error: "Model returned no image. " + (firstError ? firstError.message : "") });
};

async function viaInteractions(key, model, body) {
  const input = [{ type: "text", text: body.prompt }];
  for (const img of body.images || []) {
    input.push({ type: "image", mime_type: img.mimeType, data: img.data });
  }
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(readUpstreamError(text, res.status));
  return findImage(JSON.parse(text));
}

async function viaGenerateContent(key, model, body) {
  const parts = [{ text: body.prompt }];
  for (const img of body.images || []) {
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(readUpstreamError(text, res.status));
  return findImage(JSON.parse(text));
}

/* Walk any Gemini response shape and return the first image block found.
 * Covers: output_image convenience prop, interactions output steps/blocks,
 * and legacy candidates[].content.parts[].inlineData. */
function findImage(data) {
  if (data?.output_image?.data) {
    return { mimeType: data.output_image.mime_type || data.output_image.mimeType || "image/png", data: data.output_image.data };
  }
  let found = null;
  const visit = (node) => {
    if (found || !node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const inline = node.inlineData || node.inline_data;
    if (inline?.data) {
      found = { mimeType: inline.mimeType || inline.mime_type || "image/png", data: inline.data };
      return;
    }
    if (node.type === "image" && typeof node.data === "string" && node.data.length > 100) {
      found = { mimeType: node.mime_type || node.mimeType || "image/png", data: node.data };
      return;
    }
    Object.values(node).forEach(visit);
  };
  visit(data);
  if (!found) {
    const textOut = JSON.stringify(data).slice(0, 300);
    throw new Error("no image in response: " + textOut);
  }
  return found;
}

function readUpstreamError(text, status) {
  try {
    const d = JSON.parse(text);
    if (d.error?.message) return d.error.message;
    if (typeof d.error === "string") return d.error;
    return JSON.stringify(d).slice(0, 400);
  } catch {
    return (text || `HTTP ${status}`).slice(0, 400);
  }
}

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

function accessGate(event) {
  const code = process.env.APP_ACCESS_CODE;
  if (!code) return null;
  const sent = event.headers["x-app-code"] || event.headers["X-App-Code"] || "";
  if (sent !== code) return json(401, { error: "Access code required or incorrect — set it in Settings." });
  return null;
}
