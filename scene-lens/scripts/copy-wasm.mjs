import { cpSync, mkdirSync, rmSync } from "node:fs";
// Only the SIMD build: every browser the app supports (desktop Chrome) has WebAssembly SIMD, so the
// no-SIMD fallback (9.4 MB) is never loaded (eval/04-runtime.md).
rmSync("public/wasm", { recursive: true, force: true });
mkdirSync("public/wasm", { recursive: true });
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm"]) cpSync(`node_modules/@mediapipe/tasks-vision/wasm/${f}`, `public/wasm/${f}`);
