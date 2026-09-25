# Constituency boundary sources — survey

Checked 18 September 2026. Order of search in every case: national election
commission → national statistics or open geography portal → HDX / OpenStreetMap
→ academic mirrors.

A cell says **unconfirmed** where the claim was plausible but I did not reach
the data itself. That is the milestone 8 standard: the Cumilla parentage was
verified against the districts' own articles before anything was built on it,
and the same rule applies here.

| country | source | format | licence | vintage | units | verified? |
|---|---|---|---|---|---|---|
| United Kingdom | ONS Open Geography Portal, `Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BUC` | ArcGIS FeatureServer → GeoJSON | OGL v3 *(portal terms; the service's own `copyrightText` is empty)* | May 2024 boundaries, used at the July 2024 election | **650** | **yes** — built from it: 650 features, fields `PCON24CD` / `PCON24NM`, 384 KB after quantisation |
| Ireland | data.gov.ie — several publishers, no single national constituency layer | mixed; CKAN listings | mixed: CC0, CC BY 4.0, CC BY-SA | varies by dataset (2013, 2016, 2020 listings seen) | unconfirmed | **partly** — searched the portal API and read the result titles and licences; did not open a boundary file |
| Pakistan | HDX, "National Constituency Boundaries — Pakistan", publisher ALHASAN Systems (a private company, not the ECP) | HDX dataset | CC BY IGO; a companion provincial set is CC0 | unconfirmed | unconfirmed | **partly** — found and read the dataset metadata; did not download, and did not establish which delimitation it represents |
| Kenya | HDX returns admin boundaries (OCHA, geoBoundaries) but no IEBC constituency layer in search results | — | — | — | unconfirmed | **no** — searched HDX; the IEBC's own portal was not reached |
| Bangladesh | **none found open** | — | — | — | — | **yes, as a negative** |

## Bangladesh: the finding

Bangladesh has 300 parliamentary constituencies. I could not find an open
boundary set for them.

- geoBoundaries `gbOpen` carries `ADM0=1, ADM1=8, ADM2=64, ADM3=544, ADM4=5160`
  for BGD — administrative units at five levels, and **no constituency level**.
  Constituencies are not administrative units and do not nest into these: a
  seat is drawn from upazilas, but the seat itself is not in the set.
- HDX has no Bangladeshi election or constituency boundary dataset. Searching
  `bangladesh election` returns WorldPop population rasters and nothing else.
- The Election Commission's own site (`ecs.gov.bd`) returns **403** to an
  automated request, so I could not check whether it publishes geometry. It is
  reachable in a browser, and commissions at this level of data maturity
  typically publish constituency maps as PDF. That specific claim is
  **unconfirmed** — I am recording that I could not check it, not that it is
  false.

So the country the account cares about most is the one with no open boundaries,
which is exactly the case the brief said to expect. Bangladesh's 300 seats are
not blocked on this app's machinery; they are blocked on someone publishing the
geometry.

## CLEA

The brief's results source is **not reachable**. `electiondata.org` serves a
domain-parking lander — 237 KB of it — rather than the archive, and Harvard
Dataverse does not carry CLEA under that name (a search returns unrelated
precinct-level collections). CLEA may still exist behind a registration wall or
at an address I did not find; what I can report is that the open path the brief
assumed is not open today.

Milestone 9 therefore takes its results from Wikipedia through the adapter that
already exists, which is the same pipeline CLEA would have used. Adding CLEA
later is a `propose()` and a registry entry, not a rebuild.

## What was built

**United Kingdom, 650 Westminster constituencies, 2024.** Chosen because it is
the cleanest open data of the five, not because it is the most interesting — the
brief's instruction, and the right one: proving the machinery on easy data and
then attempting hard data is faster than the reverse.

Boundaries from the ONS ultra-generalised (BUC) service, results from the
Wikipedia list of MPs at revision 1374073882. 650 units, 650 rows, 650 matched,
0 unmatched, 0 aliases needed — **because both sides take their names from the
ONS**; see the cost section below before treating that as a normal result.
Exported with source, licence and vintage in the footer:
`tests/shots/uk-constituencies-2024.png`.

The seat totals on the map are the real ones — Labour 411 (368 + 43 Co-op),
Conservative 121, Liberal Democrat 72, SNP 9, Sinn Féin 7, Independent 6,
Reform 5, DUP 5, Green 4, Plaid Cymru 4, SDLP 2, and one each for the Speaker,
Alliance, TUV and UUP.

## What it cost, and what the second country would cost

### Read this first: the UK is the best case, not a typical one

The numbers below say 650 of 650 and zero hand corrections. **Do not read that
as what a country costs.** It is the low end of a range whose high end is
"impossible", and the whole range is decided by one thing: whether the results
and the boundaries come from the same naming authority.

| situation | name reconciliation | seen in |
|---|---|---|
| results and boundaries share a naming authority | **0 corrections** | UK — ONS names the seats, Wikipedia copies ONS |
| results grouped differently from the boundary set | **8 of 8 by hand**, plus two units left partial | Bangladesh divisions — the Election Commission groups seats its own way |
| commission and mapping agency are separate bodies | **unknown, and worse than both** | not yet attempted; expect gazetted renames, level words, and transliteration variants at once |
| no open boundaries published | **not applicable — there is no map** | Bangladesh constituencies, Kenya |

Two of the five countries surveyed fall in the bottom row. The UK is in the top
row because of an accident of publishing practice, not because the app is good
at the UK.

The second-country estimate below assumes the middle rows, not the top one.

The brief asked for this number honestly, so here is what I can and cannot
measure.

**What I cannot measure:** wall-clock hours. I do not have a reliable clock on
my own deliberation, and guessing at "about four hours" would be inventing a
figure to fill a cell — the same thing the `verified?` column above exists to
prevent. What I can measure is the work itself.

**One-time machinery — done, and not repeated per country:**

| what | where | why it was needed |
|---|---|---|
| area ratio instead of an absolute ceiling | `scripts/lib/verify.js` | a ceiling tuned for provinces cannot see a constituency degrade |
| spherical rewind instead of planar shoelace | `scripts/lib/rewind.js` | one ONS unit survived a shoelace rewind covering the whole sphere |
| source-area baselines | `scripts/lib/areas.js` (20 lines) | the ratio needs something to be a ratio of |
| finer quantisation ladder + fine-quantum fallback | `scripts/build-constituencies.js` | 11 of 650 units inverted at 1e5, 5 at 1e6 |
| ArcGIS pagination | `scripts/build-constituencies.js` | the service caps a query at its own page size |
| unit-hit-rate table scoring | `src/import/wikipedia.js` | the MPs list has no votes or seats columns, so the results scorer rejected it |
| `<th>`-first header detection | `src/import/wikipedia.js` | the numeric heuristic ate a data row: 649 instead of 650 |
| trust the markup header, show headers + samples, refuse to guess a party column | `src/import/parse.js`, `src/ui/review.js` | the review offered "Column 1…7" for the one decision that decides the map |
| warn when no party column is set | `src/import/proposal.js` | 650 matched rows and four clean counts, and every unit blank |
| footer pluralisation | `src/export.js` | "650 constituencys" |
| near-duplicate party warning | `src/import/proposal.js` | the SNP's seats split across two spellings |
| results-vs-boundary vintage warning | `src/vintage.js` | no hand-written table can reach below the country |
| constituency baselines in the sweep | `scripts/verify-boundaries.js` | otherwise this layer is the one the sweep barely checks |

**Per-country work — what the second country actually costs:**

1. **The survey row.** Find the source, read its licence, establish its
   vintage, confirm the unit count. This is the real cost and it is not
   programming. For the UK it was one portal and one service. For Kenya I
   searched and came up empty; for Bangladesh the answer is that the data does
   not exist openly. **Hours, and sometimes the answer is no.**
2. **A `SOURCES` entry.** 15 lines of code in
   `scripts/build-constituencies.js`: service URL, id field, name field,
   vintage, expected unit count, licence, attribution. **Minutes.**
3. **Run the build.** Fetch, rewind, simplify, verify, register. It either
   passes the geometry check or it fails loudly. **Minutes, unattended.**
4. **A results source and the column choice.** Whichever table carries the
   winners, and a person deciding which column is the current result. **Minutes
   if the names match; longer if they do not.**
5. **Name reconciliation.** See the table at the top of this section. Zero for
   the UK, eight of eight for Bangladesh's divisions, unknown and worse where
   the election commission and the mapping agency are different institutions.
   **This is the variable that decides everything**, and it is the one that
   cannot be estimated before you try.

**So: does this scale?**

The machinery scales. Steps 2–4 are genuinely minutes, the geometry checks are
real enough to fail a bad build rather than ship it, and `src/` needed no
changes at all for a layer 80× larger than the previous biggest.

The sourcing does not scale, and no amount of code will make it. Two of the
five countries surveyed have no confirmed open constituency boundaries, and one
of those two is the country this account exists for. The honest summary is that
**this is now a one-day job per country where open boundaries exist, and an
impossible one where they do not** — and which of those a country is cannot be
discovered from a keyboard in five minutes. The survey is therefore the
deliverable that keeps paying; the build script is the cheap part.

A reasonable next move is not another country but a second UK election on the
same boundaries — 2019 results would exercise the vintage warning against a set
that was redrawn, which is a failure mode currently proven only by unit test.

**That was done, in milestone 10, and it found something worse than a missing
warning.** 439 of 651 rows matched by name, nothing stranded, the partial
machinery never ran, and the map drew 439 constituencies with nothing marking
which ones describe the ground that voted. Measuring the ONS's own pre- and
post-redraw sets: of 418 shared names, 332 changed ground, 173 lost more than a
tenth of it, and Ashford's 2024 seat holds 14% of the ground that voted in
2019. Applying results older than their boundaries is now refused outright.
See [vintage-stress.md](vintage-stress.md).
