import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { listHostScansLookupHostScansGet, listIpsWatchIpsGet, type HostScan } from "../api/netflow-rollups-client";
import { fetchLabelsByValue } from "../api/opencti";
import { FingerprintHistory } from "./FingerprintHistory";
import { factLabel, foldRuns, type FingerprintRun } from "../lib/fingerprints";
import { windowRange } from "./WindowSelect";
import { errorMessage } from "../lib/errors";

// What else is known about an IP that is under review in Candidates: every tag it
// carries, and its port scans. Both are context for the reviewer, shown beside the
// suggestion they are deciding; neither is a role and neither decides anything.
//
// Tags. A watched IP's tags are `/watch/ips` `tags`, netflow-rollups' mirror of every
// OpenCTI label on it. A peer has no row there, so for an IP that is not watched the
// TIP itself is asked whether it is an observable and what it is labelled. Labels other
// than `msk:*` are an analyst's suggestion and are drawn as tag chips, never as roles.
//
// Port scans. `/lookup/host-scans` for the IP over all history (the table is
// append-only). netflow-rollups sweeps every watched IP daily and scans a peer only
// after a rule recommends it, so many peers have none.

export type IpTags =
  | { state: "loading" }
  /** On the watchlist: `/watch/ips` tags. */
  | { state: "watched"; tags: string[]; paused: boolean }
  /** Not on the watchlist, but an observable in OpenCTI: its labels there. */
  | { state: "tip"; tags: string[] }
  /** Not on the watchlist and not an observable in OpenCTI. */
  | { state: "none" }
  | { state: "failed"; error: string };

/** Tags for a set of IPs: one `/watch/ips` read, then one OpenCTI query per 100 unwatched IPs. */
export function useIpTags(ips: string[]): (ip: string) => IpTags {
  const key = useMemo(() => [...new Set(ips)].sort().join(","), [ips]);
  const [watched, setWatched] = useState<Map<string, { tags: string[]; paused: boolean }> | null>(null);
  const [watchedError, setWatchedError] = useState<string | null>(null);
  const [tip, setTip] = useState<{ key: string; labels: Map<string, string[]> } | null>(null);
  const [tipError, setTipError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listIpsWatchIpsGet({ throwOnError: true })
      .then((r) => !cancelled && setWatched(new Map(r.data.rows.map((w) => [w.ip, { tags: w.tags, paused: w.paused }]))))
      .catch((err) => !cancelled && setWatchedError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!watched || key === "") return;
    let cancelled = false;
    const unwatched = key.split(",").filter((ip) => !watched.has(ip));
    setTipError(null);
    fetchLabelsByValue(unwatched)
      .then((found) => !cancelled && setTip({ key, labels: new Map([...found].map(([ip, v]) => [ip, v.labels])) }))
      .catch((err) => !cancelled && setTipError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [watched, key]);

  return (ip: string): IpTags => {
    if (watchedError) return { state: "failed", error: `/watch/ips: ${watchedError}` };
    if (!watched) return { state: "loading" };
    const w = watched.get(ip);
    if (w) return { state: "watched", tags: sortTags(w.tags), paused: w.paused };
    if (tipError) return { state: "failed", error: `OpenCTI: ${tipError}` };
    if (!tip || tip.key !== key) return { state: "loading" };
    const labels = tip.labels.get(ip);
    return labels ? { state: "tip", tags: sortTags(labels) } : { state: "none" };
  };
}

/** `msk:*` (the watch labels) first, then the rest alphabetically -- the Watchlist's order. */
function sortTags(tags: string[]): string[] {
  return [...tags].sort((a, b) => {
    const am = a.startsWith("msk:"), bm = b.startsWith("msk:");
    return am === bm ? a.localeCompare(b) : am ? -1 : 1;
  });
}

const MUTED = { fontSize: 12, color: "#6FA89E" } as const;
const LABEL = { fontSize: 10, color: "#6FA89E", textTransform: "uppercase", width: 74, flexShrink: 0, paddingTop: 2 } as const;

/** Every tag of one IP as chips, or a plain statement of why there are none. */
export function IpTagChips({ tags }: { tags: IpTags }) {
  if (tags.state === "loading") return <span style={MUTED}>Loading…</span>;
  if (tags.state === "failed") return <span style={{ fontSize: 12, color: "#E5484D" }}>Could not load tags ({tags.error})</span>;
  if (tags.state === "none") return <span style={MUTED}>none — not on the watchlist and not an observable in OpenCTI</span>;
  const where =
    tags.state === "watched" ? "OpenCTI label (/watch/ips tags)" : "OpenCTI label (read from the TIP; this IP is not on the watchlist)";
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {tags.tags.map((t) =>
        t.startsWith("msk:") ? (
          <span className="chip" key={t} title={`${where} — an msk:* watch label`}>
            {t}
          </span>
        ) : (
          <span className="chip tip" key={t} title={`${where} — an analyst's suggestion, read by no logic`}>
            {t}
          </span>
        ),
      )}
      {tags.tags.length === 0 && (
        <span style={MUTED}>{tags.state === "watched" ? "on the watchlist with no tags" : "an observable in OpenCTI with no labels"}</span>
      )}
      {tags.state === "watched" && tags.paused && <span style={MUTED}>· paused on the watchlist</span>}
      {tags.state === "tip" && <span style={MUTED}>· in OpenCTI, not on the watchlist</span>}
    </span>
  );
}

// One fetch per IP however many cards show it (an IP with three suggested roles has three cards).
const scanCache = new Map<string, Promise<HostScan[]>>();

function loadScans(ip: string): Promise<HostScan[]> {
  let p = scanCache.get(ip);
  if (!p) {
    const { from, to } = windowRange("all");
    p = listHostScansLookupHostScansGet({ query: { ip, from, to, limit: 1000 }, throwOnError: true }).then((r) => r.data.rows);
    p.catch(() => scanCache.delete(ip)); // a failure is not remembered
    scanCache.set(ip, p);
  }
  return p;
}

/** True once the element has come within 400px of the viewport; a queue can hold 140 cards. */
function useNearViewport<T extends Element>(): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);
  return [ref, near];
}

const FACTS_SHOWN = 14;

function LatestRun({ run, runs }: { run: FingerprintRun; runs: number }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 12, color: "#A6D8CD", marginBottom: 4 }}>
        <span className="mono">{run.source}</span>
        <span style={{ color: "#6FA89E" }}>
          {" "}
          · last scanned {run.lastDay} · {run.facts.length} service{run.facts.length === 1 ? "" : "s"}
          {runs > 1
            ? ` · ${runs} fingerprints in its history`
            : run.scans > 1
              ? ` · unchanged over ${run.scans} scans since ${run.firstDay}`
              : ""}
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {run.facts.length === 0 && <span style={MUTED}>no open services in this scan</span>}
        {run.facts.slice(0, FACTS_SHOWN).map((f, i) => (
          <span
            key={i}
            className="mono"
            title={f.tls_fingerprint ? `TLS fingerprint ${String(f.tls_fingerprint)}` : undefined}
            style={{ fontSize: 11, color: "#C6EBE2", background: "#06181A", border: "1px solid #133A3C", borderRadius: 4, padding: "2px 7px", overflowWrap: "anywhere" }}
          >
            {factLabel(f)}
            {f.http_title ? <span style={{ color: "#6FA89E" }}> — “{String(f.http_title).slice(0, 48)}”</span> : null}
          </span>
        ))}
        {run.facts.length > FACTS_SHOWN && <span style={MUTED}>+{run.facts.length - FACTS_SHOWN} more in the history below</span>}
      </div>
    </div>
  );
}

export function IpReviewContext({ ip, tags, watchedVantage = false }: { ip: string; tags: IpTags; watchedVantage?: boolean }) {
  const [ref, near] = useNearViewport<HTMLDivElement>();
  const [scans, setScans] = useState<HostScan[] | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    setScans(null);
    setScanError(null);
    loadScans(ip)
      .then((rows) => !cancelled && setScans(rows))
      .catch((err) => !cancelled && setScanError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [ip, near]);

  const runsBySource = useMemo(() => (scans ? foldRuns(scans) : null), [scans]);
  const isWatched = watchedVantage || tags.state === "watched";
  const trigger = scans && scans.length > 0 ? [...new Set(scans.map((s) => s.trigger))].sort().join(", ") : null;

  return (
    <div
      ref={ref}
      style={{ background: "#0A2224", border: "1px solid #133A3C", borderRadius: 7, padding: "10px 14px", marginBottom: 10 }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 8 }}>
        <span style={LABEL}>Tags</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <IpTagChips tags={tags} />
        </span>
        <span className="src" style={{ flexShrink: 0 }}>
          {tags.state === "tip" || tags.state === "none" ? "/watch/ips · OpenCTI labels" : "/watch/ips"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span style={LABEL}>Port scans</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {scanError && <span style={{ fontSize: 12, color: "#E5484D" }}>Could not load port scans ({scanError})</span>}
          {!scans && !scanError && <span style={MUTED}>Loading…</span>}
          {runsBySource && runsBySource.size === 0 && (
            <span style={MUTED}>
              {isWatched
                ? "No port scan of this IP yet."
                : "No port scan of this peer. netflow-rollups scans a peer only after a rule recommends it."}
            </span>
          )}
          {runsBySource &&
            [...runsBySource.entries()].map(([source, runs]) => (
              <LatestRun key={source} run={runs[runs.length - 1]} runs={runs.length} />
            ))}
          {scans && runsBySource && runsBySource.size > 0 && (
            <>
              <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
                <button
                  type="button"
                  onClick={() => setHistoryOpen((o) => !o)}
                  style={{ all: "unset", cursor: "pointer", fontSize: 12, color: "#4C8DFF" }}
                >
                  {historyOpen ? "▾" : "▸"} Scan history and full facts ({scans.length} scan{scans.length === 1 ? "" : "s"})
                </button>
                <Link to={`/entity/${ip}`} style={{ fontSize: 12 }}>
                  Entity page →
                </Link>
                {trigger && <span style={MUTED}>scanned because: {trigger}</span>}
              </div>
              {historyOpen && (
                <div style={{ marginTop: 10 }}>
                  <FingerprintHistory ip={ip} scans={scans} />
                </div>
              )}
            </>
          )}
        </div>
        <span className="src" style={{ flexShrink: 0 }}>
          /lookup/host-scans
        </span>
      </div>
    </div>
  );
}
