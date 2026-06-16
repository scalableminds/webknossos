/*
 * Config for executing *.browser_spec.ts tests. These use playwright
 * to execute tests in a browser (headless). The tests are similar to
 * the screenshot tests, but the assertions are not built on comparing
 * pictures. Instead, they use the frontend and backend APIs to set up
 * tests and assert expected states.
 *
 * NOTE: Currently, these tests are not executed automatically in the CI
 * for resource and performance reasons. Execute them manually if critical
 * parts (especially related to live collaboration) change.
 */

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
