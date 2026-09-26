# Publishing safeguards: verification record

Work used the attached task brief and the existing local checkout of
`https://github.com/kaamikazi/Election-Map`, on `main` at `a39f86c`.
The working tree was clean before edits. No posts, deployment, merge, push or
framework change was performed.

## Findings and reproductions

All three suspected application defects were confirmed. The baseline reproduction
script routes the original commit's modules into Chromium without changing the
working files. Run the dev server, then:

```sh
node scripts/demonstrate-trust.js --baseline
```

The resulting `build/trust-demonstration/baseline-reproduction.json` records:

- Importing a new winner and vote share retained seats **52**, turnout **68**,
  margin **9**, and an omitted Germany assignment, under **New election** as
  the map-wide source.
- Opening a saved Bangladesh division map in a fresh session set the document
  to `gb:BGD:ADM1` while geometry remained **world**, with **241** features and
  no boundary metadata.
- On 1945-01-01 the old archive returned **Stauning V** for Denmark and
  **De Geer II** for the Netherlands, while returning a gap for Norway.

The old documentation's stronger assertion that every cabinet interval longer
than six years was a gap was **rejected**, following primary-source verification
of Norway and Canada. Malta's exact dates remain **unverified** and its disputed
interval is explicitly uncertain. See [the historical evidence](archive-gaps.md).

## Changes

- Import review now separates replacement, same-dataset updates and intentional
  combinations. Unknown identities default to replacement; retaining old values
  requires an explicit same-election decision. Conflicting known identities
  cannot be updated together. A year alone is not an identity.
- Numeric blanks, zeroes and `[clear]` have different meanings. Missing winners
  do not acquire the selected party. Provenance follows individual values;
  retained records, manual changes and distinct pasted imports are disclosed.
  Mixed maps have no misleading single top-level source URL or citation.
- Source text wraps in exports. An export with insufficient room for complete
  attribution stops with an actionable message. Existing unsourced flat export
  parity remains unchanged. Series reserve footer space as well as legend space.
- File open and cross-layer undo use a shared staged restoration path: validate
  the document, prepare geometry and export assets, validate region keys, then
  commit. Failed opens preserve state, geometry and undo history. Inputs, selected
  values and layer controls refresh with the restored document.
- Historical duration filtering was replaced by sourced coverage decisions.
  Gaps and their reasons/evidence reach manifests; image footers identify missing
  coverage and Norway's wartime interpretation. No missing governments were invented.

Schema 6 adds optional record metadata. Earlier numeric assignments and old
layer IDs still migrate. Legacy map-wide citations cannot establish which value
they supplied, so retained legacy values are labelled unverified.

## Checks and outcomes

- Baseline: all **128** existing tests reported passing; the old suite did not
  protect against these defects and explicitly asserted the Denmark limitation.
- Final full suite: **136 passed, 0 failed**, in approximately **1.9 minutes**.
  Log: `build/trust-final-tests.log`.
- Focused regressions cover same-election missing metrics, zero and clearing,
  changed office/round within the same year, unknown/year-only identity, intentional
  mixed imports, field provenance after save/open, manual edits, omitted winners,
  fresh-session cross-layer open with pixel-identical exports, failed restoration,
  undo after import/open/layer switch, and every corrected historical endpoint.
- `node scripts/verify-boundaries.js`: **254 layers pass**.
- `node scripts/build-parlgov.js --check`: **37 countries resolve**, 9,016 election
  result rows, 1,621 cabinet records. The public governing archive was rebuilt.
- `git diff --check`: no whitespace errors. Existing CRLF/LF normalization notices
  are informational.
- Chromium was available. Desktop **1440×900** and narrow **390×844** layouts,
  the identity confirmation review, and all three exports were visually inspected.
- External research initially hit a sandbox network restriction; the permitted
  download succeeded. One stalled download was retried and its hash verified.
  No browser or unresolved download blocker remains.

Existing assertions were retained except where the intended behavior changed:
merge now requires an explicit selection, and documented gaps replace the old
cap assertions. The legend-jitter test holds the new caveat area constant to
continue isolating legend height. No image snapshots were replaced.

## Demonstrations

With `npm run dev` running, regenerate using:

```sh
node scripts/demonstrate-trust.js
```

Artifacts are local in `build/trust-demonstration/`:

| Artifact | What it demonstrates |
|---|---|
| `historical-1945.png` and `.json` | Sourced ParlGov historical example, current outlines, named gaps and Norway caveat |
| `subnational-2024.png` and `.json` | 650 UK constituencies, exact fixture revision citation, boundary source/vintage/licence |
| `mixed-source.png` and `.json` | Explicitly synthetic sources; new France vote clears old metrics while Germany keeps its own source |
| `desktop.png`, `mobile.png` | Desktop and narrow app views |
| `identity-review.png`, `mobile-review.png` | Unknown identity blocks updates until the reviewer confirms the same dataset |
| `historical-series-manifest.json` | Per-frame gap reasons, evidence and limitations |

The UK example uses the repository's historical Wikipedia fixture, with column 5
explicitly selected as the 2024 affiliation. The two Scottish National Party
spellings are deliberately unified in the demonstration script; Labour and
Labour Co-op remain separate labelled categories. Colours are the app's default
palette, not official party branding. All demonstrations identify themselves as
historical fixtures or synthetic data, never current/live results.

## Publication judgment

**Suitable for manually reviewed X graphics, with editorial checks.** The tool
now prevents the reproduced silent mixtures and geometry mismatches and makes
known gaps visible. It is not a certification of the underlying history or tables.

Before publishing, a person still needs to verify election country/date/office/
round; the selected table and winner column; totals and party-name grouping;
source freshness and revision; boundary compatibility; and the finished image's
caption, colours and caveats. Pre-1945 intervals outside this audit remain
experimental; other next-record intervals are not independently certified.
Malta's disputed interval stays uncovered. Historical world outlines are modern,
and a recognised government in exile does not mean territorial control.
