import type { Detection } from "../inference/postprocess";

/** One analyzed frame: its media time and every detection above the worker's score floor (all classes). */
export interface AnalysisSample {
    time: number;
    detections: Detection[];
}

/**
 * Detection results of a pre-analysis, in time order. Holds every class the
 * model returned (user decision 2026-10-03), so a change of confidence, class
 * selection or tracker settings only needs a new tracking pass over the
 * cache, not a new decode + inference pass.
 *
 * An interface so a persistent implementation (IndexedDB) can be added later;
 * InMemoryAnalysisCache is the only one now.
 */
export interface AnalysisCache {
    /** Number of samples. */
    readonly length: number;
    /** Appends a sample; times must increase. */
    add(sample: AnalysisSample): void;
    at(index: number): AnalysisSample;
    time(index: number): number;
    /** Index of the last sample at or before `time` (+ a small tolerance), or -1. */
    indexAtOrBefore(time: number): number;
    lastTime(): number | null;
    /** Approximate memory held, bytes. */
    byteSize(): number;
}

/** Detection fields per stored row: classId, score, x, y, width, height. */
const STRIDE = 6;
/** A displayed frame matches a sample up to this much media time (seek landing, float rounding). */
const TIME_TOLERANCE = 0.002;

/** Samples in memory; detections packed into one Float32Array per sample (24 bytes each). */
export class InMemoryAnalysisCache implements AnalysisCache {
    private readonly times: number[] = [];
    private readonly rows: Float32Array[] = [];

    get length(): number {
        return this.times.length;
    }

    add(sample: AnalysisSample): void {
        const last = this.lastTime();
        if (last !== null && sample.time <= last) {
            throw new Error(`AnalysisCache: sample time ${sample.time} is not after ${last}`);
        }
        const packed = new Float32Array(sample.detections.length * STRIDE);
        sample.detections.forEach((d, i) => {
            packed.set([d.classId, d.score, d.box.x, d.box.y, d.box.width, d.box.height], i * STRIDE);
        });
        this.times.push(sample.time);
        this.rows.push(packed);
    }

    at(index: number): AnalysisSample {
        const packed = this.rows[index];
        const detections: Detection[] = [];
        for (let i = 0; i < packed.length; i += STRIDE) {
            detections.push({
                classId: packed[i],
                score: packed[i + 1],
                box: { x: packed[i + 2], y: packed[i + 3], width: packed[i + 4], height: packed[i + 5] }
            });
        }
        return { time: this.times[index], detections };
    }

    time(index: number): number {
        return this.times[index];
    }

    indexAtOrBefore(time: number): number {
        return lastIndexAtOrBefore(this.times, time + TIME_TOLERANCE);
    }

    lastTime(): number | null {
        return this.times.length ? this.times[this.times.length - 1] : null;
    }

    byteSize(): number {
        let bytes = this.times.length * 8;
        for (const row of this.rows) bytes += row.byteLength;
        return bytes;
    }
}

/** Binary search: index of the last value ≤ `target` in ascending `values`, or -1. */
export function lastIndexAtOrBefore(values: readonly number[], target: number): number {
    let lo = 0;
    let hi = values.length - 1;
    let found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (values[mid] <= target) {
            found = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return found;
}
