import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss(), wasm()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  define: {
    "process.env": JSON.stringify({}),
  },
  worker: {
    format: "es",
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  build: {
    target: "esnext",
    sourcemap: false,
  },
});
