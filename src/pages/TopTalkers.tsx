import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  topPeersRollupFlowDailyTopPeersGet,
  topAsnsRollupFlowDailyTopAsnsGet,
  unclassifiedContactsDailyRollupUnclassifiedContactsDailyGet,
  listAsnCandidatesReviewAsnCandidatesGet,
  type TopPeer,
  type TopAsn,
  type DailyUnclassifiedContact,
  type AsnCandidate,
} from "../api/netflow-rollups-client";
import { formatBytes } from "../lib/format";
import { categoryColors } from "../lib/categories";
import { errorMessage } from "../lib/errors";

type View = "ip" | "asn" | "uncl";

type TalkersData = {
  topPeers: TopPeer[];
  topAsns: TopAsn[];
  unclassified: DailyUnclassifiedContact[];
  asnCandidates: AsnCandidate[];
};

function categoryChip(category: string) {
  const [bg, fg] = categoryColors(category);
  return (
    <span className="chip" style={{ background: bg, color: fg, fontWeight: 500, padding: "3px 9px", borderRadius: 5, display: "inline-block" }}>
      {category.replace(/_/g, " ")}
    </span>
  );
}

export function TopTalkers() {
  const [view, setView] = useState<View>("ip");
  const [data, setData] = useState<TalkersData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [topPeers, topAsns, unclassified, asnCandidates] = await Promise.all([
          topPeersRollupFlowDailyTopPeersGet({
            query: {
              port_family: "rtp_media",
              exclude_confirmed: true,
              exclude_watched: true,
              limit: 20,
            },
            throwOnError: true,
          }),
          topAsnsRollupFlowDailyTopAsnsGet({
            query: {
              port_family: "rtp_media",
              exclude_confirmed: true,
              exclude_watched: true,
              limit: 20,
            },
            throwOnError: true,
          }),
          unclassifiedContactsDailyRollupUnclassifiedContactsDailyGet({
            query: { limit: 20000 },
            throwOnError: true,
          }),
          listAsnCandidatesReviewAsnCandidatesGet({ query: { limit: 1000 }, throwOnError: true }),
        ]);
        if (cancelled) return;
        setData({
          topPeers: topPeers.data.rows,
          topAsns: topAsns.data.rows,
          unclassified: unclassified.data.rows,
          asnCandidates: asnCandidates.data.rows,
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

  const unclByPeer = new Map<
    string,
    { monitoredIps: Set<string>; bytes: number; flows: number; days: Set<string>; lastDay: string }
  >();
  if (data) {
    for (const r of data.unclassified) {
      const e = unclByPeer.get(r.peer_ip) ?? {
        monitoredIps: new Set<string>(),
        bytes: 0,
        flows: 0,
        days: new Set<string>(),
        lastDay: "",
      };
      e.monitoredIps.add(r.watched_ip);
      e.bytes += r.bytes_sum;
      e.flows += r.flow_count;
      e.days.add(r.day);
      if (r.day > e.lastDay) e.lastDay = r.day;
      unclByPeer.set(r.peer_ip, e);
    }
  }
  const candidateByPeer = new Map(
    data?.asnCandidates.filter((c) => c.triggering_peer_ip).map((c) => [c.triggering_peer_ip!, c]) ?? [],
  );
  const candidateByAsn = new Map(data?.asnCandidates.map((c) => [c.asn, c]) ?? []);
  const asnOfPeer = new Map(data?.unclassified.filter((r) => r.peer_asn !== null).map((r) => [r.peer_ip, r.peer_asn!]) ?? []);
  const sortedUncl = [...unclByPeer.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 30);
  const totalUnclBytes = [...unclByPeer.values()].reduce((s, e) => s + e.bytes, 0);

  const SUBTITLES: Record<View, React.ReactNode> = {
    ip: (
      <>
        port_family = rtp_media · confirmed and watched peers excluded · scanners hidden upstream · <span className="mono">/rollup/flow-daily/top-peers</span>
      </>
    ),
    asn: (
      <>
        port_family = rtp_media · confirmed and watched peers excluded · scanners hidden upstream ·{" "}
        <span className="mono">/rollup/flow-daily/top-asns</span>
      </>
    ),
    uncl: (
      <>
        all port families · peer_categories = {"{}"} and no accepted role · {unclByPeer.size} peers /{" "}
        {formatBytes(totalUnclBytes)} in 7d · <span className="mono">/rollup/unclassified-contacts-daily</span>
      </>
    ),
  };

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: "0 0 4px 0", fontSize: 22, fontWeight: 600 }}>Top talkers</h1>
        <div style={{ fontSize: 13, color: "#6FA89E" }}>{data ? SUBTITLES[view] : "Loading…"}</div>
      </div>

      <div style={{ display: "flex", marginBottom: 20 }}>
        {(["ip", "asn", "uncl"] as View[]).map((v, i) => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              all: "unset",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              padding: "8px 18px",
              color: view === v ? "#E8FFF8" : "#A6D8CD",
              border: "1px solid #2B7266",
              borderLeft: i === 0 ? "1px solid #2B7266" : "none",
              borderRadius: i === 0 ? "6px 0 0 6px" : i === 2 ? "0 6px 6px 0" : 0,
              background: view === v ? "#133A3C" : "transparent",
              borderColor: view === v ? "#3F9C8A" : "#2B7266",
            }}
          >
            {v === "ip" ? "By IP" : v === "asn" ? "By ASN" : "Unclassified"}
            {v === "uncl" && (
              <span className="mono" style={{ color: "#F5A623", marginLeft: 4 }}>
                {unclByPeer.size}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="card" style={{ padding: 20, borderColor: "#5A2327" }}>
          Failed to load from netflow-rollups' API: {error}
        </div>
      )}
      {!data && !error && <div style={{ color: "#6FA89E" }}>Loading…</div>}

      {data && view === "ip" && (
        <div className="card">
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
            <thead>
              <tr>
                <th>Peer IP</th>
                <th>Categories</th>
                <th style={{ textAlign: "right" }}>Bytes</th>
                <th style={{ textAlign: "right" }}>Flows</th>
                <th style={{ textAlign: "right" }}>Days seen</th>
              </tr>
            </thead>
            <tbody>
              {data.topPeers.map((p) => (
                <tr key={p.peer_ip}>
                  <td>
                    <Link to={`/entity/${p.peer_ip}`} className="mono row-link">
                      {p.peer_ip}
                    </Link>
                  </td>
                  <td>
                    {p.peer_categories.length > 0
                      ? p.peer_categories.map((c) => <span key={c} style={{ marginRight: 4 }}>{categoryChip(c)}</span>)
                      : categoryChip("unclassified")}
                  </td>
                  <td className="num mono" style={{ textAlign: "right" }}>
                    {formatBytes(p.bytes_sum)}
                  </td>
                  <td className="num mono" style={{ textAlign: "right" }}>
                    {p.flow_count.toLocaleString()}
                  </td>
                  <td className="num mono" style={{ textAlign: "right" }}>
                    {p.days_seen}
                  </td>
                </tr>
              ))}
              {data.topPeers.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: "#6FA89E" }}>
                    No peers in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="note">
            Category comes from <span className="mono">/rollup/flow-daily</span>, not the mix route
            — it's the only place a peer in two categories (<span className="mono">bph</span> with{" "}
            <span className="mono">hosting</span> or <span className="mono">cloud</span>) shows both.
          </div>
        </div>
      )}

      {data && view === "asn" && (
        <div className="card">
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
            <thead>
              <tr>
                <th>ASN</th>
                <th>Country</th>
                <th style={{ textAlign: "right" }}>Peers</th>
                <th style={{ textAlign: "right" }}>Bytes</th>
                <th style={{ textAlign: "right" }}>Flows</th>
                <th style={{ textAlign: "right" }}>Days seen</th>
                <th style={{ textAlign: "right" }}>Monitored IPs</th>
                <th>Candidate</th>
              </tr>
            </thead>
            <tbody>
              {data.topAsns.map((a) => {
                const candidate = a.peer_asn !== null ? candidateByAsn.get(a.peer_asn) : undefined;
                return (
                  <tr key={a.peer_asn ?? "none"}>
                    <td className="mono">{a.peer_asn !== null ? `AS${a.peer_asn}` : <span style={{ color: "#6FA89E" }}>no ASN in the feed</span>}</td>
                    <td className="mono" style={{ color: "#A6D8CD" }}>{a.peer_country ?? "—"}</td>
                    <td className="num mono" style={{ textAlign: "right" }}>{a.peers.toLocaleString()}</td>
                    <td className="num mono" style={{ textAlign: "right" }}>{formatBytes(a.bytes_sum)}</td>
                    <td className="num mono" style={{ textAlign: "right" }}>{a.flow_count.toLocaleString()}</td>
                    <td className="num mono" style={{ textAlign: "right" }}>{a.days_seen}</td>
                    <td className="num mono" style={{ textAlign: "right" }}>{a.watched_ips}</td>
                    <td style={{ color: candidate ? undefined : "#6FA89E" }}>
                      {candidate ? (
                        <Link to="/candidates">
                          {candidate.suggested_category} · {candidate.status}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
              {data.topAsns.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ color: "#6FA89E" }}>
                    No ASNs in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="note">
            ASN and country are the feed's own values for the peer (netflow-rollups carries{" "}
            <span className="mono">peer_asn</span> / <span className="mono">peer_country</span> since
            its migration 0083); peers the feed gave no ASN are one row. Mode country per ASN.
          </div>
        </div>
      )}

      {data && view === "uncl" && (
        <div className="card">
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
            <thead>
              <tr>
                <th>Peer IP</th>
                <th style={{ textAlign: "right" }}>Monitored IPs touched</th>
                <th style={{ textAlign: "right" }}>Bytes</th>
                <th style={{ textAlign: "right" }}>Flows</th>
                <th style={{ textAlign: "right" }}>Days seen</th>
                <th>Last</th>
                <th>Candidate</th>
              </tr>
            </thead>
            <tbody>
              {sortedUncl.map(([peerIp, e]) => {
                const asnOfThisPeer = asnOfPeer.get(peerIp);
                const byPeer = candidateByPeer.get(peerIp);
                const candidate = byPeer ?? (asnOfThisPeer !== undefined ? candidateByAsn.get(asnOfThisPeer) : undefined);
                return (
                  <tr key={peerIp}>
                    <td>
                      <Link to={`/entity/${peerIp}`} className="mono row-link">
                        {peerIp}
                      </Link>
                    </td>
                    <td className="num mono" style={{ textAlign: "right" }}>
                      {e.monitoredIps.size}
                    </td>
                    <td className="num mono" style={{ textAlign: "right" }}>
                      {formatBytes(e.bytes)}
                    </td>
                    <td className="num mono" style={{ textAlign: "right" }}>
                      {e.flows.toLocaleString()}
                    </td>
                    <td className="num mono" style={{ textAlign: "right" }}>
                      {e.days.size} / 7
                    </td>
                    <td className="mono" style={{ color: "#A6D8CD" }}>
                      {e.lastDay}
                    </td>
                    <td style={{ color: candidate ? undefined : "#6FA89E" }}>
                      {candidate ? (
                        <Link to="/candidates">
                          AS{candidate.asn} · {candidate.status}
                          {!byPeer && " (via ASN)"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
              {sortedUncl.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: "#6FA89E" }}>
                    No unclassified peers in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="note">
            Candidate column matches this peer against{" "}
            <span className="mono">review__asn_candidates.triggering_peer_ip</span> first, then by
            its ASN (<span className="mono">peer_asn</span> on the rollup row) — "(via ASN)" marks a
            peer that shares an ASN with a candidate without being the peer that triggered it.
          </div>
        </div>
      )}
    </>
  );
}
