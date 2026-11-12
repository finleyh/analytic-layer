import { Fragment, useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import * as d3 from "d3";
import { Link, useParams } from "react-router-dom";
import {
  getIpWatchIpsIpGet,
  getIpRolesReviewIpRolesIpGet,
  getIpIdentityLookupIpIdentitiesIpGet,
  listHostScansLookupHostScansGet,
  hostScanChangesLookupHostScansChangesGet,
  hostNameSummaryLookupHostNamesSummaryGet,
  bphContactDailyRollupBphContactDailyGet,
  portFamilyMixDailyRollupPortFamilyMixDailyGet,
  flowHourlyRollupFlowHourlyGet,
  listFindingsVerdictFindingsGet,
  listWebScansLookupWebScansGet,
  requestWebScanLookupWebScansPost,
  webScanResultLookupWebScansWebScanIdResultGet,
  listWebScanPivotsVerdictWebScanPivotsGet,
  type WatchedIp,
  type IpRole,
  type IpIdentity,
  type HostScan,
  type FingerprintChange,
  type HostNameSummary,
  type Finding,
  type WebScan,
  type WebScanPivot,
} from "../api/netflow-rollups-client";
import { fetchMonitored } from "../api/spoilerAlert";
import { formatBytes, isoDate, daysAgo, darkToGreen } from "../lib/format";
import { looksLikeHostname } from "../lib/hostNames";
import { familyColor } from "../lib/colors";
import { CopyButton } from "../components/CopyButton";
import { FingerprintHistory } from "../components/FingerprintHistory";
import { WindowSelect, windowRange, type WindowKey } from "../components/WindowSelect";
import { PeerEntity } from "../components/PeerEntity";
import { IpReviewHistory } from "../components/IpReviewHistory";
import { ScannerVerdicts } from "../components/ScannerVerdicts";
import { buildFingerprintGrid, diffFacts, factLabel, type GridCell } from "../lib/fingerprints";
import { errorMessage } from "../lib/errors";

type EntityData = {
  watchedIp: WatchedIp;
  roles: IpRole[];
  identity: IpIdentity | null;
  scans: HostScan[];
  changes: FingerprintChange[];
  hostNames: HostNameSummary[];
  findings: Finding[];
  webScans: WebScan[];
  domainPivots: WebScanPivot[];
  bphBytes30d: number;
  bytes7d: number;
  rtpBytes7d: number;
};

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
  // Port-scan history window (default 30 days, what this page always showed); the scans
  // and the per-source change summary follow it, everything else keeps its own window.
  const [scanWindow, setScanWindow] = useState<WindowKey>("30d");
  // An IP with no /watch/ips row is a peer: Top talkers and the relationship cards link them here.
  const [isPeer, setIsPeer] = useState(false);

  useEffect(() => {
    if (!ip) return;
    let cancelled = false;
    setIsPeer(false);

    async function load() {
      try {
        const to = isoDate(new Date());
        const from30 = isoDate(daysAgo(29));
        const scanRange = windowRange(scanWindow);

        const [
          watchedIp,
          roles,
          identityResult,
          scans,
          changes,
          hostNames,
          findings,
          webScans,
          domainPivots,
          bphContact30d,
          portFamilyMix7d,
        ] = await Promise.all([
          getIpWatchIpsIpGet({ path: { ip: ip! }, throwOnError: true }),
          getIpRolesReviewIpRolesIpGet({ path: { ip: ip! }, throwOnError: true }).catch(() => null),
          getIpIdentityLookupIpIdentitiesIpGet({ path: { ip: ip! } }),
          listHostScansLookupHostScansGet({
            query: { ip: ip!, from: scanRange.from, to: scanRange.to, limit: 1000 },
            throwOnError: true,
          }),
          hostScanChangesLookupHostScansChangesGet({
            query: { ip: ip!, from: scanRange.from, to: scanRange.to },
            throwOnError: true,
          }),
          hostNameSummaryLookupHostNamesSummaryGet({
            query: { ip: ip!, from: from30, to, limit: 200 },
            throwOnError: true,
          }),
          listFindingsVerdictFindingsGet({
            query: { ip: ip!, from: from30, to, limit: 200 },
            throwOnError: true,
          }),
          listWebScansLookupWebScansGet({
            query: { watched_ip: ip!, from: from30, to, limit: 200 },
            throwOnError: true,
          }),
          listWebScanPivotsVerdictWebScanPivotsGet({
            query: { watched_ip: ip!, from: from30, to, limit: 200 },
            throwOnError: true,
          }),
          bphContactDailyRollupBphContactDailyGet({
            query: { watched_ip: ip!, from: from30, to },
            throwOnError: true,
          }),
          portFamilyMixDailyRollupPortFamilyMixDailyGet({
            query: { watched_ip: ip! },
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
          roles: roles?.data.rows ?? [],
          identity: identityResult.data ?? null,
          scans: scans.data.rows,
          changes: changes.data.rows,
          hostNames: hostNames.data.rows,
          findings: findings.data.rows,
          webScans: webScans.data.rows,
          domainPivots: domainPivots.data.rows,
          bphBytes30d: bphContact30d.data.rows.reduce((s, r) => s + r.bytes_sum, 0),
          bytes7d,
          rtpBytes7d,
        });
      } catch (err) {
        if (cancelled) return;
        if (/not on the watch set/.test(errorMessage(err))) setIsPeer(true);
        else setError(errorMessage(err));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [ip, scanWindow]);

  if (isPeer && ip) return <PeerEntity ip={ip} />;

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
      {data && <EntityContent ip={ip!} data={data} scanWindow={scanWindow} onScanWindow={setScanWindow} />}
    </>
  );
}

function EntityContent({
  ip,
  data,
  scanWindow,
  onScanWindow,
}: {
  ip: string;
  data: EntityData;
  scanWindow: WindowKey;
  onScanWindow: (k: WindowKey) => void;
}) {
  const scanLabel = windowRange(scanWindow).label;
  const {
    watchedIp,
    roles,
    identity,
    scans,
    changes,
    hostNames,
    findings,
    webScans,
    domainPivots,
    bphBytes30d,
    bytes7d,
    rtpBytes7d,
  } = data;
  const [scanRows, setScanRows] = useState<WebScan[]>(webScans);
  const [scanning, setScanning] = useState<Set<string>>(new Set());
  const [scanError, setScanError] = useState<string | null>(null);

  async function requestScan(target: string) {
    const t = target.trim();
    if (!t) return;
    setScanError(null);
    setScanning((prev) => new Set(prev).add(t));
    try {
      const result = await requestWebScanLookupWebScansPost({
        body: { target: t, watched_ip: ip },
        throwOnError: true,
      });
      setScanRows((prev) => [result.data.scan, ...prev.filter((s) => s.id !== result.data.scan.id)]);
    } catch (err) {
      setScanError(errorMessage(err));
    } finally {
      setScanning((prev) => {
        const next = new Set(prev);
        next.delete(t);
        return next;
      });
    }
  }
  const rtpPct = bytes7d > 0 ? Math.round((rtpBytes7d / bytes7d) * 100) : 0;
  const tips = watchedIp.tags.filter((t) => !t.startsWith("msk:"));
  const confirmedRoles = roles.filter((r) => r.status === "confirmed");
  const pendingRoles = roles.filter((r) => r.status !== "confirmed" && r.status !== "rejected");

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
  const { gridDays, gridBySource, transitions } = buildFingerprintGrid(scans);   // every day in the window, no 10-day cap

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6, flexWrap: "wrap" }}>
        <h1 className="mono" style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
          {ip}
        </h1>
        {confirmedRoles.map((r) => (
          <span className="chip rev" key={r.role}>
            {r.role}
          </span>
        ))}
        {pendingRoles.map((r) => (
          <span
            className="chip pend"
            key={r.role}
            title="review__ip_roles.status — heuristic or agent suggested, not yet confirmed by a human"
          >
            proposed {r.role} · {r.status}
          </span>
        ))}
        {confirmedRoles.length === 0 && pendingRoles.length === 0 && (
          <span className="chip" style={{ color: "#6FA89E" }}>
            no role yet
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
        {watchedIp.tags.filter((t) => t.startsWith("msk:")).sort().map((t) => (
          <span className="chip" key={t} title="OpenCTI label (/watch/ips tags) — an msk:* watch label">
            {t}
          </span>
        ))}
        {watchedIp.tags.length === 0 && (
          <span style={{ fontSize: 11, color: "#6FA89E" }}>on the watchlist with no tags</span>
        )}
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
            {identity.rdns && (
              <div className="mono" style={{ fontSize: 11, color: "#6FA89E", marginTop: 6 }} title="lookup__ip_identities.rdns">
                {identity.rdns}
              </div>
            )}
          </div>
        )}
      </div>

      <HostNameGantt rows={hostNames} excludeRdns={identity?.rdns} />

      <FindingsList findings={findings} onScan={requestScan} scanning={scanning} />

      <WebScansSection ip={ip} scans={scanRows} onScan={requestScan} scanning={scanning} error={scanError} />

      <SharesContentWith pivots={domainPivots} />

      <ActivityHeatmap ip={ip} />

      <ScannerVerdicts ip={ip} tiers={identity?.scanner_tiers ?? []} />

      <IpReviewHistory ip={ip} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Device fingerprint</div>
        <WindowSelect value={scanWindow} onChange={onScanWindow} label="Scan history" />
      </div>

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
            No scans in the last {scanLabel}.
          </div>
        )}
      </div>

      {scans.length > 0 && (
        <div className="card" style={{ padding: "22px 24px", marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Fingerprint runs — consecutive scans with one hash</div>
            <span className="src">/lookup/host-scans · {scanLabel}</span>
          </div>
          <FingerprintHistory ip={ip} scans={scans} />
        </div>
      )}

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
              /lookup/host-scans fingerprint_hash · {gridDays[0]} → {gridDays[gridDays.length - 1]}
            </span>
          </div>
          <div
            style={{
              overflowX: "auto",
              paddingBottom: 6,
            }}
          >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `64px repeat(${gridDays.length}, minmax(46px, 1fr))`,
              minWidth: 64 + gridDays.length * 52,
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
            const { added, removed } = diffFacts(t.fromScan.fingerprint_facts as Record<string, unknown>[], t.toScan.fingerprint_facts as Record<string, unknown>[]);
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
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Scan history ({scanLabel})</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th>Scanned</th>
              <th>Source</th>
              <th>Trigger</th>
              <th>Fingerprint</th>
              <th style={{ textAlign: "right" }}>Services</th>
            </tr>
          </thead>
          <tbody>
            {scans
              .slice()
              .sort((a, b) => (b.scan_time ?? "").localeCompare(a.scan_time ?? ""))
              .slice(0, 200)
              .map((s) => (
                <tr key={s.id}>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {s.scan_time?.slice(0, 16).replace("T", " ") ?? "—"}
                  </td>
                  <td className="mono">{s.source}</td>
                  <td>
                    <span
                      className="chip"
                      style={{ fontSize: 10 }}
                      title={
                        s.trigger === "api"
                          ? "requested by an analyst through this API"
                          : "lookup__host_scans.trigger — why this scan record exists"
                      }
                    >
                      {s.trigger}
                    </span>
                  </td>
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
                <td colSpan={5} style={{ color: "#6FA89E" }}>
                  No scans in the last {scanLabel}.
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

// ---------- Activity heatmap (7x24, by port family) ----------

type NameLane = {
  name: string;
  start: string;
  end: string;
  kinds: string[];
  sources: string[];
  scans: number;
};

const NAME_KIND_COLOR: Record<string, string> = {
  domain: "#4C8DFF",
  hostname: "#8B5CF6",
  certificate: "#2DD4BF",
  forward_dns: "#F5A623",
  reverse_dns: "#6FA89E",
};

function buildNameLanes(rows: HostNameSummary[], exclude?: string | null): NameLane[] {
  const byName = new Map<string, NameLane>();
  for (const r of rows) {
    if (r.name === exclude || !looksLikeHostname(r.name)) continue;
    const existing = byName.get(r.name);
    if (!existing) {
      byName.set(r.name, {
        name: r.name,
        start: r.first_fetched_at,
        end: r.last_fetched_at,
        kinds: [r.kind],
        sources: [r.source],
        scans: r.scans,
      });
    } else {
      if (r.first_fetched_at < existing.start) existing.start = r.first_fetched_at;
      if (r.last_fetched_at > existing.end) existing.end = r.last_fetched_at;
      if (!existing.kinds.includes(r.kind)) existing.kinds.push(r.kind);
      if (!existing.sources.includes(r.source)) existing.sources.push(r.source);
      existing.scans += r.scans;
    }
  }
  return [...byName.values()].sort((a, b) => a.start.localeCompare(b.start));
}

function truncateName(s: string, n = 32): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
}

function HostNameGantt({ rows, excludeRdns }: { rows: HostNameSummary[]; excludeRdns?: string | null }) {
  const lanes = buildNameLanes(rows, excludeRdns);

  if (lanes.length === 0) {
    return (
      <div className="card" style={{ padding: "22px 24px", marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Host names</div>
        <div style={{ fontSize: 11, color: "#6FA89E" }}>No domain/hostname evidence from scans (30d).</div>
      </div>
    );
  }

  const now = new Date();
  const minStart = new Date(lanes[0].start);
  const W = 760;
  const leftPad = 230;
  const rightPad = 16;
  const rowH = 30;
  const topPad = 26;
  const chartW = W - leftPad - rightPad;
  const H = topPad + lanes.length * rowH + 8;

  const x = d3.scaleTime().domain([minStart, now]).range([0, chartW]);
  const ticks = x.ticks(Math.min(6, lanes.length));
  const fmt = d3.timeFormat("%b %d");

  return (
    <div className="card" style={{ padding: "22px 24px", marginBottom: 24 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Host names</div>
      <div style={{ fontSize: 11, color: "#6FA89E", marginBottom: 14 }}>
        <span className="mono">lookup__host_names</span> (30d) · one bar per name, first → last seen
        across scans
      </div>
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

        {lanes.map((lane, row) => {
          const y = topPad + row * rowH;
          const color = NAME_KIND_COLOR[lane.kinds[0]] ?? "#4C8DFF";
          const sx = leftPad + x(new Date(lane.start));
          const ex = leftPad + x(new Date(lane.end));
          const w = Math.max(ex - sx, 3);
          return (
            <g key={lane.name}>
              <title>{lane.name}</title>
              <text x={leftPad - 10} y={y + rowH / 2 + 4} fontSize={11} fill="#A6D8CD" textAnchor="end">
                {truncateName(lane.name)}
              </text>
              <rect x={sx} y={y + 7} width={w} height={rowH - 16} rx={3} fill={color} opacity={0.85}>
                <title>
                  {lane.name}
                  {"\n"}
                  {lane.kinds.join(", ")} · {lane.sources.join(", ")} · {lane.scans} scan
                  {lane.scans === 1 ? "" : "s"}
                  {"\n"}
                  {fmtDateTime(lane.start)} → {fmtDateTime(lane.end)}
                </title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="note">
        Color: <span style={{ color: NAME_KIND_COLOR.domain }}>■</span> domain{" "}
        <span style={{ color: NAME_KIND_COLOR.hostname }}>■</span> hostname{" "}
        <span style={{ color: NAME_KIND_COLOR.certificate }}>■</span> certificate{" "}
        <span style={{ color: NAME_KIND_COLOR.forward_dns }}>■</span> forward DNS{" "}
        <span style={{ color: NAME_KIND_COLOR.reverse_dns }}>■</span> reverse DNS (excludes the rDNS
        already shown above, if any). Hover a bar or its label for exact values/timestamps.
      </div>
    </div>
  );
}

// ---------- Findings (verdict__findings) ----------

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

function looksLikeIp(s: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || (s.includes(":") && /^[0-9a-f:]+$/i.test(s));
}

function FindingsList({
  findings,
  onScan,
  scanning,
}: {
  findings: Finding[];
  onScan: (target: string) => void;
  scanning: Set<string>;
}) {
  if (findings.length === 0) return null;

  const sorted = [...findings].sort((a, b) => b.day.localeCompare(a.day));
  // The subjects that are bare IP addresses (a beacon finding's other end),
  // each once, newest finding first: what the copy button puts on the clipboard.
  const subjectIps = [...new Set(sorted.map((f) => f.subject.trim()).filter(looksLikeIp))];

  return (
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
          Findings (90d)
          {subjectIps.length > 0 && (
            <span style={{ fontWeight: 400, fontSize: 12, color: "#6FA89E", marginLeft: 12 }}>
              {subjectIps.length} {subjectIps.length === 1 ? "IP" : "IPs"}
              <CopyButton
                text={subjectIps.join("\n")}
                label={`Copy the ${subjectIps.length === 1 ? "IP" : `${subjectIps.length} IPs`} named in these findings, one per line`}
              />
            </span>
          )}
        </div>
        <span className="src">verdict__findings — no effect on the rollups</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sorted.map((f, i) => {
          const subjectIsUrl = f.subject && looksLikeUrl(f.subject);
          const isScanning = f.subject ? scanning.has(f.subject.trim()) : false;
          return (
            <div
              key={i}
              style={{
                fontSize: 13,
                color: "#C6EBE2",
                background: "#0A2224",
                border: "1px solid #133A3C",
                borderRadius: 7,
                padding: "10px 14px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span className="mono" style={{ color: "#F5A623", fontWeight: 600 }}>
                  {f.rule_name}
                </span>
                <span className="mono" style={{ fontSize: 11, color: "#6FA89E" }}>
                  {f.day}
                </span>
              </div>
              {f.subject && (
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
                  <div className="mono" style={{ fontSize: 12, color: "#A6D8CD", overflowWrap: "anywhere" }}>
                    {f.subject}
                  </div>
                  {subjectIsUrl && (
                    <button
                      onClick={() => onScan(f.subject)}
                      disabled={isScanning}
                      style={{
                        all: "unset",
                        cursor: isScanning ? "default" : "pointer",
                        fontSize: 11,
                        color: isScanning ? "#6FA89E" : "#7FEFD6",
                        flexShrink: 0,
                        whiteSpace: "nowrap",
                      }}
                      title="Request a fresh urlscan of this URL — lookup__web_scans"
                    >
                      {isScanning ? "scanning…" : "▸ scan this"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// lookup__web_scans — renamed from lookup__domain_scans 2026-10-23: every
// ask of urlscan tied to this IP (an automatic sweep finding it via
// Censys/Shodan, a signature rule flagging a URL, or an analyst's own
// request here), plus the one write action on this page: POST
// /lookup/web-scans always submits a fresh, unlisted scan (never reuses
// an existing one — that's the point of asking by hand), returning 202
// with the scan row once urlscan has accepted it.
function WebScansSection({
  ip,
  scans,
  onScan,
  scanning,
  error,
}: {
  ip: string;
  scans: WebScan[];
  onScan: (target: string) => void;
  scanning: Set<string>;
  error: string | null;
}) {
  const [target, setTarget] = useState("");
  const sorted = [...scans].sort((a, b) => b.checked_at.localeCompare(a.checked_at));
  const trimmed = target.trim();
  const isScanning = trimmed.length > 0 && scanning.has(trimmed);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed || isScanning) return;
    onScan(trimmed);
    setTarget("");
  }

  return (
    <div className="card" style={{ padding: "22px 24px", marginBottom: 24 }}>
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
        <div style={{ fontSize: 13, fontWeight: 600 }}>Web scans</div>
        <span className="src">lookup__web_scans</span>
      </div>
      <div style={{ fontSize: 11, color: "#6FA89E", marginBottom: 14, lineHeight: 1.5 }}>
        Every ask of urlscan tied to this IP — a sweep finding it automatically (Censys/Shodan), a
        signature rule flagging a URL, or an analyst requesting one directly below. A request here
        always submits a fresh scan rather than reusing an old result.
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          type="text"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={`http://${ip}:8000/ or a bare domain`}
          className="mono"
          style={{
            flex: "1 1 280px",
            background: "#0A2224",
            color: "#E8FFF8",
            border: "1px solid #2B7266",
            borderRadius: 6,
            padding: "8px 10px",
            fontSize: 12,
          }}
        />
        <button
          type="submit"
          disabled={!trimmed || isScanning}
          style={{
            all: "unset",
            cursor: trimmed && !isScanning ? "pointer" : "default",
            fontSize: 12,
            fontWeight: 500,
            padding: "8px 16px",
            borderRadius: 6,
            border: "1px solid #1E4D37",
            background: "#153226",
            color: trimmed && !isScanning ? "#3DD68C" : "#4D8C7A",
          }}
        >
          {isScanning ? "Requesting…" : "Scan now"}
        </button>
      </form>
      {error && <div style={{ color: "#E5484D", fontSize: 12, marginBottom: 14 }}>Scan request failed: {error}</div>}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>Checked</th>
            <th>Target</th>
            <th>Discovered from</th>
            <th>Preview</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 30).map((s) => (
            <tr key={s.id}>
              <td className="mono" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                {s.checked_at.slice(0, 16).replace("T", " ")}
              </td>
              <td className="mono" style={{ fontSize: 12, overflowWrap: "anywhere" }}>
                {s.target}
              </td>
              <td>
                <span className="chip" style={{ fontSize: 10 }}>
                  {s.discovered_from}
                </span>
                {s.existing_scan_found && (
                  <span style={{ fontSize: 10, color: "#6FA89E", marginLeft: 6 }} title="an earlier scan was reused rather than a fresh one submitted">
                    reused
                  </span>
                )}
              </td>
              <td>
                <WebScanPreview scanId={s.id} resultFetched={Boolean(s.result_fetched_at)} />
              </td>
              <td style={{ fontSize: 12 }}>
                {s.urlscan_result_url ? (
                  <a href={s.urlscan_result_url} target="_blank" rel="noreferrer">
                    view ↗
                  </a>
                ) : s.result_fetched_at ? (
                  <span style={{ color: "#6FA89E" }}>no link</span>
                ) : (
                  <span style={{ color: "#F5A623" }}>pending</span>
                )}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: "#6FA89E" }}>
                No web scans for this IP yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// GET /lookup/web-scans/{id}/result?summary=true — new 2026-10-23, one
// fetch per row rather than one bulk call (no bulk shape exists). Only
// fires once the scan's result is actually in Mongo (result_fetched_at
// set); a "private" visibility scan still returns a summary, but its
// screenshot_url points at urlscan's own CDN, which 404s for anything
// not public/unlisted — handled as a graceful "no preview", not an error.
function WebScanPreview({ scanId, resultFetched }: { scanId: number; resultFetched: boolean }) {
  const [summary, setSummary] = useState<Record<string, unknown> | "loading" | "error" | null>(
    resultFetched ? "loading" : null,
  );
  const [imgFailed, setImgFailed] = useState(false);
  const [lightbox, setLightbox] = useState<"screenshot" | "dom" | null>(null);

  useEffect(() => {
    if (!resultFetched) return;
    let cancelled = false;
    webScanResultLookupWebScansWebScanIdResultGet({
      path: { web_scan_id: scanId },
      query: { summary: true },
    })
      .then((res) => {
        if (cancelled) return;
        setSummary((res.data?.summary as Record<string, unknown> | undefined) ?? "error");
      })
      .catch(() => {
        if (!cancelled) setSummary("error");
      });
    return () => {
      cancelled = true;
    };
  }, [scanId, resultFetched]);

  if (!resultFetched) return <span style={{ color: "#6FA89E", fontSize: 11 }}>—</span>;
  if (summary === "loading") return <span style={{ color: "#6FA89E", fontSize: 11 }}>…</span>;
  if (summary === "error" || summary === null) return <span style={{ color: "#6FA89E", fontSize: 11 }}>no preview</span>;

  const screenshotUrl = typeof summary.screenshot_url === "string" ? summary.screenshot_url : null;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {screenshotUrl && !imgFailed ? (
          <img
            src={screenshotUrl}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            onClick={() => setLightbox("screenshot")}
            alt="page screenshot thumbnail"
            title="Click to enlarge"
            style={{
              width: 56,
              height: 36,
              objectFit: "cover",
              borderRadius: 3,
              border: "1px solid #1E4D37",
              cursor: "pointer",
              display: "block",
            }}
          />
        ) : (
          <span style={{ fontSize: 10, color: "#6FA89E" }} title="No screenshot — urlscan only serves this image for public/unlisted scans">
            no preview
          </span>
        )}
        <button
          onClick={() => setLightbox("dom")}
          style={{ all: "unset", cursor: "pointer", fontSize: 10, color: "#6FA89E", textDecoration: "underline" }}
          title="View the page's captured DOM"
        >
          DOM
        </button>
      </div>
      {lightbox && (
        <WebScanLightbox scanId={scanId} kind={lightbox} screenshotUrl={screenshotUrl} onClose={() => setLightbox(null)} />
      )}
    </>
  );
}

// Rendered through a portal straight to document.body: this page's
// .card ancestor sets backdrop-filter, which (like transform/filter/
// contain) creates a new containing block for position:fixed
// descendants — without the portal the "fixed" overlay is scoped to
// that card instead of the viewport.
//
// The DOM panel renders attacker-reachable content (this is a scan of
// suspected CVS infrastructure) inside our own analyst app's origin, so
// it's sandboxed with every permission withheld — no scripts, no
// same-origin, no forms, no top navigation. Never relax this.
function WebScanLightbox({
  scanId,
  kind,
  screenshotUrl,
  onClose,
}: {
  scanId: number;
  kind: "screenshot" | "dom";
  screenshotUrl: string | null;
  onClose: () => void;
}) {
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(5, 15, 15, 0.85)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0A2224",
          border: "1px solid #2B7266",
          borderRadius: 8,
          width: "min(1000px, 100%)",
          height: kind === "dom" ? "min(800px, 90vh)" : "auto",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 14px",
            borderBottom: "1px solid #1E4D37",
            flex: "0 0 auto",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600 }}>{kind === "screenshot" ? "Screenshot" : "Captured DOM"}</span>
          <button onClick={onClose} style={{ all: "unset", cursor: "pointer", fontSize: 12, color: "#6FA89E" }}>
            close ✕
          </button>
        </div>
        {kind === "screenshot" ? (
          screenshotUrl ? (
            <img src={screenshotUrl} alt="page screenshot, full size" style={{ width: "100%", display: "block", overflow: "auto" }} />
          ) : (
            <div style={{ padding: 20, color: "#6FA89E", fontSize: 12 }}>No screenshot available.</div>
          )
        ) : (
          <iframe
            src={`/api/netflow-rollups/lookup/web-scans/${scanId}/dom`}
            title="captured DOM"
            sandbox=""
            referrerPolicy="no-referrer"
            style={{ flex: 1, border: "none", background: "#fff" }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

function urlscanResultLink(uuid: string | null): string | null {
  return uuid ? `https://urlscan.io/result/${uuid}/` : null;
}

// verdict__web_scan_pivots (verdict__domain_pivots until netflow-rollups step 22) — new 2026-10-23: a resource on this IP's page
// (urlscan-fetched) shares a content hash with one served by another
// domain, and only a small number of domains do (the rule's own filter —
// a hash common to hundreds of sites, a shared CDN library, wouldn't
// qualify). Not proof of a relationship by itself, just a fingerprint
// worth an analyst's eye — framed that way below rather than as a verdict.
function SharesContentWith({ pivots }: { pivots: WebScanPivot[] }) {
  const [trackedDomains, setTrackedDomains] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (pivots.length === 0) return;
    let cancelled = false;
    fetchMonitored()
      .then((domains) => {
        if (!cancelled) setTrackedDomains(new Map(domains.map((d) => [d.value, d.opencti_id])));
      })
      .catch(() => {
        // Cross-reference is a nice-to-have, not load-bearing — the pivot
        // list below still renders fine without it.
      });
    return () => {
      cancelled = true;
    };
  }, [pivots.length]);

  if (pivots.length === 0) return null;

  const sorted = [...pivots].sort((a, b) => b.detected_at.localeCompare(a.detected_at));

  return (
    <div className="card" style={{ padding: "22px 24px", marginBottom: 24 }}>
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
        <div style={{ fontSize: 13, fontWeight: 600 }}>Shares content with</div>
        <span className="src">verdict__web_scan_pivots</span>
      </div>
      <div style={{ fontSize: 11, color: "#6FA89E", marginBottom: 14, lineHeight: 1.5 }}>
        A resource urlscan fetched from this IP's page has the same content hash as one served by
        another domain — a shared kit, template, or hosting fingerprint, not proof of a
        relationship by itself. A lower domain count is a tighter, more unusual match.{" "}
        <span className="chip" style={{ fontSize: 9 }}>
          tracked
        </span>{" "}
        flags a domain already on this project's own Domains list.
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>Detected</th>
            <th>Source</th>
            <th>Hash</th>
            <th style={{ textAlign: "right" }}># domains</th>
            <th>Shares with</th>
            <th>Scans</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const trackedId = trackedDomains.get(p.matched_target);
            const rare = p.distinct_target_count_at_detection <= 2;
            const sourceLink = urlscanResultLink(p.source_scan_uuid);
            const matchedLink = urlscanResultLink(p.matched_scan_uuid);
            return (
              <tr key={p.id}>
                <td className="mono" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                  {p.detected_at.slice(0, 10)}
                </td>
                <td className="mono" style={{ fontSize: 12, overflowWrap: "anywhere" }}>
                  {p.source_target}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <span className="mono" style={{ fontSize: 11, color: "#A6D8CD" }}>
                    {p.hash.slice(0, 12)}…
                  </span>
                  <CopyButton text={p.hash} label="Copy hash" />
                </td>
                <td
                  className="num mono"
                  style={{
                    textAlign: "right",
                    color: rare ? "#F5A623" : undefined,
                    fontWeight: rare ? 600 : undefined,
                  }}
                  title={rare ? "A tight match — few other domains serve this exact resource" : undefined}
                >
                  {p.distinct_target_count_at_detection}
                </td>
                <td>
                  {trackedId ? (
                    <Link to={`/domains/${trackedId}`} className="mono row-link">
                      {p.matched_target}
                    </Link>
                  ) : (
                    <span className="mono">{p.matched_target}</span>
                  )}
                  {trackedId && (
                    <span className="chip" style={{ fontSize: 9, marginLeft: 6 }}>
                      tracked
                    </span>
                  )}
                </td>
                <td style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                  {sourceLink && (
                    <a href={sourceLink} target="_blank" rel="noreferrer">
                      source ↗
                    </a>
                  )}
                  {sourceLink && matchedLink && " · "}
                  {matchedLink && (
                    <a href={matchedLink} target="_blank" rel="noreferrer">
                      match ↗
                    </a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const HEATMAP_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// The hourly rollup keeps 180 days, but "all history" would be 180 days of per-peer hourly
// rows, far past the route's 20,000-row cap; 90 days of the busiest watched IP is ~18,000.
const HEATMAP_WINDOWS: readonly WindowKey[] = ["7d", "30d", "90d"];
const HOURLY_ROW_CAP = 20000;
const CHUNK_DAYS = 30;
type HeatMeasure = "bytes" | "flows";

function emptyGrid(): number[][] {
  return Array.from({ length: 7 }, () => Array(24).fill(0));
}

type HeatGrids = {
  // family -> measure -> dow x hour totals over the window
  families: { key: string; bytes: number; flows: number; grid: Record<HeatMeasure, number[][]> }[];
  // how many dates of each weekday the window covers, so a cell can be an average per hour
  occurrences: number[];
  // the UTC dates (YYYY-MM-DD, oldest first) behind each weekday row, for the row labels
  dates: string[][];
  truncated: boolean;
};

function ActivityHeatmap({ ip }: { ip: string }) {
  const [grids, setGrids] = useState<HeatGrids | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [windowKey, setWindowKey] = useState<WindowKey>("7d");
  const [measure, setMeasure] = useState<HeatMeasure>("bytes");
  // null = every family present (the default); a set once the analyst switches one off
  const [selected, setSelected] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGrids(null);
    setError(null);
    setSelected(null);

    async function load() {
      try {
        const days = windowRange(windowKey).days ?? 90;
        const to = new Date();
        const from = daysAgo(days - 1);
        from.setUTCHours(0, 0, 0, 0);
        // One call per 30 days, so a 90-day read of a busy IP stays under the row cap.
        const chunks: { from: Date; to: Date }[] = [];
        for (let start = new Date(from); start < to; ) {
          const end = new Date(start);
          end.setUTCDate(end.getUTCDate() + CHUNK_DAYS);
          chunks.push({ from: new Date(start), to: end < to ? new Date(end.getTime() - 1) : to });
          start = end;
        }
        const results = await Promise.all(
          chunks.map((c) =>
            flowHourlyRollupFlowHourlyGet({
              query: { watched_ip: ip, from: c.from.toISOString(), to: c.to.toISOString(), limit: HOURLY_ROW_CAP },
              throwOnError: true,
            }),
          ),
        );
        if (cancelled) return;

        const byFamily = new Map<string, { bytes: number; flows: number; grid: Record<HeatMeasure, number[][]> }>();
        let truncated = false;
        for (const result of results) {
          if (result.data.rows.length >= HOURLY_ROW_CAP) truncated = true;
          for (const r of result.data.rows) {
            let f = byFamily.get(r.port_family);
            if (!f) {
              f = { bytes: 0, flows: 0, grid: { bytes: emptyGrid(), flows: emptyGrid() } };
              byFamily.set(r.port_family, f);
            }
            const t = new Date(r.hour);
            const dow = (t.getUTCDay() + 6) % 7; // Monday-first
            f.grid.bytes[dow][t.getUTCHours()] += r.bytes_sum;
            f.grid.flows[dow][t.getUTCHours()] += r.flow_count;
            f.bytes += r.bytes_sum;
            f.flows += r.flow_count;
          }
        }
        const dates: string[][] = Array.from({ length: 7 }, () => []);
        for (const d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1))
          dates[(d.getUTCDay() + 6) % 7].push(d.toISOString().slice(0, 10));
        setGrids({
          families: [...byFamily.entries()].map(([key, f]) => ({ key, ...f })).sort((a, b) => b.bytes - a.bytes),
          occurrences: dates.map((d) => d.length),
          dates,
          truncated,
        });
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [ip, windowKey]);

  const allKeys = grids?.families.map((f) => f.key) ?? [];
  const active = selected ?? new Set(allKeys);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev ?? allKeys);
      if (next.has(key)) {
        if (next.size === 1) return prev;
        next.delete(key);
      } else next.add(key);
      return next.size === allKeys.length ? null : next;
    });
  }

  // Cells are the average per hour slot: the window's total divided by how many dates of
  // that weekday it covers, so 7d and 90d read on the same footing.
  const combined = emptyGrid();
  if (grids) {
    for (const f of grids.families) {
      if (!active.has(f.key)) continue;
      const g = f.grid[measure];
      for (let d = 0; d < 7; d++) {
        const n = grids.occurrences[d] || 1;
        for (let h = 0; h < 24; h++) combined[d][h] += g[d][h] / n;
      }
    }
  }
  const max = Math.max(0, ...combined.flat());
  const fmt = (v: number) => (measure === "bytes" ? formatBytes(v) : `${Math.round(v).toLocaleString()} flows`);
  const windowLabel = windowRange(windowKey).label;
  // Month/day of the dates behind a weekday row: one date over 7 days, first-last over longer windows.
  const md = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
  const rowDates = (dayIdx: number) => {
    const d = grids?.dates[dayIdx] ?? [];
    if (d.length === 0) return "";
    return d.length === 1 ? md(d[0]) : `${md(d[0])}–${md(d[d.length - 1])}`;
  };
  const singleDates = grids ? grids.dates.every((d) => d.length <= 1) : false;
  // Rows in date order, oldest first: by the first date each weekday has in the window. Over 7
  // days that is plain date order ending today; over longer windows the first dates ascend.
  const rowOrder = [0, 1, 2, 3, 4, 5, 6].sort((a, b) =>
    (grids?.dates[a][0] ?? "").localeCompare(grids?.dates[b][0] ?? ""),
  );

  return (
    <div className="card" style={{ padding: "22px 24px", marginBottom: 28 }}>
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
        <div style={{ fontSize: 15, fontWeight: 600 }}>Traffic by hour — {windowLabel}</div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <WindowSelect value={windowKey} onChange={setWindowKey} label="Window" keys={HEATMAP_WINDOWS} />
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>Measure</span>
            <div style={{ display: "inline-flex" }}>
              {(["bytes", "flows"] as const).map((m, i) => (
                <button
                  key={m}
                  onClick={() => setMeasure(m)}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    fontSize: 12,
                    padding: "5px 12px",
                    color: measure === m ? "#E8FFF8" : "#A6D8CD",
                    background: measure === m ? "#133A3C" : "transparent",
                    borderStyle: "solid",
                    borderColor: measure === m ? "#3F9C8A" : "#2B7266",
                    borderWidth: i === 0 ? "1px" : "1px 1px 1px 0",
                    borderRadius: i === 0 ? "6px 0 0 6px" : "0 6px 6px 0",
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <span className="src">
            /rollup/flow-hourly ·{" "}
            {grids
              ? active.size === allKeys.length
                ? `all ${allKeys.length} port families`
                : `${active.size} of ${allKeys.length} port families`
              : "…"}
          </span>
        </div>
      </div>

      {error && (
        <div style={{ color: "#E5484D", fontSize: 13 }}>Failed to load: {error}</div>
      )}
      {!grids && !error && <div style={{ color: "#6FA89E", fontSize: 13 }}>Loading…</div>}

      {grids && grids.truncated && (
        <div style={{ color: "#F5A623", fontSize: 12, marginBottom: 12 }}>
          A 30-day chunk hit the route's {HOURLY_ROW_CAP.toLocaleString()}-row cap; the quietest hours of that chunk
          may be missing. Pick a shorter window for the full picture.
        </div>
      )}

      {grids && grids.families.length === 0 && (
        <div style={{ color: "#6FA89E", fontSize: 13 }}>No traffic in this window.</div>
      )}

      {grids && grids.families.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            {grids.families.map((f) => {
              const checked = active.has(f.key);
              return (
                <button
                  key={f.key}
                  onClick={() => toggle(f.key)}
                  title={`${f.key} · ${formatBytes(f.bytes)} · ${f.flows.toLocaleString()} flows over ${windowLabel}`}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "7px 14px 7px 10px",
                    borderRadius: 8,
                    border: `1px solid ${checked ? "#3F9C8A" : "rgba(72,196,170,0.3)"}`,
                    background: checked ? "rgba(72,196,170,0.12)" : "transparent",
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      border: `1.5px solid ${checked ? "#5FE3C7" : "rgba(166,216,205,0.5)"}`,
                      background: checked ? "#5FE3C7" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      boxSizing: "border-box",
                    }}
                  >
                    {checked && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path
                          d="M1 4L3.5 6.5L9 1"
                          stroke="#061214"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: familyColor(f.key), flexShrink: 0 }} />
                  <span className="mono" style={{ fontSize: 12, color: checked ? "#E8FFF8" : "#6FA89E" }}>
                    {f.key}
                  </span>
                </button>
              );
            })}
            {selected !== null && (
              <button
                onClick={() => setSelected(null)}
                style={{ all: "unset", cursor: "pointer", fontSize: 12, color: "#A6D8CD", textDecoration: "underline", marginLeft: 4 }}
              >
                all families
              </button>
            )}
          </div>

          <div style={{ fontSize: 11, color: "#6FA89E", marginBottom: 16 }}>
            UTC hours and dates (month/day) · rows in date order, oldest first ·{" "}
            {singleDates
              ? "each row is one date, each cell that date's hour"
              : `each cell is the average for that weekday and hour over ${windowLabel} (${Math.min(...grids.occurrences)} to ${Math.max(...grids.occurrences)} dates per weekday; the label gives the first and last)`}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "max-content repeat(24,1fr)", gap: 3, alignItems: "center" }}>
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="mono" style={{ fontSize: 9, color: "#6FA89E", textAlign: "center" }}>
                {String(h).padStart(2, "0")}
              </div>
            ))}
            {rowOrder.map((dayIdx) => {
              const hours = combined[dayIdx];
              return (
              <Fragment key={dayIdx}>
                <div
                  className="mono"
                  style={{ fontSize: 11, color: "#A6D8CD", whiteSpace: "nowrap", paddingRight: 8 }}
                  title={
                    grids.dates[dayIdx].length > 1
                      ? `${grids.dates[dayIdx].length} dates: ${grids.dates[dayIdx].map(md).join(", ")}`
                      : grids.dates[dayIdx][0]
                  }
                >
                  {HEATMAP_DAYS[dayIdx]} <span style={{ color: "#6FA89E" }}>{rowDates(dayIdx)}</span>
                </div>
                {hours.map((value, hour) => {
                  const t = max > 0 ? Math.sqrt(value) / Math.sqrt(max) : 0;
                  return (
                    <div
                      key={hour}
                      title={
                        grids.dates[dayIdx].length > 1
                          ? `${HEATMAP_DAYS[dayIdx]} ${String(hour).padStart(2, "0")}:00 UTC · ${fmt(value)} per hour, average of ${grids.dates[dayIdx].length} dates (${rowDates(dayIdx)})`
                          : `${HEATMAP_DAYS[dayIdx]} ${rowDates(dayIdx)} ${String(hour).padStart(2, "0")}:00 UTC · ${fmt(value)}`
                      }
                      style={{
                        height: 22,
                        borderRadius: 3,
                        background: darkToGreen(t),
                        border: "1px solid rgba(72,196,170,0.18)",
                      }}
                    />
                  );
                })}
              </Fragment>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
            <span className="mono" style={{ fontSize: 10, color: "#6FA89E" }}>
              {fmt(0)}/h
            </span>
            <div style={{ display: "flex", gap: 2 }}>
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} style={{ width: 18, height: 10, borderRadius: 2, background: darkToGreen(i / 7) }} />
              ))}
            </div>
            <span className="mono" style={{ fontSize: 10, color: "#6FA89E" }}>
              {fmt(max)}/h
            </span>
          </div>
        </>
      )}
    </div>
  );
}
