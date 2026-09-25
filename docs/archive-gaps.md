# The archive fills its own gaps, and did so on screen

Found 18 September 2026, by generating 1945–2023 as a run.

## What was wrong

`governing.json` stores cabinets as intervals, and each interval's end is
derived: a cabinet's `to` is the next recorded cabinet's `from`. That is right
wherever ParlGov has a continuous record and badly wrong where it does not,
because the last cabinet before a silence expands to fill the silence.

The archive was therefore asserting:

| country | cabinet | derived interval | length |
|---|---|---|---|
| Germany | Hitler | 1933-01-31 → 1949-09-20 | **16.6 years** |
| Austria | Dollfuss | 1932-05-20 → 1945-04-27 | **12.9 years** |
| Norway | Nygaardsvold II | 1936-10-19 → 1945-06-25 | 8.7 years |
| Finland | Cajander III | 1937-03-12 → 1944-09-21 | 7.5 years |
| Malta | Mintoff I | 1955-02-28 → 1962-03-05 | 7.0 years |
| Denmark | Stauning V | 1939-04-03 → 1945-05-05 | 6.1 years |

Every frame from 1945 to 1949 showed Germany governed by the NSDAP — four years
after the surrender — and every frame to 1945 showed Austria governed by a
chancellor assassinated in 1934, in a country that had not existed as a state
since 1938.

**A single map never touches this.** The 1977 map used through milestones 6 and
8 is nowhere near it. It took putting the 1940s on screen to find it, which is
an argument for generating runs rather than samples.

## The rule

`MAX_CABINET_YEARS = 6` in `src/archive.js`. Past six years from its own start,
a derived interval is treated as the record having run out rather than the
cabinet still sitting: `cabinetRecordOn()` returns no cabinet and a reason of
`record gap`, the country goes uncovered, and the coverage count drops.

The archive already reasoned this way about the *end* of the release — an
open-ended final cabinet is "an artefact of the data stopping, not evidence
that the cabinet is still in office". This is the same artefact in the middle of
a record, and now gets the same answer.

**Six is measured, not chosen.** Across all 1,584 derived intervals in the
release, the longest that is genuinely a single cabinet is Canada's Borden
ministry at 6.0 years; every interval longer than that is a gap. The threshold
sits exactly where the data separates.

## What this still gets wrong

The separation is tight — 6.0 years genuine, 6.1 years a gap — so the rule
catches less than it looks like it should. Two known cases survive below the cap:

- **Denmark, 1943–45.** Stauning V is 5.75 years old on 1 January 1945, inside
  the cap. Stauning died in 1942, Scavenius governed to August 1943, and there
  was no government after that. The 1945 frame colours Denmark social democrat.
  It is caught from 1945-04-03, which bounds the error without removing it.
- **The Netherlands, 1940–45.** De Geer II runs to 1945-06-24 at 5.9 years.
  De Geer was replaced by Gerbrandy in September 1940. Both were christian
  democrats, so the *colour* is right and the cabinet name behind it is wrong.

Tightening the cap to catch these would cut Canada's Borden ministry and
Luxembourg's Bech I, both real. A hand-written table of wartime occupations
would catch them precisely — the same shape as `BOUNDARY_CHANGES` in
`src/vintage.js` — and is the obvious next step, but it means asserting a set of
historical dates, and asserting dates from memory in a project whose whole point
is not doing that is how a different error gets in. It is not there yet.

## Where it is reported

`governingOn()` returns a `gaps` array beside `covered` and `uncovered`, so a
country left blank for want of a record is distinguishable from one the archive
never covered. The series manifest carries this per frame as `recordGaps`, and
summarises it for the run:

```json
"recordGaps": [
  { "unit": "Germany", "lastCabinet": "Hitler", "since": "1933-01-31",
    "years": [1945, 1949], "frames": 5 }
]
```

A blank country on a map is a claim of ignorance, and it is worth being able to
say which kind of ignorance it is.

## A note on heads of government

The maps colour by the **head of government**, which in France is the prime
minister, not the president. The 1964 frame shows France by Pompidou's
affiliation (recorded as none, so hatched) rather than de Gaulle's. That is what
the subtitle says and it is consistent across the run, but it is the kind of
thing a reader will query, so it is written down here.
