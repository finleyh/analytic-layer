import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getIpRoleHistoryReviewIpRolesIpHistoryGet,
  getIpRelationHistoryReviewIpRelationsIpHistoryGet,
  type RoleHistoryEntry,
} from "../api/netflow-rollups-client";
import { errorMessage } from "../lib/errors";

// Every event on an IP's roles and relations, oldest first: a rule suggesting, the agent
// evaluating, a human confirming or rejecting. "What did we believe about this IP on date
// X" is the latest entry up to X. netflow-rollups answers 404 when an IP has no history,
// which here just means an empty list. Entries marked `seeded` were rebuilt on
// 2026-10-28 from what the rows still showed; earlier history had been overwritten.

async function load(fn: () => Promise<{ data: { rows: RoleHistoryEntry[] } }>): Promise<RoleHistoryEntry[]> {
  try {
    return (await fn()).data.rows;
  } catch (err) {
    if (typeof err === "object" && err !== null && "detail" in err && /no decision history/.test(String((err as { detail: unknown }).detail))) return [];
    throw err;
  }
}

const DECISION_COLOR: Record<string, string> = {
  confirmed: "#3DD68C",
  asserted: "#3DD68C",
  holds: "#3DD68C",
  rejected: "#E5484D",
  doubted: "#F5A623",
  withdrawn: "#6FA89E",
};

export function IpReviewHistory({ ip }: { ip: string }) {
  const [rows, setRows] = useState<RoleHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    Promise.all([
      load(() => getIpRoleHistoryReviewIpRolesIpHistoryGet({ path: { ip }, throwOnError: true })),
      load(() => getIpRelationHistoryReviewIpRelationsIpHistoryGet({ path: { ip }, throwOnError: true })),
    ])
      .then(([roles, relations]) => {
        if (cancelled) return;
        setRows([...roles, ...relations].sort((a, b) => a.at.localeCompare(b.at)));
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ip]);

  return (
    <div className="card" style={{ padding: "22px 24px", marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Review history — roles and relationships</div>
        <span className="src">/review/ip-roles/{"{ip}"}/history · /review/ip-relations/{"{ip}"}/history</span>
      </div>
      {error && <div style={{ color: "#E5484D", fontSize: 13 }}>Failed to load: {error}</div>}
      {!rows && !error && <div style={{ color: "#6FA89E" }}>Loading…</div>}
      {rows && rows.length === 0 && <div style={{ color: "#6FA89E", fontSize: 13 }}>No role or relationship has ever been suggested for this IP.</div>}
      {rows && rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>Event</th>
                <th>Status after</th>
                <th>By</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.subject_kind}-${r.id}`}>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>{r.at.slice(0, 16).replace("T", " ")}</td>
                  <td>
                    <span className="mono">{r.name}</span>
                    {r.other_ip && (
                      <>
                        {" "}
                        <span style={{ color: "#6FA89E" }}>of</span>{" "}
                        <Link to={`/entity/${r.other_ip}`} className="mono row-link">
                          {r.other_ip}
                        </Link>
                      </>
                    )}
                  </td>
                  <td style={{ color: DECISION_COLOR[r.decision] }}>
                    {r.decision}
                    {r.replaced_by && r.replaced_by.length > 0 && (
                      <div style={{ fontSize: 11, color: "#6FA89E" }}>
                        rejected in favour of{" "}
                        {r.replaced_by.map((name, i) => (
                          <span key={name}>
                            {i > 0 && ", "}
                            <span className="mono">{name}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>{r.status_after ?? "—"}</td>
                  <td style={{ maxWidth: 260, overflowWrap: "anywhere", color: "#A6D8CD" }} title={r.decided_by}>
                    {r.decided_by.length > 48 ? r.decided_by.slice(0, 48) + "…" : r.decided_by}
                    {r.seeded && (
                      <span style={{ color: "#6FA89E" }} title="rebuilt on 2026-10-28 from what the row still showed; earlier history had been overwritten">
                        {" "}
                        · seeded
                      </span>
                    )}
                  </td>
                  <td style={{ maxWidth: 260, overflowWrap: "anywhere" }}>{r.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
