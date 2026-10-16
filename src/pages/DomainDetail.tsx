import { Fragment, useEffect, useState } from "react";
import * as d3 from "d3";
import { Link, useParams } from "react-router-dom";
import { fetchMonitoredDetail, type MonitoredDomainDetail, type HistoryRun } from "../api/spoilerAlert";
import { fetchOwner, type OpenCtiOwner } from "../api/opencti";
import { flowDailyRollupFlowDailyGet } from "../api/netflow-rollups-client";
import { formatBytes, daysAgo, isoDate, daysUntil, expiryColor } from "../lib/format";

const STATE_COLOR: Record<string, string> = {
  active: "#3DD68C",
  demoted: "#F5A623",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
}

type DnsRun = { startedAt: string; status: string; records: Record<string, string[]> };
type RecordSegment = { value: string; start: string; end: string; ongoing: boolean };

const RECORD_PALETTE = ["#4C8DFF", "#8B5CF6", "#2DD4BF", "#F59E0B", "#EC4899", "#3DD68C", "#E5484D", "#A3A3A3"];

// Record types that have a meaningful "which value was active when" timeline.
// SOA is deliberately excluded: its serial number changes on essentially every
// check, so every run would be its own one-off segment — not a timeline, noise.
const RECORD_TYPE_ORDER = ["A", "AAAA", "NS", "MX", "TXT", "CNAME"];

function truncateValue(v: string, n = 30): string {
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
}

// Collapses a sequence of point-in-time DNS checks into start/end bars per
// value: a value's segment runs from the check it first appears in to the
// check it drops out of (or to "now" if it's still in the latest check).
function buildRecordSegments(okRuns: { startedAt: string; values: string[] }[]): {
  segments: RecordSegment[];
  order: string[];
} {
  const segments: RecordSegment[] = [];
  const active = new Map<string, string>();
  const order: string[] = [];
  const now = new Date().toISOString();

  okRuns.forEach((run, i) => {
    const present = new Set(run.values);
    for (const [value, start] of active) {
      if (!present.has(value)) {
        segments.push({ value, start, end: run.startedAt, ongoing: false });
        active.delete(value);
      }
    }
    for (const value of present) {
      if (!active.has(value)) {
        active.set(value, run.startedAt);
        if (!order.includes(value)) order.push(value);
      }
    }
    if (i === okRuns.length - 1) {
      for (const [value, start] of active) segments.push({ value, start, end: now, ongoing: true });
    }
  });

  return { segments, order };
}

function RecordGanttChart({
  runs,
  type,
  peerHits,
}: {
  runs: DnsRun[];
  type: string;
  peerHits?: Map<string, number>;
}) {
  const okRuns = runs.filter((r) => r.status === "ok").map((r) => ({ startedAt: r.startedAt, values: r.records[type] ?? [] }));
  if (!okRuns.some((r) => r.values.length > 0)) return null;

  const { segments, order } = buildRecordSegments(okRuns);
  const now = new Date();
  const minStart = new Date(okRuns[0].startedAt);
  const W = 760;
  const leftPad = 190;
  const rightPad = 16;
  const rowH = 32;
  const topPad = 26;
  const chartW = W - leftPad - rightPad;
  const H = topPad + order.length * rowH + 8;

  const x = d3.scaleTime().domain([minStart, now]).range([0, chartW]);
  const ticks = x.ticks(Math.min(6, okRuns.length));
  const fmt = d3.timeFormat("%b %d");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ overflow: "visible" }} className="mono">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={leftPad + x(t)} x2={leftPad + x(t)} y1={topPad - 6} y2={H - 2} stroke="#133A3C" strokeWidth={1} />
          <text x={leftPad + x(t)} y={topPad - 12} fontSize={10} fill="#6FA89E" textAnchor="middle">
            {fmt(t)}
          </text>
        </g>
      ))}
      <line
        x1={leftPad + chartW}
        x2={leftPad + chartW}
        y1={topPad - 6}
        y2={H - 2}
        stroke="#3DD68C"
        strokeDasharray="2,2"
        strokeWidth={1}
      />
      <text x={leftPad + chartW} y={topPad - 12} fontSize={10} fill="#3DD68C" textAnchor="middle">
        now
      </text>

      {order.map((value, row) => {
        const y = topPad + row * rowH;
        const color = RECORD_PALETTE[row % RECORD_PALETTE.length];
        const peerBytes = peerHits?.get(value);
        return (
          <g key={value}>
            <title>{value}</title>
            <text x={leftPad - 10} y={y + rowH / 2 - (peerBytes !== undefined ? 3 : -3)} fontSize={11} fill="#A6D8CD" textAnchor="end">
              {truncateValue(value)}
            </text>
            {peerBytes !== undefined && (
              <text x={leftPad - 10} y={y + rowH / 2 + 10} fontSize={9} fill="#4C8DFF" textAnchor="end">
                {formatBytes(peerBytes)} peer
              </text>
            )}
            {segments
              .filter((s) => s.value === value)
              .map((s, si) => {
                const sx = leftPad + x(new Date(s.start));
                const ex = leftPad + x(new Date(s.end));
                const w = Math.max(ex - sx, 3);
                return (
                  <rect
                    key={si}
                    x={sx}
                    y={y + 7}
                    width={w}
                    height={rowH - 16}
                    rx={3}
                    fill={color}
                    opacity={s.ongoing ? 1 : 0.6}
                  >
                    <title>
                      {value}
                      {"\n"}
                      {formatDateTime(s.start)} → {s.ongoing ? "present" : formatDateTime(s.end)}
                    </title>
                  </rect>
                );
              })}
          </g>
        );
      })}
    </svg>
  );
}

function CheckHistoryTable({ history }: { history: HistoryRun[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const runs = [...history].sort((a, b) => b.started_at.localeCompare(a.started_at));

  return (
    <div className="card" style={{ padding: "22px 24px" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Check history</div>
      <div style={{ fontSize: 11, color: "#6FA89E", marginBottom: 14 }}>
        Every captured scan, both modules · click a row to view what it saw
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>Time</th>
            <th>Module</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {runs.map((h) => {
            const key = `${h.module}:${h.started_at}`;
            const isOpen = expanded === key;
            const records = h.observations?.records ?? {};
            const recordEntries = Object.entries(records);
            return (
              <Fragment key={key}>
                <tr onClick={() => setExpanded(isOpen ? null : key)} style={{ cursor: "pointer" }}>
                  <td className="mono row-link" style={{ fontSize: 12 }}>
                    {formatDateTime(h.started_at)}
                  </td>
                  <td className="mono row-link" style={{ fontSize: 12 }}>
                    {h.module}
                  </td>
                  <td>
                    <span
                      className="st"
                      style={{
                        color: h.status === "ok" ? "#3DD68C" : "#E5484D",
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: "uppercase",
                      }}
                    >
                      {h.status}
                    </span>
                  </td>
                  <td className="row-link" style={{ textAlign: "right", color: "#6FA89E" }}>
                    {isOpen ? "▾ hide" : "▸ view"}
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={4} style={{ background: "#0A2224", cursor: "default" }}>
                      {h.error && <div style={{ color: "#E5484D", fontSize: 12, marginBottom: recordEntries.length ? 10 : 0 }}>{h.error}</div>}
                      {recordEntries.length > 0 ? (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                          {recordEntries.map(([type, values]) => (
                            <div key={type}>
                              <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>{type}</div>
                              <div className="mono" style={{ fontSize: 12 }}>
                                {values.map((v) => (
                                  <div key={v}>{v}</div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        !h.error && <div style={{ color: "#6FA89E", fontSize: 12 }}>No observations captured.</div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {runs.length === 0 && (
            <tr>
              <td colSpan={4} style={{ color: "#6FA89E" }}>
                No checks captured yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function DomainDetail() {
  const { id } = useParams<{ id: string }>();
  const [domain, setDomain] = useState<MonitoredDomainDetail | null>(null);
  const [owner, setOwner] = useState<OpenCtiOwner | null>(null);
  const [peerHits, setPeerHits] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function load() {
      try {
        const [detail, ownerResult] = await Promise.all([
          fetchMonitoredDetail(id!),
          fetchOwner(id!).catch(() => null),
        ]);
        if (cancelled) return;
        setDomain(detail);
        setOwner(ownerResult);

        // Cross-reference the current A record(s) against netflow-rollups:
        // does any of them show up as a peer any monitored IP talks to?
        const okDnsRuns = detail.history.filter((h) => h.module === "dns_records" && h.status === "ok");
        const latest = okDnsRuns.sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
        const currentA = latest?.observations?.records?.A ?? [];
        const from90 = isoDate(daysAgo(89));
        const to = isoDate(new Date());
        const hits = await Promise.all(
          currentA.map(async (ip) => {
            try {
              const r = await flowDailyRollupFlowDailyGet({
                query: { peer_ip: ip, from: from90, to, limit: 20000 },
                throwOnError: true,
              });
              return [ip, r.data.rows.reduce((s, row) => s + row.bytes_sum, 0)] as const;
            } catch {
              return [ip, 0] as const;
            }
          }),
        );
        if (cancelled) return;
        setPeerHits(new Map(hits.filter(([, bytes]) => bytes > 0)));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <div className="card" style={{ padding: 20, borderColor: "#5A2327" }}>
        Failed to load: {error}
      </div>
    );
  }
  if (!domain) return <div style={{ color: "#6FA89E" }}>Loading…</div>;

  const dnsRuns: DnsRun[] = domain.history
    .filter((h) => h.module === "dns_records")
    .map((h) => ({ startedAt: h.started_at, status: h.status, records: h.observations?.records ?? {} }))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  const recordTypes = [...new Set(dnsRuns.flatMap((r) => Object.keys(r.records)))]
    .filter((t) => t !== "SOA")
    .sort((a, b) => {
      const ai = RECORD_TYPE_ORDER.indexOf(a);
      const bi = RECORD_TYPE_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

  const modules = new Map<string, HistoryRun>();
  for (const h of domain.history) {
    const existing = modules.get(h.module);
    if (!existing || h.started_at > existing.started_at) modules.set(h.module, h);
  }

  // WHOIS/RDAP fields from the domain_expiry module aren't surfaced on the
  // top-level domain record the same way dns_records' A values are — pull
  // registrar/registrant/expiry straight from that module's most recent
  // successful run instead. domain.domain_expires_at is kept as a fallback,
  // but in practice spoiler-alert's API returns it null for every domain
  // observed so far even when the module itself has a real date.
  const latestWhois = domain.history
    .filter((h) => h.module === "domain_expiry" && h.status === "ok")
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .at(-1)?.observations?.records;
  const registrar = latestWhois?.REGISTRAR?.[0];
  const registrant = latestWhois?.REGISTRANT?.[0];
  const registeredAt = latestWhois?.REGISTRATION_DATE?.[0];
  const expiresAt = domain.domain_expires_at ?? latestWhois?.EXPIRATION_DATE?.[0] ?? null;
  const expiryDays = daysUntil(expiresAt);

  return (
    <>
      <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 10 }}>
        <Link to="/domains">Domains</Link> / Entity
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6, flexWrap: "wrap" }}>
        <h1 className="mono" style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>
          {domain.value}
        </h1>
        <span
          className="st"
          style={{ color: STATE_COLOR[domain.state] ?? "#A6D8CD", fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}
        >
          {domain.state}
        </span>
        <span style={{ fontSize: 12, color: "#A6D8CD" }}>{domain.cadence} cadence</span>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
        {owner && <span className="chip">{owner.name}</span>}
        <a href={domain.opencti_href} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
          OpenCTI ↗
        </a>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))",
          gap: 16,
          marginBottom: 28,
        }}
      >
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 6 }}>Last checked</div>
          <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>
            {formatDateTime(domain.last_checked_at)}
          </div>
        </div>
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 6 }}>Next due</div>
          <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>
            {formatDateTime(domain.next_due_at)}
          </div>
        </div>
        <div className="card" style={{ padding: "16px 20px", borderColor: domain.consecutive_failures > 0 ? "#5A2327" : undefined }}>
          <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 6 }}>Consecutive failures</div>
          <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: domain.consecutive_failures > 0 ? "#E5484D" : undefined }}>
            {domain.consecutive_failures}
          </div>
        </div>
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 6 }}>Expires</div>
          <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: expiryColor(expiryDays) }}>
            {expiresAt ? expiresAt.slice(0, 10) : "—"}
          </div>
          {expiryDays !== null && (
            <div style={{ fontSize: 11, color: expiryColor(expiryDays) ?? "#6FA89E", marginTop: 3 }}>
              {expiryDays >= 0 ? `WHOIS/RDAP · ${expiryDays} days` : `expired ${Math.abs(expiryDays)}d ago`}
            </div>
          )}
        </div>
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 6 }}>Registrar</div>
          <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{registrar ?? "—"}</div>
          {(registrant || registeredAt) && (
            <div style={{ fontSize: 11, color: "#6FA89E", marginTop: 3 }}>
              {registrant && <>{registrant} · </>}
              {registeredAt && <>registered {registeredAt.slice(0, 10)}</>}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {[...modules.entries()].map(([mod, h]) => (
          <div className="card" style={{ padding: "16px 18px" }} key={mod}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontSize: 12, color: "#6FA89E" }}>{mod}</div>
              <span
                className="st"
                style={{ color: h.status === "ok" ? "#3DD68C" : "#E5484D", fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}
              >
                {h.status}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#6FA89E", marginTop: 6 }}>last run {formatDateTime(h.started_at)}</div>
            {h.error && <div style={{ fontSize: 11, color: "#E5484D", marginTop: 4 }}>{h.error}</div>}
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: "22px 24px", marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>DNS record timeline</div>
        <div style={{ fontSize: 11, color: "#6FA89E", marginBottom: 14 }}>
          <span className="mono">dns_records</span> history · one bar per value, start → end of its run as that
          record
        </div>
        {recordTypes.length === 0 && <div style={{ color: "#6FA89E", fontSize: 12 }}>No DNS history yet.</div>}
        {recordTypes.map((type, i) => (
          <div key={type} style={{ marginTop: i === 0 ? 0 : 22, paddingTop: i === 0 ? 0 : 18, borderTop: i === 0 ? undefined : "1px solid #133A3C" }}>
            <div style={{ fontSize: 11, color: "#A6D8CD", fontWeight: 600, marginBottom: 6 }} className="mono">
              {type}
            </div>
            <RecordGanttChart runs={dnsRuns} type={type} peerHits={type === "A" ? peerHits : undefined} />
          </div>
        ))}
        <div className="note">
          A bar's left edge is the check that first saw that value; its right edge is the check
          that first saw it gone, or the dashed "now" line if it's still current. Bytes-labeled
          blue annotation (A records only) = that IP also shows up as a peer in{" "}
          <span className="mono">rollup__flow_daily</span> (90d). SOA is excluded — its serial
          changes on nearly every check, so it has no meaningful timeline. Hover a bar or its
          label for exact values/timestamps.
        </div>
      </div>

      <CheckHistoryTable history={domain.history} />
    </>
  );
}
