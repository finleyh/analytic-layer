# CVS Analyst Dashboard — mockups

Ten screens, dark SOC-console aesthetic (IBM Plex Sans/Mono, `#0B0D10`
background): `Main.dc.html` (Overview), `Watchlist.dc.html` (Watchlist —
IPs), `Domains.dc.html` (Domains — by owner / all / cross-links & gaps),
`Geo.dc.html` (Geo — an interactive world map of great-circle arcs from
each monitored IP to its peer countries, with a SIP-peer-roles mode and a
scrubbable weekly mode, role/IP filters, zoom, hover and a click-a-country
peer list; then per-IP stacked bars by peer country and provider class,
the weekly non-US trend, country tiles, trunk identities — the map uses
d3 v7, topojson-client and the world-atlas 110 m outline, vendored under
`vendor/` (395 KB total, no external requests; it falls back to
cdn.jsdelivr.net only if the local copies can't be reached, e.g. when the
file is opened somewhere relative paths don't resolve). For local viewing
with a server, `.claude/launch.json` has a `mockups` config —
`python3 -m http.server 8765 --directory design/mockups`),
`FlowGraph.dc.html` (Flow graph — the hand-laid node graph, plus a
**Sankey** tab: 30 days of SIP/VoIP bytes as peer class → peer IP →
monitored IP → port family, top 28 peers individual and the other ~5,800
collapsed per class, with filters, a min-link slider, hover tracing and
click-to-pin; d3-sankey vendored), `EntityDetail.dc.html` (Entity detail,
IP), `DomainDetail.dc.html` (Entity detail, domain), `TopTalkers.dc.html`
(Top talkers), `CandidateReview.dc.html` (Candidate review),
`PipelineHealth.dc.html` (Pipeline health — is the data behind every other
page still arriving: the four freshness checks as tiles with their limits,
the open stale episode split into "what the pipeline did" and "what the
upstream says", records ingested per hour for 7 days with the current gap
shaded, the puller's last 48 h of runs with records pulled per run, the
heads and watermarks of every stream, and all 21 scheduled flows with
their last run; built 2026-10-15 from `netflow-rollups`' `ops__*` tables,
`flow__records` and the Prefect API during a real upstream outage, so
every number on it is a real one). Open any of
them directly in a browser; the nav links between them work as plain
relative links. Geo data (2026-10-13) comes from netflow-rollups'
`sip_peer_candidates` / `sip_peer_identities` and a one-off
`flow_records` backfill — all live.

**History.** The first five were built 2026-10-08 on claude.ai's Design
canvas (https://claude.ai/artifact/X3BYdcRSddzPoy9RyNFrpq — that link now
shows the *previous* version) and exported as canvas files that needed
the canvas runtime (`support.js`, `<x-dc>`, `sc-if`/`sc-for`) to render
their interactive bits. On 2026-10-09 they were revised locally and
converted to standalone HTML — same visuals, same filenames, the handful
of interactive bits (tabs, segment toggles, node selection,
approve/reject) rewritten as a few lines of vanilla JS — so they render
anywhere. The `.dc.html` suffix is kept only to avoid churning links; the
canvas runtime is no longer referenced.

**What the 2026-10-09 revision changed, and why**, is written up in
[`../../docs/dashboard_requirements.md`](../../docs/dashboard_requirements.md)
under "Revision 2026-10-09". Short version: the seven views in
`netflow-rollups`' public schema were mapped onto the screens — a
Watchlist screen was added (three of the views are per-monitored-IP and
had no home), Top talkers gained an Unclassified tab, Entity detail got a
port-family "by plane" chart and a provider-mix chart, the Flow graph
corrected `216.126.227.152` to a monitored node, and every data card now
carries a small badge naming the view it reads from.

**Data.** Numbers and IPs are live 7d/30d aggregates pulled from the local
`netflow-rollups` database on 2026-10-09 — the 15 monitored IPs, their
tags, bytes, RTP share, BPH contact, unclassified-peer counts, the
per-day charts on Overview and Entity detail, the Unclassified
leaderboard, and everything portscan-related (the fingerprint-drift
card, the Watchlist Fingerprint column, and the Entity-detail hash
history and diffs from `scan_fingerprints`) are real. The domain data
(Overview strip, Watchlist Domains tab, Domain detail) is live from
`spoiler-alert.trashcollector.dev` on the same date. Still illustrative:
the candidate evidence blocks (both candidates were already approved),
the IP-side entries in the Watchlist-activity feed (no source table
exists; the domain-side entries are derived from real check history),
and the graph layout and its node notes. Treat these as visual reference
for building the real pages, not as a prototype to deploy.
