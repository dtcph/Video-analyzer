import { cpSync, mkdirSync } from "node:fs";
mkdirSync("public/wasm", { recursive: true });
cpSync("node_modules/@mediapipe/tasks-vision/wasm", "public/wasm", { recursive: true });
