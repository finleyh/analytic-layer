# Dashboard requirements, from the CVS Analyst Dashboard mockups

Source: five draft screens built on claude.ai's Design canvas,
2026-10-08 (raw files in [`../design/mockups/`](../design/mockups/)).
Not wired to live data — every number and IP in them is invented. This
doc is the actual requirement extracted from each screen: what data it
needs, where that data already exists in `netflow-rollups`, and what's
still an open question. Written so the mocks can be deleted or redrawn
later without losing the thinking behind them.

**Revised 2026-10-09** — a sixth screen (Watchlist) and changes to the
other five, driven by mapping the seven views in `netflow-rollups`'
public schema onto the screens. The mocks now carry live 7d/30d
aggregates from the local database as of that date (except where a
screen says "illustrative"). §1–§5 below describe the 2026-10-08
draft; the revision section at the end describes what changed and why,
and supersedes §1–§5 where they conflict.

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

## Revision 2026-10-09 — the netflow-rollups views, mapped onto the screens

`netflow-rollups` has seven views in `public` (migrations 0005–0067):
the two base rollups `flow_rollup_hourly` / `flow_rollup_daily`
(keyed `monitored_ip, peer_ip, protocol, port_family` plus 15
`peer_is_*` / tag flags), and five derived daily continuous aggregates
built on `flow_rollup_daily`. The five split cleanly by what they're
keyed on, and that split is what reshaped the screens:

| view | keyed on | what it is | goes on |
|---|---|---|---|
| `monitored_ip_provider_mix_daily` | day, monitored_ip, category | bytes touching each peer category (unpivoted flags) | Overview chart (fleet sum), Watchlist column, Entity detail chart |
| `port_family_mix_daily` | day, monitored_ip, port_family | bytes per port family | Watchlist (RTP share), Entity detail "by plane" chart |
| `bph_contact_daily` | day, monitored_ip | the `bph` slice of the mix view, as a plain view | Overview trend, Watchlist column, Entity detail tile + sparkline |
| `tagged_entity_contacts_daily` | day, monitored_ip, peer_ip, protocol, port_family | every row where either side is confirmed-CVS or SIP-trunk, with the four tag flags | Flow graph edges |
| `unclassified_peer_contacts_daily` | day, monitored_ip, peer_ip | peers with every `peer_is_*` flag false | Top talkers "Unclassified" tab, Entity detail peer filter, Overview tile, Candidate evidence |

Plus the two portscan tables (not views): `scan_snapshots` (raw) and
`scan_fingerprints` — one row per `(monitored_ip, source, day)` with a
hash of the non-ephemeral facts, deliberately written even when the hash
is unchanged so "stable for N days" is a stored fact. Daily censys +
shodan sweep since 2026-10-02. The first draft's Device-fingerprint tab
was already real data from these; this revision adds a Fingerprint
column to the Watchlist, a fleet-wide drift card to the Overview, and
the full hash history to Entity detail.

Three of the five are **monitored-IP-centric with no peer dimension**;
the 2026-10-08 mocks were peer-centric (Top talkers, Candidates, graph
spokes) and had nowhere to put them except Entity detail, one IP at a
time. Hence:

### What changed per screen

- **Watchlist (new).** One row per `monitored_ips` entry — 15 today —
  with tags, 7d bytes, RTP share, dominant peer category, BPH 30d,
  unclassified-peer count, last seen. It's the one table that uses all
  three per-IP views at once, and the click-through the Overview tiles
  lacked. Added to the nav between Overview and Flow graph.
- **Top talkers → "Unclassified" tab.** Straight from
  `unclassified_peer_contacts_daily`. The migration comment calls it
  "the bucket the next classification candidate comes from"; four of
  the ten By-IP rows in the first draft were already "unflagged". As
  its own tab it's an explicit work queue and closes a visible loop:
  Unclassified → classify → Candidate review → approve → peer leaves
  the list. Live: 1,754 peers / 7.6 MB in 7d; eight of the top ten are
  `208.69.81–82.x` at 284–343 KB each, 7 of 7 days — the SBC-pool shape.
- **Overview.** The "RTP by peer category" chart is retitled "Traffic
  touching each peer category" and served from the mix view, because
  the view (a) isn't port-family-scoped, (b) includes
  `confirmed_cvs`/`sip_trunk` as categories (intra-watchlist traffic),
  and (c) counts a multi-flag peer in every category it matches — bars
  overlap and don't sum to 100%. RTP is 86% of all bytes, so the shape
  barely moves; the RTP-scoped version stays on Top talkers. Added a
  30d BPH-contact trend (the view exists specifically for "its own
  trend line"; live data shows a ×5 step on Sep 23 when 143.198.172.85
  joined) and an "Unclassified peers (7d)" tile.
- **Entity detail (monitored-IP variant).** The single "vs. primary
  peer" chart is replaced by a stacked daily chart from
  `port_family_mix_daily` — media / signaling / admin plane / other.
  That is founding question #2 ("can an administrator be identified")
  as a chart; the deliberate `voip_signaling` vs `voip_admin` split in
  `port_families` exists for it. Live data for OUTSIDERS shows
  signaling collapsing ~98% after Sep 28 while media holds. Added a
  provider-mix card with a "callers vs. infrastructure" grouping
  toggle (satellite/mobile/residential/cell-IoT vs.
  cloud/bph/proxy/wholesale — a UI grouping, not a view column), a BPH
  tile + sparkline, and an Unclassified filter on Top peers. The peer-IP
  variant of this page gets none of the three per-IP cards — they're
  keyed by `monitored_ip`.
- **Flow graph.** Edges come from `tagged_entity_contacts_daily`, which
  covers the whole star around each tagged node (every row where
  *either* side is tagged), not just monitored↔monitored. Three
  corrections to the first draft: `216.126.227.152` (the "Magnus
  Billing host") is on the watchlist itself, so it's a monitored node
  and its OUTSIDERS edge is monitored↔monitored; a residential-ISP peer
  category now exists (migration 0065); and a "Data notes" card lists
  the gotchas below.
- **Candidate review.** Each card gets an evidence block (triggering
  peer's monitored IPs touched, bytes/flows, days seen, port families)
  so the analyst sees the data next to the model's reasoning —
  `CLAUDE.md` §5's "keep the evidence, not a pointer". An info strip
  states what Approve actually writes and that history doesn't
  reclassify (below).

### Gotchas the views impose (not UI choices)

1. **No rollup view carries ASN.** `flow_rollup_hourly`'s GROUP BY has
   no `peer_asn`; ASN exists only in raw `flow_records` and
   `asn_classification_candidates.asn`. Blocks the By-ASN tab, the
   graph's ASN-cluster collapse, the Candidate column on the
   Unclassified tab, and "other IPs in ASN" on candidate cards. Fix is
   upstream: add `peer_asn` to the hourly rollup's grouping (cheap —
   near-static per IP), or accept a `flow_records` scan.
2. **Every monitored↔monitored conversation is stored twice** in the
   rollups and in `tagged_entity_contacts_daily`, once from each side's
   pull (17.52 MB / 17.51 MB for the trunk ↔ CVS #2 pair). Key graph
   edges on the unordered IP pair; don't sum.
3. **`tagged_entity_contacts_daily` dropped the `peer_is_*` provider
   flags** — it kept only the four tag flags. Peer-node color needs a
   join back to `flow_rollup_daily`, or the flags added upstream.
4. **Provider-mix categories overlap.** Present as "share that touched
   X", never as a composition, or derive a composition from
   `flow_rollup_daily` with an explicit primary-category rule.
5. **Daily views can't do 24h.** Every derived view is 1-day buckets
   with a 1-hour `end_offset` and 30-minute refresh — "today" is always
   partial and up to ~90 min stale. Only `flow_rollup_hourly`-backed
   widgets can honor the 24h pill. This answers open question #5: make
   the range toggle per-widget, or drop 24h globally and badge daily
   widgets with freshness. The mocks dim 24h and badge each card with
   its source view.
6. **Approving a candidate doesn't reclassify history.** Continuous
   aggregates re-materialize only the last 3 days (hourly: 3 hours).
   The peer stays "unclassified" for older rows until a manual refresh.
   Show candidate status inline on the Unclassified tab, or say so in
   the UI.
7. **A silent collection gap is invisible unless the UI shows "last
   scan".** As of 2026-10-09, `143.198.172.85` — the confirmed CVS —
   has no portscan row since Oct 7 while all 14 others were swept Oct 9.
   Nothing errors; the sweep just didn't reach it. Every fingerprint
   widget should carry the per-IP last-scan date and flag it when it
   falls behind the fleet. (Why it stopped is a netflow-rollups
   question, not a dashboard one — but the dashboard is where someone
   would notice.) Same applies to `216.126.227.152`, which has exactly
   one scan: "first scan" is a different state from "stable".

### Open questions added by this revision

6. Will `netflow-rollups` add `peer_asn` to `flow_rollup_hourly` (and
   the provider flags to `tagged_entity_contacts_daily`)? Both are
   small upstream changes that unblock three screens; the alternative
   is this dashboard reading `flow_records` directly.
7. Migration 0058 creates a `dashboard_app` role for "the analyst
   dashboard (netflow-rollups-dashboard, a separate repo/service)" with
   SELECT on everything and INSERT/UPDATE on
   `asn_classification_candidates` + the `*_providers` tables. Is
   `analysis-layer` that repo, or is there a third one? And those write
   grants conflict with `CLAUDE.md` §1's "does not modify data from the
   sources it reads" — §5 of this doc already accepts the candidate
   write; `CLAUDE.md` should say so too. (Also: the role's INSERT grant
   and the candidates table's `suggested_table` CHECK both predate
   `residential_isp_providers`, `reverse_proxy_providers` and
   `bph_providers`.)
8. The "callers vs. infrastructure" grouping on Entity detail is a UI
   decision over the flag list. If it's useful, should it become a
   view column upstream (one more unpivot tuple), or stay here?

The 2026-10-08 open questions 1–4 are unchanged. The mocks' invented
numbers are replaced by live aggregates everywhere except the candidate
evidence blocks, the watchlist-activity feed (still no source table),
and the graph layout itself.
