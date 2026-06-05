import { defineConfig } from "vitest/config";
import { config } from "./vitest.config";

export default defineConfig({
  ...config,
  test: {
    ...config.test,
    setupFiles: [], // this explicitly ignores global_mocks.ts which is specified in vitest.config.ts
    include: ["./frontend/javascripts/test/browser/**/*.browser_spec.ts"],
  },
});
