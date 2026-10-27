import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { sankey, sankeyLinkHorizontal, sankeyJustify, type SankeyNodeMinimal, type SankeyLinkMinimal } from "d3-sankey";
import {
  flowDailyRollupFlowDailyGet,
  getIpIdentityLookupIpIdentitiesIpGet,
  listIpRolesReviewIpRolesGet,
  listIpsWatchIpsGet,
  vocabularyRulesVocabularyGet,
  type DailyFlow,
  type IpIdentity,
  type IpRole,
  type WatchedIp,
} from "../api/netflow-rollups-client";
import { formatBytes, isoDate, daysAgo } from "../lib/format";
import { categoryColors } from "../lib/categories";
import { ZoomableSvg } from "../components/ZoomableSvg";
import { CopyButton } from "../components/CopyButton";

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

// Markers render in one fixed neutral color, never a hashed hue — the
// point is that a marker always reads as "a marker", distinguishable at
// a glance from the hash-colored ring arcs underneath it. c2_* gets the
// warning triangle regardless of whether it's also icon-eligible below;
// danger is a separate, narrower classification than "common enough to
// deserve its own glyph" and is checked first.
const MARKER_COLOR = "#F2C94C";
const DANGER_ROLES = new Set(["c2_server", "c2_operator", "c2_victim"]);
const ICON_ROLES = new Set([
  "sip_client",
  "sip_trunk",
  "sip_server",
  "web_server",
  "dns_server",
  "mail_server",
  "vpn_server",
  "c2_server",
  "forward_proxy",
  "operator",
  "research",
]);
function hasMarker(role: string): boolean {
  return DANGER_ROLES.has(role) || ICON_ROLES.has(role);
}

// One glyph per role, centered on the origin — callers wrap this in a
// <g transform="translate(x,y)">. Every role not listed here (and every
// role that doesn't clear the "common enough" or "dangerous enough" bar)
// falls back to the ring arc + text label alone, which is deliberate:
// giving every role in the vocabulary its own hand-drawn icon would
// reintroduce the hand-maintained-per-role mapping this whole system
// was built to avoid.
function RoleMarker({ role }: { role: string }) {
  if (DANGER_ROLES.has(role)) {
    return (
      <>
        <polygon points="0,-8 -7,7 7,7" fill={MARKER_COLOR} stroke="#2C2003" strokeWidth={1.1} />
        <line x1={0} y1={-3} x2={0} y2={2} stroke="#2C2003" strokeWidth={1.4} />
        <circle cx={0} cy={4.6} r={0.8} fill="#2C2003" />
      </>
    );
  }
  switch (role) {
    case "sip_client":
      return (
        <>
          <rect x={-3} y={-9} width={6} height={11} rx={3} fill="none" stroke={MARKER_COLOR} strokeWidth={1.5} />
          <path d="M -6,-1 A 6,6 0 0 0 6,-1" fill="none" stroke={MARKER_COLOR} strokeWidth={1.3} />
          <line x1={0} y1={5} x2={0} y2={8.5} stroke={MARKER_COLOR} strokeWidth={1.3} />
          <line x1={-4} y1={8.5} x2={4} y2={8.5} stroke={MARKER_COLOR} strokeWidth={1.3} />
        </>
      );
    case "sip_trunk":
      return (
        <>
          <line x1={-6} y1={-9} x2={-2} y2={-1} stroke={MARKER_COLOR} strokeWidth={1.2} />
          <line x1={0} y1={-9} x2={0} y2={-1} stroke={MARKER_COLOR} strokeWidth={1.2} />
          <line x1={6} y1={-9} x2={2} y2={-1} stroke={MARKER_COLOR} strokeWidth={1.2} />
          <rect x={-4} y={-1} width={8} height={10} rx={1.8} fill="none" stroke={MARKER_COLOR} strokeWidth={1.5} />
          <line x1={-2} y1={2} x2={2} y2={2} stroke={MARKER_COLOR} strokeWidth={1} />
          <circle cx={0} cy={6.3} r={0.8} fill={MARKER_COLOR} />
        </>
      );
    case "sip_server":
      return (
        <>
          <rect x={-5} y={-9} width={10} height={18} rx={2} fill="none" stroke={MARKER_COLOR} strokeWidth={1.6} />
          <line x1={-2.5} y1={-6} x2={2.5} y2={-6} stroke={MARKER_COLOR} strokeWidth={1.2} />
          <circle cx={0} cy={6.2} r={1} fill={MARKER_COLOR} />
        </>
      );
    case "web_server":
      return (
        <>
          <rect x={-9} y={-7} width={18} height={14} rx={1.5} fill="none" stroke={MARKER_COLOR} strokeWidth={1.5} />
          <line x1={-9} y1={-3} x2={9} y2={-3} stroke={MARKER_COLOR} strokeWidth={1.2} />
          <circle cx={-6.5} cy={-5} r={0.6} fill={MARKER_COLOR} />
          <circle cx={-4.5} cy={-5} r={0.6} fill={MARKER_COLOR} />
        </>
      );
    case "dns_server":
      // A directory, not a search — DNS is "look this name up in the
      // book," which a magnifying glass (the first attempt here) said
      // less clearly than an actual book does.
      return (
        <>
          <rect x={-7} y={-8} width={14} height={16} rx={1} fill="none" stroke={MARKER_COLOR} strokeWidth={1.4} />
          <line x1={0} y1={-8} x2={0} y2={8} stroke={MARKER_COLOR} strokeWidth={1.4} />
          <line x1={2.5} y1={-4} x2={5.5} y2={-4} stroke={MARKER_COLOR} strokeWidth={1} />
          <line x1={2.5} y1={0} x2={5.5} y2={0} stroke={MARKER_COLOR} strokeWidth={1} />
          <line x1={2.5} y1={4} x2={5.5} y2={4} stroke={MARKER_COLOR} strokeWidth={1} />
        </>
      );
    case "mail_server":
      return (
        <>
          <rect x={-9} y={-6} width={18} height={12} rx={1.5} fill="none" stroke={MARKER_COLOR} strokeWidth={1.5} />
          <path d="M -9,-6 L 0,2 L 9,-6" fill="none" stroke={MARKER_COLOR} strokeWidth={1.3} />
        </>
      );
    case "vpn_server":
      return (
        <>
          <circle cx={0} cy={0} r={8} fill="none" stroke={MARKER_COLOR} strokeWidth={1.5} />
          <ellipse cx={0} cy={0} rx={3.2} ry={8} fill="none" stroke={MARKER_COLOR} strokeWidth={1.2} />
          <line x1={-8} y1={0} x2={8} y2={0} stroke={MARKER_COLOR} strokeWidth={1.2} />
        </>
      );
    case "research":
      // The magnifying glass dns_server gave up — DNS turned out to be
      // "look it up in the directory," not a search, but research is
      // exactly a search: someone poking at the watched IP to see what
      // it is, not administering it or exchanging real traffic with it.
      return (
        <>
          <circle cx={-1.5} cy={-2} r={6} fill="none" stroke={MARKER_COLOR} strokeWidth={1.4} />
          <line x1={3} y1={2.5} x2={8} y2={7.5} stroke={MARKER_COLOR} strokeWidth={1.8} strokeLinecap="round" />
        </>
      );
    case "operator":
      // A monitor with a shell prompt on it, not a generic computer — the
      // role itself means "whose box this is": a peer that opens admin
      // sessions (SSH, manager, database, panel ports) to the watched IP,
      // so what it's doing is specifically administering, not just
      // talking to, the monitored side.
      return (
        <>
          <rect x={-8} y={-8} width={16} height={11} rx={1} fill="none" stroke={MARKER_COLOR} strokeWidth={1.4} />
          <line x1={0} y1={3} x2={0} y2={6} stroke={MARKER_COLOR} strokeWidth={1.4} />
          <line x1={-4} y1={6} x2={4} y2={6} stroke={MARKER_COLOR} strokeWidth={1.4} />
          <path d="M -4.5,-5 L -1.5,-2.5 L -4.5,0" fill="none" stroke={MARKER_COLOR} strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" />
          <line x1={0} y1={0} x2={3.5} y2={0} stroke={MARKER_COLOR} strokeWidth={1.1} strokeLinecap="round" />
        </>
      );
    case "forward_proxy":
      // A disguise, not a checkpoint — a forward proxy's whole job is to
      // hide the client it's relaying for, so sunglasses-and-a-top-hat
      // reads as "incognito" at a glance, which a gate-with-an-arrow
      // (the first attempt here) didn't: that one just looked like a bed.
      return (
        <>
          <line x1={-7} y1={-2} x2={7} y2={-2} stroke={MARKER_COLOR} strokeWidth={1.5} />
          <rect x={-4} y={-9} width={8} height={7} rx={0.5} fill="none" stroke={MARKER_COLOR} strokeWidth={1.4} />
          <rect x={-7} y={0} width={5} height={4} rx={1.5} fill="none" stroke={MARKER_COLOR} strokeWidth={1.3} />
          <rect x={2} y={0} width={5} height={4} rx={1.5} fill="none" stroke={MARKER_COLOR} strokeWidth={1.3} />
          <line x1={-2} y1={2} x2={2} y2={2} stroke={MARKER_COLOR} strokeWidth={1.3} />
          <line x1={-7} y1={1} x2={-9} y2={0} stroke={MARKER_COLOR} strokeWidth={1} />
          <line x1={7} y1={1} x2={9} y2={0} stroke={MARKER_COLOR} strokeWidth={1} />
        </>
      );
    default:
      return null;
  }
}

// Node positions (n.x/n.y) live in the SVG's own user space, inside
// ZoomableSvg's zoomed/panned <g> — converting a pointer event's screen
// coordinates into that same space means inverting the element's full
// screen CTM (viewBox scaling and the current zoom/pan transform both
// folded in), not just subtracting the SVG's bounding-box offset.
function toSvgPoint(el: SVGGraphicsElement, clientX: number, clientY: number): { x: number; y: number } {
  const svg = el.ownerSVGElement;
  const ctm = el.getScreenCTM();
  if (!svg || !ctm) return { x: clientX, y: clientY };
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

export function FlowGraph() {
  const [tab, setTab] = useState<Tab>("graph");

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: "0 0 4px 0", fontSize: 22, fontWeight: 600 }}>Flow graph</h1>

        <div style={{ fontSize: 13, color: "#6FA89E" }}>
          <b style={{ color: "#A6D8CD" }}>Every day of real traffic</b> a monitored IP and a peer
          exchanged (<span className="mono">rollup__flow_daily</span>) draws an edge here — not just
          reviewed ones. A faint edge is unreviewed, real traffic; a full-brightness edge has cleared
          the same bar <span className="mono">rollup__confirmed_contacts_daily</span> promotes rows on
          — a confirmed role on either side, or the pair itself confirmed as a SIP peer. Edge color =
          dominant traffic type · peer color = peer_categories · monitored nodes are labeled by IP;
          common roles and c2_* from <span className="mono">review__ip_roles</span> get an icon marker
          underneath — see the Legend for what's what, click any node for the rest
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
  memberIps?: string[];
  // Cluster-only: which monitored IP's edge brought in each member — a
  // cluster merges peers for the canvas (that's the whole point of it),
  // but the compare feature still needs to answer "which of these
  // members do two selected monitored IPs actually share," and that
  // answer doesn't exist anywhere else once the merge has happened.
  memberIpsByMonitored?: Map<string, Set<string>>;
  tags?: string[];
  x: number;
  y: number;
  r: number;
};
type GLink = { source: string; target: string; bytes: number; kind: "mm" | "mp"; dominantFamily: string; confirmed: boolean };

function buildGraph(
  ips: string[],
  flow: DailyFlow[],
  roles: Map<string, IpRole[]>,
  watched: Map<string, WatchedIp>,
  identities: Map<string, IpIdentity>,
): { nodes: GNode[]; links: GLink[] } {
  const watchedIps = new Set(watched.keys());

  // Dedup monitored<->monitored edges (stored once per side's pull); keep
  // the larger measured side rather than summing both.
  //
  // Edges come from rollup__flow_daily itself now, not the pre-filtered
  // rollup__confirmed_contacts_daily view — that view turned out to be the
  // wrong scope for an exploration graph: it silently dropped every day of
  // real traffic that hadn't yet cleared its review bar, which is exactly
  // the traffic an analyst hunting for something new would want to see.
  // flow_daily carries the same per-row monitored_ip_roles/peer_roles/
  // pair_confirmed fields confirmed-contacts was filtered down from, so
  // "confirmed" below recomputes that exact bar per row instead of asking
  // a second endpoint for it.
  const edgeBytes = new Map<string, { bytes: number; a: string; b: string; kind: "mm" | "mp"; confirmed: boolean }>();
  // Bytes per port_family, per edge — picks which traffic type colors the
  // edge. For an mm edge this sums both sides' breakdowns rather than
  // picking the larger side's alone (edgeBytes does that for the total);
  // an approximation, same spirit as edgeBytes' own "keep the larger side"
  // compromise — good enough to say which traffic type dominates, not
  // meant to be a byte-exact total.
  const edgeFamilyBytes = new Map<string, Map<string, number>>();
  for (const r of flow) {
    const bIsWatched = watchedIps.has(r.peer_ip);
    const kind: "mm" | "mp" = bIsWatched ? "mm" : "mp";
    const key = bIsWatched
      ? ["mm", ...[r.monitored_ip, r.peer_ip].sort()].join("|")
      : `mp|${r.monitored_ip}|${r.peer_ip}`;
    // The same bar rollup__confirmed_contacts_daily itself promotes rows
    // on: either side has a confirmed role, or this exact pair is itself a
    // confirmed SIP peer. An edge is "confirmed" if ANY day/port-family
    // row backing it clears this — the same condition under which that
    // row would have appeared in confirmed-contacts at all.
    const rowConfirmed = r.monitored_ip_roles.length > 0 || r.peer_roles.length > 0 || r.pair_confirmed;
    const existing = edgeBytes.get(key);
    if (!existing) {
      edgeBytes.set(key, { bytes: r.bytes_sum, a: r.monitored_ip, b: r.peer_ip, kind, confirmed: rowConfirmed });
    } else if (kind === "mm") {
      existing.bytes = Math.max(existing.bytes, r.bytes_sum);
      existing.confirmed = existing.confirmed || rowConfirmed;
    } else {
      existing.bytes += r.bytes_sum;
      existing.confirmed = existing.confirmed || rowConfirmed;
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
    const identity = identities.get(ip);
    const n: GNode = {
      id: ip,
      kind: "monitored",
      label: ip,
      bytes: monitoredBytes.get(ip) ?? 0,
      confirmedRoles: roleRows.filter((r) => r.status === "confirmed").map((r) => r.role),
      pendingRoles: roleRows.filter((r) => r.status !== "confirmed" && r.status !== "rejected").map((r) => r.role),
      tags: w?.tags.filter((t) => !t.startsWith("msk:")) ?? [],
      asn: identity?.asn ?? null,
      country: identity?.country ?? null,
      x: 0,
      y: 0,
      r: Math.max(10, nodeRadius(monitoredBytes.get(ip) ?? 0)),
    };
    nodes.set(ip, n);
    return n;
  }

  function peerNode(ip: string, monitoredIp: string): GNode {
    const cid = clusterOf.get(ip);
    if (cid) {
      const existing = nodes.get(cid);
      if (existing) {
        // A peer that talks to more than one selected monitored IP calls
        // this twice for the same peer (once per edge) — guard on
        // membership rather than blindly incrementing, or it double-counts
        // that one peer as two.
        if (!existing.memberIps!.includes(ip)) {
          existing.bytes += peerBytes.get(ip) ?? 0;
          existing.memberIps!.push(ip);
          existing.clusterCount = existing.memberIps!.length;
          existing.r = Math.max(10, nodeRadius(existing.bytes));
        }
        // Recorded on every visit, not just the first — a peer genuinely
        // reachable from two selected monitored IPs needs to show up
        // under both of their attribution sets for the compare feature
        // to find it as a shared member.
        const set = existing.memberIpsByMonitored!.get(monitoredIp) ?? new Set<string>();
        set.add(ip);
        existing.memberIpsByMonitored!.set(monitoredIp, set);
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
        memberIps: [ip],
        memberIpsByMonitored: new Map([[monitoredIp, new Set([ip])]]),
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
    const b = e.kind === "mm" ? monitoredNode(e.b) : peerNode(e.b, e.a);
    links.push({ source: a.id, target: b.id, bytes: e.bytes, kind: e.kind, dominantFamily: dominantFamily(key), confirmed: e.confirmed });
  }

  // A monitored IP the analyst explicitly picked but that has zero rows
  // in rollup__flow_daily at all (true silence, not just "nothing
  // reviewed yet") never got a node at all before this — monitoredNode()
  // only ever ran from inside the edge loop above, so picking it just
  // silently produced nothing, with no error and no "it's here, it just
  // has no edges yet" signal. Force one for every explicitly selected IP
  // now; its own role and identity data still populate correctly either
  // way, since those come from `roles`/`identities`, not from flow.
  for (const ip of ips) monitoredNode(ip);

  return { nodes: [...nodes.values()], links };
}

function NodeGraph() {
  const [watchedIps, setWatchedIps] = useState<WatchedIp[] | null>(null);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [roleMeaning, setRoleMeaning] = useState<Map<string, string>>(new Map());
  const [selectedIps, setSelectedIps] = useState<Set<string>>(new Set());
  const [data, setData] = useState<{ nodes: GNode[]; links: GLink[] } | null>(null);
  // peer-vantage review__ip_roles, keyed by IP — only used by the ASN
  // cluster sidebar list, so it's kept separate from GNode/buildGraph
  // rather than threaded through the graph structure itself.
  const [peerRoles, setPeerRoles] = useState<Map<string, IpRole[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GNode | null>(null);
  // Shift-click builds this set independently of `selected` — plain click
  // still opens a node's own detail in the sidebar (unchanged), so
  // inspecting an ASN cluster's member list never drops whatever else is
  // in the compare set. Shared edges/neighbors/cluster-members between
  // its members are computed at render time, not stored here.
  const [compareSet, setCompareSet] = useState<Set<string>>(new Set());
  // Shift-click alone turned out to be unreliable as the only way in —
  // easy to try and get no visible result from (nothing to see unless
  // the two nodes happen to share a direct edge or cluster member), easy
  // to mistake for broken. An explicit toggle makes "clicks now build a
  // compare set" a visible, sticky mode instead of a modifier you have to
  // remember and trust is registering. Shift-click still works too, as a
  // shortcut, when the mode is off.
  const [compareMode, setCompareMode] = useState(false);
  function toggleCompare(id: string) {
    setCompareSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  // Clicking a Legend row dims everything that doesn't match it — a role
  // and a peer category both describe NODES, a traffic type and the mm/mp
  // distinction both describe EDGES, so exactly one of node/edge dimming
  // applies depending on which kind of row was clicked; the other kind
  // stays fully dimmed, not left at full color, since "only the selected
  // type stays true color" was explicit. Clicking the active row again
  // (or clicking elsewhere) clears it.
  const [highlight, setHighlight] = useState<
    | { kind: "role"; value: string }
    | { kind: "category"; value: string }
    | { kind: "family"; value: string }
    | { kind: "edgeKind"; value: "mm" | "mp" }
    | { kind: "confirmed"; value: boolean }
    | null
  >(null);
  function toggleHighlight(next: NonNullable<typeof highlight>) {
    setHighlight((prev) => (prev && prev.kind === next.kind && prev.value === next.value ? null : next));
  }
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number; moved: boolean } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
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
      setCompareSet(new Set());
      setPeerRoles(new Map());
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    // Snapshot before the fetch, not inside load() after it — this is the
    // layout as the user left it (including any manual drags) the moment
    // they changed the selection, not whatever setData calls happen to
    // land while the fetch is in flight.
    const prevPositions = new Map(data?.nodes.map((n) => [n.id, { x: n.x, y: n.y }]) ?? []);

    async function load() {
      try {
        const ips = [...selectedIps];
        const [flowPerIp, rolesResult, peerRolesResult, watchResult, identityPerIp] = await Promise.all([
          Promise.all(
            ips.map((ip) =>
              flowDailyRollupFlowDailyGet({ query: { monitored_ip: ip, limit: 20000 }, throwOnError: true }),
            ),
          ),
          listIpRolesReviewIpRolesGet({ query: { vantage: "watched", limit: 1000 }, throwOnError: true }),
          // Only used by the ASN-cluster sidebar list ("which of these
          // bucketed peers already have a role?") — fetched unconditionally
          // alongside everything else rather than lazily on cluster click,
          // since it's one cheap call and keeps the sidebar instant.
          listIpRolesReviewIpRolesGet({ query: { vantage: "peer", limit: 1000 }, throwOnError: true }),
          listIpsWatchIpsGet({ throwOnError: true }),
          // So the sidebar can show a monitored IP's own ASN/country the
          // same way it already does for a peer or cluster — not thrown
          // on failure (same as EntityDetail's own use of this endpoint):
          // a watched IP with no identity row yet just shows nothing,
          // it shouldn't take the rest of the graph down with it.
          Promise.all(ips.map((ip) => getIpIdentityLookupIpIdentitiesIpGet({ path: { ip } }))),
        ]);
        if (cancelled) return;

        const flow = flowPerIp.flatMap((r) => r.data.rows);

        const roles = new Map<string, IpRole[]>();
        for (const r of rolesResult.data.rows) {
          const list = roles.get(r.ip) ?? [];
          list.push(r);
          roles.set(r.ip, list);
        }
        const peerRoleMap = new Map<string, IpRole[]>();
        for (const r of peerRolesResult.data.rows) {
          const list = peerRoleMap.get(r.ip) ?? [];
          list.push(r);
          peerRoleMap.set(r.ip, list);
        }
        const watched = new Map(watchResult.data.rows.map((w) => [w.ip, w]));
        const identities = new Map<string, IpIdentity>();
        for (const r of identityPerIp) {
          if (r.data) identities.set(r.data.ip, r.data);
        }
        const graph = buildGraph(ips, flow, roles, watched, identities);

        // d3-force layout, run synchronously then freeze. A node that was
        // already on screen (same id — an IP, or cluster:<asn>) keeps its
        // prior position and is pinned (fx/fy) for this pass, so adding
        // one more monitored IP doesn't reshuffle everything that was
        // already there, including anything the analyst dragged by hand.
        //
        // A genuinely new node used to start at a position with no
        // relation to its neighbors — anywhere in an 0.8*W×0.8*H box
        // around center — and rely entirely on the link force to pull it
        // toward its anchor over the tick budget below. With a graph
        // that's mostly pinned obstacles by the time someone's added a
        // few IPs, that random start regularly had nowhere obvious to
        // go: collision couldn't push a cluster of new peers outward
        // through the existing layout, so they settled in whatever gap
        // was nearest their random drop point — which, because they're
        // ALSO pulled toward forceCenter/forceX/forceY, was usually the
        // middle. Seed every new node near its actual neighbors instead:
        // monitored nodes first (there are few, and nearly everything
        // else anchors to one), then everyone else, so a new peer's seed
        // can reference its monitored node's just-assigned position, not
        // only nodes that were already pinned. Only a node with no
        // already-positioned neighbor at all (the very first thing ever
        // added to an empty graph) falls back to the old anywhere-in-
        // canvas placement.
        const neighborIds = new Map<string, string[]>();
        for (const l of graph.links) {
          (neighborIds.get(l.source) ?? neighborIds.set(l.source, []).get(l.source)!).push(l.target);
          (neighborIds.get(l.target) ?? neighborIds.set(l.target, []).get(l.target)!).push(l.source);
        }
        const seeded = new Map<string, { x: number; y: number }>(prevPositions);
        function seedPosition(id: string): { x: number; y: number } {
          const already = seeded.get(id);
          if (already) return already;
          const known = (neighborIds.get(id) ?? []).map((nb) => seeded.get(nb)).filter((p): p is { x: number; y: number } => !!p);
          let pos: { x: number; y: number };
          if (known.length > 0) {
            const avgX = known.reduce((s, p) => s + p.x, 0) / known.length;
            const avgY = known.reduce((s, p) => s + p.y, 0) / known.length;
            const angle = Math.random() * Math.PI * 2;
            const jitter = 40 + Math.random() * 40;
            pos = { x: avgX + Math.cos(angle) * jitter, y: avgY + Math.sin(angle) * jitter };
          } else {
            pos = { x: W / 2 + (Math.random() - 0.5) * W * 0.8, y: H / 2 + (Math.random() - 0.5) * H * 0.8 };
          }
          seeded.set(id, pos);
          return pos;
        }
        for (const n of graph.nodes) if (n.kind === "monitored") seedPosition(n.id);
        for (const n of graph.nodes) if (n.kind !== "monitored") seedPosition(n.id);

        const simNodes: (GNode & { fx?: number; fy?: number })[] = graph.nodes.map((n) => {
          const prev = prevPositions.get(n.id);
          const pos = seedPosition(n.id);
          if (prev) return { ...n, x: pos.x, y: pos.y, fx: pos.x, fy: pos.y };
          return { ...n, x: pos.x, y: pos.y };
        });
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
            // No role ring anymore, but a monitored node now carries an
            // IP-address text label below the icon — fixed width
            // regardless of n.r (an IPv4 address is ~15 characters, about
            // 45px at this font size), which is wider than any marker row
            // and has to clear the SAME way the old ring-based footprint
            // did, or two nearby monitored nodes' labels overlap. A
            // standalone peer with a role gets a single small marker
            // (r+11, no label) — clusters show nothing on the glyph
            // itself, so they keep the tight padding regardless.
            d3
              .forceCollide((d) => {
                const gd = d as GNode;
                if (gd.kind === "monitored") return Math.max(30, gd.r + 10);
                if (gd.kind === "peer" && peerRoleMap.has(gd.id)) return gd.r + 16;
                return gd.r + 6;
              })
              // Default 1 pass/tick isn't enough to fully resolve
              // collisions in a graph that's mostly pinned obstacles by
              // the time a few IPs are selected — new nodes could settle
              // touching an obstacle rather than clearing it. More passes
              // per tick converges properly without needing more ticks.
              .iterations(3),
          )
          .stop();
        for (let i = 0; i < 450; i++) simulation.tick();
        // fx/fy only mattered for pinning during the tick loop above — the
        // simulation never runs again after this (positions only change
        // from here via a manual drag), so release them rather than leave
        // stale pin coordinates sitting on the node.
        for (const n of simNodes) {
          delete n.fx;
          delete n.fy;
        }

        if (cancelled) return;
        setData({ nodes: simNodes as GNode[], links: graph.links });
        setPeerRoles(peerRoleMap);
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
  // Aliased so nodeHighlightMatch (a named function, not a closure TS
  // re-narrows `data` through) can read it without a redundant null check.
  const links = data.links;

  // Legend scoped to what's actually on screen, not a hardcoded list — a
  // selection of two IPs with one role between them doesn't need to see
  // the other twelve roles that exist in the vocabulary but aren't here.
  // Standalone peers carry roles too now (their own marker icons render
  // right on the graph) — this used to only look at monitored nodes, so
  // a peer-only role like sip_trunk on a peer that has no monitored
  // counterpart never showed up here even though its marker was visible.
  const rolesPresent = new Map<string, { confirmed: boolean; pending: boolean }>();
  for (const n of data.nodes) {
    if (n.kind === "monitored") {
      for (const r of n.confirmedRoles ?? []) {
        rolesPresent.set(r, { ...(rolesPresent.get(r) ?? { confirmed: false, pending: false }), confirmed: true });
      }
      for (const r of n.pendingRoles ?? []) {
        rolesPresent.set(r, { ...(rolesPresent.get(r) ?? { confirmed: false, pending: false }), pending: true });
      }
    } else if (n.kind === "peer") {
      for (const row of peerRoles.get(n.id) ?? []) {
        if (row.status === "rejected") continue;
        const prev = rolesPresent.get(row.role) ?? { confirmed: false, pending: false };
        rolesPresent.set(row.role, {
          confirmed: prev.confirmed || row.status === "confirmed",
          pending: prev.pending || row.status !== "confirmed",
        });
      }
    }
  }
  const familiesPresent = [...new Set(data.links.map((l) => l.dominantFamily))].sort();

  // Compare: with 2+ nodes clicked (compare mode, or shift-click as a
  // shortcut), figure out what they share — a direct edge between two of
  // them (handled per-edge above), any other node that's a neighbor of
  // more than one of them, and for an ASN cluster specifically, which of
  // its merged members actually trace back to more than one of them
  // (the thing clustering itself can never show, since those members
  // have no separate position on the canvas to click).
  const comparing = compareSet.size >= 2;
  const neighborsOfCompare = new Map<string, Set<string>>(); // nodeId -> which compared nodes touch it
  if (comparing) {
    for (const l of data.links) {
      const a = nodeById.get(l.source as unknown as string) ?? nodeById.get((l.source as unknown as GNode).id);
      const b = nodeById.get(l.target as unknown as string) ?? nodeById.get((l.target as unknown as GNode).id);
      if (!a || !b) continue;
      if (compareSet.has(a.id) && !compareSet.has(b.id)) {
        const set = neighborsOfCompare.get(b.id) ?? new Set<string>();
        set.add(a.id);
        neighborsOfCompare.set(b.id, set);
      }
      if (compareSet.has(b.id) && !compareSet.has(a.id)) {
        const set = neighborsOfCompare.get(a.id) ?? new Set<string>();
        set.add(b.id);
        neighborsOfCompare.set(a.id, set);
      }
    }
  }
  const sharedNeighborIds = new Set([...neighborsOfCompare.entries()].filter(([, s]) => s.size >= 2).map(([id]) => id));
  function sharedClusterMembers(cluster: GNode): string[] {
    const contributors = [...(neighborsOfCompare.get(cluster.id) ?? [])];
    const byMonitored = cluster.memberIpsByMonitored;
    if (contributors.length < 2 || !byMonitored) return [];
    let shared: string[] | null = null;
    for (const mIp of contributors) {
      const s = byMonitored.get(mIp);
      if (!s || s.size === 0) return [];
      shared = shared === null ? [...s] : shared.filter((ip) => s.has(ip));
    }
    return shared ?? [];
  }

  // Shared by both the edge loop and the node loop, so a role/category
  // Legend highlight dims a node and every edge touching it the same way
  // — an edge only stays lit if BOTH ends match, which is what actually
  // answers "which monitored IP does this highlighted peer talk to."
  function nodeHighlightMatch(n: GNode): boolean {
    if (!highlight) return true;
    if (highlight.kind === "role") {
      const rows =
        n.kind === "monitored"
          ? [...(n.confirmedRoles ?? []), ...(n.pendingRoles ?? [])]
          : n.kind === "peer"
            ? (peerRoles.get(n.id) ?? []).filter((r) => r.status !== "rejected").map((r) => r.role)
            : []; // a cluster carries no role of its own
      return rows.includes(highlight.value);
    }
    if (highlight.kind === "category") {
      if (n.kind === "monitored") return true; // context, never the match target
      // A cluster carries one stored category same as a peer does (its
      // first member's) — treated the same way as any other peer node
      // here, matching or dimming on it rather than being special-cased.
      return (n.category ?? "unclassified") === highlight.value;
    }
    // family/edgeKind/confirmed describe edges, not nodes directly — but a
    // node clicked through one of these Legend rows behaves the same as
    // one clicked through role/category: a monitored IP stays as context,
    // and anything else counts as a match if it has at least one edge of
    // the highlighted kind touching it.
    if (n.kind === "monitored") return true;
    return links.some((l) => {
      const a = nodeById.get(l.source as unknown as string) ?? nodeById.get((l.source as unknown as GNode).id);
      const b = nodeById.get(l.target as unknown as string) ?? nodeById.get((l.target as unknown as GNode).id);
      if (!a || !b || (a.id !== n.id && b.id !== n.id)) return false;
      if (highlight.kind === "family") return l.dominantFamily === highlight.value;
      if (highlight.kind === "edgeKind") return l.kind === highlight.value;
      return l.confirmed === highlight.value;
    });
  }

  return (
    <>
      {picker}
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div className="card" style={{ width: W, maxWidth: "100%", height: H, position: "relative", overflow: "hidden", flexShrink: 0 }}>
        <button
          onClick={() => setCompareMode((m) => !m)}
          className="mono"
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            zIndex: 1,
            cursor: "pointer",
            fontSize: 11,
            padding: "5px 10px",
            borderRadius: 6,
            border: "1px solid",
            borderColor: compareMode ? "#FFE55C" : "#2B7266",
            background: compareMode ? "#3A350F" : "#0A2224",
            color: compareMode ? "#FFE55C" : "#A6D8CD",
          }}
        >
          {compareMode ? "✓ compare mode — click nodes to compare" : "compare mode"}
        </button>
        <ZoomableSvg width={W} height={H}>
          {data.links.map((l, i) => {
            const a = nodeById.get(l.source as unknown as string) ?? nodeById.get((l.source as unknown as GNode).id);
            const b = nodeById.get(l.target as unknown as string) ?? nodeById.get((l.target as unknown as GNode).id);
            if (!a || !b) return null;
            const width = Math.max(1, Math.min(8, Math.sqrt(l.bytes) / 200));
            const color = familyColor(l.dominantFamily);
            // With 2+ nodes in the compare set, that becomes the only
            // question this view answers — so it takes over dimming from
            // the Legend highlight rather than combining with it (two
            // independent dimming reasons get confusing fast). A compare
            // edge is either a direct edge between two compared nodes, or
            // an edge from a compared node out to a shared neighbor
            // (sharedNeighborIds already means "touched by 2+ compared
            // nodes") — without the second half, the shared-neighbor node
            // stayed bright while every edge reaching it dimmed to near
            // nothing, which just looked disconnected.
            const isCompareEdge =
              comparing &&
              ((compareSet.has(a.id) && compareSet.has(b.id)) ||
                (compareSet.has(a.id) && sharedNeighborIds.has(b.id)) ||
                (compareSet.has(b.id) && sharedNeighborIds.has(a.id)));
            const edgeDimmed = comparing
              ? !isCompareEdge
              : highlight
                ? highlight.kind === "family"
                  ? l.dominantFamily !== highlight.value
                  : highlight.kind === "edgeKind"
                    ? l.kind !== highlight.value
                    : highlight.kind === "confirmed"
                      ? l.confirmed !== highlight.value
                      : // role/category: stay lit only between two nodes that
                        // both match — that's what actually shows which
                        // monitored IP a highlighted peer talks to, instead
                        // of blanking every edge regardless of relevance.
                        !(nodeHighlightMatch(a) && nodeHighlightMatch(b))
                : false;
            // Confirmed is a third, independent edge channel alongside
            // color (traffic type) and dash pattern (mm/mp): a day of real
            // traffic that hasn't cleared the role/pair-confirmation bar
            // still draws, just faint, rather than not drawing at all.
            const baseOpacity = l.confirmed ? 1 : 0.32;
            return (
              <g key={i}>
                {isCompareEdge && (
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="#FFE55C"
                    strokeWidth={Math.max(4, width + 3)}
                    strokeLinecap="round"
                    opacity={0.55}
                  />
                )}
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={color}
                  strokeWidth={l.kind === "mm" ? Math.max(2, width) : width}
                  strokeDasharray={l.kind === "mm" ? "3 7" : undefined}
                  strokeLinecap="round"
                  opacity={edgeDimmed ? 0.08 : baseOpacity}
                >
                  <title>
                    {a.label} ↔ {b.label} · {l.dominantFamily} · {formatBytes(l.bytes)} ·{" "}
                    {l.confirmed ? "confirmed" : "not yet reviewed"}
                  </title>
                </line>
              </g>
            );
          })}
          {data.nodes.map((n) => {
            const isMonitored = n.kind === "monitored";
            // Confirmed roles first, purely for stable ordering (so a
            // role's ring position doesn't jump between renders) — every
            // role gets an equal arc now, there's no "primary" concept.
            const roleList = isMonitored
              ? [
                  ...(n.confirmedRoles ?? []).map((role) => ({ role, confirmed: true })),
                  ...(n.pendingRoles ?? []).map((role) => ({ role, confirmed: false })),
                ]
              : [];
            // Standalone peers only, deliberately not clusters — a cluster
            // folds several peers together, so there's no single role to
            // put on its one glyph; that's still only reachable through
            // the sidebar's member list. A peer keeps its category circle
            // either way — role is a second, independent axis (what it
            // does vs. what kind of infrastructure it is), not a
            // replacement for category.
            const peerRoleRows = n.kind === "peer" ? (peerRoles.get(n.id) ?? []) : [];
            const peerRoleList = [
              ...peerRoleRows.filter((r) => r.status === "confirmed").map((r) => ({ role: r.role, confirmed: true })),
              ...peerRoleRows
                .filter((r) => r.status !== "confirmed" && r.status !== "rejected")
                .map((r) => ({ role: r.role, confirmed: false })),
            ];
            const [catBg, catFg] = !isMonitored ? categoryColors(n.category ?? "unclassified") : ["", ""];
            const nodeDimmed = comparing
              ? !compareSet.has(n.id) && !sharedNeighborIds.has(n.id)
              : !nodeHighlightMatch(n);
            return (
              <g
                key={n.id}
                data-no-pan
                style={{ cursor: draggingId === n.id ? "grabbing" : "grab", opacity: nodeDimmed ? 0.15 : 1 }}
                onClick={(e) => {
                  if (dragRef.current?.moved) return;
                  if (compareMode || e.shiftKey) {
                    toggleCompare(n.id);
                    return;
                  }
                  setSelected(n);
                }}
                onMouseDown={(e) => {
                  // data-no-pan (ZoomableSvg.tsx) is what keeps this from
                  // also panning the canvas — d3.zoom's own filter() skips
                  // starting a pan gesture for any event on a data-no-pan
                  // descendant. stopPropagation here is unrelated, just
                  // defense in depth against other ancestor handlers.
                  e.stopPropagation();
                  const gEl = e.currentTarget;
                  const start = toSvgPoint(gEl, e.clientX, e.clientY);
                  dragRef.current = { id: n.id, offsetX: start.x - n.x, offsetY: start.y - n.y, moved: false };
                  setDraggingId(n.id);

                  function onMove(ev: MouseEvent) {
                    const d = dragRef.current;
                    if (!d || d.id !== n.id) return;
                    const p = toSvgPoint(gEl, ev.clientX, ev.clientY);
                    const nx = p.x - d.offsetX;
                    const ny = p.y - d.offsetY;
                    if (Math.abs(nx - n.x) > 1 || Math.abs(ny - n.y) > 1) d.moved = true;
                    setData((prev) =>
                      prev
                        ? { ...prev, nodes: prev.nodes.map((node) => (node.id === n.id ? { ...node, x: nx, y: ny } : node)) }
                        : prev,
                    );
                  }
                  function onUp() {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                    setDraggingId(null);
                    // Deferred so onClick (fires right after mouseup, same
                    // task) can still read dragRef.current.moved before it's
                    // cleared.
                    setTimeout(() => {
                      dragRef.current = null;
                    }, 0);
                  }
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }}
              >
                {isMonitored ? (
                  <>
                    {selected?.id === n.id && (
                      <circle cx={n.x} cy={n.y} r={26} fill="none" stroke="#E8FFF8" strokeWidth={1.5} strokeDasharray="2 3" />
                    )}
                    {compareSet.has(n.id) && (
                      <circle cx={n.x} cy={n.y} r={31} fill="none" stroke="#FFE55C" strokeWidth={2} />
                    )}
                    {!compareSet.has(n.id) && sharedNeighborIds.has(n.id) && (
                      <circle cx={n.x} cy={n.y} r={31} fill="none" stroke="#FFE55C" strokeWidth={1.2} strokeDasharray="1 3" />
                    )}
                    <g transform={`translate(${n.x},${n.y})`}>
                      <rect
                        x={-8}
                        y={-10}
                        width={16}
                        height={20}
                        rx={2}
                        fill={selected?.id === n.id ? "#16403A" : "#0F3133"}
                        stroke={selected?.id === n.id ? "#E8FFF8" : "#6FA89E"}
                        strokeWidth={selected?.id === n.id ? 2.5 : 2}
                      />
                      <line x1={-5} y1={-5} x2={5} y2={-5} stroke="#6FA89E" strokeWidth={1} />
                      <line x1={-5} y1={0} x2={5} y2={0} stroke="#6FA89E" strokeWidth={1} />
                      <line x1={-5} y1={5} x2={5} y2={5} stroke="#6FA89E" strokeWidth={1} />
                      <circle cx={4} cy={-7.5} r={1} fill="#3DD68C" />
                      {(() => {
                        const marked = roleList.filter((r) => hasMarker(r.role));
                        if (marked.length === 0) return null;
                        const startX = -((marked.length - 1) * 13) / 2;
                        return marked.map((r, i) => (
                          <g key={r.role} transform={`translate(${startX + i * 13},16) scale(0.5)`}>
                            <RoleMarker role={r.role} />
                          </g>
                        ));
                      })()}
                      <text
                        y={roleList.some((r) => hasMarker(r.role)) ? 29 : 17}
                        textAnchor="middle"
                        fontSize={9}
                        fill="#A6D8CD"
                        className="mono"
                      >
                        {n.id}
                      </text>
                    </g>
                  </>
                ) : (
                  <>
                    {compareSet.has(n.id) && (
                      <circle cx={n.x} cy={n.y} r={n.r + 5} fill="none" stroke="#FFE55C" strokeWidth={2} />
                    )}
                    {!compareSet.has(n.id) && sharedNeighborIds.has(n.id) && (
                      <circle cx={n.x} cy={n.y} r={n.r + 5} fill="none" stroke="#FFE55C" strokeWidth={1.2} strokeDasharray="1 3" />
                    )}
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={n.r}
                      fill={n.kind === "cluster" ? "#0F3133" : catBg}
                      stroke={selected?.id === n.id ? "#E8FFF8" : n.kind === "cluster" ? "#6FA89E" : catFg}
                      strokeWidth={selected?.id === n.id ? 3 : 2}
                      strokeDasharray={n.kind === "cluster" ? "3 3" : undefined}
                    />
                    {peerRoleList
                      .filter((r) => hasMarker(r.role))
                      .map((r, i, marked) => {
                        const angle = (i / marked.length) * Math.PI * 2 - Math.PI / 2;
                        return (
                          <g
                            key={r.role}
                            transform={`translate(${n.x + (n.r + 11) * Math.cos(angle)},${n.y + (n.r + 11) * Math.sin(angle)}) scale(0.5)`}
                          >
                            <RoleMarker role={r.role} />
                          </g>
                        );
                      })}
                  </>
                )}
                <title>
                  {n.label} · {formatBytes(n.bytes)}
                  {n.clusterCount ? ` · ${n.clusterCount} peers` : ""}
                  {(isMonitored ? roleList : peerRoleList).length > 0
                    ? ` · ${(isMonitored ? roleList : peerRoleList)
                        .map((r) => `${r.role}${r.confirmed ? "" : " (suggested)"}`)
                        .join(", ")}`
                    : ""}
                </title>
              </g>
            );
          })}
        </ZoomableSvg>
        <div style={{ position: "absolute", bottom: 10, right: 10, fontSize: 10, color: "#6FA89E", pointerEvents: "none" }}>
          scroll to zoom · drag empty space to pan · drag a node to move it · shift-click (or compare
          mode) 2+ nodes to see what they share
        </div>
      </div>

      <div style={{ width: 284, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#A6D8CD" }}>Legend</div>
            {highlight && (
              <button
                onClick={() => setHighlight(null)}
                style={{ all: "unset", cursor: "pointer", fontSize: 11, color: "#7FEFD6" }}
              >
                clear highlight
              </button>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 12 }}>
            {rolesPresent.size > 0 && (
              <div>
                <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase", marginBottom: 6 }}>
                  Roles
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[...rolesPresent.entries()]
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([role, state]) => {
                      const c = roleColor(role);
                      const active = highlight?.kind === "role" && highlight.value === role;
                      return (
                        <div
                          key={role}
                          onClick={() => toggleHighlight({ kind: "role", value: role })}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            cursor: "pointer",
                            padding: "2px 4px",
                            marginLeft: -4,
                            borderRadius: 4,
                            background: active ? "#153226" : "transparent",
                          }}
                          title={roleMeaning.get(role)}
                        >
                          <span style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                            {state.confirmed && (
                              <span
                                style={{
                                  width: 11,
                                  height: 11,
                                  borderRadius: "50%",
                                  background: c.bg,
                                  border: `2px solid ${c.border}`,
                                  display: "inline-block",
                                }}
                              />
                            )}
                            {state.pending && (
                              <span
                                style={{
                                  width: 11,
                                  height: 11,
                                  borderRadius: "50%",
                                  background: "transparent",
                                  border: `2px dashed ${c.border}`,
                                  display: "inline-block",
                                }}
                              />
                            )}
                          </span>
                          {hasMarker(role) && (
                            <svg width={14} height={14} viewBox="-12 -12 24 24" style={{ flexShrink: 0 }}>
                              <RoleMarker role={role} />
                            </svg>
                          )}
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
                  const active = highlight?.kind === "category" && highlight.value === cat;
                  return (
                    <div
                      key={cat}
                      onClick={() => toggleHighlight({ kind: "category", value: cat })}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        cursor: "pointer",
                        padding: "2px 4px",
                        marginLeft: -4,
                        borderRadius: 4,
                        background: active ? "#153226" : "transparent",
                      }}
                    >
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
                  {familiesPresent.map((fam) => {
                    const active = highlight?.kind === "family" && highlight.value === fam;
                    return (
                      <div
                        key={fam}
                        onClick={() => toggleHighlight({ kind: "family", value: fam })}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          cursor: "pointer",
                          padding: "2px 4px",
                          marginLeft: -4,
                          borderRadius: 4,
                          background: active ? "#153226" : "transparent",
                        }}
                      >
                        <span
                          style={{ width: 18, height: 3, background: familyColor(fam), display: "inline-block", flexShrink: 0 }}
                        />
                        <span className="mono">{fam}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase", marginBottom: 6 }}>
                Edge style
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div
                  onClick={() => toggleHighlight({ kind: "edgeKind", value: "mm" })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    padding: "2px 4px",
                    marginLeft: -4,
                    borderRadius: 4,
                    background: highlight?.kind === "edgeKind" && highlight.value === "mm" ? "#153226" : "transparent",
                  }}
                >
                  <span style={{ width: 18, height: 0, borderTop: "2px dashed #A6D8CD", display: "inline-block", flexShrink: 0 }} />
                  monitored ↔ monitored
                </div>
                <div
                  onClick={() => toggleHighlight({ kind: "edgeKind", value: "mp" })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    padding: "2px 4px",
                    marginLeft: -4,
                    borderRadius: 4,
                    background: highlight?.kind === "edgeKind" && highlight.value === "mp" ? "#153226" : "transparent",
                  }}
                >
                  <span style={{ width: 18, height: 2, background: "#A6D8CD", display: "inline-block", flexShrink: 0 }} />
                  monitored ↔ peer (width ~ bytes)
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase", marginBottom: 6 }}>
                Review status (edge opacity)
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div
                  onClick={() => toggleHighlight({ kind: "confirmed", value: true })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    padding: "2px 4px",
                    marginLeft: -4,
                    borderRadius: 4,
                    background: highlight?.kind === "confirmed" && highlight.value === true ? "#153226" : "transparent",
                  }}
                >
                  <span style={{ width: 18, height: 2, background: "#A6D8CD", opacity: 1, display: "inline-block", flexShrink: 0 }} />
                  confirmed — role on either side, or pair itself confirmed
                </div>
                <div
                  onClick={() => toggleHighlight({ kind: "confirmed", value: false })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    padding: "2px 4px",
                    marginLeft: -4,
                    borderRadius: 4,
                    background: highlight?.kind === "confirmed" && highlight.value === false ? "#153226" : "transparent",
                  }}
                >
                  <span style={{ width: 18, height: 2, background: "#A6D8CD", opacity: 0.32, display: "inline-block", flexShrink: 0 }} />
                  not yet reviewed — real traffic, nobody's looked
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
              {(() => {
                // Identity (ASN/country/category) and role are two
                // independent facts about any node, monitored or peer —
                // a cluster is the one exception, since it's several
                // peers folded together with no single role to show.
                // Both lines render for both node kinds now; they used to
                // each only get one or the other.
                const identityLine =
                  selected.kind === "cluster"
                    ? `${selected.clusterCount} peers · AS${selected.asn} · ${selected.country ?? "—"}`
                    : [
                        selected.kind === "peer" ? selected.category : null,
                        selected.asn ? `AS${selected.asn}` : null,
                        selected.country,
                      ]
                        .filter(Boolean)
                        .join(" · ") || null;
                const confirmedRoles =
                  selected.kind === "monitored"
                    ? (selected.confirmedRoles ?? [])
                    : selected.kind === "peer"
                      ? (peerRoles.get(selected.id) ?? []).filter((r) => r.status === "confirmed").map((r) => r.role)
                      : [];
                const pendingRoles =
                  selected.kind === "monitored"
                    ? (selected.pendingRoles ?? [])
                    : selected.kind === "peer"
                      ? (peerRoles.get(selected.id) ?? [])
                          .filter((r) => r.status !== "confirmed" && r.status !== "rejected")
                          .map((r) => r.role)
                      : [];
                const roleLine =
                  selected.kind === "cluster"
                    ? null
                    : [
                        confirmedRoles.length > 0 ? `confirmed: ${confirmedRoles.join(", ")}` : null,
                        pendingRoles.length > 0 ? `suggested: ${pendingRoles.join(", ")}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "no role yet";
                return (
                  <div style={{ fontSize: 12, color: "#A6D8CD", marginBottom: 10 }}>
                    {identityLine && <div>{identityLine}</div>}
                    {roleLine && <div>{roleLine}</div>}
                  </div>
                );
              })()}
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
              {selected.kind === "cluster" && selected.memberIps && selected.memberIps.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>
                      Bucketed peer IPs ({selected.memberIps.length})
                    </div>
                    <CopyButton text={selected.memberIps.join("\n")} label="Copy all IPs" />
                  </div>
                  <div
                    className="mono"
                    style={{
                      maxHeight: 180,
                      overflowY: "auto",
                      fontSize: 11,
                      color: "#A6D8CD",
                      background: "#07181A",
                      border: "1px solid #1E4D37",
                      borderRadius: 6,
                      padding: "6px 8px",
                      lineHeight: 1.6,
                    }}
                  >
                    {selected.memberIps.map((ip) => {
                      const rows = peerRoles.get(ip) ?? [];
                      const confirmedRoles = rows.filter((r) => r.status === "confirmed").map((r) => r.role);
                      const pendingRoles = rows
                        .filter((r) => r.status !== "confirmed" && r.status !== "rejected")
                        .map((r) => r.role);
                      const hasRole = confirmedRoles.length > 0 || pendingRoles.length > 0;
                      return (
                        <div key={ip} style={{ marginBottom: 3 }}>
                          <div>{ip}</div>
                          <div style={{ color: "#6FA89E", fontSize: 10, paddingLeft: 8 }}>
                            {hasRole ? (
                              <>
                                {confirmedRoles.map((r) => (
                                  <span key={r} style={{ marginRight: 6 }}>
                                    {r}
                                  </span>
                                ))}
                                {pendingRoles.map((r) => (
                                  <span key={r} style={{ marginRight: 6, opacity: 0.65 }}>
                                    {r} (suggested)
                                  </span>
                                ))}
                              </>
                            ) : (
                              // Visible, not silent: this peer was checked
                              // against review__ip_roles (peer vantage) and
                              // genuinely has no row there — most of them
                              // don't, since only 211 peer-vantage roles
                              // exist at all. Saying so plainly instead of
                              // rendering nothing is the only way to tell
                              // "checked, none" apart from "broken".
                              <span style={{ opacity: 0.5, fontStyle: "italic" }}>no role</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {compareSet.size > 0 && (
          <div className="card" style={{ padding: "16px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#FFE55C" }}>Compare ({compareSet.size})</div>
              <button
                onClick={() => setCompareSet(new Set())}
                style={{ all: "unset", cursor: "pointer", fontSize: 11, color: "#7FEFD6" }}
              >
                clear
              </button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {[...compareSet].map((id) => (
                <span key={id} className="chip mono" style={{ fontSize: 11, borderColor: "#FFE55C", color: "#FFE55C" }}>
                  {nodeById.get(id)?.label ?? id}
                </span>
              ))}
            </div>
            {compareSet.size === 1 ? (
              <div style={{ fontSize: 12, color: "#6FA89E" }}>
                Click (or shift-click) another node to compare — what they share shows up here
                automatically, no need to click either node again.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {(() => {
                  const directEdges = data.links.filter((l) => {
                    const a = nodeById.get(l.source as unknown as string) ?? nodeById.get((l.source as unknown as GNode).id);
                    const b = nodeById.get(l.target as unknown as string) ?? nodeById.get((l.target as unknown as GNode).id);
                    return !!a && !!b && compareSet.has(a.id) && compareSet.has(b.id);
                  });
                  return (
                    <div>
                      <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase", marginBottom: 4 }}>
                        Direct edges
                      </div>
                      {directEdges.length === 0 ? (
                        <div style={{ fontSize: 12, color: "#6FA89E" }}>none</div>
                      ) : (
                        directEdges.map((l, i) => {
                          const a = nodeById.get(l.source as unknown as string) ?? nodeById.get((l.source as unknown as GNode).id);
                          const b = nodeById.get(l.target as unknown as string) ?? nodeById.get((l.target as unknown as GNode).id);
                          return (
                            <div key={i} className="mono" style={{ fontSize: 12, color: "#FFE55C" }}>
                              {a?.label} ↔ {b?.label} · {formatBytes(l.bytes)}
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })()}

                <div>
                  <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase", marginBottom: 4 }}>
                    Shared neighbors
                  </div>
                  {(() => {
                    const shared = [...sharedNeighborIds]
                      .map((id) => nodeById.get(id))
                      .filter((nd): nd is GNode => !!nd && nd.kind !== "cluster");
                    if (shared.length === 0) return <div style={{ fontSize: 12, color: "#6FA89E" }}>none</div>;
                    return shared.map((nd) => (
                      <div key={nd.id} style={{ fontSize: 12, color: "#A6D8CD", marginBottom: 3 }}>
                        <span className="mono">{nd.label}</span>
                        <span style={{ color: "#6FA89E" }}>
                          {" "}
                          — reached from{" "}
                          {[...(neighborsOfCompare.get(nd.id) ?? [])].map((id) => nodeById.get(id)?.label ?? id).join(", ")}
                        </span>
                      </div>
                    ));
                  })()}
                </div>

                <div>
                  <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase", marginBottom: 4 }}>
                    Shared inside ASN clusters
                  </div>
                  {(() => {
                    const clusters = [...sharedNeighborIds]
                      .map((id) => nodeById.get(id))
                      .filter((nd): nd is GNode => !!nd && nd.kind === "cluster");
                    const rows = clusters
                      .map((c) => ({ cluster: c, members: sharedClusterMembers(c) }))
                      .filter((r) => r.members.length > 0);
                    if (rows.length === 0) return <div style={{ fontSize: 12, color: "#6FA89E" }}>none</div>;
                    return rows.map(({ cluster, members }) => (
                      <div key={cluster.id} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 12, color: "#A6D8CD" }}>
                          <span className="mono">{cluster.label}</span>
                          <span style={{ color: "#6FA89E" }}>
                            {" "}
                            — {members.length} shared, from{" "}
                            {[...(neighborsOfCompare.get(cluster.id) ?? [])].map((id) => nodeById.get(id)?.label ?? id).join(", ")}
                          </span>
                        </div>
                        <div className="mono" style={{ fontSize: 11, color: "#FFE55C", paddingLeft: 8, overflowWrap: "anywhere" }}>
                          {members.join(", ")}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: "#F5A623" }}>Data notes</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9, fontSize: 12, color: "#A6D8CD", lineHeight: 1.5 }}>
            <div>① Every monitored↔monitored edge is stored twice (once per side's pull) — keyed on the unordered pair, keeping the larger side rather than summing.</div>
            <div>② The edge view carries roles, not categories — peer color is joined back from <span className="mono">rollup__flow_daily</span>.</div>
            <div>③ ASN clustering: peers below 0.5% of total graph bytes sharing an ASN with 2+ others collapse into one node — this was blocked until <span className="mono">peer_asn</span> landed on the rollups.</div>
            <div>④ A peer that's itself on the watchlist is drawn as a monitored node, never a plain peer.</div>
            <div>⑤ Role and traffic-type colors are generated from the name, not a hand-picked palette — a new role or port family gets a stable color automatically, never falls back to looking like "no role yet."</div>
            <div>⑥ A monitored node is drawn as a server glyph (fixed size, independent of byte volume) labeled with its own IP address — no role ring anymore, so identity is the one thing always on the canvas; hover or click for exact role names.</div>
            <div>⑦ Markers (phone, envelope, warning triangle, …) render in one fixed color, never a hashed hue — only the roles with real confirmed volume (9 of them, as of forward_proxy's gate icon) plus c2_server/c2_operator/c2_victim get one; every other role is ring color + text only, deliberately, so adding icons per-role doesn't become hand-maintained mapping debt.</div>
            <div>⑧ Click an ASN cluster node to see the individual peer IPs it bucketed, with a copy-all button.</div>
            <div>⑨ The layout is stateful across selection changes: a node already on screen (including anything dragged by hand) keeps its position when you add or remove a monitored IP — only newly appearing nodes get freshly simulated into place.</div>
            <div>⑩ A standalone peer with a role (from <span className="mono">review__ip_roles</span>, peer vantage) gets a marker icon outside its category circle if the role has one — no ring, no label; click the peer for the exact role. A role without a marker (most of them) shows nothing on a peer's glyph at all. Clustered peers never show a member's role on the glyph (one cluster, several peers, no single role to show) — their roles are in the cluster's own sidebar list instead.</div>
            <div>⑪ Edges are built from every <span className="mono">rollup__flow_daily</span> row now, not a pre-filtered confirmed-contacts view — a faint edge is real traffic nobody's reviewed yet, not something hidden. An edge counts as confirmed if any day/port-family bucket behind it clears the bar (role on either side, or the pair itself a confirmed SIP peer); click "Review status" in the Legend to isolate either state.</div>
            <div>⑫ Compare mode (or shift-click) builds a set of 2+ nodes and shows what they share: direct edges between them, any other node that's a neighbor of more than one, and — the one thing an ASN cluster can't show on its own — which of a cluster's merged members actually trace back to more than one of the compared monitored IPs, since those members have no separate position on the canvas to click individually.</div>
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
