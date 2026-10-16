// Prefect's REST API: no auth, CORS open to all origins (verified against the
// live instance), so this calls it directly from the browser rather than
// through the vite dev-proxy pattern used for token-gated sources.
const BASE_URL = import.meta.env.VITE_PREFECT_API_URL;

export type PrefectSchedule = {
  schedule: { cron?: string; interval?: number; rrule?: string } & Record<string, unknown>;
  active: boolean;
};

export type PrefectDeployment = {
  id: string;
  name: string;
  paused: boolean;
  tags: string[];
  schedules: PrefectSchedule[];
};

export type PrefectState = {
  type: string;
  name: string;
  message: string | null;
};

export type PrefectFlowRun = {
  id: string;
  name: string;
  deployment_id: string | null;
  state_type: string;
  state_name: string;
  start_time: string | null;
  expected_start_time: string | null;
  end_time: string | null;
  total_run_time: number;
  state: PrefectState;
};

export type PrefectLog = {
  flow_run_id: string;
  message: string;
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Prefect ${path} failed: ${res.status}`);
  }
  return res.json();
}

export function fetchDeploymentsByTag(tag: string): Promise<PrefectDeployment[]> {
  return post("/deployments/filter", {
    deployments: { tags: { all_: [tag] } },
    limit: 200,
  });
}

export function fetchFlowRunsByTag(tag: string, startTimeAfter: string, limit = 200): Promise<PrefectFlowRun[]> {
  return post("/flow_runs/filter", {
    flow_runs: { tags: { all_: [tag] }, start_time: { after_: startTimeAfter } },
    sort: "START_TIME_DESC",
    limit,
  });
}

// 48h-windowed queries miss the true last run for weekly/monthly/on-demand
// deployments, so this fetches the single most recent (started) run per
// deployment directly, one small request each, run in parallel.
async function fetchLatestRunFor(id: string): Promise<PrefectFlowRun | undefined> {
  const runs = await post<PrefectFlowRun[]>("/flow_runs/filter", {
    flow_runs: { deployment_id: { any_: [id] }, start_time: { is_null_: false } },
    sort: "START_TIME_DESC",
    limit: 1,
  });
  return runs[0];
}

// 21 of these fire in parallel; the live instance occasionally 422s one or
// two under that burst (reproduces even with a known-valid body), so a
// single retry is cheap insurance against dropping a deployment's row
// entirely rather than a sign the request itself is malformed.
export async function fetchLatestRunPerDeployment(
  deploymentIds: string[],
): Promise<Map<string, PrefectFlowRun>> {
  const entries = await Promise.all(
    deploymentIds.map(async (id) => {
      try {
        return [id, await fetchLatestRunFor(id)] as const;
      } catch {
        try {
          return [id, await fetchLatestRunFor(id)] as const;
        } catch {
          return [id, undefined] as const;
        }
      }
    }),
  );
  return new Map(entries.filter((e): e is [string, PrefectFlowRun] => e[1] !== undefined));
}

export function fetchLogsForRuns(flowRunIds: string[]): Promise<PrefectLog[]> {
  if (flowRunIds.length === 0) return Promise.resolve([]);
  return post("/logs/filter", {
    logs: { flow_run_id: { any_: flowRunIds } },
    limit: 200,
  });
}

const RECORDS_PULLED_RE = /pulled (\d+) flow records/g;

export function sumRecordsPulled(logs: PrefectLog[], flowRunId: string): number {
  let total = 0;
  for (const log of logs) {
    if (log.flow_run_id !== flowRunId) continue;
    for (const m of log.message.matchAll(RECORDS_PULLED_RE)) {
      total += Number(m[1]);
    }
  }
  return total;
}

export function describeCronSchedule(dep: PrefectDeployment): string {
  const sched = dep.schedules[0]?.schedule;
  const cron = sched?.cron as string | undefined;
  if (!cron) return "on demand";
  const [min, hour, dom, , dow] = cron.split(" ");
  const pad = (n: string) => n.padStart(2, "0");
  if (cron.startsWith("0 */") && dom === "*" && dow === "*") {
    return `every ${hour.replace("*/", "")} h`;
  }
  if (min !== "*" && hour === "*" && dom === "*" && dow === "*") {
    return "hourly";
  }
  if (min !== "*" && hour !== "*" && dom === "*" && dow === "*") {
    return `daily · ${pad(hour)}:${pad(min)} UTC`;
  }
  if (min !== "*" && hour !== "*" && dom === "*" && dow !== "*") {
    return `weekly · ${pad(hour)}:${pad(min)} UTC`;
  }
  if (min !== "*" && hour !== "*" && dom !== "*") {
    return `monthly · ${pad(hour)}:${pad(min)} UTC`;
  }
  return cron;
}
