import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  cacheDir: "/tmp/vite-cache",
  // GitHub Pages serves from /opensentry/ — use env var so local dev still works
  base: process.env.GITHUB_ACTIONS ? "/opensentry/" : "/",
  resolve: {
    alias: {
      "@opensentry/game": path.resolve(__dirname, "../src/game"),
    },
  },
  server: {
    port: 5173,
  },
  test: {
    globals: true,
    environment: "node",
  },
});
