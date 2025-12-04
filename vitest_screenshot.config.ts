import { defineConfig } from "vitest/config";
import { config } from "./vitest.config";

export default defineConfig({
  ...config,
  test: {
    ...config.test,
    include: ["./frontend/javascripts/test/puppeteer/*.screenshot.ts"],
  },
});
