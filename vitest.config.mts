import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __GIT_HASH__: JSON.stringify("test") },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
