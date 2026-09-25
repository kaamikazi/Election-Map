# Election Map Studio — v2 brief

Hand this to Claude Code as the opening message. Put `election-map-studio.html`
(the v1 single-file tool) in the same folder first — it is the reference for
style, layout and the export pipeline.

---

## What exists

`election-map-studio.html` — a working, self-contained world election map maker.
Vanilla JS, no framework. Canvas 2D rendering via d3-geo, geography from
world-atlas 50m TopoJSON (241 countries), inlined into the file.

It does: click-to-colour countries by party, Flat / Globe / Mercator views,
region zoom presets, a stacked results bar, PNG export at 16:9 / square /
portrait, save and load as JSON.

Read it before changing anything. Keep its visual language: dark navy shell
(`#0D141C`), amber accent (`#E8B33A`), Helvetica-stack type, sentence case,
no all-caps labels.

## What v2 adds

### 1. Colour depth driven by a number

Right now a country is a flat party colour. In v2 each assignment carries an
optional value, and the fill is that party's colour ramped by the value.

Four metrics, switchable, one active at a time:

| Metric | Range | Notes |
|---|---|---|
| Winner's vote share | 0–100 % | ramp from pale to full party colour |
| Seat share | 0–100 %, or raw seats with a total | show both in the tooltip |
| Turnout | 0–100 % | party-neutral; use a single-hue ramp, not party colours |
| Margin over runner-up | 0–100 points | steepest ramp; near-ties should look near-white |

Design decisions to make explicitly, not by default:

- Ramp in **OKLCH or HCL**, not sRGB. Interpolating hex in RGB muddies the
  midtones and two parties' ramps will collide visually.
- Each metric needs its own domain. A 55 % vote share is a landslide; a 55 %
  turnout is unremarkable. Don't share one scale across all four.
- Bin into 4–6 steps rather than a continuous gradient. Continuous ramps are
  unreadable on a phone screen and unreadable in a legend.
- The legend must change shape per metric: a swatch row for flat party
  colours, a graded strip with tick labels for a ramped metric.

### 2. Sub-national maps

A second mode: pick one country, map its internal divisions.

**Data.** Province and state level comes from Natural Earth admin-1,
mirrored on GitHub (verified reachable):

- `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson` — 2.3 MB, ~1,400 units
- `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson` — 40 MB, ~4,600 units

Neither can be inlined. Write a Node build script that:

1. downloads the 10m file once into `data/raw/` (gitignored),
2. splits it by the `adm0_a3` property into `public/data/admin1/<ISO3>.topo.json`,
3. converts each to TopoJSON and quantises it — target under 150 KB per country,
4. emits `public/data/index.json`: ISO3, country name, unit count, file size.

The app then fetches one country's file on demand. This means v2 is served,
not opened from `file://` — add an `npm run dev` static server and say so in
the README.

**Constituency level** is a separate problem and should be a later milestone.
Natural Earth stops at provinces. Bangladesh's 300 parliamentary seats, UK
constituencies and Indian assembly segments each need their own source, and
licences differ per country. Design the loader so a country can have more than
one boundary layer (`admin1`, `constituency`) and the UI picks between them —
then add sources one country at a time rather than trying to solve all of them.

### 3. Data entry that scales

Clicking 300 constituencies one at a time is not viable. Add:

- **Paste a table.** Accept TSV or CSV pasted straight from a spreadsheet:
  region name, winning party, then a column per metric. Match names
  case-insensitively, strip accents and punctuation, and show an explicit
  "12 of 300 rows didn't match" panel with a dropdown to fix each one by hand.
  Fuzzy matching that silently guesses wrong is worse than an honest failure.
- **CSV import and export** using the same column layout, so a map can round-trip.
- Keep the existing JSON save format working, with a version field.

## Architecture

Split the single file. Suggested layout:

```
public/index.html
src/state.js        parties, assignments, metrics, undo
src/geo.js          projections, fitting, hit testing
src/render.js       one draw(ctx, w, h, opts) used by screen AND export
src/export.js       composite: title, map, legend, handle
src/ui/*.js         panels
scripts/build-admin1.js
```

The single most important rule from v1: **the screen and the exported PNG go
through the same draw function**, at different scales. Two drawing paths drift
apart within a week. Keep it that way.

## Milestones

1. Split v1 into modules, nothing new, verify the export is pixel-identical.
2. Metric values, ramps, and the metric-aware legend, world map only.
3. The admin-1 build script and per-country loading.
4. Paste-a-table import with the unmatched-rows panel.
5. Constituency layers, one country at a time, starting with Bangladesh.

Ship each one working before starting the next.

## Testing

There is no browser in the environment where v1 was built, which made bugs
expensive. On a PC you have one — set up Playwright early and screenshot the
exports after each change. A picture catches projection and layout bugs that
unit tests never will.
