import { describe, expect, it } from "vitest";
import { formatFileSize, formatTimecode, formatClock } from "../../src/utils/format";

describe("formatTimecode", () => {
    it("formats minutes, seconds and milliseconds", () => {
        expect(formatTimecode(0)).toBe("00:00.000");
        expect(formatTimecode(61.5)).toBe("01:01.500");
        expect(formatTimecode(3599.9994)).toBe("59:59.999");
    });

    it("clamps negative input to zero", () => {
        expect(formatTimecode(-3)).toBe("00:00.000");
    });
});

describe("formatFileSize", () => {
    it("uses binary units", () => {
        expect(formatFileSize(512)).toBe("512 B");
        expect(formatFileSize(1536)).toBe("1.5 KB");
        expect(formatFileSize(500 * 1024 * 1024)).toBe("500.0 MB");
        expect(formatFileSize(3 * 1024 ** 3)).toBe("3.0 GB");
    });
});

describe("formatClock", () => {
    it("formats m:ss and h:mm:ss, rounding down", () => {
        expect(formatClock(0)).toBe("0:00");
        expect(formatClock(12.9)).toBe("0:12");
        expect(formatClock(75)).toBe("1:15");
        expect(formatClock(3725)).toBe("1:02:05");
        expect(formatClock(-3)).toBe("0:00");
    });
});
