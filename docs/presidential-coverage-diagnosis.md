# Presidential acquisition diagnosis and repairs

The before report's two result records were an implementation/configuration
ceiling, not evidence that the other countries' results were unavailable.

| Finding | Evidence in code/acquisition | Repair |
| --- | --- | --- |
| Only two presidential adapters were enabled | Catalog registry registered France 2022 and US 2024; each returns one event. IPU covers parliamentary chambers, not presidents. | Added registered nationwide Wikipedia/Wikidata discovery and reusable event parsing. |
| Global graph query timed out | The prior country-unbounded class path queries failed at 20–25 seconds. No country segmentation was attempted. | Segmented presidential queries by registered ISO country. Latest held/completed candidates only; no historical backfill. |
| Infobox date selector rejected valid articles | Parser expected a labelled Election date row; many pages put the date in an unlabelled navigation row. | Parse only the bounded infobox date area, require exact days and explicit held-event evidence. |
| Burst requests caused false acquisition gaps | First expanded pass received HTTP 429 for mapping/entity/label stages. | Serialized article/entity requests with a polite gap, bounded retries and backoff; successful resources replay from immutable cache. |
| Scalar IPU attributes were double-unboxed | `valueAt` applied `scalar` to an already extracted scalar value. Website descriptors and other non-array fields became null. | Unbox scalar descriptors once; preserve effective-date array selection. |
| Official discovery excluded useful authorities | Old reference pass ran only for legislature and accepted government suffixes rather than country/category authority role; commission `.org` domains were excluded. | Versioned authority profiles include electoral/constitutional/parliamentary roles and explicit domains; every core legislative/presidential category gets an audit. |
| No confirmation path existed | No adapter set a qualifying primary-evidence assertion; fetching a reference page did not prove latest status. | Defined evidence standard first, added scoped primary-index rules, captured locators/check times and explicit freshness states. |
| Primary index parser missed real UK labels | Index uses `2024 – 4 July`, not `4 July 2024`. | Parse that source-specific format from its election links, exclude notional entries and require a matching latest date. |
| Combined general-election records falsely conflicted | One source group/revision can cover parliament and president. | Preserve parent source ID, identify category/office contests separately; no year-only merges. |
| Same-date source tie could hide metrics | Equal-date alternatives used ID order when neither was labelled official. | Prefer explicit official evidence, then intergovernmental/research data before contributed claims; retain alternatives and conflicts. |
| N/A/monarchy assertions were treated as verified absence | The old institutional classifier lacked a primary category-specific non-applicability receipt. | Keep provisional assertions, downgrade unsupported classifications to unknown and record required authority work. |

## Restrictions retained

No fixture limits or representative-country filters restrict production scope.
Tests use synthetic transports in isolated folders; they are not evidence.
Every core country/category is processed. The fixed cutoff remains
`2026-10-01T05:00:35.000Z`; later polling dates are excluded.

Candidate votes/shares come from recognised national result tables or source
infobox columns. A source's explicit Elected President/successful-candidate claim
is retained as an attributed contributed claim. Before/after office holders,
appointments, highest votes and government formation never create an elected
candidate. Unsupported rows/round ordinals, incomplete scope and conflicting
claims remain unresolved.

Contributed claims improve usable draft coverage but do not become official
declarations, certification or independent editorial verification. Latest
confirmation follows [the evidence standard](latest-election-evidence-standard.md).
A second website copying the same provider contributes no independent proof.

Historical expansion remains paused. Existing generations and historical
records are preserved; source-specific counts and conservative identity counts
are reported separately. Unknown/different identity dimensions are not forced
into one event to inflate a deduplicated coverage total.

The original acquisition cache, provenance, geometry checks, exact-plan
verified replacement protection, undo and publication review remain in use.
All changes and captured evidence stay local and uncommitted.
