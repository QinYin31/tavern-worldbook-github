import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error The bridge is intentionally shared with the Node runtime.
import { handleApiRequest } from "./server/bridge.mjs";

function localApiBridge(): Plugin {
  return {
    name: "local-api-bridge",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestUrl = (req as { url?: string }).url;
        if (!requestUrl?.startsWith("/api/")) {
          next();
          return;
        }
        void handleApiRequest(req, res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApiBridge()],
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
});
