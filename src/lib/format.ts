export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

// Warning font color for a days-until-expiry count: default text color
// beyond 60 days, yellow beyond 30, orange beyond 10, red at 10 days or
// fewer (including already expired).
export function expiryColor(days: number | null): string | undefined {
  if (days === null || days > 60) return undefined;
  if (days > 30) return "#F2C94C";
  if (days > 10) return "#F5A623";
  return "#E5484D";
}

// A bare month/day (no year) is ambiguous once values span several years, as
// domain expirations do — a day count reads unambiguously at a glance in a
// narrow table column; pair it with the full date in a tooltip.
export function formatDaysUntil(days: number | null): string {
  if (days === null) return "—";
  if (days < 0) return `expired ${Math.abs(days)}d ago`;
  return `${days}d`;
}

// Interpolates blue (#4C8DFF) at 0% to white at 100%, for a bar fill whose
// color itself should read as "how close to full" without needing a label.
export function blueToWhite(pct: number): string {
  const t = Math.max(0, Math.min(100, pct)) / 100;
  const r = Math.round(76 + (255 - 76) * t);
  const g = Math.round(141 + (255 - 141) * t);
  const b = 255;
  return `rgb(${r}, ${g}, ${b})`;
}

// Interpolates the card background teal (near-zero activity) up to the
// theme's bright mint-green #3DD68C (peak activity), for heatmap cells.
export function darkToGreen(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const dark: [number, number, number] = [10, 34, 36];
  const bright: [number, number, number] = [61, 214, 140];
  const r = Math.round(dark[0] + (bright[0] - dark[0]) * clamped);
  const g = Math.round(dark[1] + (bright[1] - dark[1]) * clamped);
  const b = Math.round(dark[2] + (bright[2] - dark[2]) * clamped);
  return `rgb(${r}, ${g}, ${b})`;
}
