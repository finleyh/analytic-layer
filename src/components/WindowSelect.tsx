import { daysAgo, isoDate } from "../lib/format";

// The history windows the Watchlist and the entity page offer for port-scan and
// traffic data. netflow-rollups' routes default to six days back, which is what
// the pages used to show; `lookup__host_scans` is append-only with no retention
// and the rollups keep 180 days, so a longer window is just a different `from`.
export const WINDOWS = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "all", label: "All history", days: null },
] as const;
export type WindowKey = (typeof WINDOWS)[number]["key"];

/** Inclusive UTC day range for a window; "all history" starts well before any data. */
export function windowRange(key: WindowKey): { from: string; to: string; days: number | null; label: string } {
  const w = WINDOWS.find((x) => x.key === key)!;
  return {
    from: w.days === null ? "2020-01-01" : isoDate(daysAgo(w.days - 1)),
    to: isoDate(new Date()),
    days: w.days,
    label: w.days === null ? "all history" : `${w.days}d`,
  };
}

export function WindowSelect({
  value,
  onChange,
  label = "Window",
  keys,
}: {
  value: WindowKey;
  onChange: (k: WindowKey) => void;
  label?: string;
  /** The windows to offer; default all four. The hourly heatmap leaves out "all". */
  keys?: readonly WindowKey[];
}) {
  const windows = keys ? WINDOWS.filter((w) => keys.includes(w.key)) : WINDOWS;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>{label}</span>
      <div style={{ display: "inline-flex" }}>
        {windows.map((w, i) => (
          <button
            key={w.key}
            onClick={() => onChange(w.key)}
            style={{
              all: "unset",
              cursor: "pointer",
              fontSize: 12,
              padding: "5px 12px",
              color: value === w.key ? "#E8FFF8" : "#A6D8CD",
              background: value === w.key ? "#133A3C" : "transparent",
              borderStyle: "solid",
              borderColor: value === w.key ? "#3F9C8A" : "#2B7266",
              borderWidth: i === 0 ? "1px" : "1px 1px 1px 0",
              borderRadius: i === 0 ? "6px 0 0 6px" : i === windows.length - 1 ? "0 6px 6px 0" : 0,
            }}
          >
            {w.label}
          </button>
        ))}
      </div>
    </div>
  );
}
