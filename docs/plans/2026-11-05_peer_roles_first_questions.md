# Questions for the owner, 2026-11-05

For [`2026-11-05_peer_roles_first_api_changes.md`](2026-11-05_peer_roles_first_api_changes.md).
Each has the default the plan uses if unanswered. Questions 1 to 3 change what gets built now;
4 to 6 are small; 7 can wait for upstream step 4.

## 1. Scope of this pass

Build Parts 1 and 2 now (step 1's changes, plus fallbacks for the renames and new role names
that are coming), and leave Parts 3 and 4 until netflow-rollups ships steps 4 and 5?

- **Default: yes.** Part 2 costs little and stops the `reverse_proxy` to `cdn` rename and the
  findings flood from breaking pages with no warning from the generated client.
- Alternative: Part 1 only, and take each later break as it comes.

## 2. A peer with several proposed roles, in the Peer roles queue

From tomorrow the model can propose two or three roles for one peer.

- **Default: one card per (peer, role), a peer's cards adjacent, each naming the peer's other
  proposed roles.** Each role keeps its own evidence, agent verdict and Confirm / Reject, which
  matches how upstream stores and decides them.
- Alternative: one card per peer with a Confirm / Reject row per role inside. Reads better as
  "what is this peer", but it is a rebuild of the card and its filters.

## 3. The Overview's "Pending review" numbers are low

`/review/queue` counts rows in `suggested` only. Rows the agent has already read
(`agentic_evaluation`) are also waiting for you and are not counted. Today it says 0 peer roles
and 61 peer relationships; the Candidates tabs show 90 and 118.

- **Default: the Overview shows both, labelled** ("90 awaiting you, 0 not yet agent-read"),
  computed from the lists.
- Alternative A: ask netflow-rollups to add the agent-read counts to `/review/queue`, and change
  nothing here until then.
- Alternative B: it is intended (the tile means "not yet pre-read"); only relabel it.

Is the `suggested`-only count deliberate upstream?

## 4. "Regular peers — first week" on Pipeline health

The measurement this card was built for restarted today: the prompt is new, and the relation
proposals it used to count are gone, so earlier days now show fewer proposals than they did.

- **Default: rename to "Regular peers review", mark 2026-11-05 as the first day of the
  roles-only prompt, keep earlier days visible.**
- Alternative: show only days from 2026-11-05.

## 5. The SIP pair rows still waiting in Peer relationships

61 rows from the pair ladder (10 `sip_client`, 6 `sip_trunk`, 45 `sip_scanner`) are pending. Upstream
will turn the client and trunk ones into role decisions (step 3) and withdraw the suggested rows
(step 5).

- **Default: leave Confirm / Reject as they are and add a note saying what will happen to them.**
  A pair you confirm now stands and is carried over.
- Alternative: hide or grey them out until step 3 so nobody spends time on them.

## 6. No dashboard note was written for this batch

`CLAUDE.md` names `netflow-rollups/docs/dashboard_notes/` as the inbound channel. For this build
upstream used the proposal's "What the dashboard has to do" section instead.

- **Default: record in `CLAUDE.md` that the proposal is the channel for the peer-review build.**
- Alternative: also have netflow-rollups write a note after steps 1, 4 and 5 (a change in that
  repo, not this one).

## 7. Later (step 4): where a derived relationship can be rejected

Upstream suggests a reject button per derived pair on the peer page and the watched IP page.

- **Default: those two pages only, with an optional note, as the relations queue does today.**
- Alternative: also from the Flow graph's selected-edge panel.
