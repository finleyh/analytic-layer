import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { listHostScansLookupHostScansGet, type HostScan } from "../api/netflow-rollups-client";
import { diffFacts, factLabel, foldRuns, type Fact, type FingerprintRun } from "../lib/fingerprints";
import { hueOf } from "../lib/colors";
import { errorMessage } from "../lib/errors";

// A port-scan fingerprint timeline for one IP: per source, the runs of consecutive
// scans that carried the same fingerprint hash. Hover a chip for the services that
// hash stood for; click it for the full facts, what changed against the run before
// it, and (on request) the source's raw record.

const short = (hash: string) => hash.slice(0, 6);
const md = (day: string) => day.slice(5);

export function runKey(r: FingerprintRun) {
  return `${r.source}|${r.hash}|${r.firstDay}`;
}

function chipColors(hash: string) {
  const hue = hueOf(`fp:${hash}`);
  return { bg: `hsl(${hue}, 45%, 14%)`, border: `hsl(${hue}, 60%, 48%)`, color: `hsl(${hue}, 70%, 78%)` };
}

function FactsTable({ facts }: { facts: Fact[] }) {
  if (facts.length === 0) return <div style={{ fontSize: 12, color: "#6FA89E" }}>No open services in this scan.</div>;
  const cell = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr>
          <th>Port</th>
          <th>Service</th>
          <th>Software</th>
          <th>HTTP title</th>
          <th>Favicon hash</th>
          <th>TLS fingerprint</th>
        </tr>
      </thead>
      <tbody>
        {facts.map((f, i) => (
          <tr key={i}>
            <td className="mono">
              {cell(f.port)}/{cell(f.transport_protocol)}
            </td>
            <td className="mono">{cell(f.service_protocol)}</td>
            <td className="mono">
              {cell(f.software_name)}
              {f.software_version ? ` ${f.software_version}` : ""}
            </td>
            <td style={{ overflowWrap: "anywhere" }}>{cell(f.http_title)}</td>
            <td className="mono">{cell(f.favicon_hash)}</td>
            <td className="mono" title={f.tls_fingerprint ? String(f.tls_fingerprint) : undefined}>
              {f.tls_fingerprint ? String(f.tls_fingerprint).slice(0, 16) + "…" : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FingerprintHistory({
  ip,
  scans,
  entityLink = false,
  compact = false,
  selected: selectedProp,
  onSelect,
}: {
  ip: string;
  scans: HostScan[];
  /** Show a link to the entity page in the detail panel (the Watchlist does; the entity page itself does not). */
  entityLink?: boolean;
  /** Table-cell form: only each source's latest run as a chip (hover works; click calls `onSelect`, no panel). */
  compact?: boolean;
  /** Controlled selection (a run key); omit to let the component keep its own. */
  selected?: string | null;
  onSelect?: (key: string | null) => void;
}) {
  const runsBySource = useMemo(() => foldRuns(scans), [scans]);
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const selected = selectedProp !== undefined ? selectedProp : selectedState;
  const setSelected = (key: string | null) => (onSelect ? onSelect(key) : setSelectedState(key));
  const [hover, setHover] = useState<{ run: FingerprintRun; left: number; top: number } | null>(null);
  const [raw, setRaw] = useState<{ key: string; json: string | null; error?: string } | null>(null);

  const allRuns = [...runsBySource.values()].flat();
  const selectedRun = allRuns.find((r) => runKey(r) === selected) ?? null;
  const previousRun = selectedRun
    ? (() => {
        const list = runsBySource.get(selectedRun.source) ?? [];
        const i = list.findIndex((r) => runKey(r) === runKey(selectedRun));
        return i > 0 ? list[i - 1] : null;
      })()
    : null;

  async function loadRaw(run: FingerprintRun) {
    const key = runKey(run);
    setRaw({ key, json: null });
    try {
      // The route has no per-scan lookup; ask for the source's scans of that day with raw=true and pick the row.
      const day = run.lastScanTime.slice(0, 10);
      const result = await listHostScansLookupHostScansGet({
        query: { ip, source: run.source, from: day, to: day, raw: true, limit: 200 },
        throwOnError: true,
      });
      const row = result.data.rows.find((r) => r.id === run.lastScanId);
      setRaw({ key, json: row?.raw_response ? JSON.stringify(row.raw_response, null, 2) : null, error: row ? undefined : "that scan was not returned" });
    } catch (err) {
      setRaw({ key, json: null, error: errorMessage(err) });
    }
  }

  if (runsBySource.size === 0) {
    return <div style={{ fontSize: 12, color: "#6FA89E" }}>No port scans in this window.</div>;
  }
  const hiddenEarlier = (runs: FingerprintRun[]) => (compact ? runs.length - 1 : 0);

  return (
    <div>
      {[...runsBySource.entries()].map(([source, runs]) => (
        <div key={source} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: compact ? 4 : 8 }}>
          <span className="mono" style={{ width: compact ? 48 : 54, fontSize: compact ? 11 : 12, color: "#A6D8CD" }}>
            {source}
          </span>
          {(compact ? runs.slice(-1) : runs).map((r, i) => {
            const c = chipColors(r.hash);
            const isSelected = selected === runKey(r);
            const isCurrent = i === runs.length - 1;
            return (
              <span key={runKey(r)} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {i > 0 && !compact && <span style={{ color: "#6FA89E" }}>→</span>}
                <button
                  className="mono"
                  onClick={() => setSelected(isSelected ? null : runKey(r))}
                  onMouseEnter={(e) => {
                    const b = e.currentTarget.getBoundingClientRect();
                    setHover({ run: r, left: Math.min(b.left, window.innerWidth - 360), top: b.bottom + 6 });
                  }}
                  onMouseLeave={() => setHover(null)}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    fontSize: 11,
                    padding: "4px 9px",
                    borderRadius: 6,
                    background: c.bg,
                    color: c.color,
                    border: `1px solid ${isSelected ? "#E8FFF8" : c.border}`,
                    boxShadow: isCurrent ? `0 0 0 1px ${c.border}` : undefined,
                    whiteSpace: "nowrap",
                  }}
                >
                  {compact
                    ? `${short(r.hash)} · ${r.facts.length} svc`
                    : `${short(r.hash)} · ${r.firstDay === r.lastDay ? md(r.firstDay) : `${md(r.firstDay)} → ${md(r.lastDay)}`} · ${r.facts.length} svc${r.scans > 1 ? ` · ${r.scans}×` : ""}`}
                </button>
              </span>
            );
          })}
          {hiddenEarlier(runs) > 0 && (
            <span style={{ fontSize: 11, color: "#6FA89E" }}>+{hiddenEarlier(runs)} earlier</span>
          )}
        </div>
      ))}

      {/* Portalled to <body>: .card has a backdrop-filter, which would otherwise make it the
          containing block for this fixed tooltip and clip it inside the card's overflow. */}
      {hover && createPortal(
        <div
          style={{
            position: "fixed",
            left: hover.left,
            top: hover.top,
            zIndex: 50,
            width: 340,
            background: "#0A2224",
            border: "1px solid #3F9C8A",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 12,
            pointerEvents: "none",
            boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ color: "#A6D8CD", marginBottom: 6 }}>
            <span className="mono">{hover.run.source}</span> · hash <span className="mono">{short(hover.run.hash)}</span> ·{" "}
            {hover.run.firstDay} → {hover.run.lastDay} · {hover.run.scans} scan{hover.run.scans === 1 ? "" : "s"}
          </div>
          {hover.run.facts.length === 0 ? (
            <div style={{ color: "#6FA89E" }}>no open services</div>
          ) : (
            hover.run.facts.map((f, i) => (
              <div key={i} className="mono" style={{ fontSize: 11, overflowWrap: "anywhere" }}>
                {factLabel(f)}
                {f.http_title ? ` — “${String(f.http_title).slice(0, 40)}”` : ""}
              </div>
            ))
          )}
          <div style={{ color: "#6FA89E", marginTop: 6 }}>click for the full facts and what changed</div>
        </div>,
        document.body,
      )}

      {selectedRun && !compact && (
        <div style={{ marginTop: 10, background: "#0A2224", border: "1px solid #133A3C", borderRadius: 8, padding: "12px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={{ fontSize: 13 }}>
              <span className="mono">{selectedRun.source}</span> · fingerprint{" "}
              <span className="mono" title={selectedRun.hash}>
                {selectedRun.hash.slice(0, 12)}
              </span>{" "}
              · {selectedRun.firstDay} → {selectedRun.lastDay} · {selectedRun.scans} scan{selectedRun.scans === 1 ? "" : "s"}
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
              {entityLink && <Link to={`/entity/${ip}`}>Entity page →</Link>}
              <button
                onClick={() => (raw?.key === runKey(selectedRun) ? setRaw(null) : void loadRaw(selectedRun))}
                style={{ all: "unset", cursor: "pointer", color: "#4C8DFF" }}
              >
                {raw?.key === runKey(selectedRun) ? "Hide raw record" : "Show raw record"}
              </button>
            </div>
          </div>

          <FactsTable facts={selectedRun.facts} />

          {previousRun ? (
            (() => {
              const { added, removed } = diffFacts(previousRun.facts, selectedRun.facts);
              return (
                <div style={{ marginTop: 10, fontSize: 12 }}>
                  <div style={{ color: "#A6D8CD", marginBottom: 4 }}>
                    Against the previous run ({short(previousRun.hash)}, {previousRun.firstDay} → {previousRun.lastDay}):
                  </div>
                  {removed.map((f, i) => (
                    <div key={`r${i}`} className="mono">
                      <span style={{ color: "#E5484D", fontWeight: 700 }}>−</span> {factLabel(f)}
                    </div>
                  ))}
                  {added.map((f, i) => (
                    <div key={`a${i}`} className="mono">
                      <span style={{ color: "#3DD68C", fontWeight: 700 }}>+</span> {factLabel(f)}
                    </div>
                  ))}
                  {added.length === 0 && removed.length === 0 && (
                    <div style={{ color: "#6FA89E" }}>
                      No service appeared or disappeared; the hash moved on a field inside a service (version, title, TLS).
                    </div>
                  )}
                </div>
              );
            })()
          ) : (
            <div style={{ marginTop: 10, fontSize: 12, color: "#6FA89E" }}>First fingerprint seen for this source in the window.</div>
          )}

          {raw?.key === runKey(selectedRun) && (
            <pre
              className="mono"
              style={{ marginTop: 10, maxHeight: 280, overflow: "auto", fontSize: 11, background: "#06181A", padding: 10, borderRadius: 6 }}
            >
              {raw.error ? `Could not load: ${raw.error}` : raw.json ?? "Loading…"}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
