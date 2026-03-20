import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  cacheDir: "/tmp/vite-cache",
  // GitHub Pages serves from /skyshield/ — use env var so local dev still works
  base: process.env.GITHUB_ACTIONS ? "/skyshield/" : "/",
  resolve: {
    alias: {
      "@skyshield/game": path.resolve(__dirname, "../src/game"),
    },
  },
  server: {
    port: 5173,
  },
});
