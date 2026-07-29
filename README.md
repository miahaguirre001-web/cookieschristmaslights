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
3. Deploy. Open the site → **Settings** tab should show all three "Connected".

Office staff never see or enter keys — they're server-side only.

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

## Tests

```
node tests/pricing.test.js
```

24 assertions covering the strand math, garland rounding, job minimum, pillar
wraps, blank-price refusal, upcharges, and additive migration.

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
