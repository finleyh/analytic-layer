# CVS Analyst Dashboard — mockups

Six screens, dark SOC-console aesthetic (IBM Plex Sans/Mono, `#0B0D10`
background): `Main.dc.html` (Overview), `Watchlist.dc.html` (Watchlist),
`FlowGraph.dc.html` (Flow graph), `EntityDetail.dc.html` (Entity detail),
`TopTalkers.dc.html` (Top talkers), `CandidateReview.dc.html` (Candidate
review). Open any of them directly in a browser; the nav links between
them work as plain relative links.

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
history and diffs from `scan_fingerprints`) are real. Still
illustrative: the candidate evidence blocks (both candidates were
already approved), the Watchlist-activity feed (no source table exists),
and the graph layout and its node notes. Treat these as visual reference
for building the real pages, not as a prototype to deploy.
