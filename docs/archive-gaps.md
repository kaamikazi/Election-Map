# Historical coverage: evidence and limits

Reviewed 26 September 2026 against [ParlGov 2024, V1](https://doi.org/10.7910/DVN/2VZ5ZC).

## What the release supports

The vendored `view_cabinet.tab` supplies start dates and previous-cabinet IDs, but no termination column. A next-record date is an inference about continuity, not an explicit end. The current raw files produce 1,621 cabinets in 37 countries; the old documentation's 1,584 count was stale.

Both full databases from the same release were inspected and their hashes checked against the vendored Dataverse metadata:

| File | File ID | MD5 |
|---|---|---|
| parlgov-stable.db | 10437086 | 42c08766b8d5f78a8c504c1b0f4f5885 |
| parlgov-experimental.db | 10437084 | 78232eb9af0904a14887ec9c0db5d45e |

The stable cabinet table has descriptions but no termination-date field. The experimental table has 1,622 records, 1,107 populated termination dates and 175 resignation dates. **All eight audited records below have null termination dates.** The codebook also explains that termination events need not be the last day in office. Using all such dates as office end dates would be incorrect.

The codebook's Overview calls pre-1945 observations experimental and defines its scope around established democracies. Pre-1945 exports now disclose the experimental status. `coverageThrough` is the last dated observation, a conservative publication cutoff, not proof of continuity in every country. Later queries return `beyond the end of this release`.

## Audited intervals

The executable evidence, URLs, reasons and endpoint guards are in [data/parlgov-coverage.json](../data/parlgov-coverage.json). It binds the country, cabinet ID, recorded start and next recorded start. Builds reject changed endpoints. Coverage intervals are half-open: `[from, coverageTo)`. Coverage cutoffs are not necessarily government termination dates.

| Record | Decision | Endpoint evidence |
|---|---|---|
| Austria, 1554, Dollfuss | Coverage ends **1933-09-21**, resumes **1945-04-27** | Stable release description explicitly supplies this end; recorded start **1932-05-20**. Do not substitute his later death date. |
| Germany, 1578, Hitler | Democratic coverage stops **1933-03-24**, resumes **1949-09-20** | Release description marks the end of the Weimar Republic. This is **not** a cabinet termination claim. Recorded **1933-01-31** remains a source observation, not an independently certified appointment date. |
| Denmark, 1241, Stauning V | Conservative cutoff **1939-09-15**, resumes **1945-05-05** | Official [Stauning III](https://stm.dk/regeringen/regeringer-siden-1848/regeringen-stauning-iii/) covers the recorded April 1939 start and ends on 15 September; [Stauning IV](https://stm.dk/regeringen/regeringer-siden-1848/regeringen-stauning-iv/) begins then. ParlGov's election-based numbering differs: matching the name Stauning V to the official list would attach the wrong dates. |
| Netherlands, 1254, De Geer II | End exclusive **1940-09-03**, resumes **1945-06-24** | [National Archives: De Geer](https://www.nationaalarchief.nl/onderzoeken/index/nt00334/aa5122bf-5b67-46ff-8dbc-9a2126e412e3) covers **1939-08-10** through 2 September; [Gerbrandy](https://www.nationaalarchief.nl/onderzoeken/index/nt00334/123c021d-eb80-4583-9791-486b1de43d8f) starts 3 September. Missing successors are not invented. |
| Finland, 1199, Cajander III | End **1939-12-01**, resumes **1944-09-21** | [Finnish Government](https://valtioneuvosto.fi/en/governments-and-ministers/governments/-/gov/cajander-iii) supplies both **1937-03-12** and the end. |
| Malta, 1474, Mintoff I | Entire recorded **1955-02-28 to 1962-03-05** interval uncertain | [Official biography](https://www.gov.mt/en/Government/Government%20of%20Malta/Prime%20Ministers%20of%20Malta/Pages/Mr-Dom-Mintoff.aspx) supports 1955–1958, not continuity to 1962. Exact appointment/end days remain unverified here. Suppression includes potentially valid coverage; the cutoff equal to `from` is not an invented termination date. |
| Norway, 1222, Nygaardsvold II | Retain through **1945-06-25** | [Norwegian Government](https://www.regjeringen.no/en/the-government/previous-governments/regjeringer-siden-1814/historiske-regjeringer/norways-governments-1940-1945/johan-nygaardsvolds-government/id438691/) confirms March 1935–June 1945, including the recorded October 1936 restart and exile. This confirms the PM's party, not unchanged coalition membership or territorial control. The date model assigns the transition day to the successor; actual transfer was at noon. |
| Canada, 1171, Borden I | Retain through **1917-10-12** | [House of Commons](https://www.ourcommons.ca/MarleauMontpetit/DocumentViewer.aspx?DocId=1001&Language=E&Sec=Ch25&Seq=8) supports **1911-10-10 to 1917-10-12**, six years and two days. |

The next raw cabinet is a resumption point, not evidence about missing intervening governments. Tests check the beginning, day before/on cutoff, and day before/on resumption of every audited interval.

## Why there is no duration cap

The six-year heuristic left Stauning and De Geer incorrectly assigned in January 1945 but suppressed Norway's legitimate government and Canada's last Borden days. All seven closed raw intervals exceeding six years were audited, plus De Geer II. No new threshold replaces it.

## Reporting and remaining limits

The lookup distinguishes a recorded cabinet, an explicit record gap, no recorded cabinet, and a date beyond the conservative cutoff. A gap does not mean no government existed. Reasons, evidence, cutoff and resumption pass through the adapter and series manifest. Exports name uncovered countries and disclose Norway's wartime interpretation. Series reserve the largest footer so caveats do not shift frames.

Other intervals retain next-record inference, explicitly identified by `endBasis` in the generated data. They have not all been independently researched. Additional short gaps, caretaker transitions and occupation-related discrepancies may remain. World maps use present-day outlines. Saved legacy maps do not gain verified provenance retroactively.

Rebuild with `node scripts/build-parlgov.js`; validate with `node scripts/build-parlgov.js --check`. The evidence table and generated public archive are committed inputs; runtime lookups need no external service. Full databases remain local under ignored `data/raw/`. A stalled experimental-database download was retried successfully with curl and its MD5 verified.
