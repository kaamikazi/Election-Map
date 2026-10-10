# Latest-election evidence standard

Version 2 (snapshot cutoff `2026-10-05T17:01:31.000Z`, 23:01:31 Asia/Dhaka on
5 October 2026). Version 1 applied to the 1 October 2026 snapshot
(`2026-10-01T05:00:35.000Z`); that generation is immutable and retained, and
`data/catalog-execution.json` lists it under `previousSnapshots`. Later
elections and later rounds than the cutoff are excluded. Historical expansion
stays paused until every core category ends in sourced results, sourced
non-applicability or a concrete unresolved entry.

### Changes from v1

- **Authority establishment and independent corroboration are separate.** In v1
  the `independentlyConfirmed` flag was set whenever one authority established
  the latest election, so the UK entry counted as "independently confirmed".
  In v2, `latest-established` needs one qualifying authority assertion.
  `latest-corroborated` additionally needs a second assertion from a different
  evidence lineage, and a mirror of the first does not count. The flag now
  means corroboration only.
- **Assertions are matched by polling date.** An authority states the latest
  election by its date, so it supports whichever selected record carries that
  date.
- **Official category indexes and statements count:**
  - a complete official index by year, where the newest listed year is the
    selected election and no other election is listed in that year;
  - a dated official index;
  - an explicit "The most recent … election took place on …" sentence.

## What counts

An **evidenced latest-election claim** requires captured, inspectable evidence
from the registered authority responsible for that jurisdiction/category, or
an authoritative national parliamentary/constitutional publication:

1. It identifies the country, office/chamber, election event, polling dates and
   direct/indirect nature when known. A year, office holder, appointment or
   government formation does not identify an electoral event.
2. A current category index, explicit latest/most-recent statement or complete
   bounded series supports selection of that event as latest held by the cutoff.
   A result declaration alone establishes a result, not absence of a newer event.
3. The captured text/table locator and check time support the actual assertion.
   Merely fetching a homepage, recognising a government domain or counting
   matching date tokens is insufficient.
4. Evidence provenance records authority, lineage, raw SHA-256 and receipt.
   A mirror/copy of IPU, IFES, Wikipedia or another archive is not independent
   corroboration of that same provider. Primary authority evidence can establish
   the latest claim without manufacturing a second independent website.
5. Material conflicting dates, reruns, cancellation, disputed declarations and
   pending later rounds remain visible. Latest held and latest completed result
   are selected separately; older completed results do not hide newer events.

Discovery providers (including revision-pinned Wikipedia/Wikidata) supply leads
and attributed claims. Their newest row or consensus does not automatically
satisfy this standard. A provider latest assertion remains separate from an
authority-supported latest claim and independent editorial verification.

Source-reported outcome, machine validation, metric eligibility, certification
and independent editorial verification are separate facts. No machine process
marks election facts independently verified. Unknown votes, shares, rounds and
source update instants remain unknown. Retrieval time is a check time, not a
result update instant or proof of provider state at the exact earlier cutoff.

## Non-applicability and freshness states

Source-supported constitutional/institutional evidence must identify the
category as non-electoral/non-applicable. A discovery table's N/A, missing
candidate, absent API record, monarchy inference alone, or an appointment is
not sufficient to verify non-applicability. Unconfirmed classifications remain
unknown and retain their provisional source assertions.

The application and exports distinguish:

- latest election established with qualifying evidence and additionally
  corroborated by an independent lineage (`latest-corroborated`);
- latest election established with qualifying evidence (`latest-established`);
- latest available record, freshness unconfirmed;
- newer held election with results pending/unresolved;
- unknown;
- sourced non-applicability.

Map metrics have independent eligibility. A sourced result may be displayed as
a latest-available draft while freshness remains unconfirmed; it cannot acquire
an established-latest label from its map capability. The ledger reports both.

## Country pass and acquisition

Every core jurisdiction/category receives an attempted-source audit, even when
an adapter fails, discovery has no lead, an institution is suspended or an
authority resource is access-blocked. A provider outage does not stop other
countries. No empty entry is counted as completed factual coverage.

Reusable structured adapters parse registered indexes and their real links.
Country-specific fallbacks identify exact primary URLs and extraction rules;
the evidence supporting a rule is retained. Unsupported or ambiguous formats
remain review items. Discovery never invents article titles, dates or outcomes.

Counts use source-specific identities separately from conservative cross-source
event groups. Unknown rounds/directions and materially different offices or
event scopes are not silently merged. Source-specific and grouped historical
counts are reported separately; no new history backfill is performed here.

## Status signals and conflicts (v2)

- **Cancelled** requires a sentence saying *this* election was annulled or
  cancelled, with no declared outcome. Mentions of an earlier election's
  annulment, or a cancellation in some constituencies, do not count. Each
  status signal keeps its matching excerpt.
- **Annulled** marks an election that was held but whose results were annulled
  before or after declaration (e.g. "Elected President: Election results
  annulled"). It remains the latest held event, with no elected candidate.
- **Linked-date conflict:** a Wikidata item and the Wikipedia revision it links
  to disagree on the first polling day. Both are kept and the date metric is
  withheld. When only the last day differs, the conflict is recorded but does
  not affect the metric.
- **Cross-source date proximity:** a contributed record dated within 90 days
  after the newest provider or official record is treated as a conflicting
  date for the same contest. It does not displace the record that carries the
  results, and both stay visible.

## Result status model (v3)

v3 replaces the v2 rule that marked contributed results "provisional" for 14
days after polling and withheld their metrics. Age no longer sets status. A
recent poll only sets `freshnessCheck.required`, a prompt to recheck the
count, declaration and certification. That prompt is visible in the ledger
and in tooltips.

Every event has one primary state, derived only from evidence
(`scripts/catalog/status.js`):

| State | Evidence required |
| --- | --- |
| `scheduled` | Polling date after the cutoff, or the provider marks the election upcoming |
| `held-results-unavailable` | Held, with no results reported by any source |
| `partial` | A scoped statement of an incomplete count: "Reporting 96.32%", "N% of polling stations counted", "counting is ongoing", "preliminary results show …", or the provider's partial flag |
| `declared` | A declaration (see below) |
| `certified` | A declaration plus a certification, validation or proclamation statement |
| `disputed` | A scoped dispute or recount statement about this contest; a dispute is never cleared by the passage of time |
| `annulled` | Polling took place, but the declared results were annulled |
| `unknown` | None of the above can be established |

The ledger keeps three facts separately, because they can coexist (for
example, a certified result can still be disputed in court):

- `declaration` — `{state, source: official | provider | research-archive | contributed, basis}`
- `certification` — `{state, by, date, basis}`
- `dispute` — `{state: disputed | recounting | none-reported, evidence}`

**Declarations.** Each of these counts:

- an authority's elected marker or statement;
- a source-reported elected candidate, labelled with the source tier;
- a provider's record that the new legislature convened, or a published seat
  allocation;
- a contributed seat allocation that reconciles to every seat at stake.

"TBD" or "pending" in an elected row is an explicit *non*-declaration.

**Scope.** Status evidence must concern this event. A sentence is ignored when
it names another year, or another contest: a vice-president, a senate, an
upper house, a governor, a municipal, regional or local contest, a referendum,
a primary or a by-election.

**Metrics.**

- Rankings and outcomes use only `declared` or `certified` events.
- A `partial` event exposes `partialCount`: the leader in the partial count,
  labelled *not a declared winner, largest party or final share*.
- Turnout is withheld for partial, unavailable, scheduled or annulled events.

**Derived outcomes.** These are kept apart from source-reported outcomes. A
derived elected candidate requires:

- the rule as stated by the source (e.g. "Total Electoral Votes Needed to
  Win = 270");
- inputs that reconcile completely.

The metric formula says `derived:`. A national popular-vote total never
determines a president.

**Outcome attribution.** A selected official record may carry totals without
a winner statement. If a same-contest alternative reports the winner, the
outcome comes from that alternative. The snapshot row records `outcomeFrom`,
and both records are cited.

**Evidence after the cutoff.** Evidence retrieved after the cutoff must
describe facts dated on or before it. Each official record carries an
`asOfCutoff` note. Contributed articles are pinned to the revision current at
the cutoff, so later declarations do not change the 5 October snapshot.

## Result status model (v4)

v4 replaces the single v3 `disputed` state. Under v3, any scoped dispute or
recount sentence withheld the outcome. That suppressed seven presidential
outcomes (DZA, ECU, GTM, NAM, SLE, VEN, ZMB) on the strength of a demand,
allegation or rejection by a losing party. In v4 such claims are recorded,
but they do not change the outcome on their own.

**States.** `scheduled`, `held-results-unavailable`, `partial`, `reported`,
`declared`, `certified`, `recount-or-suspension`, `annulled` and `unknown`.

- Settled states: `reported`, `declared`, `certified`.
- Unsettled states: `held-results-unavailable`, `partial`,
  `recount-or-suspension`, `annulled`.

`reported` means figures or a winner reported by a source, without a captured
declaration.

**Separate facts.** These may coexist on one event (`scripts/catalog/status.js`):

| Fact | Content |
| --- | --- |
| `results` | `complete`, `reported-unreconciled`, `partial` or `none`, with the reporting tier |
| `outcome` | `reported`, `derived`, `pending` or `none`, with the winner and the reporting tier |
| `declaration` | `declared` (by whom, on what basis) or `not-captured` |
| `certification` | `certified` (by, date, basis) or `not-reported` |
| `recount` | `requested`, `ordered`, `active`, `completed` or `none-reported`, with the evidence |
| `challenges[]` | type (`rejection`, `court-filing`, `allegation`, `challenge`, `protest`), actor, date, excerpt and locator |
| `suspension[]` | an authority's suspension of announcement, publication or certification |
| `annulment` | `whole`, `partial` (with the affected units) or `none` |
| `institution` | the provider's first-session date; formation only |
| `timing` | effective date, published revision, capture times and a retrospective flag |
| `laterDevelopments[]` | facts that became effective after the cutoff and were not applied |

**What changes an outcome.** Only these withhold an outcome:

| Condition | Resulting state |
| --- | --- |
| Whole annulment | `annulled` |
| A recount *ordered* or *active* by an authority (court, commission, council, tribunal or electoral body named in the same sentence) | `recount-or-suspension` |
| An authority's suspension of results | `recount-or-suspension` |
| A decisive round dated after the cutoff | `partial` |
| An incomplete count with no reported winner | `partial` |
| A winner listed as TBD or pending | `partial` |

In every case, `withheldBecause` names the reason.

The following do not change the outcome:

- a recount *requested* or *demanded* by a party or candidate;
- an allegation, protest, rejection or court filing.

Each of these adds a caveat naming the actor, the claim type and the date.
Recognising the actor:

- in a passive sentence ("results were rejected by X"), the agent;
- otherwise, the subject of the sentence;
- if the subject is a pronoun, the actor is left unnamed rather than guessed.

**Partial annulment.** Affects only the named units, e.g. "annulled in 3
constituencies". The national outcome stands, with a caveat listing the units.

**Partial count with a winner.** A winner reported beside an incomplete
displayed count (e.g. "Reporting 99.29%") stands as `reported`. The figures
stay labelled as coming from an incomplete count. A partial leader is never
called a winner. `partialCount` exposes the leader separately.

**Convening.** A provider's first-session date shows that the new body was
formed. It does not supply seat figures, a declaration, a certification or a
winner. When no figures were captured, the state is
`held-results-unavailable`, and the tooltip says "body convened; results not
captured". Any figures that were reported are kept as reported. Appointed,
staggered and mixed chambers carry their own institution states:
`appointed-institution`, `suspended-institution` and `no-applicable-election`.

**Pending decisive round.** Rounds after the cutoff are recorded as scheduled
rounds of the held event (`pendingRound`). The event is not dropped and not
dated to the later round.

**Section scoping.** Status rows are read only from the infobox section for
this office. A presidential "TBD" in a combined general-election article does
not make the legislature partial. A general-election article that has no
presidential candidate table is not used as a presidential record. It is
logged as an attempt.

**Candidate tables.** Rules for building the national candidate table:

- *Choosing the table:* use the one that names the most infobox nominees
  (and the winner). A party primary that names only one nominee loses to it.
- *Choosing the name column:* when "Candidate" spans several columns, count
  only rows with a vote figure. Summary rows (Total, Valid votes, Registered
  voters…) are ignored.
- *Ballot lines:* if one person appears on several nominating-party lines,
  the person is one candidate. The lines are kept in `sourceRows`, and
  `votes` is null when the lines differ, so a total row is never added
  twice.

**Collective presidencies.** An infobox "Elected Presidency members" row (as in
Bosnia and Herzegovina) lists several members:

- `collectivePresidency.members` records all of them, each marked elected;
- the outcome is `reported`, with `members`;
- the single-winner metric is withheld with the reason "Collective presidency:
  N members elected (…); no single winner";
- the first name listed is never taken as the winner.

**Wikidata labels.** A Wikidata candidate label is trusted only when every word
of it (3+ letters, compared without accents) appears in the linked article
revision. An unmatched label (for example, a vandalised label for the Syrian
winner) is kept with `labelUnconfirmed`. It is never named as elected, and the
same-contest article supplies the outcome. A legitimate variant spelling can
fail the check: Paraguay's label "Santiago Peña Palacios" did, and the article's
"Santiago Peña" is used instead.

**A later cycle listed by discovery.** The discovery table gives each
category's "Last" date. Sometimes that date is later than the selected record,
and the article could not be used. A typical case: a general election after
which the parliament elects the president on another day. When this happens:

- the selected record is not presented as the latest;
- its freshness becomes `newer-held-results-pending`;
- its map metrics are withheld, with the reason naming the later cycle;
- `Identity of the later cycle` is listed as missing.

An authority's latest-election statement for the selected record overrides
this check.

**Dates.** Every status fact passes through the cutoff:

- A certification, declaration or claim dated after the cutoff is a later
  development. It is listed in `laterDevelopments` and not applied.
- Evidence captured after the cutoff that describes a fact effective on or
  before it is flagged `timing.retrospective`.
- Facts that later evidence establishes about an earlier snapshot are written
  to `build/catalog/retrospective-<date>.json`. The earlier generation is not
  changed.

**Offline replay of the authority pass.** Running `elections:evidence
--offline` replays the authority attempts recorded online for the same cutoff:

- the same captures, with the time each was checked;
- recorded fetch failures stay fetch failures, marked `replayed`.

Before this rule, an offline rerun replaced real online errors (HTTP 403,
timeouts) with "No offline evidence".
