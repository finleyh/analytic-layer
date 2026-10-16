import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  topPeersRollupFlowDailyTopPeersGet,
  unclassifiedContactsDailyRollupUnclassifiedContactsDailyGet,
  listAsnCandidatesReviewAsnCandidatesGet,
  type TopPeer,
  type DailyUnclassifiedContact,
  type AsnCandidate,
} from "../api/netflow-rollups-client";
import { formatBytes } from "../lib/format";
import { categoryColors } from "../lib/categories";

type View = "ip" | "asn" | "uncl";

type TalkersData = {
  topPeers: TopPeer[];
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
        const [topPeers, unclassified, asnCandidates] = await Promise.all([
          topPeersRollupFlowDailyTopPeersGet({
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
          unclassified: unclassified.data.rows,
          asnCandidates: asnCandidates.data.rows,
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
      e.monitoredIps.add(r.monitored_ip);
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
  const sortedUncl = [...unclByPeer.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 30);
  const totalUnclBytes = [...unclByPeer.values()].reduce((s, e) => s + e.bytes, 0);

  const SUBTITLES: Record<View, React.ReactNode> = {
    ip: (
      <>
        port_family = rtp_media · tagged peers excluded · <span className="mono">rollup__flow_daily/top-peers</span>
      </>
    ),
    asn: (
      <>
        port_family = rtp_media · tagged peers excluded ·{" "}
        <span style={{ color: "#F5A623" }}>needs ASN on a rollup — see note</span>
      </>
    ),
    uncl: (
      <>
        all port families · peer_categories = {"{}"} and no accepted role · {unclByPeer.size} peers /{" "}
        {formatBytes(totalUnclBytes)} in 7d · <span className="mono">rollup__unclassified_contacts_daily</span>
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
            Category comes from <span className="mono">rollup__flow_daily</span>, not the mix view
            — it's the only place a multi-flag peer (<span className="mono">cloud+bph</span>) shows
            both.
          </div>
        </div>
      )}

      {data && view === "asn" && (
        <div className="card">
          <div style={{ padding: "16px 20px 0 20px" }}>
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                fontSize: 12,
                lineHeight: 1.5,
                color: "#C6EBE2",
                background: "#241A0F",
                border: "1px solid #5A4423",
                borderRadius: 8,
                padding: "12px 14px",
                marginBottom: 16,
              }}
            >
              <span>⚠</span>
              <span>
                <b style={{ color: "#F5A623" }}>Blocked by the data, not the UI.</b> No rollup view
                carries ASN — <span className="mono">rollup__flow_hourly</span>'s GROUP BY has no{" "}
                <span className="mono">peer_asn</span>. Same blocker hits the Flow graph's ASN
                cluster and this page's Candidate column, below. Waiting on an upstream column
                before this view can show real rows.
              </span>
            </div>
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
                const candidate = candidateByPeer.get(peerIp);
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
            Candidate column matches this exact peer against{" "}
            <span className="mono">review__asn_candidates.triggering_peer_ip</span> — it isn't an
            ASN-grouped match (no rollup carries ASN yet), so a peer sharing an ASN with a
            candidate but not the one that triggered it still shows "—".
          </div>
        </div>
      )}
    </>
  );
}
