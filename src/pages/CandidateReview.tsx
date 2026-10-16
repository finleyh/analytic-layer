import { useEffect, useState } from "react";
import {
  listAsnCandidatesReviewAsnCandidatesGet,
  decideAsnCandidateReviewAsnCandidatesCandidateIdDecisionPost,
  listIpRolesReviewIpRolesGet,
  decideIpRoleReviewIpRolesIpDecisionPost,
  listSipPairsReviewSipPairsGet,
  flowDailyRollupFlowDailyGet,
  queueReviewQueueGet,
  type AsnCandidate,
  type IpRole,
  type SipPair,
  type ReviewQueue,
} from "../api/netflow-rollups-client";
import { formatBytes, formatShortDate, isoDate, daysAgo } from "../lib/format";

type Queue = "asn" | "peer" | "watched" | "sip";

const BTN_BASE: React.CSSProperties = {
  all: "unset",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 500,
  padding: "9px 18px",
  borderRadius: 6,
  textAlign: "center",
};
const BTN_REJECT: React.CSSProperties = {
  ...BTN_BASE,
  background: "#241518",
  color: "#E5484D",
  border: "1px solid #442025",
};
const BTN_APPROVE: React.CSSProperties = {
  ...BTN_BASE,
  background: "#153226",
  color: "#3DD68C",
  border: "1px solid #1E4D37",
};

function DecidedChip({ label, kind }: { label: string; kind: "approve" | "reject" }) {
  return (
    <span
      className="chip"
      style={
        kind === "approve"
          ? { background: "#153226", color: "#3DD68C", borderColor: "#1E4D37" }
          : { background: "#241518", color: "#E5484D", borderColor: "#442025" }
      }
    >
      {label}
    </span>
  );
}

export function CandidateReview() {
  const [tab, setTab] = useState<Queue>("asn");
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [asnPending, setAsnPending] = useState<number | null>(null);
  const [peerPending, setPeerPending] = useState<number | null>(null);
  const [watchedPending, setWatchedPending] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueReviewQueueGet({ throwOnError: true }).then((r) => {
      if (!cancelled) setQueue(r.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const TABS: { key: Queue; label: string; count: number | null }[] = [
    { key: "asn", label: "ASN candidates", count: asnPending },
    { key: "peer", label: "Peer roles", count: peerPending ?? queue?.peer_roles ?? null },
    { key: "watched", label: "Monitored IP roles", count: watchedPending ?? queue?.watched_roles ?? null },
    { key: "sip", label: "SIP pairs", count: queue?.unconfirmed_sip_pairs ?? null },
  ];

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: "0 0 4px 0", fontSize: 22, fontWeight: 600 }}>Candidate review</h1>
        <div style={{ fontSize: 13, color: "#6FA89E" }}>
          Four review queues, each backed by its own table and decision endpoint.
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
        <span style={{ fontSize: 11, color: "#6FA89E", marginRight: 4 }}>Queue</span>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="chip"
            style={{
              cursor: "pointer",
              border: "1px solid",
              ...(tab === t.key
                ? { color: "#E8FFF8", borderColor: "#3F9C8A", background: "#133A3C" }
                : { color: "#A6D8CD", borderColor: "#2B7266", background: "transparent" }),
            }}
          >
            {t.label} · <b>{t.count ?? "…"}</b>
          </button>
        ))}
      </div>

      {tab === "asn" && <AsnQueue onPendingCount={setAsnPending} />}
      {tab === "peer" && <IpRoleQueue vantage="peer" onPendingCount={setPeerPending} />}
      {tab === "watched" && <IpRoleQueue vantage="watched" onPendingCount={setWatchedPending} />}
      {tab === "sip" && <SipPairQueue />}
    </>
  );
}

// ---------- ASN candidates ----------

type Evidence = {
  monitoredIps: Set<string>;
  bytes: number;
  flows: number;
  days: Set<string>;
  portFamilies: Set<string>;
};
type AsnDecided = { decision: "approve" | "reject"; category?: string };

function AsnQueue({ onPendingCount }: { onPendingCount: (n: number) => void }) {
  const [candidates, setCandidates] = useState<AsnCandidate[] | null>(null);
  const [evidence, setEvidence] = useState<Map<number, Evidence>>(new Map());
  const [decided, setDecided] = useState<Map<number, AsnDecided>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await listAsnCandidatesReviewAsnCandidatesGet({
          query: { status: "pending", limit: 1000 },
          throwOnError: true,
        });
        if (cancelled) return;
        const rows = result.data.rows;
        setCandidates(rows);
        onPendingCount(rows.length);

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
  }, [onPendingCount]);

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
      setDecided((prev) => {
        const next = new Map(prev).set(candidate.id, {
          decision,
          category: decision === "approve" ? candidate.suggested_category : undefined,
        });
        onPendingCount((candidates ?? []).filter((c) => !next.has(c.id)).length);
        return next;
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <div
        className="info"
        style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, lineHeight: 1.5, color: "#C6EBE2", background: "#0F1A2B", border: "1px solid #1E3A5F", borderRadius: 8, padding: "12px 14px", marginBottom: 20 }}
      >
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
            <div className="card" style={{ padding: "22px 24px", opacity: d ? 0.55 : 1 }} key={c.id}>
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
                    <DecidedChip
                      kind={d.decision}
                      label={d.decision === "approve" ? `Approved → ref__providers · ${d.category}` : "Rejected"}
                    />
                  ) : (
                    <>
                      <button style={BTN_REJECT} onClick={() => void decide(c, "reject")}>
                        Reject
                      </button>
                      <button style={BTN_APPROVE} onClick={() => void decide(c, "approve")}>
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

// ---------- Peer roles / Watched roles (both review__ip_roles) ----------

type RoleDecided = { decision: "confirm" | "reject"; role?: string };

function IpRoleQueue({
  vantage,
  onPendingCount,
}: {
  vantage: "peer" | "watched";
  onPendingCount: (n: number) => void;
}) {
  const [rows, setRows] = useState<IpRole[] | null>(null);
  const [decided, setDecided] = useState<Map<string, RoleDecided>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setDecided(new Map());
    listIpRolesReviewIpRolesGet({ query: { vantage, status: "pending", limit: 1000 }, throwOnError: true })
      .then((r) => {
        if (cancelled) return;
        // "unclear" is the heuristic's catch-all, not a finding — nothing
        // for an analyst to confirm or reject, so it's filtered out rather
        // than shown as a no-op row.
        const actionable = r.data.rows.filter((row) => row.proposed_role !== "unclear");
        setRows(actionable);
        onPendingCount(actionable.length);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [vantage, onPendingCount]);

  async function decide(row: IpRole, decision: "confirm" | "reject") {
    setActionError(null);
    try {
      await decideIpRoleReviewIpRolesIpDecisionPost({
        path: { ip: row.ip },
        body:
          decision === "confirm"
            ? { decision: "confirm", role: row.proposed_role as "sip_server" | "sip_trunk" | "sip_client" | "unclear" }
            : { decision: "reject" },
        throwOnError: true,
      });
      setDecided((prev) => {
        const next = new Map(prev).set(row.ip, {
          decision,
          role: decision === "confirm" ? row.proposed_role : undefined,
        });
        onPendingCount((rows ?? []).filter((r) => !next.has(r.ip)).length);
        return next;
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <div
        className="info"
        style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, lineHeight: 1.5, color: "#C6EBE2", background: "#0F1A2B", border: "1px solid #1E3A5F", borderRadius: 8, padding: "12px 14px", marginBottom: 20 }}
      >
        <span>ⓘ</span>
        <span>
          <b style={{ color: "#4C8DFF" }}>Confirm writes to netflow-rollups.</b> It sets{" "}
          <span className="mono">accepted_role</span> on <span className="mono">review__ip_roles</span>{" "}
          and confirms the measured pairs whose role matches. Reject clears any prior accept and
          marks the row rejected — a reviewer may still correct it later (unlike ASN candidates,
          a role row isn't locked after a decision).
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
      {!rows && !error && <div style={{ color: "#6FA89E" }}>Loading…</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {rows?.map((row) => {
          const d = decided.get(row.ip);
          return (
            <div className="card" style={{ padding: "22px 24px", opacity: d ? 0.55 : 1 }} key={row.ip}>
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
                      {row.ip}
                    </span>
                    <span className="chip pend">proposed {row.proposed_role}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#6FA89E" }}>
                    {vantage === "peer" ? (
                      <>judged against {row.watched_ips} watched IP{row.watched_ips === 1 ? "" : "s"}</>
                    ) : (
                      <>watched IP</>
                    )}
                    {row.first_day && row.last_day && (
                      <>
                        {" "}
                        · {row.first_day} → {row.last_day}
                      </>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  {d ? (
                    <DecidedChip
                      kind={d.decision === "confirm" ? "approve" : "reject"}
                      label={d.decision === "confirm" ? `Confirmed · ${d.role}` : "Rejected"}
                    />
                  ) : (
                    <>
                      <button style={BTN_REJECT} onClick={() => void decide(row, "reject")}>
                        Reject
                      </button>
                      <button style={BTN_APPROVE} onClick={() => void decide(row, "confirm")}>
                        Confirm {row.proposed_role}
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
                {row.reasoning}
              </div>
              {Object.keys(row.features).length > 0 && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                    gap: 10,
                    background: "#0A2224",
                    border: "1px solid #133A3C",
                    borderRadius: 7,
                    padding: "12px 14px",
                    marginTop: 12,
                  }}
                >
                  <div style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 600, color: "#A6D8CD" }}>
                    Heuristic features
                  </div>
                  {Object.entries(row.features).map(([k, v]) => (
                    <div key={k}>
                      <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>
                        {k.replace(/_/g, " ")}
                      </div>
                      <div className="mono" style={{ fontSize: 13 }}>
                        {v === null || v === undefined
                          ? "null"
                          : typeof v === "object"
                            ? JSON.stringify(v)
                            : String(v)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {rows && rows.length === 0 && (
          <div className="card" style={{ padding: 20, color: "#6FA89E" }}>
            No pending {vantage} roles.
          </div>
        )}
      </div>
    </>
  );
}

// ---------- SIP pairs ----------

type PairDecided = { role: string };

function SipPairQueue() {
  const [pairs, setPairs] = useState<SipPair[] | null>(null);
  const [decided, setDecided] = useState<Map<number, PairDecided>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSipPairsReviewSipPairsGet({ query: { confirmed: false, limit: 1000 }, throwOnError: true })
      .then((r) => {
        if (!cancelled) setPairs(r.data.rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function confirm(pair: SipPair) {
    setActionError(null);
    try {
      await decideIpRoleReviewIpRolesIpDecisionPost({
        path: { ip: pair.peer_ip },
        body: {
          decision: "confirm",
          role: pair.role as "sip_server" | "sip_trunk" | "sip_client" | "unclear",
          pairs: [{ monitored_ip: pair.monitored_ip, peer_ip: pair.peer_ip }],
        },
        throwOnError: true,
      });
      setDecided((prev) => new Map(prev).set(pair.id, { role: pair.role }));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <div
        className="info"
        style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, lineHeight: 1.5, color: "#C6EBE2", background: "#0F1A2B", border: "1px solid #1E3A5F", borderRadius: 8, padding: "12px 14px", marginBottom: 20 }}
      >
        <span>ⓘ</span>
        <span>
          <b style={{ color: "#4C8DFF" }}>Confirming a pair decides the peer's role</b>, scoped to
          just this pair (<span className="mono">POST /review/ip-roles/&#123;ip&#125;/decision</span>{" "}
          with <span className="mono">pairs</span> restricted to this one). There's no separate
          "reject this pair" action in the API — rejecting would mean rejecting the peer's whole
          role, which is a bigger decision than one pair, so that action isn't offered here.
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
      {!pairs && !error && <div style={{ color: "#6FA89E" }}>Loading…</div>}

      {pairs && (
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
            <thead>
              <tr>
                <th>Monitored IP</th>
                <th>Peer IP</th>
                <th>Measured role</th>
                <th style={{ textAlign: "right" }}>Media bytes</th>
                <th>Window</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p) => {
                const d = decided.get(p.id);
                return (
                  <tr key={p.id}>
                    <td className="mono">{p.monitored_ip}</td>
                    <td className="mono">{p.peer_ip}</td>
                    <td>
                      <span className="chip pend">{p.role}</span>
                    </td>
                    <td className="num mono" style={{ textAlign: "right" }}>
                      {formatBytes(p.media_bytes)}
                    </td>
                    <td style={{ color: "#A6D8CD", fontSize: 12 }}>
                      {p.first_day} → {p.last_day} ({p.window_days}d)
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {d ? (
                        <DecidedChip kind="approve" label={`Confirmed · ${d.role}`} />
                      ) : (
                        <button style={BTN_APPROVE} onClick={() => void confirm(p)}>
                          Confirm {p.role}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {pairs.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: "#6FA89E" }}>
                    No unconfirmed SIP pairs.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
