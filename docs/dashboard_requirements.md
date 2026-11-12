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

**Revised 2026-11-04** — netflow-rollups finished a stabilization pass (steps 7 to 23) that
renamed and dropped most of the objects the sections below name, and the app now reads the new
API. Every older section is kept as written; the last section, "Revision 2026-11-04", has the
rename key and what changed per screen, and supersedes them where they conflict.

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

## Second source, 2026-10-09 — spoiler-alert (domain proof-of-life)

`spoiler-alert` (`~/projects/spoiler-alert`, live at
`spoiler-alert.trashcollector.dev`) is passive proof-of-life monitoring
for OpenCTI **domains** — its decision 26 moved IP monitoring to
netflow-rollups, so the two are complementary by design. A
`monitor:<cadence>` label on a Domain-Name drives `dns_records`
(A/AAAA/NS/MX/TXT/CNAME/SOA → ok / nxdomain / parked / empty / timeout /
error) and `domain_expiry` (WHOIS/RDAP); a lifecycle demotes dead
domains to `monitor:zombie` + `lifecycle:<cause>` after 2 consecutive
failures and retires them (tombstone, yearly recheck,
`lifecycle:resurrected` if they come back). It is the first **REST-only**
source — its Postgres binds no host port, so there is no Trino catalog
to register; `CLAUDE.md` §4's bespoke-access fallback is now a real case.

### API surface (all token-gated except `/health`)

| endpoint | returns | used for |
|---|---|---|
| `/status` | per-cadence and per-state counts, `due_now`, `check_runs_24h`, `errors_24h`, `status_mix_24h`, retired/resurrected, sync state | Overview "Domain proof-of-life" strip |
| `/monitored` (+ `cadence/state/type/overdue` filters) | `opencti_id`, `opencti_href`, `value`, `cadence`, `state`, `consecutive_failures`, `last_checked_at`, `next_due_at`, `domain_expires_at` | Watchlist → Domains tab |
| `/monitored/{id}` | the above + `history[]` of runs with `module`, `status`, `observations.records` | Domain detail: A-record timeline, current records, run strip |
| `/retired` | tombstones: `retired_at`, recheck dates, `resurrected_at` | Domains tab (retired rows) |
| `/labels` | the cadence/cause label catalog, generated from settings | chip tooltips |
| `POST /recheck/{id}` / `POST /trigger/{id}` | synchronous recheck (records `forced_by`) / queue for next tick | "Recheck now" on Domain detail |

Live on 2026-10-09: 16 monitored (13 active, 3 zombie), 3 retired, 44
checks/24h, 0 errors, results ok 21 / empty 17 / parked 6.

### The join, measured

spoiler-alert stopped writing A/AAAA results to OpenCTI (decision 26),
so `observations.records.A` in its run history is the **only** record of
which IPs a monitored domain resolved to, per check, over time. Joined
against netflow-rollups on 2026-10-09:

- **Direct (A record = a watchlist IP): none.** The investigation's own
  domains — `tox3in.com`, `tox3.xyz`, `doomcall.pro`, `plugvalley.sh` —
  all sit behind Cloudflare (`172.64.80.1`); `outsiderzvpn.com` and
  `tox3.in` publish no A at all.
- **Via peers (A record = a `flow_rollup_daily.peer_ip`): 5 of 16.**
  `blueoceanglobe.net` (3 Wix IPs), `nexigo.com` / `nexipc.com` (one
  Shopify IP), `m3zapp.com` / `panel.m3zapp.com` (two lander IPs) — all
  small-byte `web_admin` contacts, and **every one of them with the same
  monitored IP, `165.227.194.81`**. That's the Watchlist's outlier (0%
  RTP, 758 unclassified peers, 1,081 reverse-proxy peers): it fetches
  these domains' websites. Real signal, but it reads as "the watchlist
  box visited where this domain is hosted", not "this domain fronts the
  CVS". OpenCTI, meanwhile, describes that IP as "distributed as a SIP
  IP by the criminal voip service OUTSIDERZ" and puts it inside the
  OUTSIDERZ Infrastructure object — the TIP and the netflow disagree
  about what this box *is*, and that disagreement is itself the kind of
  thing the queue exists for.
- **The best single finding is temporal, not a join:** `panel.m3zapp.com`
  resolved to `164.92.90.138` (DigitalOcean, same provider as the
  watchlist) until Oct 1, then moved to a `parity.domains` parking
  lander. A VoIP billing panel moving to a parking page is a lifecycle
  event worth a queue entry, and only the run history shows it.
- The Cloudflare inference ("the CVS sits behind the proxied domains")
  does not hold up: OUTSIDERS' 37 reverse-proxy peers are CDN fetches on
  `web_admin` (Fastly, Cloudflare, GitHub Pages), none is `172.64.80.1`.
- netflow-rollups' urlscan `domain_scans` has 10 domains; **zero
  overlap** with spoiler-alert's 16. Two disjoint domain sets, worth
  knowing before anyone assumes they're the same list.

### Third source — OpenCTI GraphQL, read-only (same day)

With an `OPENCTI_API_TOKEN` of this project's own in `.env`, the
dashboard can ask OpenCTI 6.9.6 what each tracked object *belongs to*:
`stixCyberObservable(id)` for labels, score, description, indicators,
containers, notes and `stixCoreRelationships` (with
`representative { main }` for the other side's display name), then
`stixCoreObject(id)` for the owning Infrastructure / Organization and
its full membership. This is the "what they relate to" layer neither
collector has, and it is what turned a flat domain list into a page:

- The 19 domains belong to **8 owning objects** — Infrastructure:
  OUTSIDERZ aka SPOOF WORLD (also owns watchlist IPs 143.198.172.85 and
  165.227.194.81), M3 VHISHING INFRA, PlugValley (+5 sub-infrastructures,
  9 Telegram channels), doom voip, Tox Carding Forum; Organization
  (`infrastructure:threatactor`): BlueOcean Inc (+ Nexigo), ZXTech (17
  individuals, 20 companies). One domain is unaffiliated.
- **The only graph path from a monitored domain to a monitored IP** is
  `plugvalley.sh` →resolves-to→ `176.97.113.106` ("hosting plugvalley.sh",
  `hosting:virtual_systems_ukraine`) ←derived-from← `162.243.77.115`.
- **Monitoring gaps the graph exposes**: `tox3in.in`, `doomcall.app`,
  `callspoofing.org` (the last labelled criminal_voip_service and related
  to confirmed CVS 192.248.178.127) carry no `monitor:*` label;
  `185.233.247.245`, `176.97.113.106`, `95.214.235.200` relate to
  watchlist IPs and carry no `msk:voip_analysis`. "An object related to
  tracked infrastructure has no tracker label" is a rule; its resolution
  is a TIP label write (pillar #4).
- **Graph hygiene**: `outsiderzvpn.com`, `m3zapp.com`, `plugvalley.ws`,
  `status.plugvalley.pro` name their owner in `x_opencti_description`
  but have no relationship to it; three `scope:derived` IPv4 observables
  are leftovers from before spoiler-alert went domain-only.
- **Open question #2 (where analyst prose lives) is partly answered**:
  every watchlist IP already has an `x_opencti_description` and several
  have Notes — the Flow graph's "note" field can read from OpenCTI
  rather than needing a table here.
- The TIP and the netflow disagree about `165.227.194.81` (OpenCTI: "a
  SIP IP distributed by OUTSIDERZ"; netflow: 0% RTP, website fetches).
  Surfacing that disagreement is exactly the queue's job.

### What changed in the mocks

- **Overview**: a "Domain proof-of-life" strip from `/status`; the
  activity feed now carries the Oct 8 demotions/retirements and the
  `panel.m3zapp.com` A-record move (derived — see gotcha 8).
- **Domains (new page, in the nav)**: three views — *By owner* (one card
  per Infrastructure/Organization: its domains with state, cadence,
  next check and A record; its links to the IP watchlist; everything
  else related to it in OpenCTI, grouped by type), *All domains* (the
  table: owner, state, last/next check, expiry, current A, netflow
  peer), and *Cross-links & gaps* (the five IP↔domain links, the
  monitoring-gap queue candidates, the derived lifecycle timeline).
  The Watchlist page is IP-only again and links here.
- **Domain detail (new page)**: `panel.m3zapp.com` — state/cadence/cause
  chips, OpenCTI link, A-record timeline (same green/orange idiom as the
  fingerprint hash strip), current records, run-status strip, netflow
  cross-reference, Recheck now.

## Geo view, 2026-10-13 — and what moved upstream over the weekend

netflow-rollups (Oct 10–11) added `sip_peer_candidates` / `sip_peers`
(a nightly heuristic classifying every monitored↔peer pair with both SIP
and RTP legs as trunk / client / prober / media_only / unclear, with ~20
explicit feature columns; 130 pending rows on Oct 13), `sip_peer_scans` +
`sip_peer_identities` (passive Shodan/Censys, ASN/RIPEstat/PeeringDB/rDNS
for trunk-like peers — which closes `CLAUDE.md` §8.3's "what triggers
on-demand enrichment" question: the heuristic does), and geo columns on
every provider table (0069/0070). spoiler-alert (Oct 10) added
nameserver-based parking detection (`PARKING_NAMESERVERS`, dedicated
parkers only) and lets parked tombstones resurrect (decision 27).

The analyst's working hypothesis: operators route through **overseas SIP
upstreams to evade US telco fraud teams**. `Geo.dc.html` is built to
test it against the data it has:

- **Snapshot supports the pattern.** 45% of trunk-role media (168 of 372
  MB over 30d) goes to non-US peers: DE 86, CO 79, GB 1.7, DO 1.4, MX
  0.3. Concentrated: `146.190.124.95` sends 51% of its trunk media to a
  Colombian satellite ISP (AS265861, p95 concurrency 24, zero overnight
  share in Bogotá time); `143.198.176.127` sends 97% to Germany.
- **But "overseas" is two tactics**, roughly half each by bytes: foreign
  *carriers* as upstreams (CO satellite, DO Servimast/Altice, MX) vs.
  the operators' *own switches hosted abroad* (Vultr/Hetzner DE,
  DigitalOcean GB). The DE "upstream" of the SIP trunk node is
  `192.248.178.127` — the confirmed CVS on Vultr Frankfurt, whose rDNS is
  `callspoofing.org`. Provider-table flags separate the two; a
  country-only view conflates them.
- **The 63-day history shows a steady mode, not a shift.** Weekly non-US
  share of UDP media is ~40–45% every week since Aug 10 (one 84% week is
  a single 150 MB burst to the DE node); per IP it's flatter still. If a
  shift happened it predates the netflow backfill, or is relative to
  other operators' baselines this watchlist can't see. The page says so.
- **Geo coverage is cloud-heavy**: lat/lon on 6,453 / 6,530 cloud rows
  but 3 / 23 wholesale-VoIP and 1 / 30 mobile. Country-level views are
  honest today; a dot map is not.

Screen: an **interactive map** (d3 + world-atlas 110m from jsdelivr) —
great-circle arcs from each monitored IP's home country (its own
`flow_records` country field) to peer countries, width ~ log bytes,
country fill ~ log bytes, monitored IPs as diamonds (red = confirmed CVS,
orange = SIP trunk). Two modes: *SIP peer roles · 30d* (the 130
`sip_peer_candidates` pairs, arcs colored by the peer's provider class
from `sip_peer_identities`, so a foreign carrier and an own-node-abroad
look different) and *All UDP media · by week* (every ≠5060 UDP flow per
week from the 63-day backfill, scrub or auto-play across the 9 weeks).
Filters: role chips, monitored-IP select (or click a diamond), hide
US→US; zoom/pan; hover tooltips on arcs, countries and nodes; click a
country for a side-panel list of its peers with identity rows. All
endpoints sit at jittered country centroids — the honest placement for
the geo currently available. Below it: a per-monitored-IP 100%-stacked
bar by (peer country × provider class) with non-US segments marked; the
weekly non-US trend (overall + four small multiples); country tiles; the
30 trunk identities with ASN holder, PeeringDB type, rDNS, media,
`overnight_share` as a "sleeps?" bar, concurrency, call median, scan
presence.

What a real dot map needs, when the analyst wants it: lat/lon on the
carrier provider rows (the geocode-backfill is filling them in), or a
per-peer geo lookup in `sip_peer_identities` (RIPEstat's GeoLite
endpoint is already wired for the provider tables). The rule candidate
this view suggests — "new trunk-role pair in a country this monitored IP
has never used" — is a one-shot condition over `sip_peer_candidates`.

### Sankey (Flow graph page, second tab)

Only SIP/VoIP traffic (`rtp_media`, `voip_signaling`, `voip_admin`), 30
days, bytes as width: **peer class → peer IP → monitored IP → port
family**. Four layers because that is the minimum that answers "what kind
of network → which host → which of ours → media or signaling" while
staying legible against 5,805 distinct peers (408 MB): the top 28 peers
by bytes are individual nodes, every other peer collapses into one
"other *class* ×N" node per class, and the 208.69.81–82.x pool (eight BL
Networks hosts with near-identical volume to the SIP trunk node) is
grouped by default. Monitored↔monitored conversations are stored twice
upstream (one row per side's pull) and are counted once here. Role tags
on peers come from `sip_peer_candidates`. Data is a single
`flow_rollup_daily` aggregation; upstream could materialise it as a
`sip_peer_bytes_30d` view if the dashboard wants it live.

### Gotchas and open questions this adds

12. **Rollups drop country and ASN.** `flow_records` carries
    `src/dst_country` and `src/dst_asn` on every row; `flow_rollup_hourly`
    groups neither away. Adding `peer_country` and `peer_asn` to its
    GROUP BY (near-static per IP, so cardinality barely moves) makes the
    Geo trend a live continuous aggregate and unblocks By-ASN, the graph
    cluster, and candidate context in one change. Until then: one-off
    180-day scans (~2 s for 63 days).
13. **A second, bigger candidate queue.** 130 pending `sip_peer_candidates`
    vs. 2 ASN candidates — the Candidate-review screen needs a queue
    switcher and real triage ordering (§10's "without smuggling in a
    score" question is now concrete). Not yet in the mocks.
14. **The analysis pillar's first example moved upstream.** "Server vs.
    VoIP client" is now mechanical in netflow-rollups; what stays with
    this project is the non-mechanical call the migration names —
    criminal infrastructure vs. legitimate customer — plus a candidate
    rule: a new trunk-role pair in a country the monitored IP never used
    before (`first_day`, `peer_country`) is the "tactics shift" detector
    the trend chart can't be yet.

8. **Lifecycle events have no public endpoint.** The append-only
   `lifecycle_events` table — exactly the activity log open question #3
   asks for — is served only under `/dashboard/data`, which sits behind
   Authentik in prod and returns an SSO redirect to a token caller. One
   small upstream ask (a token-readable `/events`) makes the Overview
   feed real for domains.
9. **`monitor:monthly` on IPs has no machine consumer.** netflow-rollups
   mirrors every OpenCTI label (migration 0055) but only surfaces two as
   rollup flags; spoiler-alert ignores IPv4 objects. The Watchlist chip
   shows a label nothing acts on — either drop it from the UI or treat
   it as human-only intent.
10. **Credential**: this project now holds its own
    `SPOILER_ALERT_API_TOKEN` in `.env` (gitignored), per `CLAUDE.md`'s
    never-another-project's-credential rule. Reads are N+1 (`/monitored`
    then `/monitored/{id}` per domain for A records) — fine at 16, worth
    a bulk endpoint if the fleet grows.
11. **Stay on the documented endpoints.** `/dashboard/data` returns
    everything in one call but is `include_in_schema=False` and
    SSO-gated — not a contract.


## Pipeline health, 2026-10-15 — a page for the data behind the pages

Added while the netflow feed was in a real outage (cryopod ingested nothing after 03:57 UTC on
Oct 14; every exporter stopped in the same minute), which is the best possible time to design the
page that would have explained it. The question the page answers is narrower than "is everything
ok": *is the data behind every other page still arriving, and if not, whose problem is it?*

What it reads — all of it exists today in `netflow-rollups`:

| source | what the page takes from it |
|---|---|
| `ops/freshness.py` `CHECKS` (the same four SQL probes the hourly check runs) | the four tiles: age of the newest netflow record, hourly-rollup lag, honeypot watermark, newest watched-IP scan — each with its limit, so the tile shows a fraction, not just a colour |
| `ops__freshness_alerts` | the open episode: stale since, last alert; one row per stale stream, deleted on recovery |
| `flow__records` | records per hour for 7 days; the shaded gap is "no rows after the newest record" |
| `rollup__flow_hourly`, `rollup__flow_daily` | the heads, to show the rollup trailing the raw data by its designed ~1 h |
| `ops__watermarks_netflow`, `ops__watermarks_honeypot`, `lookup__host_scans`, `verdict__scanners`, `review__ip_roles`, `ref__providers` | "heads and watermarks": the newest row each stream wrote |
| Prefect API | deployments tagged `netflow-rollups`, last run per deployment, the puller's run history with "pulled N records" parsed from its log lines, held no-overlap slots |

The one thing it argues for that does not exist yet: an **upstream probe**. "Newest data is 34 h
old" has two very different owners — the puller stopped asking (ours: an exception, a held slot,
a dead scheduler) or the upstream stopped having (theirs). The puller's own run log already tells
them apart (`Failed` with an exception vs `Completed` with 0 records over a normal window vs no
run at all), and the page shows that split; a match-anything query to cryopod would make it a
check instead of a reading. Proposed for `ops/freshness.py`, not built.

Gotchas the page makes visible, so the UI should not hide them: watermarks advance through an
empty window (a quiet window is recorded as pulled, so "watermark is current" never means "data
is current"); the hourly rollup deliberately trails the raw head by about an hour; the freshness
flow stays `Failed` in Prefect for as long as anything is stale, so red rows there are the status
display, not a bug; and after a scheduler restart the stranded run shows as `Crashed`, which is
the scheduler cleaning up after itself, not a failure to investigate.

Every table name on this page should be read against `netflow-rollups/docs/data_model.md`: the
schema was consolidated on 2026-10-14/15 (35 tables → 20, every table now `<word>__<thing>`). The
mocks were swept to the new names on 2026-10-15 — see "Revision 2026-10-15" below. The earlier
sections of this document keep the names they were written against, as dated records; the rename
table in that revision is the key.

## Who asserted this label — settled 2026-10-15

netflow-rollups' migration 0077 recorded the rule (2026-10-14) that OpenCTI labels other than
`msk:*` are analyst suggestions from the TIP, not facts, and that no logic may key off them. Its
rollups now carry its own human-reviewed roles (`review__ip_roles.accepted_role`,
`review__sip_pairs.confirmed_role`) and the OpenCTI labels survive only as data on
`watch__ips.tags`. As of 2026-10-15 the two already disagree: the heuristic proposes `sip_trunk`
for `216.126.227.152` and `sip_server` for `143.198.176.127`, which carries the
`infrastructure:sip_trunk` label; and all 16 watched IPs are still `pending` review, so no watched
IP has a reviewed role yet.

**Decision (user, 2026-10-15):** the analyst app shows the two side by side and visibly
distinct, never merged into one badge. Every label on an entity names who asserted it:

| chip | source | meaning |
|---|---|---|
| reviewed role (sip_server / sip_trunk / sip_client) | `review__ip_roles.accepted_role`, `review__sip_pairs.confirmed_role` | what netflow-rollups measured and a human confirmed; the only kind a rule may read |
| proposed role, marked pending | `review__ip_roles.proposed_role` | the heuristic's current opinion, unreviewed |
| TIP label (e.g. `infrastructure_type:criminal_voip_service`) | `watch__ips.tags`, or OpenCTI directly | what an analyst recorded in OpenCTI; context for a human, never a rule input |

Consequences for the mocks: the red "confirmed CVS" and orange "SIP trunk" node styling on
Flow graph, Geo and Watchlist was derived from TIP labels and has to be re-sourced from the
reviewed role (grey/unstyled while pending), with the TIP label shown as a separate chip in a
distinct style. Where the two disagree the UI should show both, not pick one. This is the same
principle as `CLAUDE.md` §10's "facts and reasons, never a score": provenance stays attached to
the claim. It also gives the analysis pillar (`CLAUDE.md` §2 #3) its first concrete derived-fact
rule — a disagreement between the TIP label and the reviewed role is itself a queue-worthy
finding.


## Revision 2026-10-15 — the consolidated schema, the role columns, and who-said-what

netflow-rollups' migrations 0077–0082 (Oct 14/15) renamed every table and re-shaped three things
the mocks leaned on. All nine older mocks were swept the same day; the Pipeline health page was
built on the new names and needed nothing. The netflow feed was still stale while this was done
(newest record Oct 14 03:57 UTC; the puller completes every four hours with zero records), so
counts below are Oct 15 and traffic widgets keep the vintage their badge says.

### Rename key (old badge → what it reads now)

| old | now | note |
|---|---|---|
| `flow_rollup_hourly` / `flow_rollup_daily` | `rollup__flow_hourly` / `rollup__flow_daily` | eleven `peer_is_*` booleans → one `peer_categories TEXT[]`; four OpenCTI-tag flags → `monitored_ip_role`, `peer_role`, `pair_confirmed` |
| `monitored_ip_provider_mix_daily` | `rollup__provider_mix_daily` | `provider_category` now includes an explicit `unclassified` row; the two tag-derived pseudo-categories are gone |
| `port_family_mix_daily`, `bph_contact_daily` | `rollup__port_family_mix_daily`, `rollup__bph_contact_daily` | rename only |
| `unclassified_peer_contacts_daily` | `rollup__unclassified_contacts_daily` | "unclassified" now means `peer_categories = {}` **and** no accepted role |
| `tagged_entity_contacts_daily` | `rollup__confirmed_contacts_daily` | different meaning: pairs/roles a human confirmed in netflow-rollups, not IPs an analyst labelled in OpenCTI; carries roles, still no provider categories |
| `scan_fingerprints` (+ `scan_snapshots`) | `lookup__host_scans` | one table, `subject` = watched \| peer; raw record and fingerprint hash on the same row |
| `monitored_ips` + `monitored_ip_tags` | `watch__ips` with `tags TEXT[]` | the tag mirror is a column read by nothing |
| `asn_classification_candidates` | `review__asn_candidates` | `suggested_table` → `suggested_category` |
| `sip_peer_candidates` | `review__sip_pairs` + `review__ip_roles` | pair roles: sip_trunk / sip_client / sip_scanner / unclear (prober → sip_scanner, media_only gone); IP roles: sip_server / sip_trunk / sip_client / unclear, `vantage` = watched \| peer, `proposed_role` beside `accepted_role` |
| `sip_peer_identities` | `lookup__ip_identities` | `provider_categories TEXT[]` replaces the provider-table list |
| `cloud_providers` and the other ten `*_providers` | `ref__providers` with `category` | registry in `ref__provider_categories` (`llm_classifiable`) |
| `flow_records` | `flow__records` | time column is `time` |

### What changed per screen

- **Watchlist** — 16 rows (`51.198.100.9` added Oct 13 with the OpenCTI label
  `infrastructure:criminal_voip_client`). The tags column became two: the **reviewed role**
  from `review__ip_roles` (dotted "proposed … · pending" while `accepted_role` is null — true for
  all 16 on Oct 15) and the **TIP labels** from `watch__ips.tags` as dashed chips. Fingerprint
  column re-sourced from `lookup__host_scans` (distinct hashes since Oct 2; all 16 swept Oct 15,
  so the Oct 9 collection-gap finding is closed). "Last seen" became "Last record" from
  `flow__records`, which is what showed `51.198.100.9` stopping nine hours before the fleet.
- **Overview** — a stale-feed banner linking to Pipeline health; tiles re-sourced: "Confirmed
  CVS" → "Reviewed roles 0 / 16", "SIP trunks tagged" → "TIP labels on watched IPs 4", "Pending
  candidates" → 20 ASN + 48 peer roles + 16 watched roles + 71 unconfirmed SIP pairs. Traffic
  widgets keep the Oct 9 pull and say so.
- **Entity detail** — the red CONFIRMED CVS badge became a dotted "ROLE PENDING · proposed
  sip_server" badge; the OpenCTI label is a dashed `TIP ·` chip beside it.
- **Flow graph** — the three monitored nodes lost their red/orange styling (no accepted role
  exists to drive it) and carry a `TIP: …` chip in the label instead; legend rewritten (reviewed
  sip_trunk / reviewed sip_server / pending, plus the TIP-chip row); edges re-sourced to
  `rollup__confirmed_contacts_daily` with note ② rewritten for what that view now carries. Sankey:
  the peer role column is `review__ip_roles.accepted_role` for confirmed rows only, and the
  monitored-node colour map is empty for the same reason.
- **Geo** — rebuilt on `review__sip_pairs` ⋈ `lookup__ip_identities` (Oct 15): 155 pairs, 32
  sip_trunk / 54 sip_client / 39 sip_scanner / 30 unclear, 84 human-confirmed; trunk media
  421 MB to 7 countries, 44% non-US (DE 100, CO 82), split 55% own-switches-abroad / 45% foreign
  carriers — now backed by `peer_is_hosting` on the pair rather than inferred from provider
  tables. Role chips use the new vocabulary; monitored diamonds are grey with the heuristic's
  proposal and any TIP label in the tooltip as text; the trunk table shows all 33 trunk-called
  pairs and flags the 5 a reviewer re-called sip_client and the 1 still pending. The weekly
  `flow__records` backfill mode is unchanged (no new data to add).
- **Top talkers** — "Confirmed-CVS link" → "Reviewed-role link", defined over `review__ip_roles`
  / `rollup__confirmed_contacts_daily` and never over OpenCTI labels. The 208.69.81–82.x pool is
  now 14 pending `unclear` rows in `review__ip_roles`.
- **Candidate review** — 20 pending ASN candidates (17 approved, 2 rejected since Oct 8) and a
  queue switcher strip across the four review tables (not wired; this is gotcha 13 made visible).
  The two example cards stay illustrative.
- **Domains / Domain detail** — "confirmed CVS" wording → "TIP label: criminal_voip_service";
  `peer_is_cloud` → `peer_categories ∋ cloud`.

### Gotchas and open questions this adds

15. **No watched IP has a reviewed role yet.** Everything the earlier mocks coloured red or
    orange came from OpenCTI labels; under the 2026-10-14 rule those are suggestions, and the
    watched-vantage review in `review__ip_roles` has not been done. Until it is, every monitored
    node is grey and the only machine-readable "what is this" is the heuristic's
    `proposed_role`. The heuristic and the TIP already disagree on which IP is the trunk
    (`216.126.227.152` proposed sip_trunk; `143.198.176.127` labelled sip_trunk but proposed
    sip_server). That disagreement is the first concrete queue item this project could raise.
16. **Per-IP freshness is invisible to the fleet-wide check.** `51.198.100.9` stopped at Oct 13
    18:22, nine hours before every other exporter, and nothing flagged it because the freshness
    check looks at `max(time)` across the fleet. A per-monitored-IP "last record" row on the
    Pipeline health page (or a per-IP probe in `ops/freshness.py`) would have shown it.
17. **`dashboard_app` narrowed.** The role survives the consolidation with INSERT/UPDATE on
    `review__asn_candidates` only; the provider-table grants went with the tables. Open question
    7 (is this repo that dashboard?) stands.
18. **Trunk media is now a pair-window number, not a 30-day one.** `review__sip_pairs.media_bytes`
    is measured over each pair's own window; the Geo KPI says so. A true 30-day figure still needs
    the `rollup__flow_daily` scan the Sankey does.

### Theme and a visualization idea, 2026-10-15

The mocks were re-skinned to a "galaxy map" theme (see `design/mockups/README.md`, "Theme") from
a Stellaris-style screenshot the analyst shared. While looking at it they raised a visualization
idea worth keeping: **the galaxy map as a model for the Flow graph.** Infrastructure categories as
coloured nebulae that *envelop* the IPs sitting in them (a provider's ASN or CIDR as a soft region,
coloured by `ref__providers.category`), IPs as stars, edges as the flows between them, and the
edge's brightness as magnitude — flow count — with width for bytes. That is a different visual
grammar from the current node graph (hand-laid nodes with a colour per class): the enclosing
region carries the classification, which frees node colour for something else (reviewed role,
say) and makes "this peer sits inside a bulletproof host's range" a spatial fact rather than a
legend lookup. Not built. What it needs from the data is already there for cloud/bph/satellite
peers (`ref__providers` has ASN or CIDR per row; `rollup__flow_daily` has `flow_count` and
`bytes_sum` per edge); the hull/region rendering is a d3 question (force layout with per-category
cluster forces, blurred convex hulls per category). Candidate for the next Flow graph tab.

**Two nebula modes, raised the same day (parked, not scheduled).** The analyst wants the map's
rendering to be switchable by click: nebulae as **ASN ownership** or as **infrastructure
relationships** (the OpenCTI graph: Infrastructure → domain → IP). Assessment against the data:

- *ASN mode is cheap and complete.* Every raw flow row carries `src_asn`/`dst_asn`, every
  identified peer has `lookup__ip_identities.asn`, and `ref__providers` maps ASN → category for the
  nebula colour. The only gap is the standing one: the rollups drop ASN, so the edge list comes
  from a `flow__records` scan until `peer_asn` is added upstream (gotcha 1/12).
- *Infrastructure mode is not hard to compute, it is sparse.* The OpenCTI graph this watchlist
  touches is small (the Oct 9 pull: ~47 Infrastructure objects, 15 domains, ~90 relationships
  across `consists-of`, `related-to`, `derived-from`, `resolves-to`, `part-of`), so a
  bounded-depth walk per IP is trivial. What makes it tough is semantics, not hops: which
  relationship types mean "belongs to" (`consists-of` yes; `related-to` is a judgment;
  `derived-from` between two IPs is an analyst pivot, not ownership) and in which direction. Only
  two watchlist IPs are `consists-of` an Infrastructure directly; most tracked IPs reach one only
  via a domain or another IP, and the thousands of peers reach none. So the map would show a few
  infrastructure nebulae around tracked IPs and open space everywhere else — which is itself the
  point: it draws where the TIP's knowledge ends.
- *Recommendation.* Build ASN mode first. For infrastructure mode, do not walk the graph at
  render time: precompute one derived-fact row per IP — nearest Infrastructure, the path
  (`OUTSIDERZ ← consists-of`, `M3 ← resolves-to panel.m3zapp.com`), hop count, with a 2-hop cap
  and an explicit relationship-type allowlist — in this project's own store. That is a
  textbook analysis-pillar table (`CLAUDE.md` §2 #3), it answers "what does this belong to" on
  Entity detail too, and it keeps OpenCTI labels in their place: the nebula is drawn from
  relationships, which are structure, not from labels, which are suggestions.

## Revision 2026-11-04 — the app on netflow-rollups' stabilized API

Plan and reasoning: [`plans/2026-11-04_api_currency_and_watchlist.md`](plans/2026-11-04_api_currency_and_watchlist.md).
Source of truth for what changed upstream: `netflow-rollups/docs/dashboard_notes/` (one note per
batch of API changes; read the newest before front-end work) and its `docs/api.md`.

### Rename key (old name in this doc → what it is now)

Source badges in the UI now name the **API route**, not the database object behind it, because the
objects were renamed or dropped twice.

| old | now |
|---|---|
| `monitored_ip`, `monitored_ips`, `monitored_ip_roles` (field and parameter) | `watched_ip`, `watched_ips`, `watched_ip_roles` (netflow-rollups step 21) |
| `rollup__provider_mix_daily` | `GET /rollup/provider-mix-daily` |
| `rollup__bph_contact_daily` | `GET /rollup/bph-contact-daily` (the provider mix filtered to `bph`) |
| `rollup__port_family_mix_daily` | `GET /rollup/port-family-mix-daily` |
| `rollup__unclassified_contacts_daily` | `GET /rollup/unclassified-contacts-daily` |
| `rollup__confirmed_contacts_daily` | `GET /rollup/confirmed-contacts-daily` |
| `rollup__flow_daily` / `rollup__flow_hourly` | `GET /rollup/flow-daily` / `/flow-hourly` (the read functions over the traffic-only rollups) |
| `review__sip_pairs` | `GET /review/sip-pairs`, rebuilt from `review__ip_relations`; its measurement fields can be null |
| a peer's `sip_trunk` / `sip_client`, and `operator`, `c2_victim`, `c2_operator`, `research` as *roles* | **relationships**: `GET /review/ip-relations` (ip, relation, other_ip) |

### What the values mean now

- The rollups hold traffic only. Categories, roles, relations and scanner hiding are applied when
  read, so a decision or a reference-list change reaches every past day at once (provider
  categories within 30 minutes). Scanner traffic is hidden **by date**: a verdict on day D hides
  that IP's traffic from D to D+30; an IP on a feed or curated list is hidden every day. Totals
  stepped about 1% when this switched on (2026-10-29 16:31 UTC).
- `peer_roles` and `pair_confirmed` include relations. `pair_confirmed` is true for any confirmed
  relation between the pair, not only SIP.
- A decision response's `rollups` field says when the decision shows (`"applied"`, or `"at the
  next peer classification, within 30 minutes"` for an ASN graduation); the UI shows it verbatim.
- A reference-list row its source dropped is closed, not deleted (`closed_at`); `/ref/providers`
  hides closed rows unless `include_closed=true`.

### What changed per screen

- **Watchlist** — redesigned. A **History** selector (7 days / 30 days / 90 days / all history)
  drives the port-scan and traffic columns; scan history exists from the first sweep
  (2026-10-02) and the rollups for 180 days, and the API's default of six days back was the only
  reason the page showed a week. "Call activity" (an RTP-only share) became **Traffic by port
  family**: a stacked bar over every family, hover a segment for its bytes and share, click the
  row for the per-family table (bytes, share, flows, days) — and the page sorts by total or by any
  one family. The **Port scans** column shows each source's latest fingerprint as a chip; hover
  for the services that hash stood for, click for the full facts, what appeared or disappeared
  against the run before it, and the source's raw record. BPH stays 30 days and unclassified
  peers 7 days (that route's rows run to tens of thousands over longer windows).
- **Entity detail** — the same window selector and fingerprint runs (the 10-day cap on the grid is
  gone), a **Review history** table (every suggestion, evaluation and decision on the IP's roles
  and relationships; `/review/ip-roles/{ip}/history`, `/review/ip-relations/{ip}/history`), and a
  **Scanner verdicts** card when the IP has any. An IP that is not on the watchlist (a peer, as
  Top talkers and the relationship cards link them) now gets a peer page — identity, scanner
  tiers and verdicts, roles and relationships, port scans, history — instead of an error.
- **Candidates** — a fourth queue, **Peer relationships** (`/review/ip-relations` and its
  decision route; 308 pending at the time). Since netflow-rollups step 7 these are no longer
  roles, so the Peer roles queue (which still holds the roles that stayed roles — 84 at the time,
  mostly reverse_proxy / forward_proxy / web_server) never listed them and nothing in the app could
  review them. Each card shows the rules' reasoning,
  the agent's verdict, the measured evidence, an optional note, and Confirm / Reject. ASN
  candidate evidence now shows the real count of other peers in the ASN (30 days).
- **Top talkers** — the By ASN view is built (`/rollup/flow-daily/top-asns`); it was blocked on a
  `peer_asn` column that has existed since netflow-rollups migration 0083. The Unclassified view
  matches candidates by ASN as well as by the triggering peer.
- **Overview, Flow graph, Geo, Netflow** — copy and badges only: "confirmed" means a role on
  either side or a confirmed relationship; Geo's role legend lists the relationship names an arc
  carries instead of lumping them into "unclear".

### Entity detail, 2026-11-10 — the hourly heatmap shows every port family

The 2026-11-04 request ("show all traffic, not just VoIP") reached the Watchlist column but not
the Entity detail heatmap, which kept a hard-coded three (`rtp_media`, `voip_signaling`,
`voip_admin`) out of what `/rollup/flow-hourly` already returned. Now "Call activity by hour —
7d" is **Traffic by hour**: one toggle per port family present for the IP in the window (all on
by default; a busy switch has 9 in a week, 20 over 90 days), a **Window** selector (7 / 30 /
90 days; not "all history", because the hourly rows are per peer and 180 days of them would pass
the route's 20,000-row cap), and a **Measure** switch, bytes or flows — bytes shows media and
bulk, flows makes ssh, telnet and signaling visible where one family is 99% of bytes. A cell is
the **average for that weekday and hour over the window** (the total divided by how many dates of
that weekday the window covers), so 7d and 90d read on one scale and the legend stays per hour.
30-day windows are fetched in 30-day chunks (90 days of the busiest IP is ~18,000 rows); a chunk
that fills the cap shows a warning. Owner's choices, 2026-11-10: every family, all on, switchable
bytes/flows, rename plus a window selector.

**Watchlist, same day — filter by tag.** A row of chips under the filter bar, one per tag on any
watched IP (`/watch/ips` `tags`; six today), `msk:*` first, each with the count of IPs that carry
it among those the IP filter leaves. Several selected means the IP must carry all of them. Tags
are OpenCTI labels: the chips filter on them, nothing is coloured or decided by them (the label
provenance rule above).

### Candidate review, 2026-11-10 — "not that; it is this, and this"

The review page had two answers for a proposed role, Confirm and Reject. netflow-rollups shipped
the third today (`POST /review/ip-roles/{ip}/decisions`, note `2026-11-10_role_decisions_route.md`),
and the Peer roles and Monitored IP roles cards now use it. One-click Confirm and Reject stay as
they were, on the single-role route. Each card gains **Decide several / add a role**: opened, it
lists every role of that IP still waiting for a human (confirm, reject or leave, default leave) and
an **Add a role** picker, and sends nothing until Submit, one request, all or nothing. The rules it
follows: a confirm on a role the IP has no row for in any status is an *assert*, and any assert makes
the one note required (Submit stays disabled and says why); the picker offers the vocabulary roles
whose `assertable` flag for the card's vantage is true and that are not `retired`, minus the ones
already confirmed or already listed, never `kind`; Reject is offered only where a row exists; `pairs`
is never sent and no role goes twice. **The model's alternative only stages.** Where the vocabulary
accepts it on this vantage, a button opens the panel with the card's role as reject and the
alternative as confirm; it is a proposal until the analyst submits, and nothing is coloured by it.
Where it cannot be asserted (`sip_client`, `sip_trunk` on a peer) or is not in the vocabulary
(`dependency`) it stays text with a one-line reason. A refusal is a 422 in either shape, a `detail`
string with one line per entry or a list of `{msg}` objects; the panel shows each line, says nothing
was written, and keeps the staged choices.

**Review history** shows "rejected in favour of `web_server`, `mail_server`" under a rejected entry
whose `replaced_by` is non-empty; nothing is grouped on this side. **ASN candidates** now have a
category select (from `/ref/provider-categories`, defaulting to the suggestion, flagged when it
differs) and Approve sends the selected one, closing the gap the 2026-11-09 plan named.

### Entity detail, 2026-11-10 — copy the IPs named in the findings

The Findings card's heading carries a count and a copy button ("3 IPs ⧉") when any finding's
`subject` is a bare IP address (on a monitored IP's page today that is `interactsh_polling`, whose
subject is the server polled; a `peer_regular_v1` row is filed under the peer with the monitored IP
as its subject, so it shows here only when the monitored IP is itself another one's regular peer; a
URL subject, even one whose host is an IP, is not counted). It copies those addresses one per line,
each once, newest finding first, from the same `/verdict/findings` rows the card lists. No count
and no button when no subject is an IP. One list for all rules together; not split per rule.

Noticed, not changed: the card is headed "Findings (90d)" but the page asks `/verdict/findings`
for the last 30 days (`from30`), limit 200.

### Watchlist, 2026-11-10 — ASN under the tags

Each row's first cell ends with a line under the tags: `AS14061 DIGITALOCEAN-ASN - DigitalOcean,
LLC · US`, from the `asn`, `asn_holder` and `country` of `/lookup/ip-identities/{ip}`, the call the
page already makes per monitored IP for reverse DNS. No new request.

**Measured 2026-11-10: 7 of 57 monitored IPs have it** (7 of 50 that morning; the watch set grew
by seven during the day). The others answer 404 ("no identity looked up"), and their rows say "ASN
not looked up". The cause was upstream's design, not an outage: the identity lookup
(`lookup/ip_identity_enrichment.py`) ran on the peers the role process recommends, so a monitored
IP had a row only when it was also looked up as another monitored IP's peer.

**Upstream built the fix the same day (netflow-rollups commit `4467389`), not yet deployed:** the
nightly port-scan sweep writes an identity row for each monitored IP it scans. Once it is deployed
and a sweep has run, this line fills in with no change here. The hover and the footnote were
reworded so they stay true after that: "no identity row for this IP yet", with no claim about
which lookups write one. No dashboard note covers this change upstream; the commit message is the
source.

### Watchlist, 2026-11-10 — shared peers

A column, "Shared peers (7d)", following the history selector like the traffic columns. A cell
reads `10 of 36`: 36 peers exchanged at least 2 flows with this monitored IP over the window, and
10 of them also exchanged at least 2 flows with another monitored IP, on any day of the window.
The hover gives the same pair with no minimum ("35 of 134"). The sort select gained "shared
peers".

- **Source:** `/rollup/flow-daily/shared-peers`, asked twice per window: `min_flows=2` for the
  cell, no `min_flows` for the hover. One row per monitored IP, so no cap applies and "All
  history" is as complete as 7 days (the route was added for this on 2026-11-10; before it the
  count was only computable in the browser from `/rollup/flow-daily`, and only at 7 days).
- **Why a minimum, and why 2:** with none, the count is mostly single-flow sweeps of the
  provider's address space (73% of shared contacts over 7 days, upstream's note of 2026-11-10).
  2 was the analyst's choice, 2026-11-10. It is one constant, `SHARED_MIN_FLOWS` in
  `Watchlist.tsx`.
- **A monitored IP with no counted contact has no row** in the answer; the page reads that as 0
  of 0.
- **What it counts that might surprise:** a peer that is itself monitored counts (the route's
  `exclude_watched` is left off); paused monitored IPs count; scanner traffic is hidden, as on
  every rollup route. Per-IP counts do not add up to pair counts.
- **Measured 2026-11-10, 7 days, `min_flows=2`:** 26 of 57 monitored IPs share at least one peer.
- **Not built:** which monitored IPs share peers with which (`/rollup/flow-daily/shared-peer-pairs`
  serves it; a candidate for clustering on the Flow graph), and a port-family filter (the route
  takes `port_family`, e.g. `voip_signaling`).

### Provider category `hosting`, 2026-11-10

netflow-rollups migration `0128` (commit `3734ffa`; built 2026-11-10, **deployed 2026-11-12**: the
migration ran at 13:33 UTC and the new API image serves from 13:34 UTC) splits `hosting` out of
`cloud`. `cloud` becomes a short list of very large platforms (Amazon,
Microsoft, Google, Oracle, Alibaba, Tencent, Huawei); `hosting` is every company that rents out
servers (DigitalOcean, Hetzner, OVHcloud and 69 other networks). Upstream measured about 69% of
the peers that read `cloud` over 30 days, with 94% of their connections, moving to `hosting`, on
past days too, because categories are joined when the data is read. No route, field or parameter
changes.

**What the dashboard has for it.** A colour, lime `#A3E635` (the analyst's to change), in the
three places categories are coloured or ordered by name:

- `src/lib/categories.ts` `CATEGORY_COLORS`: the chips on the Watchlist, Netflow and Top talkers
  pages and the Flow graph's node colours and legend swatches.
- `src/pages/Overview.tsx` `CATEGORY_COLORS`: the "traffic by peer category" bars.
- `src/pages/FlowGraph.tsx`: the legend list, `CLASS_ORDER` (right after `cloud`) and
  `CLASS_COLOR`, which drive the Sankey tab. Without the `CLASS_ORDER` entry the Sankey would file
  every `hosting` peer under unclassified.

**Everything else was checked and needs nothing** (2026-11-11). No page filters, sorts or
special-cases `cloud` by name; the only category named in logic is `unclassified`.

- The ASN candidate picker builds its options from `/ref/provider-categories` and adds the
  suggested category when the list lacks it, so `hosting` is choosable the moment upstream lists it.
- A peer in two categories: upstream sorts `peer_categories` alphabetically, the Flow graph's node
  graph colours a peer by the first and the Sankey by `CLASS_ORDER`. `bph` wins over `hosting` in
  both, as it did over `cloud`; a peer in both `cloud` and `hosting` draws as `cloud` in both.
- Freshness: the pages list whatever checks `/ops/freshness` returns, by name, so the new
  `providers_hosting` check shows without a change.
- Wording: the Top talkers footnote gave `cloud+bph` as its two-category example; it now reads
  "`bph` with `hosting` or `cloud`", true before and after.
- Left alone on purpose: "Bulletproof-hosting contact" on the Overview is the `bph` category, and
  `peer_is_hosting` on Candidate review is a flag on SIP pairs (upstream keeps it covering the
  same networks).

**How it was checked.** Before the migration (the live API, 2026-11-11 00:10 UTC:
`/ref/provider-categories` has no `hosting`, no row carries it): the Overview and the Flow graph
load and draw as before, and the Flow graph legend shows `hosting` with its lime swatch. After the
migration, simulated in the browser only by rewriting the API's answers on the way in (69% of
`cloud` peers renamed `hosting`, each `cloud` mix row split 94/6, `hosting` added to the category
list): the Watchlist's category chip, the Overview's bars, the Flow graph's nodes and Sankey bands
and the Top talkers chips all draw `hosting` in lime, `cloud` stays blue, and the candidate picker
offers `hosting`. Real rows: see "Seen on real rows" below.

**Noticed, not part of this:** `government`, `vpn` and `cellular_iot` have no colour of their own
(a grey chip, and on the Overview a fallback colour that repeats another category's), and none of
those three nor `educational` is in the Flow graph's legend or `CLASS_ORDER`, so the Sankey files
those peers under unclassified. The `reverse_proxy` keys are still there from the `cdn` rename.

**Seen on real rows, 2026-11-12** (from 14:00 UTC, after the deploy). Nothing drew grey, landed
under unclassified or broke, so no code changed. A fresh generation of the API client was identical
to the one in the tree.

- The API: `/ref/provider-categories` lists `hosting`. `/rollup/provider-mix-daily` carries it on
  all 72 days it holds (2026-08-09 to 2026-11-11; 2026-11-12 has no rows yet): 1,411.5 MB against
  187.0 MB for `cloud`. In 70 days of `/rollup/flow-daily`, `hosting` stands alone on 40,013 rows,
  `cloud` alone on 17,795, `bph` with `hosting` on 442; no peer is in both `cloud` and `hosting`,
  and `hosting` never pairs with a category that has no colour. (One day, 2026-10-25, hit the
  20,000-row limit, so these counts are a floor.)
- Overview, "Traffic touching each peer category — 7d": `hosting` 73.8 MB · 7% in lime, second
  after residential isp (872.0 MB · 84%); `cloud` 2.1 MB in blue. The card is one 7-day total, not
  a chart by day, so "on past days" was read from the API and seen on the dated pages below.
- Flow graph: the legend lists `hosting` after `cloud` with a lime ring. For `128.199.103.165` the
  node graph draws 15 lime and 4 blue peers. The Sankey tab (30 days) has a lime `hosting` class;
  its place in the column comes from the layout, `CLASS_ORDER` only decides which class a peer in
  two categories goes to.
- Watchlist: the dominant category is `hosting` for 34 of 57 IPs, `cloud` for 2.
- Netflow (3,000 rows, 2026-11-06 to 11-08 among them): 1,194 `hosting` chips, 251 `cloud`. Every
  row on DigitalOcean (AS14061, 942 rows), Hetzner (AS24940), OVH (AS16276), Vultr (AS20473) and
  Linode (AS63949) reads `hosting`; every row on Amazon (AS14618, AS16509), Google (AS15169,
  AS396982), Microsoft (AS8075), Oracle (AS31898) and Alibaba (AS45102) reads `cloud`.
- Top talkers: `hosting` chips in lime (the top peer, `37.187.146.93`, is one); no `cloud` peer is
  in the top 20.
- Entity detail: a peer's page shows "Provider categories" as plain text from
  `/lookup/ip-identities/{ip}`. `157.90.226.70` (Hetzner) and `37.187.146.93` (OVH) read `hosting`;
  `3.235.74.192` (Amazon) and `158.23.180.16` (Microsoft) read `cloud`. A peer with no identity row
  shows no category. A watched IP's own page has never shown provider categories.
- Candidate review, ASN candidates: 17 pending (16 suggested `cloud`, 1 `mobile`), `hosting` is in
  every category choice. Pointing AS393406 (DigitalOcean) at `hosting` shows "differs from the
  suggested cloud"; it was set back and no decision was sent.
- Pipeline health: a "providers hosting" card (the page draws underscores as spaces), OK, 30
  minutes old against a 36-hour limit.
- Console: no script error or warning on any page. The only lines are 404s for per-IP lookups
  that have no row (`/lookup/ip-identities/{ip}` on the Watchlist, Geo and Flow graph; `/watch/ips/{ip}`
  and the review lookups on a peer's page), which were there before `hosting`.
- The colour: lime reads clearly on the Overview bars and the chips. On the Flow graph legend it
  sits a few degrees of hue from the `sip_server` role swatch and the `icmp` edge colour, both of
  which get their colour from a hash of the name (`src/lib/colors.ts`).

### Candidate review, 2026-11-12 — tags and port scans of the IP under review

Finley's request: on the candidate review page, show the port scan data and every tag of the IP
the analyst is deciding on, so the decision does not need a second tab on the Entity page.

**What the page shows.** Every card in the Peer roles, Monitored IP roles and Peer relationships
queues now carries one block between its header and the rule's suggestion
(`src/components/IpReviewContext.tsx`):

- **Tags.** Every tag of the IP, as chips. `msk:*` tags are plain chips (they are what
  netflow-rollups itself reads); every other tag is a dashed chip, the same "OpenCTI label, an
  analyst's suggestion, read by no logic" chip as on the Watchlist. A tag never sets a role, a
  colour or a default in the decision controls: the label-provenance rule (2026-10-15) holds, and
  the reviewed role, the proposal and the tags stay three separate things on the card.
- **Port scans.** Per scan source (Shodan, Censys): the day of the latest scan, the number of
  services, and whether the fingerprint changed over the scans in its history; then the services of
  the latest scan as chips (port, transport, service, software, HTTP title), the first 14 with a
  count of the rest. "Scan history and full facts" opens the same fingerprint history as the
  Entity page (one chip per run of an unchanged fingerprint; click for the facts, the difference
  from the run before, and the raw response). A link goes to the IP's Entity page. The line
  "scanned because" names the trigger values of the scans read.
- **Relationships cards** also show the tags of the other side (`other_ip`) on one line. Its port
  scans are not shown: the decision is about `ip`, and all 16 `other_ip` values pending today are
  watched IPs with their own Entity page.

**Where it comes from.**

| On the card | Source | Notes |
|---|---|---|
| Tags of a watched IP | `/watch/ips` (`tags`) | One request for the whole page; `tags` mirrors every OpenCTI label of the observable. A paused IP says so. |
| Tags of an IP that is not watched | OpenCTI GraphQL, `stixCyberObservables` filtered on `value`, `objectLabel` | One request per 100 IPs, through the dev proxy with this project's own token. netflow-rollups serves tags only for watched IPs. |
| Port scans | `/lookup/host-scans?ip=…`, all time, `limit=1000` | One request per IP, sent only when the card comes within 400 px of the window, kept for the session. |

An IP that is in neither place reads "none — not on the watchlist and not an observable in
OpenCTI", and an observable without labels reads "an observable in OpenCTI with no labels";
neither is left blank.
An IP without a scan reads "No port scan of this peer. netflow-rollups scans a peer only after a
rule recommends it."

**Why one scan request per card and not one for the page.** `/lookup/host-scans` returns at most
1,000 rows, newest first, with no offset. Peer scans are 811 rows over 447 IPs all time today and
growing, and the watched sweep adds two rows per watched IP per day, so a page-wide read would
silently lose the oldest scans. Per IP the largest history today is 42 rows. Measured on the Peer
roles tab: 143 cards drawn, 5 scan requests before any scrolling.

**Measured today (2026-11-12).**

- Peer roles: 143 pending rows over 137 IPs; 130 of the 137 have at least one scan; none is watched.
- Monitored IP roles: 9 rows over 7 IPs; all 7 are watched and show their tags. The two cards
  read in full had scans from the daily sweep (`159.65.230.164`: 42 scans, Censys unchanged over
  20 scans since 2026-10-20, Shodan with 2 fingerprints; `209.38.44.23`: 1 scan).
- Peer relationships: 78 rows over 61 IPs; 21 of the 61 have a scan; 1 is watched.
- Of the 197 pending peer and relationship IPs, 3 are OpenCTI observables: `143.198.172.85`
  (watched: `msk:analyze`, `msk:voip_analysis`), and `147.182.136.219` and `142.93.8.58` (not
  watched; both carry `hostring:digital_ocean`, spelled that way in OpenCTI). The other 194 have
  no tag anywhere, which the card states.
- Every request the page sent returned 200 and it added no console line.

**Left as it was.** The ASN candidates queue: its subject is an ASN, not an IP, and only 1 of its
17 triggering peers has a scan.

**The fixed `msk:voip_analysis` chip, replaced the same day.** The Watchlist rows
(`src/pages/Watchlist.tsx`) and the Entity page header (`src/pages/EntityDetail.tsx`) drew a
fixed `msk:voip_analysis` chip on every watched IP, written when that was the only watch label.
The live `/watch/ips` tags say otherwise: all 57 watched IPs carry `msk:analyze`, and 17 of them
also carry `msk:voip_analysis`, so the chip was wrong on 40 rows and hid `msk:analyze` on all 57.
Finley asked for the real tags. Both places now draw the IP's own `msk:*` tags as plain chips,
then the other tags as dashed chips as before; the Entity page says "on the watchlist with no
tags" when there are none. Checked: the chips of all 57 Watchlist rows equal the `tags` of
`/watch/ips`; the Entity page of `159.65.230.164` shows `msk:analyze` alone and that of
`185.134.23.8` shows both.

**Seen while doing this, not changed.**

- Peer scans carry `trigger = recommended` (810 of 811 rows; the other is `api`). The OpenAPI
  description of the `trigger` filter does not list `recommended`. The page prints whatever value
  it gets, so nothing breaks; the note is for netflow-rollups' documentation.

### Entity detail, 2026-11-12 — dates and every hour on "Traffic by hour"

Finley's request, made from the Watchlist (the panel is on the Entity page a Watchlist row opens):
put the month/day next to the day of the week, and a number over every hour column.

- **Row labels.** Each weekday row now carries the UTC dates behind it, as month/day. Over 7 days
  a row is exactly one date (`Mon 11/09`). Over 30 or 90 days a row is the average of several
  dates, so the label gives the first and the last (`Mon 10/19–11/09`) and hovering it lists them
  all ("4 dates: 10/19, 10/26, 11/02, 11/09"). The line above the grid says which of the two
  readings applies.
- **Hour columns.** Every column has its hour, `00` to `23` (before: every third).
- **Cell tooltips** name the date over 7 days ("Mon 11/09 00:00 UTC · 52 B") and the number of
  dates averaged over longer windows.
- **Rows in date order, oldest first** (Finley, same day: "the days need to be in correct
  numerical order"). The first version kept Monday to Sunday, which over 7 days read
  Mon 11/09 … Thu 11/12, then Fri 11/06 … Sun 11/08. Rows are now sorted by the first date each
  weekday has in the window. Over 7 days that is plain date order ending today (on 2026-11-12, a
  Thursday: Fri 11/06 … Thu 11/12). Over 30 and 90 days the rows are still weekdays averaged
  over several dates, so they are ordered by their first date (30 days: Wed 10/14–11/11 …
  Tue 10/20–11/10); the top row is therefore the weekday the window starts on, and it moves
  from day to day.
- **Not changed.** Data, route (`/rollup/flow-hourly`) and the averaging are as before.
- Checked on `159.65.230.164` (7 and 30 days) and `185.134.23.8` (7, 30 and 90 days), at 1440 px
  and at the preview pane's width (columns 19 px wide, the two-digit hour needs 11 px).

### Watchlist and Entity detail, 2026-11-12 — the OpenCTI description of a watched IP

netflow-rollups now mirrors the description an analyst writes on the OpenCTI IPv4 observable
onto the watched IP's row (its migration `0129`; hourly reconcile) and serves it as
`description: string | null` on `GET /watch/ips` and `GET /watch/ips/{ip}`. No dashboard note was
written for it; the `GET /watch/ips` row of `netflow-rollups/docs/api.md` is the reference. The
client was regenerated (`WatchedIp.description`; nothing else in the spec changed).

- **One source.** The pages read the description from `/watch/ips`, never from OpenCTI directly,
  so there is no extra OpenCTI round trip and the two cannot disagree on screen. "Third source"
  above noted that every watchlist IP has an `x_opencti_description` that could be read over
  GraphQL; for watched IPs the mirror now answers that. Notes are still only in OpenCTI.
- **Provenance.** It is an analyst's words, like the TIP labels: display only, read by no logic,
  not filtered, not sorted, colouring nothing. The Watchlist search still matches on the IP only
  (tags are filtered by their own chips, not by the search), so the description was not added to
  it.
- **Watchlist.** Under the tag chips of each row, above the ASN line: two lines at most, the whole
  text on hover, and the whole text with its line breaks once the row is expanded (the same
  arrow that opens the traffic and port-scan detail).
- **Entity detail.** Under the tag chips of the header, the whole text with its line breaks, with
  the source badge `/watch/ips description`.
- **No description.** `null` (or only white space) draws nothing in a Watchlist row and "no
  description on the OpenCTI observable" on the Entity page; never the word "null".
- **Not done.** `IpReviewContext` (the tags and port scans block on Candidate review) keeps its
  own map of watched IPs and does not carry the description: neither page above reads its
  watched IPs through it. Showing it there too is a small addition if the reviewer wants the
  description beside the tags. Peers have no description; only watched IPs carry one.
- Checked against the live API on 2026-11-12: 57 watched IPs, all with a description (8 to 313
  characters, ten with line breaks), 28 rows cut to two lines. `103.205.131.82` (313 characters,
  three paragraphs) on both pages, collapsed and expanded. No row is null today, so the null
  case was checked by answering `description: null` for `46.8.227.73` inside the browser tab
  only (nothing was changed on the API): the row and the Entity header render cleanly.
- The repo has no test or lint script; `tsc --noEmit` and `npm run build` are the checks.

### Still open

- Pipeline health says scanner verdict counts and roles/providers last-write times are not
  available; `/verdict/scanners`, `updated_at` on the review rows and `last_seen` on
  `/ref/providers` now carry them. Not built.
- The Watchlist's "last record per IP" is still not servable (the raw flow records are not on
  the API).
- Watchlist identity lookups are one request per IP (404 for IPs with no identity row yet); a
  bulk route would remove the console noise.
