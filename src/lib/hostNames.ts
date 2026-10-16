import type { HostNameSummary } from "../api/netflow-rollups-client";

// Preference order for a compact display: netflow-rollups' own `domain`
// (Shodan's derived registrable domain) and `hostname` are the cleanest
// identity signal; `certificate` names can reveal a service's real domain
// even when rDNS just shows generic hosting; forward/reverse DNS are listed
// last since reverse_dns usually duplicates lookup__ip_identities.rdns.
const KIND_PRIORITY = ["domain", "hostname", "certificate", "forward_dns", "reverse_dns"];

// `certificate`-kind names are a cert's subject/issuer CN, which isn't always
// a hostname (e.g. "CloudFlare Origin Certificate", a generic cert label with
// no connection to the box it's on) — filter those out rather than passing
// them through as if they were a domain.
export function looksLikeHostname(name: string): boolean {
  return !/\s/.test(name) && name.includes(".");
}

export function bestScanNames(rows: HostNameSummary[], exclude?: string | null): string[] {
  const ordered = [...rows].sort((a, b) => KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of ordered) {
    if (r.name === exclude || seen.has(r.name) || !looksLikeHostname(r.name)) continue;
    seen.add(r.name);
    out.push(r.name);
  }
  return out;
}
