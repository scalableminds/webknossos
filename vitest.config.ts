import { defineConfig } from "vitest/config";
import tsconfigPaths from 'vite-tsconfig-paths'


export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./frontend/javascripts/test/setup.ts'],
    include: ['./frontend/javascripts/test/**/*.ts'],
    exclude: ['./frontend/javascripts/test/**/*.e2e.ts']
  },
  plugins: [tsconfigPaths()]
}); 