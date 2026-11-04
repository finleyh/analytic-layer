import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CopyButton } from "../components/CopyButton";
import { FingerprintHistory } from "../components/FingerprintHistory";
import { WindowSelect, windowRange, type WindowKey } from "../components/WindowSelect";
import {
  listIpsWatchIpsGet,
  listIpRolesReviewIpRolesGet,
  portFamilyMixDailyRollupPortFamilyMixDailyGet,
  providerMixDailyRollupProviderMixDailyGet,
  bphContactDailyRollupBphContactDailyGet,
  unclassifiedContactsDailyRollupUnclassifiedContactsDailyGet,
  hostScanChangesLookupHostScansChangesGet,
  listHostScansLookupHostScansGet,
  freshnessOpsFreshnessGet,
  getIpIdentityLookupIpIdentitiesIpGet,
  hostNameSummaryLookupHostNamesSummaryGet,
  listWebScanPivotsVerdictWebScanPivotsGet,
  type WatchedIp,
  type IpRole,
  type DailyPortFamilyMix,
  type DailyProviderMix,
  type DailyBphContact,
  type DailyUnclassifiedContact,
  type FingerprintChange,
  type Freshness,
  type HostScan,
  type IpIdentity,
  type HostNameSummary,
  type WebScanPivot,
} from "../api/netflow-rollups-client";
import { formatBytes, formatShortDate, isoDate, daysAgo } from "../lib/format";
import { categoryColors } from "../lib/categories";
import { familyColor } from "../lib/colors";
import { bestScanNames } from "../lib/hostNames";
import { errorMessage } from "../lib/errors";

// Data that does not depend on the window: who is watched, their roles, identity,
// the BPH trend (a 30-day card by definition) and unclassified peers (7 days: that
// route's rows run to tens of thousands over longer windows).
type WatchlistData = {
  watchedIps: WatchedIp[];
  ipRolesWatched: IpRole[];
  bphContact30d: DailyBphContact[];
  unclassified7d: DailyUnclassifiedContact[];
  freshness: Freshness;
  identityByIp: Map<string, IpIdentity>;
  hostNamesByIp: Map<string, HostNameSummary[]>;
  domainPivots: WebScanPivot[];
};

// Data that follows the window selector.
type Windowed = {
  key: WindowKey;
  portFamilyMix: DailyPortFamilyMix[];
  providerMix: DailyProviderMix[];
  fingerprintChanges: FingerprintChange[];
  scansByIp: Map<string, HostScan[]>;
  /** A rollup route returned its row cap, so totals may be short. */
  capped: boolean;
};

const ROLLUP_ROW_CAP = 20000;

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
        const from7 = isoDate(daysAgo(6));

        const [watchedIps, ipRolesWatched, bphContact30d, unclassified7d, freshness, domainPivots] = await Promise.all([
          listIpsWatchIpsGet({ throwOnError: true }),
          listIpRolesReviewIpRolesGet({ query: { vantage: "watched" }, throwOnError: true }),
          bphContactDailyRollupBphContactDailyGet({
            query: { from: from30, to, limit: ROLLUP_ROW_CAP },
            throwOnError: true,
          }),
          unclassifiedContactsDailyRollupUnclassifiedContactsDailyGet({
            query: { from: from7, to, limit: ROLLUP_ROW_CAP },
            throwOnError: true,
          }),
          freshnessOpsFreshnessGet({ throwOnError: true }),
          // Unfiltered, not per-IP — the volume (a couple hundred rows at
          // most) is cheap enough as one bulk call, same reasoning as the
          // host-names summary just below.
          listWebScanPivotsVerdictWebScanPivotsGet({
            query: { from: from30, to, limit: 1000 },
            throwOnError: true,
          }),
        ]);

        if (cancelled) return;

        // One lookup per watched IP for rDNS/ASN identity — no bulk endpoint,
        // same N+1 pattern already used for per-domain owner lookups.
        const identityEntries = await Promise.all(
          watchedIps.data.rows.map(async (w) => {
            try {
              const r = await getIpIdentityLookupIpIdentitiesIpGet({ path: { ip: w.ip }, throwOnError: true });
              return [w.ip, r.data] as const;
            } catch {
              return null;
            }
          }),
        );

        // netflow-rollups normalizes Shodan/Censys domain/hostname/certificate
        // evidence into its own host-names table — one bulk query across all
        // watched IPs, same shape as the other rollup endpoints.
        const hostNameSummary = await hostNameSummaryLookupHostNamesSummaryGet({
          query: { subject: "watched", limit: 1000 },
          throwOnError: true,
        });
        if (cancelled) return;

        const hostNamesByIp = new Map<string, HostNameSummary[]>();
        for (const r of hostNameSummary.data.rows) {
          const list = hostNamesByIp.get(r.ip) ?? [];
          list.push(r);
          hostNamesByIp.set(r.ip, list);
        }

        setData({
          watchedIps: watchedIps.data.rows,
          ipRolesWatched: ipRolesWatched.data.rows,
          bphContact30d: bphContact30d.data.rows,
          unclassified7d: unclassified7d.data.rows,
          freshness: freshness.data,
          identityByIp: new Map(identityEntries.filter((e): e is readonly [string, IpIdentity] => e !== null)),
          hostNamesByIp,
          domainPivots: domainPivots.data.rows,
        });
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
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
          {data ? `${data.watchedIps.length} monitored IPs · one row per watched IP` : "Loading…"}
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

function IdentityCell({
  ip,
  identity,
  hostNames,
  confirmedRoles,
  pendingRoles,
  tips,
  pivotCount,
  expanded,
  onToggle,
}: {
  ip: WatchedIp;
  identity: IpIdentity | undefined;
  hostNames: HostNameSummary[];
  confirmedRoles: IpRole[];
  pendingRoles: IpRole[];
  tips: string[];
  pivotCount: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <td>
      <button
        onClick={onToggle}
        title={expanded ? "Collapse traffic and port-scan detail" : "Expand traffic and port-scan detail"}
        style={{ all: "unset", cursor: "pointer", color: "#6FA89E", marginRight: 6, fontSize: 11 }}
      >
        {expanded ? "▾" : "▸"}
      </button>
<Link to={`/entity/${ip.ip}`} className="mono row-link">
        {ip.ip}
      </Link>
      <CopyButton text={ip.ip} label="Copy IP address" />
      {pivotCount > 0 && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 2,
            marginLeft: 6,
            fontSize: 10,
            color: "#4C8DFF",
            verticalAlign: "middle",
          }}
          title={`Shares content with another domain on ${pivotCount} resource${pivotCount === 1 ? "" : "s"} — /verdict/web-scan-pivots, see the Entity page`}
        >
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
            <path
              d="M6 8L8 6M5.5 9.5L3.8 11.2a2 2 0 01-2.8-2.8L2.7 6.7a2 2 0 012.8 0M8.5 4.5l1.7-1.7a2 2 0 012.8 2.8L11.3 7.3a2 2 0 01-2.8 0"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {pivotCount > 1 ? pivotCount : ""}
        </span>
      )}
      <br />
      {identity?.rdns && (
        <>
          <span
            className="mono"
            style={{ fontSize: 11, color: "#6FA89E" }}
            title="reverse DNS (/lookup/ip-identities)"
          >
            {identity!.rdns}
          </span>
          <br />
        </>
      )}
      {(() => {
        const names = bestScanNames(hostNames, identity?.rdns);
        if (names.length === 0) return null;
        const shown = names.slice(0, 3);
        const rest = names.slice(3);
        return (
          <>
            <span
              className="mono"
              style={{ fontSize: 11, color: "#4C8DFF" }}
              title={`scan-derived names (/lookup/host-names)${rest.length ? "\n+ " + rest.join(", ") : ""}`}
            >
              {shown.join(", ")}
              {rest.length > 0 && ` +${rest.length} more`}
            </span>
            <br />
          </>
        );
      })()}
      {confirmedRoles.map((r) => (
        <span className="chip rev" key={r.role}>
          {r.role}
        </span>
      ))}
      {pendingRoles.map((r) => (
        <span
          className="chip pend"
          key={r.role}
          title="role status — heuristic or agent suggested, not yet confirmed by a human"
        >
          proposed {r.role} · {r.status}
        </span>
      ))}
      <br />
      <span className="chip">msk:voip_analysis</span>
      {tips.map((t) => (
        <span className="chip tip" key={t} title="OpenCTI label — an analyst's suggestion, read by no logic">
          {t}
        </span>
      ))}
    </td>
  );
}

function TrafficBar({ families, total }: { families: [string, number][]; total: number }) {
  if (total === 0) return <span style={{ color: "#6FA89E", fontSize: 12 }}>no traffic</span>;
  const top = families.slice(0, 2).map(([f, b]) => `${f.replace(/_/g, " ")} ${Math.round((b / total) * 100)}%`);
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 3 }}>
      <span style={{ display: "flex", width: 170, height: 10, borderRadius: 3, overflow: "hidden", background: "#133A3C" }}>
        {families.map(([f, b]) => (
          <span
            key={f}
            title={`${f} · ${formatBytes(b)} · ${((b / total) * 100).toFixed(1)}%`}
            style={{ width: `${(b / total) * 100}%`, minWidth: b > 0 ? 1 : 0, background: familyColor(f), display: "block" }}
          />
        ))}
      </span>
      <span style={{ fontSize: 11, color: "#6FA89E", whiteSpace: "nowrap" }}>{top.join(" · ")}</span>
    </span>
  );
}

function WatchlistTable({ data }: { data: WatchlistData }) {
  const [search, setSearch] = useState("");
  const [windowKey, setWindowKey] = useState<WindowKey>("7d");
  const [windowed, setWindowed] = useState<Windowed | null>(null);
  const [windowError, setWindowError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<string>("total");
  // ip -> the selected fingerprint run key (or null) for rows that are expanded
  const [expanded, setExpanded] = useState<Map<string, string | null>>(new Map());
  const { watchedIps, ipRolesWatched, bphContact30d, unclassified7d, freshness, identityByIp, hostNamesByIp, domainPivots } = data;
  const range = windowRange(windowKey);
  const loadingWindow = windowed === null || windowed.key !== windowKey;

  useEffect(() => {
    let cancelled = false;
    setWindowError(null);
    const { from, to } = windowRange(windowKey);

    async function load() {
      try {
        const [portFamilyMix, providerMix, fingerprintChanges] = await Promise.all([
          portFamilyMixDailyRollupPortFamilyMixDailyGet({ query: { from, to, limit: ROLLUP_ROW_CAP }, throwOnError: true }),
          providerMixDailyRollupProviderMixDailyGet({ query: { from, to, limit: ROLLUP_ROW_CAP }, throwOnError: true }),
          hostScanChangesLookupHostScansChangesGet({ query: { subject: "watched", from, to }, throwOnError: true }),
        ]);
        // The scans themselves, per IP: there is no bulk route that is not capped at 1000 rows,
        // and the chips need the hashes and facts, not just the counts /changes gives.
        const scanEntries = await Promise.all(
          watchedIps.map(async (w) => {
            try {
              const r = await listHostScansLookupHostScansGet({
                query: { ip: w.ip, subject: "watched", from, to, limit: 1000 },
                throwOnError: true,
              });
              return [w.ip, r.data.rows] as const;
            } catch {
              return [w.ip, [] as HostScan[]] as const;
            }
          }),
        );
        if (cancelled) return;
        setWindowed({
          key: windowKey,
          portFamilyMix: portFamilyMix.data.rows,
          providerMix: providerMix.data.rows,
          fingerprintChanges: fingerprintChanges.data.rows,
          scansByIp: new Map(scanEntries),
          capped: portFamilyMix.data.count >= ROLLUP_ROW_CAP || providerMix.data.count >= ROLLUP_ROW_CAP,
        });
      } catch (err) {
        if (!cancelled) setWindowError(errorMessage(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [windowKey, watchedIps]);

  const staleChecks = freshness.checks.filter((c) => c.stale);

  const rolesByIp = new Map<string, IpRole[]>();
  for (const r of ipRolesWatched) {
    const list = rolesByIp.get(r.ip) ?? [];
    list.push(r);
    rolesByIp.set(r.ip, list);
  }

  const pivotsByIp = new Map<string, number>();
  for (const p of domainPivots) {
    pivotsByIp.set(p.watched_ip, (pivotsByIp.get(p.watched_ip) ?? 0) + 1);
  }

  // ---- windowed aggregates ----
  const portFamilyMix = windowed?.portFamilyMix ?? [];
  const bytesByIp = groupSum(portFamilyMix, (r) => r.watched_ip, (r) => r.bytes_sum);
  // ip -> port_family -> {bytes, flows, days}
  const familiesByIp = new Map<string, Map<string, { bytes: number; flows: number; days: Set<string> }>>();
  for (const r of portFamilyMix) {
    const m = familiesByIp.get(r.watched_ip) ?? new Map();
    const e = m.get(r.port_family) ?? { bytes: 0, flows: 0, days: new Set<string>() };
    e.bytes += r.bytes_sum;
    e.flows += r.flow_count;
    e.days.add(r.day);
    m.set(r.port_family, e);
    familiesByIp.set(r.watched_ip, m);
  }
  const allFamilies = [...new Set(portFamilyMix.map((r) => r.port_family))].sort();

  const categoryByIp = new Map<string, Map<string, number>>();
  for (const r of windowed?.providerMix ?? []) {
    const m = categoryByIp.get(r.watched_ip) ?? new Map<string, number>();
    m.set(r.provider_category, (m.get(r.provider_category) ?? 0) + r.bytes_sum);
    categoryByIp.set(r.watched_ip, m);
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

  const bphByIp = groupSum(bphContact30d, (r) => r.watched_ip, (r) => r.bytes_sum);

  const unclPeersByIp = new Map<string, Set<string>>();
  for (const r of unclassified7d) {
    const s = unclPeersByIp.get(r.watched_ip) ?? new Set<string>();
    s.add(r.peer_ip);
    unclPeersByIp.set(r.watched_ip, s);
  }

  const fpByIp = new Map<string, FingerprintChange[]>();
  for (const r of windowed?.fingerprintChanges ?? []) {
    const list = fpByIp.get(r.ip) ?? [];
    list.push(r);
    fpByIp.set(r.ip, list);
  }

  const sortValue = (ip: string) =>
    sortKey === "total" ? (bytesByIp.get(ip) ?? 0) : (familiesByIp.get(ip)?.get(sortKey)?.bytes ?? 0);
  const sortedIps = [...watchedIps]
    .sort((a, b) => sortValue(b.ip) - sortValue(a.ip))
    .filter((ip) => ip.ip.includes(search.trim()));

  function toggle(ip: string, selectedKey?: string | null) {
    setExpanded((prev) => {
      const next = new Map(prev);
      if (selectedKey !== undefined) next.set(ip, selectedKey);
      else if (next.has(ip)) next.delete(ip);
      else next.set(ip, null);
      return next;
    });
  }

  return (
    <>
      <div style={{ marginBottom: 16, display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by IP (e.g. 143.198 or a full address)…"
          className="mono"
          style={{
            width: "100%",
            maxWidth: 360,
            background: "#0A2224",
            color: "#E8FFF8",
            border: "1px solid #2B7266",
            borderRadius: 6,
            padding: "8px 12px",
            fontSize: 13,
          }}
        />
        <WindowSelect value={windowKey} onChange={setWindowKey} label="History" />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>Sort by</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            className="mono"
            style={{ background: "#0A2224", color: "#E8FFF8", border: "1px solid #2B7266", borderRadius: 6, padding: "5px 8px", fontSize: 12 }}
          >
            <option value="total">total bytes</option>
            {allFamilies.map((f) => (
              <option key={f} value={f}>
                {f} bytes
              </option>
            ))}
          </select>
        </label>
        {loadingWindow && !windowError && <span style={{ fontSize: 12, color: "#6FA89E" }}>loading {range.label}…</span>}
      </div>

      {windowError && (
        <div className="card" style={{ padding: 16, borderColor: "#5A2327", marginBottom: 16, fontSize: 13 }}>
          Failed to load {range.label} of history: {windowError}
        </div>
      )}
      {windowed?.capped && !loadingWindow && (
        <div className="card" style={{ padding: 12, borderColor: "#5A4423", marginBottom: 16, fontSize: 12, color: "#F5A623" }}>
          A rollup route hit its {ROLLUP_ROW_CAP.toLocaleString()}-row cap for this window — byte totals may be short. Pick a shorter window.
        </div>
      )}

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

      <div className="card" style={{ overflowX: "auto", opacity: loadingWindow ? 0.6 : 1 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
          <thead>
            <tr>
              <th>
                Monitored IP · <span style={{ color: "#F5A623" }}>reviewed role</span> ·{" "}
                <span style={{ color: "#C6EBE2" }}>TIP labels</span>
              </th>
              <th style={{ textAlign: "right" }}>Bytes {range.label}</th>
              <th>Traffic by port family ({range.label})</th>
              <th>Peer category</th>
              <th style={{ textAlign: "right" }}>BPH 30d</th>
              <th style={{ textAlign: "right" }}>Uncl. peers 7d</th>
              <th>Port scans ({range.label})</th>
            </tr>
          </thead>
          <tbody>
            {sortedIps.map((ip) => {
              const roles = rolesByIp.get(ip.ip) ?? [];
              const confirmedRoles = roles.filter((r) => r.status === "confirmed");
              const pendingRoles = roles.filter((r) => r.status !== "confirmed" && r.status !== "rejected");
              const bytes = bytesByIp.get(ip.ip) ?? 0;
              const families = [...(familiesByIp.get(ip.ip) ?? new Map()).entries()]
                .map(([f, e]) => [f, e.bytes] as [string, number])
                .sort((a, b) => b[1] - a[1]);
              const category = dominantCategory(ip.ip);
              const bph = bphByIp.get(ip.ip) ?? 0;
              const unclCount = unclPeersByIp.get(ip.ip)?.size ?? 0;
              const fpRows = fpByIp.get(ip.ip) ?? [];
              const fpScans = fpRows.reduce((s, r) => s + r.scans, 0);
              const fpHashes = fpRows.reduce((s, r) => s + r.distinct_fingerprints, 0);
              const fpLast = fpRows.reduce((max, r) => (r.last_fetched_at > max ? r.last_fetched_at : max), "");
              const tips = ip.tags.filter((t) => !t.startsWith("msk:"));
              const pivotCount = pivotsByIp.get(ip.ip) ?? 0;
              const isExpanded = expanded.has(ip.ip);
              const scans = windowed?.scansByIp.get(ip.ip) ?? [];

              return (
                <Fragment key={ip.ip}>
                  <tr>
                    <IdentityCell
                      ip={ip}
                      identity={identityByIp.get(ip.ip)}
                      hostNames={hostNamesByIp.get(ip.ip) ?? []}
                      confirmedRoles={confirmedRoles}
                      pendingRoles={pendingRoles}
                      tips={tips}
                      pivotCount={pivotCount}
                      expanded={isExpanded}
                      onToggle={() => toggle(ip.ip)}
                    />
                    <td className="num mono" style={{ textAlign: "right" }}>
                      {formatBytes(bytes)}
                    </td>
                    <td onClick={() => toggle(ip.ip)} style={{ cursor: "pointer" }} title="Click for the per-family table">
                      <TrafficBar families={families} total={bytes} />
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
                    <td className="fp" style={{ fontSize: 12, lineHeight: 1.4 }}>
                      {fpRows.length === 0 ? (
                        <span style={{ color: "#6FA89E" }}>no scans</span>
                      ) : (
                        <>
                          {fpHashes <= fpRows.length ? (
                            <span style={{ color: "#3DD68C" }}>stable</span>
                          ) : (
                            <span style={{ color: "#F5A623" }}>changed ×{fpHashes - fpRows.length}</span>
                          )}
                          <span style={{ color: "#6FA89E", fontSize: 11 }}>
                            {" "}
                            · {fpScans} scans · last {fpLast ? formatShortDate(fpLast) : "—"}
                          </span>
                          <div style={{ marginTop: 4 }}>
                            <FingerprintHistory
                              ip={ip.ip}
                              scans={scans}
                              compact
                              selected={expanded.get(ip.ip) ?? null}
                              onSelect={(key) => toggle(ip.ip, key)}
                            />
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={7} style={{ background: "#071B1D", padding: "14px 18px" }}>
                        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
                          <div style={{ flex: "0 1 420px", minWidth: 300 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#A6D8CD", marginBottom: 8 }}>
                              All traffic by port family — {range.label}
                            </div>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                              <thead>
                                <tr>
                                  <th>Family</th>
                                  <th style={{ textAlign: "right" }}>Bytes</th>
                                  <th style={{ textAlign: "right" }}>Share</th>
                                  <th style={{ textAlign: "right" }}>Flows</th>
                                  <th style={{ textAlign: "right" }}>Days</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...(familiesByIp.get(ip.ip) ?? new Map()).entries()]
                                  .sort((a, b) => b[1].bytes - a[1].bytes)
                                  .map(([f, e]) => (
                                    <tr key={f}>
                                      <td>
                                        <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: familyColor(f), marginRight: 7 }} />
                                        <span className="mono">{f}</span>
                                      </td>
                                      <td className="num mono" style={{ textAlign: "right" }}>{formatBytes(e.bytes)}</td>
                                      <td className="num mono" style={{ textAlign: "right" }}>{bytes > 0 ? ((e.bytes / bytes) * 100).toFixed(1) : "0.0"}%</td>
                                      <td className="num mono" style={{ textAlign: "right" }}>{e.flows.toLocaleString()}</td>
                                      <td className="num mono" style={{ textAlign: "right" }}>{e.days.size}</td>
                                    </tr>
                                  ))}
                                {bytes === 0 && (
                                  <tr>
                                    <td colSpan={5} style={{ color: "#6FA89E" }}>
                                      No traffic in this window.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                          <div style={{ flex: "1 1 420px", minWidth: 320 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#A6D8CD", marginBottom: 8 }}>
                              Port-scan fingerprints — {range.label}
                            </div>
                            <FingerprintHistory
                              ip={ip.ip}
                              scans={scans}
                              entityLink
                              selected={expanded.get(ip.ip) ?? null}
                              onSelect={(key) => toggle(ip.ip, key)}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {sortedIps.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: "#6FA89E" }}>
                  No monitored IPs match "{search}".
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="note">
          Sources, per column: <span className="mono">/review/ip-roles</span> (reviewed role) ·{" "}
          <span className="mono">/watch/ips</span> tags (TIP labels, analyst suggestions, read by no
          logic) · <span className="mono">/lookup/ip-identities</span> rdns (reverse DNS, shown when
          present) ·{" "}
          <span className="mono" style={{ color: "#4C8DFF" }}>
            /lookup/host-names
          </span>{" "}
          (blue — domain/hostname/certificate evidence from Shodan + Censys scans, preferring the
          cleanest kind; excludes anything matching rDNS) ·{" "}
          <span className="mono">/rollup/port-family-mix-daily</span> (bytes and the traffic bar: every
          port family, not just RTP; hover a segment for its bytes and share, click the bar for the
          table) · <span className="mono">/rollup/provider-mix-daily</span> (dominant category,
          excluding unclassified) · <span className="mono">/rollup/bph-contact-daily</span> (always
          30d) · <span className="mono">/rollup/unclassified-contacts-daily</span> (distinct peers,
          always 7d) · <span className="mono">/lookup/host-scans</span> and{" "}
          <span className="mono">/changes</span> (port scans: the summary counts scans and distinct
          fingerprints summed across censys + shodan — an approximation, not a true cross-source
          dedup; each chip is a run of consecutive scans with one fingerprint hash, hover for its
          services, click for the facts and what changed). The history selector moves every
          column but BPH and unclassified peers; scans exist from the first sweep on, rollups for
          180 days. Traffic and categories are today's classification with scanner traffic hidden
          by date upstream. Red BPH ≥ 1 MB; orange unclassified ≥ 300 peers.
          <br />
          <b style={{ color: "#E8FFF8" }}>Not shown: last record per IP.</b> The raw flow records
          aren't served by the API (180 days of raw rows); every other question here is answered by
          a rollup. If this column turns out to matter, that's a new route to argue for on
          netflow-rollups' side.
        </div>
      </div>
    </>
  );
}
