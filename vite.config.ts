import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import path from "path";

const RAVEN_TARGET = process.env.VITE_RAVEN_TARGET ?? "https://raven.hisoka.io";

export default defineConfig({
  plugins: [react(), tailwindcss(), wasm()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  optimizeDeps: {
    exclude: ["raven-inspire-client-wasm"],
  },
  define: {
    "process.env": JSON.stringify({}),
  },
  worker: {
    format: "es",
  },
  server: {
    port: 5173,
    proxy: {
      "/raven": {
        target: RAVEN_TARGET,
        changeOrigin: true,
        secure: true,
        rewrite: (p: string) => p.replace(/^\/raven/, ""),
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/raven": {
        target: RAVEN_TARGET,
        changeOrigin: true,
        secure: true,
        rewrite: (p: string) => p.replace(/^\/raven/, ""),
      },
    } as never,
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
});
