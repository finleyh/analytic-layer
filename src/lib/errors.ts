// A readable message from whatever a call threw. The generated client (hey-api) throws
// the *parsed response body* on a non-2xx, not an Error -- netflow-rollups answers
// {"detail": "..."} (a string, or a list of validation errors) -- so
// `err instanceof Error ? err.message : String(err)` printed "[object Object]".
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const detail = (err as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail.map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : JSON.stringify(d))).join("; ");
    }
    try {
      return JSON.stringify(err);
    } catch {
      /* fall through */
    }
  }
  return String(err);
}
