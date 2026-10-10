# Worldwide latest-election snapshot — 5 October 2026 verification

| | |
| --- | --- |
| Cutoff | `2026-10-05T17:01:31.000Z` (23:01:31, 5 Oct 2026, Asia/Dhaka) — the actual execution-start instant of this pass |
| Previous snapshot | `2026-10-01T05:00:35.000Z`, generation `a952b479…` (immutable, retained; listed in `data/catalog-execution.json` `previousSnapshots`) |
| Final generation | `41ce6bfe8880bb915a9ca8e0e52beb72a640a0d6f33c6e2d721aa814f56d8fbe` (phase B, history after the country pass) |
| Evidence standard | `docs/latest-election-evidence-standard.md` v2 |
| Country appendix | `docs/worldwide-snapshot-2026-10-05-countries.md` (390 rows) |

Nothing was committed, pushed, deployed or published. All generated data lives
in the git-ignored `public/data/`, `data/raw/` and `build/` trees.

## 1. Starting point

The figures quoted in the brief (190 legislative identities and 164 results; 2 presidential; zero confirmed) **predate the previous latest-election pass**. That pass was already implemented.

Recomputed from the 1 October generation's `ledger.json` (core scope, 195 states):

- **Legislative:** 191 held identities, 153 with results.
- **Presidential:** 142 held identities, 122 with results.
- **Established latest:** 1 (the UK), counted as "independently confirmed". That was a conflation; see §3.
- **Presidential applicability unknown:** 55 entries.
- **Results pending:** 20 presidential entries were "newer held, results pending".

## 2. Diagnosis: defects versus unavailable evidence

### Implementation defects

Each defect below is fixed, with a regression test.

| # | Defect | Effect on 1 Oct snapshot | Test |
| --- | --- | --- | --- |
| 1 | Infobox regex `<table>…</table>` was lazy, so it stopped at the first nested table | Combined general-election articles (BRA, ARG, CHL, PER, BOL, LBR, SYC, USA…) yielded no date: the presidential event was dropped | `nested infobox tables no longer truncate…` |
| 2 | One article/entity linked to both categories was stored in a `Map` by entity id, so the second category overwrote the first | General elections lost one office | (covered by #1 fixture: both categories parse) |
| 3 | "Cancelled" was matched on any annul/cancel word within 90 characters of "election" | KGZ 2021, ROU 2025, JPN 2026, GTM 2023 and GAB 2025 were marked cancelled, then excluded from selection | `an annulment of a different or partial election…` |
| 4 | The "Elected President" cell was read as a name even when it said "Election results annulled; X named Transitional President" | GNB 2025 would have named the post-coup appointee as the winner | `an annulled result after polling is held…` |
| 5 | Same-date tie broken by id, so an empty record could hide a record with results | e.g. IND presidential: the empty Wikidata record was selected over the record with results | `a same-date record carrying results…`, `an empty provider record…` |
| 6 | Wikidata SPARQL limited to 20 s with no retry | USA, FRA, BRA, IND and 8 others had no country query in every run | (network; timeouts 0 in the final batch) |
| 7 | Label batches requested full `claims` for country items | 2 label batches timed out; offices were left as bare Q-ids | (network; failures 0 after fix) |
| 8 | `/president/` matched "Vice President of India" | A vice-presidential election could be selected as presidential (surfaced once #6 was fixed) | `a vice-presidential office is not a presidency…` |
| 9 | Date ranges "12–13 April 2026" and "4 February and 3 March 2024" parsed only one day | Wrong start dates (PER, SLV) | `date ranges and shared-year pairs…` |
| 10 | A contributed record days later than the IPU record displaced it, even though IPU carries the results | IDN (wiki 24 Feb vs IPU 14 Feb), PER, DOM, GTM, PLW lost IPU results | `a contributed record days after a provider record…` |
| 11 | Wikipedia legislative events never carried party results | Wherever IPU lagged, the entry was "results pending" | `a legislative seat table must reconcile to the lower house…` |
| 12 | Upper-house seat totals were taken first in bicameral infoboxes | PER and MEX reconciled to their Senate tables (caught in review, before commit) | same test |
| 13 | Authority pages were captured but never assessed: only the UK had a rule, and 155 captures carried no assertion | "Evidence never connected to validation", so zero established latest elections | `authority statements and dated indexes…`, index tests |
| 14 | `independentlyConfirmed` was set whenever one authority established the latest election | Authority establishment was reported as independent corroboration | `authority establishment is not independent corroboration…` |
| 15 | Unchanged re-fetched bytes keep their first receipt, so check time read as the old capture date | Fresh index checks looked stale (AUS) | `an unchanged page refetched for this pass is checked now…` |
| 16 | A failed refresh dropped previously captured evidence; a young cache older than the cutoff was reused | Possible loss of results; freshness inferred from a pre-cutoff page | `a failed refresh replays the earlier capture…` |
| 17 | A re-parse of the same immutable Wikipedia revision (different rendered bytes) collided with the archived parse | 6 false "needs-review" identity conflicts | engine supersedes same-revision re-parses (the earlier generation keeps them) |
| 18 | Contributed counts captured within days of polling were treated as settled | BIH (4 Oct) and LVA (3 Oct) would have shown seat metrics from early counts | `contributed results captured days after polling are provisional…` |
| 19 | Registered catalog downloads used a 20 s limit | The fresh bootstrap lost the IPU elections collection (1 legislative result) | bootstrap re-verified (163 results) |

### Genuinely unavailable evidence

These are recorded per entry, not repaired:

- **Blocked publications:** official sites returning 403 or a JavaScript challenge to registered clients, including the French Interior Ministry results archive, japan.kantei / kunaicho, NZ DPMC / legislation.govt.nz, thedanishparliament.dk, Bahamas, Jamaica, Saudi Arabia, Bahrain, Thailand, Malaysia, and vrk.lt.
- **Missing pages:**
  - NARA's Electoral College 2024 page (404);
  - Brazil's TSE 2022 simplified JSON (404, NoSuchKey);
  - Poland's PKW results (rendered only by JavaScript);
  - Finnish and Slovak guessed paths (404).
- **No electoral event exists:**
  - presidential: Eritrea (none since 1993), Libya (never held), South Sudan (none since independence);
  - legislative: appointed bodies in BRN, QAT, SAU and SSD.
- **No official source located for indirect presidential elections:** LBN, CHN, SUR, MUS, MHL and BWA. Searches returned only news coverage; these remain unresolved rather than being sourced from news.

## 3. Freshness states (v2)

- `latest-established` — captured authority evidence supports the selected event as latest by the cutoff. One authority suffices.
- `latest-corroborated` — additionally supported by a second qualifying assertion from a different lineage. A mirror of the same publication does not count.
- `latest-available-unconfirmed` — a held record exists; nothing has checked whether a newer election was held.
- `newer-held-results-pending` — the latest held record has no settled results: pending, partial, annulled, or provisional (contributed counts within 14 days of polling).
- `unknown` — no held identity.
- `sourced-non-applicability` — a constitutional or authority source states that this category has no national election.

Records were not relabelled. Every change in a state comes from new evidence or a fixed defect listed above.

## 4. Before / after (core scope)

| Measure | 1 Oct | 5 Oct |
| --- | ---: | ---: |
| Legislative held identity | 191 | 191 |
| Legislative results acquired | 153 | **169** |
| Legislative seat metric eligible | 115 | 125 |
| Legislative turnout eligible | 104 | 112 |
| Legislative results pending | 50 | 39 (4 of them provisional) |
| Legislative latest established by authority | 1 | **5** |
| Presidential held identity | 142 | 145 |
| Presidential results acquired | 122 | **138** |
| Presidential outcome metric eligible | 113 | 127 |
| Presidential results pending | 20 | 9 |
| Presidential unknown | 53 | 40 |
| Presidential sourced non-applicability | 0 | **10** |
| Presidential latest established by authority | 0 | **3** |
| Independently corroborated (either category) | 1 (conflated) | **0** |
| Editorially verified | 0 | 0 |

End states:

- **Legislative:** 169 sourced results, 26 unresolved.
- **Presidential:** 138 sourced results, 10 sourced non-applicability, 47 unresolved.

All 73 unresolved entries record their attempts and a next action.

## 5. Primary confirmation versus corroboration

Latest established by authority evidence:

- **Legislative:**
  - GBR — UK Parliament general-elections index;
  - AUS — AEC dated federal-elections index;
  - IRL — Electoral Commission: "The most recent general election took place on Friday 29 November 2024";
  - CZE — CZSO volby.cz category index;
  - AUT — BMI Nationalratswahlen index.
- **Presidential:**
  - IRL — "The most recent presidential election took place on Friday 24 October 2025";
  - CZE — volby.cz index plus official result;
  - AUT — BMI index plus official final result.

**Independent corroboration: 0.** No second, genuinely independent lineage was captured for any of them. IPU data is parliament-supplied, so it is not independent of a parliament index. Contributed sources do not qualify.

Sourced non-applicability, presidential:

| Country | Source |
| --- | --- |
| GBR | Royal Household |
| NLD | government.nl |
| SWE | Riksdag |
| NOR | Storting, Constitution Art. 3 |
| LUX | gouvernement.lu |
| ESP | Casa Real |
| CAN | Constitution Act 1867 s. 9 (Justice Canada), plus Canadian Heritage |
| AUS | Governor-General |
| LSO | Parliament of Lesotho |
| DNK | denmark.dk |

27 further constitutional sources are registered and attempted on every snapshot. They are blocked or did not match: JPN, BEL, NZL, JAM, BHS, PNG, TUV, BLZ, THA, MYS, KHM, MCO, LIE, AND, JOR, SAU, BHR, QAT, OMN, MAR, BTN, SWZ, KWT, TON, BRN, and GRD (whose page now serves an interstitial).

## 6. Results and metrics acquired

### Official results

Registry: `data/official-results.json`; parser: `scripts/catalog/official-results.js`. Every parser reads the captured bytes.

- **CZE presidential 2023 (volby.cz):**
  - both rounds and all 8 candidates;
  - the elected candidate taken from the authority's `*` marker, not the vote ranking;
  - turnout 70.25% (issued envelopes / voters on the roll), checked against numerator and denominator;
  - the second-round date is not stated on the page, so it stays unknown.
- **AUT presidential 2022 (BMI):**
  - 7 candidates' national votes;
  - turnout 65.2% (votes cast / eligible voters);
  - final result determined by the Federal Electoral Board on 17 Oct 2022;
  - the winner is **not** stated on the page, so `elected` stays null and the outcome metric is withheld.
- **ARE presidential (u.ae):**
  - indirect election by the Federal Supreme Council on 14 May 2022, with the officeholder named by the authority's statement;
  - votes not applicable.
- **Retained official providers:** FRA (Constitutional Council declaration), USA (FEC 2024 popular-vote results; no winner declaration, because the NARA page is 404) and GBR (UK Parliament).
- **Official category indexes:** CZE and AUT; dated indexes and statements: AUS and IRL.

### Contributed results (attributed, never presented as official)

- **Legislative party seat tables:** read only when they reconcile exactly to the infobox "All N seats" figure for the lower chamber. 100 of 181 articles qualify. Mixed-tier, non-partisan and non-reconciling tables yield no results.
- **Presidential candidate tables:** taken from the first national table naming the infobox nominees, so primaries, governor races and senate tables are excluded.

Unknown fields stay null. No winner is inferred from officeholders or vote ranking, and no government is inferred from the largest party. Metrics are judged independently: missing votes do not block seats.

## 7. Remaining unresolved

| Category | State | Countries |
| --- | --- | --- |
| Presidential | Missing evidence (40) | Monarchies/realms with blocked or unmatched constitutional sources: AND ATG BEL BHR BHS BLZ BRN BTN GRD JAM JOR JPN KHM KNA KWT LCA LIE MAR MCO MYS NZL OMN PNG QAT SAU SLB SWZ THA TON TUV VCT |
| | | Collegial or indirect heads of state, or no event: BWA CHE ERI LAO LBY PRK SMR SSD WSM |
| Presidential | Pending / provisional / annulled | CHN, MHL, MUS, SUR, VAT; LBN and MDG (no elected marker); BIH (provisional, 4 Oct); GNB (annulled 2025, latest completed 2019) |
| Legislative | Pending / provisional | BFA CHN COL EGY ERI GAB GIN KIR PLW RUS SOM SWZ SYR TON TUV WSM ZMB; BIH, LVA (provisional) |
| Legislative | Suspended | AFG KWT MMR |
| Legislative | Appointed | BRN GNB QAT SAU SSD |
| Legislative | Missing evidence | VAT |

**Visible conflicts** (tooltips and ledger):

- cross-source date proximity, e.g. AFG (IPU 20 Oct vs Wikipedia 27 Oct 2018), IDN, ARE, KIR;
- linked end-date conflicts;
- disputed results: GEO, MOZ, COM, SLE, TGO, MLI, PSE.

**Upper house:** kept separate and unchanged (65 held, 31 results).

## 8. Historical coverage

The backfill ran only after the country pass. Every source record is retained, and identities are grouped conservatively.

- **Records:** 4,480 source-specific records grouped into 3,905 identities: 4,299 held, 133 holding unconfirmed, 48 appointments.
- **By source:**

  | Source | Records |
  | --- | ---: |
  | IPU | 2,970 |
  | ParlGov | 845 |
  | Wikipedia | 341 |
  | Wikidata | 317 |
  | Official | 7 |

- **By category (held):** legislative 3,468, upper house 538, presidential 293.
- **Years:** 1900–2026, by source:
  - ParlGov 1900–2023;
  - IPU 1967–2026;
  - discovery 2003–2026.
- **Countries:** 192 of 195 core states have held-election history; median 13 distinct dates. 153 core states reach back before 1990, and 21 before 1950. None for BRN, SAU or SSD.
- **Usable metrics (held records):**

  | Metric | Records |
  | --- | ---: |
  | Date | 4,259 |
  | Seats | 1,328 |
  | Turnout | 467 |
  | Vote | 500 |
  | Presidential outcome | 229 |

- **Geometry:** national schematic outlines for all states except Tuvalu (no outline in the world layer). No subnational historical boundaries are claimed; subnational display still needs a compatible boundary layer (UK 2024 only).

Gaps between records are not evidence that no election was held.

## 9. Verification

| Check | Result |
| --- | --- |
| Full Playwright suite | **254 passed**, including 20 new regression tests from this pass |
| `npm run verify:boundaries` | 254 layers pass |
| `npm run verify:parlgov` | 39 ParlGov files byte-reproducible |
| Offline replay (`elections:backfill --offline` twice) | Same generation `41ce6bfe…`, `changed: false` |
| Fresh-checkout bootstrap (`verify:catalog-bootstrap`) | Exit 0. From an empty cache: 190 legislative held, 163 results, 124 seat metric. |
| `git diff --check` | clean |
| Real-app drafts (`npm run demo:catalog`) | 6 drafts, badge `DRAFT · LATEST AVAILABLE SNAPSHOT`, cutoff in subtitle; seats 125, presidential 127, coverage 194 eligible |

**Fresh-checkout bootstrap — limitations:**

- ParlGov Dataverse returns 403. The pipeline continues without it; the local ParlGov seed is verified separately.
- The IPU `parliaments` collection timed out even at 60 s.
- The bootstrap rebuilds the provider baseline only. The rate-limited discovery and evidence pass (≈1 h) is a separate command.

**Drafts:** `build/catalog-demonstration/`

- `seats.png` — parliamentary;
- `presidential.png`;
- `coverage.png`;
- `date.png`, `turnout.png`, `vote.png`;
- each with `*-country-citations.json`, which cites every country's selected election.

**Provider batch:** the snapshot uses the provider batch captured 17:01–17:02 UTC on 5 October. The UN membership list is reused from its 1 October capture (7-day cache).

## 10. Reproduction

```sh
npm run elections:download -- --catalog          # registered providers
node scripts/elections.js evidence               # discovery + official results + authority/constitutional evidence + commit
node scripts/elections.js evidence --reuse-discovery   # reuse this cutoff's captured discovery batch
npm run elections:backfill -- --offline          # history after the country pass; replays byte-identically
npm run demo:catalog                             # real-app drafts
```

## 11. Main bottleneck removed

Evidence was being captured but never reaching validation. 155 authority pages were stored with no rule to read them. Parsers silently discarded combined general-election articles. Over-broad text heuristics cancelled held elections, and empty or contributed records displaced records that carried results.

Fixing these connected existing and new evidence to the ledger:

- authority rules and official parsers;
- nested-table parsing;
- scoped status signals;
- results-first same-contest selection;
- separate freshness states.

That produced the first established latest elections, the first sourced non-applicability, and 32 additional results, without lowering any standard.

**Worldwide factual completion is not claimed:** 73 core entries remain unresolved, and none of the 8 established entries is independently corroborated.
