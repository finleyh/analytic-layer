import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getIpIdentityLookupIpIdentitiesIpGet,
  getIpRolesReviewIpRolesIpGet,
  getIpRelationsReviewIpRelationsIpGet,
  listHostScansLookupHostScansGet,
  type HostScan,
  type IpIdentity,
  type IpRelation,
  type IpRole,
} from "../api/netflow-rollups-client";
import { CopyButton } from "./CopyButton";
import { FingerprintHistory } from "./FingerprintHistory";
import { IpReviewHistory } from "./IpReviewHistory";
import { ScannerVerdicts } from "./ScannerVerdicts";
import { WindowSelect, windowRange, type WindowKey } from "./WindowSelect";
import { errorMessage } from "../lib/errors";

// The entity page for an IP that is not on the watchlist -- a peer. Top talkers and the
// relationship cards link peers here; the watched-IP page needs a /watch/ips row and
// failed outright for them. What netflow-rollups knows about a peer: its identity, the
// roles and relationships suggested or decided for it, any scanner verdict, its port
// scans (only if a rule recommended it for one), and the full decision history.

const chipStyle = (status: string) =>
  status === "confirmed" ? "chip rev" : status === "rejected" ? "chip" : "chip pend";

export function PeerEntity({ ip }: { ip: string }) {
  const [identity, setIdentity] = useState<IpIdentity | null | undefined>(undefined);
  const [roles, setRoles] = useState<IpRole[] | null>(null);
  const [relations, setRelations] = useState<IpRelation[] | null>(null);
  const [scans, setScans] = useState<HostScan[] | null>(null);
  const [scanWindow, setScanWindow] = useState<WindowKey>("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getIpIdentityLookupIpIdentitiesIpGet({ path: { ip }, throwOnError: true })
      .then((r) => !cancelled && setIdentity(r.data))
      .catch(() => !cancelled && setIdentity(null));
    getIpRolesReviewIpRolesIpGet({ path: { ip }, throwOnError: true })
      .then((r) => !cancelled && setRoles(r.data.rows))
      .catch(() => !cancelled && setRoles([]));
    getIpRelationsReviewIpRelationsIpGet({ path: { ip }, throwOnError: true })
      .then((r) => !cancelled && setRelations(r.data.rows))
      .catch(() => !cancelled && setRelations([]));
    return () => {
      cancelled = true;
    };
  }, [ip]);

  useEffect(() => {
    let cancelled = false;
    const { from, to } = windowRange(scanWindow);
    listHostScansLookupHostScansGet({ query: { ip, from, to, limit: 1000 }, throwOnError: true })
      .then((r) => !cancelled && setScans(r.data.rows))
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [ip, scanWindow]);

  return (
    <>
      <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 10 }}>
        <Link to="/watchlist">Watchlist</Link> / Peer
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6, flexWrap: "wrap" }}>
        <h1 className="mono" style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
          {ip}
        </h1>
        <CopyButton text={ip} label="Copy IP address" />
        <span className="chip">not on the watchlist · a peer</span>
      </div>
      <div style={{ fontSize: 13, color: "#6FA89E", marginBottom: 22 }}>
        {identity === undefined
          ? "Loading…"
          : identity
            ? `${identity.asn ? `AS${identity.asn}` : "no ASN"} ${identity.asn_holder ?? ""}${identity.country ? ` · ${identity.country}` : ""}${identity.rdns ? ` · ${identity.rdns}` : ""}`
            : "No identity lookup has been made for this IP."}
      </div>

      {identity && (identity.provider_categories.length > 0 || identity.scanner_tiers.length > 0 || identity.peeringdb_name) && (
        <div className="card" style={{ padding: "16px 22px", marginBottom: 24, fontSize: 13 }}>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            {identity.provider_categories.length > 0 && (
              <div>
                <span style={{ color: "#6FA89E", fontSize: 11, textTransform: "uppercase" }}>Provider categories </span>
                {identity.provider_categories.join(", ")}
              </div>
            )}
            {identity.peeringdb_name && (
              <div>
                <span style={{ color: "#6FA89E", fontSize: 11, textTransform: "uppercase" }}>PeeringDB </span>
                {identity.peeringdb_name}
                {identity.peeringdb_info_type ? ` · ${identity.peeringdb_info_type}` : ""}
              </div>
            )}
            <div>
              <span style={{ color: "#6FA89E", fontSize: 11, textTransform: "uppercase" }}>Scanner tiers </span>
              {identity.scanner_tiers.length > 0 ? identity.scanner_tiers.join(", ") : "none"}
            </div>
            <div style={{ color: "#6FA89E" }}>looked up {identity.looked_up_at.slice(0, 10)}</div>
          </div>
        </div>
      )}

      <ScannerVerdicts ip={ip} showWhenEmpty tiers={identity?.scanner_tiers ?? []} />

      <div className="card" style={{ padding: "22px 24px", marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Roles and relationships</div>
          <span className="src">/review/ip-roles/{"{ip}"} · /review/ip-relations/{"{ip}"}</span>
        </div>
        {(roles === null || relations === null) && <div style={{ color: "#6FA89E" }}>Loading…</div>}
        {roles && relations && roles.length === 0 && relations.length === 0 && (
          <div style={{ color: "#6FA89E", fontSize: 13 }}>No role or relationship has been suggested for this IP.</div>
        )}
        {roles && roles.map((r) => (
          <div key={`role-${r.role}-${r.vantage}`} style={{ padding: "8px 0", borderBottom: "1px solid #133A3C", fontSize: 13 }}>
            <span className={chipStyle(r.status)}>{r.role}</span> <span style={{ color: "#6FA89E" }}>role · {r.vantage} vantage · {r.status}</span>
            {r.decided_at && <span style={{ color: "#6FA89E" }}> · decided {r.decided_at.slice(0, 10)}</span>}
          </div>
        ))}
        {relations && relations.map((r) => (
          <div key={`rel-${r.relation}-${r.other_ip}`} style={{ padding: "8px 0", borderBottom: "1px solid #133A3C", fontSize: 13 }}>
            <span className={chipStyle(r.status)}>{r.relation}</span> <span style={{ color: "#6FA89E" }}>of</span>{" "}
            <Link to={`/entity/${r.other_ip}`} className="mono row-link">
              {r.other_ip}
            </Link>
            <span style={{ color: "#6FA89E" }}> · {r.status}</span>
            {r.decided_at && <span style={{ color: "#6FA89E" }}> · decided {r.decided_at.slice(0, 10)}</span>}
          </div>
        ))}
        {relations && relations.some((r) => r.status === "suggested" || r.status === "agentic_evaluation") && (
          <div className="note">
            Pending ones are reviewed in <Link to="/candidates">Candidates</Link> → Peer relationships.
          </div>
        )}
      </div>

      <div className="card" style={{ padding: "22px 24px", marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Port scans</div>
          <WindowSelect value={scanWindow} onChange={setScanWindow} label="History" />
        </div>
        {error && <div style={{ color: "#E5484D", fontSize: 13 }}>Failed to load scans: {error}</div>}
        {!scans && !error && <div style={{ color: "#6FA89E" }}>Loading…</div>}
        {scans && scans.length === 0 && (
          <div style={{ color: "#6FA89E", fontSize: 13 }}>
            No port scan of this peer. netflow-rollups scans a peer only after a rule recommends it.
          </div>
        )}
        {scans && scans.length > 0 && <FingerprintHistory ip={ip} scans={scans} />}
      </div>

      <IpReviewHistory ip={ip} />
    </>
  );
}
