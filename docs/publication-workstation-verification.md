# Publication Workstation audit and repair

Reviewed 30 September 2026 in the local Election Map checkout. The branch was
`main` at `9d738c0`; Publication Workstation v1 files were already present as
local, uncommitted changes. They were preserved and repaired in place. END Engine
and END Harness were outside this work. Nothing was committed, pushed, deployed
or posted.

## Baseline and findings

The original trustworthiness and undo work was present in `9d738c0`. The v1
workstation modules, export dialog, metadata, badges, three X profiles and ZIP
pack existed locally. The baseline `npm test` log reported **167 passing cases**;
the npm wrapper did not exit after its last test, so its reporter did not print
a completion summary. This was a runner teardown limitation, not a test failure.

Confirmed defects and risks:

- The review blocked an active count more than 60 days after the vote even when
  it could be an ongoing recount. Age now produces a warning; an old settled
  graphic explicitly calling itself current still blocks. Recount/disputed
  graphics require an update time and source evidence.
- The old update field labelled itself UTC while the browser rendered a
  `datetime-local` control. The parser appended `Z`, so **the stored instant did
  not silently shift**; the ambiguity was about what clock the editor entered.
  An explicit numeric UTC offset now accompanies the wall time. Save/open in a
  different browser timezone preserves both the instant and entered offset.
- A saved `ready: true` flag alone could grant a clean-looking map approval.
  Approval now carries a receipt for the reviewed document. Edits to data,
  provenance, title, appearance or publication metadata make it draft again.
- A party named “Victory Party” could trip the finality word list. Editorial
  text is checked separately from structured party names; clear premature
  claims still block, and negated phrases such as “not final” remain allowed.
- Captions could only be changed after download. The dialog now edits and saves
  the exact caption. Changed metadata keeps the edit visible and requires the
  editor to review it or explicitly regenerate it. Missing required status,
  source links or caveats block approval.
- Series frames were always drafts. A run review receipt now binds the plan,
  sources, dates, boundaries, caveats, app/archive inputs and every inspected
  draft PNG. Reviewed output is generated separately; changed inputs refuse it.

Existing safeguards confirmed: published packs are gated by the shared review,
and a failed profile rendered during pack building returned no ZIP. A further
race was found: a map edit between asynchronous PNG encodes could have mixed
review and output. The pack now rechecks the same reviewed document throughout.
Direct PNG/copy calls still permit drafts, visibly badged as such. Saved documents
and undo cannot restore approval to altered content. Series stay draft unless an
exact run receipt is provided.

## Verification

Focused regressions cover the old recount, recent partial, misleading old
current headline, time offsets and date-boundary crossing, DST ambiguity with
explicit offsets, cross-timezone save/open, party-name wording, edited caption
save/open/regeneration, Unicode and links, exact ZIP caption, a forged ready flag,
edits during pack encoding, and series input/frame changes. Existing tests cover
export parity, boundary and provenance labels, all supported profiles, older
documents and undo.

The final direct Playwright run reported **180 passed, 0 failed** in about 2.8
minutes (`build/publication-final-suite.log`). Export parity passed within that
run. `node scripts/verify-boundaries.js` passed all **254** layers;
`node scripts/build-parlgov.js --check` resolved **37** countries from **9,016**
election rows and **1,621** cabinet records. `git diff --check` found no whitespace
errors. Desktop and 390px mobile dialogs,
landscape, square and portrait PNGs, plus 390px display-scale QA images were
inspected. The ZIP in `build/publication-demonstration-audit/08-publication-pack.zip`
contains an editor-modified caption, checked byte for byte against the draft.
The two-frame series receipt reproduced both reviewed PNG hashes; changing its
requested range from 1945–46 to 1945–47 was refused before reviewed output.

Demonstration paths under `build/publication-demonstration-audit/`:

| File | Evidence |
|---|---|
| `02-partial-landscape.png` | synthetic official partial, count and UTC update time |
| `03-recount-old-landscape.png` | synthetic ongoing recount over 60 days old |
| `01-historical-1945-landscape.png` | historical gaps, present-day outlines and Norway exile note |
| `04-mixed-source-landscape.png` | both synthetic sources and a final badge |
| `05-profile-{landscape,square,portrait}.png` | three supported sizes |
| `06-mobile-review.png`, `06-mobile-caption-review.png`, `07-desktop-review.png` | blocking review, narrow caption editor and edited desktop caption |
| `phone-preview-*.png` | exported graphics as displayed 390px wide |
| `08-publication-pack/` | unpacked PNGs, exact caption, metadata and methodology |

The two-frame historical example is in `build/publication-series-draft/` and
`build/publication-series-draft-reviewed/`. The draft images are badged DRAFT;
reviewed images are cleanly labelled historical. Both manifests retain coverage
gaps and the government-in-exile caveat. `approval.json` records the inspected
draft hashes. These are demonstration approvals of repository historical data,
not independent editorial certification of the underlying facts.

## Limits and first post

The caption counter is an **estimate**, not a claim to match every X Unicode or
emoji rule. It uses the [standard 280-character limit](https://help.x.com/en/using-x/how-to-post)
and [X's published 23-character link length and weighted ranges](https://github.com/twitter/twitter-text/blob/master/config/v3.json).
Confirm a near-limit caption in X's composer. Phone feed previews show that long
source footers need opening the image or reading the caption; they remain complete
in the file. The review receipt detects ordinary local edits, not malicious
tampering or a person's identity. Historical coverage and current election facts
still require human verification.

For the first manually reviewed X post: import the exact source and confirm
country, date, office and round; select the correct result status and counted
percentage; enter the source's update wall time with its stated UTC offset; read
the blockers, source links, boundary vintage and image at all selected sizes;
edit the caption while keeping its required status, source and caveats; mark the
map reviewed; download the pack; inspect its PNG and caption once more at phone
size and against the source before posting manually.
