/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the build works from any folder (GitHub Pages, Netlify, Vercel, a USB stick).
export default defineConfig({
  base: "./",
  plugins: [react()],
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
