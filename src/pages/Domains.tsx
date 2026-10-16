import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchStatus,
  fetchMonitored,
  fetchRetired,
  fetchMonitoredDetail,
  type MonitoredDomain,
  type RetiredDomain,
  type StatusSummary,
  type HistoryRun,
} from "../api/spoilerAlert";
import { fetchOwner, type OpenCtiOwner } from "../api/opencti";
import { formatShortDate } from "../lib/format";

type View = "all" | "owner";

type DomainsData = {
  status: StatusSummary;
  monitored: MonitoredDomain[];
  retired: RetiredDomain[];
  ownerByOpenctiId: Map<string, OpenCtiOwner | null>;
  expiryByOpenctiId: Map<string, string | null>;
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
}

// spoiler-alert's /monitored(-list) domain_expires_at field has been null
// for every domain observed so far even when its domain_expiry module has a
// real WHOIS date — fall back to that module's most recent successful run.
function latestExpiryFromHistory(history: HistoryRun[]): string | null {
  return (
    history
      .filter((h) => h.module === "domain_expiry" && h.status === "ok")
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
      .at(-1)?.observations?.records?.EXPIRATION_DATE?.[0] ?? null
  );
}

const STATE_COLOR: Record<string, string> = {
  active: "#3DD68C",
  demoted: "#F5A623",
};

export function Domains() {
  const [data, setData] = useState<DomainsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("all");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [status, monitored, retired] = await Promise.all([
          fetchStatus(),
          fetchMonitored(),
          fetchRetired(),
        ]);
        if (cancelled) return;

        const [ownerEntries, expiryEntries] = await Promise.all([
          Promise.all(
            monitored.map(async (m) => {
              try {
                return [m.opencti_id, await fetchOwner(m.opencti_id)] as const;
              } catch {
                return [m.opencti_id, null] as const;
              }
            }),
          ),
          Promise.all(
            monitored.map(async (m) => {
              try {
                const detail = await fetchMonitoredDetail(m.opencti_id);
                return [m.opencti_id, m.domain_expires_at ?? latestExpiryFromHistory(detail.history)] as const;
              } catch {
                return [m.opencti_id, m.domain_expires_at] as const;
              }
            }),
          ),
        ]);
        if (cancelled) return;

        setData({
          status,
          monitored,
          retired,
          ownerByOpenctiId: new Map(ownerEntries),
          expiryByOpenctiId: new Map(expiryEntries),
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    if (!data) return new Map<string, MonitoredDomain[]>();
    const m = new Map<string, MonitoredDomain[]>();
    for (const d of data.monitored) {
      const owner = data.ownerByOpenctiId.get(d.opencti_id);
      const key = owner ? owner.name : "unassigned";
      const list = m.get(key) ?? [];
      list.push(d);
      m.set(key, list);
    }
    return m;
  }, [data]);

  if (error) {
    return (
      <div className="card" style={{ padding: 20, borderColor: "#5A2327" }}>
        Failed to load: {error}
      </div>
    );
  }
  if (!data) return <div style={{ color: "#6FA89E" }}>Loading…</div>;

  const { status, monitored, retired } = data;

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: "0 0 4px 0", fontSize: 22, fontWeight: 600 }}>Domains</h1>
        <div style={{ fontSize: 13, color: "#6FA89E" }}>
          {status.monitored_total} monitored · passive proof-of-life, not IP monitoring (that's{" "}
          <Link to="/watchlist">Watchlist</Link>) · <span className="mono">spoiler-alert /status · /monitored</span>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 6 }}>Monitored</div>
          <div style={{ fontSize: 26, fontWeight: 600 }}>{status.monitored_total}</div>
          <div style={{ fontSize: 11, color: "#6FA89E", marginTop: 4 }}>
            {Object.entries(status.monitored_per_state)
              .map(([s, n]) => `${n} ${s}`)
              .join(" · ")}
          </div>
        </div>
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 6 }}>Retired</div>
          <div style={{ fontSize: 26, fontWeight: 600 }}>{status.retired}</div>
          <div style={{ fontSize: 11, color: "#6FA89E", marginTop: 4 }}>{status.resurrected} resurrected</div>
        </div>
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 6 }}>Due now</div>
          <div style={{ fontSize: 26, fontWeight: 600 }}>{status.due_now}</div>
          <div style={{ fontSize: 11, color: "#6FA89E", marginTop: 4 }}>
            next {formatDateTime(status.next_due_at)}
          </div>
        </div>
        <div
          className="card"
          style={{ padding: "16px 20px", borderColor: status.errors_24h > 0 ? "#5A2327" : undefined }}
        >
          <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 6 }}>Checks (24h)</div>
          <div style={{ fontSize: 26, fontWeight: 600 }}>{status.check_runs_24h}</div>
          <div style={{ fontSize: 11, color: status.errors_24h > 0 ? "#E5484D" : "#6FA89E", marginTop: 4 }}>
            {status.errors_24h} errors
          </div>
        </div>
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 6 }}>Results (24h)</div>
          <div className="mono" style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>
            {Object.entries(status.status_mix_24h)
              .map(([k, v]) => `${k} ${v}`)
              .join(" · ")}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        <button
          onClick={() => setView("all")}
          style={{
            all: "unset",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 500,
            padding: "6px 14px",
            borderRadius: "6px 0 0 6px",
            border: "1px solid #2B7266",
            color: view === "all" ? "#E8FFF8" : "#A6D8CD",
            background: view === "all" ? "#133A3C" : "transparent",
            borderColor: view === "all" ? "#3F9C8A" : "#2B7266",
          }}
        >
          All
        </button>
        <button
          onClick={() => setView("owner")}
          style={{
            all: "unset",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 500,
            padding: "6px 14px",
            borderRadius: "0 6px 6px 0",
            border: "1px solid #2B7266",
            borderLeft: "none",
            color: view === "owner" ? "#E8FFF8" : "#A6D8CD",
            background: view === "owner" ? "#133A3C" : "transparent",
            borderColor: view === "owner" ? "#3F9C8A" : "#2B7266",
          }}
        >
          By owner
        </button>
      </div>

      {view === "all" && (
        <DomainTable domains={monitored} owners={data.ownerByOpenctiId} expiry={data.expiryByOpenctiId} />
      )}

      {view === "owner" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {[...grouped.entries()]
            .sort((a, b) => b[1].length - a[1].length)
            .map(([owner, domains]) => (
              <div key={owner}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: owner === "unassigned" ? "#6FA89E" : "#E8FFF8" }}>
                  {owner} <span style={{ color: "#6FA89E", fontWeight: 400 }}>({domains.length})</span>
                </div>
                <DomainTable domains={domains} owners={data.ownerByOpenctiId} expiry={data.expiryByOpenctiId} hideOwnerColumn />
              </div>
            ))}
        </div>
      )}

      <div className="card" style={{ marginTop: 24 }}>
        <div style={{ padding: "16px 20px", fontSize: 13, fontWeight: 600 }}>Retired ({retired.length})</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th>Domain</th>
              <th>Retired</th>
              <th>Last recheck</th>
              <th style={{ textAlign: "right" }}>Rechecks</th>
              <th>Resurrected</th>
            </tr>
          </thead>
          <tbody>
            {retired.map((r) => (
              <tr key={r.opencti_id}>
                <td>
                  <Link to={`/domains/${r.opencti_id}`} className="mono row-link">
                    {r.value}
                  </Link>
                </td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {formatShortDate(r.retired_at)}
                </td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {r.last_recheck_at ? formatShortDate(r.last_recheck_at) : "—"}
                </td>
                <td className="num mono" style={{ textAlign: "right" }}>
                  {r.recheck_count}
                </td>
                <td style={{ color: r.resurrected_at ? "#3DD68C" : "#6FA89E" }}>
                  {r.resurrected_at ? formatShortDate(r.resurrected_at) : "no"}
                </td>
              </tr>
            ))}
            {retired.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "#6FA89E" }}>
                  No retired domains.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DomainTable({
  domains,
  owners,
  expiry,
  hideOwnerColumn,
}: {
  domains: MonitoredDomain[];
  owners: Map<string, OpenCtiOwner | null>;
  expiry: Map<string, string | null>;
  hideOwnerColumn?: boolean;
}) {
  return (
    <div className="card" style={{ overflowX: "auto", marginBottom: hideOwnerColumn ? 0 : 24 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
        <thead>
          <tr>
            <th>Domain</th>
            <th>Cadence</th>
            <th>State</th>
            <th style={{ textAlign: "right" }}>Failures</th>
            <th>Last checked</th>
            <th>Next due</th>
            <th>Expires</th>
            {!hideOwnerColumn && <th>Owner</th>}
          </tr>
        </thead>
        <tbody>
          {domains.map((d) => (
            <tr key={d.opencti_id}>
              <td>
                <Link to={`/domains/${d.opencti_id}`} className="mono row-link">
                  {d.value}
                </Link>
              </td>
              <td style={{ color: "#A6D8CD" }}>{d.cadence}</td>
              <td>
                <span className="st" style={{ color: STATE_COLOR[d.state] ?? "#A6D8CD", fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>
                  {d.state}
                </span>
              </td>
              <td className="num mono" style={{ textAlign: "right", color: d.consecutive_failures > 0 ? "#F5A623" : undefined }}>
                {d.consecutive_failures}
              </td>
              <td className="mono" style={{ fontSize: 12 }}>
                {formatDateTime(d.last_checked_at)}
              </td>
              <td className="mono" style={{ fontSize: 12 }}>
                {formatDateTime(d.next_due_at)}
              </td>
              <td className="mono" style={{ fontSize: 12 }}>
                {(() => {
                  const exp = expiry.get(d.opencti_id) ?? d.domain_expires_at;
                  return exp ? formatShortDate(exp) : "—";
                })()}
              </td>
              {!hideOwnerColumn && (
                <td style={{ fontSize: 12 }}>
                  {owners.get(d.opencti_id) ? (
                    <span className="chip" style={{ fontSize: 10 }}>
                      {owners.get(d.opencti_id)!.name}
                    </span>
                  ) : (
                    <span style={{ color: "#6FA89E" }}>—</span>
                  )}
                </td>
              )}
            </tr>
          ))}
          {domains.length === 0 && (
            <tr>
              <td colSpan={hideOwnerColumn ? 7 : 8} style={{ color: "#6FA89E" }}>
                No domains.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
