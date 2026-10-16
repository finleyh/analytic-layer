import { useEffect, useMemo, useState } from "react";
import * as d3 from "d3";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import countries from "i18n-iso-countries";
import countries110m from "world-atlas/countries-110m.json";
import {
  flowDailyRollupFlowDailyGet,
  listIpsWatchIpsGet,
  getIpIdentityLookupIpIdentitiesIpGet,
  type DailyFlow,
  type WatchedIp,
} from "../api/netflow-rollups-client";
import { formatBytes } from "../lib/format";
import { ZoomableSvg } from "../components/ZoomableSvg";

const W = 900;
const H = 520;

const ROLE_COLOR: Record<string, string> = {
  sip_trunk: "#F5A623",
  sip_client: "#2DD4BF",
  sip_server: "#E5484D",
  unclear: "#6FA89E",
  mixed: "#A6D8CD",
};

// Topology ids and i18n-iso-countries' numeric codes both represent
// ISO 3166-1 numeric, but one zero-pads and the other doesn't — normalize
// both to a bare integer string before matching.
function normNumeric(id: string | number): string {
  return String(parseInt(String(id), 10));
}

const countryFeatures = feature(
  countries110m as unknown as Topology,
  countries110m.objects.countries as GeometryCollection,
).features;

const centroidByNumeric = new Map<string, [number, number]>();
const nameByNumeric = new Map<string, string>();
for (const f of countryFeatures) {
  const id = normNumeric(f.id as string);
  centroidByNumeric.set(id, d3.geoCentroid(f));
  nameByNumeric.set(id, (f.properties as { name: string }).name);
}

function centroidForAlpha2(alpha2: string): [number, number] | null {
  const numeric = countries.alpha2ToNumeric(alpha2);
  if (!numeric) return null;
  return centroidByNumeric.get(normNumeric(numeric)) ?? null;
}

type Arc = {
  monitoredIp: string;
  peerCountry: string;
  bytes: number;
  peers: Set<string>;
  roleCounts: Record<string, number>;
};

type GeoData = {
  rows: DailyFlow[];
  watched: WatchedIp[];
  originByIp: Map<string, string | null>; // monitored_ip -> alpha2 country
};

export function Geo() {
  const [data, setData] = useState<GeoData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [monitoredFilter, setMonitoredFilter] = useState<string>("");
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [flowResult, watchResult] = await Promise.all([
          flowDailyRollupFlowDailyGet({
            query: { port_family: "rtp_media", limit: 20000 },
            throwOnError: true,
          }),
          listIpsWatchIpsGet({ throwOnError: true }),
        ]);
        if (cancelled) return;
        const watched = watchResult.data.rows;

        const identityEntries = await Promise.all(
          watched.map(async (w) => {
            try {
              const r = await getIpIdentityLookupIpIdentitiesIpGet({ path: { ip: w.ip } });
              return [w.ip, r.data?.country ?? null] as const;
            } catch {
              return [w.ip, null] as const;
            }
          }),
        );
        if (cancelled) return;

        setData({
          rows: flowResult.data.rows,
          watched,
          originByIp: new Map(identityEntries),
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

  const arcs = useMemo(() => {
    if (!data) return [];
    const filtered = monitoredFilter ? data.rows.filter((r) => r.monitored_ip === monitoredFilter) : data.rows;
    const byKey = new Map<string, Arc>();
    for (const r of filtered) {
      if (!r.peer_country) continue;
      const key = `${r.monitored_ip}|${r.peer_country}`;
      const a = byKey.get(key) ?? {
        monitoredIp: r.monitored_ip,
        peerCountry: r.peer_country,
        bytes: 0,
        peers: new Set<string>(),
        roleCounts: {},
      };
      a.bytes += r.bytes_sum;
      a.peers.add(r.peer_ip);
      const role = r.peer_role ?? "unclear";
      a.roleCounts[role] = (a.roleCounts[role] ?? 0) + 1;
      byKey.set(key, a);
    }
    return [...byKey.values()];
  }, [data, monitoredFilter]);

  const countryTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of arcs) m.set(a.peerCountry, (m.get(a.peerCountry) ?? 0) + a.bytes);
    return m;
  }, [arcs]);

  const totalBytes = [...countryTotals.values()].reduce((a, b) => a + b, 0);
  const topCountry = [...countryTotals.entries()].sort((a, b) => b[1] - a[1])[0];

  if (error) {
    return (
      <div className="card" style={{ padding: 20, borderColor: "#5A2327" }}>
        Failed to load from netflow-rollups' API: {error}
      </div>
    );
  }
  if (!data) return <div style={{ color: "#6FA89E" }}>Loading…</div>;

  const projection = d3.geoNaturalEarth1().fitSize([W, H], { type: "Sphere" });
  const path = d3.geoPath(projection);

  function dominantRole(a: Arc): string {
    const entries = Object.entries(a.roleCounts);
    if (entries.length === 0) return "unclear";
    if (entries.length > 1) return "mixed";
    return entries[0][0];
  }

  const peersInSelectedCountry = selectedCountry
    ? arcs.filter((a) => a.peerCountry === selectedCountry)
    : [];

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: "0 0 4px 0", fontSize: 22, fontWeight: 600 }}>Geo</h1>
        <div style={{ fontSize: 13, color: "#6FA89E" }}>
          Where each monitored IP's SIP media (<span className="mono">rtp_media</span>) goes, by
          country · <span className="mono">rollup__flow_daily</span>.peer_country · arcs from{" "}
          <span className="mono">lookup__ip_identities</span>.country (jittered via country
          centroids, not exact geolocation)
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>Monitored IP</label>
          <select
            value={monitoredFilter}
            onChange={(e) => {
              setMonitoredFilter(e.target.value);
              setSelectedCountry(null);
            }}
            style={{ background: "#0A2224", color: "#E8FFF8", border: "1px solid #2B7266", borderRadius: 6, padding: "5px 8px", fontSize: 12 }}
          >
            <option value="">all {data.watched.length}</option>
            {data.watched.map((w) => (
              <option key={w.ip} value={w.ip}>
                {w.ip}
              </option>
            ))}
          </select>
        </div>
        <span className="src">
          {countryTotals.size} countries · {formatBytes(totalBytes)}
          {topCountry && ` · top ${topCountry[0]} (${formatBytes(topCountry[1])})`}
        </span>
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div className="card" style={{ width: W, maxWidth: "100%", height: H, position: "relative", overflow: "hidden", flexShrink: 0 }}>
          <ZoomableSvg width={W} height={H}>
            <path d={path({ type: "Sphere" }) ?? undefined} fill="#081c1e" />
            {countryFeatures.map((f, i) => (
              <path
                key={i}
                d={path(f) ?? undefined}
                fill={selectedCountry && normNumeric(f.id as string) === normNumeric(countries.alpha2ToNumeric(selectedCountry) ?? "0") ? "#133A3C" : "#0C2A2C"}
                stroke="#1E4D37"
                strokeWidth={0.5}
                onClick={() => {
                  const alpha2 = countries.numericToAlpha2(normNumeric(f.id as string).padStart(3, "0"));
                  if (alpha2 && countryTotals.has(alpha2)) setSelectedCountry(alpha2 === selectedCountry ? null : alpha2);
                }}
                style={{ cursor: countryTotals.has(countries.numericToAlpha2(normNumeric(f.id as string).padStart(3, "0")) ?? "") ? "pointer" : "default" }}
              >
                <title>{nameByNumeric.get(normNumeric(f.id as string))}</title>
              </path>
            ))}
            {arcs.map((a, i) => {
              const origin = data.originByIp.get(a.monitoredIp);
              if (!origin) return null;
              const src = centroidForAlpha2(origin);
              const dst = centroidForAlpha2(a.peerCountry);
              if (!src || !dst) return null;
              const [x1, y1] = projection(src) ?? [0, 0];
              const [x2, y2] = projection(dst) ?? [0, 0];
              const mx = (x1 + x2) / 2;
              const my = (y1 + y2) / 2 - Math.min(80, Math.hypot(x2 - x1, y2 - y1) * 0.25);
              const role = dominantRole(a);
              const width = Math.max(0.6, Math.min(5, Math.sqrt(a.bytes) / 400));
              return (
                <path
                  key={i}
                  d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`}
                  fill="none"
                  stroke={ROLE_COLOR[role] ?? ROLE_COLOR.unclear}
                  strokeWidth={width}
                  opacity={0.65}
                >
                  <title>
                    {a.monitoredIp} → {a.peerCountry} · {formatBytes(a.bytes)} · {a.peers.size} peer
                    {a.peers.size === 1 ? "" : "s"} · {role}
                  </title>
                </path>
              );
            })}
          </ZoomableSvg>
          <div style={{ position: "absolute", bottom: 10, right: 10, fontSize: 10, color: "#6FA89E", pointerEvents: "none" }}>
            scroll to zoom · drag to pan · click a shaded country
          </div>
        </div>

        <div style={{ width: 284, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ padding: "16px 18px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: "#A6D8CD" }}>Legend</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 12 }}>
              {Object.entries(ROLE_COLOR).map(([role, color]) => (
                <div key={role} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 18, height: 3, background: color, display: "inline-block", flexShrink: 0 }} />
                  {role === "mixed" ? "mixed roles" : role}
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: "16px 18px", minHeight: 120 }}>
            {!selectedCountry ? (
              <div style={{ fontSize: 13, color: "#6FA89E", lineHeight: 1.5 }}>
                Click a shaded country to see which monitored IPs reach it.
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{selectedCountry}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {peersInSelectedCountry.map((a, i) => (
                    <div key={i} style={{ fontSize: 12 }}>
                      <span className="mono">{a.monitoredIp}</span> · {formatBytes(a.bytes)} ·{" "}
                      {a.peers.size} peer{a.peers.size === 1 ? "" : "s"} · {dominantRole(a)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="card" style={{ padding: "16px 18px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: "#F5A623" }}>Data notes</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9, fontSize: 12, color: "#A6D8CD", lineHeight: 1.5 }}>
              <div>
                Arc endpoints are country centroids, not real geolocation — two peers in the same
                country land on the same point.
              </div>
              <div>
                A monitored IP with no resolved identity (no{" "}
                <span className="mono">lookup__ip_identities</span> row yet) draws no arcs; it
                still counts in totals.
              </div>
              <div>Not built yet: the weekly scrubber, per-IP stacked bars, and country tiles from the mockup.</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
