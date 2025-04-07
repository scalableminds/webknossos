import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./frontend/javascripts/test/global_mocks.ts"],
    include: ["./frontend/javascripts/test/**/*.spec.ts"],
    exclude: ["./frontend/javascripts/test/**/*.e2e.ts"],
    env: { IS_TESTING: "true" },
    testTimeout: 10000,
  },
  plugins: [tsconfigPaths()],
});
