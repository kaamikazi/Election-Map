# Worldwide catalog verification and coverage

Verification date: 1 October 2026, Asia/Dhaka. Snapshot cutoff:
`2026-10-01T05:00:35.000Z` (11:00:35 in Dhaka). Changes remain local and
uncommitted; no push, deployment, publication approval or post occurred.
Existing workstation, ingestion, cabinet archive and constituency work remains.

## Coverage achieved

Every one of the **195 UN core jurisdictions** has all three ledger categories
(**585 entries**). **55 supplementary jurisdictions** are identified separately.
The full Phase A jurisdiction pass preceded historical backfill. A pass means
every entry was processed; it is not universal factual verification.

| Core category | Held identity established | Provider latest claim checked | Results acquired | Largest party seats eligible | Recorded vote-share eligible | Declared presidential outcome | Turnout eligible |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Lower/unicameral legislature | 190 | 185 | 164 | 125 | 1 | 0 | 112 |
| President | 2 | 1 | 2 | 0 | 0 | 1 | 1 |
| Upper house | 65 | 65 | 31 | 17 | 0 | 0 | 14 |

**Independent latest-election confirmation: 0. Independently verified catalog
events: 0.** Authority, machine validation and editorial verification remain
distinct. Provider latest assertions do not prove no newer election exists.

The legislature ledger includes 36 pending-or-missing result entries, 7 appointed
institutions, 4 suspended institutions and 2 missing-evidence entries. Some
currently appointed institutions have separately retained sourced historical
elections; appointments and uncertain renewals are not substituted as elections.
The presidential ledger has **163 missing-evidence entries**, 30 sourced
non-applicable classifications and two acquired official result records. One
source-reported elected outcome is eligible: the French 2022 declaration. The
FEC workbook's popular/Electoral College totals do not invent an elected field.

Modern schematic geometry resolves **194 core jurisdictions**. Tuvalu lacks a
compatible outline feature and remains explicitly unpainted. Australia's exact
registered primary name resolves the duplicate numeric-code case; the other
same-code feature is excluded and recorded.

## Historical expansion

The current catalog contains **3,817 source-specific event records across 193
jurisdictions**. Of these, **3,646 held-event records across 190 jurisdictions**
are established under the supported source metadata. Unknown holding status and
appointed renewals remain separate. The held-record date extent is
**1900-05-27 through 2026-09-27**; exact per-country/source ranges, recorded dates
and gaps are in `build/catalog/historical-coverage.json`.

| Historical capability | Jurisdictions with eligible events | Eligible event records |
| --- | ---: | ---: |
| Recorded held-election date | 190 | 3,646 |
| Largest party by seats | 157 | 1,238 |
| Largest party by recorded vote share | 32 | 469 |
| Declared presidential outcome | 1 | 1 |
| Source-defined turnout | 163 | 438 |

ParlGov national seat/share views are now usable independently of a missing
winner. Its existing 9,016 party rows and source-review reasons remain unchanged
in the original ingestion system. Source-specific events are retained; unlike
an active normalization correction, a distinct date, office, round or provider
identity is not collapsed into a year.

## Acquisition and remaining gaps

The registered IPU collections were fully paginated and reconciled. The
government-reference audit recorded **32 acquired references, 42 acquisition
failures and 121 entries without a supported government URL**. Acquiring a page
is not independent fact verification. Every failure has a reason and next
action; unaffected providers continue.

IFES reuse restrictions, IDEA/CLEA HTTP 403 responses and complete Wikidata
query timeouts are reported. No partial query result, guessed winner, inferred
government or model-generated text became evidence. More licensed national
commission adapters and actual official latest-election/date/result
cross-checks are required. Presidential coverage and broad historical recorded
vote shares remain particularly incomplete.

The isolated fresh-cache bootstrap succeeded using registered free endpoints
after continuing past Harvard's HTTP 403. Its missing ParlGov acquisition was
recorded; the existing workspace's audited cache still supports ParlGov history.
The verifier copied only essential repository files, with no raw/generated
databases, and resolved ordinary installed dependencies from the surrounding
workspace. Standalone checkout reproduction begins with `npm ci`.

## Validation evidence

- Full regression suite: 222 tests, including 21 new catalog cases. The final
  log is `build/catalog-completion-tests.log`.
- All 254 boundary layers pass: `build/catalog-boundaries.log`.
- All 39 ParlGov outputs reproduce byte-identically and match the existing
  substantive archive: `build/catalog-parlgov-reproduction.log` and
  `build/ingestion/parlgov-reproducibility.json`.
- Cached catalog replay retained generation
  `2b1179466a579d8a8105c89c0631e614df38cc38b390c1fd15b7cbc26835475e`
  with `changed: false`: `build/catalog-final-replay.log`.
- Actual isolated bootstrap: `build/catalog-bootstrap-verification.json`;
  provider failures remain in that isolated checkout's reports.
- Six real-application exports: `build/catalog-demonstration/export-manifest.json`.
  All use exact country keys, retain citations/formulas and remain drafts.
- Desktop/mobile source search, metric reasons, parliamentary/presidential maps
  and visible gaps were inspected. Additional filters collapse on mobile;
  unavailable views explain their exact source/metric reason.

Tests cover newer held and pending elections, older completed records, future
exclusion, distinct presidential/legislative selections, explicit runoffs,
separate reruns/by-elections/partial renewals, appointed/suspended/non-applicable
states, pagination failures, stale latest claims, ties/alliance overlap/missing
totals, metric-specific capability, zero/null turnout inputs, exact geometry,
mixed-date citations, undo, fresh-cache replay, interruptions, forged plans and
verified replacement confirmation. Passing these software checks does not
certify the election facts.

## Inspect and reproduce

Read [the operating guide](worldwide-election-catalog.md). Inspect these local
outputs:

- `build/catalog/worldwide-ledger.json` and `country-coverage.json`
- `build/catalog/coverage.json` and `report.md`
- `build/catalog/unresolved-facts.json` and `acquisition-failures.json`
- `build/catalog/historical-coverage.json` and `update-manifest.json`
- `build/catalog-demonstration/date.png`, `seats.png`, `vote.png`,
  `presidential.png`, `turnout.png` and `coverage.png`
- The matching `*-map.json` and `*-country-citations.json` files

```sh
npm run elections:latest -- --official
npm run elections:backfill -- --offline
npm run elections:snapshot -- --offline
npm run demo:catalog
```

Use `npm run elections:bootstrap` when ignored caches/databases are absent.
Every world export states the cutoff and varying election dates. The complete
ledger and remaining gaps accompany the maps; empty entries and archive
maximum dates are not counted as complete latest coverage.
