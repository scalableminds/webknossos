import { defineConfig } from "vitest/config";
import tsconfigPaths from 'vite-tsconfig-paths'


export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./frontend/javascripts/test/setup.ts'],
  },
  plugins: [tsconfigPaths()]
}); 