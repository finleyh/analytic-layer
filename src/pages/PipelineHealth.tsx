import { useEffect, useState } from "react";
import {
  freshnessOpsFreshnessGet,
  peerReviewSummaryReviewIpRolesPeerReviewGet,
  type Freshness,
  type PeerReviewDay,
} from "../api/netflow-rollups-client";
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
  peerReview: PeerReviewDay[];
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

// The first word of a deployment name is the package that runs it and the
// prefix of every table it writes — same eight words as the schema.
const PACKAGE_ORDER = ["watch", "flow", "ref", "lookup", "verdict", "review", "ops"];
const PACKAGE_COLORS: Record<string, string> = {
  watch: "#4C8DFF",
  flow: "#3DD68C",
  ref: "#8B5CF6",
  lookup: "#2DD4BF",
  verdict: "#F5A623",
  review: "#EC4899",
  ops: "#A6D8CD",
};

function packageOf(deploymentName: string): string {
  return deploymentName.split("-")[0];
}

function sortByPackage(deployments: PrefectDeployment[]): PrefectDeployment[] {
  return [...deployments].sort((a, b) => {
    const pa = PACKAGE_ORDER.indexOf(packageOf(a.name));
    const pb = PACKAGE_ORDER.indexOf(packageOf(b.name));
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });
}

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

// freshness.episodes carries every open row of the ledger verbatim,
// including two synthetic kinds no data-freshness check produces: a
// deployment that hasn't completed a run in over 2x its cadence, and one
// with failed/crashed runs in the last 24h. Neither has a matching entry in
// freshness.checks (those are all data-staleness checks), so there's no
// "why" to borrow — the prefix is the whole fact.
function describeEpisode(checkName: string): string {
  if (checkName.startsWith("run:")) {
    return `${checkName.slice(4)} hasn't completed a run in over 2× its scheduled cadence.`;
  }
  if (checkName.startsWith("failures:")) {
    return `${checkName.slice(9)} had a failed or crashed run in the last 24h.`;
  }
  return checkName;
}

export function PipelineHealth() {
  const [data, setData] = useState<PipelineData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const since48h = daysAgo(2).toISOString();
        const [freshnessResult, deployments, allFlowRuns, peerReviewResult] = await Promise.all([
          freshnessOpsFreshnessGet({ throwOnError: true }),
          fetchDeploymentsByTag("netflow-rollups"),
          fetchFlowRunsByTag("netflow-rollups", since48h),
          peerReviewSummaryReviewIpRolesPeerReviewGet({ throwOnError: true }),
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
          peerReview: peerReviewResult.data.rows,
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
  const { freshness, deployments, flowRuns, recordsByRunId, latestByDeployment, peerReview } = data;

  const checksByName = new Map(freshness.checks.map((c) => [c.name, c]));

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

      {freshness.episodes.length > 0 && (
        <div className="card" style={{ padding: "18px 22px", marginBottom: 24, borderColor: "#5A2327" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            <span style={{ color: "#E5484D" }}>Open episode(s)</span>
          </div>
          {freshness.episodes.map((ep) => {
            // A data-freshness episode's name matches one of the checks
            // above and reuses its "why"; run:<deployment> and
            // failures:<deployment> are synthetic names with no matching
            // check — describeEpisode() explains those from the prefix.
            const check = checksByName.get(ep.check_name);
            return (
              <div key={ep.check_name} style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 8 }}>
                <span className="mono">{ep.check_name}</span> stale since{" "}
                {formatTimestamp(ep.stale_since)}
                {ep.last_alerted_at && <> · last alerted {formatTimestamp(ep.last_alerted_at)}</>}
                <div style={{ color: "#6FA89E", fontSize: 12, marginTop: 2 }}>
                  {check ? check.why : describeEpisode(ep.check_name)}
                </div>
              </div>
            );
          })}
          <div className="note">
            Not shown: a hand-written "what the pipeline did vs. what the upstream says" narrative
            — that's an analyst's own investigation, not something the API serves. Every open
            episode of the ledger above comes verbatim from{" "}
            <span className="mono">ops__freshness_alerts</span> — the same facts the Slack alert
            reads, so this list and that alert can't disagree.
          </div>
        </div>
      )}

      <PeerReviewStats rows={peerReview} />

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
            {sortByPackage(deployments).map((dep) => {
              const last = latestByDeployment.get(dep.id);
              const counts = runs24hByDeployment.get(dep.id);
              const pkg = packageOf(dep.name);
              return (
                <tr key={dep.id}>
                  <td className="mono">
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        marginRight: 8,
                        display: "inline-block",
                        width: 52,
                        color: PACKAGE_COLORS[pkg] ?? "#A6D8CD",
                      }}
                    >
                      {pkg}
                    </span>
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

// "Regular peers" (netflow-rollups, landed 2026-10-20): nightly, peers that
// talk steadily to a watched IP get admitted, scanned, and judged by a new
// agentic process ("peer_review") that proposes a role straight into the
// same review__ip_roles queue Candidate review shows. The owner asked for
// its first week measured through this dashboard (proposals a night,
// agreement with the human, how many had no scan in hand) — this is that.
function PeerReviewStats({ rows }: { rows: PeerReviewDay[] }) {
  const totals = rows.reduce(
    (acc, r) => ({
      proposals: acc.proposals + r.proposals,
      withScan: acc.withScan + r.with_scan,
      suggested: acc.suggested + r.suggested,
      agenticEvaluation: acc.agenticEvaluation + r.agentic_evaluation,
      confirmed: acc.confirmed + r.confirmed,
      rejected: acc.rejected + r.rejected,
      expired: acc.expired + r.expired,
    }),
    { proposals: 0, withScan: 0, suggested: 0, agenticEvaluation: 0, confirmed: 0, rejected: 0, expired: 0 },
  );
  const days = [...new Set(rows.map((r) => r.day))].sort().reverse();
  const sorted = [...rows].sort((a, b) => (a.day === b.day ? a.role.localeCompare(b.role) : b.day.localeCompare(a.day)));

  return (
    <div className="card" style={{ padding: "22px 24px", marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Regular peers — first week</div>
        <span className="src">review__ip_roles/peer-review</span>
      </div>
      <div style={{ fontSize: 11, color: "#6FA89E", marginBottom: 16, lineHeight: 1.5 }}>
        A newer, separate pipeline from the rule-based queues on Candidate review: peers that talk
        steadily to a watched IP are admitted, scanned, and judged by their own agentic process,
        landing suggestions in the same queue. A peer judged "none" writes nothing, so it isn't
        counted here — the sweep's own log carries that count, not this API.
      </div>

      {rows.length === 0 ? (
        <div style={{ color: "#6FA89E", fontSize: 13 }}>No proposals yet in this window.</div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
              gap: 14,
              marginBottom: 18,
            }}
          >
            <div>
              <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>
                Proposals · {days.length} day{days.length === 1 ? "" : "s"}
              </div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 600 }}>
                {totals.proposals}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>With a scan in hand</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 600 }}>
                {totals.withScan} <span style={{ fontSize: 12, color: "#6FA89E", fontWeight: 500 }}>of {totals.proposals}</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>Confirmed</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: "#3DD68C" }}>
                {totals.confirmed}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>Rejected</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: totals.rejected > 0 ? "#E5484D" : undefined }}>
                {totals.rejected}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#6FA89E", textTransform: "uppercase" }}>Still awaiting review</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: "#F5A623" }}>
                {totals.suggested + totals.agenticEvaluation}
              </div>
            </div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th>Day</th>
                <th>Role</th>
                <th style={{ textAlign: "right" }}>Proposals</th>
                <th style={{ textAlign: "right" }}>With scan</th>
                <th style={{ textAlign: "right" }}>Suggested</th>
                <th style={{ textAlign: "right" }}>Agent-reviewed</th>
                <th style={{ textAlign: "right" }}>Confirmed</th>
                <th style={{ textAlign: "right" }}>Rejected</th>
                <th style={{ textAlign: "right" }}>Expired</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={`${r.day}:${r.role}`}>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {r.day}
                  </td>
                  <td className="mono">{r.role}</td>
                  <td className="num mono" style={{ textAlign: "right" }}>
                    {r.proposals}
                  </td>
                  <td className="num mono" style={{ textAlign: "right", color: r.with_scan < r.proposals ? "#F5A623" : undefined }}>
                    {r.with_scan}
                  </td>
                  <td className="num mono" style={{ textAlign: "right" }}>
                    {r.suggested}
                  </td>
                  <td className="num mono" style={{ textAlign: "right" }}>
                    {r.agentic_evaluation}
                  </td>
                  <td className="num mono" style={{ textAlign: "right", color: r.confirmed > 0 ? "#3DD68C" : undefined }}>
                    {r.confirmed}
                  </td>
                  <td className="num mono" style={{ textAlign: "right", color: r.rejected > 0 ? "#E5484D" : undefined }}>
                    {r.rejected}
                  </td>
                  <td className="num mono" style={{ textAlign: "right" }}>
                    {r.expired}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
