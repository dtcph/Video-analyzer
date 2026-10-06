import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
const notices = readFileSync("public/THIRD_PARTY_NOTICES.txt", "utf8");

describe("public/THIRD_PARTY_NOTICES.txt", () => {
    const dependencies = Object.keys((readJson("package.json").dependencies ?? {}) as Record<string, string>);

    it.each(dependencies)("names %s at its installed version with its license", (name) => {
        const installed = readJson(`node_modules/${name}/package.json`) as { version: string; license: string };
        expect(notices).toContain(`${name} ${installed.version}`);
        const licenseName = { MIT: "MIT License", "MPL-2.0": "Mozilla Public License" }[installed.license];
        expect(licenseName, `no license text mapping for ${installed.license}`).toBeDefined();
        expect(notices).toContain(licenseName);
    });

    it("pins runtime dependencies exactly, so the notices cannot fall behind an update", () => {
        const versions = Object.values((readJson("package.json").dependencies ?? {}) as Record<string, string>);
        for (const version of versions) expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("ships ONNX Runtime's own third-party notices", () => {
        const ort = readFileSync("public/ONNXRUNTIME_THIRD_PARTY_NOTICES.txt", "utf8");
        expect(ort.startsWith("THIRD PARTY SOFTWARE NOTICES AND INFORMATION")).toBe(true);
    });
});
