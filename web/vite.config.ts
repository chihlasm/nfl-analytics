import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In development the API runs on :8000; in production Caddy serves both on one origin.
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: false } },
  },
  // No public source maps in production.
  build: { target: "es2022", sourcemap: false },
});
