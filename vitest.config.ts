import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// This config object is intentionally left under-specified (see config.test.include).
// Other vitest_*.config.ts import this config. Vitest should always be called with
// the --config property (see scripts package.json). This avoids that e2e tests are
// accidentally executed (e.g., if the user executes `yarn vitest`) which would drop
// the current database content.
export const config = {
  test: {
    globals: true,
    setupFiles: ["./frontend/javascripts/test/global_mocks.ts"],
    include: [
      "If you see this, you should use another yarn test-* script or call vitest with the --config option",
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
};

export default defineConfig(config);
