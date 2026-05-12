import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** When the UI runs in Docker, point at the API service name; on host, use localhost. */
const veriflowApiProxyTarget =
  process.env.VERIFLOW_API_PROXY_TARGET?.trim() || "http://127.0.0.1:8001";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
    proxy: {
      // Browser uses same origin (dev server port); Vite forwards to websocket-api.
      "/__veriflow": {
        target: veriflowApiProxyTarget,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/__veriflow/, ""),
        ws: true,
      },
    },
  },
});
