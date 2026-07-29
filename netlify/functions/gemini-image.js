// Proxy to Gemini image generation (photo EDIT of the darkened base + markup map).
// Body: { prompt, images: [{mimeType, data(base64)}] } → { image: {mimeType, data} }
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };
  const key = process.env.GEMINI_API_KEY;
  if (!key) return json(503, { error: "GEMINI_API_KEY not configured" });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: "Bad JSON" }); }

  const model = body.model || "gemini-2.5-flash-image";
  const parts = [{ text: body.prompt }];
  for (const img of body.images || []) {
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { responseModalities: ["IMAGE"] },
        }),
      }
    );
    if (!res.ok) {
      const t = await res.text();
      return { statusCode: res.status, headers: { "Content-Type": "application/json" }, body: t };
    }
    const data = await res.json();
    const outParts = data?.candidates?.[0]?.content?.parts || [];
    const imgPart = outParts.find((p) => p.inlineData || p.inline_data);
    if (!imgPart) return json(502, { error: "Model returned no image", detail: outParts.map(p => p.text).join(" ").slice(0, 500) });
    const inline = imgPart.inlineData || imgPart.inline_data;
    return json(200, { image: { mimeType: inline.mimeType || inline.mime_type, data: inline.data } });
  } catch (e) {
    return json(502, { error: "Upstream error: " + e.message });
  }
};

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});
