import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { Overview } from "./pages/Overview";
import { Watchlist } from "./pages/Watchlist";
import { EntityDetail } from "./pages/EntityDetail";
import { CandidateReview } from "./pages/CandidateReview";
import { TopTalkers } from "./pages/TopTalkers";
import { PipelineHealth } from "./pages/PipelineHealth";
import { FlowGraph } from "./pages/FlowGraph";
import { Geo } from "./pages/Geo";

const PAGES: { label: string; path: string }[] = [
  { label: "Overview", path: "/" },
  { label: "Watchlist", path: "/watchlist" },
  { label: "Domains", path: "/domains" },
  { label: "Geo", path: "/geo" },
  { label: "Flow graph", path: "/flow-graph" },
  { label: "Top talkers", path: "/top-talkers" },
  { label: "Candidates", path: "/candidates" },
  { label: "Pipeline health", path: "/pipeline-health" },
];
const BUILT_PATHS = new Set(["/", "/watchlist", "/candidates", "/top-talkers", "/pipeline-health", "/flow-graph", "/geo"]);

function Sidebar() {
  const location = useLocation();
  return (
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
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "0.2px" }}>CVS Watch</span>
      </div>
      {PAGES.map(({ label, path }) =>
        BUILT_PATHS.has(path) ? (
          <Link
            key={path}
            to={path}
            className={`navlink ${location.pathname === path ? "active" : ""}`}
          >
            {label}
          </Link>
        ) : (
          <a key={path} href="#" className="navlink disabled" title="Not built yet">
            {label}
          </a>
        ),
      )}
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
  );
}

export function App() {
  return (
    <BrowserRouter>
      <div style={{ display: "flex", width: "100%", minHeight: "100vh" }}>
        <Sidebar />
        <div style={{ flex: "1 1 0", minWidth: 0, padding: "36px 44px", boxSizing: "border-box" }}>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/entity/:ip" element={<EntityDetail />} />
            <Route path="/candidates" element={<CandidateReview />} />
            <Route path="/top-talkers" element={<TopTalkers />} />
            <Route path="/pipeline-health" element={<PipelineHealth />} />
            <Route path="/flow-graph" element={<FlowGraph />} />
            <Route path="/geo" element={<Geo />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}
