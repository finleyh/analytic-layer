import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  listIpRelationsReviewIpRelationsGet,
  decideIpRelationReviewIpRelationsIpRelationOtherIpDecisionPost,
  type IpRelation,
} from "../api/netflow-rollups-client";
import { CopyButton } from "./CopyButton";
import { BTN_APPROVE, BTN_REJECT, DecidedChip } from "./reviewControls";
import { IpReviewContext, IpTagChips, useIpTags, type IpTags } from "./IpReviewContext";
import { errorMessage } from "../lib/errors";

// The relations queue: statements about one IP *relative to another*, reviewed like
// a role. Since netflow-rollups step 7 an `operator`, `c2_victim`, `c2_operator` or
// `research` finding, and a peer's `sip_trunk` / `sip_client` / `sip_scanner`, is a row
// in /review/ip-relations -- (ip, relation, other_ip) -- not a role, so the Peer
// roles queue no longer lists them. `ip` is the peer; `other_ip` is the watched IP
// (or the C2 it is a victim of) the statement is about.

type Evaluation = { verdict?: string; alternative?: string | null; reasoning?: string; model?: string; evaluated_at?: string };
type Suggestion = { reasoning?: string; features?: Record<string, unknown>; first_day?: string; last_day?: string; alarm?: string | null };
type Bucket = "agree" | "disagree" | "unsure" | "unevaluated";

function bucket(r: IpRelation): Bucket {
  const v = (r.evaluation as Evaluation | null)?.verdict;
  return v === "agree" || v === "disagree" || v === "unsure" ? v : "unevaluated";
}

function relKey(r: IpRelation) {
  return `${r.ip}|${r.relation}|${r.other_ip}`;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : String(Math.round(v * 100) / 100);
  if (Array.isArray(v)) return v.length === 0 ? "—" : v.slice(0, 6).join(", ") + (v.length > 6 ? ` +${v.length - 6}` : "");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function RelationCard({
  row,
  decided,
  onDecide,
  tags,
  otherTags,
}: {
  row: IpRelation;
  tags: IpTags;
  otherTags: IpTags;
  decided: { decision: "confirm" | "reject"; rollups?: string } | undefined;
  onDecide: (row: IpRelation, decision: "confirm" | "reject", note: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const suggestions = row.suggestions as Record<string, Suggestion>;
  const evaluation = row.evaluation as Evaluation | null;
  const rules = Object.entries(suggestions);

  return (
    <div className="card" style={{ padding: "20px 24px", opacity: decided ? 0.55 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
            <Link to={`/entity/${row.ip}`} className="mono row-link" style={{ fontSize: 15, fontWeight: 600 }}>
              {row.ip}
            </Link>
            <CopyButton text={row.ip} label="Copy IP address" />
            <span className="chip pend">suggested {row.relation}</span>
            <span style={{ color: "#6FA89E", fontSize: 13 }}>of</span>
            <Link to={`/entity/${row.other_ip}`} className="mono row-link" style={{ fontSize: 14 }}>
              {row.other_ip}
            </Link>
            <CopyButton text={row.other_ip} label="Copy IP address" />
            {row.status === "agentic_evaluation" && (
              <span className="chip" style={{ color: "#4C8DFF", borderColor: "#1E3A5F" }}>
                agent-reviewed
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "#6FA89E" }}>
            {row.first_day && row.last_day ? `${row.first_day} → ${row.last_day} · ` : ""}
            {rules.length} rule{rules.length === 1 ? "" : "s"} · discovered {row.discovered_at.slice(0, 10)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          {decided ? (
            <DecidedChip
              kind={decided.decision === "confirm" ? "approve" : "reject"}
              label={decided.decision === "confirm" ? `Confirmed · ${row.relation}` : "Rejected"}
              detail={decided.rollups ? `rollups: ${decided.rollups}` : undefined}
            />
          ) : (
            <>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="note (optional)"
                style={{ background: "#0A2224", color: "#E8FFF8", border: "1px solid #2B7266", borderRadius: 6, padding: "7px 10px", fontSize: 12, width: 150 }}
              />
              <button style={BTN_REJECT} onClick={() => void onDecide(row, "reject", note)}>
                Reject
              </button>
              <button style={BTN_APPROVE} onClick={() => void onDecide(row, "confirm", note)}>
                Confirm {row.relation}
              </button>
            </>
          )}
        </div>
      </div>

      <IpReviewContext ip={row.ip} tags={tags} />
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, color: "#6FA89E", margin: "0 0 10px 15px" }}>
        <span style={{ flexShrink: 0 }}>
          Tags of <span className="mono">{row.other_ip}</span>, the other side:
        </span>
        <IpTagChips tags={otherTags} />
      </div>

      {rules.map(([rule, s]) => (
        <div key={rule} style={{ fontSize: 13, lineHeight: 1.5, color: "#C6EBE2", background: "#0A2224", border: "1px solid #133A3C", borderRadius: 7, padding: "10px 14px", marginBottom: 8 }}>
          <span className="mono" style={{ fontSize: 11, color: "#6FA89E" }}>
            {rule}
            {s.alarm ? ` · alarm: ${s.alarm}` : ""}
          </span>
          <div>{s.reasoning ?? "—"}</div>
        </div>
      ))}

      {evaluation && (
        <div style={{ fontSize: 13, lineHeight: 1.5, background: "#0A1F2A", border: "1px solid #1E3A5F", borderRadius: 7, padding: "10px 14px", marginBottom: 8 }}>
          <span
            style={{
              fontWeight: 600,
              color: evaluation.verdict === "agree" ? "#3DD68C" : evaluation.verdict === "disagree" ? "#E5484D" : "#F5A623",
            }}
          >
            Agent: {evaluation.verdict ?? "—"}
          </span>
          {evaluation.alternative ? <span style={{ color: "#A6D8CD" }}> · suggests {evaluation.alternative}</span> : null}
          <span style={{ color: "#6FA89E", fontSize: 11 }}>
            {" "}
            · {evaluation.model} · {evaluation.evaluated_at?.slice(0, 10)}
          </span>
          <div style={{ color: "#C6EBE2" }}>{evaluation.reasoning}</div>
        </div>
      )}

      {rules.some(([, s]) => s.features && Object.keys(s.features).length > 0) && (
        <>
          <button onClick={() => setOpen(!open)} style={{ all: "unset", cursor: "pointer", fontSize: 12, color: "#4C8DFF" }}>
            {open ? "▾" : "▸"} Evidence ({rules.reduce((n, [, s]) => n + Object.keys(s.features ?? {}).length, 0)} measured values)
          </button>
          {open &&
            rules.map(([rule, s]) => (
              <div
                key={rule}
                style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "6px 18px", marginTop: 8, fontSize: 12 }}
              >
                {Object.entries(s.features ?? {}).map(([k, v]) => (
                  <div key={k}>
                    <span style={{ color: "#6FA89E" }}>{k.replace(/_/g, " ")}</span> <span className="mono">{formatValue(v)}</span>
                  </div>
                ))}
              </div>
            ))}
        </>
      )}
    </div>
  );
}

export function RelationQueue({ onPendingCount }: { onPendingCount: (n: number) => void }) {
  const [rows, setRows] = useState<IpRelation[] | null>(null);
  const [decided, setDecided] = useState<Map<string, { decision: "confirm" | "reject"; rollups?: string }>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  const [verdict, setVerdict] = useState<Bucket | "">("");

  useEffect(() => {
    let cancelled = false;
    listIpRelationsReviewIpRelationsGet({ query: { limit: 1000 }, throwOnError: true })
      .then((r) => {
        if (cancelled) return;
        // Awaiting review, agent-read ones first (same ordering as the role queues).
        const actionable = r.data.rows
          .filter((x) => x.status === "suggested" || x.status === "agentic_evaluation")
          .sort((a, b) => (a.status === b.status ? 0 : a.status === "agentic_evaluation" ? -1 : 1));
        setRows(actionable);
        onPendingCount(actionable.length);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [onPendingCount]);

  const kindCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of (rows ?? []).filter((x) => !verdict || bucket(x) === verdict)) m.set(r.relation, (m.get(r.relation) ?? 0) + 1);
    return m;
  }, [rows, verdict]);
  const allKinds = useMemo(() => [...new Set((rows ?? []).map((r) => r.relation))].sort(), [rows]);
  // Every tag of both IPs of each relationship: one /watch/ips read, plus the TIP for the unwatched ones.
  const allIps = useMemo(() => (rows ?? []).flatMap((r) => [r.ip, r.other_ip]), [rows]);
  const tagsOf = useIpTags(allIps);
  const verdictCounts = useMemo(() => {
    const c: Record<Bucket, number> = { agree: 0, disagree: 0, unsure: 0, unevaluated: 0 };
    for (const r of (rows ?? []).filter((x) => !kind || x.relation === kind)) c[bucket(r)]++;
    return c;
  }, [rows, kind]);
  const visible = useMemo(
    () => (rows ?? []).filter((r) => (!kind || r.relation === kind) && (!verdict || bucket(r) === verdict)),
    [rows, kind, verdict],
  );

  async function decide(row: IpRelation, decision: "confirm" | "reject", note: string) {
    setActionError(null);
    try {
      const result = await decideIpRelationReviewIpRelationsIpRelationOtherIpDecisionPost({
        path: { ip: row.ip, relation: row.relation, other_ip: row.other_ip },
        body: { decision, note },
        throwOnError: true,
      });
      setDecided((prev) => {
        const next = new Map(prev).set(relKey(row), { decision, rollups: result.data.rollups });
        onPendingCount((rows ?? []).filter((r) => !next.has(relKey(r))).length);
        return next;
      });
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  const select = { background: "#0A2224", color: "#E8FFF8", border: "1px solid #2B7266", borderRadius: 6, padding: "6px 8px", fontSize: 12 } as const;

  return (
    <>
      <div
        className="info"
        style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, lineHeight: 1.5, color: "#C6EBE2", background: "#0F1A2B", border: "1px solid #1E3A5F", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}
      >
        <span>ⓘ</span>
        <span>
          <b style={{ color: "#4C8DFF" }}>Confirm writes to netflow-rollups.</b> A relationship is a statement about one IP
          relative to another — <span className="mono">(ip, relation, other_ip)</span> in{" "}
          <span className="mono">/review/ip-relations</span> — so a peer that is a <span className="mono">sip_trunk</span>{" "}
          for one switch is not necessarily one for another. Confirming labels only the traffic between that pair on every
          day of the rollups; the decision's own response says when it shows.
        </span>
      </div>

      {error && (
        <div className="card" style={{ padding: 20, borderColor: "#5A2327", marginBottom: 16 }}>
          Failed to load from netflow-rollups' API: {error}
        </div>
      )}
      {actionError && (
        <div className="card" style={{ padding: 16, borderColor: "#5A2327", marginBottom: 16, fontSize: 13 }}>
          Decision failed: {actionError}
        </div>
      )}
      {!rows && !error && <div style={{ color: "#6FA89E" }}>Loading…</div>}

      {rows && rows.length > 0 && (
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>Relationship</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="mono" style={select}>
              <option value="">all {(rows ?? []).filter((r) => !verdict || bucket(r) === verdict).length}</option>
              {allKinds.map((k) => (
                <option key={k} value={k}>
                  {k} ({kindCounts.get(k) ?? 0})
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>Agent verdict</span>
            <select value={verdict} onChange={(e) => setVerdict(e.target.value as Bucket | "")} className="mono" style={select}>
              <option value="">all</option>
              {(["agree", "disagree", "unsure", "unevaluated"] as Bucket[]).map((b) => (
                <option key={b} value={b}>
                  {b} ({verdictCounts[b]})
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {visible.slice(0, 100).map((row) => (
          <RelationCard
            key={relKey(row)}
            row={row}
            decided={decided.get(relKey(row))}
            onDecide={decide}
            tags={tagsOf(row.ip)}
            otherTags={tagsOf(row.other_ip)}
          />
        ))}
        {rows && visible.length === 0 && (
          <div className="card" style={{ padding: 20, color: "#6FA89E" }}>
            No pending relationships{kind || verdict ? " match these filters" : ""}.
          </div>
        )}
        {visible.length > 100 && (
          <div style={{ fontSize: 12, color: "#6FA89E" }}>
            Showing the first 100 of {visible.length}; filter by relationship or agent verdict to narrow.
          </div>
        )}
      </div>
    </>
  );
}
