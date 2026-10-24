/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  // Only the version string is bundled (not the whole package.json).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    css: false,
  },
});
