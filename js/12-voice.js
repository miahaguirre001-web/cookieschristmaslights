/* =========================================================================
 * 12-voice.js — Mode B: Voice / Dictation design capture.
 * A plain focusable textarea — Wispr Flow / OS dictation types into it, no
 * special integration. Text + photo → same structured design object as the
 * other modes → editable marks. Shows "here's what I understood" summary
 * the estimator confirms; asks inline when ambiguous instead of guessing.
 * Can MODIFY an existing design. Never mandatory — an accelerator.
 * ========================================================================= */
"use strict";

function buildVoicePrompt(text, existingMarks) {
  const existing = existingMarks.filter((m) => m.included !== false)
    .map((m) => describeMarkGeometry(m)).join("\n");
  return `The estimator dictated a Christmas-light design request for the house in the photo. Convert it into concrete marks positioned on the photo (normalized 0–1 coordinates).

DICTATION:
"${text}"

${existing ? `EXISTING DESIGN (the dictation may MODIFY it — add, change, or remove):\n${existing}\n` : ""}
Return ONLY JSON:
{
 "understood": "one plain-language sentence of what you understood",
 "clarifications": ["question to ask if something is genuinely ambiguous — else empty"],
 "removeMarkIds": ["mark_03"],
 "marks": [
  {"kind":"line|curve","lightType":"c9|c7|mini|multi|icicle","a":{"x":..,"y":..},"b":{"x":..,"y":..},"zoneLabel":"front eave"},
  {"kind":"area","areaKind":"bush|shrub","lightType":"mini","rect":{"x":..,"y":..,"w":..,"h":..},"zoneLabel":"bushes by porch","sizeClass":"small|medium|large|xl"},
  {"kind":"addon","addonId":"wreath_lit|wreath_unlit|pillar_wrap|bow_red|bow_striped|garland|teardrop|deer_buck_l|deer_buck_r|deer_doe_l|deer_doe_r|deer_baby_l|deer_baby_r","addonSize":"36|48|60","rect":{"x":..,"y":..,"w":0.08,"h":0.08},"zoneLabel":"front door wreath"}
 ],
 "colorScheme": "red_green|red_white|warm_white|multi|custom|null"
}
"addonSize" applies to wreaths ONLY and changes the price — use it when a size is spoken ("48 inch wreath", "big wreath" → 60, "small wreath" → 36); default "36" when unspecified.
Rules: trace the ACTUAL visible edges in the photo (e.g. "whole front roofline" = the real eave line you can see). Exclusions ("skip the garage") mean: do NOT create marks there, and list any existing marks on that feature in removeMarkIds. "Wrap the pillars" = one pillar_wrap addon per visible pillar, placed on each. If a request is ambiguous (e.g. "the windows" when 5 are visible), put ONE short question in clarifications and DO NOT guess that part — still return the unambiguous marks. Keep zoneLabels under 4 words.`;
}

function initVoice() {
  const btn = document.getElementById("btn-voice-apply");
  const ta = document.getElementById("voice-text");
  const status = document.getElementById("voice-status");
  const summary = document.getElementById("voice-summary");

  btn.addEventListener("click", () => withBusy(btn, async () => {
    const text = ta.value.trim();
    if (!text) { setStatus(status, "Dictate or type the design first (click the field and use Wispr Flow or your OS dictation).", "warn"); return; }
    if (!project.photo) { setStatus(status, "Import or upload a photo first.", "warn"); return; }
    setStatus(status, "Interpreting the design…");
    const onStatus = (m) => { btn.textContent = m; };

    const out = await callClaude({
      system: "You convert spoken Christmas-light design requests into precise photo markup. Respond with valid JSON only.",
      messages: [{ role: "user", content: [imageBlock(project.photo), { type: "text", text: buildVoicePrompt(text, project.marks) }] }],
      maxTokens: 1800,        // latency throttle — see 02-api.js
    }, onStatus);

    const parsed = validateShape(extractJSON(out), { marks: "array", clarifications: "array", understood: "string" }, "Voice parse");

    // Preview: confirm-or-edit before committing (every AI output is a draft)
    summary.innerHTML = `
      <div class="voice-understood">
        <b>Here's what I understood:</b> ${esc(parsed.understood || "(no summary)")}
        <div><small>${(parsed.marks || []).length} new mark(s)${parsed.removeMarkIds?.length ? `, removing ${parsed.removeMarkIds.length}` : ""}${parsed.colorScheme ? `, color: ${esc(parsed.colorScheme)}` : ""}</small></div>
        ${(parsed.clarifications || []).length ? `<div class="warn-line">Needs clarifying — answer in the box and apply again:<br>${parsed.clarifications.map((c) => "· " + esc(c)).join("<br>")}</div>` : ""}
        <button id="voice-confirm">Apply to canvas</button>
        <button id="voice-discard" class="secondary">Discard</button>
      </div>`;
    document.getElementById("voice-confirm").addEventListener("click", () => {
      applyVoiceDesign(parsed);
      summary.innerHTML = "";
      setStatus(status, "Applied — the marks are now editable on the canvas above.", "ok");
    });
    document.getElementById("voice-discard").addEventListener("click", () => {
      summary.innerHTML = ""; setStatus(status, "Discarded.", "");
    });
  }));
}

function applyVoiceDesign(parsed) {
  pushUndo();
  if (Array.isArray(parsed.removeMarkIds)) {
    project.marks = project.marks.filter((m) => !parsed.removeMarkIds.includes(m.id));
  }
  for (const m of parsed.marks || []) {
    if (m.kind === "line" || m.kind === "curve") {
      if (!isPt(m.a) || !isPt(m.b)) continue;
      project.marks.push({
        id: nextMarkId(), kind: m.kind, lightType: m.lightType || "c9",
        a: m.a, b: m.b, zoneLabel: m.zoneLabel || "run",
        source: "voice", confidence: null, included: true, wrapStyle: null,
      });
    } else if (m.kind === "area" && m.rect && isRect(m.rect)) {
      project.marks.push({
        id: nextMarkId(), kind: "area", areaKind: m.areaKind || "bush",
        lightType: m.lightType || "mini", rect: m.rect,
        zoneLabel: m.zoneLabel || "bushes", sizeClass: m.sizeClass || "medium",
        source: "voice", confidence: null, included: true, wrapStyle: "wrap",
      });
    } else if (m.kind === "addon" && m.rect && isRect(m.rect)) {
      const a = ADDONS.find((x) => x.id === m.addonId);
      if (!a) continue;
      const size = isWreath(m.addonId)
        ? (WREATH_SIZES.some((s) => s.id === m.addonSize) ? m.addonSize : DEFAULT_WREATH_SIZE)
        : null;
      project.marks.push({
        id: nextMarkId(), kind: "addon", addonId: m.addonId, addonSize: size, rect: m.rect,
        zoneLabel: m.zoneLabel || (size ? `${a.label} ${size}"` : a.label),
        source: "voice", confidence: null, included: true,
        wrapStyle: a.isWrapDesign ? "wrap" : null,
      });
    }
  }
  if (parsed.colorScheme && LIGHT_COLORS.some((c) => c.id === parsed.colorScheme)) {
    project.colorScheme = parsed.colorScheme;
    renderColorSchemes();
  }
  touchMarks();
}
