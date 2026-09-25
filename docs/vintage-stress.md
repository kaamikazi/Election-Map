# 2019 results on 2024 boundaries — what actually happens

Run 18 September 2026, against `cons:GBR:CONSTITUENCY` (ONS July 2024, 650
units) and the Wikipedia list of MPs elected in 2019 (rev 1365930213).

## The answer: outcome 2

Of the three outcomes the milestone named, this is the middle one, and it sits
closer to the bad end than the count suggests.

| | |
|---|---|
| rows in the 2019 table | 651 |
| matched by name to a 2024 seat | **439** |
| unmatched (honest failures) | 212 |
| units marked partial by the milestone 8 machinery | **0** |
| units marked unsound by anything else | **0** |
| vintage warning in the export dialog | fires |

The map drew. 439 constituencies coloured in. Nothing anywhere — not the
counts, not the review, not the picture — distinguished a unit describing the
ground that voted from one that does not.

**Why the partial machinery saw nothing.** It only ever examines rows that
*failed*. A stranded name gets looked up at a deeper level and tested for
containment; that is how Cumilla was found inside Chittagong. Here nothing
stranded. The 439 rows matched, and a matched row is never offered to the
probe. This is not a bug in that machinery — it is the wrong tool. A redraw is
invisible to name matching by construction.

## How wrong the 439 are

Name matching cannot see a redraw, so the question is how much it misses. The
ONS publishes both sets, at the same generalisation, so this is measurable
rather than arguable:

- **pre-redraw**: `Westminster_Parliamentary_Constituencies_Dec_2022_UK_BUC`.
  There was no redistribution between 2010 and the 2023 review, so the Dec 2022
  boundaries **are** the boundaries the 2019 election was fought on.
- **post-redraw**: the July 2024 BUC set already in the registry.

For each name present in both, `scripts/measure-redraw.js` samples points
inside the old seat and asks how many fall inside the new seat of the same
name, using `d3.geoContains` — the same containment test the partition probe
uses, so this measures the app's own notion of "inside".

```
names present in both sets                             418
names that vanished (these become honest unmatched)    232

share of the OLD seat's ground still inside the NEW seat of that name:
  100–99%  (effectively unchanged)     86
   99–95%                              97
   95–90%                              62
   90–75%                              89
   75–50%                              67
   50–25%                              15
   25–0%   (different ground)           2

median name match kept 93.4% of its ground
332 of 418 changed at all · 173 lost more than 10% · 84 lost more than 25%
```

The worst cases are not marginal:

| shared ground | area change | seat |
|---|---|---|
| 14% | ×0.45 | Ashford |
| 24% | ×1.06 | Aylesbury |
| 25% | ×0.45 | Newcastle upon Tyne North |
| 26% | ×0.68 | Guildford |
| 26% | ×0.52 | Hemel Hempstead |
| 26% | ×1.42 | Stafford |
| 31% | ×1.65 | Chippenham |
| 33% | ×4.23 | Carlisle |

Ashford's 2024 seat holds 14% of the ground that voted in Ashford in 2019. On
the map it is simply Ashford, in the 2019 winner's colour.

**The ONS code does not rescue this.** Only 5 of the 418 name matches kept
their code, and 3 of those 5 are among the 86 seats that barely changed — the
other 413 codes were reissued as part of the review, including for seats that
did not move. A same-code test would reject 413 sound units and accept none of
the unsound ones. Geometry is the only signal that sees this, and at import
time there is exactly one boundary set in the room.

## What was built instead

Since no signal available at import time can mark *which* units are unsound,
the honest minimum the milestone specified is what shipped:

**`vintageBlock()` in `src/import/proposal.js`** — `applyProposal` refuses when
the results' year precedes the boundary set's vintage by more than a year.
Nothing is written. The review screen shows the reason above the warnings and
disables Apply, because a live button that fails on click teaches people that
the button lies.

**Only that direction blocks.** Results *newer* than the boundaries are just as
wrong, but they fail loudly — the seats that voted are missing from the map, so
the rows go unmatched and the review says so. Silence is what earns a block.

**The override is a tick-box, per import, never remembered.** When it is used,
`state.provenance.vintageOverride` travels with the document and the export
prints a line above the handle, brighter than the citations around it:

> Results from 2019 drawn on constituencies representing 2024: constituencies
> redrawn in between may not be the ones that voted.

## The bug this found

`provenance.asOf` was the *download* date for any Wikipedia-sourced map, and
the results' own date only for the archive. The vintage comparison was
therefore running on "today" — the milestone 9 UK map would have reported
"these results are from 2026 and the constituencies represent 2024".

`asOf` and `fetchedAt` are now separate fields with separate meanings.
`electionYearFromTitle()` reads the year off the article title and answers only
when the title names exactly one year in a plausible range; a title naming two
("the 2019–2024 Parliament") answers nothing, because choosing between them
would be a guess. A source with no date blocks nothing and claims nothing — the
footer already says "year not stated".

## What is still not solved

A boundary set that was *renamed* without being redrawn, and a seat redrawn
without changing name inside a set of the same vintage, are both still
invisible. So is any of this for a country where only one boundary vintage is
published — which is most of them.

Marking *which* units are unsound is possible only where two vintages of the
same boundary set exist, both reachable, at compatible generalisation. That is
true for the UK and for almost nowhere else, which is why it is not the
mechanism: the registry would carry a capability that one country could use.
The refusal is general; the marking would not be.
