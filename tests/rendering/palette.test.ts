import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NUM_COCO_CLASSES } from "../../src/inference/cocoClasses";
import { classColor, classTextColor } from "../../src/rendering/classColors";
import {
    ACCENTS,
    ACCENT_CYCLE,
    INK,
    PAPER,
    contrastRatio,
    mixHex,
    readableTextColor
} from "../../src/rendering/palette";

const tokens = readFileSync("src/styles/tokens.css", "utf8");
const token = (name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens)?.[1].trim();

describe("palette", () => {
    it("mixes colors in sRGB", () => {
        expect(mixHex("#000000", "#FFFFFF", 0.5)).toBe("#808080");
        expect(mixHex("#123456", "#FFFFFF", 0)).toBe("#123456");
    });

    it("measures WCAG contrast", () => {
        expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
        expect(contrastRatio("#777777", "#777777")).toBe(1);
    });

    it("picks the text color that reads better", () => {
        expect(readableTextColor("#FFFFFF")).toBe(INK);
        expect(readableTextColor("#101010")).toBe(PAPER);
    });

    it.each(Object.entries(ACCENTS))("%s has readable text on it (AA, 4.5:1)", (_name, hex) => {
        expect(contrastRatio(hex, readableTextColor(hex))).toBeGreaterThanOrEqual(4.5);
    });

    it("runs every accent through the color cycle once", () => {
        expect([...ACCENT_CYCLE].sort()).toEqual(Object.keys(ACCENTS).sort());
    });

    it("gives every class a color with readable text on it (AA)", () => {
        for (let id = 0; id < NUM_COCO_CLASSES; id++) {
            expect(contrastRatio(classColor(id), classTextColor(id)), `class ${id}`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it("keeps classes of one group apart and gives the groups different colors", () => {
        // person (People) vs car (Transportation) vs dog (Animals)
        expect(new Set([classColor(0), classColor(2), classColor(16)]).size).toBe(3);
    });
});

describe("tokens.css", () => {
    it.each(Object.entries(ACCENTS))("mirrors the %s accent", (name, hex) => {
        expect(token(`accent-${name}`)?.toUpperCase()).toBe(hex);
    });

    it("mirrors the ground and the text color", () => {
        expect(token("ink-900")?.toUpperCase()).toBe(INK);
        expect(token("paper")?.toUpperCase()).toBe(PAPER);
    });

    it("has the type scale of the design", () => {
        const scale = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "small", "micro"].map((name) => token(`fs-${name}`));
        expect(scale).toEqual([
            "5.61rem",
            "4.209rem",
            "3.157rem",
            "2.369rem",
            "1.777rem",
            "1.333rem",
            "1rem",
            "0.75rem",
            "0.563rem"
        ]);
    });

    it("keeps the gray text readable on the ground (AA)", () => {
        for (const name of ["paper", "gray-300", "gray-400"]) {
            expect(contrastRatio(token(name) ?? "", token("ink-900") ?? "")).toBeGreaterThanOrEqual(4.5);
        }
    });
});
