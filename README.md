# Election Map Studio

A map maker for election results. Colour countries by party, pick a projection,
and export a shareable PNG with a headline, a results bar and a legend.

v2 is split into ES modules and **served over HTTP** — ES modules and `fetch`
do not work from `file://`, so opening `public/index.html` directly will show a
blank map.

```bash
npm install
npm run dev          # http://localhost:5173
```

## Layout

```
public/index.html            markup
public/styles.css
public/vendor/*.js           d3-array, d3-color, d3-interpolate, d3-geo,
                             topojson-client (UMD globals)
public/data/world-50m.topo.json
src/state.js                 the document: parties, assignments, metric, undo
src/metrics.js               metric domains, the HCL ramp, binning
src/families.js              ParlGov party families and their colours
src/archive.js               governing.json lookups, election files
src/vintage.js               boundary vintage, and the border-change warnings
src/import/parse.js          TSV/CSV, and the number traps
src/import/match.js          deterministic matching, learned aliases
src/import/proposal.js       the Proposal shape, warnings, apply
src/import/adapters.js       clipboard, Wikipedia and archive adapters
src/import/wikipedia.js      MediaWiki API, table scoring, reading results
src/geo.js                   projections, region fitting, hit testing
src/render.js                drawMap() — the one draw function
src/export.js                composite: title, map, results bar, legend, handle
src/ui/*.js                  panels, review screen, boundary layer picker
scripts/dev-server.js        static server (serves public/, mounts /src)
scripts/build-admin1.js      per-country admin-1 boundaries from Natural Earth
scripts/fetch-parlgov.js     vendors the ParlGov release
scripts/build-parlgov.js     normalises it into the archive
scripts/build-geoboundaries.js  one country at a time, from geoBoundaries
scripts/lib/registry.js      the boundary registry
scripts/lib/rewind.js        ring winding, because sources disagree about it
scripts/lib/verify.js        geometry invariants, as hard build failures
scripts/verify-boundaries.js re-checks every layer already on disk
scripts/build-constituencies.js constituency boundaries, one country at a time
scripts/measure-redraw.js    how much ground moves under a seat name in a redraw
scripts/make-series.js       generates a run of frames plus its manifest
src/series.js                a run: one frame, one palette, one manifest
src/flags.js                 which unit gets which flag, loading, the export guard
src/flag-codes.js            the ISO code table (generated, committed, reviewable)
src/ui/shell.js              mode, the phone sheet, the tablet fly-out, party colour
scripts/build-flags.js       bundles only the flags the code table can reach
src/import/partition.js      which matched units a stranded row makes partial
src/import/renames.js        gazetted renames, for the partition probe only
```

### The rule that matters

The screen and the exported PNG both go through `drawMap()` in `src/render.js`,
at different scales. Two drawing paths drift apart within a week. If you need
the export to look different, add an option to `drawMap` — do not write a
second renderer.

## Colouring by a number

Each assignment is a record, not just a party:

```js
assign['France'] = { party: 2, vote: 41.2, seats: 52, turnout: 68.4, margin: 9.1 }
```

"Colour by" picks which of those drives the fill. Three decisions in
`src/metrics.js` are deliberate:

- **The ramp runs in HCL, not sRGB.** Interpolating two hex values in RGB drags
  the midtones through mud and two parties' ramps meet in the same murky grey.
  HCL holds the party's hue while lightness and chroma move.
- **Every metric has its own domain** — vote 30–70%, seats 30–85%, turnout
  35–90%, margin 0–35 pts. A 55% vote share is a landslide; a 55% turnout is
  unremarkable. One shared 0–100 scale would flatten both.
- **Five bins, not a continuous gradient.** A continuous ramp cannot be read off
  a phone screen and cannot be labelled in a legend.

Turnout is party-neutral: it uses one hue no party uses, so a turnout map is
never misread as a result.

The legend changes shape to match — a swatch row for flat party colours, a
graded strip per party with the domain underneath when a metric is driving the
fill. Every party on the map gets a strip, on screen and in the export: a
colour with no legend entry is a colour the reader cannot decode.

## Tests

```bash
npx playwright install chromium   # once
npx playwright test
```

`tests/export-parity.spec.js` is the standing gate on the split. It writes a
patched copy of `election-map-studio.html` (the original single-file v1, kept
at the repo root as the reference), exposes v1's `composite()`, and compares
its PNG with v2's across three projections and three export sizes. With the
metric on "flat" they must be byte-identical — everything v2 added rides on top
of that path without moving it. The suite also checks that each metric renders
differently, that the ramp is monotonic and stays on the party's hue, and that
v1 save files still open.

Keep `election-map-studio.html` until that test is retired.

`tests/parse.spec.js` covers the number traps, one test per form.
`tests/import.spec.js` runs the pipeline end to end against two tables really
copied out of Wikipedia — an English one where most rows should just match, and
a Czech one whose names must be fixed by hand and then remembered.
`tests/archive.spec.js` drives the archive through the adapter, which is the
check on whether the abstraction is real.
`tests/layers.spec.js` covers the registry, the layer model, the stable keys,
the alias key migration, per-boundary licences and the Bangladesh acceptance
case against both sources.
`tests/integrity.spec.js` covers the geometry invariants — including the real
un-rewound file from milestone 7, which must fail the build — and the partial-unit
machinery.
`tests/wikipedia.spec.js` runs against raw API responses captured from the
real thing into `tests/fixtures/wikipedia/` — nothing in the suite touches the
network. The Bangladesh and Nigeria fixtures are there because their table
choice is genuinely ambiguous, and the suite asserts the ambiguity is
surfaced rather than guessed at.

`tests/vintage.spec.js` is the milestone 10 case: 2019 Westminster results on
the 2024 seats. 439 of 651 rows match by name, nothing strands, and the map
would draw as though nothing were wrong — see
[docs/vintage-stress.md](docs/vintage-stress.md) for what was measured and why
applying is now refused outright.
`tests/series.spec.js` checks a run: that the projection is identical across
frames, that the legend reservation is what keeps it that way, that families
hold their colours, and that the manifest accounts for every frame's sources,
licences, coverage and gaps.

`tests/flags.spec.js` holds flags mode to what it claims: every selected unit
in a ten-country export has more than one colour inside its outline, at 1600
and at 500 wide; micro-states become visible discs; a unit with no ISO code is
drawn in the unassigned tone without error; an export that has not awaited its
flags throws instead of drawing blanks; and results exports are unchanged
whatever the flag selection holds.
`tests/responsive.spec.js` runs the layout at 360, 390, 768, 1024, 1440 and a
phone on its side, writing a screenshot of each to `tests/shots/viewports/`, and
checks overflow, 44px touch targets, the sheet's snap points, painting three
countries using only the peek row, full-screen export and review on a phone,
reduced motion, and that switching party is visible everywhere at once.

`npx playwright test shots` writes one export per metric to `tests/shots/`.
It asserts nothing — it is there to be looked at. Projection and legend-layout
bugs show up in a picture and never in a unit test.

## Getting data in

One pipeline, whatever the source:

```
source adapter → Proposal → review → apply
```

An adapter turns some input into a draft and **declares the fields it needs as
data**, so the review screen renders them without knowing what the adapter is.
There are three — clipboard, Wikipedia and the ParlGov archive — and they
share one review screen, one matcher and one apply. Wikipedia was added as an
entry in `src/import/adapters.js` and a `propose()` that calls the MediaWiki
API: no new screen, no second apply path, no second place a wrong name can
slip through.

An adapter that needs a decision mid-flight returns a choice instead of a
draft:

```js
{ choose: { name, prompt, options: [{ value, label, detail, note }] } }
```

The review screen asks, then calls `propose()` again with the answer added.
That is a step in the contract, not a screen — the Wikipedia adapter uses it
twice, for the article and for the table, and `src/ui/review.js` still has no
idea what a wiki is.

### Parsing

TSV first — that is what a spreadsheet selection and a table copied from a
rendered web page both produce. CSV with quoted fields, and semicolon files,
work too.

Column roles are **guessed and then shown as dropdowns**, never applied
silently. Silent guessing is how a "change since last election" column quietly
becomes turnout.

The number parser handles `45.2%`, `45,2 %`, `1,234`, `1 234` with a
non-breaking space, `1.234,5`, `−3.2`, and the non-values `—`, `–`, `N/A`,
`New`, `-`. Reading `45,2` as `452` produces a plausible-looking number that is
wrong by a factor of ten, so every form has a test. A cell that cannot be read
gets a note on its row; it is never silently zero.

### Matching

Four steps, in order, stopping at the first hit: exact name → an alias this
person taught us for this country and layer → the built-in alias table →
normalised exact (lowercase, diacritics stripped, punctuation removed,
whitespace collapsed, trailing parenthetical dropped).

Then it stops. **Fuzzy matching never auto-applies.** It only ranks the choices
inside the dropdown of a row someone is already fixing by hand. A correction
made by hand is stored as a learned alias scoped to that country and layer, so
the next import of the same source matches clean.

### Review and apply

Counts up front — matched, ambiguous, unmatched, duplicate — with failures
sorted to the top of the row list. Warnings, not silent passes, for: two rows
resolving to one unit, vote shares summing well past 100, two party names
collapsing into one slot, and units already on the map the table is silent
about.

Applying **merges** and never clears a unit the table does not mention;
"Replace everything" is a separate, explicit checkbox. Matched rows apply even
when others fail, and the failures stay on screen to be fixed and applied
again. The whole apply is one undo entry.

### Wikipedia

For the countries no structured source covers — Bangladesh, Nigeria, Indonesia,
Peru, Kenya. Search for an article or paste its URL; the winning party goes on
the map with its vote share, seat share, turnout and margin where the article
carries them. Non-English wikis work and are often the better article.

Two decisions are handed back rather than taken, because a confident wrong
answer here produces a map that looks right and is false:

- **Which article.** Titles are not constructible: "2024 Bangladeshi general
  election" uses an irregular demonym, India numbers its Lok Sabha ordinally,
  and general / parliamentary / legislative are not interchangeable. Searching
  for Bangladesh 2024 now also returns a 2026 election that did not exist when
  this was written, which is the argument in one line.
- **Which table.** The Bangladesh 2024 article holds 22 tables, ten of them
  per-division results shaped almost exactly like the national one; the Nigerian
  2023 article holds a primary table for every party that ran one. Candidates
  are scored on their headers and the heading they sit under, the choice is
  always shown with the reasons it scored, and when nothing scores well the
  adapter refuses and points at the clipboard adapter instead.

Column roles come from the data, not the header: results tables stack headers
two deep and span them four columns wide, so once the HTML is flattened the
header no longer lines up with anything.

**Provenance.** The revision id is recorded, not just the title, and the export
footer carries the permalink to that exact revision plus the CC BY-SA
attribution. Wikipedia changes; a map citing a title cites something that can
have moved by the time a reader checks it. Articles are cached by revision for
the session, so re-running a year costs no requests.

## Boundary layers

A document has a layer. `world`, or a boundary source: `ne:BGD:ADM1`,
`gb:BGD:ADM1`, `gb:BGD:ADM2`. `CONSTITUENCY` is the same shape and is not
built yet.

```bash
npm run build:admin1                              # Natural Earth, 251 countries
npm run build:boundaries -- BGD:ADM1 BGD:ADM2     # geoBoundaries, one country
node scripts/build-geoboundaries.js --list BGD    # what levels exist
```

### A boundary set is not a constant

Natural Earth's admin-1 has **seven** Bangladeshi divisions. There have been
**eight** since Mymensingh split from Dhaka in 2015. The app used to print
"present-day boundaries" under every map and nothing in it could have told you
which countries that was untrue of.

So a boundary set has a source, a vintage, a licence and an agency, and
`public/data/boundaries.json` records all four per country and per level:

```
ne:BGD:ADM1    7 units · year not stated · Natural Earth · public domain
gb:BGD:ADM1    8 units · represents 2015 · geoBoundaries, Wikimedia Commons · CC0 1.0
gb:BGD:ADM2   64 units · represents 2020 · Bangladesh Bureau of Statistics · CC BY 3.0 IGO
```

Every field comes from the source's own metadata. Natural Earth states no year
per country, so its vintage is **null** rather than a guess — that null is the
honest form of the thing that used to be a fixed string.

**Licence is per boundary.** Bangladesh's divisions are CC0 and its districts
are CC BY 3.0 IGO — the same country, two levels, two licences, and share-alike
terms elsewhere in the open release are not interchangeable with either. The
export prints the licence belonging to the boundaries it actually drew. Read
each one's terms; nothing here is legal advice.

**Picking a source.** When a country has more than one, the picker lists them
with unit counts and vintages side by side, newest first, so "7 units, year not
stated" next to "8 units, 2015" answers itself. The older set is never hidden:
the Natural Earth files are vendored, offline and frozen, which is what makes an
export reproducible.

Each source keeps its own assignments and its own learned aliases, because two
sources for one country disagree about which units exist at all.

### Coverage integrity

```bash
npm run verify:boundaries    # every layer in the registry, not just new ones
```

The blob that shipped in milestone 7 passed fourteen tests, because every one of
them asked about names, counts and metadata and none asked **how much of the
Earth the map was claiming**. `d3.geoArea` answers that, and three invariants
now stop the build:

- a layer may not total more than half the sphere (Russia, the largest real
  layer, totals 0.416 sr)
- no single unit may exceed 0.5 sr (Antarctica, the largest real unit, is
  0.3014; a reversed ring is about 12.5)
- the unit count must match what the source's metadata claimed

The limits come from measuring all 253 layers, not from taste. A fourth check —
no unit may have zero area — found two layers where simplification had quietly
shrunk an island until its ring had none left; the build now backs off rather
than destroying a unit to hit a size target, because a unit that draws nothing
still appears in the picker and the match index.

### Partial units

Stranding a row is not always a local failure. Bangladesh's Cumilla and Faridpur
are Election Commission groupings carved out of divisions that *did* match, so
the Chattogram row does not describe the Chattogram polygon — it describes
Chattogram minus Cumilla, and the map fills the whole polygon with it.

`src/import/partition.js` catches that. A stranded name is looked up at a
deeper level of the same country; if it resolves, its centroid decides which
matched unit contains it; that unit is marked partial and records what it
excludes. The export prints it as a footnote — *Chittagong excludes Cumilla* —
and not as a fill pattern, because hatching already means "no party family" and
a second pattern would read as a third category.

The probe is allowed to try a name without its level word and either side of a
gazetted rename, which the matcher is not. The two answer different questions:
the matcher decides what colour a region gets, and the probe's answer has to
survive an independent geometric test before anything is claimed. Nothing is
claimed about a stranded name that resolves nowhere.

### Ring winding

d3-geo treats polygons as spherical, where a ring's direction decides which
side is inside, and its convention (clockwise exteriors) is the opposite of
GeoJSON's own spec. Natural Earth ships clockwise; geoBoundaries ships
counter-clockwise. An unrewound ring renders as a planet-sized blob of one
colour and looks nothing like a data bug. `scripts/lib/rewind.js` normalises
every source on the way in.

### Boundaries have a date, and it is not the election's

The registry says what year a boundary set represents. `src/vintage.js` holds a
short hand-written table of when borders actually changed — Germany, the USSR,
Yugoslavia, Czechoslovakia, Sudan, Eritrea, Yemen. They do different jobs, and
the warning is sharper for having both: not "these borders may be wrong" but
"this map is dated 1977 and is drawn on boundaries representing 2015". The
export dialog says it before the image exists.

This is not a history of borders and does not pretend to be.

### Bangladesh, which is the case this was built against

The 2024 article carries ten per-division results tables, offered as one choice
and read one row per division.

| | Natural Earth | geoBoundaries |
|---|---|---|
| units | 7 | 8 |
| tables that can land | 7 | 8 |
| stranded | Cumilla, Faridpur, Mymensingh | Cumilla, Faridpur |

Mymensingh now has somewhere to go. **Cumilla and Faridpur still do not**, and
they are not a data gap: they are the election commission's own groupings for
administering the poll, and they are not divisions in anybody's boundary set.
The honest outcome is that they stay off the map.

## Historical archive

```bash
npm run fetch:parlgov     # vendors the release into data/raw/parlgov/ (gitignored)
npm run build:parlgov     # writes public/data/elections/ and public/data/governing.json
```

The source is the [ParlGov](https://www.parlgov.org/) 2024 release from Harvard
Dataverse — 37 EU and OECD democracies, 1900–2023, 1,707 parties, 9,016 election
results, 1,621 cabinets. It is a static academic release, not an API: it is
downloaded once and never fetched at runtime. **Its licence is CC0 1.0**, so
attribution is not a legal condition, but it is a scholarly one and every
archived election carries a `source` block that the export renders.

Three outputs:

- `public/data/elections/<ISO3>.json` — every election that country has, one
  row per party, with vote share, seats, party family and left–right position.
- `public/data/elections/index.json` — country, date, election type, party count.
- `public/data/governing.json` — the derived one, and the point of the exercise.
  Per country, a list of cabinets as half-open date intervals with the parties
  in them and which one holds the prime minister. That answers "who governed
  country X on date Y" as a lookup, for every year since 1900.

Pick **Import → Historical archive**, type a year, and the map is drawn from it —
through the same review and apply as a pasted table. Scope it to a region so the
assignments, the frame and the legend all describe the same set of countries.

### What the archive refuses to do

- **No carry-forward.** A country with no cabinet recorded on the requested
  date renders unassigned. Spain in 1977 is blank because ParlGov starts Spain
  at democratisation, not because nothing happened there.
- **No open-ended extrapolation.** The last cabinet in each country has
  `to: null`, meaning "still in office as far as this release knows". Asking for
  a date past the release's end returns nothing rather than treating that
  cabinet as eternal.
- **No invented families.** ParlGov's `none` and `code` codes are not party
  families. They arrive as `family: null`, render in a neutral grey, and the
  panel says how many there are so you can colour them by hand.
- **No silent sparseness.** The export footer carries `18 of 32 countries in
  frame · Source: ParlGov 2024`. The denominator counts countries the reader can
  actually see: "23 of 37" counted Japan and Canada against a map of Europe,
  which is a number about nothing.
- **No second grey.** "Governed, but no party family" is hatched, not greyed. A
  second grey next to unassigned land says "no data", which is a different
  claim and a wrong one.
- **No borrowed frame.** An archive map fits the projection to its own assigned
  units, so every year frames itself as coverage changes.

Colour comes from party family (`src/families.js`), spread around the hue wheel
so nine families stay separable at thumbnail size rather than following national
convention. **By family** groups the legend into blocs — the map you would post;
**by party** keeps every governing party separate. Recolouring a party stores an
override keyed by that party, not the resulting map, so re-running a year or
switching grouping never wipes a colour choice.

## Sub-national boundaries

`scripts/build-admin1.js` downloads Natural Earth admin-1 once into `data/raw/`
(gitignored), splits it by `adm0_a3`, and writes one quantised TopoJSON per
country into `public/data/admin1/`, plus a `public/data/index.json`.

```bash
npm run build:admin1                      # 10m — ~4,600 units, 40 MB download
node scripts/build-admin1.js --res 50m --only USA,BGD
```

Each country is simplified and quantised down until it fits the size target
(150 KB by default), giving up arc points before coordinate precision. The
index is keyed by ISO3 with a `layers` map, so a country can carry a
`constituency` layer alongside `admin1` later without reshaping the format;
a rebuild preserves layers it did not generate.

Natural Earth stops at provinces. Constituency boundaries — Bangladesh's 300
seats, UK constituencies, Indian assembly segments — each need their own source
and carry their own licence, and get added one country at a time.

## Constituency layers

```bash
npm run build:constituencies              # lists what has a recorded source
npm run build:constituencies -- GBR       # 650 Westminster seats, 384 KB
```

There is no global source for this level. Availability, format, licence and
vintage vary per country, and several boundary commissions publish only PDF
maps. `docs/constituency-sources.md` is the written survey of five countries,
with a `verified?` column and the ones that could not be confirmed left
unfilled rather than guessed at.

The United Kingdom was built first because its open data is the cleanest, not
because it is the country that matters most here — the ONS publishes the
boundaries, and Wikipedia's list of MPs names the seats identically, so the
match is 650 of 650 with no aliases. Bangladesh, which this account actually
needs, has no open constituency boundary file at all; that finding is in the
survey and is a real answer, not a gap.

Nothing in `src/` changed to make a 650-unit layer load, key, frame, match or
export. `scripts/build-constituencies.js` fetches, rewinds, simplifies,
verifies and registers exactly the way `build-geoboundaries.js` does, and
writes the same `objects.units` shape the loader already reads. What did have
to change is listed in the survey, and it is short: an area *ratio* instead of
an absolute ceiling, a finer quantisation ladder, a footer that can pluralise
"constituency", and two new review warnings.

**Scale broke three things, none of them the map.**

*Quantisation.* Quantising lays a grid over the layer's bounding box. Across
the UK, 1e5 is a 15-metre grid, and a constituency ring with vertices closer
than that collapses onto itself: eleven of the 650 came out inside-out at 1e5
and five at 1e6. The ladder starts at 1e7 now. The ratio check caught every one.

*Simplification.* Every step of the usual ladder tripped the 0.90 area floor on
small island seats long before the file got small enough. The answer was not a
looser floor but a better source: the ONS publishes its own ultra-generalised
build (BUC), and 5.1 MB became 384 KB with nothing ground away. A source that
already publishes the generalisation you want is the source to take.

*Winding.* A planar shoelace test is not good enough at this size. On a ring
whose planar area is near zero the sign is meaningless, and one ONS unit came
out of a shoelace rewind covering the entire sphere. `rewind.js` now asks
`d3.geoArea` — the same function that will later decide what the polygon means.

### The column that is not the one you want

The MPs table carries the 2019 notional affiliation three columns left of the
2024 winner, under headers that read alike. No heuristic can rank one above the
other, and picking the wrong one produces a map that is plausible, wrong, and
wrong in a way nobody would notice.

So the guesser does not pick. It names the unit column and leaves the party
column unset, and the review screen shows each column's real header — read off
the `<th>` markup, not inferred from whether the rows hold numbers — next to a
sample value from the column itself. "Column 5" is not a choice; *"Member
returned in 2024 / Labour"* is.

Declining to guess opened a quieter hole, which is now closed too: with no
party column the MPs table still matched 650 of 650 and reported four clean
counts, because a matched unit really is matched. Applying that paints 650
units with no winner — a map that looks unfinished rather than wrong. The
review says so before Apply.

### Two warnings that only matter at 650 rows

A near-duplicate party check: the MPs table writes "Scottish National" in seven
rows and "Scottish National Party" in two, which without a warning becomes two
legend entries, two colours and a party's seats split across them. At eight
rows a person sees that; at 650 they do not. The rule is a whole-word prefix
and nothing cleverer, it never merges anything, and it says only that two
entries will exist.

A results-against-boundaries check: `resultsVintageWarning` compares the
document's date with the year the boundary set represents. The hand-written
table of border changes cannot reach below the country — the UK redrew all 650
of its seats for 2024 and no list of named events would catch it — so below
that level the arithmetic is the whole warning. It fires in both directions,
stays quiet within a year, and says nothing at all when a boundary set has no
stated vintage, because that is not the same as no gap.

## Series

```bash
npm run series                                # 1945-2023, Europe, by family
npm run series -- --from 1970 --to 1980
npm run series -- --step 5 --grouping party --out build/decades
```

A range and a step produce one PNG per frame plus `manifest.json`. The frames
are drawn by the app, in a real browser, through the same `composite()` the
export dialog calls — `scripts/make-series.js` owns none of the decisions, so a
run and a hand-exported map cannot drift apart.

Two things are decided for the run rather than the frame, and `src/series.js`
exists to decide them.

**The frame.** Fit-to-data is right for one map and wrong for a sequence:
coverage changes year to year, so per-frame fitting makes the map twitch, which
is the one thing that ruins a run. A series fits once, to the union of every
frame's coverage, and every frame uses it. `composite()` reports the projection
it actually used, so "the frame did not move" is a measurement rather than an
intention — comparing rendered pixels cannot answer it, because an antialiased
coastline is a blend of the ocean and whatever is inland of it, and a country
changing colour changes its edge pixels without moving at all.

**The palette.** Every family gets its slot before frame one, whether or not it
governs anywhere that year. Colours assigned in the order parties happened to
appear would drift, and a family's colour changing halfway through a sequence
says something about the data that is not true.

### The legend moves the map

Non-obvious, and it took measuring to see. The map is drawn into whatever is
left after the footer, and the footer's height depends on how many legend rows
a frame needs. Coverage climbs from 10 governments in 1945 to 31 in 2023, and
distinct party families climb from three to nine; nine do not fit on one row
where three do. Without a reservation the footer grows a row partway through,
the map box shrinks by ~30px, and the whole of Europe gets quietly smaller. A
series computes the tallest legend in the run and pins every frame to it.

### Honesty across a run

The viewer sees the frames, not the notes, so everything true about a frame
that the picture cannot carry goes in the manifest, per frame: the date,
coverage count against the universe, source, licence, boundary agency and
vintage, and the named border changes that frame draws over. Plus, for the run:
the locked frame and legend rows, every licence in play, and which frames rest
on boundaries that state no year.

Coverage in particular. A run that starts sparse and fills in is telling a story
about what ParlGov recorded, and without the count on every frame it reads as a
story about politics.

## The archive fills its own gaps

Generating the run found a real error, and a bad one. Cabinet intervals are
derived — a cabinet's end is the next one's start — so the last cabinet before
a silence in the record expands to fill the silence. The archive was asserting
that the NSDAP governed Germany until September 1949 and that a chancellor
assassinated in 1934 governed Austria until 1945.

`MAX_CABINET_YEARS = 6` in `src/archive.js`: past six years from its own start,
a derived interval is the record running out rather than a cabinet still
sitting, and the country goes uncovered with a reason of `record gap`. Six is
measured — across 1,584 intervals the longest genuine one is Canada's Borden
ministry at 6.0 years, and every longer interval is a gap.

The separation is that tight, so the rule catches less than it looks like it
should, and [docs/archive-gaps.md](docs/archive-gaps.md) names the two cases
that survive below the cap rather than tuning the threshold until they vanish.

A single map never touches any of this. It took putting the 1940s on screen,
which is an argument for generating runs rather than samples.

## Flags

```bash
npm run build:flags          # regenerates src/flag-codes.js and public/flags/
```

One rule governs this: **on a results map the fill is the data.** A flag never
replaces a party colour there. Flags add colour everywhere else.

### Flags mode

A second map mode beside Results, for maps that are not about results — who
votes this year, who votes in the same week, which countries have been covered,
a teaser before a results post. Selecting works exactly as painting does, but
into its own selection (`state.flagged`), never into `state.assign`: switching
mode cannot cost anyone a finished results map. Unselected countries stay in the
land tone, so the map reads as "these countries" and not a wall of flags.

**Codes, not names.** The world topology carries ISO 3166-1 numeric codes; the
registry carries alpha-3. `scripts/build-flags.js` maps both to alpha-2 through
`i18n-iso-countries` and writes the result as `src/flag-codes.js` — generated,
but committed, so every mapping can be read. A unit gets a flag only when its
own code resolves. No name matching, no fallback flag. Kosovo, Somaliland,
Northern Cyprus, Siachen and the Indian Ocean Territories carry no code in the
boundary data and get none — flag-icons ships an `xk` flag, and the tool uses
it only if the data says so. Seventeen registry countries use Natural Earth's
private alpha-3 codes (`SDS`, `PSX`, `SAH` …) rather than ISO ones and get no
flag either; mapping them would be the tool choosing codes the data does not
assign. flag-icons' non-ISO sets (`eu`, `un`, `gb-sct`, `es-ct`) are unreachable
and not bundled. Only the 238 flags the table can reach are copied, in both the
4:3 and 1:1 sets, with flag-icons' MIT licence beside them.

**Drawing.** Every polygon of a unit is clipped to its outline and gets the flag
cover-fitted to its own box — never stretched, so Chile and Norway show a slice
of their flag rather than a distorted one, and French Guiana carries a small
tricolour of its own instead of France's flag stretched across the Atlantic.
A unit becomes a round flag disc, ringed in the background colour, when its
fill would show less flag than the disc does. The first version asked only
whether the unit's box was smaller than the disc, and at 500px wide that left
Italy, France and Spain as slivers — a boot a few pixels across showing a slice
of a flag. Area is the honest test: under twice the disc's area, it is a disc.
Unassigned land is darker in flags mode than in results mode (`#243039`), for
the same reason: against the ordinary land tone a handful of flags read as noise.

**Casing.** Flags are full of white and pale stripes, and two touching —
Poland's against Czechia's, Indonesia's against Malaysia's on Borneo — lose the
thin mesh border results mode uses. Every flagged unit gets a heavier dark edge.
The reference design files carry no casing specification (the design canvas
strokes borders once, in `#0D141C`), so this one was designed here.

**The export race.** An SVG decodes asynchronously. A composite that draws
before every flag is ready ships a PNG with blank countries and no complaint.
So `prepareExport()` awaits every flag the frame needs and throws, naming them,
if any fails; and `composite()` itself calls `assertFlagsReady()` and throws
`FLAGS_NOT_READY` rather than drawing a blank. The export dialog awaits the
first before drawing anything, preview included. On screen, a flag still
decoding shows as land and the map redraws when it lands.

**Results mode is untouched.** The fill code that ran before flags existed is
the `else` branch, unchanged, and the v1 parity gate still passes byte for byte
at every size and projection — the proof that flags never leaked into results.

### Flags as colour in the interface

A small flag beside each row of the country list and search results, the review
screen (the flag of the unit a row matched to), tooltips, and the layer picker —
which is now a searchable list rather than a `<select>`, because an option
cannot carry an image and 234 bare names is the one place a flag does real work.
Exports of **single-country layers** carry a flag badge beside the headline; the
world map does not. That badge is the one deliberate change to results exports,
and it is confined to the title rows: compared with exports captured before this
milestone, every differing pixel of the UK constituency export sits in rows 57–98
of 900, and the map, bar, legend and footer are byte-identical.

Nothing is themed from a country's flag. Party colours often coincide with flag
colours — green in Bangladesh — and chrome in one party's colour reads as
endorsement on an elections account.

### Colour from the data

The active party's colour tints its row, its peek chip, its legend entry and
the painting cursor, so switching party is visible everywhere at once. The
results bar is taller and has room. Buttons, toggles and focus rings keep the
one neutral accent, amber, so a party colour is never mistaken for a control.

## Layout at every size

Breakpoints come from the content, not from devices:

- **≥1000 — desktop.** Rail 296 + legend 232 + a map worth having (~470).
- **700–999 — tablet.** The header still fits on one row; the rail collapses to
  icons and one group flies out over the map. A phone on its side (844×390)
  lands here too, which is right — a bottom sheet would eat a 390px-tall map —
  and a short-height rule compacts the header and bar.
- **<700 — phone.** The map first. Controls live in a bottom sheet that snaps
  to *peek* (party chips, so painting never needs it open), *half* (parties,
  search, layer) and *full* (everything, import included). Export and the
  import review go full-screen; the review's 650 rows become cards with the
  counts pinned.

The panels are the same DOM at every size; CSS decides which show where. Touch
targets are 44px wherever a finger is the pointer (`pointer: coarse`, or under
1000px wide); a desktop with a mouse keeps the compact rows. Nothing depends on
hover — a tap shows the tooltip. `prefers-reduced-motion` turns every transition
off, and the sheet pads for the safe-area inset so it clears the home indicator.

## Save format

`btnSave` writes the whole state object with a `version` field (currently 5),
learned aliases included.
v1 files have no `version` and store a bare party id per country; `migrate()`
in `src/state.js` turns those into records with empty values, so they open
unchanged.
