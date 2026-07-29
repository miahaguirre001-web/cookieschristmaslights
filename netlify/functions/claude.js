// Proxy to Anthropic Messages API. Key stays server-side (no keys in browser).
// Body: { system, messages, max_tokens } — messages may contain base64 image blocks.
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };
  const denied = accessGate(event);
  if (denied) return denied;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(503, { error: "ANTHROPIC_API_KEY not configured" });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: "Bad JSON" }); }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: body.model || DEFAULT_MODEL,
        max_tokens: Math.min(body.max_tokens || 4000, 8000),
        system: body.system || undefined,
        messages: body.messages,
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      // Surface the REAL upstream message instead of an opaque object,
      // otherwise the browser shows "[object Object]" and hides the cause.
      return json(res.status, { error: readUpstreamError(text, res.status), model: body.model || DEFAULT_MODEL });
    }
    // Pass through so the client can retry 502/503/504 (Rule 14)
    return { statusCode: res.status, headers: { "Content-Type": "application/json" }, body: text };
  } catch (e) {
    return json(502, { error: "Upstream error: " + e.message });
  }
};

/* Anthropic errors look like {"type":"error","error":{"type":"...","message":"..."}}
 * — pull the human-readable message out of whatever shape arrives. */
function readUpstreamError(text, status) {
  try {
    const d = JSON.parse(text);
    if (typeof d.error === "string") return d.error;
    if (d.error?.message) return d.error.message;
    if (d.message) return d.message;
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

/* Optional shared-secret gate: only active when APP_ACCESS_CODE env var is
 * set. Prevents strangers from burning API credits on a public URL. */
function accessGate(event) {
  const code = process.env.APP_ACCESS_CODE;
  if (!code) return null;
  const sent = event.headers["x-app-code"] || event.headers["X-App-Code"] || "";
  if (sent !== code) return json(401, { error: "Access code required or incorrect — set it in Settings." });
  return null;
}
