import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  listIpsWatchIpsGet,
  flowDailyRollupFlowDailyGet,
  flowHourlyRollupFlowHourlyGet,
  type WatchedIp,
  type DailyFlow,
  type HourlyFlow,
} from "../api/netflow-rollups-client";
import { formatBytes, isoDate, daysAgo } from "../lib/format";
import { categoryColors } from "../lib/categories";

type Tab = "daily" | "hourly" | "raw";

const PROTOCOL_NAMES: Record<number, string> = { 1: "ICMP", 6: "TCP", 17: "UDP" };
function protocolName(n: number): string {
  return PROTOCOL_NAMES[n] ?? `proto ${n}`;
}

const PORT_FAMILY_SUGGESTIONS = ["rtp_media", "voip_signaling", "voip_admin", "web_admin"];

type Filters = { monitoredIp: string; peerIp: string; portFamily: string };
const EMPTY_FILTERS: Filters = { monitoredIp: "", peerIp: "", portFamily: "" };

type Row = {
  key: string;
  when: string;
  monitoredIp: string;
  peerIp: string;
  peerAsn: number | null;
  peerCountry: string | null;
  protocol: number;
  portFamily: string;
  peerCategories: string[];
  pairConfirmed: boolean;
  bytes: number;
  flows: number;
  distinctPorts: number | null;
};

// Shape-driven, not tab-driven: a render can happen with the new tab value
// before the fetch effect has reset rawRows to the new granularity's shape,
// and mapping a stale DailyFlow row with hourlyToRow (or vice versa) reads
// an undefined day/hour field and crashes. "day" only exists on DailyFlow.
function toRow(r: DailyFlow | HourlyFlow): Row {
  return "day" in r ? dailyToRow(r) : hourlyToRow(r);
}

function dailyToRow(r: DailyFlow): Row {
  return {
    key: `${r.day}|${r.monitored_ip}|${r.peer_ip}|${r.protocol}|${r.port_family}`,
    when: r.day,
    monitoredIp: r.monitored_ip,
    peerIp: r.peer_ip,
    peerAsn: r.peer_asn,
    peerCountry: r.peer_country,
    protocol: r.protocol,
    portFamily: r.port_family,
    peerCategories: r.peer_categories,
    pairConfirmed: r.pair_confirmed,
    bytes: r.bytes_sum,
    flows: r.flow_count,
    distinctPorts: null,
  };
}

function hourlyToRow(r: HourlyFlow): Row {
  return {
    key: `${r.hour}|${r.monitored_ip}|${r.peer_ip}|${r.protocol}|${r.port_family}`,
    when: r.hour,
    monitoredIp: r.monitored_ip,
    peerIp: r.peer_ip,
    peerAsn: r.peer_asn,
    peerCountry: r.peer_country,
    protocol: r.protocol,
    portFamily: r.port_family,
    peerCategories: r.peer_categories,
    pairConfirmed: r.pair_confirmed,
    bytes: r.bytes_sum,
    flows: r.flow_count,
    distinctPorts: r.distinct_ports,
  };
}

// Driven by the value's own shape (a bare YYYY-MM-DD day vs. an hour
// timestamp), not by `tab` — during a tab switch a render can land with
// rows still in the previous granularity's shape before the fetch effect
// catches up, and formatting by `tab` instead would misread one as the
// other.
function fmtWhen(when: string): string {
  if (when.length === 10) return when; // already YYYY-MM-DD
  return `${new Date(when).toISOString().slice(0, 16).replace("T", " ")}Z`;
}

const DAILY_RANGES = [7, 14, 30] as const;
const HOURLY_RANGES = [6, 24, 48] as const;
const LIMIT = 3000;

export function Netflow() {
  const [tab, setTab] = useState<Tab>("daily");
  const [watchedIps, setWatchedIps] = useState<WatchedIp[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [dailyRange, setDailyRange] = useState<(typeof DAILY_RANGES)[number]>(7);
  const [hourlyRange, setHourlyRange] = useState<(typeof HOURLY_RANGES)[number]>(24);
  const [protocolFilter, setProtocolFilter] = useState<string>("");

  const [rawRows, setRawRows] = useState<DailyFlow[] | HourlyFlow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listIpsWatchIpsGet({ throwOnError: true })
      .then((r) => {
        if (!cancelled) setWatchedIps(r.data.rows);
      })
      .catch(() => {
        // The IP picker just falls back to a free-standing "all" option.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounce the free-text filters (peerIp, portFamily) so every keystroke
  // doesn't fire a request — monitoredIp/range are selects/buttons, so they
  // ride the same debounce for free.
  useEffect(() => {
    if (tab === "raw") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRawRows(null);

    const timer = setTimeout(() => {
      async function load() {
        try {
          if (tab === "daily") {
            const to = isoDate(new Date());
            const from = isoDate(daysAgo(dailyRange - 1));
            const result = await flowDailyRollupFlowDailyGet({
              query: {
                from,
                to,
                monitored_ip: filters.monitoredIp || undefined,
                peer_ip: filters.peerIp.trim() || undefined,
                port_family: filters.portFamily.trim() || undefined,
                limit: LIMIT,
              },
              throwOnError: true,
            });
            if (!cancelled) setRawRows(result.data.rows);
          } else {
            const to = new Date();
            const from = new Date(to.getTime() - hourlyRange * 3600 * 1000);
            const result = await flowHourlyRollupFlowHourlyGet({
              query: {
                from: from.toISOString(),
                to: to.toISOString(),
                monitored_ip: filters.monitoredIp || undefined,
                peer_ip: filters.peerIp.trim() || undefined,
                port_family: filters.portFamily.trim() || undefined,
                limit: LIMIT,
              },
              throwOnError: true,
            });
            if (!cancelled) setRawRows(result.data.rows);
          }
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        } finally {
          if (!cancelled) setLoading(false);
        }
      }
      void load();
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, filters.monitoredIp, filters.peerIp, filters.portFamily, dailyRange, hourlyRange]);

  const rows: Row[] = useMemo(() => (rawRows ?? []).map(toRow), [rawRows]);

  // Protocol has no query parameter on either rollup — the API groups by
  // it but doesn't filter by it — so this facet is built from, and applied
  // to, the rows already fetched.
  const protocolOptions = useMemo(() => [...new Set(rows.map((r) => r.protocol))].sort((a, b) => a - b), [rows]);

  const filteredRows = useMemo(() => {
    const scoped = protocolFilter ? rows.filter((r) => String(r.protocol) === protocolFilter) : rows;
    return [...scoped].sort((a, b) => (a.when === b.when ? b.bytes - a.bytes : b.when.localeCompare(a.when)));
  }, [rows, protocolFilter]);

  const totalBytes = filteredRows.reduce((s, r) => s + r.bytes, 0);

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setProtocolFilter("");
  }

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: "0 0 4px 0", fontSize: 22, fontWeight: 600 }}>Netflow</h1>
        <div style={{ fontSize: 13, color: "#6FA89E" }}>
          Rollup rows, filtered by monitored IP, peer IP, port family and protocol —{" "}
          <span className="mono">rollup__flow_daily</span> / <span className="mono">rollup__flow_hourly</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 28, borderBottom: "1px solid #2B7266", marginBottom: 22 }}>
        {(["daily", "hourly", "raw"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              all: "unset",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              padding: "9px 4px",
              color: tab === t ? "#E8FFF8" : "#6FA89E",
              borderBottom: tab === t ? "2px solid #4C8DFF" : "2px solid transparent",
            }}
          >
            {t === "daily" ? "Daily" : t === "hourly" ? "Hourly" : "Raw"}
          </button>
        ))}
      </div>

      {tab === "raw" ? (
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#F5A623" }}>Not servable</div>
          <div style={{ fontSize: 12, color: "#A6D8CD", lineHeight: 1.5 }}>
            <span className="mono">flow__records</span> — the individual netflow records before any
            rollup — isn't exposed by netflow-rollups' API. It's 180 days of raw rows, and per{" "}
            <span className="mono">netflow-rollups/docs/api.md</span>: "every question [the
            dashboard] asks of it is answered by a rollup or by /ops/freshness." Use the Hourly tab
            for the finest granularity the API actually serves — one row per (watched IP, peer,
            protocol, port family) and hour, with distinct-port counts. If a real investigation
            needs individual records, that's a new row to argue for on netflow-rollups' side, not
            something this page can fabricate.
          </div>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: "14px 18px", marginBottom: 18 }}>
            <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>Monitored IP</label>
                <select
                  value={filters.monitoredIp}
                  onChange={(e) => updateFilter("monitoredIp", e.target.value)}
                  style={{
                    background: "#0A2224",
                    color: "#E8FFF8",
                    border: "1px solid #2B7266",
                    borderRadius: 6,
                    padding: "6px 8px",
                    fontSize: 12,
                  }}
                >
                  <option value="">all {watchedIps.length}</option>
                  {watchedIps.map((w) => (
                    <option key={w.ip} value={w.ip}>
                      {w.ip}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>Peer IP (exact)</label>
                <input
                  type="text"
                  value={filters.peerIp}
                  onChange={(e) => updateFilter("peerIp", e.target.value)}
                  placeholder="203.0.113.5"
                  className="mono"
                  style={{
                    background: "#0A2224",
                    color: "#E8FFF8",
                    border: "1px solid #2B7266",
                    borderRadius: 6,
                    padding: "6px 8px",
                    fontSize: 12,
                    width: 160,
                  }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>Port family</label>
                <input
                  type="text"
                  list="port-family-suggestions"
                  value={filters.portFamily}
                  onChange={(e) => updateFilter("portFamily", e.target.value)}
                  placeholder="rtp_media"
                  className="mono"
                  style={{
                    background: "#0A2224",
                    color: "#E8FFF8",
                    border: "1px solid #2B7266",
                    borderRadius: 6,
                    padding: "6px 8px",
                    fontSize: 12,
                    width: 160,
                  }}
                />
                <datalist id="port-family-suggestions">
                  {PORT_FAMILY_SUGGESTIONS.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>Protocol</label>
                <select
                  value={protocolFilter}
                  onChange={(e) => setProtocolFilter(e.target.value)}
                  style={{
                    background: "#0A2224",
                    color: "#E8FFF8",
                    border: "1px solid #2B7266",
                    borderRadius: 6,
                    padding: "6px 8px",
                    fontSize: 12,
                  }}
                >
                  <option value="">all</option>
                  {protocolOptions.map((p) => (
                    <option key={p} value={p}>
                      {protocolName(p)}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>Window</label>
                <div style={{ display: "flex", gap: 4 }}>
                  {(tab === "daily" ? DAILY_RANGES : HOURLY_RANGES).map((n) => {
                    const active = tab === "daily" ? dailyRange === n : hourlyRange === n;
                    return (
                      <button
                        key={n}
                        onClick={() =>
                          tab === "daily"
                            ? setDailyRange(n as (typeof DAILY_RANGES)[number])
                            : setHourlyRange(n as (typeof HOURLY_RANGES)[number])
                        }
                        style={{
                          all: "unset",
                          cursor: "pointer",
                          fontSize: 11,
                          fontWeight: 500,
                          padding: "6px 10px",
                          borderRadius: 999,
                          border: `1px solid ${active ? "#3F9C8A" : "#2B7266"}`,
                          background: active ? "#133A3C" : "transparent",
                          color: active ? "#E8FFF8" : "#A6D8CD",
                        }}
                      >
                        {tab === "daily" ? `${n}d` : `${n}h`}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ flex: 1 }} />
              <button
                onClick={clearFilters}
                style={{ all: "unset", cursor: "pointer", fontSize: 11, color: "#7FEFD6", padding: "6px 4px" }}
              >
                clear filters
              </button>
            </div>
            <div style={{ fontSize: 11, color: "#6FA89E", marginTop: 10 }}>
              Protocol is filtered client-side from the rows already fetched — it isn't a query
              parameter netflow-rollups' API accepts. The rollups don't carry individual port
              numbers either, only <span className="mono">port_family</span>.
            </div>
          </div>

          {error && (
            <div className="card" style={{ padding: 20, borderColor: "#5A2327", marginBottom: 20 }}>
              Failed to load from netflow-rollups' API: {error}
            </div>
          )}

          <div className="card" style={{ overflowX: "auto" }}>
            <div
              style={{
                padding: "14px 20px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span className="src">
                {tab === "daily" ? "rollup__flow_daily" : "rollup__flow_hourly"} ·{" "}
                {loading ? "loading…" : `${filteredRows.length.toLocaleString()} rows · ${formatBytes(totalBytes)}`}
                {!loading && filteredRows.length >= LIMIT && (
                  <span style={{ color: "#F5A623" }}> · capped at {LIMIT.toLocaleString()}, narrow the filters</span>
                )}
              </span>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th>{tab === "daily" ? "Day" : "Hour"}</th>
                  <th>Monitored IP</th>
                  <th>Peer IP</th>
                  <th>Peer ASN / country</th>
                  <th>Protocol</th>
                  <th>Port family</th>
                  <th>Categories</th>
                  {tab === "hourly" && <th style={{ textAlign: "right" }}>Distinct ports</th>}
                  <th style={{ textAlign: "right" }}>Bytes</th>
                  <th style={{ textAlign: "right" }}>Flows</th>
                  <th>Confirmed</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr key={r.key}>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {fmtWhen(r.when)}
                    </td>
                    <td>
                      <Link to={`/entity/${r.monitoredIp}`} className="mono row-link">
                        {r.monitoredIp}
                      </Link>
                    </td>
                    <td>
                      <Link to={`/entity/${r.peerIp}`} className="mono row-link">
                        {r.peerIp}
                      </Link>
                    </td>
                    <td style={{ fontSize: 12, color: "#A6D8CD" }}>
                      {r.peerAsn ? `AS${r.peerAsn}` : "—"} {r.peerCountry ? `· ${r.peerCountry}` : ""}
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {protocolName(r.protocol)}
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {r.portFamily}
                    </td>
                    <td>
                      {r.peerCategories.length > 0 ? (
                        r.peerCategories.map((c) => {
                          const [bg, fg] = categoryColors(c);
                          return (
                            <span
                              key={c}
                              className="chip"
                              style={{ background: bg, color: fg, fontSize: 10, marginRight: 4 }}
                            >
                              {c.replace(/_/g, " ")}
                            </span>
                          );
                        })
                      ) : (
                        <span style={{ color: "#6FA89E", fontSize: 11 }}>—</span>
                      )}
                    </td>
                    {tab === "hourly" && (
                      <td className="num mono" style={{ textAlign: "right" }}>
                        {r.distinctPorts}
                      </td>
                    )}
                    <td className="num mono" style={{ textAlign: "right" }}>
                      {formatBytes(r.bytes)}
                    </td>
                    <td className="num mono" style={{ textAlign: "right" }}>
                      {r.flows.toLocaleString()}
                    </td>
                    <td style={{ color: r.pairConfirmed ? "#3DD68C" : "#6FA89E", fontSize: 12 }}>
                      {r.pairConfirmed ? "yes" : "—"}
                    </td>
                  </tr>
                ))}
                {!loading && filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={tab === "hourly" ? 11 : 10} style={{ color: "#6FA89E" }}>
                      No rows match these filters in this window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
