import { useEffect, useMemo, useState } from "react";
import {
  listAsnCandidatesReviewAsnCandidatesGet,
  decideAsnCandidateReviewAsnCandidatesCandidateIdDecisionPost,
  listIpRolesReviewIpRolesGet,
  decideIpRoleReviewIpRolesIpRoleDecisionPost,
  listSipPairsReviewSipPairsGet,
  flowDailyRollupFlowDailyGet,
  queueReviewQueueGet,
  vocabularyRulesVocabularyGet,
  type AsnCandidate,
  type IpRole,
  type SipPair,
  type PairRef,
  type ReviewQueue,
  type Vocabulary,
} from "../api/netflow-rollups-client";
import { formatBytes, formatShortDate, isoDate, daysAgo } from "../lib/format";
import { CopyButton } from "../components/CopyButton";

type Queue = "asn" | "peer" | "watched";

type RoleSuggestion = { reasoning?: string; features?: Record<string, unknown>; first_day?: string; last_day?: string; alarm?: string | null };

// review__ip_roles.evaluation (since netflow-rollups 0091): the
// role_evaluation agent's own read of a rule's suggested role — null
// until the agent has looked at the row at all, which is a distinct,
// fourth bucket from an explicit "unsure" verdict, not the same thing.
type VerdictBucket = "agree" | "disagree" | "unsure" | "unevaluated";

function verdictBucket(row: IpRole): VerdictBucket {
  const verdict = (row.evaluation as { verdict?: string } | null)?.verdict;
  return verdict === "agree" || verdict === "disagree" || verdict === "unsure" ? verdict : "unevaluated";
}

// ---------- Feature glossary, from netflow-rollups' own rules registry ----------
//
// GET /rules/vocabulary — built 2026-10-20 at this project's own request
// ("the dashboard's (?) icons," per netflow-rollups' docs/api.md) — replaces
// what used to be a hand-maintained copy of rule-module comments here. It's
// the authoritative source, regenerated from the rules themselves at
// import, so it can't drift the way a hardcoded copy already had (25 rules
// documented by hand vs. 45 live two days later).
//
// Shape: a feature is described once per *family* (vocabulary.families[].
// features), and a rule names which family it belongs to (vocabulary.rules[].
// family) — scoped that way, not by bare feature key, because the same key
// name (inbound_peers, forward_names, watched_ips) means different things
// in different families.
type Glossary = {
  ruleFamily: Map<string, string>;
  familyFeatures: Map<string, Map<string, string>>;
  roleMeaning: Map<string, string>;
  // A suggestion's key is sometimes an agentic process name instead of a
  // rule name (review/ip_roles/writer.py's suggest() accepts either) — the
  // new "regular peers" pipeline's proposals land under "peer_review", not
  // under any rule. nameDescription covers both so the header tooltip and
  // the "no glossary entry" badge don't misread a known process as
  // undocumented; ruleFamily stays rule-only since only rules have a
  // family's worth of per-feature descriptions behind them in this
  // registry — a process's own features fall back to the per-field
  // "unknown" dot, which is accurate: netflow-rollups doesn't describe a
  // process's features field-by-field yet, only its named inputs/outputs.
  nameDescription: Map<string, string>;
};

const EMPTY_GLOSSARY: Glossary = {
  ruleFamily: new Map(),
  familyFeatures: new Map(),
  roleMeaning: new Map(),
  nameDescription: new Map(),
};

function buildGlossary(vocabulary: Vocabulary): Glossary {
  const familyFeatures = new Map<string, Map<string, string>>();
  for (const family of vocabulary.families) {
    const features = new Map<string, string>();
    for (const feature of family.features) features.set(feature.name, feature.description);
    familyFeatures.set(family.path, features);
  }
  const ruleFamily = new Map<string, string>();
  const nameDescription = new Map<string, string>();
  for (const rule of vocabulary.rules) {
    ruleFamily.set(rule.name, rule.family);
    nameDescription.set(rule.name, rule.description);
  }
  for (const process of vocabulary.processes) {
    nameDescription.set(process.name, process.description);
  }
  const roleMeaning = new Map<string, string>();
  for (const role of vocabulary.roles) roleMeaning.set(role.name, role.meaning);
  return { ruleFamily, familyFeatures, roleMeaning, nameDescription };
}

function useGlossary(): { glossary: Glossary; error: string | null } {
  const [glossary, setGlossary] = useState<Glossary>(EMPTY_GLOSSARY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    vocabularyRulesVocabularyGet({ throwOnError: true })
      .then((r) => {
        if (!cancelled) setGlossary(buildGlossary(r.data));
      })
      .catch((err) => {
        // The page still works without it — every (?) icon just falls back
        // to its honest "no glossary entry" state.
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { glossary, error };
}

function featureDescription(glossary: Glossary, ruleName: string, featureKey: string): string | null {
  const family = glossary.ruleFamily.get(ruleName);
  if (!family) return null;
  return glossary.familyFeatures.get(family)?.get(featureKey) ?? null;
}

// Pulled out from under the generic grid and shown under the IP instead —
// forward_names/cert_names are domain evidence, not a stat, and as raw
// JSON they were the one thing actually overlapping neighboring cells
// (no spaces to wrap at). cert_names_resolving_here is folded into the
// same certificate-colored bucket as cert_names, deduped.
const NAME_FEATURE_KEYS = new Set(["forward_names", "cert_names", "cert_names_resolving_here"]);

function extractNames(suggestions: Record<string, RoleSuggestion>): { domains: string[]; certs: string[] } {
  const domains = new Set<string>();
  const certs = new Set<string>();
  for (const s of Object.values(suggestions)) {
    const forward = s.features?.forward_names;
    if (Array.isArray(forward)) for (const n of forward) if (typeof n === "string" && n) domains.add(n);
    for (const key of ["cert_names", "cert_names_resolving_here"]) {
      const v = s.features?.[key];
      if (Array.isArray(v)) for (const n of v) if (typeof n === "string" && n) certs.add(n);
    }
  }
  return { domains: [...domains].sort(), certs: [...certs].sort() };
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function formatFeatureValue(v: unknown): string {
  if (Array.isArray(v)) return v.length === 0 ? "—" : v.map(formatScalar).join(", ");
  return formatScalar(v);
}

// `text` is null when the glossary has nothing for this field — render it
// anyway, visibly marked unknown, rather than omitting the icon. A missing
// description should look like a gap, not disappear into "no icon here,"
// which is how a new rule's fields would otherwise go undocumented without
// anyone noticing (the UI has no drift test to catch it the way the API
// side will).
function InfoDot({ label, text }: { label: string; text: string | null }) {
  return (
    <button
      type="button"
      className={text ? "info-dot" : "info-dot unknown"}
      aria-label={text ? `What does ${label} mean?` : `No glossary entry yet for ${label}`}
    >
      ?<span className="info-tooltip">{text ?? "No description yet — this field isn't in the glossary."}</span>
    </button>
  );
}

function NamesList({ domains, certs }: { domains: string[]; certs: string[] }) {
  if (domains.length === 0 && certs.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 8 }}>
      {domains.map((n) => (
        <div key={`d:${n}`} className="mono" style={{ fontSize: 13, color: "#4C8DFF", wordBreak: "break-all" }}>
          {n}
        </div>
      ))}
      {certs.map((n) => (
        <div key={`c:${n}`} className="mono" style={{ fontSize: 13, color: "#2DD4BF", wordBreak: "break-all" }}>
          {n} <span style={{ fontSize: 10, color: "#6FA89E", fontFamily: "inherit" }}>(certificate)</span>
        </div>
      ))}
    </div>
  );
}

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
  const { glossary } = useGlossary();

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
    { key: "asn", label: "ASN candidates", count: asnPending ?? queue?.asn_candidates ?? null },
    { key: "peer", label: "Peer roles", count: peerPending ?? queue?.peer_roles ?? null },
    { key: "watched", label: "Monitored IP roles", count: watchedPending ?? queue?.watched_roles ?? null },
  ];

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: "0 0 4px 0", fontSize: 22, fontWeight: 600 }}>Candidate review</h1>
        <div style={{ fontSize: 13, color: "#6FA89E" }}>
          Three review queues, each backed by its own table and decision endpoint. SIP pair
          evidence for a role appears under its card — expand "Relationships" below.
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

      {/* All three queues stay mounted so their real, filtered pending counts
          load immediately — the tab badges would otherwise show the raw
          /review/queue totals until each tab had actually been clicked once. */}
      <div style={{ display: tab === "asn" ? undefined : "none" }}>
        <AsnQueue onPendingCount={setAsnPending} />
      </div>
      <div style={{ display: tab === "peer" ? undefined : "none" }}>
        <IpRoleQueue vantage="peer" onPendingCount={setPeerPending} glossary={glossary} />
      </div>
      <div style={{ display: tab === "watched" ? undefined : "none" }}>
        <IpRoleQueue vantage="watched" onPendingCount={setWatchedPending} glossary={glossary} />
      </div>
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
  const [asnFilter, setAsnFilter] = useState<string>("");

  const asnOptions = useMemo(
    () => [...new Set((candidates ?? []).map((c) => c.asn))].sort((a, b) => a - b),
    [candidates],
  );
  const visibleCandidates = useMemo(
    () => (asnFilter ? (candidates ?? []).filter((c) => String(c.asn) === asnFilter) : (candidates ?? [])),
    [candidates, asnFilter],
  );

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

      {candidates && candidates.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <label style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>Filter by ASN</label>
          <select
            value={asnFilter}
            onChange={(e) => setAsnFilter(e.target.value)}
            className="mono"
            style={{
              background: "#0A2224",
              color: "#E8FFF8",
              border: "1px solid #2B7266",
              borderRadius: 6,
              padding: "6px 8px",
              fontSize: 12,
            }}
          >
            <option value="">all {candidates.length}</option>
            {asnOptions.map((asn) => (
              <option key={asn} value={asn}>
                AS{asn}
              </option>
            ))}
          </select>
          {asnFilter && (
            <button
              onClick={() => setAsnFilter("")}
              style={{ all: "unset", cursor: "pointer", fontSize: 11, color: "#7FEFD6" }}
            >
              clear
            </button>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {visibleCandidates.map((c) => {
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
                        <CopyButton text={c.triggering_peer_ip} label="Copy IP address" />
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
                  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                  gap: "14px 18px",
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
                      <div style={{ fontSize: 12, overflowWrap: "anywhere" }}>{[...ev.portFamilies].join(", ") || "—"}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>
                        Other IPs in ASN seen
                      </div>
                      <div style={{ fontSize: 12, color: "#6FA89E", overflowWrap: "anywhere" }}>— needs ASN on a rollup</div>
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
        {candidates && candidates.length > 0 && visibleCandidates.length === 0 && (
          <div className="card" style={{ padding: 20, color: "#6FA89E" }}>
            No pending candidates for AS{asnFilter}.
          </div>
        )}
      </div>
    </>
  );
}

// ---------- Peer roles / Monitored IP roles (both review__ip_roles) ----------

type RoleDecided = { decision: "confirm" | "reject" };

function rowKey(row: IpRole): string {
  return `${row.ip}:${row.role}`;
}

function IpRoleQueue({
  vantage,
  onPendingCount,
  glossary,
}: {
  vantage: "peer" | "watched";
  onPendingCount: (n: number) => void;
  glossary: Glossary;
}) {
  const [rows, setRows] = useState<IpRole[] | null>(null);
  const [decided, setDecided] = useState<Map<string, RoleDecided>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ipFilter, setIpFilter] = useState<string>("");
  const [verdictFilter, setVerdictFilter] = useState<VerdictBucket | "">("");
  const [roleFilter, setRoleFilter] = useState<string>("");

  const ipOptions = useMemo(() => [...new Set((rows ?? []).map((r) => r.ip))].sort(), [rows]);
  // Each facet's counts (and its own "all N") are computed against rows
  // filtered by every OTHER active filter, not the raw unfiltered list —
  // otherwise picking a role leaves the verdict dropdown's numbers
  // describing a set of rows you can no longer actually see, which reads
  // as a bug the moment two filters are combined.
  const rowsForVerdictCounts = useMemo(
    () => (rows ?? []).filter((r) => (!ipFilter || r.ip === ipFilter) && (!roleFilter || r.role === roleFilter)),
    [rows, ipFilter, roleFilter],
  );
  const rowsForRoleCounts = useMemo(
    () =>
      (rows ?? []).filter(
        (r) => (!ipFilter || r.ip === ipFilter) && (!verdictFilter || verdictBucket(r) === verdictFilter),
      ),
    [rows, ipFilter, verdictFilter],
  );
  const verdictCounts = useMemo(() => {
    const counts: Record<VerdictBucket, number> = { agree: 0, disagree: 0, unsure: 0, unevaluated: 0 };
    for (const r of rowsForVerdictCounts) counts[verdictBucket(r)]++;
    return counts;
  }, [rowsForVerdictCounts]);
  // Counted, not just listed — with peer roles running to dozens of
  // distinct role names at real volume, the count is what tells an
  // analyst which one is worth a dedicated pass before they even pick it.
  const roleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rowsForRoleCounts) counts.set(r.role, (counts.get(r.role) ?? 0) + 1);
    return counts;
  }, [rowsForRoleCounts]);
  // The option list itself still spans every role ever seen (not just
  // ones with a nonzero count under the current ip/verdict filter) so
  // picking role then clearing verdict doesn't make options disappear —
  // only their counts move.
  const allRoleOptions = useMemo(() => [...new Set((rows ?? []).map((r) => r.role))].sort(), [rows]);
  const visibleRows = useMemo(
    () =>
      (rows ?? []).filter(
        (r) =>
          (!ipFilter || r.ip === ipFilter) &&
          (!verdictFilter || verdictBucket(r) === verdictFilter) &&
          (!roleFilter || r.role === roleFilter),
      ),
    [rows, ipFilter, verdictFilter, roleFilter],
  );

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setDecided(new Map());
    setIpFilter("");
    setVerdictFilter("");
    setRoleFilter("");
    listIpRolesReviewIpRolesGet({ query: { vantage, limit: 1000 }, throwOnError: true })
      .then((r) => {
        if (cancelled) return;
        // Awaiting review: suggested (a rule's input, not yet read by the
        // agent) or agentic_evaluation (the agent has read it — those come
        // first since they're ready for a human to act on).
        const actionable = r.data.rows
          .filter((row) => row.status === "suggested" || row.status === "agentic_evaluation")
          .sort((a, b) => (a.status === b.status ? 0 : a.status === "agentic_evaluation" ? -1 : 1));
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

  async function decide(row: IpRole, decision: "confirm" | "reject", pairs?: PairRef[]) {
    setActionError(null);
    try {
      await decideIpRoleReviewIpRolesIpRoleDecisionPost({
        path: { ip: row.ip, role: row.role },
        body: decision === "confirm" ? { decision: "confirm", pairs: pairs ?? null } : { decision: "reject" },
        throwOnError: true,
      });
      setDecided((prev) => {
        const next = new Map(prev).set(rowKey(row), { decision });
        onPendingCount((rows ?? []).filter((r) => !next.has(rowKey(r))).length);
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
          <b style={{ color: "#4C8DFF" }}>Confirm writes to netflow-rollups.</b> It moves this
          (ip, role) row in <span className="mono">review__ip_roles</span> to{" "}
          <span className="mono">confirmed</span> and confirms the measured pairs whose role
          matches — expand "Relationships" to see and veto which ones. Reject marks the row{" "}
          <span className="mono">rejected</span> — a reviewer may still correct it later (unlike
          ASN candidates, a role row isn't locked after a decision). Confirming or rejecting one
          role leaves this IP's other roles untouched.
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

      {rows && rows.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <label style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>Filter by IP</label>
          <select
            value={ipFilter}
            onChange={(e) => setIpFilter(e.target.value)}
            className="mono"
            style={{
              background: "#0A2224",
              color: "#E8FFF8",
              border: "1px solid #2B7266",
              borderRadius: 6,
              padding: "6px 8px",
              fontSize: 12,
            }}
          >
            <option value="">all {ipOptions.length}</option>
            {ipOptions.map((ip) => (
              <option key={ip} value={ip}>
                {ip}
              </option>
            ))}
          </select>
          {ipFilter && (
            <button
              onClick={() => setIpFilter("")}
              style={{ all: "unset", cursor: "pointer", fontSize: 11, color: "#7FEFD6" }}
            >
              clear
            </button>
          )}

          <label style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase", marginLeft: 8 }}>
            Filter by verdict
          </label>
          <select
            value={verdictFilter}
            onChange={(e) => setVerdictFilter(e.target.value as VerdictBucket | "")}
            className="mono"
            style={{
              background: "#0A2224",
              color: "#E8FFF8",
              border: "1px solid #2B7266",
              borderRadius: 6,
              padding: "6px 8px",
              fontSize: 12,
            }}
          >
            <option value="">all {rowsForVerdictCounts.length}</option>
            <option value="agree">agree ({verdictCounts.agree})</option>
            <option value="disagree">disagree ({verdictCounts.disagree})</option>
            <option value="unsure">unsure ({verdictCounts.unsure})</option>
            <option value="unevaluated">not yet evaluated ({verdictCounts.unevaluated})</option>
          </select>
          {verdictFilter && (
            <button
              onClick={() => setVerdictFilter("")}
              style={{ all: "unset", cursor: "pointer", fontSize: 11, color: "#7FEFD6" }}
            >
              clear
            </button>
          )}

          <label style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase", marginLeft: 8 }}>
            Filter by role
          </label>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="mono"
            style={{
              background: "#0A2224",
              color: "#E8FFF8",
              border: "1px solid #2B7266",
              borderRadius: 6,
              padding: "6px 8px",
              fontSize: 12,
            }}
          >
            <option value="">all {rowsForRoleCounts.length}</option>
            {allRoleOptions.map((role) => (
              <option key={role} value={role}>
                {role} ({roleCounts.get(role) ?? 0})
              </option>
            ))}
          </select>
          {roleFilter && (
            <button
              onClick={() => setRoleFilter("")}
              style={{ all: "unset", cursor: "pointer", fontSize: 11, color: "#7FEFD6" }}
            >
              clear
            </button>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {visibleRows.map((row) => (
          <IpRoleCard
            key={rowKey(row)}
            row={row}
            vantage={vantage}
            decided={decided.get(rowKey(row))}
            onDecide={decide}
            glossary={glossary}
          />
        ))}
        {rows && rows.length === 0 && (
          <div className="card" style={{ padding: 20, color: "#6FA89E" }}>
            No {vantage} roles awaiting review.
          </div>
        )}
        {rows && rows.length > 0 && visibleRows.length === 0 && (
          <div className="card" style={{ padding: 20, color: "#6FA89E" }}>
            No {vantage} roles match{ipFilter && <> {ipFilter}</>}
            {verdictFilter && <> · verdict: {verdictFilter}</>}
            {roleFilter && <> · role: {roleFilter}</>}.
          </div>
        )}
      </div>
    </>
  );
}

type Evaluation = { verdict?: string; alternative?: string | null; reasoning?: string; model?: string; evaluated_at?: string };

function IpRoleCard({
  row,
  vantage,
  decided,
  onDecide,
  glossary,
}: {
  row: IpRole;
  vantage: "peer" | "watched";
  decided: RoleDecided | undefined;
  onDecide: (row: IpRole, decision: "confirm" | "reject", pairs?: PairRef[]) => Promise<void>;
  glossary: Glossary;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pairs, setPairs] = useState<SipPair[] | null>(null);
  const [pairsError, setPairsError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const suggestions = row.suggestions as Record<string, RoleSuggestion>;
  const evaluation = row.evaluation as Evaluation | null;
  const { domains, certs } = extractNames(suggestions);

  async function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && pairs === null) {
      try {
        const query = vantage === "peer" ? { peer_ip: row.ip } : { monitored_ip: row.ip };
        const result = await listSipPairsReviewSipPairsGet({
          query: { ...query, limit: 1000 },
          throwOnError: true,
        });
        setPairs(result.data.rows);
        setChecked(new Set(result.data.rows.filter((p) => p.role === row.role).map((p) => p.id)));
      } catch (err) {
        setPairsError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  function togglePair(id: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDecide(decision: "confirm" | "reject") {
    const pairsPayload =
      decision === "confirm" && pairs
        ? pairs.filter((p) => checked.has(p.id)).map((p) => ({ monitored_ip: p.monitored_ip, peer_ip: p.peer_ip }))
        : undefined;
    void onDecide(row, decision, pairsPayload);
  }

  return (
    <div className="card" style={{ padding: "22px 24px", opacity: decided ? 0.55 : 1 }}>
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
            <CopyButton text={row.ip} label="Copy IP address" />
            <span className="chip pend" title={glossary.roleMeaning.get(row.role)}>
              suggested {row.role}
            </span>
            {row.status === "agentic_evaluation" && (
              <span className="chip" style={{ color: "#4C8DFF", borderColor: "#1E3A5F" }}>
                agent-reviewed
              </span>
            )}
          </div>
          <NamesList domains={domains} certs={certs} />
          <div style={{ fontSize: 12, color: "#6FA89E" }}>
            {vantage === "peer" ? "peer" : "watched IP"}
            {row.first_day && row.last_day && (
              <>
                {" "}
                · {row.first_day} → {row.last_day}
              </>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {decided ? (
            <DecidedChip
              kind={decided.decision === "confirm" ? "approve" : "reject"}
              label={decided.decision === "confirm" ? `Confirmed · ${row.role}` : "Rejected"}
            />
          ) : (
            <>
              <button style={BTN_REJECT} onClick={() => handleDecide("reject")}>
                Reject
              </button>
              <button style={BTN_APPROVE} onClick={() => handleDecide("confirm")}>
                Confirm {row.role}
              </button>
            </>
          )}
        </div>
      </div>

      {Object.keys(suggestions).length === 0 ? (
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: "#6FA89E",
            background: "#0A2224",
            border: "1px solid #133A3C",
            borderRadius: 7,
            padding: "12px 14px",
          }}
        >
          No rule currently sees this role — it would be asserted by hand.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {Object.entries(suggestions).map(([ruleName, s]) => (
            <div
              key={ruleName}
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: "#C6EBE2",
                background: "#0A2224",
                border: `1px solid ${s.alarm ? "#5A4423" : "#133A3C"}`,
                borderRadius: 7,
                padding: "12px 14px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    className="mono"
                    style={{ color: "#4C8DFF", fontWeight: 600, fontSize: 12 }}
                    title={glossary.nameDescription.get(ruleName)}
                  >
                    {ruleName}
                  </span>
                  {glossary.nameDescription.size > 0 && !glossary.nameDescription.has(ruleName) && (
                    <span
                      className="mono"
                      style={{ fontSize: 10, color: "#6FA89E", border: "1px dashed #3F9C8A", borderRadius: 4, padding: "0 5px" }}
                      title="This rule or process isn't in the glossary yet — its fields show without tooltips below."
                    >
                      no glossary entry
                    </span>
                  )}
                </span>
                {s.alarm && (
                  <span style={{ color: "#F5A623", fontWeight: 600, fontSize: 11 }}>⚠ {s.alarm}</span>
                )}
              </div>
              {s.reasoning && <div style={{ marginTop: 4 }}>{s.reasoning}</div>}
              {s.features &&
                Object.entries(s.features).filter(([k]) => !NAME_FEATURE_KEYS.has(k)).length > 0 && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                      gap: "14px 18px",
                      marginTop: 10,
                    }}
                  >
                    {Object.entries(s.features)
                      .filter(([k]) => !NAME_FEATURE_KEYS.has(k))
                      .map(([k, v]) => {
                        const desc = featureDescription(glossary, ruleName, k);
                        const label = k.replace(/_/g, " ");
                        return (
                          <div key={k}>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 5,
                                fontSize: 10,
                                color: "#6FA89E",
                                textTransform: "uppercase",
                              }}
                            >
                              {label}
                              <InfoDot label={label} text={desc} />
                            </div>
                            <div className="mono" style={{ fontSize: 13, marginTop: 3, overflowWrap: "anywhere" }}>
                              {formatFeatureValue(v)}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
            </div>
          ))}
        </div>
      )}

      {evaluation && (
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: "#C6EBE2",
            background: "#0F1A2B",
            border: "1px solid #1E3A5F",
            borderRadius: 7,
            padding: "12px 14px",
            marginTop: 10,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: "#A6D8CD", marginBottom: 4 }}>
            Agent assessment — one more opinion, not a decision
          </div>
          <div>
            <span
              className="mono"
              style={{
                fontWeight: 600,
                color: evaluation.verdict === "agree" ? "#3DD68C" : evaluation.verdict === "disagree" ? "#E5484D" : "#F5A623",
              }}
            >
              {evaluation.verdict}
            </span>
            {evaluation.alternative && <> — alternative: {evaluation.alternative}</>}
            {evaluation.model && <span style={{ color: "#6FA89E", fontSize: 11 }}> · {evaluation.model}</span>}
          </div>
          {evaluation.reasoning && <div style={{ marginTop: 4 }}>{evaluation.reasoning}</div>}
        </div>
      )}

      <button
        onClick={() => void toggleExpand()}
        style={{
          all: "unset",
          cursor: "pointer",
          fontSize: 13,
          color: "#7FEFD6",
          marginTop: 12,
          display: "inline-block",
        }}
      >
        {expanded ? "▾" : "▸"} Relationships{pairs ? ` (${pairs.length})` : ""}
      </button>

      {expanded && (
        <div style={{ marginTop: 10, overflowX: "auto" }}>
          {pairsError && (
            <div style={{ color: "#E5484D", fontSize: 13 }}>Failed to load relationships: {pairsError}</div>
          )}
          {!pairs && !pairsError && <div style={{ color: "#6FA89E", fontSize: 13 }}>Loading…</div>}
          {pairs && (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900, fontSize: 14 }}>
              <thead>
                <tr>
                  <th></th>
                  <th>{vantage === "peer" ? "Monitored IP" : "Peer IP"}</th>
                  <th>Measured role</th>
                  <th>Confirmed role</th>
                  <th style={{ textAlign: "right" }}>Sig days</th>
                  <th style={{ textAlign: "right" }}>RTP days</th>
                  <th style={{ textAlign: "right" }}>SIP/day</th>
                  <th style={{ textAlign: "right" }}>Media records</th>
                  <th style={{ textAlign: "right" }}>Media/SIP</th>
                  <th style={{ textAlign: "right" }}>Long calls</th>
                  <th style={{ textAlign: "right" }}>Rec/call (med)</th>
                  <th style={{ textAlign: "right" }}>P95 concurrency</th>
                  <th style={{ textAlign: "right" }}>Overnight</th>
                  <th>Country</th>
                  <th>Role</th>
                  <th>Window</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((p) => {
                  const otherIp = vantage === "peer" ? p.monitored_ip : p.peer_ip;
                  return (
                    <tr key={p.id} title={p.reasoning}>
                      <td>
                        <input
                          type="checkbox"
                          checked={checked.has(p.id)}
                          disabled={!!decided}
                          onChange={() => togglePair(p.id)}
                        />
                      </td>
                      <td className="mono" style={{ whiteSpace: "nowrap" }}>
                        {otherIp}
                        <CopyButton text={otherIp} label="Copy IP address" />
                      </td>
                      <td>
                        <span className="chip pend" style={{ fontSize: 11 }}>
                          {p.role}
                        </span>
                      </td>
                      <td style={{ color: p.confirmed_role ? "#3DD68C" : "#6FA89E", fontSize: 13 }}>
                        {p.confirmed_role ?? "—"}
                      </td>
                      <td className="num mono" style={{ textAlign: "right" }}>
                        {p.sig_days}
                      </td>
                      <td className="num mono" style={{ textAlign: "right" }}>
                        {p.rtp_days}
                      </td>
                      <td className="num mono" style={{ textAlign: "right" }}>
                        {p.sip_per_day_from_peer.toFixed(1)}
                      </td>
                      <td className="num mono" style={{ textAlign: "right" }}>
                        {p.media_records}
                      </td>
                      <td className="num mono" style={{ textAlign: "right" }}>
                        {p.media_per_sip?.toFixed(1) ?? "—"}
                      </td>
                      <td className="num mono" style={{ textAlign: "right" }}>
                        {p.long_calls ?? "—"}
                      </td>
                      <td className="num mono" style={{ textAlign: "right" }}>
                        {p.rec_per_call_median?.toFixed(0) ?? "—"}
                      </td>
                      <td className="num mono" style={{ textAlign: "right" }}>
                        {p.p95_concurrency ?? "—"}
                      </td>
                      <td className="num mono" style={{ textAlign: "right" }}>
                        {p.overnight_share !== null ? `${Math.round(p.overnight_share * 100)}%` : "—"}
                      </td>
                      <td style={{ fontSize: 13, color: "#A6D8CD" }}>{p.peer_country ?? "—"}</td>
                      <td style={{ fontSize: 12, color: "#6FA89E" }}>
                        {p.peer_is_consumer ? "consumer" : p.peer_is_hosting ? "hosting" : "—"}
                      </td>
                      <td style={{ fontSize: 13, color: "#A6D8CD", whiteSpace: "nowrap" }}>
                        {p.first_day} → {p.last_day}
                      </td>
                    </tr>
                  );
                })}
                {pairs.length === 0 && (
                  <tr>
                    <td colSpan={16} style={{ color: "#6FA89E" }}>
                      No measured pairs for this IP.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          <div className="note">
            Checked rows are sent as this decision's <span className="mono">pairs</span> — unchecked
            ones are left alone. Hover a row for its measured reasoning.
          </div>
        </div>
      )}
    </div>
  );
}
