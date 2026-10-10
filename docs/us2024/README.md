# United States presidential election · 5 November 2024

These are national election posts in the existing History Through Maps identity. All 50 states and the District of Columbia are covered, using official state-certified popular-vote results compiled by the FEC on 16 January 2025. Electoral College totals are also checked against the National Archives certificates table.

## Use the workflow

1. Run `npm ci` and `npm run dev`.
2. Under **Map style**, select **Start U.S. presidential election 2024**. The starter loads a complete document; undo restores the entire preceding document, including another layer or the Athens explainer.
3. Review the national totals, state/DC winner legend, all candidate/selection totals, sources and limitations. Tap a state or its search row to inspect all reported popular-vote categories and its electoral-vote allocation.
4. Select **Export**, then Square, Portrait or Widescreen, and **Download Paper + Lamplight**. The pair uses one synchronous snapshot and the normal composite/map renderer. The current theme is restored. Preview uses the same path; PNG downloads use the existing 1.5× scale.
5. Save/open preserves the source pack, assignments, citations, identity and USA inset projection in schema 8. Older documents remain supported. Both original presentation and History Through Maps remain available.

The starter protects its reported results and party names from painting/editing. Party colours can still be adjusted consistently for both themes. Clear results, change mode/layer, import another results dataset, or open another document to leave this post; undo restores it. A different projection or framing that clips a state stops national export. Mandatory national totals, candidate categories, legend and citations remain included even if an election-legend option is off.

## Samples

| Layout | Paper | Lamplight | PNG size |
| --- | --- | --- | --- |
| Square | [Paper](us2024-square-paper.png) | [Lamplight](us2024-square-lamplight.png) | 1800 × 1800 |
| Portrait | [Paper](us2024-portrait-paper.png) | [Lamplight](us2024-portrait-lamplight.png) | 1800 × 2250 |
| Widescreen | [Paper](us2024-wide-paper.png) | [Lamplight](us2024-wide-lamplight.png) | 2400 × 1350 |

[us2024.json](us2024.json) is the saved document. [manifest.json](manifest.json) records its compact-JSON SHA-256, all six PNG hashes and each pair's measured projection and visibility/bounds for all 51 geographic units. All 26 reported national categories appear in every PNG. Widescreen places the smaller totals beside the map; square and portrait place them below it. No dataset changes between layouts/themes.

Reproduce the exports:

```sh
npx playwright install chromium
node scripts/make-us2024-posts.js --out build/us2024
```

An installed compatible Chromium can be selected with `CHROMIUM_EXECUTABLE_PATH`. Fonts, seal, source JSON and boundary geometry are bundled; rendering does not require a live source request.

## Meaning and evidence

| Quantity | Result | Meaning |
| --- | --- | --- |
| Electoral votes | Trump 312; Harris 226 | Trump won the presidency by exceeding 270 of 538 electoral votes. These are not parliamentary seats. |
| National popular votes | Trump 77,302,580 (49.80%); Harris 75,017,613 (48.32%) | Percentages use the full FEC denominator of 155,238,302 reported presidential votes, including every other category. |
| Statewide popular-vote leaders | Trump 31 states; Harris 19 states + D.C. | Geographic-unit counts only. Map colours show the statewide leader, not every elector's vote. The label does not describe sitting governments. |
| Maine | Harris 3 EV; Trump 1 EV (ME-2) | Two statewide electors plus one per congressional district. The state is coloured by its statewide leader; its split is labelled separately. |
| Nebraska | Trump 4 EV; Harris 1 EV (NE-2) | Same allocation method. Congressional district boundaries/results are not inferred from state totals. |
| Remaining categories | 24 additional candidate/selection categories | All are retained by name and vote count. “None of these candidates” and scattered write-ins are selections, not parties or named candidates. |

Sources:

- [FEC official 2024 presidential general election results](https://www.fec.gov/documents/5644/2024presgeresults.pdf), pages 1–6 for results and 7–9 for candidate/ballot-label definitions. An unmodified [source snapshot](fec-2024-results.pdf) is included; its SHA-256 is recorded in the data pack. This is the FEC compilation of state-certified results, not an independent FEC election certification.
- [National Archives 2024 Electoral College results](https://www.archives.gov/electoral-college/2024), including certified electoral-vote allocation and Maine/Nebraska's method.
- Vendored Natural Earth 1:10m admin-1 state/DC geometry, layer `ne:USA:ADM1`, public domain. The registry states no geographic vintage. State/DC units match the reporting grain of this source; no county or congressional-district map is claimed.

Candidate ballot labels vary by state and can include fusion labels, independent designations and petition categories. The saved source pack and on-screen national panel retain every FEC code verbatim; FEC page 9 explains each one. Minor candidates are not reassigned to an invented “Other” party. National totals include the source's reported named-candidate write-ins and scattered write-in category; blank state cells remain `null` (not reported), distinct from a reported zero.

Alaska and Hawaii are repositioned in the composite Albers USA projection. Alaska uses its conventional reduced inset scale, and the projection clips distant Aleutian islands. D.C. has a visible dot/leader callout. These are geographic presentation limits, not omitted state result rows. The shapes are generalized reference geography; no boundary-vintage claim or street-level interpretation is made.

Turnout rates are not asserted because this source supplies no compatible turnout denominator. Electoral votes are stored separately from the ordinary `seats` field; seats and turnout remain `null` in these state assignments.

## Rebuild and validate the data

The optional extractor requires Python and `pdfplumber`:

```sh
python scripts/import-us2024.py --source docs/us2024/fec-2024-results.pdf --out public/data/us-presidential-2024.json
```

It reads the source table by column position, preserves blank popular-vote cells, and checks every state row, candidate column, national denominator and electoral-vote sum. The generated pack is byte-identical to the checked-in JSON. Rendering itself uses the project's existing Node/browser dependencies.

See [validation.md](validation.md) for workflow checks and broader-suite limitations. This package is for review; no merge or social posting is performed automatically.
