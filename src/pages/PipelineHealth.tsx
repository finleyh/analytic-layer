import { useEffect, useState } from "react";
import { freshnessOpsFreshnessGet, type Freshness } from "../api/netflow-rollups-client";
import {
  fetchDeploymentsByTag,
  fetchFlowRunsByTag,
  fetchLatestRunPerDeployment,
  fetchLogsForRuns,
  sumRecordsPulled,
  describeCronSchedule,
  type PrefectDeployment,
  type PrefectFlowRun,
} from "../api/prefect";
import { daysAgo } from "../lib/format";

type PipelineData = {
  freshness: Freshness;
  deployments: PrefectDeployment[];
  flowRuns: PrefectFlowRun[];
  recordsByRunId: Map<string, number>;
  latestByDeployment: Map<string, PrefectFlowRun>;
};

const STATE_COLORS: Record<string, string> = {
  COMPLETED: "#3DD68C",
  FAILED: "#E5484D",
  CRASHED: "#F5A623",
  RUNNING: "#4C8DFF",
  PENDING: "#4C8DFF",
  SCHEDULED: "#6FA89E",
  CANCELLED: "#6FA89E",
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}min`;
}

function formatAge(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h${String(m).padStart(2, "0")}m`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
}

export function PipelineHealth() {
  const [data, setData] = useState<PipelineData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const since48h = daysAgo(2).toISOString();
        const [freshnessResult, deployments, allFlowRuns] = await Promise.all([
          freshnessOpsFreshnessGet({ throwOnError: true }),
          fetchDeploymentsByTag("netflow-rollups"),
          fetchFlowRunsByTag("netflow-rollups", since48h),
        ]);
        if (cancelled) return;

        const latestByDeployment = await fetchLatestRunPerDeployment(deployments.map((d) => d.id));
        if (cancelled) return;

        // start_time: {after_} still returns not-yet-run SCHEDULED rows (null
        // start_time) alongside past ones — this view is about what already
        // happened, so drop anything that hasn't actually started.
        const flowRuns = allFlowRuns.filter((r) => r.start_time !== null);

        const flowPullDep = deployments.find((d) => d.name === "flow-pull");
        const flowPullRuns = flowPullDep
          ? flowRuns.filter((r) => r.deployment_id === flowPullDep.id)
          : [];
        const logs = await fetchLogsForRuns(flowPullRuns.map((r) => r.id));
        if (cancelled) return;

        const recordsByRunId = new Map(
          flowPullRuns.map((r) => [r.id, sumRecordsPulled(logs, r.id)]),
        );

        setData({
          freshness: freshnessResult.data,
          deployments,
          flowRuns,
          recordsByRunId,
          latestByDeployment,
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

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: "0 0 4px 0", fontSize: 22, fontWeight: 600 }}>Pipeline health</h1>
        <div style={{ fontSize: 13, color: "#6FA89E" }}>
          Is the data behind every other page still arriving? Live from{" "}
          <span className="mono">netflow-rollups</span> and the Prefect API.
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: 20, borderColor: "#5A2327" }}>
          Failed to load: {error}
        </div>
      )}
      {!data && !error && <div style={{ color: "#6FA89E" }}>Loading…</div>}
      {data && <PipelineContent data={data} />}
    </>
  );
}

function PipelineContent({ data }: { data: PipelineData }) {
  const { freshness, deployments, flowRuns, recordsByRunId, latestByDeployment } = data;

  const flowPullDep = deployments.find((d) => d.name === "flow-pull");
  const puller48h = flowPullDep
    ? flowRuns.filter((r) => r.deployment_id === flowPullDep.id).slice(0, 15)
    : [];

  const now = Date.now();
  const runs24hByDeployment = new Map<string, { ok: number; failed: number }>();
  for (const r of flowRuns) {
    if (!r.deployment_id) continue;
    if (r.start_time && now - new Date(r.start_time).getTime() < 24 * 3600 * 1000) {
      const c = runs24hByDeployment.get(r.deployment_id) ?? { ok: 0, failed: 0 };
      if (r.state_type === "FAILED" || r.state_type === "CRASHED") c.failed += 1;
      else c.ok += 1;
      runs24hByDeployment.set(r.deployment_id, c);
    }
  }

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(230px, 100%), 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {freshness.checks.map((c) => (
          <div
            className="card"
            style={{ padding: "18px 20px", borderColor: c.stale ? "#5A2327" : undefined }}
            key={c.name}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <div style={{ fontSize: 12, color: "#6FA89E" }}>{c.name.replace(/_/g, " ")}</div>
              <span className="st" style={{ color: c.stale ? "#E5484D" : "#3DD68C", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                {c.stale ? "stale" : "ok"}
              </span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 600, marginTop: 6, color: c.stale ? "#E5484D" : "#E8FFF8" }}>
              {c.age_seconds !== null ? formatAge(c.age_seconds) : "—"}
              <span style={{ fontSize: 12, color: "#6FA89E", fontWeight: 500 }}>
                {" "}
                old · limit {formatAge(c.max_age_seconds)}
              </span>
            </div>
            <div style={{ background: "#133A3C", borderRadius: 4, height: 8, overflow: "hidden", marginTop: 10 }}>
              <div
                style={{
                  height: "100%",
                  borderRadius: 4,
                  width: `${Math.min(100, ((c.age_seconds ?? 0) / c.max_age_seconds) * 100)}%`,
                  background: c.stale ? "#E5484D" : "#3DD68C",
                }}
              />
            </div>
            <div style={{ fontSize: 11, color: "#6FA89E", marginTop: 8, lineHeight: 1.45 }}>{c.why}</div>
          </div>
        ))}
      </div>

      {freshness.checks.some((c) => c.stale) && (
        <div className="card" style={{ padding: "18px 22px", marginBottom: 24, borderColor: "#5A2327" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            <span style={{ color: "#E5484D" }}>Open episode(s)</span>
          </div>
          {freshness.checks
            .filter((c) => c.stale)
            .map((c) => (
              <div key={c.name} style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 8 }}>
                <span className="mono">{c.name}</span> stale since{" "}
                {c.stale_since ? formatTimestamp(c.stale_since) : "—"}
                {c.last_alerted_at && <> · last alerted {formatTimestamp(c.last_alerted_at)}</>}
                <div style={{ color: "#6FA89E", fontSize: 12, marginTop: 2 }}>{c.why}</div>
              </div>
            ))}
          <div className="note">
            Not shown: a hand-written "what the pipeline did vs. what the upstream says" narrative
            — that's an analyst's own investigation, not something the API serves. Only the raw
            facts above come from <span className="mono">ops__freshness_alerts</span>.
          </div>
        </div>
      )}

      <div className="card" style={{ padding: "22px 24px", marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Records ingested per hour — 7d</div>
        </div>
        <div style={{ fontSize: 12, color: "#6FA89E" }}>
          Not servable: <span className="mono">flow__records</span> isn't exposed by the API (it's
          180 days of raw rows), and no rollup carries hourly ingestion counts. This chart would
          need a new summary endpoint.
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 24 }}>
        <div className="card" style={{ flex: "1 1 560px", minWidth: 0, overflowX: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "20px 22px 0 22px", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Puller runs — 48h</div>
            <span className="src">Prefect · flow-pull · log lines "pulled N flow records"</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14, minWidth: 560 }}>
            <thead>
              <tr>
                <th>Scheduled</th>
                <th>State</th>
                <th style={{ textAlign: "right" }}>Took</th>
                <th style={{ textAlign: "right" }}>Records</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {puller48h.map((r) => (
                <tr key={r.id}>
                  <td className="mono" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                    {formatTimestamp(r.expected_start_time ?? r.start_time)}
                  </td>
                  <td>
                    <span
                      className="st"
                      style={{ color: STATE_COLORS[r.state_type] ?? "#A6D8CD", fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}
                    >
                      {r.state_name}
                    </span>
                  </td>
                  <td className="num">{formatDuration(r.total_run_time)}</td>
                  <td className="num" style={{ color: (recordsByRunId.get(r.id) ?? 0) === 0 ? "#6FA89E" : undefined }}>
                    {(recordsByRunId.get(r.id) ?? 0).toLocaleString()}
                  </td>
                  <td style={{ fontSize: 12, color: "#A6D8CD" }}>{r.state.message ?? ""}</td>
                </tr>
              ))}
              {puller48h.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: "#6FA89E" }}>
                    No puller runs in the last 48h.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ flex: "1 1 300px", minWidth: 0, padding: "22px 24px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Heads and watermarks</div>
          {[
            ["Raw newest", freshness.heads.flow_records],
            ["Hourly rollup newest", freshness.heads.rollup_flow_hourly],
            ["Daily rollup newest", freshness.heads.rollup_flow_daily],
            ["Honeypot pull", freshness.heads.honeypot_pull],
            ["Watched host scan", freshness.heads.watched_host_scan],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, padding: "7px 0", borderBottom: "1px solid #133A3C", color: "#A6D8CD" }}
            >
              <span>{label}</span>
              <span className="mono" style={{ color: "#E8FFF8" }}>
                {formatTimestamp(value)}
              </span>
            </div>
          ))}
          <div className="note" style={{ padding: "12px 0 0 0" }}>
            Not available from this API: scanner verdict counts, roles/providers last-write
            times, held no-overlap slots — these aren't in the <span className="mono">Freshness</span>{" "}
            response.
          </div>
        </div>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "20px 22px 0 22px", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Scheduled flows — {deployments.length}</div>
          <span className="src">Prefect · deployments tagged netflow-rollups</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14, minWidth: 700 }}>
          <thead>
            <tr>
              <th>Deployment</th>
              <th>Schedule</th>
              <th>Last run</th>
              <th>State</th>
              <th style={{ textAlign: "right" }}>Took</th>
              <th style={{ textAlign: "right" }}>Runs 24h</th>
            </tr>
          </thead>
          <tbody>
            {deployments.map((dep) => {
              const last = latestByDeployment.get(dep.id);
              const counts = runs24hByDeployment.get(dep.id);
              return (
                <tr key={dep.id}>
                  <td className="mono">
                    {dep.name}
                    {dep.paused && (
                      <span style={{ color: "#F5A623", fontSize: 10, marginLeft: 6 }}>paused</span>
                    )}
                  </td>
                  <td style={{ color: "#A6D8CD", whiteSpace: "nowrap" }}>{describeCronSchedule(dep)}</td>
                  <td className="mono" style={{ fontSize: 12, color: "#A6D8CD", whiteSpace: "nowrap" }}>
                    {last ? formatTimestamp(last.start_time) : "—"}
                  </td>
                  <td>
                    {last ? (
                      <span
                        className="st"
                        style={{ color: STATE_COLORS[last.state_type] ?? "#A6D8CD", fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}
                      >
                        {last.state_name}
                      </span>
                    ) : (
                      <span style={{ color: "#6FA89E", fontSize: 11 }}>never</span>
                    )}
                  </td>
                  <td className="num">{last ? formatDuration(last.total_run_time) : "—"}</td>
                  <td className="num">
                    <span style={{ color: "#3DD68C" }}>{counts?.ok ?? 0}</span>
                    {counts?.failed ? <span style={{ color: "#E5484D" }}> · {counts.failed} failed</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="note">
          The first word of a deployment is the package that runs it and the prefix of every table
          it writes. All {deployments.filter((d) => d.paused).length} of {deployments.length}{" "}
          deployments are currently <span style={{ color: "#F5A623" }}>paused</span>.
        </div>
      </div>
    </>
  );
}
