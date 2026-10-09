# CVS Analyst Dashboard — mockups

Static reference export of the draft dashboard design, built 2026-10-08
on claude.ai's Design canvas: https://claude.ai/artifact/X3BYdcRSddzPoy9RyNFrpq

Five screens, dark SOC-console aesthetic (IBM Plex Sans/Mono, `#0B0D10`
background): `Main.dc.html` (Overview), `FlowGraph.dc.html` (Flow graph),
`EntityDetail.dc.html` (Entity detail), `TopTalkers.dc.html` (Top talkers),
`CandidateReview.dc.html` (Candidate review).

**These are not standalone pages.** Each one depends on the Design
canvas's own runtime (`<script src="./support.js">`, the `<x-dc>` /
`sc-if` / `sc-for` component machinery) to render its interactive state
— tab switching, node selection, approve/reject. Opened outside the
canvas, the static markup/CSS layout is still readable, but the
JS-driven bits won't do anything. Treat these as visual reference for
building the real pages, not as a prototype to deploy — all data in
them (IPs, bytes, ASNs) is invented for the mock, not pulled from the
actual `netflow-rollups` database.

The actual functional requirements extracted from these mocks — what
data each screen needs, what's buildable today vs. not, and the open
questions the mocks surfaced — are in
[`../../docs/dashboard_requirements.md`](../../docs/dashboard_requirements.md).
Read that first; come back to these files for layout/visual reference.
