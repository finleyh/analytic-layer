import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Dev-time proxy: the browser never sees NETFLOW_ROLLUPS_API_TOKEN or
// SPOILER_ALERT_API_TOKEN. Vite's config runs in Node, so it can read the
// plain (non-VITE_-prefixed) .env values and attach the auth header itself.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api/netflow-rollups": {
          target: env.NETFLOW_ROLLUPS_API_URL,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/netflow-rollups/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader(
                "Authorization",
                `Bearer ${env.NETFLOW_ROLLUPS_API_TOKEN}`,
              );
            });
          },
        },
        "/api/spoiler-alert": {
          target: env.SPOILER_ALERT_API_URL,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/spoiler-alert/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader(
                "x-internal-token",
                env.SPOILER_ALERT_API_TOKEN,
              );
            });
          },
        },
      },
    },
  };
});
