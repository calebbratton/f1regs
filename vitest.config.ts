import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so unit tests don't start the Workers runtime
// (which needs a Cloudflare login for the remote AI/Vectorize bindings).
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] }
});
