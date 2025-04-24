import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./frontend/javascripts/test/global_mocks.ts"],
    include: [
      "./frontend/javascripts/test/**/*.{spec,e2e}.ts",
      "./frontend/javascripts/test/puppeteer/*.{wkorg_screenshot,screenshot}.ts",
    ],
    exclude: [],
    env: { IS_TESTING: "true" },
    testTimeout: 10000,
    coverage: {
      reporter: ["text", "json-summary", "json"],
      reportOnFailure: true,
    },
  },
  plugins: [tsconfigPaths()],
});
