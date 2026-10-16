import { useEffect, useState } from "react";
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
          Same hash = identical extracted facts (port, protocol, software name/version — banner
          text and scan time are excluded by design). Not shown yet: a day-by-day fingerprint
          grid and diffs between consecutive scans, and the Netflow-side daily traffic/peers
          tabs from the mockup — this page covers the fingerprint drill-down that was missing,
          not full parity with <span className="mono">EntityDetail.dc.html</span>.
        </div>
      </div>
    </>
  );
}
