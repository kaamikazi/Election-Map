# Athens workflow validation

Validated 9–10 October 2026 against draft PR #1, starting at `e77815676327e6c64a7b9d228ac6ec0c334daa92`. The PR was open, draft and unmerged when inspected. The existing History Through Maps identity was retained.

## Scope

The selected first post is an Athens historical explainer around Cleisthenes' reform period, c. 508–507 BCE. It is not a modern national election. Institutional sizes are prose facts, not parliamentary seats won. No winners, vote totals, turnout or local results are invented. The modern Natural Earth reference outline is explicitly identified as a locator, not ancient territory or electoral geography. A national election post still requires a country, election/date and source-backed results/geography.

## Passing checks

The original **73 targeted checks** passed before modifications. The final focused run on 10 October passed **92/92**, with zero skips and zero retries/flaky outcomes, in approximately 107 seconds:

```sh
npm ci
# Install Playwright Chromium, or set CHROMIUM_EXECUTABLE_PATH to an installed compatible browser.
npx playwright test athens identity export-parity series flags trustworthiness responsive constituency vintage undo --reporter=list,json
```

Node 24.19.0, npm 11.9.0 and an installed Chromium headless shell were used. `CHROMIUM_EXECUTABLE_PATH` selects that browser through the project's existing Playwright configuration.

Coverage includes:

- Saved-document restoration, legacy schema-6 compatibility, full-document undo and import/undo transitions.
- Paper and Lamplight in square, portrait and widescreen, with identical measured projection and point placement.
- Exact paired/individual PNG equality, actual downloaded bytes and preview/composite parity.
- Mandatory facts, all four source citations, period, key and geographic/data caveats.
- Rejection of mixed historical/results documents, absent reference countries, invalid points, clipped labels, insufficient space and a hidden-side Globe locator.
- Text contrast of at least 4.5:1 in both themes, without changing party colours or existing hatch meanings.
- Existing flags, source trustworthiness, boundary selection/vintage warnings, responsive controls, undo and government-series behavior.

The export legend control's hidden state initially failed because its flex CSS overrode the HTML hidden attribute. `.tog[hidden]` now honors it; the final 92-check run includes that assertion. No assertions were disabled.

`node --check src/explainer.js`, `node --check scripts/make-athens-posts.js` and `git diff --check` passed. Six PNGs were generated through the existing browser composite path. Both themes were visually inspected across the three layouts; citations and caveats remain visible. `manifest.json` records PNG SHA-256 values, the compact JSON document hash and measured framing for comparison. The reference geometry is generalized 1:50m data and is unsuitable for street/site-level interpretation.

## Broader-suite limitations

An earlier full 160-check run recorded **152 passes and eight failures**. This is not a full-suite pass. The eight cases were rerun on an unchanged checkout of `e778156`:

| Cases | Full-run failure | Unchanged draft result |
| --- | --- | --- |
| Integrity: un-rewound layer, rewound layer, miscounted layer (three cases) | Missing ignored raw fixture `data/raw/geoboundaries/BGD-ADM1.geojson` (`ENOENT`) | All three fail identically |
| Integrity: degradation ratio, unit-growth ratio (two cases) | Missing ignored raw fixture `data/raw/constituencies/GBR-CONSTITUENCY.geojson` (`ENOENT`) | Both fail identically |
| Layers: Bangladesh on geoBoundaries, eight of ten tables can land | Browser evaluation: “Resulting promise was garbage collected” | Same failure reproduced |
| Integrity: no stranded rows means no partial marks and no footnote | Browser evaluation: “Resulting promise was garbage collected” | Passes in isolation |
| Series: every frame carries its own coverage count | 30-second timeout | Passes in isolation |

The unchanged-draft rerun therefore had **two passes and six failures**. On the final modified code, the no-stranded integrity case also passed separately, and the series coverage case passed within the 92-check regression run. Those two initial failures are intermittent; their exact cause has not been established. The absent raw fixtures and Bangladesh browser-promise failure remain outside this change's scope. No fixture assertions were skipped, and no synthetic geometry or results were substituted.

The public vendored reference geometry used by the Athens samples is present and exercised by the passing workflow tests. Sources and interpretation limits are documented in [README.md](README.md) and included in every sample PNG.
