# Dashboard requirements, from the CVS Analyst Dashboard mockups

Source: five draft screens built on claude.ai's Design canvas,
2026-10-08 (raw files in [`../design/mockups/`](../design/mockups/)).
Not wired to live data — every number and IP in them is invented. This
doc is the actual requirement extracted from each screen: what data it
needs, where that data already exists in `netflow-rollups`, and what's
still an open question. Written so the mocks can be deleted or redrawn
later without losing the thinking behind them.

Global pattern across every screen: left sidebar nav (Overview / Flow
graph / Top talkers / Candidates), a 24h/7d/30d range toggle in the
header (not wired in the mock — what "range" means against hourly vs.
daily rollups, and whether 24h reads the hourly rollup while 7d/30d
read daily, is an open design decision, not just a UI toggle), dark
SOC-console look (IBM Plex Sans/Mono).

## 1. Overview

Landing page. Stat tiles: active monitored IPs, confirmed-CVS count,
SIP-trunks-tagged count, pending candidates, 7d RTP volume. All five
are cheap counts/sums against existing tables (`monitored_ips`,
`monitored_ip_tags`, `asn_classification_candidates`).

"RTP media traffic by peer category" — a provider-mix breakdown
**scoped to one port family (`rtp_media`)**, not all traffic. This is
not quite `monitored_ip_provider_mix_daily` as it exists today in
`netflow-rollups` — that table mixes across every port family. Either
add a port-family dimension to that rollup, or compute this view
ad hoc from `flow_rollup_daily` filtered to `port_family = 'rtp_media'`.

"Top RTP talkers" mini-table (peer, category, bytes) — same
`rtp_media`-scoped filter, links out to Entity detail.

"Watchlist activity" feed — recent OpenCTI tag changes, candidate
approvals. **No activity-log table exists for this today.**
`asn_classification_candidates` has `reviewed_at` for its own events,
but there's no general append-only log of "X happened to entity Y at
time T" across tag changes, candidate graduations, and watchlist
adds/removes. Needs its own table (or a reconciliation-diff approach)
before this widget is real.

## 2. Flow graph

The highest-effort screen. A manually-laid-out node graph: monitored
IPs (diamond markers) and peers (circles), colored by provider
category, edge width ~ bytes, a distinct dashed-orange edge style for
monitored-to-monitored traffic. Click a node → detail panel (label,
IP, role, tags, byte volume, a free-text analyst note).

Data-wise this needs one unified per-entity record combining:
provider classification (the `*_providers` tables), OpenCTI tags
(`monitored_ip_tags`), and aggregate traffic to/from the watchlist
(`flow_rollup_daily`, `tagged_entity_contacts_daily` for the
monitored-to-monitored edges specifically — that table already exists
for exactly this). Building the graph layout itself (which peers get
their own node vs. collapse into an ASN cluster — the mock does this
for one noisy ASN, "AS20122 ×10") is a real design decision, not just
a data question.

The free-text "note" on each node (e.g. "reads as a relay, not an
endpoint") is analyst narrative. **Nothing in `netflow-rollups` stores
this today** — not OpenCTI tags (categorical, not prose), not any
existing table. Needs a decision: a new annotations table here in
analysis-layer, or push it back into OpenCTI as a note/comment on the
observable.

## 3. Entity detail

Drill-down for one IP (monitored or peer — same template, reused via
links from every other screen). Header: IP, status badge, OpenCTI tag
chips (read-only in the mock). Stat tiles: first seen, last seen,
status, RTP session count.

Two tabs:
- **Netflow**: daily flow-volume bar chart against the IP's primary
  peer relationship, plus a top-peers table (peer, category, port
  families, bytes, flows). Straightforward from `flow_rollup_daily`.
- **Device fingerprint**: open-services table from portscan data, with
  a diff view calling out a dropped port between scans ("port 3000/tcp
  dropped between Oct 6 and Oct 7"). Maps directly to
  `scan_snapshots`/`scan_fingerprints` in
  `collection/portscan` — the fingerprint-hash design in that module
  already exists specifically to make this kind of diff cheap.

"First seen" / "last seen" aren't currently stored fields — derive from
`min`/`max` over `flow_rollup_daily`, or from `monitored_ips` if it
tracks watchlist-add date.

**This is also where the standing open requirement lives**: analysts
need to add/remove OpenCTI tags on a monitored IP from here, not just
view them. `monitored_ip_tags` is a read-only mirror of OpenCTI today
— adding write here makes this dashboard a second OpenCTI write-client
(label mutations), not just a writer of `netflow-rollups`' own tables
the way the candidate-review flow is. Where on this screen, and what
the interaction looks like, is **not decided** — the mock deliberately
left tags read-only pending that decision.

## 4. Top talkers

A leaderboard, explicitly scoped to `port_family = 'rtp_media'` with
monitored-to-monitored traffic excluded — i.e., this screen is a direct
UI productionization of the `review-rtp-top-ips` /
`review-rtp-top-asns` skills already in `netflow-rollups`. Two views:

- **By IP**: peer, category, bytes, flows, last seen.
- **By ASN**: ASN, org, category, bytes, peer-IP count, and a
  "confirmed-CVS link" yes/no column — does this ASN's traffic touch a
  confirmed-CVS entity. That last column isn't computed anywhere yet;
  it'd need an ASN-level join against `tagged_entity_contacts_daily` or
  equivalent, grouped up from IP to ASN.

## 5. Candidate review

A direct UI for the `review-asn-candidates` skill: pending
`asn_classification_candidates` rows as cards, each with the model's
reasoning, target table, and Approve/Reject buttons. This is the
lowest-risk screen to build — the backend logic (insert into
`suggested_table`, update `status`/`reviewed_at`) already exists and is
exercised today through that skill; the UI just needs to call the same
two operations.

## Open questions this round of mocks surfaced

1. OpenCTI tag write access from the dashboard (Entity detail, §3) —
   UX undecided, and a real scope question (second write-client to
   OpenCTI).
2. Where analyst free-text notes on an entity live (Flow graph, §2) —
   new table here, or push to OpenCTI.
3. Whether an activity-log table is worth building (Overview, §1) or
   whether that widget gets cut/simplified instead.
4. Whether `rtp_media`-scoped provider-mix needs its own rollup in
   `netflow-rollups`, or stays a query-time filter against
   `flow_rollup_daily` (Overview §1, Top talkers §4 both want it).
5. What "24h/30d" actually read from, given the hourly/daily rollup
   split already in `netflow-rollups`.

None of these block starting on the lowest-risk screen (Candidate
review); they matter most for Flow graph and Entity detail.
