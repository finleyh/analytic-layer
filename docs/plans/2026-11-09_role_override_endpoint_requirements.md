# Requirements, 2026-11-09: deciding several roles of one IP in one request

**Status: draft for the owner, not yet sent to netflow-rollups.** This is analysis-layer's ask as
the caller. It says what the dashboard needs and why; how netflow-rollups builds it is its own
design. Four choices are the owner's (last section); each has the default this page assumes.

Read against netflow-rollups at `6d36944` and its live API on 2026-11-09.

## What the analyst wants

On a review card the system recommends a role. The analyst can confirm it or reject it. What is
missing is the third answer: **"not that; it is this, and this."** One action that turns down the
recommendation and records the analyst's own roles, any number of them, for the same IP.

## What exists today

`POST /review/ip-roles/{ip}/{role}/decision` already takes a role nobody proposed. A `confirm` on
a role with no row creates the row (`asserted: true`). So an override can be done today as one
reject plus one confirm per role. Three things make that a poor fit for a button:

1. **Each call is its own transaction.** If the reject lands and a confirm fails, the IP is left
   with the recommendation rejected and nothing in its place, and the card cannot say so honestly.
2. **The history does not connect them.** `review__decisions` gets one `rejected` entry and one
   `asserted` entry per role, with nothing saying they were one decision. "The model proposed
   `forward_proxy`, the analyst said `web_server`" cannot be counted afterwards, and that count is
   the tuning signal for a rule or a prompt.
3. **The dashboard cannot tell which roles may be asserted on which IP.** `/rules/vocabulary`
   marks `sip_client` and `sip_trunk` as `kind: relation`, yet both are valid roles on a watched
   IP. The only way to find out today is to send the request and read the 422.

The dashboard uses none of this yet: it offers Confirm and Reject on the proposed role only.

## Measured on the live API, 2026-11-09

- **Peer roles:** 106 rows wait for a human, all pre-read by the model. It disagrees with 55 and
  names an alternative on 36: `forward_proxy` to `web_server` 10, `reverse_proxy` to `web_server`
  9, `sip_server` to `sip_client` 4, `forward_proxy` to `offensive_tooling` 2, `sip_server` to
  `web_server` 2, `sip_server` to `sip_trunk` 2, others 7. Each of those is an override waiting
  to happen if the analyst agrees with the model.
- Six of the 36 alternatives (`sip_client`, `sip_trunk`) are names the vocabulary calls a
  relation, and one (`dependency`) is not in the vocabulary at all. A "use the alternative" button
  needs to know which of them the API will accept.
- **Watched roles:** 4 rows wait, the model disagrees with all 4 and names `offensive_tooling` in
  place of `web_server` on 2.
- 1 of 105 waiting peers has more than one proposed role. That number grows from here: since
  2026-11-06 the model names every role the evidence supports.
- 12 confirmed rows carry no suggestion, so they were asserted by hand, one call each (peer:
  `forward_proxy` 3, `ad_server` 2, `sip_server` 1; watched: `web_server` 3, `c2_server`,
  `sip_server`, `oast_client` 1 each).
- 3 peer rows are rejected; one has a note.

## Requirements

**R1. One request decides several roles of one IP.** The body is a list of entries, each a role
and `confirm` or `reject`, in any mix, plus the analyst's note. That one shape covers every case
the dashboard has:

| the analyst means | the request carries |
|---|---|
| not that, it is these | reject the proposed role, confirm one or more others |
| yes, and also this | confirm the proposed role, confirm another |
| this peer has three proposals: these two yes, that one no | one entry per proposal |
| none of these | reject each proposal |

**R2. All or nothing.** One transaction. Everything that can be refused is refused before the
first write, which is the writer's rule already. A refusal names every entry that is wrong, not
only the first.

**R3. Confirming a role with no row asserts it,** exactly as the single-role route does. Rejecting
a role with no row is refused, as today, and refuses the whole request.

**R4. What is refused.** A name that is not a role; a role that cannot be asserted on this IP's
vantage; a retired role being newly asserted; the same role twice in one request; an empty list.

**R5. The history can answer "what did the analyst choose instead".** Each role still gets its
own history entry, as today. In addition, the entries written by one request can be found
together, and a rejection made alongside confirmations says which roles replaced it, in a form
code can read. The test of this requirement: from the history alone, count per rule and per
agentic process how often its proposal was rejected and replaced, and by what.

**R6. The IP's history read shows it.** `GET /review/ip-roles/{ip}/history` returns whatever R5
adds, so the dashboard can render "rejected in favour of `web_server`, `mail_server`" without
parsing a note.

**R7. The response says what was written, per role:** the decision, whether the row was asserted,
the vantage, and for a SIP role what the single-role route reports today. `rollups` as today.

**R8. No `pairs` in the new body.** The peer-roles proposal drops `pairs` in its step 5; a new
route should not start out carrying it. A SIP role confirmed through this route gets the default
the single-role route applies when `pairs` is absent.

**R9. One writer, both paths.** The single-role route stays as it is, and the new route goes
through the same writer module, so a decision means the same thing whichever path made it and the
`review-ip-roles` skill can use the same function.

**R10. The model's reading is kept.** Deciding does not erase the row's `evaluation`, so the
dashboard can still show "the model said X, the analyst decided Y" on the row afterwards.

**R11. The dashboard can ask which roles are assertable.** Somewhere readable, per role: can it be
asserted on a watched IP, on a peer, both, or neither (a relation name, a retired role). The
vocabulary is the natural place, since the dashboard already loads it. Without this the role
picker offers choices the API will refuse.

**R12. It survives the peer-roles build.** A role added by the proposal's steps 2 and 3
(`cdn_edge`, `web_client`, `sip_gateway` and the rest) is assertable the day it lands with no
change to this route. Nothing here depends on `/review/sip-pairs`.

**R13. The contract is written down:** a row in `docs/api.md`, the contract test, and a note in
`docs/dashboard_notes/` when it ships, which is how this repo learns the route is live.

## Not asked for

- **Relationships.** The proposal's step 4 makes them derived facts with their own per-pair
  reject. An override for relationships belongs to that step.
- **ASN candidates.** The approve body already takes a `category`. The dashboard always sends the
  suggested one; that is this repo's gap and needs nothing upstream.
- **Who decided.** `decided_by` stays `api`. Naming the analyst is open question 3 in
  `docs/api.md` and is not reopened here.
- **Roles outside the vocabulary.** A new role needs a decision record upstream. Free text is not
  wanted.

## What analysis-layer builds once it ships

- An "Add a role" picker on each Peer roles and Watched roles card, listing the assertable roles
  for that vantage (R11), with as many picks as wanted and one Submit.
- "Use the model's alternative" where the pre-read names one the API accepts.
- One Submit for a peer with several proposals, in place of a decision per card.
- Independently, and available now: a category dropdown on the ASN approve button.

## Decisions for the owner

1. **Scope: the general list (R1), or a narrow "replace this role with these"?** Default: the
   general list. It is one route in place of two or three, and it also serves the several-roles
   peer, which the narrow form does not.
2. **R5's link: readable by code, or written into the note text?** Default: readable by code.
   That most likely costs netflow-rollups a column on `review__decisions` and a migration, and
   their rules then require the `docs/data_model.md` diff first and possibly a decision record.
   The note-text form costs nothing upstream and leaves the tuning count to string matching.
3. **Is a note required when a role is asserted?** Default: yes for an asserted role, optional
   otherwise. An asserted row has no rule's evidence behind it, so the note is the only record of
   why. Of today's 3 rejected peer rows, 2 have no note.
4. **When?** Default: now, ahead of the proposal's step 2. It is small, touches no rule, and the
   106 waiting rows are item 3 of their current plan (`docs/plans/2026-11-07_after_the_rename.md`),
   the review session this would serve. The alternative is to fold it into step 4, which already
   changes the review routes. The netflow-rollups session should say which it recommends and why.
