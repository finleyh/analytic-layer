import { client } from "./netflow-rollups/client.gen";

// Generated client.gen.ts hardcodes the OpenAPI spec's server URL
// (http://localhost:8010). Point it at the Vite dev proxy instead, so the
// browser never needs NETFLOW_ROLLUPS_API_TOKEN — vite.config.ts attaches
// the Authorization header server-side.
client.setConfig({ baseUrl: "/api/netflow-rollups" });

export * from "./netflow-rollups";
