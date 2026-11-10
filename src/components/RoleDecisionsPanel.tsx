import { useEffect, useRef, useState } from "react";
import {
  getIpRolesReviewIpRolesIpGet,
  decideIpRolesReviewIpRolesIpDecisionsPost,
  type IpRole,
  type RoleDoc,
  type RoleDecisionsResult,
} from "../api/netflow-rollups-client";
import { BTN_APPROVE } from "./reviewControls";
import { errorMessage } from "../lib/errors";

// "Decide several / add a role": the analyst's own answer for one IP, staged here and sent
// as ONE request to POST /review/ip-roles/{ip}/decisions, which writes all of it or none.
// Nothing is sent until Submit. A role a rule or the model proposed is a proposal; only what
// is submitted here becomes a reviewed role. A confirm on a role the IP has no row for at all
// (in any status) is an *assert*: no rule's evidence stands behind it, so a note is required.

type Choice = "confirm" | "reject" | "leave";
export type RolePreset = { reject?: string; confirm?: string };

const WAITING = new Set(["suggested", "agentic_evaluation"]);

const SELECT_STYLE: React.CSSProperties = {
  background: "#0A2224",
  color: "#E8FFF8",
  border: "1px solid #2B7266",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 12,
};

// A refusal is `detail`: one string with a line per wrong entry (the writer's own refusal),
// or a list of {msg} objects (the body's validation). Anything without a `detail` is not a
// refusal at all (network, server error), so "nothing was written" cannot be claimed for it.
function parseRefusal(err: unknown): { lines: string[]; refused: boolean } {
  const detail = err && typeof err === "object" ? (err as { detail?: unknown }).detail : undefined;
  if (typeof detail === "string") return { lines: detail.split("\n").map((s) => s.trim()).filter(Boolean), refused: true };
  if (Array.isArray(detail)) {
    return {
      lines: detail.map((d) => (d && typeof d === "object" && typeof (d as { msg?: unknown }).msg === "string" ? (d as { msg: string }).msg : JSON.stringify(d))),
      refused: true,
    };
  }
  return { lines: [errorMessage(err)], refused: false };
}

function ChoiceButton({ active, kind, onClick, children }: { active: boolean; kind: Choice; onClick: () => void; children: React.ReactNode }) {
  const on =
    kind === "confirm"
      ? { background: "#153226", color: "#3DD68C", borderColor: "#1E4D37" }
      : kind === "reject"
        ? { background: "#241518", color: "#E5484D", borderColor: "#442025" }
        : { background: "#133A3C", color: "#E8FFF8", borderColor: "#3F9C8A" };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="chip"
      style={{ cursor: "pointer", border: "1px solid", ...(active ? on : { background: "transparent", color: "#A6D8CD", borderColor: "#2B7266" }) }}
    >
      {children}
    </button>
  );
}

export function RoleDecisionsPanel({
  ip,
  vantage,
  ownRole,
  roles,
  preset,
  onDecided,
}: {
  ip: string;
  vantage: "watched" | "peer";
  ownRole: string;
  roles: Map<string, RoleDoc>;
  preset: RolePreset | null;
  onDecided: (result: RoleDecisionsResult) => void;
}) {
  const [rows, setRows] = useState<IpRole[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Map<string, Choice>>(new Map());
  const [added, setAdded] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<{ lines: string[]; refused: boolean } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const presetRef = useRef(preset);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setLoadError(null);
    getIpRolesReviewIpRolesIpGet({ path: { ip }, throwOnError: true })
      .then((r) => {
        if (cancelled) return;
        const all = r.data.rows;
        const initial = new Map<string, Choice>();
        const initialAdded: string[] = [];
        const p = reload === 0 ? presetRef.current : null; // a preset applies on open only, not after a submit
        if (p) {
          const waiting = new Set(all.filter((x) => WAITING.has(x.status)).map((x) => x.role));
          if (p.reject && waiting.has(p.reject)) initial.set(p.reject, "reject");
          if (p.confirm) {
            const existing = all.find((x) => x.role === p.confirm);
            if (existing && WAITING.has(existing.status)) initial.set(p.confirm, "confirm");
            else if (!existing || existing.status === "rejected") initialAdded.push(p.confirm);
          }
        }
        setRows(all);
        setChoices(initial);
        setAdded(initialAdded);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ip, reload]);

  const byRole = new Map((rows ?? []).map((r) => [r.role, r]));
  const waiting = (rows ?? [])
    .filter((r) => WAITING.has(r.status))
    .sort((a, b) => (a.role === ownRole ? -1 : b.role === ownRole ? 1 : a.role.localeCompare(b.role)));
  const waitingNames = new Set(waiting.map((r) => r.role));
  const confirmedNames = new Set((rows ?? []).filter((r) => r.status === "confirmed").map((r) => r.role));
  const offered = [...roles.values()]
    .filter((r) => r.assertable[vantage] && !r.retired && !confirmedNames.has(r.name) && !waitingNames.has(r.name) && !added.includes(r.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const entries: { role: string; decision: "confirm" | "reject" }[] = [
    ...waiting.filter((r) => (choices.get(r.role) ?? "leave") !== "leave").map((r) => ({ role: r.role, decision: choices.get(r.role) as "confirm" | "reject" })),
    ...added.map((role) => ({ role, decision: "confirm" as const })),
  ];
  const asserts = entries.filter((e) => e.decision === "confirm" && !byRole.has(e.role)).map((e) => e.role);
  const noteMissing = asserts.length > 0 && note.trim() === "";
  const canSubmit = rows !== null && entries.length > 0 && !busy && !noteMissing;

  async function submit() {
    setBusy(true);
    setRefusal(null);
    setDone(null);
    try {
      const text = note.trim();
      const result = await decideIpRolesReviewIpRolesIpDecisionsPost({
        path: { ip },
        body: { decisions: entries, ...(text ? { note: text } : {}) },
        throwOnError: true,
      });
      const summary = result.data.results.map((r) => `${r.role} ${r.decision === "confirm" ? (r.asserted ? "asserted" : "confirmed") : "rejected"}`).join(", ");
      setDone(`Saved: ${summary}.${result.data.rollups ? ` Rollups: ${result.data.rollups}.` : ""}`);
      setNote("");
      setReload((n) => n + 1);
      onDecided(result.data);
    } catch (err) {
      setRefusal(parseRefusal(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12, background: "#0A2224", border: "1px solid #133A3C", borderRadius: 7, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#A6D8CD" }}>Your decision for {ip} — nothing is sent until you submit</span>
        <span className="src">/review/ip-roles/{"{ip}"}/decisions</span>
      </div>
      {preset && (
        <div style={{ fontSize: 12, color: "#6FA89E", marginBottom: 8 }}>
          Staged from the model's alternative. It is only a proposal until you submit.
        </div>
      )}
      {loadError && <div style={{ color: "#E5484D", fontSize: 13 }}>Failed to load this IP's roles: {loadError}</div>}
      {!rows && !loadError && <div style={{ color: "#6FA89E", fontSize: 13 }}>Loading…</div>}

      {rows && (
        <>
          <div style={{ fontSize: 11, color: "#6FA89E", textTransform: "uppercase", margin: "4px 0 6px" }}>Roles waiting for a decision</div>
          {waiting.length === 0 && <div style={{ fontSize: 13, color: "#6FA89E" }}>None waiting any more for this IP.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {waiting.map((r) => {
              const c = choices.get(r.role) ?? "leave";
              return (
                <div key={r.role} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span className="mono" style={{ minWidth: 140, fontSize: 13 }} title={roles.get(r.role)?.meaning}>
                    {r.role}
                    {r.role === ownRole && <span style={{ color: "#6FA89E", fontSize: 11 }}> · this card</span>}
                  </span>
                  {(["confirm", "reject", "leave"] as const).map((k) => (
                    <ChoiceButton key={k} kind={k} active={c === k} onClick={() => setChoices((prev) => new Map(prev).set(r.role, k))}>
                      {k}
                    </ChoiceButton>
                  ))}
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 11, color: "#6FA89E", textTransform: "uppercase", margin: "14px 0 6px" }}>Add a role</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <select
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v) setAdded((prev) => (prev.includes(v) ? prev : [...prev, v]));
              }}
              className="mono"
              style={SELECT_STYLE}
              aria-label="Add a role"
            >
              <option value="">{offered.length === 0 ? "no more roles to add" : "pick a role…"}</option>
              {offered.map((r) => (
                <option key={r.name} value={r.name} title={r.meaning}>
                  {r.name}
                </option>
              ))}
            </select>
            {added.map((role) => (
              <span key={role} className="chip" style={{ background: "#153226", color: "#3DD68C", borderColor: "#1E4D37", display: "inline-flex", gap: 6, alignItems: "center" }}>
                <span className="mono">{role}</span>
                <span style={{ fontSize: 11, color: "#A6D8CD" }}>{byRole.has(role) ? "confirm (rejected earlier)" : "confirm, added by hand"}</span>
                <button
                  type="button"
                  onClick={() => setAdded((prev) => prev.filter((x) => x !== role))}
                  aria-label={`Remove ${role}`}
                  style={{ all: "unset", cursor: "pointer", color: "#A6D8CD" }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          <div style={{ fontSize: 11, color: "#6FA89E", textTransform: "uppercase", margin: "14px 0 6px" }}>
            Note{asserts.length > 0 ? " (required)" : " (optional)"}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Why — kept on every role this submit writes"
            style={{ ...SELECT_STYLE, width: "100%", boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" }}
          />
          {noteMissing && (
            <div style={{ fontSize: 12, color: "#F5A623", marginTop: 4 }}>
              A note is required: {asserts.join(", ")} {asserts.length === 1 ? "is" : "are"} being added by hand, with no rule's evidence behind {asserts.length === 1 ? "it" : "them"}, so your note is the only record of why.
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void submit()}
              style={{ ...BTN_APPROVE, opacity: canSubmit ? 1 : 0.45, cursor: canSubmit ? "pointer" : "not-allowed" }}
            >
              {busy ? "Submitting…" : entries.length === 0 ? "Submit" : `Submit ${entries.length} decision${entries.length === 1 ? "" : "s"}`}
            </button>
            <span style={{ fontSize: 12, color: "#6FA89E" }}>All or nothing: if any entry is refused, none is written.</span>
          </div>
        </>
      )}

      {refusal && (
        <div style={{ marginTop: 10, border: "1px solid #5A2327", borderRadius: 6, padding: "10px 12px", fontSize: 13, color: "#F2B8BA" }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {refusal.refused ? "Refused. Nothing was written; your staged choices are kept." : "The request failed; it is not known whether anything was written. Your staged choices are kept."}
          </div>
          {refusal.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
      {done && <div style={{ marginTop: 10, fontSize: 13, color: "#3DD68C" }}>{done}</div>}
    </div>
  );
}
