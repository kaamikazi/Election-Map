# Publication Workstation

One reviewed map should produce a truthful X graphic and a complete, editable
content pack — without any way to present partial, projected, disputed,
historical or mixed data as a clean final result by accident.

This is a local, manual editorial tool. It does not fetch live results, post to
X, schedule anything, or write captions with a model.

## The workflow

1. **Import** a result as before (paste, Wikipedia, or the ParlGov archive).
   The import review still asks how the data relates to the map and blocks
   results older than their boundaries.
2. **Review and export** (the Export button). The dialog is the review:
   - metadata on the left — identity, country, office, type, round, election
     date, map purpose, result status, percentage counted, source update time
     entered with an explicit UTC offset,
     headline, subtitle, editorial note;
   - on the right, the image it produces, the exact text the image carries, and
     an editable caption draft with an estimated X length.
3. **Fix every blocker.** They are listed first, in plain words.
4. **Tick "Reviewed — ready to publish".** It is disabled while anything blocks
   publication. A saved review receipt is tied to the map and metadata; later
   edits return the graphic to draft. Setting `ready: true` in JSON alone does
   not approve a map.
5. **Export publication pack** — one ZIP: a PNG per chosen profile,
   `caption.txt`, `metadata.json`, and `source-and-methodology.txt` when the map
   has caveats.

Drafts can always be saved and downloaded as PNGs, but an unreviewed image says
`DRAFT` in its status badge, and a saved draft is named `…-draft.json`.

## Publication metadata

Stored in the document as `state.publication` (schema 8). Headline and subtitle
are the document's existing `title` and `sub`, not copies. Documents from schema
6 and earlier open unchanged, with empty metadata, as drafts; an unsourced old
map with no status exports exactly as before.

| field | meaning |
|---|---|
| `electionId` | dataset identity: country · date · office · round |
| `country`, `office`, `electionType`, `round` | what was contested |
| `electionDate` | the day of the vote — **not** when the data was retrieved |
| `purpose` | result, partial update, projection, historical, upcoming, flags, explainer |
| `status` | upcoming, polls-open, projected, official-partial, official-final, disputed, recount, historical |
| `counted` | percentage counted, or null |
| `updatedAt` | when the result or source was last updated (UTC) |
| `timeInputOffset` | explicit offset used to enter and redisplay the instant |
| `note` | editorial note or caveat, printed on the image |
| `captionDraft`, `captionBasis` | exact edited caption and the map/metadata reviewed with it |
| `ready`, `approvalFingerprint` | explicit approval tied to the reviewed document |

The ParlGov archive fills its own metadata in (it is historical by definition).
Nothing else is guessed: a status is never inferred from a table.
The browser timezone is ignored. The field accepts numeric offsets, so a named
zone's ambiguous daylight-saving hour is never silently interpreted. Review,
PNG, caption and JSON describe the UTC instant; election date stays a calendar
date. Retrieval time remains separate from source update time.

## What blocks publication

- no map purpose, no election identity, no result status, no election date, no office;
- a status that does not fit the purpose (a partial update marked final; a
  projection that is not "projected"; historical data marked current);
- an official partial result with no percentage counted;
- an active count, projection, dispute or recount with no source update time;
- an invalid or ambiguous update offset;
- a clear settled-result claim in editorial headline, subtitle or note of an
  unsettled map; structured party names such as "Victory Party" do not count;
- calling an old settled election "current" or "live" without explaining the update;
- an edited caption made stale by changes or missing its status, source link or
  required caveat;
- a sourced result with no source, with hand-entered values that carry no
  source, or with a source that has no link or citation;
- archive values presented under a current status;
- results drawn on boundaries redrawn since they were cast (the existing
  vintage override) without an editorial note explaining it.

Warnings, which are shown but do not block: an active status more than 60 days
after the vote (including a genuine ongoing recount), "current" wording on an
old active count that needs source review, mixed sources (disclosed
in image and caption), results and boundaries from different years, and named
gaps in archive coverage. Election age alone cannot settle a status.

## What the image says

A status badge above the headline, in neutral colours only — never a party
colour, never a warning colour that could collide with one:

| status | badge |
|---|---|
| official final | `OFFICIAL FINAL` (outlined) |
| official partial | `OFFICIAL PARTIAL · 62.4% COUNTED` |
| projected | `PROJECTED · NOT FINAL` |
| disputed | `DISPUTED · NOT SETTLED` |
| recount | `RECOUNT PENDING · NOT FINAL` |
| polls open | `POLLS OPEN · NO RESULTS YET` |
| upcoming | `UPCOMING · 2026-10-04` |
| historical | `HISTORICAL ARCHIVE · 1945` (outlined) |

Everything unsettled, and every draft, is a solid pill. Unreviewed maps read
`DRAFT · …`. The footer adds "Results as of …" for active counts, disputes and
recounts, plus the editorial note. Historical world maps say they use modern
borders.

## Export profiles

| profile | size |
|---|---|
| X landscape | 1600 × 900 |
| X square | 1200 × 1200 |
| X portrait | 1080 × 1350 |
| Custom | 600–4096 px each side, at most 3:1 |

Footer text never goes below 11px, and every footer line wraps rather than
running off the edge. If the attribution cannot fit while the map keeps at
least 35% of the image height, the export stops and says to use a taller
profile or fewer sources. Nothing is silently shrunk.

## The caption

Assembled by fixed rules from the metadata, never by a model, then editable in
the review dialog:

```
Test assembly: partial count (SYNTHETIC)
Testland (synthetic) · Test assembly · General · Round 1 · 2026-09-25
Official partial result: 62.4% counted as of 2026-09-26 14:05 UTC. Not final.
Leading party by country so far (not final): Alpha Party 3 · Beta Party 3 · Gamma Party 2.
Synthetic demonstration data.
Source: SYNTHETIC DEMONSTRATION DATA — not a real election https://example.org/…
```

"Winning party" is used only for an official final result; partial and
projected counts have leaders "so far (not final)"; disputed and recount results
have a "declared leader (not settled)". The reviewed caption is saved in the
map and copied **exactly** to `caption.txt`. If data or metadata changes, the
edit stays visible and needs review. Use "Keep reviewed caption" after checking
it or "Regenerate from metadata" to replace it explicitly. Required status
wording, source links and caveats cannot be silently removed.

The dialog shows an **estimated** weighted length against the
[standard 280-character limit](https://help.x.com/en/using-x/how-to-post).
Links count as 23 according to [X's published text configuration](https://github.com/twitter/twitter-text/blob/master/config/v3.json);
complex Unicode and emoji may count differently in the X composer. Check
near-limit captions there before posting. The app never truncates a caption.

## Historical series review

Series frames are draft by default. Review is for one defined run, not for an
unrelated single map. The manifest lists every year, source, boundary, coverage
gap and caveat. A review receipt binds that manifest, the application/archive
inputs and the exact PNG bytes the editor inspected.

```bash
npm run series -- --from 1945 --to 1946 --out build/my-series
# Open every draft PNG at phone size and read manifest.json.
npm run review:series -- --dir build/my-series
# Type the displayed REVIEW phrase only after checking the run.
npm run series -- --from 1945 --to 1946 --out build/my-series --approval build/my-series/approval.json
```

Reviewed output goes to `build/my-series-reviewed`, leaving the draft and
receipt intact. A changed date, frame, source, boundary, caveat, rendering input
or reviewed PNG makes the receipt invalid. Series approval does not independently
verify historical facts. Draft series keep their DRAFT badge, including runs
without an approval receipt.

## Reproducing the demonstration

```bash
npm run demo:publication
```

It starts its own server and writes `build/publication-demonstration-audit/`
(generated, not committed):

| file | what it shows | data |
|---|---|---|
| `01-historical-1945-landscape.png` | historical badge, named coverage gaps, Norway note | ParlGov 2024 archive |
| `02-partial-landscape.png` | `OFFICIAL PARTIAL · 62.4% COUNTED`, "as of" line | synthetic |
| `03-disputed-square.png`, `03-recount-square.png` | disputed and recount badges | synthetic |
| `03-recount-old-landscape.png` | ongoing synthetic recount more than 60 days after vote | synthetic |
| `04-mixed-source-landscape.png` | "Mixed sources:" footer naming both sources | synthetic |
| `05-profile-{landscape,square,portrait}.png` | one map in all three X profiles | synthetic |
| `06-mobile-review.png` | 390 × 844 review; the headline "wins" is blocked | synthetic |
| `06-mobile-caption-review.png` | the editable caption on a narrow phone | synthetic |
| `07-desktop-review.png` | 1440 × 900 review, ready to publish | synthetic |
| `08-publication-pack.zip` and `08-publication-pack/` | a complete pack with an edited caption, unpacked | synthetic |
| `README.txt` | what each file is and whether its data is real | — |

The clock is fixed, so it produces the same files every run. Synthetic maps use
invented parties (Alpha, Beta, Gamma) on real outlines and say SYNTHETIC in
their title and source. **None of it is a live or current result.**

## What a human must still check before posting

The tool stops the mistakes it can recognise. It cannot confirm facts it was
never given. Before posting, a person must:

1. Open the source link or revision and confirm the numbers on the map match it.
2. Confirm the election identity: country, date of the vote, office, type, round.
3. Confirm the status against the official body: is it really final? Is the
   percentage counted current? Is anything disputed or under recount?
4. Confirm the update time is when the source last changed, not when it was read.
5. Check the party grouping and colours: merged spellings, coalitions, and
   whether a colour could be mistaken for another party's.
6. Check the boundary set and its year against the election.
7. Look at every image in the pack at phone size: badge, headline, footer,
   caveats all legible.
8. Review and edit the caption in the dialog; keep the source link, status and
   caveats. Confirm its length in X's composer before posting.
9. For historical maps: remember the outlines are modern, archive coverage has
   named gaps, and a government in exile is not territorial control.
