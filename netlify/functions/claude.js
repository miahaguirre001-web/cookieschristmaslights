// Proxy to Anthropic Messages API. Key stays server-side (Rule: no keys in browser).
// Body: { system, messages, max_tokens } — messages may contain base64 image blocks.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };
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
        model: body.model || "claude-sonnet-4-5",
        max_tokens: Math.min(body.max_tokens || 4000, 8000),
        system: body.system || undefined,
        messages: body.messages,
      }),
    });
    const data = await res.text();
    // Pass through upstream status so the client can retry 502/503/504 (Rule 14)
    return { statusCode: res.status, headers: { "Content-Type": "application/json" }, body: data };
  } catch (e) {
    return json(502, { error: "Upstream error: " + e.message });
  }
};

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});
