import { execSync } from "node:child_process";
import { defineConfig } from "vite";

// Cross-origin isolation (COOP/COEP) enables SharedArrayBuffer, which
// multi-threaded WASM inference needs. The production host must send the
// same headers; see docs/decisions.md (Phase 1).
const crossOriginIsolation = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp"
};

/**
 * The commit being built, for the footer's AGPL source link (docs/decisions.md §10):
 * Vercel's system variable, else git, else none (the link then points at the repository).
 */
function sourceCommit(): string {
    if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
    try {
        return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
            .toString()
            .trim();
    } catch {
        return "";
    }
}

export default defineConfig({
    define: { __SOURCE_COMMIT__: JSON.stringify(sourceCommit()) },
    server: {
        headers: crossOriginIsolation,
        // The archived project must never be served or watched.
        watch: { ignored: ["**/old/**", "**/test-vid/**", "**/test-img/**"] }
    },
    preview: { headers: crossOriginIsolation },
    worker: { format: "es" },
    optimizeDeps: { entries: ["index.html"] }
});
