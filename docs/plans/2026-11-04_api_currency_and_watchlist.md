# Plan, 2026-11-04: API currency, then the Watchlist redesign

**Status, 2026-11-04: done, uncommitted** (Part 1 A-E, Part 2, and Part C). Built beyond the plan, found while
doing it: the Top talkers By ASN view and the candidate ASN evidence were still "blocked on
data" netflow-rollups has had since migration 0083; opening a peer's entity page failed with
"[object Object]" (now a peer page, and a shared `errorMessage`). Not done: Pipeline health's
"not available from this API" note (scanner verdict counts, last-write times are servable now).

Two pieces of work, in this order. The first is small and mostly copy; the second is a page
redesign. Both were scoped against netflow-rollups as deployed today (migration `0124`) and the
client committed in `src/api/netflow-rollups`.

## Part 1. Bring the front end up to the current API

### Where it stands

- **Structurally current.** A client regenerated from the live `/openapi.json` is byte-identical
  to the committed one. `tsc` passes. `monitored_ip` is gone from app code (netflow-rollups step
  21, absorbed in `fa0cfeb`). The Vite proxy still injects the right tokens. No page calls a
  removed or renamed route.
- **Semantically behind.** netflow-rollups wrote a change note for this app,
  `netflow-rollups/docs/dashboard_notes/2026-10-29_steps_4_to_13.md`, and none of it has been
  applied. Response shapes did not change; what some values mean did, and the UI copy still
  describes the old pipeline (classification baked into the rollups, a nightly refresh, scanners
  excluded for 180 days).
- Not consumed yet: `/review/ip-relations` and its decision route, the two history routes,
  `/review/queue.peer_relations`, `/verdict/scanners`, `/ref/providers` (`closed_at`,
  `include_closed`).

### A. Fix what the UI claims about values

1. `src/pages/FlowGraph.tsx:227` and the Legend: "the pair itself confirmed as a SIP peer".
   `pair_confirmed` is now any confirmed relation between the two (operator, c2_victim,
   sip_trunk, ...), and `peer_roles` / `watched_ip_roles` carry relation names too. The edge
   logic at line 338 is still right; the wording is not.
2. `src/pages/Geo.tsx:131`: the per-country role buckets now receive relation names. Check the
   legend covers them instead of lumping them into "unclear".
3. `src/pages/CandidateReview.tsx:1220-1229`: `sig_days`, `rtp_days`, `media_records` can be null
   since `/review/sip-pairs` is rebuilt from relations; they render as blanks. Show "—" the way
   line 1226 already does for `sip_per_day_from_peer`.
4. `src/pages/CandidateReview.tsx:426`: "Rollup rows re-materialize on the next refresh; older
   rows stay unclassified until then" is no longer true. Show the decision response's `rollups`
   field verbatim (`"applied"` for roles and relations; `"at the next peer classification, within
   30 minutes"` for an ASN graduation) instead of hard-coded prose.
5. `src/pages/Overview.tsx:457` and `src/pages/TopTalkers.tsx:104-109`: "tagged peers excluded".
   The calls pass `exclude_confirmed` and `exclude_watched`, and scanner traffic is hidden
   upstream by date (a verdict on day D hides D to D+30; a feed or curated entry hides every day).
   Say that.
6. Anything that compares a total across 2026-10-29 16:31 UTC sees a step of about 1% (dated
   hiding). No fixed numbers were found in copy; note it where a chart spans the date.

### B. Source badges that name dropped objects

`rollup__provider_mix_daily`, `rollup__bph_contact_daily`, `rollup__port_family_mix_daily`,
`rollup__unclassified_contacts_daily`, `rollup__confirmed_contacts_daily` and `review__sip_pairs`
no longer exist. Badges at `Watchlist.tsx:500-503`, `Overview.tsx:375` and `:414`,
`TopTalkers.tsx:116`, `FlowGraph.tsx:226`, `:311`, `:333`, `CandidateReview.tsx:26`, `:1159`,
`:1265`.

Decision to make: badge the **API route** (`/rollup/provider-mix-daily`), which is the contract
and stable, rather than the database object, which has churned twice. Recommended: the route.

### C. New routes the app does not consume yet (second pass, adds a review surface)

- `/review/queue.peer_relations` count on the Overview and as a fourth queue on Candidate Review.
- `/review/ip-relations` plus `POST .../decision`: a relations queue. Closes the open gap
  recorded as `task_025cb553` (Candidates' Relationships only covers measured SIP pairs; operator
  and c2_* relations never surface for review).
- `/review/ip-roles/{ip}/history` and `/review/ip-relations/{ip}/history` on Entity Detail:
  "what did we believe about this IP on date X".
- `/verdict/scanners` on Entity Detail: "why is this peer hidden", with the D to D+30 rule.

### D. Docs

- `docs/dashboard_requirements.md` has about 35 stale names (`monitored_ip*`,
  `review__sip_pairs`, the `*_daily` aggregates).
- `CLAUDE.md:541` cites `review__sip_pairs.confirmed_role`; it is
  `review__ip_relations.status = 'confirmed'` now.
- Record that `netflow-rollups/docs/dashboard_notes/` is the inbound channel for API changes:
  one note per batch, read before any front-end work.

### E. Verify

`tsc` and `vite build`; the dev server with a screenshot of each touched page; confirm
`npm run generate:client` stays a no-op.

Scope recommendation: A, B, D and E in one pass (no behaviour change beyond the nulls and the
`rollups` field); C as its own pass.

## Part 2. Watchlist redesign

### What is there now, and what the data allows

- "Fingerprint (7d)" (`src/pages/Watchlist.tsx:87`) calls `/lookup/host-scans/changes` with the
  default window and shows counts only: distinct fingerprints and scans per source. No hashes,
  no hover.
- "RTP share" (`Watchlist.tsx:302`; the column the owner calls call activity) is `rtp_media`
  bytes divided by all bytes over 7 days, from `/rollup/port-family-mix-daily`. That response
  already carries **every** port family per watched IP per day, so an all-traffic view needs no
  new API.
- Scan history exists back to **2026-10-02** (30 IPs; up to 35 scans per IP per source; up to 7
  distinct fingerprints for one IP). `lookup__host_scans` is append-only with no retention
  policy. `/lookup/host-scans` and `/changes` both take `from` and `to`, so "past 7 days" is a
  front-end window choice, not an API gap.
- Every scan row carries `fingerprint_facts` (port, transport, service protocol, software name
  and version, HTTP title, favicon hash, TLS fingerprint); `raw_response` comes with `?raw=true`.
  There is no per-hash route; "what the data was for that hash" is the facts of the scans that
  carried it, grouped client-side.
- `src/pages/EntityDetail.tsx:90` already has the pieces: `buildFingerprintGrid` (per source, per
  day, first / same / changed cells with the hash), `diffFacts` (what appeared and disappeared
  between consecutive scans) and a facts table. It is capped at the last 10 days
  (`gridDays = allDays.slice(-10)`) and not shared.

### 1. Port-scan history beyond 7 days

- A page-level window selector: 7 / 30 / 90 days / since 2026-10-02. It drives the `/changes`
  call with `from` and `to`.
- The column becomes "Fingerprints (N d)": distinct hashes and scan count per source for the
  window, as today but over the chosen window.

### 2. Hash hover and click

- On row expand, fetch `/lookup/host-scans?ip=&from=&to=` lazily for that IP (raise `limit`:
  two sources over 90 days is about 180 rows) and fold the scans into **fingerprint runs**:
  (source, hash, first day, last day, scan count, facts).
- Render each run as a chip: `e0e900 · shodan · Oct 31 → Nov 4 · 1 service`.
  - Hover: a tooltip listing the facts (port / protocol / software version / title).
  - Click: an inline panel with the full facts table, the diff against the previous run for that
    source, and a link to `/entity/:ip`. Optional "raw" toggle that fetches `raw=true` for one
    scan.
- Lift `buildFingerprintGrid`, `diffFacts` and the facts table out of EntityDetail into
  `src/lib/fingerprints.ts` and `src/components/FingerprintHistory.tsx`. EntityDetail then uses
  the same window selector and loses its 10-day cap.

### 3. Traffic column, replacing "RTP share"

- "Traffic by port family (N d)": a stacked bar across all families with the total, coloured by
  a shared `familyColor` lifted from `src/pages/FlowGraph.tsx:39`. Hover shows bytes and percent
  per family; RTP stays visible as one segment.
- Click expands a per-family table for that IP: bytes, flows, share, days seen, for the window.
- Sorting: by total, or by any one family.
- The "Bytes" column follows the same window. BPH 30d keeps its own window (it is a trend card by
  definition); change that if the owner wants one window for everything.

### 4. Docs and verify

- Update the "Sources, per column" note at the bottom of the page and the Watchlist section of
  `docs/dashboard_requirements.md`.
- Dev server screenshots at 7 / 30 / 90 days; hover and click a hash on `103.83.86.254` (three
  shodan fingerprints since 2026-10-31); `tsc` and build.

## Order

Part 1 first (small, and it touches the same Watchlist source note), then Part 2.
