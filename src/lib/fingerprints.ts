// Port-scan fingerprint helpers shared by the Watchlist and the entity page.
//
// A scan row (`/lookup/host-scans`) carries `fingerprint_hash`, a digest of the
// *extracted* facts (port, transport, service protocol, software name and
// version -- banner text and scan time are excluded on purpose, so a changed
// hash is a real service change) and the facts themselves in
// `fingerprint_facts`. There is no per-hash route: "what was the port-scan
// data for this hash" is the facts of the scans that carried it, so the scans
// are folded here into runs of consecutive scans (per source) with one hash.
import type { HostScan } from "../api/netflow-rollups-client";

export type Fact = Record<string, unknown>;

export function factLabel(fact: Fact): string {
  const parts = [`${fact.port}/${fact.transport_protocol}`];
  if (fact.service_protocol) parts.push(String(fact.service_protocol));
  if (fact.software_name) parts.push(`${fact.software_name}${fact.software_version ? " " + fact.software_version : ""}`);
  return parts.join(" · ");
}

export function factKey(fact: Fact): string {
  return `${fact.port}/${fact.transport_protocol}`;
}

export function dayOf(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/** What appeared and disappeared between two scans' facts, keyed by port/transport. */
export function diffFacts(from: Fact[], to: Fact[]): { added: Fact[]; removed: Fact[] } {
  const fromMap = new Map(from.map((f) => [factKey(f), f]));
  const toMap = new Map(to.map((f) => [factKey(f), f]));
  return {
    removed: [...fromMap.keys()].filter((k) => !toMap.has(k)).map((k) => fromMap.get(k)!),
    added: [...toMap.keys()].filter((k) => !fromMap.has(k)).map((k) => toMap.get(k)!),
  };
}

/** Consecutive scans of one source that carried the same fingerprint hash. */
export type FingerprintRun = {
  source: string;
  hash: string;
  firstDay: string;
  lastDay: string;
  firstScanTime: string;
  lastScanTime: string;
  scans: number;
  /** The facts of the run's latest scan (identical across the run by construction of the hash). */
  facts: Fact[];
  /** The latest scan's id, for a raw-record fetch. */
  lastScanId: number;
};

/** Scans folded into runs, per source, oldest first. A hash that returns later is a new run. */
export function foldRuns(scans: HostScan[]): Map<string, FingerprintRun[]> {
  const bySource = new Map<string, HostScan[]>();
  for (const s of scans) {
    if (!s.scan_time) continue;
    const list = bySource.get(s.source) ?? [];
    list.push(s);
    bySource.set(s.source, list);
  }
  const out = new Map<string, FingerprintRun[]>();
  for (const [source, list] of bySource) {
    list.sort((a, b) => (a.scan_time as string).localeCompare(b.scan_time as string));
    const runs: FingerprintRun[] = [];
    for (const s of list) {
      const last = runs[runs.length - 1];
      const day = dayOf(s.scan_time)!;
      if (last && last.hash === s.fingerprint_hash) {
        last.lastDay = day;
        last.lastScanTime = s.scan_time as string;
        last.scans += 1;
        last.facts = s.fingerprint_facts as Fact[];
        last.lastScanId = s.id;
      } else {
        runs.push({
          source,
          hash: s.fingerprint_hash,
          firstDay: day,
          lastDay: day,
          firstScanTime: s.scan_time as string,
          lastScanTime: s.scan_time as string,
          scans: 1,
          facts: s.fingerprint_facts as Fact[],
          lastScanId: s.id,
        });
      }
    }
    out.set(source, runs);
  }
  return out;
}

export type GridCell = { day: string; status: "first" | "same" | "changed" | "miss"; scan?: HostScan };
export type Transition = { source: string; fromDay: string; toDay: string; fromScan: HostScan; toScan: HostScan };

/** One cell per day per source (the day's latest scan), plus the hash transitions between days.
 *  `maxDays` keeps only the newest N days of the grid; undefined keeps them all. */
export function buildFingerprintGrid(scans: HostScan[], maxDays?: number) {
  const allDays = [...new Set(scans.map((s) => dayOf(s.scan_time)).filter((d): d is string => d !== null))].sort();
  const gridDays = maxDays === undefined ? allDays : allDays.slice(-maxDays);

  const scanByDaySource = new Map<string, Map<string, HostScan>>();
  for (const s of scans) {
    const day = dayOf(s.scan_time);
    if (!day) continue;
    const bySource = scanByDaySource.get(s.source) ?? new Map<string, HostScan>();
    const existing = bySource.get(day);
    if (!existing || (s.scan_time ?? "") > (existing.scan_time ?? "")) bySource.set(day, s);
    scanByDaySource.set(s.source, bySource);
  }

  const gridBySource = new Map<string, GridCell[]>();
  const transitions: Transition[] = [];
  for (const [source, bySource] of scanByDaySource) {
    let lastHash: string | null = null;
    let lastDay: string | null = null;
    let lastScan: HostScan | null = null;
    const cells: GridCell[] = [];
    for (const day of gridDays) {
      const scan = bySource.get(day);
      if (!scan) {
        cells.push({ day, status: "miss" });
        continue;
      }
      if (lastHash === null) {
        cells.push({ day, status: "first", scan });
      } else if (scan.fingerprint_hash === lastHash) {
        cells.push({ day, status: "same", scan });
      } else {
        cells.push({ day, status: "changed", scan });
        transitions.push({ source, fromDay: lastDay!, toDay: day, fromScan: lastScan!, toScan: scan });
      }
      lastHash = scan.fingerprint_hash;
      lastDay = day;
      lastScan = scan;
    }
    gridBySource.set(source, cells);
  }
  return { gridDays, gridBySource, transitions };
}
