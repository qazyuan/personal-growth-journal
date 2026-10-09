import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  clean: true,
  outDir: "dist",
  sourcemap: true,
  noExternal: ["@journal/contracts", "@journal/database"],
});
