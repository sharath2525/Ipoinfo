# IPO Data Source Rulebook

The website must merge multiple independent sources. A single website must never be the only path to IPO or GMP data.

## Field priority

| Data | First choice | Fallbacks |
| --- | --- | --- |
| GMP and GMP update time | IPOWatch | IPO Premium |
| Mainboard/SME, price band, lot size | IPO Premium | IPOWatch, IPO Ji |
| Open, close, allotment and listing dates | IPO Premium | IPOWatch calendar, IPO Ji |
| Recent allotment release status and registrar | IPO360, IPOWatch allotment | IPO Ji |
| PAN allotment result | Official registrar flow | Official registrar link |

## Merge rules

1. Match records using a normalized company name that ignores legal suffixes and market labels.
2. Keep the richest non-empty value for dates, price band, lot size and market type.
3. Prefer IPOWatch for a matching live GMP row; use IPO Premium when IPOWatch has no row.
4. Never replace a known value with an empty value from another source.
5. Treat Mainboard and SME equally in Open, Upcoming and Closed.
6. Sort Open and Closed by most recent close date. Sort Upcoming by nearest open date.
7. Load Closed history in pages of 50 so all records remain reachable without a large request on every visit.
8. If one source fails, continue with the remaining sources and never manufacture a status or GMP value.

## Request policy

- Fetch live Open and Upcoming data whenever the site API is refreshed.
- Use small paged requests for historical Closed data.
- Set short timeouts and fail over quietly when a source is unavailable.
- Do not store PAN numbers or include them in URLs, logs or browser storage.
