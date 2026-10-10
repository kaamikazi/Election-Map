# Status model v4, corrected 5 October snapshot and 7 October snapshot — verification

This pass started from data measured in the database, not from earlier reports. It:

1. separated result, declaration, certification, recount, challenge and annulment facts;
2. corrected the convening inference;
3. kept the 5 October snapshot reproducible, and added a 7 October snapshot;
4. worked through the country gaps;
5. extended history.

Nothing here is factual certification. Passing tests and byte-identical replays show how the software behaves. They do not show that every election fact is correct. All changes are local and uncommitted.

## Generations

| Snapshot | Cutoff (UTC) | Generation | Evidence bundle | Status |
| --- | --- | --- | --- | --- |
| Baseline measured at the start of this pass | 2026-10-05T17:01:31Z | `561b5421…` | — | Status model v3; retained |
| 5 October, corrected | 2026-10-05T17:01:31Z | `321c90c7…` | `build/evidence-bundles/2026-10-05-v10` | Registered in `data/catalog-execution.json` |
| 7 October (current) | 2026-10-07T18:53:15Z | `c7e82718…` | `build/evidence-bundles/2026-10-07` | `public/data/catalog/current.json` |

The corrected 5 October generation supersedes these generations. They remain on disk, unchanged; the reasons are recorded in `previousSnapshots[].supersedes`.

| Superseded generation | Reason |
| --- | --- |
| `ff7d84b0` | Candidate-table, label, latest-cycle and claim defects; see below |
| `71bc765e` | Unscoped status evidence |
| `3aa37205` | Carried records from the later snapshot; never use |
| `b2c39acf`, `43284854`, `678e1ff1` | Interim rebuilds made during this pass |

The 7 October snapshot's cutoff is the actual start of that pass (2026-10-08 00:53:15 Asia/Dhaka).

## Before and after (core jurisdictions)

| | Baseline `561b` | 5 Oct `321c` | 7 Oct `c7e8` |
| --- | --- | --- | --- |
| **Legislative** applicable / unknown | 194 / 1 | 194 / 1 | 194 / 1 |
| Latest identity | 191 | 191 | 191 |
| Results acquired | 169 | 171 | 171 |
| Map metrics: date / seats / majority / turnout / vote | 191 / 129 / 129 / 112 / 1 | 190 / 142 / 142 / 118 / 6 | 190 / 142 / 142 / 118 / 7 |
| States | declared 186, partial 1, held-results-unavailable 3 | reported 159, held-results-unavailable 29, declared 1, certified 1 | same as 5 Oct |
| **Presidential** applicable / sourced non-applicable / unknown | 143 / 10 / 42 | 142 / 10 / 43 | 142 / 10 / 43 |
| Latest identity | 145 | 144 | 144 |
| Results acquired | 138 | 140 | 140 |
| Outcome metric (single winner) | 126 | 136 | 135 |
| Date metric | 140 | 138 | 138 |
| States | declared 122, disputed 7, held-results-unavailable 8, certified 4 | reported 130, declared 3, certified 5, held-results-unavailable 4, partial 1, annulled 1 | same as 5 Oct |
| Primary-source latest confirmations (legislative / presidential) | 6 / 3 | 6 / 4 | 6 / 4 |
| Independent corroborations | 0 | 0 | 0 |

Notes:

- The v3 `declared` count was inflated. v3 treated a provider's convening date, or any contributed winner, as a declaration. Under v4, `declared` requires an authority act or an official final publication. The large move from `declared` to `reported` is therefore relabelling with stated evidence, not lost data.
- On 7 October the presidential outcome metric is one lower than on 5 October. Brazil's 4 October first round is now the latest presidential record, and its decisive round is pending.
- Same-source records never count as corroboration. Corroboration still requires a different lineage, and none was found.

## 1. Declaration, certification and disputes

The v3 rule withheld seven presidential outcomes on the strength of claims:

| Country | Claim (actor) |
| --- | --- |
| DZA | challenge (Aouchiche and Cherif) |
| ECU | recount *requested* (González) |
| GTM | challenge |
| NAM | rejection (Panduleni Itula) |
| SLE | allegation (All People's Congress) |
| VEN | rejection (OAS) |
| ZMB | rejection (unnamed: the sentence's subject is a pronoun) |

None of these was an authority's ordered or active recount, a suspension or an annulment. All seven are now `reported`, each with a caveat naming the claim. Six gained the outcome metric. ZMB already had the metric through a same-contest record while its state said `disputed`, which was inconsistent; that is now resolved.

Recorded claims in the 7 October ledger:

| Kind | Count |
| --- | --- |
| Rejections | 8 |
| Allegations | 9 |
| Protests | 5 |
| Court filings | 2 |
| Challenges | 2 |
| Recount requests | 1 |
| Whole annulments | 2 |
| Partial annulments | 0 |

Claims are recorded only when they concern the result. Pre-election complaints are not result disputes, and neither is "contested by seven parties", which describes competition. Claimants are named without time phrases, roles or section headings, and a clause fragment is recorded as an unknown claimant.

The rule set is in `docs/latest-election-evidence-standard.md`, section *Result status model (v4)*.

## 2. Convening

In the final generation, 162 legislatures have a provider first-session date:

- **137 are `reported`:** the provider or an article supplies figures.
- **25 are `held-results-unavailable`:** the body convened, but no figures were captured.

Convening never supplies seats, declaration, certification or a winner. Under v3, 26 of these were `declared` on convening alone. No map metric was lost by the correction: those rows carried only date and turnout, which remain usable.

Appointed and suspended chambers keep their institution states (`appointed-institution`, `suspended-institution`).

## 3. Snapshot dates

**Three times per record.** Each record keeps:

- `timing.effective`: polling, declaration and certification dates;
- `timing.published`: the pinned article revision;
- `timing.captured`: first and last capture.

**Retrospective evidence.** Evidence captured after a cutoff, describing facts effective on or before it, is flagged `timing.retrospective`. This covers 398 rows for 5 October and 212 for 7 October. The numbers are high because each cutoff is the pass's start instant and captures follow it. Three official records in the 5 October snapshot fall in this class: CZE 2013, CZE 2018 and CHE December 2025, captured on 7 October at 19:00 UTC.

**Later developments.** Developments dated after the cutoff go to `laterDevelopments` and are not applied. No ledger row has one. Contributed articles are pinned to the revision current at each cutoff, so later changes cannot enter an earlier snapshot.

**Facts established later.** Facts that later evidence establishes about the 5 October date are recorded in `build/catalog/retrospective-2026-10-05.json`:

- BRA legislative: election held 2026-10-04;
- BRA presidential: election held 2026-10-04.

The 5 October generation itself is not changed.

**Archive carry-over.** Records carried from earlier generations come only from a snapshot whose cutoff is at or before the one being built.

## 4. Country gaps (7 October)

84 core rows are unresolved:

| Group | Rows | Exact reason (from the ledger) |
| --- | --- | --- |
| A: applicable, missing evidence | 4 | MHL, MUS: general-election article; the parliament elects the president separately, and no vote date is stated. WSM: the 2022 O le Ao o le Malo article has no supported date evidence. SUR: discovery lists the 2025 cycle, so the 2010 record is not presented as latest. |
| B: no directly elected presidency, source required | 31 | Registered constitutional sources were attempted, but the fetch failed or the text did not match the registered statement. Non-applicability is not marked without a matching source. |
| B: appointed body | 5 | BRN, GNB, QAT, SAU, SSD legislatures (provider records appointment) |
| C: suspended | 3 | AFG, KWT, MMR legislatures |
| D: held, results unavailable | 29 | Mostly convened legislatures without captured figures (e.g. ARE, CHN, COL, EGY, KOR), plus CHN, LBN, MDG and VAT presidential |
| D: held, results incomplete | 2 | BRA (decisive round pending), GNB (results annulled) |
| D: no single-winner outcome | 1 | BIH: collective presidency, three members elected |
| D: outcome not captured | 1 | PLW: the article states no winner, and office-holder fields are not used |
| E: acquisition/extraction failure | 8 | BWA, ERI, LAO, LBY, PRK, SMR, SSD presidential and VAT legislative: every attempted source was blocked or failed (e.g. IDEA HTTP 403) |

The per-row list, with evidence locators, is in `docs/worldwide-snapshot-2026-10-07-countries.md`. The corrected 5 October equivalent is `docs/worldwide-snapshot-2026-10-05-v4-countries.md`.

## 5. Country-level changes, baseline to 7 October (with locators)

Every gain cites a captured revision or official page, with its SHA-256.

**Presidential outcomes gained (10):**

| Country | Change | Source |
| --- | --- | --- |
| CHE | Guy Parmelin, declared 2025-12-10 | parlament.ch dispatch `64d7d463…`; latest established via the archive index |
| DZA | restored, with challenge caveat | oldid 1377636008, `b1972530…` |
| ECU | restored, with recount-requested caveat | oldid 1378272799, `846e7c2a…` |
| GTM | restored, with challenge caveat | oldid 1377099790, `11be98d5…` |
| NAM | restored, with rejection caveat | oldid 1374262832, `a1516dde…` |
| SLE | restored, with allegation caveat | oldid 1377265220, `744eb7cf…` |
| VEN | restored, with rejection caveat | oldid 1377941370, `63d195ad…` |
| PAN | José Raúl Mulino (one person on three ballot lines, now one candidate) | oldid 1377841190, `3e456f59…` |
| IND | Droupadi Murmu (scoped lead sentence "won the election") | oldid 1376491089, `bc159ee6…` |
| GRC | Konstantinos Tasoulas ("was elected as President") | oldid 1378318425, `42e1be2a…` |

**Legislative metrics gained:**

| Metric | Countries |
| --- | --- |
| Seats and majority (13) | ATG, BIH, GIN, HRV, JOR, MDV, MKD, NRU, OMN, PAN, RUS, TGO, ZAF |
| Vote share (6) | ATG, BRA, MKD, NRU, OMN, PAN |
| Turnout (6) | BHS, DOM, LCA, MWI, ROU, VNM |

**Eligibility losses, each explained:**

| Row | What happened |
| --- | --- |
| BRA presidential, outcome | The latest is now the 2026-10-04 first round; decisive round pending. The 2022 winner is not shown as current. |
| BIH legislative and presidential, partial-count metric | The count completed. BIH presidential is a collective presidency, so there is no single-winner metric. |
| MHL and MUS presidential, date | False identities removed: general-election articles where the parliament elects the president on another day |
| SUR presidential, date | The 2010 record is not shown as latest because discovery lists the 2025 cycle. Neither its date nor its outcome is presented. |
| RUS legislative, date | Linked contributed records disagree on polling dates. Seats and majority were gained. |

**Corrections found and fixed while auditing:**

- **SYR:** the winner was the vandalised Wikidata label "Bashar Donkey"; it is now Bashar al-Assad, taken from the article.
- **KOR, GHA, HRV:** candidate figures came from a party primary or from total rows.
- **EST:** the latest presidential record was 2021; it is now the 2 September 2026 election (Ülle Madise). The parser had rejected "took place in Estonia on".
- **NRU:** the presidential vote is now dated 14 October 2025, the date stated in the article, instead of the parliamentary polling day.
- **Archived records from rejected articles:** AGO, MHL, MUS and SUR general-election presidential records carried in the archive were removed, with the reason recorded.

**5 October to 7 October:** 24 rows changed. Almost all are re-pinned article revisions without substantive change. The new developments are:

- BRA: the 4 October elections (legislative reported; presidential pending its runoff);
- BIH: the count resolved (partial to reported).

## 6. Latest versus results

"Latest" is validated separately from results:

- **Decisive rounds after the cutoff** are recorded as pending, not dropped (BRA).
- **Later cycles listed by discovery:** when discovery lists a later cycle the pass could not identify, the older record is withheld (SUR).
- **Separate presidential votes** reported inside parliamentary articles take their own stated date (NRU).
- **Authority statements:** primary latest-election statements establish 6 legislative and 4 presidential rows.
- **Corroboration:** no row has independent corroboration from a different lineage. Same-source and mirror records are not counted.

## 7. History

| | Baseline | 5 Oct | 7 Oct |
| --- | --- | --- | --- |
| Distinct elections | 3408 | 3409 | 3411 |
| By category: legislative / presidential / upper house | 2703 / 167 / 538 | 2703 / 168 / 538 | 2704 / 169 / 538 |
| Held source records | 4301 | 4304 | 4348 |
| All source records | 4482 | 4485 | 4529 |
| Candidate rows | 1886 | 1971 | 2160 |
| Party rows | 13514 | 13916 | 14142 |
| Years covered | 1900–2026 | 1900–2026 | 1900–2026 |
| Countries with history | 192 | 192 | 192 |

Distinct elections are counted separately from source records. On 7 October, 937 held records are same-election alternatives from other sources, kept as alternatives and never merged. Offices, chambers, rounds and systems are kept per record. Results stay attached to their own jurisdictions and are not redrawn onto modern boundaries; the national outline is labelled schematic.

## 8. Verification

| Check | Result |
| --- | --- |
| Full test suite (`npx playwright test`) | 297 passed |
| `npm run verify:boundaries` | 254 layers pass |
| `npm run verify:parlgov` | 39 ParlGov files byte-reproducible |
| `git diff --check` | clean |
| Offline replay, 7 Oct (`elections:evidence --offline`, then `elections:backfill --offline`, twice each) | Generation `c7e82718` identical across runs; authority audit byte-identical |
| 5 Oct reconstruction from bundle v10 (empty checkout, no network) | ok: generation `321c90c7`, ledger and events match exactly |
| 7 Oct reconstruction from its bundle | ok: ledger and events match exactly |
| Fresh online bootstrap (`node scripts/verify-catalog-bootstrap.js`, empty checkout, 2026-10-08 14:49–14:59 UTC) | Catalog acquisition complete (`catalogOk: true`, generation `44541a5e…`). Overall `ok: false`: ParlGov history from Harvard Dataverse returned HTTP 403, so ingestion is partial. This run covers the registered catalog sources only, not the discovery and authority evidence pass, so its generation differs from the snapshot. |

**7 October reconstruction, manifest differences.** The reconstructed generation id (`3845d3b0…`) differs from `c7e82718` for two reasons:

- The main database's manifest also lists 968 uncited evidence files carried along the generation chain, and the bundle exports only cited evidence.
- The ParlGov ingestion pointer path differs, although the content hash is the same (`58213ba0…`).

**Online acquisition, recorded separately from offline replay.** The authority pass for the 7 October cutoff was acquired online on 2026-10-08, between 05:53 and 14:29 UTC, from free public endpoints:

| | Count |
| --- | --- |
| Link attempts | 413 |
| Succeeded | 232 |
| Failed | 181 |

The failures break down as:

- 83 fetch failures;
- 57 × HTTP 403 and 16 × HTTP 404;
- 9 × HTTP 500;
- other errors.

No access restriction was bypassed. Offline replays reuse exactly these attempts: recorded failures stay failures, and links the recorded pass never saw are marked "not attempted", without a check time.

Regressions were added for every case the brief lists:

- a declared result with a recount request;
- an officially ordered recount;
- partial annulment;
- convening without complete figures;
- later evidence confirming an earlier fact;
- a later development excluded from an earlier snapshot;
- constitutional non-applicability;
- duplicate sources and historical grouping.

Also covered by regressions:

- ballot-line merging;
- primary-versus-national tables and summary rows;
- collective presidencies;
- Wikidata label corroboration;
- later-cycle detection;
- separate presidential votes, with and without a year;
- "took place in … on";
- lead-sentence winners;
- claim relevance and claimant names;
- offline authority replay;
- year-correct official notes.

## Reproduction

```
node scripts/verify-catalog-bootstrap.js --bundle build/evidence-bundles/2026-10-05-v10
node scripts/verify-catalog-bootstrap.js --bundle build/evidence-bundles/2026-10-07
node scripts/elections.js evidence --offline
npm run elections:backfill -- --offline
node scripts/retrospective-findings.js 321c90c7abbde6492dfcdefb3298e6976bbdabac5a98d8eea112818ba61fa390 c7e82718354da8b2c506866bc211257c1307ccc0553c3ab6a73ded0a751b2c82
npm run demo:catalog
```

## Not done / open

- **Primary evidence:**
  - presidential latest-election confirmations: 4 of 142 applicable;
  - official declarations: 3; certifications: 5;
  - independent corroboration: 0.
- **Contributed sources:** most outcomes rest on contributed sources, labelled as such.
- **Unresolved rows:** 84 core rows, listed with exact reasons above; non-applicability for 31 presidencies awaits a matching constitutional source.
- **Lead-sentence rule:** PLW states no winner in text, and office-holder fields are deliberately not used.
- **Wikidata label check:** a legitimate variant spelling can fail it. Paraguay's "Santiago Peña Palacios" did; the article's name is used instead.
