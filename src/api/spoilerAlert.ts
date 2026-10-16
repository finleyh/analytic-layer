// spoiler-alert: REST, token-gated. Proxied through vite.config.ts so
// SPOILER_ALERT_API_TOKEN never reaches the browser bundle.
export type MonitoredDomain = {
  opencti_id: string;
  opencti_href: string;
  kind: string;
  observable_type: string;
  value: string;
  cadence: string;
  state: string;
  consecutive_failures: number;
  last_checked_at: string | null;
  next_due_at: string | null;
  domain_expires_at: string | null;
};

export type RetiredDomain = {
  opencti_id: string;
  opencti_href: string;
  observable_type: string;
  value: string;
  retired_at: string;
  next_recheck_at: string | null;
  last_recheck_at: string | null;
  recheck_count: number;
  resurrected_at: string | null;
};

export type StatusSummary = {
  monitored_per_cadence: Record<string, number>;
  monitored_per_state: Record<string, number>;
  monitored_total: number;
  due_now: number;
  next_due_at: string | null;
  check_runs_24h: number;
  errors_24h: number;
  status_mix_24h: Record<string, number>;
  retired: number;
  resurrected: number;
  last_sync_at: string | null;
  last_sync_targets: number;
  unsupported_indicators: number;
  last_sync_error: string | null;
};

export type HistoryRun = {
  module: string;
  started_at: string;
  status: string;
  observations: {
    records?: Record<string, string[]>;
    provenance?: Record<string, unknown>;
  } | null;
  writeback: {
    errors: string[];
    created_observables: { id: string; ref: string }[];
    created_relationships: { id: string; to: string; from: string; type: string; description: string }[];
  };
  error: string | null;
};

export type MonitoredDomainDetail = MonitoredDomain & { history: HistoryRun[] };

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api/spoiler-alert${path}`);
  if (!res.ok) throw new Error(`spoiler-alert ${path} failed: ${res.status}`);
  return res.json();
}

export function fetchStatus(): Promise<StatusSummary> {
  return get("/status");
}

export async function fetchMonitored(): Promise<MonitoredDomain[]> {
  const data = await get<{ count: number; items: MonitoredDomain[] }>("/monitored");
  return data.items;
}

export async function fetchRetired(): Promise<RetiredDomain[]> {
  const data = await get<{ count: number; items: RetiredDomain[] }>("/retired");
  return data.items;
}

export function fetchMonitoredDetail(openctiId: string): Promise<MonitoredDomainDetail> {
  return get(`/monitored/${openctiId}`);
}
