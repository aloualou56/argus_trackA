/// <reference types="vitest" />
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** After a build, writes dist/sw.js from sw-template.js with the list of files and a version hash. */
function offline(): Plugin {
  let outDir = "dist";
  return {
    name: "offline",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const walk = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
        );
      const files = walk(outDir)
        .map((f) => relative(outDir, f).split(sep).join("/"))
        // Recorded narration is kept as it is played, not stored up front; the 3D preview needs the
        // internet anyway, so it is never stored (see sw-template.js).
        .filter((f) => f !== "sw.js" && !f.endsWith(".map") && !f.startsWith("audio/") && !f.startsWith("preview-3d/"))
        .sort();
      const hash = createHash("sha256");
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest("hex").slice(0, 12);
      const template = readFileSync(resolve(__dirname, "sw-template.js"), "utf8");
      const list = JSON.stringify(["./", ...files.map((f) => `./${f}`)]);
      writeFileSync(join(outDir, "sw.js"), template.replace("__VERSION__", version).replace("__FILES__", list));
    },
  };
}

// Relative base so the build works from any folder (GitHub Pages, Netlify, Vercel, a USB stick).
export default defineConfig({
  base: "./",
  plugins: [react(), offline()],
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
