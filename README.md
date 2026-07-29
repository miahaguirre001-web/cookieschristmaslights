# Cookies Christmas Lights — Mock-Up & Estimating Tool

Turns a customer's address into a photorealistic night-time mock-up photo and an
accurate price in under 5 minutes. Internal sales tool — no logins, no CRM; the
**property address is the record**.

## Deploy (one time, ~10 minutes)

1. Push this folder to a Git repo (GitHub is fine) and create a new site on
   [Netlify](https://app.netlify.com) from it — the included `netlify.toml`
   handles build settings automatically.
2. In Netlify → **Site settings → Environment variables**, add:
   - `ANTHROPIC_API_KEY` — Claude, for analysis / auto-detect / voice / QA
   - `GEMINI_API_KEY` — Gemini, for mock-up image generation
   - `GOOGLE_MAPS_API_KEY` — Geocoding + Street View Static + Maps Static
     (enable those three APIs on the key in Google Cloud Console)
   - `APP_ACCESS_CODE` — *optional but recommended on a public URL*: any
     passphrase. When set, AI/map features require it (staff enter it once in
     the app's Settings tab). Without it, anyone who finds the URL can burn
     your API credits.
3. **Redeploy after adding variables** (Deploys → Trigger deploy → Deploy site) —
   functions only pick up env vars on a fresh deploy.
4. Open the site → **Settings** tab should show all three "Connected".

Office staff never see or enter keys — they're server-side only.

> **Google Maps key gotcha:** restrict the key by *API* (those three), NOT by
> HTTP referrer — calls come from the Netlify function, not the browser, so a
> referrer restriction breaks it.

> **Timeouts:** Netlify functions default to a 10-second limit. Mock-up
> generation and analysis sometimes take longer; if you see repeated
> "Service busy / 502" even after retries, ask Netlify support to raise the
> function timeout to 26 s (free) — or use the manual fallback panel.

### Local development

```
npm install -g netlify-cli
netlify dev        # serves the app + functions at localhost:8888
```

Without deployment the app still runs: the markup canvas, pricing engine,
Pricing Guide, and the manual fallback prompt panel all work offline. Only the
AI calls and map imports need the functions.

## Using the tool (estimator workflow)

One scrolling page, no gates: **Property → Draw the Lights → Measurements →
Mock-Up → Price Sheet.**

1. Type the address, hit **Find** — imports Street View + satellite together.
2. Design the lights three interchangeable ways: **Auto-Detect** (proposes
   editable candidates — nothing is included until you confirm), **dictate**
   into the describe box (Wispr Flow or OS dictation), or **draw manually**
   (always works, always wins).
3. Hit **Analyze Marked Areas** — this IS the sign-off; it unlocks measurements,
   mock-up, and pricing. Editing marks afterward flags everything stale.
4. **Calibrate**: enter one real measurement (door ≈ 6.8 ft) — every AI length
   rescales. This is the single biggest accuracy lever; use it on every house.
5. **Generate Mock-Up** — auto QA inspects the result and retries once with a
   targeted correction if it fails. Judge the result at FULL SIZE, never the
   thumbnail. If generation has a bad day, use the always-visible manual
   fallback panel (copy prompt + download base photo → paste into Gemini/ChatGPT
   → upload result back).
6. The **Price Sheet** updates live. Items with no configured price refuse to
   finalize until the office sets them in the **Pricing Guide**.

## Pricing Guide

Every rate, rule, and multiplier is editable in the app and saved locally —
no developer needed, changes apply to all new quotes immediately. App updates
merge new items in additively and **never overwrite office edits**. Use
Export/Import to back up a season's rates.

Seeded from `2026 Christmas Lights Price Guide.xlsx` (July 2026).

## Roof complexity & the peak calculator

**Roof complexity is one setting per property**, not per zone — a house can't
be Easy and Hard at the same time. The AI estimates the roof pitch, classifies
it (Easy under 4/12 · In-Between 4–6/12 · Hard 7/12+, matching the price
guide), and shows its reasoning. Changing the setting in the Measurements
section instantly re-prices every roofline zone. Ridge and side rooflines keep
their own rates and are unaffected.

**The peak calculator** solves the least reliable measurement in the tool.
Diagonal rake lengths read short in a photo because of foreshortening; a
gable's *horizontal base* does not. So the AI reports the base width and the
tool derives both rake edges:

```
height = company peak table (base width → height)
side   = √((base ÷ 2)² + height²)
```

Peak-derived rows are tagged **peak calc** in the measurements table, and you
edit the *base width* — the rake length re-derives automatically, including
after calibration. There's also a standalone calculator in the Measurements
section for gables you want to add by hand.

The height table is the office's rule of thumb and is **editable in the
Pricing Guide** (with the implied pitch shown for each row), so it's never
hard-coded.

## Tests

```
node tests/pricing.test.js     # 24 assertions
node tests/geometry.test.js    # 46 assertions
```

Pricing: strand math, garland rounding, job minimum, pillar wraps,
blank-price refusal, upcharges, additive migration.
Geometry: peak table lookup and side lengths verified against the office
calculator, edge cases, custom tables, complexity classification, and the
zone→price mapping (including the garage-eave case).

## Architecture

Vanilla JS, ordered modules loaded by `index.html`:

| Module | Responsibility |
|---|---|
| 01-core-config | pricing config, defaults, additive migration |
| 02-api | Netlify-function client, 3× retry w/ backoff, hardened JSON parsing |
| 03-state | project state, IndexedDB persistence, staleness tracking |
| 04-property | address lookup, dual photo import, upload (no crop, no upscale) |
| 05-canvas | **the markup canvas** — all three input modes render into it |
| 06-analysis | vision analysis → measurements + install notes, anchors, sanity bounds |
| 07-measurements | filtered table, calibration, plausibility warnings |
| 08-pricing | pure pricing engine (unit-tested in node) |
| 09-pricing-guide | Pricing Guide screen + Price Sheet renderer |
| 10-mockup | night pre-processing, markup map, prompt builder, QA+1 retry, fallback panel, cleanup brush |
| 11-autodetect | Mode A — editable detection candidates with confidence |
| 12-voice | Mode B — dictation → structured design → editable marks |
| 13-dashboard | saved properties, router, settings |
| 14-app | boot + jump bar |

The Hard-Won Rules from the build document are annotated inline (`Rule N`)
at the exact code that implements them — treat those comments as load-bearing.
