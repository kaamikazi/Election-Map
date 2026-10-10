# Election ingestion implementation and verification

Completed locally on 1 October 2026 (Asia/Dhaka). All changes remain uncommitted;
no commit, push, deployment or publication was performed. Existing workstation
changes were retained. Capture timestamps remain their actual UTC instants.

## Implementation

The [architecture](election-ingestion-architecture.md) documents the source
registry, immutable acquisition cache, canonical adapter interface, strict
election identity, geography proof, normalization, review decisions, atomic
database generations and map/publication integration. The six requested
`elections:*` commands are available in `package.json`.

The starter adapters cover the existing ParlGov 2024 release and UK Parliament's
4 July 2024 constituency results. Discovery visits registered provider pages and
resources only. New providers require a registry entry and adapter; model text
is never evidence. Raw files, HTTP/local-seed receipts, hashes and row locators
survive import and are accessible from the source review interface.

Verified replacements require confirmation of the exact validated plan hash.
Unknown fields remain null. Conflicting identities, incompatible geometry and
unsettled results cannot acquire automatic verification. Publication approval
remains separate from ingestion and is bound to the existing review receipt.
Validated ParlGov cabinet evidence rebuilds `governing.json` within the atomic
generation; election winners are not used to invent heads of government.

## Verification results

| Check | Result |
| --- | --- |
| Existing baseline suite before implementation | 180 passed |
| Full suite after implementation (`npm test`) | 201 passed, 4.4 minutes |
| Boundary registry (`npm run verify:boundaries`) | All 254 layers passed |
| ParlGov source check (`node scripts/build-parlgov.js --check`) | 1,707 parties, 9,016 election rows and 1,621 cabinets across 37 countries resolve |
| ParlGov reproduction (`npm run verify:parlgov`) | All 39 outputs byte-identical across two fixed-timestamp builds; existing substantive archive data matches |
| Final offline update | Zero additions, changes, conflicts or removals; database generation unchanged |
| Registered download-to-export demonstration | HTTP 200 capture; 650 exact constituency matches; historical draft exported |
| Working-tree whitespace (`git diff --check`) | Passed |

The 21 ingestion cases cover deterministic replay and generated output,
duplicate rows/elections, distinct offices and rounds, aliases and alliances,
blank versus zero, missing winners, source conflicts, missing/bad geometry,
boundary vintages, forged ready flags, partial/disputed/cancelled results,
recounts, interrupted imports, failed/retried/truncated downloads, evidence
tampering, verified changes/removals and browser import/publication safeguards.

The final replay retained generation
`cf1ac63ab86dd6860421ad9f1543a9d85600e2f4614cde6959f74258d9c02724`.
The preceding online manifest includes normalization/provenance changes made
during implementation; these are not claimed to be changes to provider facts.

## Actual coverage and unresolved facts

| Source | Canonical rows | Map-eligible reported winners | Review state |
| --- | ---: | ---: | --- |
| ParlGov 2024 | 9,016 | 0 | needs-review |
| UK Parliament 2024 | 4,515 | 650 | imported-with-warning |
| Total | 13,531 | 650 | 0 independently verified; 0 rejected |

There are 37 distinct covered ISO countries and 212 uncovered ISO countries or
territories. Coverage is bounded historical coverage, not a worldwide live feed.
The missing-country denominator excludes the ISO library's user-assigned XK
code and does not imply that every territory conducts elections.

All 9,016 ParlGov election rows remain unresolved for mapping: the source does
not report winners or rounds, and the modern schematic world layer cannot
silently establish historical geometry. Votes, turnout, boundary vintage and
source update instants are also absent. UK source update instants and some
metrics are absent; retrieval times and HTTP dates do not fill those fields.
The 4,515 UK rows passed machine consistency and boundary checks with warnings,
which does not constitute independent factual verification.

The Commons Library briefing asset returned HTTP 403. Its documented
[Parliament results service](https://electionresults.parliament.uk/general-elections/6)
provided the registered candidate CSV, captured without bypassing access
controls. The [Commons Library briefing](https://commonslibrary.parliament.uk/research-briefings/cbp-10009/)
describes the underlying declared results; reuse is documented under the
[Open Parliament Licence](https://www.parliament.uk/site-information/copyright/open-parliament-licence/).
The captured CSV has 3,537,368 bytes and SHA-256
`50e7705fb9a3946c6ecc3e1554b1bac47714ac85ed06952979975288e2e1ecae`.

Dataverse's original-upload MD5 describes different bytes from its served TSV
representation. Fresh provider downloads confirmed the existing local TSV
SHA-256 hashes. The registry labels both representations explicitly; local seed
receipts do not pretend to have HTTP metadata.

## Reviewable artifacts

Generated evidence and outputs are intentionally ignored by Git and remain
available locally:

- `build/ingestion/report.md`: readable coverage, missing-country and review report.
- `build/ingestion/source-coverage.json`: provider coverage, eligible winners and caveats.
- `build/ingestion/missing-countries.json`: every uncovered ISO country/territory.
- `build/ingestion/unresolved-review.json`: exact review reasons, record hashes and source citations.
- `build/ingestion/update-manifest.json`: final unchanged replay and source hashes.
- `build/ingestion/online-update-manifest.json`: preceding online update history.
- `build/ingestion/validation.json`: full validated canonical records and geography proofs.
- `build/ingestion/parlgov-reproducibility.json`: byte hashes and archive comparison.
- `build/ingestion-baseline-tests.log`, `build/ingestion-final-tests.log`,
  `build/ingestion-final-update.log`, `build/ingestion-final-replay.log`,
  `build/ingestion-final-demo.log`: run evidence.
- `build/ingestion-demonstration/download-to-export.json`: actual HTTP capture,
  13,531 additions to an isolated new database, 650 matches and draft status.
- `build/ingestion-demonstration/uk-2024-map.json` and `uk-2024-draft.png`:
  saved map with canonical provenance and the 1200px square export.
- `build/ingestion-demonstration/desktop-map.png`,
  `publication-source-review.png`, `unresolved-source-review.png`,
  `mobile-source-review.png`, `phone-preview.png`: desktop and mobile visual QA.
- `data/raw/elections/`: immutable raw blobs, capture receipts and validated plans.
- `public/data/ingestion/current.json`: atomic pointer to the current map database.

The demo downloaded the registered UK CSV into the shared immutable cache,
validated it with ParlGov, committed a fresh isolated database, used the app's
normal importer to apply 650 reported winners, and exported a map labelled
`DRAFT · HISTORICAL ARCHIVE · 2024`. The desktop quarantine screen contains the
exact reasons and captured-source links, with Apply disabled. Visual inspection
confirmed the map, source review and 390px preview; full evidence text is best
read in the original export or source review panel.

## Run and inspect

```sh
npm run elections:update
npm run elections:update -- --offline
npm run elections:report
npm run demo:ingestion -- --offline
```

In the application, select the UK 2024 constituency boundary layer, open Import
and choose Election database, then search `GBR 2024`. Import and publication
review remain explicit. Review unresolved facts against captured evidence
before supplying any editor decisions. Hashes establish captured-byte integrity,
not provider signatures or authentication of a local reviewer.
