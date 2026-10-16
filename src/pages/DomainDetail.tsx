import { useEffect, useState } from "react";
import * as d3 from "d3";
import { Link, useParams } from "react-router-dom";
import { fetchMonitoredDetail, type MonitoredDomainDetail, type HistoryRun } from "../api/spoilerAlert";
import { fetchOwner, type OpenCtiOwner } from "../api/opencti";
import { flowDailyRollupFlowDailyGet } from "../api/netflow-rollups-client";
import { formatBytes, daysAgo, isoDate } from "../lib/format";

const STATE_COLOR: Record<string, string> = {
  active: "#3DD68C",
  demoted: "#F5A623",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
}

type ArecordRun = { startedAt: string; a: string[]; status: string };
type ArSegment = { ip: string; start: string; end: string; ongoing: boolean };

const AR_PALETTE = ["#4C8DFF", "#8B5CF6", "#2DD4BF", "#F59E0B", "#EC4899", "#3DD68C", "#E5484D", "#A3A3A3"];

// Collapses a sequence of point-in-time DNS checks into start/end bars per IP:
// an IP's segment runs from the check it first appears in to the check it
// drops out of (or to "now" if it's still in the latest check).
function buildArSegments(okRuns: ArecordRun[]): { segments: ArSegment[]; order: string[] } {
  const segments: ArSegment[] = [];
  const active = new Map<string, string>();
  const order: string[] = [];
  const now = new Date().toISOString();

  okRuns.forEach((run, i) => {
    const present = new Set(run.a);
    for (const [ip, start] of active) {
      if (!present.has(ip)) {
        segments.push({ ip, start, end: run.startedAt, ongoing: false });
        active.delete(ip);
      }
    }
    for (const ip of present) {
      if (!active.has(ip)) {
        active.set(ip, run.startedAt);
        if (!order.includes(ip)) order.push(ip);
      }
    }
    if (i === okRuns.length - 1) {
      for (const [ip, start] of active) segments.push({ ip, start, end: now, ongoing: true });
    }
  });

  return { segments, order };
}

function ArGanttChart({ runs, peerHits }: { runs: ArecordRun[]; peerHits: Map<string, number> }) {
  const okRuns = runs.filter((r) => r.status === "ok");
  if (okRuns.length === 0) {
    return <div style={{ color: "#6FA89E", fontSize: 12 }}>No DNS history yet.</div>;
  }

  const { segments, order } = buildArSegments(okRuns);
  const now = new Date();
  const minStart = new Date(okRuns[0].startedAt);
  const W = 760;
  const leftPad = 150;
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

      {order.map((ip, row) => {
        const y = topPad + row * rowH;
        const color = AR_PALETTE[row % AR_PALETTE.length];
        const peerBytes = peerHits.get(ip);
        return (
          <g key={ip}>
            <text x={leftPad - 10} y={y + rowH / 2 - (peerBytes !== undefined ? 3 : -3)} fontSize={11} fill="#A6D8CD" textAnchor="end">
              {ip}
            </text>
            {peerBytes !== undefined && (
              <text x={leftPad - 10} y={y + rowH / 2 + 10} fontSize={9} fill="#4C8DFF" textAnchor="end">
                {formatBytes(peerBytes)} peer
              </text>
            )}
            {segments
              .filter((s) => s.ip === ip)
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
                      {ip}
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
        const dnsRuns = detail.history.filter((h) => h.module === "dns_records" && h.status === "ok");
        const latest = dnsRuns.sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
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

  const dnsRuns: ArecordRun[] = domain.history
    .filter((h) => h.module === "dns_records")
    .map((h) => ({ startedAt: h.started_at, a: h.observations?.records?.A ?? [], status: h.status }))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  const modules = new Map<string, HistoryRun>();
  for (const h of domain.history) {
    const existing = modules.get(h.module);
    if (!existing || h.started_at > existing.started_at) modules.set(h.module, h);
  }

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
          <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>
            {domain.domain_expires_at ? domain.domain_expires_at.slice(0, 10) : "—"}
          </div>
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
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>A-record timeline</div>
        <div style={{ fontSize: 11, color: "#6FA89E", marginBottom: 14 }}>
          <span className="mono">dns_records</span> history · one bar per IP, start → end of its run as an A record
        </div>
        <ArGanttChart runs={dnsRuns} peerHits={peerHits} />
        <div className="note">
          A bar's left edge is the check that first saw that IP; its right edge is the check that
          first saw it gone, or the dashed "now" line if it's still current. Bytes-labeled blue
          annotation = that IP also shows up as a peer in{" "}
          <span className="mono">rollup__flow_daily</span> (90d) — hover a bar for exact
          timestamps.
        </div>
      </div>
    </>
  );
}
