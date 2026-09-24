# Analysis Layer — Project Brief

Extracted 2026-09-23 from a planning conversation with klocker about what belongs outside
it, copied in as this repo's starting `CLAUDE.md` on 2026-09-24. Treat everything below as
a first draft, not settled — split it into a proper `DESIGN.md` etc. as the project grows,
the way klocker's own docs are organized.

## 1. Why this is a separate project

klocker (a sibling repo) collects data on adversary vishing infrastructure, rolls it up
into facts, and writes its own database. As of 2026-09-22 it has no decision-and-reaction
layer, no rule engine, and never writes back to the TIP (OpenCTI) — permanently, by
design, not a phase-1 simplification. Its own docs name this project as the thing that
fills that gap, explicitly living outside its repository (klocker `CLAUDE.md`,
`DESIGN.md` §6, as of 2026-09-23).

This project reads klocker (and whatever else it needs) — it does not modify klocker, does
not duplicate klocker's schema, and does not get to relitigate klocker's boundary. If
something looks like it wants to live in klocker instead, it doesn't; that door is closed.

## 2. What this project is for

Three things, discovered in this order during planning — the shape changed as each one
came up, so read them in order rather than as a flat list:

1. **Exploration.** Click-through, pivot-style investigation of klocker's data —
   the reference point named during planning was VirusTotal Intelligence: not just
   dashboards, but the ability to follow a relationship from one entity to the next.
   Audience: a small analyst team (not just one person, not a large or unknown audience —
   worth guided/labeled views, not raw SQL for a stranger).
2. **A rules layer (Zen/JDM) that queues things for review.** Not klocker's removed
   rule engine reborn inside klocker — this is that engine, correctly homed. Rules read
   facts (from klocker and from whatever else this project knows), and when a rule fires,
   the outcome is a queue entry — "if thing X, Y, and Z happen → enqueue it for review,"
   explicitly compared to a SIEM during planning. An analyst reviews the queue and acts.
3. **TIP read/write, deliberately last.** Enrolling something found during analysis,
   stripping a label so MSK stops processing something — real, named needs — but the plan
   is to build read/explore/queue first and add TIP write only once real usage has shown
   what it actually needs to do. klocker's own OpenCTI key is read-only; this project needs
   its own, separately-scoped, write-capable credential — never klocker's.

## 3. The queue is broader than "candidate observable triage"

Important correction made during planning: a queue entry is not always "here's a new
observable, should it be enrolled." The concrete example that forced this: a tracked C2
server (already an observable) talks to a peer IP that is *not* tracked — and that peer
turns out to belong to a subsidiary, a sister company, or a customer. That's worth
triaging even though nothing about it is "propose this for enrollment." The right mental
model is closer to a SIEM alert than to the old `candidate` table: **something happened
involving tracked infrastructure, and a human needs to look** — the resolution might be
enrol, might be relabel, might be "notify someone outside this system entirely," might be
dismiss.

Queue actions confirmed during planning: enrol as observable (TIP write), dismiss with
reason, remove/change a TIP label. "Watch / keep for later" was discussed but not
explicitly confirmed — revisit.

## 4. Data access: Trino, not bespoke connectors

Settled during planning, and it reshaped the design: **Trino is the federation layer**,
not a custom Python connector per source.

- klocker is registered as a Trino catalog (read-only Postgres role; klocker's side is
  done — see klocker `CLAUDE.md`/`DESIGN.md` §6, "the query surface is Trino").
- This project's own writable store is a real Postgres — queue items, audit trail, its own
  knowledge tables, rule definitions — which is *also* registered as a Trino catalog, so
  it's queryable the same way as everything else. Writes go direct to it, never through
  Trino.
- A pre-existing classification database is already on the same Trino instance today
  (an existing catalog, referred to during planning as "metadatadb" — CC BINs, phone
  numbers, North American area codes). klocker will never query it; this project does.
- **Designed for growth, not a fixed list.** The explicit requirement from planning: "as I
  grow my data sets, I'll grow my sources I need rules against." Adding a new source later
  should mean registering one more Trino catalog, not touching a framework. This directly
  echoes klocker's own discipline (a collector's `plan`/`fetch`/`parse`/`normalise`
  contract, a pre-review module's declared `consumes`/`outputs`/`emits`) — the same "a
  second instance never edits the shared framework" rule, applied to knowledge sources.
- Federated SQL joins across catalogs are the answer to the one place an application-layer
  merge gets awkward — e.g. "every historical peer that ever fell in a known-customer
  range" is one query across two catalogs, not N round trips merged in Python.
- Zen itself still evaluates in Python (or whichever binding) against one JSON context per
  decision — Trino's job is assembling that context (and serving exploration/dashboard
  queries), not evaluating rules. Batch evaluation (many `{key, context}` pairs in one
  call) is the efficient way to run a rule over every peer/entity at once.

## 5. Own store — first-pass shape

Lives in this project's own Postgres, not klocker's. Rough shape, not final:

- **queue** — id, type, evidence (the assembled context that triggered it — keep it, don't
  just keep a pointer), source rule + version, status, created_at, resolved_at, resolved_by.
- **audit** — actor-stamped record of every action taken (same pattern as klocker's
  `analyst_action`: who, what, when, on what).
- **ownership_cidr** — knowledge about third-party network ownership. Shaped like
  klocker's own `refdata_cidr` (same technical problem — CIDR containment classification —
  different domain): `cidr` (inet, GiST-indexed on `inet_ops`), `relationship`, `label`,
  `source`, `active`. **Open**: whether `relationship` is a fixed vocabulary (subsidiary /
  sister_company / customer / partner / vendor — so rules can key off it cleanly) or
  freeform text until real categories emerge. Append-and-deactivate discipline, never
  UPDATE, matching klocker's refdata convention.
- **rules** — the JDM JSON documents themselves, however they end up stored (a table, or
  files in the repo — not decided).

## 6. Zen / rules specifics

- Engine: [GoRules Zen](https://github.com/gorules/zen) — MIT, Rust core, native Python
  bindings (`pip install zen-engine`), no server to run, no code to maintain beyond the
  rules themselves. Chosen explicitly *because* it avoids building/maintaining a rules
  engine — that was a hard requirement from planning ("I don't want to BUILD one").
- Authoring: start with the free hosted editor (`editor.gorules.io`) — build/simulate the
  decision table or graph, download the JDM JSON, commit it. Zero infra, and it's only
  used at authoring time (Zen's evaluator never talks to gorules.io at runtime). Move to
  self-hosting the open-source `jdm-editor` React component only if leaving the tailnet to
  author rules becomes a real friction, not up front on spec.
- Multi-source rules: Zen doesn't fetch data mid-evaluation — the calling code assembles
  one JSON context (via Trino, per §4) and hands the whole thing to `evaluate()`. Zen's
  "loader" concept is about resolving *which decision graph* to run by name (letting one
  graph reference a named sub-decision) — not a mechanism for reaching into a second data
  source during evaluation. Keep that distinction straight; it's an easy thing to conflate.
- OPA/Drools/DMN were considered and set aside for this project specifically because of the
  Python-native, zero-new-infrastructure story — not because they're worse tools in
  general. Worth re-reading the tradeoffs if requirements change materially (e.g. if
  business-readable DMN, vendor-neutral standardization, or Kogito's federation-friendly
  container model start to matter more than "no new stack").

## 7. First rules to build toward

Two concrete cases from planning — use these to prove the shape before generalizing:

1. **Server vs. VoIP client, from `netflow_rollup__peer__summary`.** A rule that
   highlights which peers look like potential servers vs. potential VoIP clients, using
   facts already in klocker's rollup: `buckets`, `days_service_on_monitored` /
   `days_service_on_peer` / `days_both_sides` (which side(s) a peer's services were on,
   per day — the "multi-role legibility" facts), `bidirectional`, `top_volume`. This is
   the first rule named directly during planning — start here.
2. **Tracked-C2-to-unknown-peer ownership check.** A rule over netflow peer facts, joined
   (via Trino) against `ownership_cidr`: does a peer talking to a tracked malware C2
   observable fall inside a known subsidiary/sister-company/customer range? This is the
   rule that proved the queue needs to be broader than observable-candidate triage — see §3.

## 8. Build sequence (agreed during planning — deliberately in this order)

1. Read access into klocker (via Trino) — mostly already true given klocker's own §6.
2. This project's own store (queue, audit, ownership knowledge, rule storage).
3. Zen evaluation loop — assemble context via Trino, evaluate, write queue entries on a hit.
4. The analyst app: exploration/pivot UI + queue review + dismiss/watch. Fully usable
   without TIP write — enrol/relabel buttons exist but aren't wired up yet.
5. TIP write layer, last — its own OpenCTI credential, built once real usage from step 4
   has shown what it actually needs to do.

Explicitly rejected: building the TIP write layer early, or "just in case." Also rejected:
Grafana or any off-the-shelf BI tool as a permanent second surface — the custom app is
meant to absorb dashboards/network-graph visualization too (one surface for analysts, not
two), though the network-graph-specific need (e.g. Grafana's Node Graph or the ESnet
Network Map panel, which can be driven by a plain SQL query mapping src/dst/traffic
columns) is worth remembering as a reference for what the custom app's own visualization
needs to be able to do, not as a tool to actually deploy.

## 9. Open questions — do not silently assume answers to these

- **What is "the different source of data" carrying phone numbers/card data for Zen to
  read?** Named as real and separate from both klocker and the metadatadb during planning,
  never identified. The metadatadb (CC BINs, phone numbers, area codes) is the
  *classification* side; this unnamed thing is the *observed-data* side a rule would cross-
  reference against it. Find out before building anything that assumes its shape.
- **Where does this project's own Postgres actually run?** Same host as klocker? Its own
  container? Not discussed.
- **`ownership_cidr.relationship`: fixed vocabulary or freeform?** See §5.
- **Build appetite** was answered as "not sure — want a rough shape/estimate first." This
  document *is* that rough shape. The honest read from planning: pieces 1–3 (read access,
  own store, Zen loop) are bounded and not too large; piece 4 (the analyst app,
  exploration + queue) is the open-ended one and the real cost driver; piece 5 (TIP write)
  is small in isolation but was deliberately deferred so its scope is defined by real usage
  rather than guessed up front.

Settled, not open (captured here so it doesn't get re-litigated): repo is this one,
`analysis-layer`; auth model within the analyst app is "the small analyst team, all
equally" (no approval gate, actor recorded per action, same `X-Klocker-User`-style pattern
klocker already uses).

## 10. Explicit non-goals

- Not a fork or extension of klocker. Never imports klocker's code, never writes to
  klocker's database.
- Not a replacement for klocker's own read models (`/status`, digest, infrastructure card,
  timeline) — those stay klocker's, reachable the way klocker's own docs describe.
- Not committing to a specific frontend framework, hosting model, or repo structure yet —
  none of that was discussed; don't let this document imply a decision that wasn't made.
