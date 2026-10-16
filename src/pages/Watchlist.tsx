import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  listIpsWatchIpsGet,
  listIpRolesReviewIpRolesGet,
  portFamilyMixDailyRollupPortFamilyMixDailyGet,
  providerMixDailyRollupProviderMixDailyGet,
  bphContactDailyRollupBphContactDailyGet,
  unclassifiedContactsDailyRollupUnclassifiedContactsDailyGet,
  hostScanChangesLookupHostScansChangesGet,
  freshnessOpsFreshnessGet,
  type WatchedIp,
  type IpRole,
  type DailyPortFamilyMix,
  type DailyProviderMix,
  type DailyBphContact,
  type DailyUnclassifiedContact,
  type FingerprintChange,
  type Freshness,
} from "../api/netflow-rollups-client";
import { formatBytes, formatShortDate, isoDate, daysAgo, blueToWhite } from "../lib/format";
import { categoryColors } from "../lib/categories";

type WatchlistData = {
  watchedIps: WatchedIp[];
  ipRolesWatched: IpRole[];
  portFamilyMix7d: DailyPortFamilyMix[];
  providerMix7d: DailyProviderMix[];
  bphContact30d: DailyBphContact[];
  unclassified7d: DailyUnclassifiedContact[];
  fingerprintChanges7d: FingerprintChange[];
  freshness: Freshness;
};

function groupSum<T>(rows: T[], keyFn: (r: T) => string, valFn: (r: T) => number): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = keyFn(r);
    m.set(k, (m.get(k) ?? 0) + valFn(r));
  }
  return m;
}

export function Watchlist() {
  const [data, setData] = useState<WatchlistData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const to = isoDate(new Date());
        const from30 = isoDate(daysAgo(29));

        const [
          watchedIps,
          ipRolesWatched,
          portFamilyMix7d,
          providerMix7d,
          bphContact30d,
          unclassified7d,
          fingerprintChanges7d,
          freshness,
        ] = await Promise.all([
          listIpsWatchIpsGet({ throwOnError: true }),
          listIpRolesReviewIpRolesGet({ query: { vantage: "watched" }, throwOnError: true }),
          portFamilyMixDailyRollupPortFamilyMixDailyGet({ throwOnError: true }),
          providerMixDailyRollupProviderMixDailyGet({ throwOnError: true }),
          bphContactDailyRollupBphContactDailyGet({
            query: { from: from30, to },
            throwOnError: true,
          }),
          unclassifiedContactsDailyRollupUnclassifiedContactsDailyGet({ throwOnError: true }),
          hostScanChangesLookupHostScansChangesGet({
            query: { subject: "watched" },
            throwOnError: true,
          }),
          freshnessOpsFreshnessGet({ throwOnError: true }),
        ]);

        if (cancelled) return;
        setData({
          watchedIps: watchedIps.data.rows,
          ipRolesWatched: ipRolesWatched.data.rows,
          portFamilyMix7d: portFamilyMix7d.data.rows,
          providerMix7d: providerMix7d.data.rows,
          bphContact30d: bphContact30d.data.rows,
          unclassified7d: unclassified7d.data.rows,
          fingerprintChanges7d: fingerprintChanges7d.data.rows,
          freshness: freshness.data,
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

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: "0 0 4px 0", fontSize: 22, fontWeight: 600 }}>Watchlist</h1>
        <div style={{ fontSize: 13, color: "#6FA89E" }}>
          {data ? `${data.watchedIps.length} monitored IPs · one row per watch__ips entry` : "Loading…"}
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: 20, borderColor: "#5A2327" }}>
          Failed to load from netflow-rollups' API: {error}
        </div>
      )}

      {!data && !error && <div style={{ color: "#6FA89E" }}>Loading…</div>}

      {data && <WatchlistTable data={data} />}
    </>
  );
}

function WatchlistTable({ data }: { data: WatchlistData }) {
  const {
    watchedIps,
    ipRolesWatched,
    portFamilyMix7d,
    providerMix7d,
    bphContact30d,
    unclassified7d,
    fingerprintChanges7d,
    freshness,
  } = data;

  const staleChecks = freshness.checks.filter((c) => c.stale);

  const roleByIp = new Map(ipRolesWatched.map((r) => [r.ip, r]));

  const bytesByIp = groupSum(portFamilyMix7d, (r) => r.monitored_ip, (r) => r.bytes_sum);
  const rtpByIp = groupSum(
    portFamilyMix7d.filter((r) => r.port_family === "rtp_media"),
    (r) => r.monitored_ip,
    (r) => r.bytes_sum,
  );

  const categoryByIp = new Map<string, Map<string, number>>();
  for (const r of providerMix7d) {
    const m = categoryByIp.get(r.monitored_ip) ?? new Map<string, number>();
    m.set(r.provider_category, (m.get(r.provider_category) ?? 0) + r.bytes_sum);
    categoryByIp.set(r.monitored_ip, m);
  }
  function dominantCategory(ip: string): string | null {
    const m = categoryByIp.get(ip);
    if (!m) return null;
    let best: string | null = null;
    let bestBytes = -1;
    for (const [cat, bytes] of m) {
      if (cat === "unclassified") continue;
      if (bytes > bestBytes) {
        best = cat;
        bestBytes = bytes;
      }
    }
    return best;
  }

  const bphByIp = groupSum(bphContact30d, (r) => r.monitored_ip, (r) => r.bytes_sum);

  const unclPeersByIp = new Map<string, Set<string>>();
  for (const r of unclassified7d) {
    const s = unclPeersByIp.get(r.monitored_ip) ?? new Set<string>();
    s.add(r.peer_ip);
    unclPeersByIp.set(r.monitored_ip, s);
  }

  const fpByIp = new Map<string, FingerprintChange[]>();
  for (const r of fingerprintChanges7d) {
    const list = fpByIp.get(r.ip) ?? [];
    list.push(r);
    fpByIp.set(r.ip, list);
  }

  const sortedIps = [...watchedIps].sort((a, b) => (bytesByIp.get(b.ip) ?? 0) - (bytesByIp.get(a.ip) ?? 0));

  return (
    <>
      {freshness.checks.length > 0 && (
        <div className={`banner ${staleChecks.length > 0 ? "stale" : "ok"}`} style={{ marginBottom: 16 }}>
          <span className="dot" style={{ background: staleChecks.length > 0 ? "#E5484D" : "#3DD68C" }} />
          {staleChecks.length > 0 ? (
            <span>
              <b style={{ color: "#E5484D" }}>
                {staleChecks.length === 1 ? staleChecks[0].name + " feed stale" : `${staleChecks.length} feeds stale`}
              </b>
            </span>
          ) : (
            <span>All freshness checks ok</span>
          )}
        </div>
      )}

      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
          <thead>
            <tr>
              <th>
                Monitored IP · <span style={{ color: "#F5A623" }}>reviewed role</span> ·{" "}
                <span style={{ color: "#C6EBE2" }}>TIP labels</span>
              </th>
              <th style={{ textAlign: "right" }}>Bytes 7d</th>
              <th>RTP share</th>
              <th>Peer category</th>
              <th style={{ textAlign: "right" }}>BPH 30d</th>
              <th style={{ textAlign: "right" }}>Uncl. peers</th>
              <th>Fingerprint (7d)</th>
            </tr>
          </thead>
          <tbody>
            {sortedIps.map((ip) => {
              const role = roleByIp.get(ip.ip);
              const bytes = bytesByIp.get(ip.ip) ?? 0;
              const rtpBytes = rtpByIp.get(ip.ip) ?? 0;
              const rtpPct = bytes > 0 ? Math.round((rtpBytes / bytes) * 100) : 0;
              const category = dominantCategory(ip.ip);
              const bph = bphByIp.get(ip.ip) ?? 0;
              const unclCount = unclPeersByIp.get(ip.ip)?.size ?? 0;
              const fpRows = fpByIp.get(ip.ip) ?? [];
              const fpScans = fpRows.reduce((s, r) => s + r.scans, 0);
              const fpHashes = fpRows.reduce((s, r) => s + r.distinct_fingerprints, 0);
              const fpLast = fpRows.reduce((max, r) => (r.last_fetched_at > max ? r.last_fetched_at : max), "");
              const tips = ip.tags.filter((t) => !t.startsWith("msk:"));

              return (
                <tr key={ip.ip}>
                  <td>
                    <Link to={`/entity/${ip.ip}`} className="mono row-link">
                      {ip.ip}
                    </Link>
                    <br />
                    {role?.accepted_role ? (
                      <span className="chip rev">{role.accepted_role}</span>
                    ) : role ? (
                      <span
                        className="chip pend"
                        title="review__ip_roles.proposed_role — heuristic only, not yet accepted by a human"
                      >
                        proposed {role.proposed_role} · pending
                      </span>
                    ) : null}
                    <br />
                    <span className="chip">msk:voip_analysis</span>
                    {tips.map((t) => (
                      <span className="chip tip" key={t} title="OpenCTI label — an analyst's suggestion, read by no logic">
                        {t}
                      </span>
                    ))}
                  </td>
                  <td className="num mono" style={{ textAlign: "right" }}>
                    {formatBytes(bytes)}
                  </td>
                  <td>
                    <span className="rtp" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span className="trk" style={{ width: 56, height: 6, background: "#133A3C", borderRadius: 3, overflow: "hidden", display: "inline-block" }}>
                        <span className="fil" style={{ width: `${rtpPct}%`, height: "100%", background: blueToWhite(rtpPct), display: "block" }} />
                      </span>
                      <span className="mono" style={{ fontSize: 12, color: rtpPct < 5 ? "#6FA89E" : undefined }}>
                        {rtpPct}%
                      </span>
                    </span>
                  </td>
                  <td>
                    {category && (
                      <span
                        className="cat"
                        style={{
                          background: categoryColors(category)[0],
                          color: categoryColors(category)[1],
                          fontSize: 11,
                          fontWeight: 500,
                          padding: "3px 9px",
                          borderRadius: 5,
                          display: "inline-block",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {category.replace(/_/g, " ")}
                      </span>
                    )}
                  </td>
                  <td
                    className="num mono"
                    style={{
                      textAlign: "right",
                      color: bph >= 1_000_000 ? "#E5484D" : bph >= 100_000 ? "#A6D8CD" : "#6FA89E",
                      fontWeight: bph >= 1_000_000 ? 600 : undefined,
                    }}
                  >
                    {bph > 0 ? formatBytes(bph) : "—"}
                  </td>
                  <td
                    className="num mono"
                    style={{
                      textAlign: "right",
                      color: unclCount >= 300 ? "#F5A623" : undefined,
                      fontWeight: unclCount >= 300 ? 600 : undefined,
                    }}
                  >
                    {unclCount}
                  </td>
                  <td className="fp" style={{ fontSize: 12, lineHeight: 1.4, whiteSpace: "nowrap" }}>
                    {fpRows.length === 0 ? (
                      <span style={{ color: "#6FA89E" }}>no scans</span>
                    ) : fpHashes <= fpRows.length ? (
                      <span style={{ color: "#3DD68C" }}>stable</span>
                    ) : (
                      <span style={{ color: "#F5A623" }}>changed ×{fpHashes - fpRows.length}</span>
                    )}
                    <br />
                    <span style={{ color: "#6FA89E", fontSize: 11 }}>
                      {fpScans} scans · last {fpLast ? formatShortDate(fpLast) : "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="note">
          Sources, per column: <span className="mono">review__ip_roles</span> (reviewed role) ·{" "}
          <span className="mono">watch__ips.tags</span> (TIP labels, analyst suggestions, read by
          no logic) · <span className="mono">rollup__port_family_mix_daily</span> (bytes, RTP
          share) · <span className="mono">rollup__provider_mix_daily</span> (dominant category,
          excluding unclassified) · <span className="mono">rollup__bph_contact_daily</span> (30d) ·{" "}
          <span className="mono">rollup__unclassified_contacts_daily</span> (distinct peers, 7d) ·{" "}
          <span className="mono">lookup__host_scans/changes</span> (scans/distinct fingerprints
          summed across censys + shodan — an approximation, not a true cross-source dedup). Red BPH
          ≥ 1 MB; orange unclassified ≥ 300 peers.
          <br />
          <b style={{ color: "#E8FFF8" }}>Not shown: last record per IP.</b>{" "}
          <span className="mono">flow__records</span> isn't served by the API (it's 180 days of
          raw rows); every other question here is answered by a rollup. If this column turns out
          to matter, that's a new row to argue for on netflow-rollups' side.
        </div>
      </div>
    </>
  );
}
