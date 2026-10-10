# Result status, captured evidence and acquisition — verification

| | |
| --- | --- |
| Snapshot | 5 October 2026, cutoff `2026-10-05T17:01:31.000Z` (23:01:31 Asia/Dhaka) |
| Recomputed generation | `561b542120fc9c6c87d5dce78d28a50b20b3e25d6f037c6e449d1f6289e15d3c` |
| Preserved generations | Previous 5 October `41ce6bfe…`; 1 October `a952b479…` (both immutable) |
| Evidence standard | `docs/latest-election-evidence-standard.md` (status model v3) |
| Country appendix | `docs/worldwide-snapshot-2026-10-05-countries.md` (390 rows) |
| Capture accounting | `build/latest-evidence/capture-accounting.json` (`npm run audit:captures`) |

All changes are local and uncommitted. Nothing was pushed, deployed or published.

## 1. Baseline (recomputed)

Recomputed from `41ce6bfe…` before any edit. It matched the previous report:

- **Legislative:** 191 held, 169 with results, 5 established. 39 "results pending", 4 of them created by the 14-day rule.
- **Presidential:** 145 held, 138 with results, 3 established, 10 sourced non-applicable, 40 unknown, 127 with an outcome metric.

## 2. Status model: age replaced by evidence

The 14-day rule is gone (`provisional()` in `discovery-adapter.js`, the `'provisional'` state in metrics, freshness and UI). `scripts/catalog/status.js` classifies every event from evidence into one of eight states:

- scheduled
- held, results unavailable
- partial
- declared
- certified
- disputed or recounting
- annulled
- unknown

Declaration, certification and dispute are kept as separate facts. Each carries its evidence and the tier of the source that reported it: official, provider, research archive or contributed. Age only sets `freshnessCheck.required` (a prompt to recheck the count). The full rules are in the evidence standard.

**Scope.** Status sentences are taken only from the article's prose:

- reading stops at the reference list;
- citation markers are removed (they had glued sentences together);
- cited headlines are dropped;
- sentences naming another year or another contest are ignored. Other contests include vice-president, senate, governor, municipal, referendum, primary and by-election.

**Records that changed state for a reason other than renaming:**

| Change | Countries | Evidence |
| --- | --- | --- |
| 14-day "provisional" → **partial** | BIH (legislative and presidential) | Infobox "Reporting 96.32% as of 15:00 CEST"; elected presidency members "TBD". The partial count's leader is shown labelled *not a winner*. |
| 14-day "provisional" → **declared** (contributed), recheck flagged | LVA (3 Oct), MAR (23 Sep), STP (27 Sep) legislative | Seat allocation covering every seat; no partial marker. The seat metric is now usable and labelled as contributed. |
| reported outcome → **disputed** | DZA 2024, ECU 2025, GTM 2023, NAM 2024, VEN 2024 | Scoped sentences, e.g. "Aouchiche and Cherif challenged the results"; "González demanded a recount"; "the opposition refused to recognise the results". The outcome metric is withheld. Disputes do not expire with age. |
| false signal removed | COM 2024 (was disputed); COG 2026 (would have been partial) | The signals came from cited news headlines in the reference list. |
| **certified** (official) | AUT 2022, CHL 2025, FRA 2022, plus CZE declared | Federal Electoral Board determination; TRICEL proclamation; Constitutional Council proclamation. |
| "Elected Presidency members TBD" | BIH | No longer parsed as an elected row (word-boundary defect fixed). |
| results pending → **declared, figures not captured** | 34 legislative entries, e.g. RUS, CHN, EGY, COL, GAB, ERI, TON, TUV | IPU records the new legislature convened (`first_session_date` ≤ cutoff). Figures stay missing and are listed as missing. |

**Outcome metric (presidential):**

- **Gained:** AUT, COM, MEX, USA.
  - AUT: winner taken from a same-contest record and labelled.
  - USA: derived (see §3).
- **Lost:** DZA, ECU, GTM, NAM, VEN — all disputed.

**Seat metric:** gained LVA, MAR, PSE and STP; none lost.

## 3. Captured authority evidence: every page accounted for

The earlier figure of 155 pages without rules belonged to the 1 October audit. The 5 October authority pass and the official-results batch captured **237 pages**: 228 authority and 9 official, 211 distinct byte sequences. Each page is classified from its raw bytes. An HTTP 200 response or an official hostname never counts as evidence on its own.

| Class | Pages | Detail |
| --- | ---: | --- |
| Extracted and linked to validation | 26 | 9 parsed by official-results parsers, 5 latest-election assertions, 11 constitutional non-applicability, 1 duplicate page linked through another category |
| Duplicate or superseded | 24 | 22 same bytes as an earlier capture; 2 failed refreshes kept for audit only |
| Unrelated to the selected election | 61 | 55 never mention the selected year or date (homepages, unrelated news); 6 have no selected election to compare against |
| Block or error page | 32 | Captcha (8), "checking your browser" (2), "enable JavaScript" (3), "Request Rejected" (2), "temporarily unavailable" (1), near-empty error bodies (16) |
| Extraction failure | 16 | 8 script-rendered pages (large HTML, under 300 characters of text); 7 image-only PDFs (BRB, CHL, IDN ×2, LKA ×2, SEN), with no OCR available; 1 PDF whose fonts lack a Unicode map (PRT) |
| Insufficient evidence | 78 | 73 mention only the year; 5 mention the polling date but state no result or latest-election fact |

**Repairs that connected captured evidence to validation:**

- **PDF support:** `scripts/catalog/pdf.js` handles FlateDecode and object streams, ToUnicode maps and `[page N]` locators. It does no OCR and labels image-only pages.
- **USA (FEC official 2024 results PDF):**
  - state electoral votes: 538 total, Trump 312, Harris 226;
  - the document's own rule: "Total Electoral Votes Needed to Win = 270".
  - The winner is a **derived** outcome. The rule and the complete inputs come from the source, and it is labelled `derived:` in the metric, legend and tooltip. The FEC table itself declares no winner, and popular-vote totals are not used.
- **Chile (Election Qualifying Court, TRICEL):**
  - first-round declaration: no absolute majority on 16 November 2025; runoff between Jara and Kast;
  - proclamation on 5 January 2026: "declarándose electo al señor Kast Rist" for the 14 December runoff;
  - result: an official certified event. Vote counts are only in PDF actas and stay null.
- **Azerbaijan:** the registered-statement rule matches the Milli Majlis page — "seventh convocation … formed following the elections held on 1st September 2024" — so the legislature is established as latest.
- **Same-contest outcome attribution:** when the selected official record carries totals but no winner statement (AUT), the winner comes from a same-contest record that reports it. That record is cited and labelled ("winner reported by wikipedia-latest").

**Not converted, with next actions:**

- **Finland:** the official results service gives final 2024 totals but no polling dates. Next: register the vaalit.fi election page that states the dates.
- **Ghana:** the capture is only a results menu. Next: register the linked 2024 results page.
- **Portugal:** the CNE's official results map PDF uses fonts without a Unicode map. Next: use the Diário da República text edition.
- **Image-only PDFs:** cannot be read without OCR.
- **Croatia:** the captured PDF is the candidate list, not results.
- **Germany, Finland, Austria, Costa Rica legislative:** official result pages that need dedicated parsers. Their legislative results already come from IPU.

## 4. Worldwide gaps

| | 5 Oct (previous) | 5 Oct (recomputed) |
| --- | ---: | ---: |
| Legislative results acquired | 169 | 169 |
| Legislative seat metric | 125 | 129 |
| Legislative latest established by authority | 5 | **6** (+AZE) |
| Legislative "results pending" | 39 | 5 (BIH partial; BFA, CHN, ERI, ZMB without figures or declaration) |
| Presidential results acquired | 138 | 138 |
| Presidential outcome metric | 127 | 126 (+4, −5 disputed) |
| Presidential certified (official) | — | 4 |
| Presidential latest established | 3 | 3 |
| Presidential sourced non-applicability | 10 | 10 |
| Independently corroborated | 0 | 0 |
| Editorially verified | 0 | 0 |

The "results pending" figures above refer to the coverage freshness label, not to result states. The fall from 39 to 5 legislative entries reflects declared outcomes (the legislature convened) whose figures are still missing. No figures were added and none were relabelled as acquired.

**Unresolved: 73 core entries.** Each records its attempted sources, exact failure and next action.

- **Presidential, missing evidence (40):**
  - monarchies and realms whose constitutional sources are blocked or did not match: AND ATG BEL BHR BHS BLZ BRN BTN GRD JAM JOR JPN KHM KNA KWT LCA LIE MAR MCO MYS NZL OMN PNG QAT SAU SLB SWZ THA TON TUV VCT;
  - collegial or indirect heads of state, or no event in the sources: BWA CHE ERI LAO LBY PRK SMR SSD WSM.
- **Presidential, held with results unavailable (7):** CHN, LBN, MDG, MHL, MUS, SUR, VAT. For the indirect elections in LBN, CHN and SUR, only news sources were found; parliamentary publications are the next action.
- **Legislative, declared without figures (16):** BFA CHN COL EGY ERI GAB GIN KIR PLW RUS SOM SWZ SYR TON TUV WSM.
- **Legislative, other:** suspended (AFG KWT MMR); appointed (BRN GNB QAT SAU SSD); missing evidence (VAT); held with results unavailable (ZMB).

Absence from a dataset is never treated as "no election". A blocked site is recorded as a block, not as a missing fact.

## 5. Acquisition

**Bounded, resumable pagination:**

- Missing pages are retried in bounded rounds (policy: 2). Pages already captured replay from the cache.
- A stale earlier capture is used only after the retries fail, and marks the batch degraded.

**Completeness:**

- `data/acquisition-policy.json` names the required collections (IPU Parline, UN scope). It is kept outside `catalog-sources.json`, so the preserved batches stay replayable.
- A batch is `complete` or `partial`, listing what is missing, degraded and optional.

**Failed refresh:**

- A partial download does not move `catalog-batch.json`.
- `commit` refuses a partial plan (`PARTIAL_ACQUISITION`), so the previous generation stays published.
- `--allow-partial` publishes a labelled partial generation; the manifest records `acquisition.allowPartial`.
- The CLI exits with code 3 and writes `build/catalog/acquisition-completeness.json`.

**Modes** (`bootstrap-report.json`):

- **fresh-online** — acquire everything from the network.
- **offline-replay** — `--offline`, from the existing cache.
- **offline-reconstruction** — `--bundle <dir>`, from a supplied evidence bundle.
- **partial-acquisition** — nothing published, exit 3.

**Evidence bundle** (`npm run elections:bundle -- --out <dir>`):

- the batch records, authority audit, ingestion pointers and every referenced blob and receipt (1,950 references, 0 missing);
- an archive of records carried from earlier generations;
- hashes for every file, verified on restore.

| Run | Result |
| --- | --- |
| Offline reconstruction from bundle (`verify:catalog-bootstrap -- --from-bundle`) | **Complete.** The ledger hash and all 4,482 event hashes match the source generation exactly. No network was used. |
| Fresh online bootstrap (`verify:catalog-bootstrap`) | **Partial overall** (exit 1): catalog acquisition complete (IPU, UN); ingestion partial — ParlGov's Dataverse returns 403, which is not bypassed. Optional failures: two French Interior Ministry pages (403) and the NARA Electoral College page (404). |

**Fresh bootstrap baseline:**

- **Legislative:** 190 held, 163 with results, 124 seat-eligible.
- **Presidential:** 2 held (official France and USA only).
- The rate-limited discovery and evidence pass (about an hour) is a separate step.

## 6. App and exports

`npm run demo:catalog` produced all six drafts through the real importer: `seats.png` (parliamentary), `presidential.png`, `coverage.png`, `date.png`, `turnout.png` and `vote.png`.

- **Labelling:** each draft carries the badge `DRAFT · LATEST AVAILABLE SNAPSHOT`, the cutoff and "varying election dates" in the subtitle, and a per-country citation file.
- **Approval:** none is approved (`ready: false`); ingestion grants no approval.

**Presidential legend:**

- Official declaration acquired: CHL, CZE, FRA, ARE, plus a certified official record;
- Derived from official figures under a stated rule: USA;
- Reported outcome, authority check open (includes AUT, whose winner comes from a contributed record);
- Disputed / recount;
- Partial or pending results;
- Missing evidence;
- Non-applicable / appointed.

**Tooltips** state freshness, the result state and its source tier, partial-count leaders "— not a winner", "winner derived…" or "winner reported by …", disputes, "recent: recheck count" and date conflicts. Captions count each freshness state separately.

## 7. Tests

| Check | Result |
| --- | --- |
| Full suite | **265 passed** |
| Boundary validation | 254 layers pass |
| ParlGov reproduction | 39 files byte-identical |
| Offline replay | Generation unchanged on second run |
| `git diff --check` | clean |

New regressions cover:

- recently declared and certified results staying usable;
- older disputes staying disputed;
- a partial count with no winner;
- "Elected Presidency members TBD";
- evidence about another office, year or contest;
- cited headlines and citation-glued text;
- PDF evidence reaching validation as a derived outcome;
- the registered-statement rule;
- the court proclamation;
- interrupted and truncated pagination;
- stale fallback marking a batch degraded;
- a failed refresh preserving the published generation.

Passing tests demonstrate software behaviour, not the correctness of every election fact.

## 8. Reproduction

```sh
npm run elections:download -- --catalog                # complete or partial; never silently replaces the batch
node scripts/elections.js evidence --reuse-discovery   # official results + authority evidence + commit (5 Oct cutoff)
npm run elections:backfill -- --offline                # history; byte-identical on replay
npm run audit:captures                                 # capture accounting
npm run demo:catalog                                   # real-app drafts
npm run elections:bundle -- --out build/evidence-bundle
node scripts/verify-catalog-bootstrap.js --from-bundle # offline reconstruction check
node scripts/verify-catalog-bootstrap.js               # fresh online bootstrap, reports actual completeness
```

Worldwide factual completion is not claimed. 73 core entries remain unresolved, and no latest-election claim is independently corroborated.
