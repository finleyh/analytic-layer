import { useEffect, useState } from "react";
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
          <span className="mono">dns_records</span> history · one row per run
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {dnsRuns.map((run, i) => {
            const prev = dnsRuns[i - 1];
            const changed = prev && JSON.stringify([...prev.a].sort()) !== JSON.stringify([...run.a].sort());
            return (
              <div
                key={run.startedAt}
                style={{
                  display: "flex",
                  gap: 10,
                  fontSize: 12,
                  padding: "6px 0",
                  borderBottom: "1px solid #133A3C",
                  alignItems: "baseline",
                }}
              >
                <span className="mono" style={{ color: "#A6D8CD", width: 140, flexShrink: 0 }}>
                  {formatDateTime(run.startedAt)}
                </span>
                {run.status !== "ok" ? (
                  <span style={{ color: "#E5484D" }}>{run.status}</span>
                ) : (
                  <>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: i === 0 ? "#A6D8CD" : changed ? "#F5A623" : "#153226",
                        border: i === 0 ? "none" : changed ? "none" : "1px solid #1E4D37",
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    />
                    <span className="mono">
                      {run.a.map((ip) => (
                        <span key={ip} style={{ marginRight: 8 }}>
                          {ip}
                          {peerHits.has(ip) && (
                            <span style={{ color: "#4C8DFF", marginLeft: 4 }} title="Also seen as a netflow peer">
                              · {formatBytes(peerHits.get(ip)!)} netflow peer
                            </span>
                          )}
                        </span>
                      ))}
                    </span>
                  </>
                )}
              </div>
            );
          })}
          {dnsRuns.length === 0 && <div style={{ color: "#6FA89E", fontSize: 12 }}>No DNS history yet.</div>}
        </div>
        <div className="note">
          Orange = A records changed since the previous run. Blue annotation = that IP also shows
          up as a peer in <span className="mono">rollup__flow_daily</span> (90d) — a cross-source
          link the mockup called for, computed live here rather than stored.
        </div>
      </div>
    </>
  );
}
