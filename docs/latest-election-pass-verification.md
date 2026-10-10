# Latest-election evidence pass verification

Work remained local and uncommitted. Historical expansion was paused; existing
history, workstation work, cabinets, constituency imports and prior immutable
generations were retained. The cutoff stays **2026-10-01T05:00:35.000Z**, or
**1 October 2026, 11:00:35 Asia/Dhaka**, despite verification continuing on
2 October. Subsequent polling dates are excluded.

Read [the diagnosis](presidential-coverage-diagnosis.md) and
[the evidence standard](latest-election-evidence-standard.md) before interpreting
the counters. A source-reported contributed outcome is not an official
declaration or independent editorial verification.

## Before and after

| Core-category measure | Before | After |
| --- | ---: | ---: |
| Legislative held identity | 190 | 191 |
| Legislative acquired result claims | 164 | 153 |
| Legislative seat metric eligible | 125 | 115 |
| Legislative turnout metric eligible | 112 | 104 |
| Legislative recorded-share metric eligible | 1 | 1 |
| Legislative primary-evidenced latest claim | 0 | 1 |
| Presidential held identity | 2 | 142 |
| Presidential acquired result claims | 2 | 122 |
| Presidential outcome metric eligible | 1 | 113 |
| Presidential primary-evidenced latest claim | 0 | 0 |

The legislative metric decreases are retained honestly: newer held discoveries
and unresolved claims can supersede an older completed record. An older usable
result is not silently painted as the newest election. Latest completed results
remain separately available. The acquired-result/outcome counters include
attributed contributed claims; **only two selected presidential records have
the existing official-final source status**. No contributed record is upgraded
to official-final or independently editor-verified.

All **195 core jurisdictions** were processed for both requested categories
(390 country/category entries). The discovery audit contains 20 unsuccessful
country-level requests/no-lead cases and no remaining mapping/entity/label-stage
acquisition failures after retries. These are recorded with reasons; an empty
query is not evidence of no election. The authority pass records **470 attempts**
and **156 captured resources**. Fetched resources without a supported exact
latest-assertion extraction do not count as confirmations.

The UK Parliament's current General elections index supports the selected
4 July 2024 legislative event. The receipt, raw hash, link/date locator and check
time are recorded. It is primary evidence independent of the archive/latest
provider inference, not a second mirror vote. All other selected latest claims
remain unconfirmed under the defined standard, including all presidential ones.

Presidential freshness states: **122 latest-available/unconfirmed**, **20 held
with results pending/unresolved**, **53 unknown**. Provisional monarchy/N/A
assertions were not silently verified as non-applicability. The attempted UK
constitutional publication returned HTTP 403; its classification remains
unconfirmed. Legislative freshness: **1 established**, **140 latest-available
unconfirmed**, **50 held/results unresolved**, **4 unknown**.

## Confirmed repairs

- Enabled worldwide presidential discovery rather than two hard-coded result sources.
- Replaced an expensive global graph query with country-segmented queries.
- Parsed unlabelled infobox dates and source-reported elected columns.
- Throttled and retried HTTP 429 responses, replaying successful cache entries.
- Fixed double-unboxing of scalar IPU fields.
- Registered authority roles/domains, including electoral commission `.org` sites.
- Added actual primary-index assertion rules and freshness receipts.
- Separated parliamentary/presidential contests within combined source events.
- Kept source authority preference and material conflicts explicit.
- Reported conservative identity groups separately from source-specific records.

No winner is inferred from greatest votes, an after-election office holder,
appointment or government formation. Disputed/annulled/recount or post-cutoff
round evidence retains its limitations. Unknown round ordinals stay null.

The catalog retains **3,994 source-specific records**, grouped into **3,666
conservative election identities**. Unknown identity dimensions remain
provisional; these groups do not imply that every cross-source duplicate has
been conclusively resolved. Source-specific counts are retained separately.

## Repository and visual checks

- **233 tests passed**, including 11 new latest-evidence cases and the existing
  catalog/workstation/ingestion regressions.
- **254 boundary layers passed**.
- **39 ParlGov files are byte-reproducible and match existing substantive data**.
- Cached snapshot replay kept the committed generation unchanged.
- Actual parliamentary, presidential and coverage drafts were produced through
  the normal application importer and renderer. Covered outcomes and unresolved
  gaps were inspected. Contributed outcomes have a labelled hatch/category;
  primary latest evidence is counted separately in subtitles and source notes.
- Source-specific candidate names, votes/shares, event dates, citations and
  formulas remain in saved maps and per-country citation appendices.

Passing tests verifies the software behavior, not the political correctness of
every source claim. Independent editorial verification remains zero.

## Local evidence and reproduction

- `build/latest-evidence/before-after.json`: complete before/after counters.
- `build/latest-evidence/discovery-audit.json`: every country, revision-pinned
  article/graph query, check time, response reference and failed request.
- `build/latest-evidence/authority-audit.json`: country/category authority checks,
  exact failures, extracted assertions, raw receipts and remaining work.
- `build/catalog/worldwide-ledger.json`: selected held/completed events,
  freshness evidence, status, conflicts, missing fields and attempted sources.
- `build/catalog/election-identity-counts.json`: conservative event groups,
  ambiguity notes and separate source-specific historical counts.
- `build/catalog/unresolved-facts.json`, `coverage.json`, `update-manifest.json`.
- `build/catalog-demonstration/`: six draft PNGs, saved maps, country-citation
  appendices, export manifest and desktop/mobile catalog checks.
- Logs: `build/latest-evidence-full-tests.log`, `latest-evidence-boundaries.log`,
  `latest-evidence-parlgov.log`, `latest-evidence-replay.log`.

```sh
npm run elections:evidence
npm run elections:evidence -- --offline
npm run elections:snapshot -- --offline
npm run demo:catalog
```

The evidence command processes the entire core scope, acquires registered
latest discovery and authority checks, validates and commits atomically. Normal
verified-replacement confirmation remains required for changed verified facts.
`elections:backfill` is blocked while historical expansion is paused.

Remaining work is substantial: official declaration adapters for contributed
presidential outcomes, broader current authority-index rules, verified
non-applicability and resolution of failed/unsupported formats. No universal
latest-election completion is asserted.
