# Election Data Ingestion Engine v1

The [worldwide catalog extension](worldwide-election-catalog.md) adds national
event/metric capabilities and an explicit modern-outline schematic display.
The v1 constituency-winner and cabinet behaviors described here remain intact;
missing national winners do not become declared winners in the extension.

This is a local registry-driven pipeline. It discovers only declared provider
resources, captures evidence, normalizes facts, validates identity/geography,
quarantines unresolved claims, and commits a map database atomically. It uses
the existing JavaScript importer, renderer, publication review and archive.
It adds no backend, paid service, automatic posting or broad internet crawl.

## Phases and implementation

1. `data/source-registry.json` declares provider, endpoints, countries, levels,
   date range, schema, cadence, licence, reliability, geometry compatibility and
   parser. Discovery is bounded to its pinned resources or a particular provider
   page/link/host. A changed provider page is reported; only the already registered
   resource is eligible as a fallback. A new release is a registry review task.
2. `scripts/ingestion/acquire.js` stores raw bytes at
   `data/raw/elections/blobs/<SHA-256>` and append-only JSON capture receipts at
   `receipts/<receipt hash>.json`. Successful captures include original/final URL,
   UTC retrieval instant, byte length, HTTP status, useful HTTP headers and hash.
   Cookie/auth headers are not copied. Existing local ParlGov files are explicitly
   marked as local seeds with HTTP metadata null, never claimed as fresh downloads.
3. `scripts/ingestion/adapters/` implements the adapter interface below. It never
   consumes model-written text or source-provided ready/review flags as evidence.
4. `canonical.js` defines exact identity and value normalization. `validate.js`
   validates the source coverage, types, calendar dates, counts, shares, reported
   winners, duplicate identities, source conflicts and geometry. Missing values
   remain null; explicit zeroes remain zeroes. No winner is inferred from the
   largest vote count or seat count.
5. `engine.js` maintains the review queue, compares with the last committed
   generation and requires explicit plan confirmation for changes/removals of
   verified records. It preserves claims from other sources and never silently
   selects a preferred conflicting source.
6. A generation contains records, per-election map candidates and quarantine
   details, index, review queue, captured raw evidence, receipts and a manifest
   of hashes. The database lock belongs to the database, including when workers
   use different caches. Files are immutable; `current.json` is the single atomic
   commit pointer. Incomplete generations are never made current.
7. When a selected ParlGov snapshot passes validation, the existing build runs
   against those captured TSVs in an isolated output folder. Its `governing.json`
   joins the generation and pointer transaction. The legacy fixed file is retained.
   The archive reads the validated generation when referenced and verifies its
   SHA-256. Rejected ParlGov records suppress a rebuild; failed acquisition/schema
   validation cannot commit. An election winner never creates a cabinet record.
8. `src/import/database.js` reads the committed hash-checked index and map file.
   “Election database” in Import offers eligible winners for the active layer and
   a read-only source review for quarantined elections. Exact region codes go
   through the existing proposal/apply path. Loaded geometry must have the exact
   validated byte hash, not only a matching name or year. Each map record keeps
   its canonical record/locator; pack metadata retains that information.

## Canonical adapter contract

The schema is `data/schemas/election-record.schema.json`. Runtime validation
also enforces cross-record and boundary constraints that JSON Schema cannot.

An adapter receives `{source, resources, aliases, worldNames}`; each resource has
captured bytes, receipt and immutable reference. It returns
`{records, complete, parser, parserVersion}`. Register its name in
`adapters/index.js` and add a registry entry; the core import algorithm does not
need per-country branches. Completeness is required before interpreting removals.

Each record includes country; full election date and identity; office; round;
tier/jurisdiction; region key and layer; party/canonical identity; alliance when
reported; votes/share/seats/turnout/winner; source citation and raw locator;
source update instant; boundary vintage; confidence basis; missing fields;
result status and vote/seat units. Validation attaches geometry proof, record
hash and review state. Source original values and derivation methods remain in
field evidence; missing source update time is never replaced by retrieval or
HTTP Last-Modified.

Identity includes **country, full date, office, round, tier, jurisdiction, source
ID and provider election ID**. A numeric four-digit provider ID can be legitimate
when those other fields are known; a year alone cannot identify an election.
Changed office/round or collided provider IDs stay separate. Unknown rounds stay
unknown. For the registered UK contest, round 1 is an explicit single-round
normalization convention supported by [Parliament's FPTP documentation](https://www.parliament.uk/about/how/elections-and-voting/voting-systems/);
an actual Round column overrides that convention and a disagreement requires
registry/source review.

## Source specifics and evidence

- ParlGov 2024 V1: 37 countries, 9,016 party/election rows. The view supplies
  shares and seat **counts**, but no votes, turnout, winner or round field. Those
  fields are not invented. National historical records require review because
  world outlines are modern; no winner maps are produced from these rows.
  Existing cabinet coverage corrections remain sourced and intact.
- UK Parliament 2024: the [official candidate CSV](https://electionresults.parliament.uk/general-elections/6/candidacies.csv)
  supplies 4,515 rows across 650 constituencies. The [Commons Library](https://commonslibrary.parliament.uk/research-briefings/cbp-10009/)
  describes its data as based on verified local-authority declarations. Position
  1 is the reported winner; share fractions are converted to percentages;
  turnout is explicitly derived from valid votes/electorate, excluding spoiled
  ballots. MNIS party IDs are distinct from the site's URL IDs. Independent
  candidates retain individual identities and joint candidacies retain their
  adjunct party. No source update instant is supplied by this CSV.
- The briefing-file host returned 403 in this environment. The provider's own
  documented election-results CSV endpoint succeeded; no third-party mirror was
  treated as evidence. Data reuse follows the [Open Parliament Licence](https://www.parliament.uk/site-information/copyright/open-parliament-licence/).
- Dataverse's metadata MD5 refers to the original CSV upload, not its served TSV.
  Fresh provider downloads on 2026-09-30 matched all three existing served TSV
  SHA-256 hashes. The registry pins those served-byte hashes and retains original
  upload MD5 values as labelled metadata. TSV backslash escaping is decoded
  explicitly, while CSV doubled-quote rules remain separate.

## Review and publication

States are `verified`, `imported-with-warning`, `needs-review`, `rejected`.
Automated valid rows receive `imported-with-warning`, never automatic factual
verification. The confidence field describes source-reported evidence, not an
invented probability. `verified` requires an explicit editor decision bound to
the exact record hash; source conflicts, absent winners, invalid boundaries,
unknown identity and unsettled facts cannot be made verified by a flag.

Quarantined rows show all reasons, source URL, captured raw-file link, SHA-256,
record locator and review hash. Resolve a bad mapping by correcting a reviewed
registry/adapter/crosswalk and validating again; no fuzzy mapping is applied.
Partial/recount/disputed records may be explicitly accepted with warnings when
the known facts are retained, but their source status, count and update instant
must survive publication. Cancelled/notional results are rejected for mapping.

The application starts every imported map as a draft. Publication ready flags
remain governed by the existing receipt. Ingested country/date/office/type/round,
metrics, geometry proof, source status, update instant and counted percentage
cannot be relabelled silently. Settled data can be presented as an explicitly
labelled historical retrospective. Seat counts are not copied into the app's
seat-share field. Unknown metrics are cleared in complete-snapshot imports.

## Commands

```sh
npm run elections:discover
npm run elections:download
npm run elections:validate
npm run elections:import
npm run elections:update
npm run elections:report
```

`discover` inspects only registered resources; `download` captures evidence;
`validate`/`import` replay the cache; `update` acquires, validates, diffs, commits
and reports; `report` is read-only. `--source uk-parliament-2024` or
`--source parlgov-2024` selects a provider; default is all. `--offline` does no
network work. `--refresh` requests a new remote capture of pinned ParlGov instead
of its already verified local seed. `--cache`, `--database`, `--reports` and
`--registry` support isolated runs. Alternate database paths are for CLI/testing;
the app's normal path is `public/data/ingestion/`.

Reports in `build/ingestion/` include `source-coverage.json`,
`missing-countries.json`, `unresolved-review.json`, `update-manifest.json`, full
`validation.json`, and readable `report.md`. Missing-country coverage uses ISO
alpha-3 countries/territories, excluding the library's user-assigned XK code;
it does not assert that every listed territory holds elections. Source coverage
is historical and bounded, never a global/current-results claim.

An explicit editor file is passed with `--decisions FILE`:

```json
{
  "reviewer": "Named editor",
  "decisions": [{
    "id": "copy the exact id from validation.json",
    "recordHash": "copy the exact hash after reading the captured evidence",
    "state": "verified",
    "reason": "Explain which source fact was checked"
  }]
}
```

If a verified row would change or disappear, the command stops with a plan hash
and writes its review report. Inspect it, then use `elections:import --offline
--confirm-replace PLAN_HASH` (with the same decisions/source selection if used).
There is no blanket `--yes`. A changed source, geometry, registry, alias table,
governing evidence or current database requires validation again. Replaced rows
lose old verification until their new evidence is reviewed.

## Reproduction and limits

`npm run demo:ingestion` runs download → an isolated new demo database → the
normal map importer → a historical draft PNG. `-- --offline` replays the captured
provider evidence. It writes `build/ingestion-demonstration/`: workflow manifest,
raw HTTP capture details, coverage/review reports, a 650-unit map JSON, square
PNG, source review screenshots and a 390px QA preview. No publication approval
or post occurs. Earlier demo runs and all raw captures remain available.

`npm run verify:parlgov` rebuilds 39 files twice using an explicit fixed generated
timestamp, checks byte equality, and compares every substantive field to the
existing archive. The regular builder still supports its original commands and
now accepts isolated raw/output directories and `--generated-at`.

The pipeline cannot certify provider facts, resolve litigation, find unrestricted
data for missing countries, infer missing winners, or authenticate a local editor.
Hashes detect corruption and bind review to captured evidence; they are not a
provider's digital signature. A stale import lock must be inspected manually.
Abandoned, unreferenced generations are harmless and are not silently deleted.
Full source links/legends sometimes require a square or taller export; the
existing renderer refuses to shrink evidence until it becomes unreadable.
