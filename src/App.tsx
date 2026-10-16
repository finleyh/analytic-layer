import { Overview } from "./pages/Overview";

const PAGES = [
  "Overview",
  "Watchlist",
  "Domains",
  "Geo",
  "Flow graph",
  "Top talkers",
  "Candidates",
  "Pipeline health",
];

export function App() {
  return (
    <div style={{ display: "flex", width: "100%", minHeight: "100vh" }}>
      <div
        className="sidebar"
        style={{
          width: 240,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          padding: "24px 16px",
          boxSizing: "border-box",
          gap: 4,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 8px 22px 8px",
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "0.2px" }}>
            CVS Watch
          </span>
        </div>
        {PAGES.map((page) => (
          <a
            key={page}
            href="#"
            className={`navlink ${page === "Overview" ? "active" : "disabled"}`}
            title={page === "Overview" ? undefined : "Not built yet"}
          >
            {page}
          </a>
        ))}
        <div style={{ flex: 1 }} />
        <div
          style={{
            fontSize: 11,
            color: "#6fa89e",
            padding: "10px 8px",
            borderTop: "1px solid rgba(72,196,170,0.3)",
            marginTop: 8,
          }}
        >
          Reading netflow-rollups live via its API
        </div>
      </div>

      <div style={{ flex: "1 1 0", minWidth: 0, padding: "36px 44px", boxSizing: "border-box" }}>
        <Overview />
      </div>
    </div>
  );
}
