import { copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function copyNetlifyToml(): Plugin {
  return {
    name: "copy-netlify-toml",
    closeBundle() {
      copyFileSync(path.resolve(rootDir, "netlify.toml"), path.resolve(rootDir, "dist", "netlify.toml"));
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), copyNetlifyToml()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
});
