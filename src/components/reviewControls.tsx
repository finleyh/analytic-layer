// Buttons and the decided chip shared by the review queues on the Candidates page.

const BTN_BASE: React.CSSProperties = {
  all: "unset",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 500,
  padding: "9px 18px",
  borderRadius: 6,
  textAlign: "center",
};
export const BTN_REJECT: React.CSSProperties = {
  ...BTN_BASE,
  background: "#241518",
  color: "#E5484D",
  border: "1px solid #442025",
};
export const BTN_APPROVE: React.CSSProperties = {
  ...BTN_BASE,
  background: "#153226",
  color: "#3DD68C",
  border: "1px solid #1E4D37",
};

export function DecidedChip({ label, kind, detail }: { label: string; kind: "approve" | "reject"; detail?: string }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <span
        className="chip"
        style={
          kind === "approve"
            ? { background: "#153226", color: "#3DD68C", borderColor: "#1E4D37" }
            : { background: "#241518", color: "#E5484D", borderColor: "#442025" }
        }
      >
        {label}
      </span>
      {detail && <span style={{ fontSize: 11, color: "#6FA89E", maxWidth: 260, textAlign: "right" }}>{detail}</span>}
    </span>
  );
}
