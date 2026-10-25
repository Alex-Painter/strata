import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * Two builds from one app:
 * - default: dist/, the app the server serves.
 * - `--mode static`: dist-static/index.html, one self-contained file the CLI
 *   fills with a report (see src/lib/static-report.ts for the contract).
 */
export default defineConfig(({ mode }) => {
  const isStatic = mode === "static";
  return {
    plugins: [react(), tailwindcss(), ...(isStatic ? [viteSingleFile()] : [])],
    build: {
      outDir: isStatic ? "dist-static" : "dist",
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      strictPort: true,
      // The API server runs on 8787 in dev. Proxying keeps the app, the API
      // and the OAuth callback on one origin, so cookies just work.
      proxy: {
        "/api": "http://localhost:8787",
        "/auth": "http://localhost:8787",
      },
    },
  };
});
