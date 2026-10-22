import { useState, type MouseEvent } from "react";

// Generalized from CopyIpButton once a second kind of value (a content
// hash, not just an IP) needed the same affordance — same shape, applied
// twice because it's genuinely the same problem twice.
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard access can be denied (permissions, insecure context); fail quietly
    }
  }

  return (
    <button
      onClick={handleCopy}
      title={copied ? "Copied" : label}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        marginLeft: 6,
        borderRadius: 4,
        color: copied ? "#3DD68C" : "#6FA89E",
        verticalAlign: "middle",
      }}
    >
      {copied ? (
        <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
          <path d="M1 5L4 8L11 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <rect x="4.5" y="4.5" width="8" height="8" rx="1.3" stroke="currentColor" strokeWidth="1.3" />
          <path d="M2.5 9.5h-1a1 1 0 01-1-1v-7a1 1 0 011-1h7a1 1 0 011 1v1" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      )}
    </button>
  );
}
