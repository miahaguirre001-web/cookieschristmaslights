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

**The fast path — Auto-Estimate.** Enter the address, hit **Find**,
**centre the customer's house** with the framing pad (and circle it if other
houses are still in frame), tick which
zones should be lit (roofline is on by default), and press
**⚡ Run Auto-Estimate**. One click runs the whole chain:

```
detect → snap lines to real edges → AI verifies placement
      → measure → price → mock-up
```

Then you glance at the result and send it. The manual tools stay underneath
purely for corrections when automation misses.

### Centre the house first (📐 Adjust framing)

Street View aims at the address, not at the best photo — the house often ends
up small, off to one side, behind a parked truck. Since the mock-up IS the
front photo, a badly framed shot means a badly framed mock-up.

The framing pad above the canvas pans, tilts and zooms. On a Street View
photo each adjustment **re-shoots the frame at full 640×640** from the new
angle — it is not a crop, so nothing gets blurry, and the house occupying more
of the frame means more real pixels for both the mock-up and the AI's
measurements. Uploaded photos can't be re-shot, so those crop-zoom instead and
the tool says plainly that it costs resolution.

Frame the house *before* drawing: a new photo invalidates marks and the target
outline (they're stored in the old image's coordinates), so the tool clears
them and warns you first.

### Circle the house (🎯 Target house)

Street View often frames two or three houses, and the customer's may sit at
the *edge* of the shot while a neighbour sits dead centre. Without being told
which building is the target, a vision model reliably picks the most
prominent one — the wrong one.

So the first step is to lasso the customer's house with the **🎯 Target
house** tool. Everything outside the loop is dimmed on screen, and that
outline is then enforced three ways:

- the outline is **drawn onto the image** sent to the AI, so it can see the
  target rather than just read coordinates for it;
- every prompt (detection, measurement, mock-up, QA) states the target region
  and explicitly says the target may not be the largest or most central house;
- any detected feature that lands off the target is **physically removed**
  client-side, so a stray neighbour roofline can never reach the price sheet
  or the mock-up.

The mock-up QA also fails outright if lights appear on a neighbouring house.
The target is optional — skip it on a clean single-house shot — but on any
photo with more than one building it is the difference between a correct
estimate and the wrong roof.

### How detection accuracy is handled

Raw vision-model coordinates drift — lines end up floating above the roof.
Three layers fix it:

1. **Grid anchoring** — the detection image carries a labeled 10% reference
   grid, so the model reports coordinates against visible lines instead of
   guessing proportions.
2. **Edge snapping** — client-side Sobel edge detection slides each line onto
   the strongest real image edge nearby. Roof-against-sky is the strongest
   edge in a typical photo, so this is very reliable. Costs nothing, no API
   call. (Tested: a line drifting 24px into the sky snaps to within 1px.)
3. **AI verification pass** — the lines are drawn *on* the photo and sent back
   once: "do these sit on the real edges? correct any that don't." Models
   judge an overlay far better than they emit blind coordinates.

If detection finds nothing in the chosen zones, the tool says so plainly and
sends you to manual marking — it never produces a silent empty quote, and it
doesn't spend image credits on a failed run.

### Step-by-step (when you want control)

One scrolling page, no gates: **Property → Draw the Lights → Measurements →
Mock-Up → Price Sheet.**

1. Type the address, hit **Find** — imports Street View + satellite together.
2. Design the lights: **Auto-Detect** alone (proposes editable candidates),
   **dictate** into the describe box (Wispr Flow or OS dictation), or **draw
   manually** (always works, always wins).
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

## How measurements are produced (accuracy chain)

Six layers, in order — each one narrows the error:

0. **Satellite ruler (most accurate).** Drag along any roof edge on the
   satellite image and get exact feet. No AI is involved at all — the tile's
   ground resolution is known, so it's arithmetic. Use it as a measurement
   directly, or as the calibration source for everything else. Rows added
   this way are marked exact and are never rescaled afterward.

1. **Dual-source analysis.** The AI receives the front photo, the markup, and
   the satellite image together. It measures only marked sections, matching
   each one between the two views, and tags every row with the source it
   used (`photo`, `satellite`, or `both`).
2. **Satellite scale calibration.** Google satellite tiles have an exact
   feet-per-pixel at any latitude, so the building's front width is computed
   with pure geometry — no guessing — and every AI measurement is rescaled to
   match. Guard rails reject implausible traces rather than applying them.
3. **Direct edge measurement.** The traced footprint's street-facing edge IS
   the front roofline (plus eave overhang, configurable). When it agrees with
   the photo estimate, the measured value replaces the estimate outright; when
   it disagrees wildly, the tool warns instead of silently swapping.
4. **Pitch correction.** Satellite measures flat (plan) distance, so sloped
   runs — rakes, gables, dormers — are multiplied by √(1+(pitch/12)²) to get
   true surface length. Eaves, ridges and ground runs are already horizontal
   and are never corrected. Every correction is shown in the row's basis.
5. **Dimensional strand math.** Bushes and trees are never priced from width
   or height alone (see below).
6. **Human review.** Nothing is priced until you've seen it. The AI estimate
   and the final value are both kept and both visible.

Safeguards: duplicate sections are dropped, unselected marks are never
measured, garage rooflines price as rooflines, low-confidence rows stay
flagged (calibration corrects *scale*, so it can't clear an occlusion
warning), and rows you've edited are never silently rescaled afterward.

## Learning from finished jobs (Accuracy tab)

After each install, record what the tool estimated versus what the crew
actually used. The tool computes its own bias per zone type using the
**median** ratio (so one mistyped job can't skew it) and shows a suggested
correction factor. Factors are applied only when you press the button, only
for zone types with 5+ recorded jobs, and never to rows you've reviewed or
measured exactly.

This is measured data rather than model tuning, and it's the accuracy source
that keeps improving on its own. Export the records any time for backup.

## Capture options

- **Find** imports Street View + satellite together, and additionally pulls
  two extra Street View angles (±35° from the true house-facing bearing).
  Extra angles give the AI depth cues for bushes and trees and reveal side
  rooflines; click any thumbnail to make it the working photo.
- **Sat detail** selects satellite zoom. Standard (z20) suits a typical lot;
  High (z21) doubles the resolution for small or urban lots. The zoom used is
  recorded with the project so the scale math stays exact.

## Bush, shrub & tree strand math

Strand counts come from real dimensions and the selected gap — a tighter wrap
costs more, a wider gap costs less, and every number is explained in the
price sheet.

**Bushes/shrubs** use width × height × depth with a lighting pattern:

| Pattern | Footage |
|---|---|
| Wrap around | `(height ÷ gap) × π × avg(width, depth) × taper` |
| Surface coverage | `(front area + half top area) ÷ gap` |
| Branch style | surface × 1.35 |

**Trees** use trunk and branch dimensions, never height alone:

| Style | Footage |
|---|---|
| Trunk wrap | `(trunk height ÷ gap) × trunk circumference` |
| Branch wrap | `branches × (branch length ÷ gap) × branch circumference` |
| Trunk + branches | both |
| Canopy / net | `π × (canopy width ÷ 2)² ÷ gap` |

Footage ÷ strand coverage (14 ft, configurable) → **always rounded up** to
whole strands. Bushes are capped by size class to stop photo geometry
overcharging ordinary shrubs; trees are not capped. Gap presets (tight 4",
standard 6", wide 10") are editable in the Pricing Guide.

Every plant and tree row has a ⚙ editor for dimensions, pattern/style, gap,
and a direct strand override — and the override always wins.

## Roof complexity

**Roof complexity is one setting per property**, not per zone — a house can't
be Easy and Hard at the same time. The AI estimates the roof pitch, classifies
it (Easy under 4/12 · In-Between 4–6/12 · Hard 7/12+, matching the price
guide), and shows its reasoning. Changing the setting in the Measurements
section instantly re-prices every roofline zone. Ridge and side rooflines keep
their own rates and are unaffected.

> The former peak calculator (gable base width → derived rake length) has been
> removed at the office's request. Rake and gable edges are now measured as
> they appear and cross-checked against the satellite footprint.

## Tests

```
node tests/pricing.test.js     # 35 assertions
node tests/geometry.test.js    # 80 assertions
node tests/feedback.test.js    # 15 assertions
```

Pricing: dimensional strand math, spacing effect on price, manual overrides,
garland rounding, job minimum, pillar wraps, blank-price refusal, upcharges,
material cost, additive migration.
Geometry: satellite scale math, footprint→front width, calibration guard
rails, complexity classification, zone→price mapping (including the
garage-eave case), and bush/tree footage responding to every dimension and
gap setting.

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
