import { defineConfig } from "vite";

// Cross-origin isolation (COOP/COEP) enables SharedArrayBuffer, which
// multi-threaded WASM inference needs. The production host must send the
// same headers; see docs/decisions.md (Phase 1).
const crossOriginIsolation = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp"
};

export default defineConfig({
    server: {
        headers: crossOriginIsolation,
        // The archived project must never be served or watched.
        watch: { ignored: ["**/old/**", "**/test-vid/**", "**/test-img/**"] }
    },
    preview: { headers: crossOriginIsolation },
    worker: { format: "es" },
    optimizeDeps: { entries: ["index.html"] }
});
