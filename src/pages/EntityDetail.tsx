import { Fragment, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getIpWatchIpsIpGet,
  getIpRoleReviewIpRolesIpGet,
  getIpIdentityLookupIpIdentitiesIpGet,
  listHostScansLookupHostScansGet,
  hostScanChangesLookupHostScansChangesGet,
  bphContactDailyRollupBphContactDailyGet,
  portFamilyMixDailyRollupPortFamilyMixDailyGet,
  type WatchedIp,
  type IpRole,
  type IpIdentity,
  type HostScan,
  type FingerprintChange,
} from "../api/netflow-rollups-client";
import { formatBytes, isoDate, daysAgo } from "../lib/format";

type EntityData = {
  watchedIp: WatchedIp;
  role: IpRole | null;
  identity: IpIdentity | null;
  scans: HostScan[];
  changes: FingerprintChange[];
  bphBytes30d: number;
  bytes7d: number;
  rtpBytes7d: number;
};

function factLabel(fact: Record<string, unknown>): string {
  const port = fact.port;
  const transport = fact.transport_protocol;
  const service = fact.service_protocol;
  const software = fact.software_name;
  const version = fact.software_version;
  const parts = [`${port}/${transport}`];
  if (service) parts.push(String(service));
  if (software) parts.push(`${software}${version ? " " + version : ""}`);
  return parts.join(" · ");
}

function factKey(fact: Record<string, unknown>): string {
  return `${fact.port}/${fact.transport_protocol}`;
}

function dayOf(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

type GridCell = { day: string; status: "first" | "same" | "changed" | "miss"; scan?: HostScan };
type Transition = { source: string; fromDay: string; toDay: string; fromScan: HostScan; toScan: HostScan };

function buildFingerprintGrid(scans: HostScan[]) {
  const allDays = [...new Set(scans.map((s) => dayOf(s.scan_time)).filter((d): d is string => d !== null))].sort();
  const gridDays = allDays.slice(-10);

  const scanByDaySource = new Map<string, Map<string, HostScan>>();
  for (const s of scans) {
    const day = dayOf(s.scan_time);
    if (!day) continue;
    const bySource = scanByDaySource.get(s.source) ?? new Map<string, HostScan>();
    const existing = bySource.get(day);
    if (!existing || (s.scan_time ?? "") > (existing.scan_time ?? "")) bySource.set(day, s);
    scanByDaySource.set(s.source, bySource);
  }

  const gridBySource = new Map<string, GridCell[]>();
  const transitions: Transition[] = [];

  for (const [source, bySource] of scanByDaySource) {
    let lastHash: string | null = null;
    let lastDay: string | null = null;
    let lastScan: HostScan | null = null;
    const cells: GridCell[] = [];
    for (const day of gridDays) {
      const scan = bySource.get(day);
      if (!scan) {
        cells.push({ day, status: "miss" });
        continue;
      }
      if (lastHash === null) {
        cells.push({ day, status: "first", scan });
      } else if (scan.fingerprint_hash === lastHash) {
        cells.push({ day, status: "same", scan });
      } else {
        cells.push({ day, status: "changed", scan });
        transitions.push({ source, fromDay: lastDay!, toDay: day, fromScan: lastScan!, toScan: scan });
      }
      lastHash = scan.fingerprint_hash;
      lastDay = day;
      lastScan = scan;
    }
    gridBySource.set(source, cells);
  }

  return { gridDays, gridBySource, transitions };
}

function diffFacts(from: HostScan, to: HostScan) {
  const fromMap = new Map(from.fingerprint_facts.map((f) => [factKey(f as Record<string, unknown>), f]));
  const toMap = new Map(to.fingerprint_facts.map((f) => [factKey(f as Record<string, unknown>), f]));
  const removed = [...fromMap.keys()].filter((k) => !toMap.has(k)).map((k) => fromMap.get(k)!);
  const added = [...toMap.keys()].filter((k) => !fromMap.has(k)).map((k) => toMap.get(k)!);
  return { added, removed };
}

const CELL_COLORS: Record<GridCell["status"], { bg: string; border: string; color: string }> = {
  first: { bg: "#0F3133", border: "#2B7266", color: "#A6D8CD" },
  same: { bg: "#153226", border: "#1E4D37", color: "#3DD68C" },
  changed: { bg: "#2A2013", border: "#5A4423", color: "#F5A623" },
  miss: { bg: "transparent", border: "#3F9C8A", color: "#6FA89E" },
};

export function EntityDetail() {
  const { ip } = useParams<{ ip: string }>();
  const [data, setData] = useState<EntityData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ip) return;
    let cancelled = false;

    async function load() {
      try {
        const to = isoDate(new Date());
        const from30 = isoDate(daysAgo(29));

        const [watchedIp, role, identityResult, scans, changes, bphContact30d, portFamilyMix7d] =
          await Promise.all([
            getIpWatchIpsIpGet({ path: { ip: ip! }, throwOnError: true }),
            getIpRoleReviewIpRolesIpGet({ path: { ip: ip! }, throwOnError: true }).catch(() => null),
            getIpIdentityLookupIpIdentitiesIpGet({ path: { ip: ip! } }),
            listHostScansLookupHostScansGet({
              query: { ip: ip!, from: from30, to, limit: 200 },
              throwOnError: true,
            }),
            hostScanChangesLookupHostScansChangesGet({
              query: { ip: ip!, from: from30, to },
              throwOnError: true,
            }),
            bphContactDailyRollupBphContactDailyGet({
              query: { monitored_ip: ip!, from: from30, to },
              throwOnError: true,
            }),
            portFamilyMixDailyRollupPortFamilyMixDailyGet({
              query: { monitored_ip: ip! },
              throwOnError: true,
            }),
          ]);

        if (cancelled) return;
        const bytes7d = portFamilyMix7d.data.rows.reduce((s, r) => s + r.bytes_sum, 0);
        const rtpBytes7d = portFamilyMix7d.data.rows
          .filter((r) => r.port_family === "rtp_media")
          .reduce((s, r) => s + r.bytes_sum, 0);

        setData({
          watchedIp: watchedIp.data,
          role: role?.data ?? null,
          identity: identityResult.data ?? null,
          scans: scans.data.rows,
          changes: changes.data.rows,
          bphBytes30d: bphContact30d.data.rows.reduce((s, r) => s + r.bytes_sum, 0),
          bytes7d,
          rtpBytes7d,
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [ip]);

  return (
    <>
      <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 10 }}>
        <Link to="/watchlist">Watchlist</Link> / Entity
      </div>

      {error && (
        <div className="card" style={{ padding: 20, borderColor: "#5A2327" }}>
          Failed to load from netflow-rollups' API: {error}
        </div>
      )}
      {!data && !error && <div style={{ color: "#6FA89E" }}>Loading…</div>}
      {data && <EntityContent ip={ip!} data={data} />}
    </>
  );
}

function EntityContent({ ip, data }: { ip: string; data: EntityData }) {
  const { watchedIp, role, identity, scans, changes, bphBytes30d, bytes7d, rtpBytes7d } = data;
  const rtpPct = bytes7d > 0 ? Math.round((rtpBytes7d / bytes7d) * 100) : 0;
  const tips = watchedIp.tags.filter((t) => !t.startsWith("msk:"));

  const scansBySource = new Map<string, HostScan[]>();
  for (const s of scans) {
    const list = scansBySource.get(s.source) ?? [];
    list.push(s);
    scansBySource.set(s.source, list);
  }
  for (const list of scansBySource.values()) {
    list.sort((a, b) => (b.scan_time ?? "").localeCompare(a.scan_time ?? ""));
  }
  const changesBySource = new Map(changes.map((c) => [c.source, c]));
  const { gridDays, gridBySource, transitions } = buildFingerprintGrid(scans);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6, flexWrap: "wrap" }}>
        <h1 className="mono" style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
          {ip}
        </h1>
        {role?.accepted_role ? (
          <span className="chip rev">{role.accepted_role}</span>
        ) : role ? (
          <span
            className="chip pend"
            title="review__ip_roles.proposed_role — heuristic only, not yet accepted by a human"
          >
            proposed {role.proposed_role} · pending
          </span>
        ) : (
          <span className="chip" style={{ color: "#6FA89E" }}>
            no role yet
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
        <span className="chip">msk:voip_analysis</span>
        {tips.map((t) => (
          <span
            className="chip tip"
            key={t}
            title="OpenCTI label (watch__ips.tags) — an analyst's suggestion, read by no logic"
          >
            {t}
          </span>
        ))}
        {tips.length > 0 && (
          <span style={{ fontSize: 11, color: "#6FA89E" }}>
            reviewed role and TIP label are shown separately on purpose
          </span>
        )}
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
          <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 6 }}>Added to watch set</div>
          <div className="mono" style={{ fontSize: 15, fontWeight: 600 }}>
            {watchedIp.added_at.slice(0, 10)}
          </div>
        </div>
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 6 }}>Bytes (7d)</div>
          <div className="mono" style={{ fontSize: 15, fontWeight: 600 }}>
            {formatBytes(bytes7d)}
          </div>
        </div>
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 6 }}>RTP share (7d)</div>
          <div className="mono" style={{ fontSize: 15, fontWeight: 600 }}>
            {rtpPct}%
          </div>
        </div>
        <div className="card" style={{ padding: "16px 20px", borderColor: bphBytes30d >= 1_000_000 ? "#5A2327" : undefined }}>
          <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 6 }}>BPH contact (30d)</div>
          <div
            className="mono"
            style={{ fontSize: 15, fontWeight: 600, color: bphBytes30d >= 1_000_000 ? "#E5484D" : undefined }}
          >
            {bphBytes30d > 0 ? formatBytes(bphBytes30d) : "—"}
          </div>
        </div>
        {identity && (
          <div className="card" style={{ padding: "16px 20px" }}>
            <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 6 }}>ASN / country</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {identity.asn ? `AS${identity.asn}` : "—"} {identity.asn_holder ?? ""}
              {identity.country && (
                <span style={{ color: "#6FA89E", fontWeight: 500 }}> · {identity.country}</span>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Device fingerprint</div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {[...scansBySource.keys()].sort().map((source) => {
          const summary = changesBySource.get(source);
          const latest = scansBySource.get(source)?.[0];
          const stable = summary ? summary.distinct_fingerprints <= 1 : true;
          return (
            <div
              className="card"
              style={{ padding: "16px 20px", borderColor: stable ? undefined : "#5A4423" }}
              key={source}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 12, color: "#6FA89E" }}>{source}</div>
                <span className="src">lookup__host_scans</span>
              </div>
              <div
                className="mono"
                style={{ fontSize: 15, fontWeight: 600, margin: "6px 0 4px 0", color: stable ? "#3DD68C" : "#F5A623" }}
              >
                {stable ? "stable" : `changed ×${(summary?.distinct_fingerprints ?? 1) - 1}`}
              </div>
              <div style={{ fontSize: 12, color: "#A6D8CD" }}>
                {summary?.scans ?? 0} scans · {latest?.fingerprint_facts.length ?? 0} services · last{" "}
                {latest?.scan_time?.slice(0, 10) ?? "—"}
              </div>
            </div>
          );
        })}
        {scansBySource.size === 0 && (
          <div className="card" style={{ padding: "16px 20px", color: "#6FA89E" }}>
            No scans in the last 30 days.
          </div>
        )}
      </div>

      {gridDays.length > 0 && (
        <div className="card" style={{ padding: "22px 24px", marginBottom: 24 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 14,
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              Fingerprint history — one cell per daily scan
            </div>
            <span className="src">
              lookup__host_scans.fingerprint_hash · {gridDays[0]} → {gridDays[gridDays.length - 1]}
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `64px repeat(${gridDays.length}, 1fr)`,
              gap: 6,
              alignItems: "center",
            }}
          >
            <div />
            {gridDays.map((day) => (
              <div key={day} className="mono" style={{ fontSize: 10, color: "#6FA89E", textAlign: "center" }}>
                {day.slice(5)}
              </div>
            ))}
            {[...gridBySource.entries()].map(([source, cells]) => (
              <Fragment key={source}>
                <div style={{ fontSize: 12, color: "#A6D8CD" }}>
                  {source}
                </div>
                {cells.map((cell) => {
                  const colors = CELL_COLORS[cell.status];
                  const isMiss = cell.status === "miss";
                  return (
                    <div
                      key={`${source}-${cell.day}`}
                      className="mono"
                      title={
                        cell.scan
                          ? `${cell.day} · ${cell.scan.fingerprint_facts.length} services`
                          : `${cell.day} · no row`
                      }
                      style={{
                        height: 34,
                        borderRadius: 5,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        border: `1px ${isMiss ? "dashed" : "solid"} ${colors.border}`,
                        background: colors.bg,
                        color: colors.color,
                        fontWeight: cell.status === "changed" ? 600 : 400,
                      }}
                    >
                      {cell.scan ? cell.scan.fingerprint_hash.slice(0, 6) : "—"}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
          <div className="note">
            Same hash = identical extracted facts (port, protocol, software name/version — banner
            text and scan time excluded by design, so a changed hash is a real service change).
            Orange = differs from the previous scan for that source. Dashed = no row that day.
          </div>
        </div>
      )}

      {transitions.length > 0 && (
        <div className="card" style={{ padding: "22px 24px", marginBottom: 24 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 6,
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>What changed</div>
            <span className="src">diff of consecutive fingerprint_facts</span>
          </div>
          {transitions.map((t, i) => {
            const { added, removed } = diffFacts(t.fromScan, t.toScan);
            return (
              <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid #133A3C" }}>
                <div style={{ fontSize: 12, color: "#A6D8CD", marginBottom: 4 }}>
                  <span className="mono">{t.source}</span> · {t.fromDay} → {t.toDay}
                </div>
                {removed.map((f, j) => (
                  <div key={`r${j}`} style={{ fontSize: 13, display: "flex", gap: 10 }}>
                    <span className="mono" style={{ color: "#E5484D", fontWeight: 700 }}>
                      −
                    </span>
                    <span className="mono">{factLabel(f as Record<string, unknown>)}</span>
                  </div>
                ))}
                {added.map((f, j) => (
                  <div key={`a${j}`} style={{ fontSize: 13, display: "flex", gap: 10 }}>
                    <span className="mono" style={{ color: "#3DD68C", fontWeight: 700 }}>
                      +
                    </span>
                    <span className="mono">{factLabel(f as Record<string, unknown>)}</span>
                  </div>
                ))}
                {added.length === 0 && removed.length === 0 && (
                  <div style={{ fontSize: 12, color: "#6FA89E" }}>
                    Hash changed but facts look identical (likely a field outside the compared set).
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="card" style={{ padding: "22px 24px", marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 14,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600 }}>Open services — latest scan per source</div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th>Source</th>
              <th>Service</th>
              <th>Scanned</th>
            </tr>
          </thead>
          <tbody>
            {[...scansBySource.entries()].flatMap(([source, list]) => {
              const latest = list[0];
              if (!latest || latest.fingerprint_facts.length === 0) {
                return [
                  <tr key={source}>
                    <td className="mono">{source}</td>
                    <td style={{ color: "#6FA89E" }}>no open services</td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {latest?.scan_time?.slice(0, 16).replace("T", " ") ?? "—"}
                    </td>
                  </tr>,
                ];
              }
              return latest.fingerprint_facts.map((fact, i) => (
                <tr key={`${source}-${i}`}>
                  <td className="mono">{source}</td>
                  <td className="mono">{factLabel(fact as Record<string, unknown>)}</td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {i === 0 ? latest.scan_time?.slice(0, 16).replace("T", " ") : ""}
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ padding: "22px 24px" }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Scan history (30d)</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th>Scanned</th>
              <th>Source</th>
              <th>Fingerprint</th>
              <th style={{ textAlign: "right" }}>Services</th>
            </tr>
          </thead>
          <tbody>
            {scans
              .slice()
              .sort((a, b) => (b.scan_time ?? "").localeCompare(a.scan_time ?? ""))
              .slice(0, 30)
              .map((s) => (
                <tr key={s.id}>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {s.scan_time?.slice(0, 16).replace("T", " ") ?? "—"}
                  </td>
                  <td className="mono">{s.source}</td>
                  <td className="mono" style={{ fontSize: 12, color: "#A6D8CD" }}>
                    {s.fingerprint_hash.slice(0, 10)}…
                  </td>
                  <td className="num mono" style={{ textAlign: "right" }}>
                    {s.fingerprint_facts.length}
                  </td>
                </tr>
              ))}
            {scans.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: "#6FA89E" }}>
                  No scans in the last 30 days.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="note">
          Not shown yet: the Netflow-side daily traffic/peers tabs from the mockup (that's a
          separate, monitored-IP-keyed view) — this page covers the device-fingerprint drill-down
          in full, not the rest of <span className="mono">EntityDetail.dc.html</span>.
        </div>
      </div>
    </>
  );
}
