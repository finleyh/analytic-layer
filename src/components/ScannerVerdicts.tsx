import { useEffect, useState } from "react";
import { listScannersVerdictScannersGet, type ScannerVerdict } from "../api/netflow-rollups-client";
import { errorMessage } from "../lib/errors";
import { isoDate } from "../lib/format";

// Why is this IP's traffic hidden? netflow-rollups keeps a scanner verdict for 180 days and
// hides the IP's traffic on the verdict's day and the 30 after (a verdict on day D covers
// D to D+30); an IP on a third-party feed list or the curated list is hidden on every day,
// and those lists are not served by the API, so only the verdicts are shown here.
const HIDES_DAYS = 30;

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

export function ScannerVerdicts({
  ip,
  showWhenEmpty = false,
  tiers = [],
}: {
  ip: string;
  showWhenEmpty?: boolean;
  /** `scanner_tiers` from /lookup/ip-identities: "feed" and "curated" mean a list hides this IP on every day. */
  tiers?: string[];
}) {
  const [rows, setRows] = useState<ScannerVerdict[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    listScannersVerdictScannersGet({ query: { ip, from: "2020-01-01", limit: 1000 }, throwOnError: true })
      .then((r) => {
        if (!cancelled) setRows(r.data.rows);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ip]);

  const onList = tiers.filter((t) => t === "feed" || t === "curated");
  if (!showWhenEmpty && onList.length === 0 && rows && rows.length === 0) return null;
  const today = isoDate(new Date());

  return (
    <div className="card" style={{ padding: "22px 24px", marginBottom: 24, borderColor: (rows && rows.length > 0) || onList.length > 0 ? "#5A4423" : undefined }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Scanner verdicts</div>
        <span className="src">/verdict/scanners · kept 180 days</span>
      </div>
      {onList.length > 0 && (
        <div style={{ fontSize: 13, color: "#F5A623", marginBottom: 10 }}>
          On the {onList.join(" and ")} scanner list — all of this IP's traffic is hidden, on every day.
        </div>
      )}
      {error && <div style={{ color: "#E5484D", fontSize: 13 }}>Failed to load: {error}</div>}
      {!rows && !error && <div style={{ color: "#6FA89E" }}>Loading…</div>}
      {rows && rows.length === 0 && <div style={{ color: "#6FA89E", fontSize: 13 }}>No scanner verdict for this IP in the last 180 days.</div>}
      {rows && rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th>Verdict day</th>
              <th>Rule</th>
              <th>Hides its traffic</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const day = r.calculated_at.slice(0, 10);
              const end = addDays(day, HIDES_DAYS);
              const active = day <= today && today < end;
              return (
                <tr key={`${r.calculated_at}-${r.rule_name}`}>
                  <td className="mono">{day}</td>
                  <td className="mono">{r.rule_name}</td>
                  <td style={{ whiteSpace: "nowrap", color: active ? "#F5A623" : "#6FA89E" }}>
                    {day} → {end}
                    {active ? " · now" : ""}
                  </td>
                  <td style={{ overflowWrap: "anywhere" }}>{r.reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="note">
        A verdict on day D hides this IP's traffic on days D to D+30 in every rollup read; an IP on a feed or curated scanner
        list is hidden on every day (the identity's scanner tiers say whether it is on one).
      </div>
    </div>
  );
}
