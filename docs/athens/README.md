# Athens: the beginnings of democracy

This is a **historical explainer**, the scope selected for the first post. It is not a modern Greek national election, an election-winner map, or a claim that every institution described took its final form in 508–507 BCE. The title avoids presenting a worldwide historical priority claim as a verified result.

## Posting workflow

1. Run `npm ci` and `npm run dev`; open the displayed local address.
2. Under **Map style**, select **Start Athens democracy explainer**. This loads a complete source-backed document using the existing History Through Maps identity. Undo restores the whole preceding document, including its layer and work.
3. Review the institutional overview, source links and geographic limitation in the right-hand panel. Headline fields and the usual pan/zoom controls still work. This locator does not accept painted results or numeric election metrics.
4. Open **Export** and choose **Square**, **Portrait** or **Widescreen**. Select **Download Paper + Lamplight** to render the pair from one synchronous snapshot. Both PNGs use the normal `composite()` / `drawMap()` path, at the export dialog's existing 1.5× output resolution. The selected working theme is restored even if rendering fails.
5. Use **Save file** and **Open file** to keep working. The explainer, point location, citations, caveats, framing and identity are stored in schema 7. Older documents remain supported and default to their original presentation.

For an actual election post, import an actual result dataset or open a results document. A successful results import exits the explainer and its undo restores the historical document. Selecting a different boundary layer also exits it; assignments and layer undo retain their existing behaviour. The existing government-series CLI continues to generate government maps, not ancient election results.

Sources and limitations in a historical export are mandatory, including when the election legend toggle is off. If the facts/footer leave insufficient map space, or the city point/label is outside the frame, export stops with an explanation. Historical locator exports support Flat and Mercator; Globe is refused because the city can be on its hidden side. Election/flags globe exports are unchanged.

## Samples

| Layout | Paper | Lamplight | Download dimensions |
| --- | --- | --- | --- |
| Square | [Paper](athens-square-paper.png) | [Lamplight](athens-square-lamplight.png) | 1800 × 1800 |
| Portrait | [Paper](athens-portrait-paper.png) | [Lamplight](athens-portrait-lamplight.png) | 1800 × 2250 |
| Widescreen | [Paper](athens-wide-paper.png) | [Lamplight](athens-wide-lamplight.png) | 2400 × 1350 |

[athens.json](athens.json) is the save/open document. [manifest.json](manifest.json) records the shared document hash, source references, PNG hashes and the measured projection/point for every export. Each light/dark pair has the same projection, point coordinates and data; only presentation changes.

Reproduce everything with:

```sh
npx playwright install chromium
node scripts/make-athens-posts.js --out build/athens
```

An already installed browser can be selected with `CHROMIUM_EXECUTABLE_PATH`. Fonts, seals and the reference geometry are bundled and require no live external request to render these posts.

## Evidence and limits

Sources were reviewed on 9 October 2026. The prose is an original summary, not copied source text.

| Claim | Evidence | Interpretation and limit |
| --- | --- | --- |
| Reform period c. 508–507 BCE | [Yale Open Courses, Week 6 chronology, PDF p. 8](https://oyc.yale.edu/sites/default/files/06theriseofathens_1.pdf) | Conventional reform dating, not an exact polling day. The chronology also describes development in subsequent years. |
| Ten tribes; Council of 500; fifty members per tribe | [Aristotle, *Athenian Constitution*, chapters 21–22, Kenyon translation](https://classics.mit.edu/Aristotle/athenian_const.1.1.html) | Institutional organization, not modern parliamentary seats won by parties. No tribe/deme polygons or tribe-level election outcomes are inferred from these counts. |
| Political participation excluded women, resident foreigners and enslaved people | [British Museum, *Historical city travel guide: Athens, 5th century BC*, Pnyx section](https://www.britishmuseum.org/blog/historical-city-travel-guide-athens-5th-century-bc) | This source describes later fifth-century democratic practice; the artwork's citation identifies that period. It is not evidence that citizenship rules and office selection remained unchanged from 508 BCE. |
| Approximate Athens location at 23.7333° E, 37.9833° N | [Getty TGN, record 7001393](https://vocab.getty.edu/page/tgn/7001393) | City locator, not an ancient city extent, polling place or Assembly location. |
| Land reference | Vendored `public/data/world-50m.topo.json`, [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) | Public domain, modern reference outline, geographic vintage not stated. Only the Greece feature is drawn in a close view around Athens and Attica. This does not depict the modern country's full extent or any ancient territory. The generalized 1:50m outline is unsuitable for street/site-level interpretation. |

No electoral result source or ancient boundary reconstruction is supplied. Winners, national vote totals, turnout, party-seat totals, and local results are **not applicable to this post**, rather than zero. Modern administrative boundaries are not promoted to ancient electoral boundaries. A later actual election workflow still needs an identified country, election/date, source totals and any source-backed electoral geography.

## Validation

The draft's original 73 targeted checks passed before development. The final focused regression run passed **92/92 checks**. The Athens tests cover save/open, previous-document undo, empty election assignments, all three paired layouts, exact individual/paired PNG equality, downloaded-file equality, preview parity, preservation of every source/caveat, clipping/overflow refusal, malformed/mixed documents, import/undo transitions, and text contrast in both themes. [Validation details](validation.md) include the broader suite's eight failures and their baseline/isolated reruns; the full suite is not claimed to be green.
