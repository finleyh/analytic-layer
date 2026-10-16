import { useEffect, useState } from "react";
import {
  listAsnCandidatesReviewAsnCandidatesGet,
  decideAsnCandidateReviewAsnCandidatesCandidateIdDecisionPost,
  flowDailyRollupFlowDailyGet,
  queueReviewQueueGet,
  type AsnCandidate,
  type ReviewQueue,
} from "../api/netflow-rollups-client";
import { formatBytes, formatShortDate, isoDate, daysAgo } from "../lib/format";

type Evidence = {
  monitoredIps: Set<string>;
  bytes: number;
  flows: number;
  days: Set<string>;
  portFamilies: Set<string>;
};

type Decided = { decision: "approve" | "reject"; category?: string };

export function CandidateReview() {
  const [candidates, setCandidates] = useState<AsnCandidate[] | null>(null);
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [evidence, setEvidence] = useState<Map<number, Evidence>>(new Map());
  const [decided, setDecided] = useState<Map<number, Decided>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [candidatesResult, queueResult] = await Promise.all([
          listAsnCandidatesReviewAsnCandidatesGet({
            query: { status: "pending", limit: 1000 },
            throwOnError: true,
          }),
          queueReviewQueueGet({ throwOnError: true }),
        ]);
        if (cancelled) return;
        const rows = candidatesResult.data.rows;
        setCandidates(rows);
        setQueue(queueResult.data);

        const from30 = isoDate(daysAgo(29));
        const to = isoDate(new Date());
        const evidenceEntries = await Promise.all(
          rows
            .filter((c) => c.triggering_peer_ip)
            .map(async (c) => {
              const flows = await flowDailyRollupFlowDailyGet({
                query: { peer_ip: c.triggering_peer_ip!, from: from30, to, limit: 20000 },
                throwOnError: true,
              });
              const ev: Evidence = {
                monitoredIps: new Set(),
                bytes: 0,
                flows: 0,
                days: new Set(),
                portFamilies: new Set(),
              };
              for (const r of flows.data.rows) {
                ev.monitoredIps.add(r.monitored_ip);
                ev.bytes += r.bytes_sum;
                ev.flows += r.flow_count;
                ev.days.add(r.day);
                ev.portFamilies.add(r.port_family);
              }
              return [c.id, ev] as const;
            }),
        );
        if (cancelled) return;
        setEvidence(new Map(evidenceEntries));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function decide(candidate: AsnCandidate, decision: "approve" | "reject") {
    setActionError(null);
    try {
      await decideAsnCandidateReviewAsnCandidatesCandidateIdDecisionPost({
        path: { candidate_id: candidate.id },
        body:
          decision === "approve"
            ? { decision: "approve", category: candidate.suggested_category }
            : { decision: "reject" },
        throwOnError: true,
      });
      setDecided((prev) =>
        new Map(prev).set(candidate.id, {
          decision,
          category: decision === "approve" ? candidate.suggested_category : undefined,
        }),
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  const pendingCount = candidates ? candidates.filter((c) => !decided.has(c.id)).length : 0;

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: "0 0 4px 0", fontSize: 22, fontWeight: 600 }}>Candidate review</h1>
        <div style={{ fontSize: 13, color: "#6FA89E" }}>
          {candidates ? (
            <>
              {pendingCount} pending · agentic ASN classification, nightly ·{" "}
              <span className="mono">review__asn_candidates</span>
            </>
          ) : (
            "Loading…"
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
        <span style={{ fontSize: 11, color: "#6FA89E", marginRight: 4 }}>Queue</span>
        <span
          className="chip"
          style={{ color: "#E8FFF8", borderColor: "#3F9C8A", background: "#133A3C" }}
        >
          ASN candidates · <b>{pendingCount}</b>
        </span>
        {queue && (
          <>
            <span className="chip" style={{ opacity: 0.55 }} title="Not wired yet">
              Peer roles · <b>{queue.peer_roles}</b>
            </span>
            <span className="chip" style={{ opacity: 0.55 }} title="Not wired yet">
              Watched roles · <b>{queue.watched_roles}</b>
            </span>
            <span className="chip" style={{ opacity: 0.55 }} title="Not wired yet">
              SIP pairs · <b>{queue.unconfirmed_sip_pairs}</b>
            </span>
          </>
        )}
        <span style={{ fontSize: 11, color: "#F5A623", marginLeft: 6 }}>
          only ASN candidates is wired up — the other three queues are read-only counts for now
        </span>
      </div>

      <div className="info" style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, lineHeight: 1.5, color: "#C6EBE2", background: "#0F1A2B", border: "1px solid #1E3A5F", borderRadius: 8, padding: "12px 14px", marginBottom: 20 }}>
        <span>ⓘ</span>
        <span>
          <b style={{ color: "#4C8DFF" }}>Approve writes to netflow-rollups.</b> It inserts the ASN
          into <span className="mono">ref__providers</span> under the chosen category and marks
          the row reviewed. Rollup rows re-materialize on the next refresh; older rows for this
          peer stay <em>unclassified</em> until then. Reject just marks the row.
        </span>
      </div>

      {error && (
        <div className="card" style={{ padding: 20, borderColor: "#5A2327", marginBottom: 20 }}>
          Failed to load from netflow-rollups' API: {error}
        </div>
      )}
      {actionError && (
        <div className="card" style={{ padding: 16, borderColor: "#5A2327", marginBottom: 20, fontSize: 13 }}>
          Decision failed: {actionError}
        </div>
      )}
      {!candidates && !error && <div style={{ color: "#6FA89E" }}>Loading…</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {candidates?.map((c) => {
          const ev = evidence.get(c.id);
          const d = decided.get(c.id);
          return (
            <div
              className="card"
              style={{ padding: "22px 24px", opacity: d ? 0.55 : 1 }}
              key={c.id}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: 12,
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <span className="mono" style={{ fontSize: 15, fontWeight: 600 }}>
                      AS{c.asn}
                    </span>
                    <span style={{ fontSize: 14, color: "#A6D8CD" }}>{c.org_name}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#6FA89E" }}>
                    → <span className="mono" style={{ color: "#4C8DFF" }}>ref__providers · {c.suggested_category}</span>
                    {c.country && <> · {c.country}</>}
                    {c.triggering_peer_ip && (
                      <>
                        {" "}
                        · triggered by <span className="mono">{c.triggering_peer_ip}</span>
                      </>
                    )}
                    {" · "}
                    {formatShortDate(c.discovered_at)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  {d ? (
                    <span
                      className="chip"
                      style={
                        d.decision === "approve"
                          ? { background: "#153226", color: "#3DD68C", borderColor: "#1E4D37" }
                          : { background: "#241518", color: "#E5484D", borderColor: "#442025" }
                      }
                    >
                      {d.decision === "approve"
                        ? `Approved → ref__providers · ${d.category}`
                        : "Rejected"}
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={() => void decide(c, "reject")}
                        style={{
                          all: "unset",
                          cursor: "pointer",
                          fontSize: 13,
                          fontWeight: 500,
                          padding: "9px 18px",
                          borderRadius: 6,
                          textAlign: "center",
                          background: "#241518",
                          color: "#E5484D",
                          border: "1px solid #442025",
                        }}
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => void decide(c, "approve")}
                        style={{
                          all: "unset",
                          cursor: "pointer",
                          fontSize: 13,
                          fontWeight: 500,
                          padding: "9px 18px",
                          borderRadius: 6,
                          textAlign: "center",
                          background: "#153226",
                          color: "#3DD68C",
                          border: "1px solid #1E4D37",
                        }}
                      >
                        Approve
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: "#C6EBE2",
                  background: "#0A2224",
                  border: "1px solid #133A3C",
                  borderRadius: 7,
                  padding: "12px 14px",
                }}
              >
                {c.reasoning}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 10,
                  background: "#0A2224",
                  border: "1px solid #133A3C",
                  borderRadius: 7,
                  padding: "12px 14px",
                  marginTop: 12,
                }}
              >
                <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#A6D8CD" }}>
                    Evidence — what the triggering peer actually did
                  </span>
                  <span className="src">rollup__flow_daily · 30d</span>
                </div>
                {ev ? (
                  <>
                    <div>
                      <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>
                        Monitored IPs touched
                      </div>
                      <div className="mono" style={{ fontSize: 13 }}>
                        {ev.monitoredIps.size}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>
                        Bytes / flows
                      </div>
                      <div className="mono" style={{ fontSize: 13 }}>
                        {formatBytes(ev.bytes)} / {ev.flows}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>
                        Days seen
                      </div>
                      <div className="mono" style={{ fontSize: 13 }}>
                        {ev.days.size} of 30
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>
                        Port families
                      </div>
                      <div style={{ fontSize: 12 }}>{[...ev.portFamilies].join(", ") || "—"}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>
                        Other IPs in ASN seen
                      </div>
                      <div style={{ fontSize: 12, color: "#6FA89E" }}>— needs ASN on a rollup</div>
                    </div>
                  </>
                ) : (
                  <div style={{ color: "#6FA89E", fontSize: 12 }}>
                    {c.triggering_peer_ip ? "Loading…" : "No triggering peer recorded."}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {candidates && candidates.length === 0 && (
          <div className="card" style={{ padding: 20, color: "#6FA89E" }}>
            No pending ASN candidates.
          </div>
        )}
      </div>
    </>
  );
}
