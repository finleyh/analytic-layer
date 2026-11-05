# Plan, 2026-11-05: the UI after netflow-rollups' peer-review redesign

**Status, 2026-11-05: partly built, uncommitted.** Done: Part 1 items 1 and 2 (client
regenerated, Pipeline health shows peers per day and roles per peer; the card's title is unchanged
pending question 4) and Part 2 item 1 (`cdn` beside `reverse_proxy` in `categories.ts`,
`Overview.tsx` and `FlowGraph.tsx`'s `CLASS_ORDER` and `CLASS_COLOR`). That is Phase A of
`netflow-rollups/docs/plans/2026-11-05_cdn_rename_execution.md`, the condition its Phase C waits
on. The Flow graph's category legend never listed `reverse_proxy`, so it was left alone. The rest
is not started. Open questions for the owner are in
[`2026-11-05_peer_roles_first_questions.md`](2026-11-05_peer_roles_first_questions.md); each has
a default this plan uses if it goes unanswered.

Scoped against netflow-rollups at `dd23978` (2026-11-05 11:30, deployed: the live `/openapi.json`
carries the change) and this repo at `4a04c44`.

## What changed upstream since the app was last synced (2026-11-04 10:30)

| upstream commit | what | reaches the UI as |
|---|---|---|
| `dd23978` peer review step 1 | the model proposes **every role the evidence supports, never a relation**; `GET /review/ip-roles/peer-review` drops its relations union and gains `peers`; the model's relation entries were withdrawn through the writer (209 on 2026-11-04, 16 more on 2026-11-05); admission no longer skips a peer because it has a relation row | one new field, and several values that mean something different (Part 1) |
| `8b6f368`, `a829a7d` | decision records 0009 to 0011 accepted and a six-step build plan, `netflow-rollups/docs/proposals/peer_roles_and_derived_relations.md` | nothing yet; it announces the route changes of steps 2 to 5 (Parts 2 to 4) |
| `673b851` | rollup-lag freshness limit 5 h to 6 h | nothing: Pipeline health reads `max_age_seconds` from the API |

**The client diff is one field.** A client generated from the live spec differs from the
committed one only by `PeerReviewDay.peers` and two doc comments. No route was added, removed or
renamed. `npm run generate:client` will touch `types.gen.ts` and `sdk.gen.ts` and nothing else.

**No dashboard note was written for this batch.** `docs/dashboard_notes/` still ends at
`2026-10-29_steps_4_to_13.md`. The equivalent is the proposal's section "What the dashboard has
to do", which also says this repo gets a session after upstream steps 1, 4 and 5. This plan is
the step-1 session plus the preparation for the other two.

### Measured on the live API, 2026-11-05

- `/review/ip-relations`: 232 rows. Pending: `research` 50, `operator` 7 (rules, agent-read),
  and the SIP pair ladder's `sip_scanner` 45, `sip_client` 10, `sip_trunk` 6. Confirmed:
  `sip_client` 71, `sip_trunk` 43. No row carries a `peer_review` entry any more.
- `/review/ip-roles?vantage=peer`: 90 awaiting a human, all in `agentic_evaluation`; 80 of them
  from `peer_review`. One peer has two pending roles; none from the new prompt yet (today's
  05:00 run still used the old one), so several-roles-per-peer starts tomorrow.
- `/review/ip-roles/peer-review`: 20 (day, role) rows; `peers` is the same number on every row
  of a day (2026-11-05: `reverse_proxy` 4 + `web_server` 1 proposals, `peers` 5).
- `/review/queue`: `peer_roles` 0, `watched_roles` 0, `peer_relations` 61. It counts
  `status = 'suggested'` only, so it reports 0 peer roles while 90 wait for a human and 61
  relations while 118 do. Not caused by this change, but the Overview tile shows these numbers
  (question 3).
- `/rules/vocabulary`: no new role names yet; `peer_review` now reads "what a regular peer is:
  every role the evidence supports, or none".

## Part 1. Now: upstream step 1 has shipped

Small. One page gains a number, one queue gains grouping, the rest is copy.

1. **Regenerate the client.** `npm run generate:client`; expect the two-file diff above.
2. **Pipeline health, "Regular peers" card** (`src/pages/PipelineHealth.tsx:449`).
   - `proposals` now counts roles, not peers. Add a **Peers** tile: the sum of one `peers` value
     per day (it repeats on each role's row, so it must not be summed per row). Relabel the
     existing tile "Role proposals" and show roles per peer beside it.
   - Table: group by day, with the day and its `peers` shown once, roles beneath.
   - Copy: the card's blurb and the comment at `:443` say the process "proposes a role"; it
     proposes every role the evidence supports. Say that relation rows are no longer counted, so
     days before 2026-11-05 show fewer proposals than this card showed last week.
   - Title "first week": default is to rename it "Regular peers review" and mark 2026-11-05 as
     the first day under the roles-only prompt (question 4).
   - Badge reads `review__ip_roles/peer-review`; make it the route, `/review/ip-roles/peer-review`.
3. **Candidates, Peer roles queue** (`src/pages/CandidateReview.tsx`, `IpRoleQueue` and
   `IpRoleCard`). A row is already one (ip, role), so several proposals per peer already render
   as several cards. What is missing is seeing them as one peer:
   - sort so a peer's cards are adjacent (agent-read first, then by IP);
   - on each card, a line "also proposed for this peer: `web_server`, `mail_server`" with each
     one's status, from the rows already loaded;
   - the info box gains one sentence: roles are additive, each is confirmed or rejected by itself.
   Default is separate cards, not one merged card per peer (question 2).
4. **Peer-review evidence on a role card.** New rows carry `features = {proposal, context}`;
   rows written before today also carry `regular_of`. The generic grid renders `context` as raw
   JSON. Render it as four small facts instead (port scan in hand, dark, identity, findings n).
   No tooltip source exists for a process's features, so these labels are written here.
5. **Candidates, Peer relationships queue** (`src/components/RelationQueue.tsx`). Shape
   unchanged. Add one note above the list: every row here was written by a rule; the model no
   longer proposes relations, and the SIP pair rows will become role decisions upstream
   (question 5 asks whether to discourage deciding them meanwhile; default is no).
6. **Overview "Pending review" tile** (`src/pages/Overview.tsx:324`). Default: show what the API
   says and what is actually waiting, as two labelled numbers, using the role and relation lists
   (question 3). No change if the owner prefers to ask upstream to fix `/review/queue`.
7. **Docs.**
   - `docs/dashboard_requirements.md`: a "Revision 2026-11-05" section with the table above and
     the per-screen changes.
   - `CLAUDE.md` section 10, inbound channel: for the peer-review build the channel is the
     proposal's "What the dashboard has to do" and its route tables, since no note was written
     (question 6).
8. **Verify.** `tsc` and `vite build`; dev server with a screenshot of Pipeline health and both
   Candidates queues; `npm run generate:client` a no-op afterwards.

## Part 2. Now, so the next upstream steps do not break anything

Upstream steps 2 and 3 and the category rename change **names and volumes, not shapes**, so no
client regeneration will warn about them. Each item below is a fallback that is harmless today.

1. **Provider category `reverse_proxy` is being renamed `cdn`** (its own upstream session,
   before step 2). Hard-coded in `src/lib/categories.ts:9`, `src/pages/Overview.tsx:48`,
   `src/pages/FlowGraph.tsx:1804` and `:1813`. Add `cdn` beside `reverse_proxy` with the same
   colour and position; drop the old key after the rename lands. Without this the CDN category
   falls to the default colour and out of the Flow graph's class order.
2. **New role names** arrive with steps 2 and 3: `messaging_api`, `cdn_edge`,
   `package_registry`, `code_hosting`, `web_client`, `sip_gateway`; later the relation `uses`.
   - `CandidateReview.tsx:37` `SIP_ROLES`: add `sip_gateway`, so its card offers the SIP pairs.
   - `FlowGraph.tsx:32` `ICON_ROLES` and the marker switch at `:67`: `sip_gateway` shares the
     trunk glyph; the named-service roles get the hashed ring colour and no glyph until they
     have confirmed volume (the page's own rule, legend note 7).
   - Geo already hashes a colour for any unknown name; nothing to do.
3. **Peer-vantage `sip_client` / `sip_trunk` come back as role rows** (step 3), so they show in
   the Peer roles queue again while their pair rows are still in Peer relationships. The header
   copy at `CandidateReview.tsx:238` and the "isn't a SIP role" text at `:1150` describe the
   step-7 split; rewrite both to state the rule that survives every step: a role is what the box
   is, a relationship is between two IPs.
4. **Entity detail findings will flood** (`src/pages/EntityDetail.tsx:113`, `limit: 200`). From
   step 3 a watched switch gets one `sip_pair_v1` finding per pair per night, and from step 4
   one per derived relation. `143.198.172.85` has 73 pairs today, so it passes 200 rows on the
   third night and the card silently truncates. Group the card by rule with a count and the latest day, expandable, and
   say so when the limit is hit. The card's title says 90 d while the query asks for 30; make
   them agree.

## Part 3. After upstream step 4 (new routes; blocked until it ships)

Regenerate the client first; the list below is from the proposal's route tables and must be
re-read against `docs/api.md` on the day.

1. **Derived relations on the entity pages.** `PeerEntity.tsx` and `EntityDetail.tsx` call
   `GET /verdict/ip-relations/{ip}` beside `/review/ip-relations/{ip}`. A derived row shows the
   relation, the direction, the rule, the day, and **what it rests on** (the confirmed role, who
   decided it and when). Derived facts and reviewed rows stay visibly different, by the same rule
   as the label-provenance chips: a fact a rule wrote is not a decision a person made.
2. **Per-pair reject** on each derived row: `POST /review/ip-relations/{ip}/{relation}/{other_ip}/decision`
   with `reject` (works with no row from step 4). A confirm of a derived pair returns 409 and is
   not offered. A rejected derived pair shows as rejected with its note.
3. **SIP pair evidence moves** to `GET /verdict/sip-pairs` (`CandidateReview.tsx:919`);
   `confirmed_role` becomes `derived`. The checkboxes and the `pairs` body go
   (`:716` to `:721`, `:931` to `:946`, the note at `:1273`): confirming a peer's SIP role no
   longer confirms pairs, the derivation writes them the next morning at 08:15. The info box at
   `:742` says so.
4. **Copy that widens**: Flow graph legend (`FlowGraph.tsx:208`, `:1502`) "confirmed" becomes a
   confirmed role, a confirmed relationship or a derived one; Overview and Top talkers
   "excluded" notes (`exclude_confirmed` also drops peers with a derived relation); the
   Peer relationships queue lists fewer kinds (`operator`, the C2 relations).
5. **Vocabulary**: `uses` and the `relation` and `service` roots appear in `/rules/vocabulary`
   with no shape change; check the (?) tooltips pick them up.
6. **Entity detail findings** use the new `root` filter instead of Part 2's client-side grouping
   where it helps.

This pass has a deadline upstream cares about: `/review/sip-pairs` is retired in step 5 only
after this app has moved to `/verdict/sip-pairs`, and a night must run between steps 4 and 5.

## Part 4. After upstream step 5

- Regenerate; `listSipPairsReviewSipPairsGet`, `PairRef` and the `pairs` fields disappear from
  the client, and `tsc` proves nothing still uses them.
- `vpn_client` is retired with its rows kept: show it with a "retired" mark and its meaning from
  the vocabulary, wherever a role chip renders.
- Peer relationships loses the SIP pair rows (withdrawn upstream); remove Part 1's note about them.
- `docs/dashboard_requirements.md` and `CLAUDE.md`: the rename key gains
  `/review/sip-pairs` to `/verdict/sip-pairs` and "relationships are derived facts".

## Order and size

Parts 1 and 2 in one pass now: about a day of front-end work, no new routes, no behaviour an
analyst could act on wrongly. Part 3 is the real work (two entity pages, one decision control,
the SIP evidence move) and waits for upstream step 4. Part 4 is cleanup.

## Not in this plan

- The still-open item from 2026-11-04: Pipeline health's "not available from this API" note for
  scanner verdict counts and last-write times.
- A C2 relations change: upstream moves them to derived facts in a later calibration week.
