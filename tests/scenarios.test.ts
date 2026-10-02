/**
 * Runs the pre-existing synthetic scenario scripts (their own tiny assert
 * runner, exit code 1 on any failure) as part of `npm test`, so the V1
 * detector/tracker regression suites can't silently rot while the V2 work
 * adds Vitest tests alongside them.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runScenario(script: string): string {
    return execFileSync(process.execPath, ["--import", "tsx", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

describe("synthetic scenario scripts", () => {
    it("scripts/detectorScenarios.ts passes", () => {
        expect(runScenario("scripts/detectorScenarios.ts")).toMatch(/\b0 failed\b/);
    }, 120_000);

    it("scripts/trackerScenarios.ts passes", () => {
        expect(runScenario("scripts/trackerScenarios.ts")).toMatch(/\b0 failed\b/);
    }, 60_000);
});
