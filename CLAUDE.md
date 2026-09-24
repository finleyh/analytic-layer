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

This project reads klocker (and whatever other data sets it is configured to read) — it does not modify data from the sources it reads. 

This project could read any number of data sources, apply logic conditions as rules, trigger some sort of action, so i didn't want to bury it in klocker. As I am still defining and deciding what this project SHOULD be, we are considering if visualization, data exploration, and triggering based on rules will be a part of this project.

**Open, flagged 2026-09-24:** whether "trigger some sort of action" ever means an *autonomous* action, or whether every rule/analysis outcome always lands in the human-reviewed queue first (§3, §8) before anything happens — explicitly still undecided, not defaulting to "always queued." Revisit before designing the action side of the rules layer.

**Also open, flagged 2026-09-24, not yet addressed**: this paragraph says exploration, rules, and visualization are still being *considered* as part of this project at all ("we are considering if... will be a part of this project"), while §2 presents essentially the same list as four settled pillars, just asking whether it's the *right shape* for them. Those are two different levels of "open" — worth confirming which one is actually true: is the question "should this project do these things," or "given it does these things, is this the right design for them"?

## 2. What this project is for

Four things (three named during the original planning session, plus analysis added
2026-09-24), suggested in this order — the shape changed as each one came up, so read
them in order rather than as a flat list. This is not necessarily a comprehensive or final
list — still open to review/recommendations on "is this the right approach?":

1. **Exploration.** Click-through, pivot-style investigation of source data —
   the reference point named during planning was VirusTotal Intelligence: not just
   dashboards, but the ability to follow a relationship from one entity to the next.
   Audience: a small analyst team (not just one person, not a large or unknown audience —
   worth guided/labeled views, not raw SQL for a stranger).
2. **A rules layer (Zen/JDM) that queues things for review.** Rules read facts (from any
   SQL, OpenSearch, or API this project is configured to read from) — a fact here means a
   value already sitting in a source, or a derived fact written by the analysis pillar
   below. When a rule's condition is met, the outcome is a queue entry — "if thing X, Y,
   and Z happen → enqueue it for review," explicitly compared to a SIEM during planning.
   An analyst reviews the queue and acts.

   (Rewritten 2026-09-24: the original text had a dangling sentence — "rules then monitor
   those" with no object — replaced above with "rules read facts, including derived facts
   from analysis." Finalized as one-shot context assembly, not continuous/streaming
   evaluation, consistent with §6's multi-source-rules model below.)
3. **Analysis** — confirmed as a real, distinct pillar 2026-09-24, not yet designed. Open-
   ended, agent-driven querying/classification over the sources this project reads, that
   produces *derived* facts (written to a table) for the rules layer (#2) to key off —
   distinct from Zen's deterministic rule evaluation. The concrete example that surfaced
   this (§7.1): "which peers look like servers vs. VoIP clients" is a judgment call an
   agent makes by looking at the data, not a boolean condition a rule can express directly;
   the rule is downstream of that judgment ("there is a new potential call client in the
   queue for actioning"), not a replacement for it. Undesigned: how an agent's output gets
   trusted/versioned/re-run, and how it differs operationally from a human's own exploration
   in pillar #1.
4. **TIP read/write, deliberately last.** Enrolling something found during analysis,
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

## 4. Data access: Trino as the federation layer, not bespoke connectors

Settled during planning, and it reshaped the design: **Trino is the federation layer**,
not a custom Python connector per source. This is not to say this platform should not consider
and design how it may need to rely on other sources of data like APIs or OpenSearch stacks.

**Resolved 2026-09-24**: this project's Trino is plain open-source Trino (confirmed, not
Starburst), so the Elasticsearch/OpenSearch connector applies cleanly — it ships with OSS
Trino, Apache 2.0, no paywall, no extra jar to source. "Everything is a Trino catalog, one
way or another" stands as the default: OpenSearch is just another catalog to register;
bespoke, non-Trino access is the fallback only for a source with no viable Trino connector
at all (some REST-only APIs). Applies to §2 pillar #3 (analysis) too: an agent's own data
access follows this same model, not a separate bespoke path.

- klocker will be registered as a Trino catalog (read-only Postgres role; klocker's side is
  done — see klocker `CLAUDE.md`/`DESIGN.md` §6, "the query surface is Trino").
- This project's own writable store is still up for design - currently considering a real Postgres — queue items, audit trail, its own
  knowledge tables, rule definitions — which is *also* registered as a Trino catalog, so
  it's queryable the same way as everything else. Writes go direct to it, never through
  Trino. If there is a better suggestion, I am open to considering/discussing.

- A pre-existing metadata database is already on the same Trino instance today
  (an existing catalog, referred to during planning as "metadatadb" — CC BINs, phone
  numbers, North American area codes). This project may query it as an enrichment source joined against data sets the project uses as sources for rule application.

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

**Tech choice confirmed open 2026-09-24** (resolves the §4/§5 conflict in the prior draft,
where §4 called it undecided and §5 asserted Postgres): nothing below is a commitment to
Postgres specifically. It's written against a relational store for concreteness because
that's the easiest way to sketch table shapes, and Postgres-registered-as-a-Trino-catalog
is the leading candidate (per §4's "also registered as a Trino catalog" requirement), but
alternatives haven't been ruled out. Rough shape, not final, and not tied to any specific
engine:

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

**Gap, flagged 2026-09-24**: this list has a slot for pillar #2's definitions (`rules`) but
nothing for pillar #3's (analysis) — whatever an agent's classification logic is made of
(prompt, config, model choice) has the same "how an agent's output gets
trusted/versioned/re-run" problem §2 already calls undesigned. Likely wants an analogous
table once pillar #3 has a shape, not solved here.

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
- Multi-source rules, **resolved 2026-09-24**: Zen never reaches into a second source
  mid-evaluation — the cross-source join happens *before* `evaluate()` is called. "If X in
  catalog 1 and Y in catalog 2" becomes one Trino query with a JOIN across catalogs (§4),
  producing one JSON context, then one `evaluate()` call against that context. Zen's
  "loader" concept (resolving which named decision graph to run) is unrelated to this —
  don't conflate the two. One-shot context assembly, not continuous/streaming correlation.
- OPA/Drools/DMN were considered and set aside for this project specifically because of the
  Python-native, zero-new-infrastructure story — not because they're worse tools in
  general. Worth re-reading the tradeoffs if requirements change materially (e.g. if
  business-readable DMN, vendor-neutral standardization, or Kogito's federation-friendly
  container model start to matter more than "no new stack").

## 7. First worked examples to build toward

Two concrete cases from planning — use these to prove the shape before generalizing. Note
these are no longer both "rules" per the §2/§6 reclassification: #1 is now the worked
example for the analysis pillar, #2 is the worked example for a Zen rule.

1. **Server vs. VoIP client, from `netflow_rollup__peer__summary`.** A rule that
   highlights which peers look like potential servers vs. potential VoIP clients, using
   facts already in klocker's rollup: `buckets`, `days_service_on_monitored` /
   `days_service_on_peer` / `days_both_sides` (which side(s) a peer's services were on,
   per day — the "multi-role legibility" facts), `bidirectional`, `top_volume`. This is
   the first rule named directly during planning — start here.

   **Reclassified 2026-09-24**: this is analysis (pillar #3 in §2), not a Zen rule — it's a
   judgment call over ambiguous signals, not a boolean condition. The proposed shape: an
   agent looks at the databases, queries them, performs the classification, and writes the
   result to a derived-fact table; a genuinely rule-shaped condition then reads *that*
   table ("this peer was just classified as a potential call client → enqueue it"). Keep
   this as the worked example for pillar #3 once that pillar gets designed, rather than
   trying to force it into a JDM decision table directly.

   ("DO agents" confirmed 2026-09-24 to mean AI/LLM agents, not e.g. DigitalOcean.)


2. **Tracked-C2-to-unknown-peer ownership check.** A rule over netflow peer facts, joined
   (via Trino) against `ownership_cidr`: does a peer talking to a tracked malware C2
   observable fall inside a known subsidiary/sister-company/customer range? This is the
   rule that proved the queue needs to be broader than observable-candidate triage — see §3.

   This is a clear rule use case - if condition, perform action.

## 8. Build sequence (agreed during planning — deliberately in this order) but now subject to re-review with the changes in the rest of this document.

1. Read access into klocker (via Trino) — mostly already true given klocker's own §6.
2. This project's own store (queue, audit, ownership knowledge, rule storage) — tech
   choice still open, see §5.
3. Zen evaluation loop — assemble context via Trino, evaluate, write queue entries on a hit.
4. The analyst app: exploration/pivot UI + queue review + dismiss/watch. Fully usable
   without TIP write — enrol/relabel buttons exist but aren't wired up yet.
5. TIP write layer, last — its own OpenCTI credential, built once real usage from step 4
   has shown what it actually needs to do.

**Not yet placed, flagged 2026-09-24**: the analysis pillar (§2 #3) isn't in this sequence
at all — it was added after this build order was agreed, and it doesn't obviously slot in
as a single step. It could run in parallel with 2/3 (its output tables are just another
thing rules read), or it could depend on 2 existing first (needs somewhere to write derived
facts). Revisit once the analysis pillar itself has a rough shape.

Explicitly rejected: building the TIP write layer early, or "just in case." Also rejected:
Grafana or any off-the-shelf BI tool as a permanent second surface — the custom app is
meant to absorb dashboards/network-graph visualization too (one surface for analysts, not
two), though the network-graph-specific need (e.g. Grafana's Node Graph or the ESnet
Network Map panel, which can be driven by a plain SQL query mapping src/dst/traffic
columns) is worth remembering as a reference for what the custom app's own visualization
needs to be able to do, not as a tool to actually deploy.

## 9. Open questions — do not silently assume answers to these

- **What is "the different source of data" carrying phone numbers/card data for Zen (or
  analysis) to read?** Named as real and separate from both klocker and the metadatadb
  during planning, never identified. The metadatadb (CC BINs, phone numbers, area codes) is
  the *classification* side; this unnamed thing is the *observed-data* side a rule — or,
  given §2 pillar #3 didn't exist yet when this was written, possibly an analysis agent —
  would cross-reference against it. Find out before building anything that assumes its
  shape.
- **Where does this project's own store actually run?** Same host as klocker? Its own
  container? Not discussed. (Updated 2026-09-24 to say "store" not "Postgres" — the engine
  itself is now open, see §5.)
- **`ownership_cidr.relationship`: fixed vocabulary or freeform?** See §5.
- **Build appetite** was answered as "not sure — want a rough shape/estimate first." This
  document *is* that rough shape. The honest read from planning: pieces 1–3 (read access,
  own store, Zen loop) are bounded and not too large; piece 4 (the analyst app,
  exploration + queue) is the open-ended one and the real cost driver; piece 5 (TIP write)
  is small in isolation but was deliberately deferred so its scope is defined by real usage
  rather than guessed up front. **Not yet accounted for, flagged 2026-09-24**: the analysis
  pillar's cost is unassessed — it's agent-driven and open-ended by nature (§2 #3), which
  suggests it could rival or exceed the analyst app as a cost driver, not sit quietly
  alongside pieces 1–3.

Settled, not open (captured here so it doesn't get re-litigated): repo is this one,
`analysis-layer`; auth model within the analyst app is "the small analyst team, all
equally" (no approval gate, actor recorded per action, same `X-Klocker-User`-style pattern
klocker already uses).

## 10. Explicit non-goals
- Not committing to a specific frontend framework, hosting model, or repo structure yet —
  none of that was discussed; don't let this document imply a decision that wasn't made.
