import { useEffect, useState } from "react";
import {
  listIpsWatchIpsGet,
  listIpRolesReviewIpRolesGet,
  queueReviewQueueGet,
  portFamilyMixDailyRollupPortFamilyMixDailyGet,
  unclassifiedContactsDailyRollupUnclassifiedContactsDailyGet,
  providerMixDailyRollupProviderMixDailyGet,
  bphContactDailyRollupBphContactDailyGet,
  topPeersRollupFlowDailyTopPeersGet,
  hostScanChangesLookupHostScansChangesGet,
  freshnessOpsFreshnessGet,
  type WatchedIp,
  type IpRole,
  type ReviewQueue,
  type DailyPortFamilyMix,
  type DailyUnclassifiedContact,
  type DailyProviderMix,
  type DailyBphContact,
  type TopPeer,
  type FingerprintChange,
  type Freshness,
} from "../api/netflow-rollups-client";
import { formatBytes, formatShortDate, isoDate, daysAgo } from "../lib/format";

type OverviewData = {
  watchedIps: WatchedIp[];
  ipRolesWatched: IpRole[];
  queue: ReviewQueue;
  portFamilyMix7d: DailyPortFamilyMix[];
  unclassified7d: DailyUnclassifiedContact[];
  providerMix7d: DailyProviderMix[];
  bphContact30d: DailyBphContact[];
  topRtpTalkers7d: TopPeer[];
  fingerprintChanges7d: FingerprintChange[];
  freshness: Freshness;
};

const CATEGORY_COLORS: Record<string, string> = {
  cloud: "#4C8DFF",
  bph: "#E5484D",
  satellite: "#8B5CF6",
  mobile: "#F59E0B",
  residential_isp: "#2DD4BF",
  educational: "#60A5FA",
  wholesale_voip: "#EC4899",
  reverse_proxy: "#A3A3A3",
  unclassified: "#6FA89E",
};
const FALLBACK_COLORS = ["#4C8DFF", "#8B5CF6", "#F59E0B", "#2DD4BF", "#EC4899", "#60A5FA"];

function categoryColor(category: string, indexIfUnknown: number): string {
  return CATEGORY_COLORS[category] ?? FALLBACK_COLORS[indexIfUnknown % FALLBACK_COLORS.length];
}

export function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
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
          queue,
          portFamilyMix7d,
          unclassified7d,
          providerMix7d,
          bphContact30d,
          topRtpTalkers7d,
          fingerprintChanges7d,
          freshness,
        ] = await Promise.all([
          listIpsWatchIpsGet({ throwOnError: true }),
          listIpRolesReviewIpRolesGet({
            query: { vantage: "watched" },
            throwOnError: true,
          }),
          queueReviewQueueGet({ throwOnError: true }),
          portFamilyMixDailyRollupPortFamilyMixDailyGet({ throwOnError: true }),
          unclassifiedContactsDailyRollupUnclassifiedContactsDailyGet({
            throwOnError: true,
          }),
          providerMixDailyRollupProviderMixDailyGet({ throwOnError: true }),
          bphContactDailyRollupBphContactDailyGet({
            query: { from: from30, to },
            throwOnError: true,
          }),
          topPeersRollupFlowDailyTopPeersGet({
            query: {
              port_family: "rtp_media",
              exclude_confirmed: true,
              exclude_watched: true,
              limit: 5,
            },
            throwOnError: true,
          }),
          hostScanChangesLookupHostScansChangesGet({ throwOnError: true }),
          freshnessOpsFreshnessGet({ throwOnError: true }),
        ]);

        if (cancelled) return;
        setData({
          watchedIps: watchedIps.data.rows,
          ipRolesWatched: ipRolesWatched.data.rows,
          queue: queue.data,
          portFamilyMix7d: portFamilyMix7d.data.rows,
          unclassified7d: unclassified7d.data.rows,
          providerMix7d: providerMix7d.data.rows,
          bphContact30d: bphContact30d.data.rows,
          topRtpTalkers7d: topRtpTalkers7d.data.rows,
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
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 28,
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ margin: "0 0 4px 0", fontSize: 22, fontWeight: 600 }}>Overview</h1>
          <div style={{ fontSize: 13, color: "#6FA89E" }}>
            Live from netflow-rollups' API · {data ? `as of ${new Date().toLocaleTimeString()}` : "loading…"}
          </div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: 20, borderColor: "#5A2327", marginBottom: 20 }}>
          Failed to load from netflow-rollups' API: {error}
        </div>
      )}

      {!data && !error && <div style={{ color: "#6FA89E" }}>Loading…</div>}

      {data && <OverviewContent data={data} />}
    </>
  );
}

function OverviewContent({ data }: { data: OverviewData }) {
  const {
    watchedIps,
    ipRolesWatched,
    queue,
    portFamilyMix7d,
    unclassified7d,
    providerMix7d,
    bphContact30d,
    topRtpTalkers7d,
    fingerprintChanges7d,
    freshness,
  } = data;

  // -- stale-feed banner --
  const staleChecks = freshness.checks.filter((c) => c.stale);

  // -- active monitored IPs --
  const newestIp = [...watchedIps].sort((a, b) => b.added_at.localeCompare(a.added_at))[0];

  // -- reviewed roles (watched) --
  const acceptedCount = ipRolesWatched.filter((r) => r.accepted_role).length;
  const proposedBreakdown = new Map<string, number>();
  for (const r of ipRolesWatched) {
    if (r.accepted_role) continue;
    proposedBreakdown.set(r.proposed_role, (proposedBreakdown.get(r.proposed_role) ?? 0) + 1);
  }
  const proposedLine = [...proposedBreakdown.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([role, count]) => `${count} ${role}`)
    .join(", ");

  // -- TIP labels on watched IPs (analyst suggestions only; msk:* is the automated label) --
  const tagCounts = new Map<string, number>();
  for (const ip of watchedIps) {
    for (const tag of ip.tags) {
      if (tag.startsWith("msk:")) continue;
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const totalTags = [...tagCounts.values()].reduce((a, b) => a + b, 0);
  const tagLine = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => `${count} ${tag}`)
    .join(" · ");

  // -- RTP volume (7d) --
  const rtpBytes = portFamilyMix7d
    .filter((r) => r.port_family === "rtp_media")
    .reduce((sum, r) => sum + r.bytes_sum, 0);

  // -- traffic by peer category (7d) --
  const categoryBytes = new Map<string, number>();
  for (const r of providerMix7d) {
    categoryBytes.set(r.provider_category, (categoryBytes.get(r.provider_category) ?? 0) + r.bytes_sum);
  }
  const totalCategoryBytes = [...categoryBytes.values()].reduce((a, b) => a + b, 0) || 1;
  const sortedCategories = [...categoryBytes.entries()].sort((a, b) => b[1] - a[1]);

  // -- unclassified peers (7d) --
  const unclassifiedPeers = new Set(unclassified7d.map((r) => r.peer_ip));
  const unclassifiedBytes = unclassified7d.reduce((sum, r) => sum + r.bytes_sum, 0);
  const unclassifiedPct = ((unclassifiedBytes / totalCategoryBytes) * 100).toFixed(0);

  // -- BPH contact (30d) --
  const bphTotal = bphContact30d.reduce((sum, r) => sum + r.bytes_sum, 0);
  const bphByIp = new Map<string, number>();
  const bphByDay = new Map<string, number>();
  for (const r of bphContact30d) {
    bphByIp.set(r.monitored_ip, (bphByIp.get(r.monitored_ip) ?? 0) + r.bytes_sum);
    bphByDay.set(r.day, (bphByDay.get(r.day) ?? 0) + r.bytes_sum);
  }
  const topBphIp = [...bphByIp.entries()].sort((a, b) => b[1] - a[1])[0];
  const topBphPct = topBphIp ? ((topBphIp[1] / bphTotal) * 100).toFixed(0) : "0";
  const bphDays = [...bphByDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const bphMaxDay = Math.max(1, ...bphDays.map(([, bytes]) => bytes));

  // -- fingerprint drift (7d) --
  const bySourceByIp = new Map<string, FingerprintChange[]>();
  for (const r of fingerprintChanges7d) {
    const list = bySourceByIp.get(r.ip) ?? [];
    list.push(r);
    bySourceByIp.set(r.ip, list);
  }
  const changedIps = [...bySourceByIp.entries()]
    .filter(([, rows]) => rows.some((r) => r.distinct_fingerprints > 1))
    .map(([ip, rows]) => ({
      ip,
      rows,
      lastFetchedAt: rows.reduce((max, r) => (r.last_fetched_at > max ? r.last_fetched_at : max), ""),
    }))
    .sort((a, b) => b.lastFetchedAt.localeCompare(a.lastFetchedAt));

  return (
    <>
      {freshness.checks.length > 0 && (
        <div className={`banner ${staleChecks.length > 0 ? "stale" : "ok"}`}>
          <span className="dot" style={{ background: staleChecks.length > 0 ? "#E5484D" : "#3DD68C" }} />
          {staleChecks.length > 0 ? (
            <span>
              <b style={{ color: "#E5484D" }}>
                {staleChecks.length === 1 ? staleChecks[0].name + " feed stale" : `${staleChecks.length} feeds stale`}
              </b>{" "}
              — {staleChecks.map((c) => c.why).join("; ")}
            </span>
          ) : (
            <span>All freshness checks ok as of {formatShortDate(freshness.checked_at)}</span>
          )}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))",
          gap: 16,
          marginBottom: 28,
        }}
      >
        <Tile label="Active monitored IPs" value={watchedIps.length}>
          {newestIp && (
            <span>
              watch__ips · +{newestIp.ip} {formatShortDate(newestIp.added_at)}
            </span>
          )}
        </Tile>

        <Tile
          label="Reviewed roles (watched)"
          value={
            <>
              {acceptedCount}
              <span style={{ fontSize: 14, color: "#6FA89E", fontWeight: 500 }}>
                {" "}
                / {ipRolesWatched.length}
              </span>
            </>
          }
          borderColor={acceptedCount === 0 ? "#5A4423" : undefined}
          valueColor={acceptedCount === 0 ? "#F5A623" : undefined}
        >
          {proposedLine && <span>review__ip_roles · proposed: {proposedLine}</span>}
        </Tile>

        <Tile label="TIP labels on watched IPs" value={totalTags} valueColor="#C6EBE2">
          {tagLine && <span>{tagLine} — analyst suggestions, never rule inputs</span>}
        </Tile>

        <Tile
          label="Pending review"
          value={
            <>
              {queue.asn_candidates}
              <span style={{ fontSize: 14, color: "#6FA89E", fontWeight: 500 }}> ASN</span>
            </>
          }
        >
          <span>
            + {queue.peer_roles} peer roles · {queue.watched_roles} watched roles ·{" "}
            {queue.unconfirmed_sip_pairs} unconfirmed SIP pairs
          </span>
        </Tile>

        <Tile label="RTP volume (7d)" value={formatBytes(rtpBytes).split(" ")[0]} unit={formatBytes(rtpBytes).split(" ")[1]} />

        <Tile
          label="Unclassified peers (7d)"
          value={unclassifiedPeers.size.toLocaleString()}
          borderColor="#3F9C8A"
        >
          <span>
            {formatBytes(unclassifiedBytes)} · {unclassifiedPct}% of bytes
          </span>
        </Tile>
      </div>

      <div
        className="card"
        style={{
          padding: "16px 22px",
          marginBottom: 24,
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div style={{ minWidth: 180 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Domain proof-of-life</div>
          <div style={{ marginTop: 5 }}>
            <span className="src">spoiler-alert — not wired yet</span>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#6FA89E" }}>
          Served by spoiler-alert directly, not this API (netflow-rollups' api.md, "Not in this
          plan") — next slice.
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 24 }}>
        <div className="card" style={{ flex: "1 1 520px", minWidth: 0, padding: "22px 24px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 16,
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>Traffic touching each peer category — 7d</div>
            <span className="src">rollup__provider_mix_daily · all port families</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {sortedCategories.map(([category, bytes], i) => {
              const pct = (bytes / totalCategoryBytes) * 100;
              return (
                <div className="bar" key={category}>
                  <div className="lbl">{category.replace(/_/g, " ")}</div>
                  <div className="trk">
                    <div
                      className="fil"
                      style={{ width: `${pct}%`, background: categoryColor(category, i) }}
                    />
                  </div>
                  <div className="val mono">
                    {formatBytes(bytes)} · {pct.toFixed(0)}%
                  </div>
                </div>
              );
            })}
          </div>
          <div className="note">
            Bars overlap — a peer in two categories counts in both. Percentages are "share of{" "}
            {formatBytes(totalCategoryBytes)} that touched this category," not a composition.
          </div>
        </div>

        <div className="card" style={{ flex: "1 1 380px", minWidth: 0, padding: "22px 24px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 4,
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>Bulletproof-hosting contact — 30d</div>
            <span className="src">rollup__bph_contact_daily</span>
          </div>
          <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 16 }}>
            <span className="mono" style={{ color: "#E5484D", fontWeight: 600 }}>
              {formatBytes(bphTotal)}
            </span>
            {topBphIp && (
              <>
                {" "}
                · {topBphPct}% from <span className="mono">{topBphIp[0]}</span>
              </>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 120 }}>
            {bphDays.map(([day, bytes]) => (
              <div
                key={day}
                style={{
                  flex: 1,
                  height: `${Math.max(2, (bytes / bphMaxDay) * 100)}%`,
                  background: "#E5484D",
                  borderRadius: "2px 2px 0 0",
                }}
                title={`${day} · ${formatBytes(bytes)}`}
              />
            ))}
          </div>
          <div className="note">Summed across the monitored IPs seen in this window.</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div className="card" style={{ flex: "1 1 420px", minWidth: 0 }}>
          <div
            style={{
              padding: "18px 20px 4px 20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>Top RTP talkers (7d)</div>
            <span className="src">rollup__flow_daily/top-peers · rtp_media · tagged peers excluded</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead>
              <tr>
                <th>Peer</th>
                <th>Categories</th>
                <th style={{ textAlign: "right" }}>Bytes</th>
              </tr>
            </thead>
            <tbody>
              {topRtpTalkers7d.map((peer) => (
                <tr key={peer.peer_ip}>
                  <td className="mono">{peer.peer_ip}</td>
                  <td>{peer.peer_categories.join(", ") || "unclassified"}</td>
                  <td style={{ textAlign: "right" }} className="mono">
                    {formatBytes(peer.bytes_sum)}
                  </td>
                </tr>
              ))}
              {topRtpTalkers7d.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ color: "#6FA89E" }}>
                    No peers in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ flex: "1 1 340px", minWidth: 0 }}>
          <div
            style={{
              padding: "18px 20px 4px 20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>Fingerprint drift (7d)</div>
            <span className="src">lookup__host_scans/changes · censys + shodan</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead>
              <tr>
                <th>Monitored IP</th>
                <th>Changed</th>
                <th style={{ textAlign: "right" }}>Last</th>
              </tr>
            </thead>
            <tbody>
              {changedIps.slice(0, 8).map(({ ip, rows, lastFetchedAt }) => (
                <tr key={ip}>
                  <td className="mono">{ip}</td>
                  <td style={{ color: "#A6D8CD", fontSize: 12 }}>
                    {rows.map((r) => `${r.source} ×${r.scans}`).join(" · ")}
                  </td>
                  <td style={{ textAlign: "right" }} className="mono">
                    {formatShortDate(lastFetchedAt)}
                  </td>
                </tr>
              ))}
              {changedIps.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ color: "#6FA89E" }}>
                    No fingerprint changes this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="note" style={{ margin: 0, padding: "10px 20px 14px 20px" }}>
            {changedIps.length} of {new Set(fingerprintChanges7d.map((r) => r.ip)).size} scanned IPs
            changed at least once in the last 7 days.
          </div>
        </div>

        <div className="card" style={{ flex: "1 1 340px", minWidth: 0 }}>
          <div
            style={{
              padding: "18px 20px 4px 20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>Watchlist activity</div>
            <span className="src" style={{ color: "#F5A623", borderColor: "#5A4423" }}>
              not servable
            </span>
          </div>
          <div style={{ padding: "8px 20px 18px 20px", fontSize: 12, color: "#6FA89E" }}>
            No event log exists on the IP side yet (netflow-rollups'{" "}
            <span className="mono">dashboard_requirements.md</span>). Domain-side lifecycle events
            would come from spoiler-alert once this project reads it directly.
          </div>
        </div>
      </div>
    </>
  );
}

function Tile({
  label,
  value,
  unit,
  children,
  borderColor,
  valueColor,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  children?: React.ReactNode;
  borderColor?: string;
  valueColor?: string;
}) {
  return (
    <div className="card" style={{ padding: "18px 20px", borderColor }}>
      <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, color: valueColor }}>
        {value}
        {unit && <span style={{ fontSize: 14, color: "#6FA89E", fontWeight: 500 }}> {unit}</span>}
      </div>
      {children && <div style={{ fontSize: 10, color: "#6FA89E", marginTop: 3 }}>{children}</div>}
    </div>
  );
}
