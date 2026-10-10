# Worldwide election catalog and national metric views

This milestone extends the existing ingestion engine with a source-specific
national event catalog. It preserves the earlier workstation, raw cache,
constituency importer, publication receipt and cabinet archive. It does not
convert missing national winners into declared winners or infer governments
from seat totals.

The first execution cutoff is **2026-10-01T05:00:35.000Z**, corresponding to
**1 October 2026, 11:00:35 in Asia/Dhaka**. `data/catalog-execution.json` records
it. Later runs can explicitly supply `--cutoff UTC_INSTANT`. Sources are acquired
after execution starts: retrieval instants remain separate, and source update
instants are often unknown. The pipeline cannot reconstruct an unspecified
provider result status at the exact earlier cutoff instant.

## Scope and the two phases

`data/jurisdictions.json` registers 193 UN members and two non-member observer
states, using captured UN Library membership references. The ISO library's other
55 jurisdictions, including its user-assigned XK code, are explicitly
supplementary. They are not counted as UN states. Every core jurisdiction has
three ledger categories: lower/unicameral legislative, presidential and
upper-house. Direct/indirect/appointed designation is separate from category.

Phase A searches the complete registered IPU index, compares its election dates
with chamber `last_election` assertions and processes all 195 jurisdictions.
The complete index is needed to avoid treating an archive maximum as proof of
freshness. Acquisition can therefore include historical index entries, but
historical backfill occurs after the Phase A ledger checkpoint is written.

`phase-a-pass.json` means **all core categories were processed**, including
failures, absent evidence, suspended and appointed institutions. It does not
mean every latest election or result has been verified. Identity established,
provider latest claim checked, independent latest confirmation, completed event,
results acquired, metric eligibility and geometry availability are separate
counters. No applicable presidential contest is asserted only when sourced
institutional information supports it; missing evidence is never a no-election
claim.

Phase B preserves available historical IPU events and adds ParlGov national
events from the existing validated ingestion generation. Unknown rounds remain
unknown. European Parliament rows are retained by the existing ingestion system
and are excluded from the national lower-house history category. Historical
reports separate recorded events, held events, unconfirmed holding status,
appointed renewals and eligible metrics, with exact date ranges and covered
dates. An interval without a record does not prove no election occurred.

## Registered providers and access findings

`data/catalog-sources.json` extends source registration without changing the
earlier `data/source-registry.json` release contracts.

| Provider | Acquired meaning | Access/reuse constraints |
| --- | --- | --- |
| IPU Parline | Countries, parliaments, chambers, elections and party dictionary; dates, election party seat counts and turnout inputs | Public JSON:API, paginated. CC BY-NC-SA 4.0. Current membership is not an election result. Per-field validity dates are retained by raw evidence. |
| UK Parliament | Existing 4,515 candidate declarations, checked across 650 constituencies | Open Parliament Licence. National primary-party vote/seat totals are explicit derivations, with joint tickets retained and independents separate. |
| French Constitutional Council | Acquired 2022 presidential proclamation, two candidates, declared outcome and final-round turnout inputs | Source authority is official. Ministry archive/index acquisition returned 403, so independent latest-election freshness is unconfirmed. |
| US FEC | Official 2024 national popular vote totals and Electoral College totals, with a separate date resource | Public government compilation. No source-reported elected-candidate field is invented from a maximum or threshold; the attempted National Archives declaration endpoint returned 404. |
| ParlGov 2024 | National party shares and seat counts across the existing 37-country release | Existing evidence/review retained. Its newest date is never treated as a verified latest-election date. Fresh Harvard acquisition returned 403 in the isolated bootstrap; existing cached evidence remains usable. |
| IFES ElectionGuide | Research/discovery only | Published reuse terms restrict copying and derivative use without permission. Its recent-events page contains only the most recent 200 events. No bulk result adapter or permission email was issued. |
| International IDEA | Research and documented turnout export | Direct website/export acquisition returned 403. Registered-voter and estimated voting-age denominators cannot be substituted; years alone cannot identify exact events. |
| CLEA / THEA | Historical archive research | Direct documented host/download pages returned 403. ODbL/dissemination conditions and access must be checked before enabling backfill. No restricted access was bypassed. |
| Wikidata | Additional bounded discovery research | Entity/class discovery worked; complete presidential queries timed out at 20–25 seconds. No incomplete query output was imported as election evidence. |

The source-specific notes and terms links are in the registry. IPU's dictionary
labels `vote_breakdown` fields as breakdowns of seats: they must not become vote
shares. Duplicate secondary party dictionary codes are preserved; conflicting
names remain unresolved rather than choosing the last spelling silently.

One government-domain reference per core jurisdiction is attempted when the
latest IPU source field provides a supported URL. The registry-derived audit
records successful retrieval, HTTP/download failures and missing supported
references. A fetched general page does not independently verify its election
date, certification or absence of a newer election. The saved ledger includes
these attempts, captured times, citations and concrete next actions.

## Architecture and evidence

`scripts/catalog/acquire.js` reuses the existing acquisition layer and its
SHA-256 blobs, immutable receipts, retries, timeouts and partial-download checks.
Bounded workers download at most three resources concurrently. IPU pagination
reconciles every page's total and row count and rejects duplicate election IDs,
missing pages and changing totals. Successful pages remain cached so a failed
collection can resume without repeatedly downloading fresh unchanged resources.
Registered resources have cache periods; `--refresh` forces remote acquisition.

`scripts/catalog/adapters.js` produces event records documented by
`data/schemas/election-event.schema.json`. Each source keeps its own identity,
office/chamber, dates, round/tier information, direction, raw citations and
authority. A day must be a valid calendar date; a year alone is insufficient.
Explicit provider linkage can group rounds. Same-year similarity does not merge
runoffs, reruns, by-elections or distinct offices. Partial renewals remain
separate and cannot represent whole-chamber party totals.

`metrics.js` evaluates each national view independently. A missing declared
winner does not prevent a sourced party seat metric. Ranking uses only
non-overlapping recorded parties and preserves ties. Seat counts must reconcile
to seats at stake. Missing totals, overlapping alliance/component records,
mixed tiers and unsettled source statuses explain unavailable rankings.
Majority means a party's seats exceed half the recorded denominator; it does
not mean that party formed a government. Turnout preserves the original inputs
and definition. UK valid-votes/electorate is not substituted for the catalog's
voters/registered-electors comparison.

The national UK aggregate sums reported candidate votes and counts reported
position-1 constituency outcomes under the registered single-member system.
It groups by the provider's primary party identity, retains adjunct joint
tickets and keeps independent candidates separate. Every derivation carries
its formula and contributing row IDs. The underlying constituency records and
their canonical null seat fields remain unchanged.

National display uses a **schematic modern country outline with unrecorded
vintage**. The actual topology SHA-256 and exact resolved key travel with each
capability. Australia and a separate feature share numeric code 036; the exact
registered national name selects Australia and records the excluded feature.
Missing features are not invented. Subnational geometry still requires the
existing dated compatibility checks and importer.

`CatalogEngine` stages hash-checked event, ledger, history, index, snapshot and
evidence files in immutable generations. One database-owned lock and atomic
`current.json` rename commit the whole generation. An interrupted update leaves
the old pointer intact. Previous generations remain available. Normalization
changes do not multiply active copies of the same full provider identity.
Conflicting office/date/round identities remain separate for review.

Editor decisions require exact event hashes and a named reviewer. Machine
checks produce warnings, not independent verification. Changes to verified
events require the exact validated `--confirm-replace PLAN_HASH`; there is no
blanket acceptance flag. Raw integrity, registration, code and boundary inputs
are checked again before commit. A hash is evidence integrity, not a provider
signature or authentication of a local reviewer.

## Catalog, imports and world exports

Select the Countries world layer, then Import → **Worldwide catalog**. Browse
filters cover country, year/full date, office, chamber, status, source and
available metric; additional filters expand under More catalog filters.
Worldwide snapshot views intentionally retain the full core scope. Individual
event choices show availability/reasons, source freshness basis, certification
status and compatible geometry. The UK national entry also identifies the
existing compatible constituency view and how to use its importer.

The six world views are election date, largest party by seats, largest party by
recorded vote share, presidential declared outcome, compatible turnout and
coverage/unresolved results. Neutral colour bands represent dates or numeric
shares; they do not imply ideological equivalence of parties across countries.
Pending/unresolved, missing evidence and non-applicable/appointed states have
distinct labelled fills. Jurisdictions without a geometry remain explicitly
listed as missing from the display.

Proposals use exact country keys and the existing apply/undo path. Per-value
provenance retains each country's date and source; the saved map additionally
retains the whole event, derivation, capability and geometry proof. Publication
review binds these labels/metrics to the captured catalog and blocks a changed
category, geometry, uniform election date or uniform final status. Every import
starts as a draft. Publication approval is never automatic.

PNG source text groups providers for readability and states the cutoff, mixed
dates and display purpose. Individual citations, identities, formulas and
source hashes remain in the saved JSON and publication metadata. The demo also
writes a per-country citation appendix for every PNG. Existing footer fit and
minimum text-size safeguards are preserved.

## Commands and fresh checkout

Existing elections commands retain their old behavior. Add `-- --catalog` to
target the catalog:

```sh
npm run elections:discover -- --catalog
npm run elections:download -- --catalog
npm run elections:validate -- --catalog
npm run elections:import -- --catalog
npm run elections:update -- --catalog
npm run elections:report -- --catalog
```

The phase and export commands are:

```sh
npm run elections:latest -- --official
npm run elections:backfill -- --offline
npm run elections:snapshot -- --offline
npm run demo:catalog
```

`latest` acquires registered resources and processes the full ledger. `backfill`
first writes the complete Phase A pass, then adds available history. `snapshot`
revalidates and commits cached national views. History already acquired is
preserved during narrower latest updates. `--source` belongs to the original
ingestion commands; catalog coverage is ledger-wide. `--cutoff`, `--cache`,
`--database`, `--reports`, `--refresh` and `--decisions` are available. Alternate
database paths support CLI/testing; the normal browser reads the default paths.

The latest-election evidence pass and its registries:

```sh
node scripts/elections.js evidence                     # discovery, official results, authority + constitutional evidence, commit
node scripts/elections.js evidence --reuse-discovery   # keep this cutoff's captured discovery batch
```

- `data/catalog-execution.json` — the snapshot cutoff (the execution-start
  instant) and `previousSnapshots`.
- `data/latest-authorities.json` — authority index profiles (rules such as
  `most-recent-statement` and `aec-federal-elections-index`) and
  constitutional non-applicability rules.
- `data/official-results.json` — official result publications and category
  indexes, each read by a parser in `scripts/catalog/official-results.js`;
  `attemptedUnsupported` records official sources tried that are unusable.
- A refresh that fails replays the earlier capture with its original receipt
  time and records the failure. A capture older than the cutoff never
  supports a latest-election assessment. See
  `docs/worldwide-snapshot-2026-10-05-verification.md`.

For a fresh checkout with ignored caches/databases absent:

```sh
npm ci
npm run elections:bootstrap
npm run dev
```

Bootstrap attempts each legacy source separately, continues after a blocked
archive, downloads the registered national providers, commits Phase A, then
backfills supported history. Its failures are written to
`build/catalog/bootstrap-failures.json`. It does not invent missing ParlGov
evidence or rebuild a governing file from election rankings. Existing trusted
caches can be used for offline replay; a genuinely empty cache cannot claim an
offline bootstrap succeeded.

The pipeline needs Node and the repository's ordinary free dependencies. It
does not require a paid API, model, external spreadsheet runtime or account.
The FEC OOXML reader uses built-in ZIP/DEFLATE and cached worksheet values; the
bundled spreadsheet tooling was used only for development inspection.

```sh
npm test
npm run verify:boundaries
npm run verify:parlgov
npm run verify:catalog-bootstrap
```

The bootstrap verifier creates an isolated essential checkout with no raw or
generated databases, downloads public sources and records its limitations. Its
dependencies resolve from the enclosing installed workspace; the standalone
instructions above use `npm ci`.

## Deliverables and remaining work

`build/catalog/` contains `worldwide-ledger.json`, `country-coverage.json`,
`coverage.json`, `unresolved-facts.json`, `acquisition-failures.json`,
`historical-coverage.json`, `update-manifest.json`, `report.md`, validation and
the Phase A checkpoint. These reports include every core jurisdiction and
supplementary scope separately. They distinguish election identities, eligible
metrics and geometry from factual completion.

`build/catalog-demonstration/` contains six real-app PNG drafts, saved maps,
country citation appendices, the export manifest and desktop/mobile catalog QA.
`build/catalog-bootstrap-verification.json` records the actual fresh-cache run.
All generated data/evidence remain local and Git-ignored; source definitions,
schemas, code and documentation remain uncommitted with the existing work.

Presidential coverage, independent latest confirmation, official date/result
cross-checks and broad historical vote totals remain major gaps. Future work
must add licensed, source-specific adapters and adjudicate exact evidence;
passing software tests cannot certify election facts or turn an unresolved
ledger entry into complete coverage.
