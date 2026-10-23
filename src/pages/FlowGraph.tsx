import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { sankey, sankeyLinkHorizontal, sankeyJustify, type SankeyNodeMinimal, type SankeyLinkMinimal } from "d3-sankey";
import {
  confirmedContactsDailyRollupConfirmedContactsDailyGet,
  flowDailyRollupFlowDailyGet,
  listIpRolesReviewIpRolesGet,
  listIpsWatchIpsGet,
  vocabularyRulesVocabularyGet,
  type DailyConfirmedContact,
  type DailyFlow,
  type IpRole,
  type WatchedIp,
} from "../api/netflow-rollups-client";
import { formatBytes, isoDate, daysAgo } from "../lib/format";
import { categoryColors } from "../lib/categories";
import { ZoomableSvg } from "../components/ZoomableSvg";

type Tab = "graph" | "sankey";

// Deterministic, not a hand-picked palette: confirmed roles alone span 8
// values today across ~20 possible ones, and traffic types span 20 distinct
// port_family values on confirmed-contacts edges — too many to maintain by
// hand, and a hardcoded map silently drops a new value into "unstyled"
// forever (what happened here before: a 3-entry ROLE_COLORS map meant a
// confirmed web_server or c2_server node looked identical to one with no
// confirmed role at all). A hash of the string is cheap, stable across
// reloads, and never missing an entry.
function hueOf(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % 360;
}
function roleColor(role: string): { bg: string; border: string } {
  const hue = hueOf(`role:${role}`);
  return { bg: `hsl(${hue}, 55%, 14%)`, border: `hsl(${hue}, 70%, 60%)` };
}
function familyColor(family: string): string {
  return `hsl(${hueOf(`family:${family}`)}, 65%, 58%)`;
}

export function FlowGraph() {
  const [tab, setTab] = useState<Tab>("graph");

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: "0 0 4px 0", fontSize: 22, fontWeight: 600 }}>Flow graph</h1>
        <div style={{ fontSize: 13, color: "#6FA89E" }}>
          Edges from <span className="mono">rollup__confirmed_contacts_daily</span>, colored by
          dominant traffic type · peer color from <span className="mono">rollup__flow_daily</span>
          .peer_categories · monitored-node color from <span className="mono">review__ip_roles</span>
          — solid = confirmed, dashed = suggested, satellite dots mark roles beyond the primary one
        </div>
      </div>

      <div style={{ display: "flex", gap: 28, borderBottom: "1px solid #2B7266", marginBottom: 22 }}>
        <button
          onClick={() => setTab("graph")}
          style={{
            all: "unset",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 500,
            padding: "9px 4px",
            color: tab === "graph" ? "#E8FFF8" : "#6FA89E",
            borderBottom: tab === "graph" ? "2px solid #4C8DFF" : "2px solid transparent",
          }}
        >
          Node graph
        </button>
        <button
          onClick={() => setTab("sankey")}
          style={{
            all: "unset",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 500,
            padding: "9px 4px",
            color: tab === "sankey" ? "#E8FFF8" : "#6FA89E",
            borderBottom: tab === "sankey" ? "2px solid #4C8DFF" : "2px solid transparent",
          }}
        >
          Sankey — SIP/VoIP bytes, 30d
        </button>
      </div>

      {tab === "graph" && <NodeGraph />}
      {tab === "sankey" && <SankeyDiagram />}
    </>
  );
}

// ---------- Node graph ----------

type GNode = {
  id: string;
  kind: "monitored" | "peer" | "cluster";
  label: string;
  bytes: number;
  category?: string;
  confirmedRoles?: string[];
  pendingRoles?: string[];
  asn?: number | null;
  country?: string | null;
  clusterCount?: number;
  tags?: string[];
  x: number;
  y: number;
  r: number;
};
type GLink = { source: string; target: string; bytes: number; kind: "mm" | "mp"; dominantFamily: string };

function buildGraph(
  confirmed: DailyConfirmedContact[],
  flow: DailyFlow[],
  roles: Map<string, IpRole[]>,
  watched: Map<string, WatchedIp>,
): { nodes: GNode[]; links: GLink[] } {
  const watchedIps = new Set(watched.keys());

  // Dedup monitored<->monitored edges (stored once per side's pull); keep
  // the larger measured side rather than summing both.
  const edgeBytes = new Map<string, { bytes: number; a: string; b: string; kind: "mm" | "mp" }>();
  // Bytes per port_family, per edge — picks which traffic type colors the
  // edge. For an mm edge this sums both sides' breakdowns rather than
  // picking the larger side's alone (edgeBytes does that for the total);
  // an approximation, same spirit as edgeBytes' own "keep the larger side"
  // compromise — good enough to say which traffic type dominates, not
  // meant to be a byte-exact total.
  const edgeFamilyBytes = new Map<string, Map<string, number>>();
  for (const r of confirmed) {
    const bIsWatched = watchedIps.has(r.peer_ip);
    const kind: "mm" | "mp" = bIsWatched ? "mm" : "mp";
    const key = bIsWatched
      ? ["mm", ...[r.monitored_ip, r.peer_ip].sort()].join("|")
      : `mp|${r.monitored_ip}|${r.peer_ip}`;
    const existing = edgeBytes.get(key);
    if (!existing) {
      edgeBytes.set(key, { bytes: r.bytes_sum, a: r.monitored_ip, b: r.peer_ip, kind });
    } else if (kind === "mm") {
      existing.bytes = Math.max(existing.bytes, r.bytes_sum);
    } else {
      existing.bytes += r.bytes_sum;
    }
    const fam = edgeFamilyBytes.get(key) ?? new Map<string, number>();
    fam.set(r.port_family, (fam.get(r.port_family) ?? 0) + r.bytes_sum);
    edgeFamilyBytes.set(key, fam);
  }
  function dominantFamily(key: string): string {
    const fam = edgeFamilyBytes.get(key);
    if (!fam || fam.size === 0) return "other";
    return [...fam.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  // peer_ip -> categories, from flow_daily (confirmed-contacts doesn't carry them)
  const categoriesByPeer = new Map<string, string[]>();
  const asnByPeer = new Map<string, number | null>();
  const countryByPeer = new Map<string, string | null>();
  for (const r of flow) {
    if (!categoriesByPeer.has(r.peer_ip) && r.peer_categories.length > 0) {
      categoriesByPeer.set(r.peer_ip, r.peer_categories);
    }
    if (!asnByPeer.has(r.peer_ip)) asnByPeer.set(r.peer_ip, r.peer_asn);
    if (!countryByPeer.has(r.peer_ip)) countryByPeer.set(r.peer_ip, r.peer_country);
  }

  const monitoredBytes = new Map<string, number>();
  const peerBytes = new Map<string, number>();
  for (const e of edgeBytes.values()) {
    monitoredBytes.set(e.a, (monitoredBytes.get(e.a) ?? 0) + e.bytes);
    if (e.kind === "mm") {
      monitoredBytes.set(e.b, (monitoredBytes.get(e.b) ?? 0) + e.bytes);
    } else {
      peerBytes.set(e.b, (peerBytes.get(e.b) ?? 0) + e.bytes);
    }
  }

  const totalBytes = [...monitoredBytes.values(), ...peerBytes.values()].reduce((a, b) => a + b, 0) || 1;
  const smallThreshold = totalBytes * 0.005;

  // Cluster small peers that share an ASN into one node each.
  const clusterOf = new Map<string, string>(); // peer_ip -> cluster node id
  const byAsn = new Map<number, string[]>();
  for (const [peerIp, bytes] of peerBytes) {
    const asn = asnByPeer.get(peerIp);
    if (bytes < smallThreshold && asn) {
      const list = byAsn.get(asn) ?? [];
      list.push(peerIp);
      byAsn.set(asn, list);
    }
  }
  for (const [asn, peers] of byAsn) {
    if (peers.length < 3) continue; // not worth collapsing 1-2 peers
    const clusterId = `cluster:${asn}`;
    for (const p of peers) clusterOf.set(p, clusterId);
  }

  const nodeRadius = d3.scaleSqrt().domain([0, totalBytes]).range([6, 42]);
  const nodes = new Map<string, GNode>();

  function monitoredNode(ip: string): GNode {
    const existing = nodes.get(ip);
    if (existing) return existing;
    const roleRows = roles.get(ip) ?? [];
    const w = watched.get(ip);
    const n: GNode = {
      id: ip,
      kind: "monitored",
      label: ip,
      bytes: monitoredBytes.get(ip) ?? 0,
      confirmedRoles: roleRows.filter((r) => r.status === "confirmed").map((r) => r.role),
      pendingRoles: roleRows.filter((r) => r.status !== "confirmed" && r.status !== "rejected").map((r) => r.role),
      tags: w?.tags.filter((t) => !t.startsWith("msk:")) ?? [],
      x: 0,
      y: 0,
      r: Math.max(10, nodeRadius(monitoredBytes.get(ip) ?? 0)),
    };
    nodes.set(ip, n);
    return n;
  }

  function peerNode(ip: string): GNode {
    const cid = clusterOf.get(ip);
    if (cid) {
      const existing = nodes.get(cid);
      if (existing) {
        existing.bytes += peerBytes.get(ip) ?? 0;
        existing.clusterCount = (existing.clusterCount ?? 0) + 1;
        existing.r = Math.max(10, nodeRadius(existing.bytes));
        return existing;
      }
      const asn = asnByPeer.get(ip);
      const n: GNode = {
        id: cid,
        kind: "cluster",
        label: `AS${asn} cluster`,
        bytes: peerBytes.get(ip) ?? 0,
        category: categoriesByPeer.get(ip)?.[0] ?? "unclassified",
        asn,
        country: countryByPeer.get(ip) ?? null,
        clusterCount: 1,
        x: 0,
        y: 0,
        r: 10,
      };
      nodes.set(cid, n);
      return n;
    }
    const existing = nodes.get(ip);
    if (existing) return existing;
    const n: GNode = {
      id: ip,
      kind: "peer",
      label: ip,
      bytes: peerBytes.get(ip) ?? 0,
      category: categoriesByPeer.get(ip)?.[0] ?? "unclassified",
      asn: asnByPeer.get(ip),
      country: countryByPeer.get(ip) ?? null,
      x: 0,
      y: 0,
      r: Math.max(6, nodeRadius(peerBytes.get(ip) ?? 0)),
    };
    nodes.set(ip, n);
    return n;
  }

  const links: GLink[] = [];
  for (const [key, e] of edgeBytes) {
    const a = monitoredNode(e.a);
    const b = e.kind === "mm" ? monitoredNode(e.b) : peerNode(e.b);
    links.push({ source: a.id, target: b.id, bytes: e.bytes, kind: e.kind, dominantFamily: dominantFamily(key) });
  }

  return { nodes: [...nodes.values()], links };
}

function NodeGraph() {
  const [watchedIps, setWatchedIps] = useState<WatchedIp[] | null>(null);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [roleMeaning, setRoleMeaning] = useState<Map<string, string>>(new Map());
  const [selectedIps, setSelectedIps] = useState<Set<string>>(new Set());
  const [data, setData] = useState<{ nodes: GNode[]; links: GLink[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GNode | null>(null);
  const W = 800;
  const H = 620;

  // The picker only needs the (cheap) watch set — the expensive rollup
  // fetches and the d3-force layout below stay deferred until the analyst
  // actually picks which monitored IPs to graph.
  useEffect(() => {
    let cancelled = false;
    listIpsWatchIpsGet({ throwOnError: true })
      .then((r) => {
        if (!cancelled) setWatchedIps(r.data.rows);
      })
      .catch((err) => {
        if (!cancelled) setWatchError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Role meanings for the legend's tooltips — cheap, not gated behind IP
  // selection; the legend itself still only lists roles actually present
  // in the current graph, this just explains them once they are.
  useEffect(() => {
    let cancelled = false;
    vocabularyRulesVocabularyGet({ throwOnError: true })
      .then((r) => {
        if (!cancelled) setRoleMeaning(new Map(r.data.roles.map((role) => [role.name, role.meaning])));
      })
      .catch(() => {
        // Legend just shows role names with no tooltip if this fails.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedKey = [...selectedIps].sort().join(",");

  useEffect(() => {
    if (selectedIps.size === 0) {
      setData(null);
      setSelected(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const ips = [...selectedIps];
        const [confirmedPerIp, flowPerIp, rolesResult, watchResult] = await Promise.all([
          Promise.all(
            ips.map((ip) =>
              confirmedContactsDailyRollupConfirmedContactsDailyGet({
                query: { monitored_ip: ip, limit: 20000 },
                throwOnError: true,
              }),
            ),
          ),
          Promise.all(
            ips.map((ip) =>
              flowDailyRollupFlowDailyGet({ query: { monitored_ip: ip, limit: 20000 }, throwOnError: true }),
            ),
          ),
          listIpRolesReviewIpRolesGet({ query: { vantage: "watched", limit: 1000 }, throwOnError: true }),
          listIpsWatchIpsGet({ throwOnError: true }),
        ]);
        if (cancelled) return;

        const confirmed = confirmedPerIp.flatMap((r) => r.data.rows);
        const flow = flowPerIp.flatMap((r) => r.data.rows);

        const roles = new Map<string, IpRole[]>();
        for (const r of rolesResult.data.rows) {
          const list = roles.get(r.ip) ?? [];
          list.push(r);
          roles.set(r.ip, list);
        }
        const watched = new Map(watchResult.data.rows.map((w) => [w.ip, w]));
        const graph = buildGraph(confirmed, flow, roles, watched);

        // d3-force layout, run synchronously then freeze.
        // Every node starts at (0,0) from buildGraph — give d3-force a
        // spread-out starting point, since coincident nodes make charge
        // repulsion (division by zero distance) blow up the layout.
        const simNodes = graph.nodes.map((n) => ({
          ...n,
          x: W / 2 + (Math.random() - 0.5) * W * 0.8,
          y: H / 2 + (Math.random() - 0.5) * H * 0.8,
        }));
        const simLinks = graph.links.map((l) => ({ ...l }));
        const simulation = d3
          .forceSimulation(simNodes as d3.SimulationNodeDatum[])
          .force(
            "link",
            d3
              .forceLink(simLinks as d3.SimulationLinkDatum<d3.SimulationNodeDatum>[])
              .id((d) => (d as GNode).id)
              .distance(90)
              .strength(0.25),
          )
          .force("charge", d3.forceManyBody().strength(-180))
          .force("center", d3.forceCenter(W / 2, H / 2))
          // forceCenter only recenters the overall centroid — a weakly
          // linked cluster can still drift off-canvas under charge alone,
          // so pull every node gently toward the middle too.
          .force("x", d3.forceX(W / 2).strength(0.03))
          .force("y", d3.forceY(H / 2).strength(0.03))
          .force(
            "collide",
            d3.forceCollide((d) => (d as GNode).r + 6),
          )
          .stop();
        for (let i = 0; i < 300; i++) simulation.tick();

        if (cancelled) return;
        setData({ nodes: simNodes as GNode[], links: graph.links });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  function toggleIp(ip: string) {
    setSelectedIps((prev) => {
      const next = new Set(prev);
      if (next.has(ip)) next.delete(ip);
      else next.add(ip);
      return next;
    });
  }

  const picker = (
    <div className="card" style={{ padding: "16px 18px", marginBottom: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: "#A6D8CD" }}>
          Monitored IPs — pick which ones to graph
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#6FA89E" }}>{selectedIps.size} selected</span>
          <button
            onClick={() => setSelectedIps(new Set(watchedIps?.map((w) => w.ip) ?? []))}
            style={{ all: "unset", cursor: "pointer", fontSize: 11, color: "#7FEFD6" }}
          >
            select all
          </button>
          <button
            onClick={() => setSelectedIps(new Set())}
            style={{ all: "unset", cursor: "pointer", fontSize: 11, color: "#7FEFD6" }}
          >
            clear
          </button>
        </div>
      </div>
      {watchError && <div style={{ color: "#E5484D", fontSize: 12 }}>Failed to load watch set: {watchError}</div>}
      {!watchedIps && !watchError && <div style={{ color: "#6FA89E", fontSize: 12 }}>Loading watch set…</div>}
      {watchedIps && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {watchedIps.map((w) => {
            const checked = selectedIps.has(w.ip);
            return (
              <button
                key={w.ip}
                onClick={() => toggleIp(w.ip)}
                className="mono"
                style={{
                  all: "unset",
                  cursor: "pointer",
                  fontSize: 12,
                  padding: "5px 10px",
                  borderRadius: 999,
                  border: `1px solid ${checked ? "#3F9C8A" : "#2B7266"}`,
                  background: checked ? "rgba(72,196,170,0.14)" : "transparent",
                  color: checked ? "#E8FFF8" : "#A6D8CD",
                }}
              >
                {w.ip}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  if (selectedIps.size === 0) {
    return (
      <>
        {picker}
        <div className="card" style={{ padding: 40, textAlign: "center", color: "#6FA89E" }}>
          Select one or more monitored IPs above to build the graph — nothing is fetched or
          computed until then.
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        {picker}
        <div className="card" style={{ padding: 20, borderColor: "#5A2327" }}>
          Failed to load from netflow-rollups' API: {error}
        </div>
      </>
    );
  }
  if (loading || !data) {
    return (
      <>
        {picker}
        <div style={{ color: "#6FA89E" }}>Loading…</div>
      </>
    );
  }

  const nodeById = new Map(data.nodes.map((n) => [n.id, n]));

  // Legend scoped to what's actually on screen, not a hardcoded list — a
  // selection of two IPs with one role between them doesn't need to see
  // the other twelve roles that exist in the vocabulary but aren't here.
  const rolesPresent = new Map<string, { confirmed: boolean; pending: boolean }>();
  for (const n of data.nodes) {
    if (n.kind !== "monitored") continue;
    for (const r of n.confirmedRoles ?? []) {
      rolesPresent.set(r, { ...(rolesPresent.get(r) ?? { confirmed: false, pending: false }), confirmed: true });
    }
    for (const r of n.pendingRoles ?? []) {
      rolesPresent.set(r, { ...(rolesPresent.get(r) ?? { confirmed: false, pending: false }), pending: true });
    }
  }
  const familiesPresent = [...new Set(data.links.map((l) => l.dominantFamily))].sort();

  return (
    <>
      {picker}
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div className="card" style={{ width: W, maxWidth: "100%", height: H, position: "relative", overflow: "hidden", flexShrink: 0 }}>
        <ZoomableSvg width={W} height={H}>
          {data.links.map((l, i) => {
            const a = nodeById.get(l.source as unknown as string) ?? nodeById.get((l.source as unknown as GNode).id);
            const b = nodeById.get(l.target as unknown as string) ?? nodeById.get((l.target as unknown as GNode).id);
            if (!a || !b) return null;
            const width = Math.max(1, Math.min(8, Math.sqrt(l.bytes) / 200));
            const color = familyColor(l.dominantFamily);
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={color}
                strokeWidth={l.kind === "mm" ? Math.max(2, width) : width}
                strokeDasharray={l.kind === "mm" ? "3 7" : undefined}
                strokeLinecap="round"
              >
                <title>
                  {a.label} ↔ {b.label} · {l.dominantFamily} · {formatBytes(l.bytes)}
                </title>
              </line>
            );
          })}
          {data.nodes.map((n) => {
            const isMonitored = n.kind === "monitored";
            // Confirmed roles first, so the primary (diamond) color always
            // prefers something confirmed over merely suggested; anything
            // past the first becomes a satellite dot rather than being
            // silently dropped — six watched IPs right now carry more than
            // one confirmed role at once.
            const roleList = isMonitored
              ? [
                  ...(n.confirmedRoles ?? []).map((role) => ({ role, confirmed: true })),
                  ...(n.pendingRoles ?? []).map((role) => ({ role, confirmed: false })),
                ]
              : [];
            const primary = roleList[0];
            const extraRoles = roleList.slice(1);
            const primaryColor = primary ? roleColor(primary.role) : null;
            const [catBg, catFg] = !isMonitored ? categoryColors(n.category ?? "unclassified") : ["", ""];
            return (
              <g key={n.id} onClick={() => setSelected(n)} style={{ cursor: "pointer" }}>
                {isMonitored ? (
                  <>
                    <rect
                      x={n.x - n.r}
                      y={n.y - n.r}
                      width={n.r * 2}
                      height={n.r * 2}
                      transform={`rotate(45 ${n.x} ${n.y})`}
                      fill={primary ? (primary.confirmed ? primaryColor!.bg : "transparent") : "#0F3133"}
                      stroke={selected?.id === n.id ? "#E8FFF8" : primary ? primaryColor!.border : "#6FA89E"}
                      strokeWidth={selected?.id === n.id ? 3 : 2}
                      strokeDasharray={primary && !primary.confirmed ? "4 3" : undefined}
                    />
                    {extraRoles.map((r2, i) => {
                      const c = roleColor(r2.role);
                      const angle = (i / Math.max(extraRoles.length, 1)) * Math.PI * 2 - Math.PI / 2;
                      const dx = n.x + (n.r + 7) * Math.cos(angle);
                      const dy = n.y + (n.r + 7) * Math.sin(angle);
                      return (
                        <circle
                          key={r2.role}
                          cx={dx}
                          cy={dy}
                          r={3.5}
                          fill={r2.confirmed ? c.border : "none"}
                          stroke={c.border}
                          strokeWidth={1.3}
                        />
                      );
                    })}
                  </>
                ) : (
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.r}
                    fill={n.kind === "cluster" ? "#0F3133" : catBg}
                    stroke={selected?.id === n.id ? "#E8FFF8" : n.kind === "cluster" ? "#6FA89E" : catFg}
                    strokeWidth={selected?.id === n.id ? 3 : 2}
                    strokeDasharray={n.kind === "cluster" ? "3 3" : undefined}
                  />
                )}
                <title>
                  {n.label} · {formatBytes(n.bytes)}
                  {n.clusterCount ? ` · ${n.clusterCount} peers` : ""}
                  {roleList.length > 0
                    ? ` · ${roleList.map((r) => `${r.role}${r.confirmed ? "" : " (suggested)"}`).join(", ")}`
                    : ""}
                </title>
              </g>
            );
          })}
        </ZoomableSvg>
        <div style={{ position: "absolute", bottom: 10, right: 10, fontSize: 10, color: "#6FA89E", pointerEvents: "none" }}>
          scroll to zoom · drag to pan
        </div>
      </div>

      <div style={{ width: 284, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: "#A6D8CD" }}>Legend</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 12 }}>
            {rolesPresent.size > 0 && (
              <div>
                <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase", marginBottom: 6 }}>
                  Monitored roles
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[...rolesPresent.entries()]
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([role, state]) => {
                      const c = roleColor(role);
                      return (
                        <div
                          key={role}
                          style={{ display: "flex", alignItems: "center", gap: 8 }}
                          title={roleMeaning.get(role)}
                        >
                          <span style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                            {state.confirmed && (
                              <span
                                style={{
                                  width: 11,
                                  height: 11,
                                  background: c.bg,
                                  border: `2px solid ${c.border}`,
                                  transform: "rotate(45deg)",
                                  display: "inline-block",
                                }}
                              />
                            )}
                            {state.pending && (
                              <span
                                style={{
                                  width: 11,
                                  height: 11,
                                  background: "transparent",
                                  border: `2px dashed ${c.border}`,
                                  transform: "rotate(45deg)",
                                  display: "inline-block",
                                }}
                              />
                            )}
                          </span>
                          <span className="mono">{role}</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            <div>
              <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase", marginBottom: 6 }}>
                Peer categories
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {Object.keys(categoryColorsLegend).map((cat) => {
                  const [bg, fg] = categoryColors(cat);
                  return (
                    <div key={cat} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: "50%",
                          background: bg,
                          border: `2px solid ${fg}`,
                          display: "inline-block",
                          flexShrink: 0,
                        }}
                      />
                      {cat.replace(/_/g, " ")}
                    </div>
                  );
                })}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      background: "#0F3133",
                      border: "2px dashed #6FA89E",
                      display: "inline-block",
                      flexShrink: 0,
                    }}
                  />
                  cluster — small peers sharing an ASN
                </div>
              </div>
            </div>

            {familiesPresent.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase", marginBottom: 6 }}>
                  Traffic type (edge color)
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {familiesPresent.map((fam) => (
                    <div key={fam} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{ width: 18, height: 3, background: familyColor(fam), display: "inline-block", flexShrink: 0 }}
                      />
                      <span className="mono">{fam}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase", marginBottom: 6 }}>
                Edge style
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 18, height: 0, borderTop: "2px dashed #A6D8CD", display: "inline-block", flexShrink: 0 }} />
                  monitored ↔ monitored
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 18, height: 2, background: "#A6D8CD", display: "inline-block", flexShrink: 0 }} />
                  monitored ↔ peer (width ~ bytes)
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: "16px 18px", minHeight: 160 }}>
          {!selected ? (
            <div style={{ fontSize: 13, color: "#6FA89E", lineHeight: 1.5 }}>
              Click a node to inspect it.
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }} className="mono">
                {selected.label}
              </div>
              <div style={{ fontSize: 12, color: "#A6D8CD", marginBottom: 10 }}>
                {selected.kind === "monitored"
                  ? [
                      selected.confirmedRoles && selected.confirmedRoles.length > 0
                        ? `confirmed: ${selected.confirmedRoles.join(", ")}`
                        : null,
                      selected.pendingRoles && selected.pendingRoles.length > 0
                        ? `suggested: ${selected.pendingRoles.join(", ")}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "no role yet"
                  : selected.kind === "cluster"
                    ? `${selected.clusterCount} peers · AS${selected.asn} · ${selected.country ?? "—"}`
                    : `${selected.category} ${selected.asn ? `· AS${selected.asn}` : ""} ${selected.country ? `· ${selected.country}` : ""}`}
              </div>
              {selected.tags && selected.tags.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {selected.tags.map((t) => (
                    <span key={t} className="chip tip" style={{ fontSize: 10 }}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 12, color: "#6FA89E" }}>{formatBytes(selected.bytes)} confirmed, this window</div>
            </div>
          )}
        </div>

        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: "#F5A623" }}>Data notes</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9, fontSize: 12, color: "#A6D8CD", lineHeight: 1.5 }}>
            <div>① Every monitored↔monitored edge is stored twice (once per side's pull) — keyed on the unordered pair, keeping the larger side rather than summing.</div>
            <div>② The edge view carries roles, not categories — peer color is joined back from <span className="mono">rollup__flow_daily</span>.</div>
            <div>③ ASN clustering: peers below 0.5% of total graph bytes sharing an ASN with 2+ others collapse into one node — this was blocked until <span className="mono">peer_asn</span> landed on the rollups.</div>
            <div>④ A peer that's itself on the watchlist is drawn as a monitored node, never a plain peer.</div>
            <div>⑤ Role and traffic-type colors are generated from the name, not a hand-picked palette — a new role or port family gets a stable color automatically, never falls back to looking like "no role yet."</div>
            <div>⑥ A monitored node's diamond is colored by its first role (confirmed preferred over suggested); any further roles become small dots around it rather than being dropped.</div>
          </div>
        </div>
      </div>
      </div>
    </>
  );
}

const categoryColorsLegend: Record<string, true> = {
  cloud: true,
  satellite: true,
  mobile: true,
  residential_isp: true,
  wholesale_voip: true,
  bph: true,
  unclassified: true,
};

// ---------- Sankey ----------

const SIP_FAMILIES = ["rtp_media", "voip_signaling", "voip_admin"];
const CLASS_ORDER = ["monitored", "bph", "cloud", "satellite", "mobile", "residential_isp", "wholesale_voip", "reverse_proxy", "unclassified"];
const CLASS_COLOR: Record<string, string> = {
  monitored: "#E5484D",
  bph: "#E5484D",
  cloud: "#4C8DFF",
  satellite: "#8B5CF6",
  mobile: "#F59E0B",
  residential_isp: "#2DD4BF",
  wholesale_voip: "#EC4899",
  reverse_proxy: "#A3A3A3",
  unclassified: "#6FA89E",
};
const FAMILY_COLOR: Record<string, string> = {
  rtp_media: "#4C8DFF",
  voip_signaling: "#D946EF",
  voip_admin: "#F5A623",
};

type SkNode = { id: string; label: string; layer: number; color: string; mb: number; flows: number; meta?: string };
type SkLink = { source: string; target: string; value: number; flows: number; color: string };

function classify(peerIp: string, categories: string[], watchedIps: Set<string>): string {
  if (watchedIps.has(peerIp)) return "monitored";
  for (const c of CLASS_ORDER) {
    if (categories.includes(c)) return c;
  }
  return "unclassified";
}

function SankeyDiagram() {
  const [rows, setRows] = useState<DailyFlow[] | null>(null);
  const [watchedIps, setWatchedIps] = useState<Set<string>>(new Set());
  const [monitoredFilter, setMonitoredFilter] = useState<string>("");
  const [familyFilter, setFamilyFilter] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const from30 = isoDate(daysAgo(29));
        const to = isoDate(new Date());
        const [flowResult, watchResult] = await Promise.all([
          flowDailyRollupFlowDailyGet({ query: { from: from30, to, limit: 20000 }, throwOnError: true }),
          listIpsWatchIpsGet({ throwOnError: true }),
        ]);
        if (cancelled) return;
        setRows(flowResult.data.rows.filter((r) => SIP_FAMILIES.includes(r.port_family)));
        setWatchedIps(new Set(watchResult.data.rows.map((w) => w.ip)));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const monitoredOptions = useMemo(() => [...new Set((rows ?? []).map((r) => r.monitored_ip))].sort(), [rows]);

  const graph = useMemo(() => {
    if (!rows) return null;
    const filtered = rows.filter(
      (r) => (!monitoredFilter || r.monitored_ip === monitoredFilter) && (!familyFilter || r.port_family === familyFilter),
    );

    // Rank peers per monitored IP by total bytes; top 28 stay individual.
    const peerTotalByMonitored = new Map<string, Map<string, number>>();
    for (const r of filtered) {
      const m = peerTotalByMonitored.get(r.monitored_ip) ?? new Map<string, number>();
      m.set(r.peer_ip, (m.get(r.peer_ip) ?? 0) + r.bytes_sum);
      peerTotalByMonitored.set(r.monitored_ip, m);
    }
    const topPeers = new Set<string>();
    for (const [, m] of peerTotalByMonitored) {
      [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 28)
        .forEach(([ip]) => topPeers.add(`${ip}`));
    }

    const nodes = new Map<string, SkNode>();
    const links = new Map<string, SkLink>();
    const otherCounts = new Map<string, Set<string>>();

    function node(id: string, layer: number, label: string, color: string, meta?: string): SkNode {
      const existing = nodes.get(id);
      if (existing) return existing;
      const n: SkNode = { id, label, layer, color, mb: 0, flows: 0, meta };
      nodes.set(id, n);
      return n;
    }
    function link(s: string, t: string, mb: number, flows: number, color: string) {
      const k = `${s}→${t}`;
      const existing = links.get(k);
      if (existing) {
        existing.value += mb;
        existing.flows += flows;
      } else {
        links.set(k, { source: s, target: t, value: mb, flows, color });
      }
    }

    let totalMb = 0;
    for (const r of filtered) {
      const cls = classify(r.peer_ip, r.peer_categories, watchedIps);
      const mb = r.bytes_sum / 1_000_000;
      totalMb += mb;
      const isTop = topPeers.has(r.peer_ip);
      const peerId = isTop ? `p:${r.peer_ip}` : `other:${cls}`;
      const peerLabel = isTop ? r.peer_ip : `other ${cls.replace(/_/g, " ")}`;

      const c = node(`c:${cls}`, 0, cls.replace(/_/g, " "), CLASS_COLOR[cls]);
      const p = node(peerId, 1, peerLabel, CLASS_COLOR[cls]);
      const m = node(`m:${r.monitored_ip}`, 2, r.monitored_ip, "#A6D8CD");
      const f = node(`f:${r.port_family}`, 3, r.port_family, FAMILY_COLOR[r.port_family]);
      c.mb += mb;
      p.mb += mb;
      m.mb += mb;
      f.mb += mb;
      if (!isTop) {
        const set = otherCounts.get(peerId) ?? new Set<string>();
        set.add(r.peer_ip);
        otherCounts.set(peerId, set);
      }
      link(c.id, p.id, mb, r.flow_count, CLASS_COLOR[cls]);
      link(p.id, m.id, mb, r.flow_count, CLASS_COLOR[cls]);
      link(m.id, f.id, mb, r.flow_count, FAMILY_COLOR[r.port_family]);
    }
    for (const [id, set] of otherCounts) {
      const n = nodes.get(id);
      if (n) n.meta = `${set.size} peers`;
    }

    return { nodes: [...nodes.values()], links: [...links.values()], totalMb };
  }, [rows, monitoredFilter, familyFilter, watchedIps]);

  useEffect(() => {
    if (!graph || !svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const W = Math.max(640, svgRef.current.clientWidth || 1000);
    const H = 780;
    svg.attr("viewBox", `0 0 ${W} ${H}`).attr("height", H);
    svg.selectAll("*").remove();
    if (graph.nodes.length === 0) return;

    const sk = sankey<SkNode, SkLink>()
      .nodeId((d) => d.id)
      .nodeWidth(12)
      .nodePadding(5)
      .nodeAlign(sankeyJustify)
      .extent([
        [150, 8],
        [W - 170, H - 8],
      ]);

    const { nodes, links } = sk({
      nodes: graph.nodes.map((d) => ({ ...d })),
      links: graph.links.map((d) => ({ ...d })) as unknown as (SankeyLinkMinimal<object, object> & SkLink)[],
    });

    svg
      .append("g")
      .selectAll("path")
      .data(links)
      .join("path")
      .attr("fill", "none")
      .attr("d", sankeyLinkHorizontal())
      .attr("stroke", (d) => (d as unknown as SkLink).color)
      .attr("stroke-width", (d) => Math.max(1, (d as unknown as { width: number }).width))
      .style("mix-blend-mode", "screen")
      .style("opacity", 0.42)
      .append("title")
      .text((d) => {
        const l = d as unknown as SkLink & { source: SkNode; target: SkNode };
        return `${l.source.label} → ${l.target.label}\n${l.value.toFixed(2)} MB · ${l.flows.toLocaleString()} flows`;
      });

    const N = svg
      .append("g")
      .selectAll("g")
      .data(nodes as (SankeyNodeMinimal<object, object> & SkNode)[])
      .join("g");

    N.append("rect")
      .attr("x", (d) => d.x0!)
      .attr("y", (d) => d.y0!)
      .attr("height", (d) => Math.max(1, d.y1! - d.y0!))
      .attr("width", (d) => d.x1! - d.x0!)
      .attr("fill", (d) => d.color)
      .attr("rx", 2)
      .append("title")
      .text((d) => `${d.label}${d.meta ? " · " + d.meta : ""}\n${d.mb.toFixed(2)} MB · ${d.flows.toLocaleString()} flows`);

    N.append("text")
      .attr("x", (d) => (d.x0! < W / 2 ? d.x1! + 6 : d.x0! - 6))
      .attr("y", (d) => (d.y0! + d.y1!) / 2)
      .attr("dy", "0.35em")
      .attr("text-anchor", (d) => (d.x0! < W / 2 ? "start" : "end"))
      .attr("font-size", 10)
      .attr("fill", "#D4F2EA")
      .text((d) => (d.y1! - d.y0! < 7 && d.layer === 1 ? "" : d.label));
  }, [graph]);

  if (error) {
    return (
      <div className="card" style={{ padding: 20, borderColor: "#5A2327" }}>
        Failed to load from netflow-rollups' API: {error}
      </div>
    );
  }
  if (!rows || !graph) return <div style={{ color: "#6FA89E" }}>Loading…</div>;

  return (
    <div className="card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", padding: "14px 18px", borderBottom: "1px solid #133A3C" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>Monitored IP</label>
          <select
            value={monitoredFilter}
            onChange={(e) => setMonitoredFilter(e.target.value)}
            style={{ background: "#0A2224", color: "#E8FFF8", border: "1px solid #2B7266", borderRadius: 6, padding: "5px 8px", fontSize: 12 }}
          >
            <option value="">all {monitoredOptions.length}</option>
            {monitoredOptions.map((ip) => (
              <option key={ip} value={ip}>
                {ip}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>Port family</label>
          {["", ...SIP_FAMILIES].map((f) => (
            <button
              key={f || "all"}
              onClick={() => setFamilyFilter(f)}
              style={{
                all: "unset",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 500,
                padding: "5px 11px",
                borderRadius: 999,
                border: "1px solid #2B7266",
                color: familyFilter === f ? "#E8FFF8" : "#A6D8CD",
                background: familyFilter === f ? "#133A3C" : "transparent",
                borderColor: familyFilter === f ? "#3F9C8A" : "#2B7266",
              }}
            >
              {f || "all"}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <span className="src">{graph.totalMb.toFixed(1)} MB · {graph.nodes.filter((n) => n.layer === 1).length} peer nodes · {graph.links.length} links</span>
      </div>
      <div style={{ position: "relative" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", padding: "10px 20px 0 20px" }}>
          <span className="lhd" style={{ fontSize: 10, fontWeight: 600, color: "#6FA89E", textTransform: "uppercase" }}>
            peer class
          </span>
          <span className="lhd" style={{ fontSize: 10, fontWeight: 600, color: "#6FA89E", textTransform: "uppercase", textAlign: "center" }}>
            peer IP · top 28 by bytes, rest collapsed
          </span>
          <span className="lhd" style={{ fontSize: 10, fontWeight: 600, color: "#6FA89E", textTransform: "uppercase", textAlign: "center" }}>
            monitored IP
          </span>
          <span className="lhd" style={{ fontSize: 10, fontWeight: 600, color: "#6FA89E", textTransform: "uppercase", textAlign: "right" }}>
            port family
          </span>
        </div>
        <svg ref={svgRef} style={{ width: "100%", display: "block" }} />
      </div>
      <div className="note">
        Width = bytes of <span className="mono">rtp_media</span> + <span className="mono">voip_signaling</span>{" "}
        + <span className="mono">voip_admin</span> over the last 30 days (
        <span className="mono">rollup__flow_daily</span>). Left-to-right: peer class → peer host
        (top 28 by bytes individually, the rest collapsed per class) → monitored IP → port family.
        Hover any node or link for its numbers. Not built yet: the mockup's hover-trace highlighting,
        click-to-pin, and the min-link threshold slider.
      </div>
    </div>
  );
}
