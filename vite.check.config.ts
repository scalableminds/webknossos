import baseConfig from "./vite.config";

// Throwaway config for checking this worktree's frontend next to the main clone's dev server.
export default {
  ...baseConfig,
  cacheDir: "/tmp/wk-vite-cache-t3-05e77298",
  server: { ...baseConfig.server, port: 9020, strictPort: true },
};
