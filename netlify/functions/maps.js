// Proxy for Google Geocoding + Street View Static + Maps Static.
// Rule 9: pull MAX resolution the source provides — Street View 640x640 source=outdoor,
// satellite at scale=2. Never AI-upscale afterward.
// GET ?op=geocode&address=...        → geocode JSON
// GET ?op=streetview&lat=..&lng=..   → { image: base64 jpeg }
// GET ?op=satellite&lat=..&lng=..    → { image: base64 png }
exports.handler = async (event) => {
  const denied = accessGate(event);
  if (denied) return denied;
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return json(503, { error: "GOOGLE_MAPS_API_KEY not configured", configError: true });
  const q = event.queryStringParameters || {};

  try {
    if (q.op === "geocode") {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q.address || "")}&key=${key}`
      );
      return { statusCode: res.status, headers: { "Content-Type": "application/json" }, body: await res.text() };
    }
    if (q.op === "streetview") {
      // Optional heading/fov for multi-angle capture (depth + side rooflines).
      // Omitting heading lets Google point at the address automatically.
      const heading = q.heading !== undefined && q.heading !== "" ? `&heading=${encodeURIComponent(q.heading)}` : "";
      const fov = q.fov ? `&fov=${encodeURIComponent(q.fov)}` : "&fov=80";
      const pitch = q.pitch ? `&pitch=${encodeURIComponent(q.pitch)}` : "";
      const url = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${q.lat},${q.lng}&source=outdoor${fov}${heading}${pitch}&key=${key}`;
      return await imageResponse(url, "image/jpeg");
    }
    if (q.op === "streetview_meta") {
      // Cheap/free check: does Street View exist here, and at what heading?
      const res = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?location=${q.lat},${q.lng}&source=outdoor&key=${key}`);
      return { statusCode: res.status, headers: { "Content-Type": "application/json" }, body: await res.text() };
    }
    if (q.op === "satellite") {
      // zoom is caller-selectable: 20 covers a typical lot, 21 doubles the
      // resolution for small/urban lots. The client records which zoom was
      // used so the ft/pixel math stays exact.
      const zoom = Math.min(21, Math.max(17, parseInt(q.zoom, 10) || 20));
      const url = `https://maps.googleapis.com/maps/api/staticmap?center=${q.lat},${q.lng}&zoom=${zoom}&size=640x640&scale=2&maptype=satellite&key=${key}`;
      return await imageResponse(url, "image/png");
    }
    return json(400, { error: "Unknown op" });
  } catch (e) {
    return json(502, { error: "Upstream error: " + e.message });
  }
};

async function imageResponse(url, mime) {
  const res = await fetch(url);
  if (!res.ok) return json(res.status, { error: "Image fetch failed" });
  const buf = Buffer.from(await res.arrayBuffer());
  return json(200, { mimeType: mime, image: buf.toString("base64") });
}

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

function accessGate(event) {
  const code = process.env.APP_ACCESS_CODE;
  if (!code) return null;
  if ((event.headers["x-app-code"] || "") !== code)
    return json(401, { error: "Access code required — enter it in Settings." });
  return null;
}
