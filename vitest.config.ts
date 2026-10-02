import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        exclude: ["old/**", "node_modules/**", "dist/**"],
        environment: "node"
    }
});
