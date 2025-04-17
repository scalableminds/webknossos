import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./frontend/javascripts/test/global_mocks.ts"],
    include: ["./frontend/javascripts/test/**/*.spec.ts", "./frontend/javascripts/test/**/*.e2e.ts"],
    exclude: ["./frontend/javascripts/test/puppeteer/*"],
    env: { IS_TESTING: "true" },
    testTimeout: 10000,
    coverage: {
      reporter: ['text', 'json-summary', 'json'],
      reportOnFailure: true,
    }
  },
  plugins: [tsconfigPaths()],
});
