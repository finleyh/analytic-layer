import { useEffect, useMemo, useState } from "react";
import {
  listAsnCandidatesReviewAsnCandidatesGet,
  decideAsnCandidateReviewAsnCandidatesCandidateIdDecisionPost,
  listIpRolesReviewIpRolesGet,
  decideIpRoleReviewIpRolesIpRoleDecisionPost,
  listSipPairsReviewSipPairsGet,
  flowDailyRollupFlowDailyGet,
  queueReviewQueueGet,
  type AsnCandidate,
  type IpRole,
  type SipPair,
  type PairRef,
  type ReviewQueue,
} from "../api/netflow-rollups-client";
import { formatBytes, formatShortDate, isoDate, daysAgo } from "../lib/format";

type Queue = "asn" | "peer" | "watched";

type RoleSuggestion = { reasoning?: string; features?: Record<string, unknown>; first_day?: string; last_day?: string; alarm?: string | null };

// ---------- Feature glossary ----------
//
// Sourced from netflow-rollups' own rule modules (dataclass field comments
// and function docstrings) as of 2026-10-20, not invented here — see
// rules/sip/watched.py, rules/sip/pairs.py, rules/web.py, rules/services.py
// and rules/c2.py. A few fields (the raw counters, the c2 peer features)
// have no documentation anywhere in that codebase; those entries are a
// best-effort description from the field name and surrounding context, not
// a quote. Scoped per rule_name, not per bare feature key, because the same
// key name (inbound_peers, forward_names, watched_ips) means different
// things in different rule families.
type FeatureGlossary = Record<string, string>;

const SIP_WATCHED_FEATURES: FeatureGlossary = {
  exposed_sip_ports: "SIP ports answering in the latest portscan fingerprint.",
  sip_in: "SIP packets to our SIP ports from non-scanner peers.",
  sip_out: "SIP packets we send to peers' SIP ports.",
  inbound_peers: "Distinct non-scanner peers sending SIP to us.",
  dialed_peers: "Distinct peers we send SIP to.",
  symmetric: "Every inbound peer is one we also dial.",
  src_ports_out: "Distinct source ports we use toward peers' SIP ports.",
  real_peers: "Distinct non-scanner SIP peers, either direction.",
  scanner_peers: "SIP peers classified as scanners in this run.",
  client_peers: "This run's measured pair roles for the IP: peers whose pair role is sip_client.",
  trunk_peers: "This run's measured pair roles for the IP: peers whose pair role is sip_trunk.",
  media_records: "RTP media records seen in the window.",
  max_concurrency: "Peak number of simultaneous calls (overlapping RTP port pairs, 5-minute buckets).",
  p95_concurrency: "95th-percentile simultaneous calls — less sensitive to one traffic spike than the max.",
  admin_flows: "web_admin flow records in the window.",
  https_signaled_peers:
    "Peers that carry media and HTTPS with this IP but (almost) no SIP-port traffic — the shape of a softphone whose signaling rides inside HTTPS (3CX's web client does this).",
  exposes_sip: "True if any SIP port answered in the latest fingerprint.",
  watched_ips: "Alias for real_peers in this rule family: distinct non-scanner SIP peers of this watched IP.",
};

const SIP_PAIR_FEATURES: FeatureGlossary = {
  window_days: "How many days of the lookback window this rule had data for.",
  sig_days: "Distinct days this pair had SIP signaling.",
  rtp_days: "Distinct days this pair had RTP media.",
  sip_packets: "SIP packets exchanged with this peer in the window.",
  media_records: "RTP media records exchanged with this peer.",
  media_bytes: "RTP media bytes exchanged with this peer.",
  sip_per_day_from_peer:
    "SIP packets per day the peer sends to this IP's signaling ports. A registering phone: tens a day from one port. An IP-auth trunk: a few. A gateway registering a rack of SIMs as separate accounts: hundreds or more.",
  sip_src_ports: "Distinct source ports the peer used toward this IP's signaling ports.",
  peer_country: "The peer's most common netflow country code.",
  tz_offset_hours:
    "The peer country's standard-time UTC offset — used to judge whether its traffic pattern looks like it sleeps at night in its own time zone.",
  avg_bytes_per_record: "Average bytes per RTP media record for this pair.",
  long_calls:
    "RTP port pairs with enough records to look like a call of roughly 10+ minutes — shorter calls are mostly invisible at this sampling rate.",
  rec_per_call_median: "Median RTP records per call (each call negotiates a fresh port pair).",
  rec_per_call_p90: "90th-percentile RTP records per call.",
  max_concurrency: "Peak number of simultaneous calls with this peer.",
  p95_concurrency: "95th-percentile simultaneous calls with this peer.",
  overnight_share: "Share of this pair's activity that falls overnight, in the peer's local time zone.",
  sibling_ips:
    "Other addresses in the peer's /24 seen with any watched IP in the window — CGNAT churn, a dynamic address, or a fleet of boxes.",
  peer_is_consumer: "The peer sits on a residential ISP or mobile network.",
  peer_is_hosting: "The peer sits on cloud, wholesale VoIP, or bulletproof-hosting infrastructure.",
  media_per_sip:
    "Media records per SIP packet. A chatty trunk can send 50+ SIP packets a day too, but it carries hundreds of media records per SIP packet where a phone carries a handful.",
  pair_roles: "This run's measured role(s) for the pair.",
  serves_watched_phones: "True if this peer is the switch a watched phone registers to.",
  watched_ips: "Distinct watched IPs this peer touches — a different count than the same-named field on a watched-vantage suggestion.",
};

const WEB_FEATURES: FeatureGlossary = {
  exposed_web_ports: "Web ports answering in the latest fingerprint, per source.",
  titles: "Distinct root-page titles seen across sources.",
  favicon_hashes: "Distinct favicon hashes seen across sources.",
  inbound_peers: "Distinct non-scanner peers connecting to its web ports.",
  inbound_records: "Inbound web-port records in the window.",
  inbound_bytes: "Inbound web-port bytes in the window.",
  outbound_peers: "Distinct hosts this IP connects to on web ports.",
  outbound_records: "Outbound web-port records in the window.",
  outbound_bytes: "Outbound web-port bytes in the window.",
  outbound_days: "Distinct days this IP connected out on a web port.",
  exposes_web: "True if any web port answered in the latest fingerprint.",
  panel_titles:
    "Root-page titles that look like a real page (a panel, a login page) rather than noise — an HTTP status, a stock default page, a directory listing, a PHP error.",
  relay_ratio:
    "Bytes out on web ports over bytes in. A proxy that fetches what it serves sits near 1; a server phoning home sits near 0.",
};

const SERVICE_FEATURES: FeatureGlossary = {
  family: "Which service family this suggestion is for (dns, mail, or vpn).",
  exposed_ports: "This family's ports answering in the latest fingerprint.",
  software: "What answers on those ports, as the sources name it.",
  inbound_peers: "Distinct non-scanner peers with enough inbound records to count as real traffic, not a probe.",
  inbound_any_peers:
    "Distinct non-scanner peers with any inbound record at all — looser than inbound_peers, since a query-response service can be real at very low per-peer volume (e.g. DNS sampled at ~1-in-1,500).",
  inbound_records: "Inbound records on this family's ports.",
  inbound_max_days: "The most days any single inbound peer was seen on.",
  outbound_peers: "Distinct hosts this IP connects to on this family's ports.",
  outbound_records: "Outbound records on this family's ports.",
  exposes: "True if any of this family's ports answered in the latest fingerprint.",
};

// Provisional (2026-10-20): describes the shape as it exists today, not as
// a settled vocabulary. netflow-rollups' own agentic process catalogue and
// findings vocabulary — both still in planning — will eventually be the
// canonical source for what `findings` and the agent's `evaluation` actually
// mean; these two entries should be replaced from there once that lands,
// not treated as final just because they're reachable today.
const C2_FEATURES: FeatureGlossary = {
  families: "Known C2 framework names matched by a fingerprint finding on this IP.",
  findings: "The verdict__findings rows (signature_known_family) behind this suggestion.",
  c2: "The confirmed c2_server address this peer relationship is measured against.",
  beacon_rules: "The verdict__findings beacon_* rules that fired for this peer against a confirmed C2.",
  days_seen: "Distinct days this peer relationship was seen.",
  records: "Flow records in this peer relationship.",
  in_records: "Inbound flow records in this peer relationship.",
  out_records: "Outbound flow records in this peer relationship.",
  admin_days: "Days with traffic both ways on admin ports (ssh/web/rdp/vnc/telnet-style admin families).",
  admin_bytes: "Bytes on admin ports in this peer relationship.",
  c2s: "Confirmed C2 addresses this peer probes.",
  peer_days: "Distinct days this peer made a probing flow to a confirmed C2.",
};

// rule_name -> which glossary above describes its features. Exact match,
// not a prefix guess, since rule_name values are a small fixed set (per
// netflow-rollups' review/ip_roles/writer.py) rather than open-ended.
const RULE_FEATURE_GLOSSARY: Record<string, FeatureGlossary> = {
  sip_server_has_clients: SIP_WATCHED_FEATURES,
  sip_server_many_peers: SIP_WATCHED_FEATURES,
  sip_server_exposed_few_peers: SIP_WATCHED_FEATURES,
  sip_trunk_gateway: SIP_WATCHED_FEATURES,
  sip_client_outbound_only: SIP_WATCHED_FEATURES,
  sip_client_single_handset: SIP_WATCHED_FEATURES,
  sip_client_many_switches: SIP_WATCHED_FEATURES,
  sip_client_https_signaled: SIP_WATCHED_FEATURES,
  sip_peer_serves_watched_phones: SIP_PAIR_FEATURES,
  sip_peer_client_registering: SIP_PAIR_FEATURES,
  sip_peer_client_consumer_link: SIP_PAIR_FEATURES,
  sip_peer_trunk_sized_media: SIP_PAIR_FEATURES,
  sip_peer_trunk_hosting_steady: SIP_PAIR_FEATURES,
  web_server_many_clients: WEB_FEATURES,
  web_server_panel_in_use: WEB_FEATURES,
  web_server_cert_named: WEB_FEATURES,
  reverse_proxy_fronting: WEB_FEATURES,
  dns_server_many_peers: SERVICE_FEATURES,
  dns_server_named_ns: SERVICE_FEATURES,
  mail_server_receives: SERVICE_FEATURES,
  mail_server_mailboxes: SERVICE_FEATURES,
  vpn_server_clients: SERVICE_FEATURES,
  c2_server_known_family: C2_FEATURES,
  c2_victim_beaconing: C2_FEATURES,
  c2_operator_steady_bidirectional: C2_FEATURES,
  research_periodic_probe: C2_FEATURES,
};

function featureDescription(ruleName: string, featureKey: string): string | null {
  return RULE_FEATURE_GLOSSARY[ruleName]?.[featureKey] ?? null;
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

function formatFeatureValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.length === 0 ? "—" : v.map((x) => String(x)).join(", ");
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
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
        <IpRoleQueue vantage="peer" onPendingCount={setPeerPending} />
      </div>
      <div style={{ display: tab === "watched" ? undefined : "none" }}>
        <IpRoleQueue vantage="watched" onPendingCount={setWatchedPending} />
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
}: {
  vantage: "peer" | "watched";
  onPendingCount: (n: number) => void;
}) {
  const [rows, setRows] = useState<IpRole[] | null>(null);
  const [decided, setDecided] = useState<Map<string, RoleDecided>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ipFilter, setIpFilter] = useState<string>("");

  const ipOptions = useMemo(() => [...new Set((rows ?? []).map((r) => r.ip))].sort(), [rows]);
  const visibleRows = useMemo(
    () => (ipFilter ? (rows ?? []).filter((r) => r.ip === ipFilter) : (rows ?? [])),
    [rows, ipFilter],
  );

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setDecided(new Map());
    setIpFilter("");
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
          />
        ))}
        {rows && rows.length === 0 && (
          <div className="card" style={{ padding: 20, color: "#6FA89E" }}>
            No {vantage} roles awaiting review.
          </div>
        )}
        {rows && rows.length > 0 && visibleRows.length === 0 && (
          <div className="card" style={{ padding: 20, color: "#6FA89E" }}>
            No {vantage} roles awaiting review for {ipFilter}.
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
}: {
  row: IpRole;
  vantage: "peer" | "watched";
  decided: RoleDecided | undefined;
  onDecide: (row: IpRole, decision: "confirm" | "reject", pairs?: PairRef[]) => Promise<void>;
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
            <span className="chip pend">suggested {row.role}</span>
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
                  <span className="mono" style={{ color: "#4C8DFF", fontWeight: 600, fontSize: 12 }}>
                    {ruleName}
                  </span>
                  {!RULE_FEATURE_GLOSSARY[ruleName] && (
                    <span
                      className="mono"
                      style={{ fontSize: 10, color: "#6FA89E", border: "1px dashed #3F9C8A", borderRadius: 4, padding: "0 5px" }}
                      title="This rule isn't in the feature glossary yet — its fields show without tooltips below."
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
                        const desc = featureDescription(ruleName, k);
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
                      <td className="mono">{otherIp}</td>
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
