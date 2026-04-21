import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@llm-bench/shared": path.resolve(rootDir, "../../packages/shared/src/index.ts"),
    },
  },
  server: {
    host: true,
    port: Number(process.env.VITE_DEV_PORT ?? 5173),
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL ?? "http://127.0.0.1:20080",
        changeOrigin: true,
      },
    },
  },
});
