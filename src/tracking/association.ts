import type { Box } from "../utils/geometry";
import { intersectionOverUnion } from "../utils/geometry";
import { solveAssignment } from "./AssignmentSolver";

export interface Associable {
    box: Box;
    classId: number;
    /**
     * Buffered IoU (C-BIoU, Yang et al. 2023): before comparing, both boxes
     * are enlarged by this fraction of their size on each side. Lets a track
     * re-associate with a small or fast object whose box no longer overlaps
     * the prediction. Only read on rows (tracks); 0 or absent = plain IoU.
     */
    buffer?: number;
}

export interface MatchResult {
    /** [row index, column index] pairs. */
    matches: [number, number][];
    unmatchedRows: number[];
    unmatchedCols: number[];
}

/** Finite stand-in for "not allowed" (the solver needs finite costs). */
const GATED_COST = 1e6;

/**
 * Overlap score used for association: IoU, minus `classPenalty` when the
 * classes differ. Matching across classes keeps one track for an object
 * whose label flickers (dog ↔ horse, car ↔ truck); the penalty makes a
 * same-class match win whenever one is about as good.
 */
export function associationScore(a: Associable, b: Associable, classPenalty: number): number {
    const buffer = a.buffer ?? 0;
    const iou = intersectionOverUnion(expand(a.box, buffer), expand(b.box, buffer));
    return a.classId === b.classId ? iou : iou - classPenalty;
}

/**
 * Optimal one-to-one assignment of rows (tracks) to columns (detections) by
 * association score (Hungarian, maximizing the summed score). Pairs scoring
 * below `minScore` are never matched.
 */
export function associate(
    rows: readonly Associable[],
    cols: readonly Associable[],
    minScore: number,
    classPenalty: number
): MatchResult {
    const matches: [number, number][] = [];
    if (rows.length === 0 || cols.length === 0) {
        return { matches, unmatchedRows: rows.map((_, i) => i), unmatchedCols: cols.map((_, j) => j) };
    }

    const scores = rows.map((r) => cols.map((c) => associationScore(r, c, classPenalty)));
    const cost = scores.map((row) => row.map((s) => (s >= minScore ? 1 - s : GATED_COST)));
    const colForRow = solveAssignment(cost);

    const colUsed = new Array<boolean>(cols.length).fill(false);
    const unmatchedRows: number[] = [];
    colForRow.forEach((col, row) => {
        if (col >= 0 && scores[row][col] >= minScore) {
            matches.push([row, col]);
            colUsed[col] = true;
        } else {
            unmatchedRows.push(row);
        }
    });
    const unmatchedCols = cols.map((_, j) => j).filter((j) => !colUsed[j]);
    return { matches, unmatchedRows, unmatchedCols };
}

/**
 * Pairs detections with the tracks drawn at the same time (one-to-one, IoU
 * ≥ `minIou`, same class preferred) and returns each detection's track ID,
 * or undefined. Display only: used to label the paused frame's detections.
 */
export function trackIdsFor(
    detections: readonly Associable[],
    tracks: readonly (Associable & { id: number })[],
    minIou = 0.3,
    classPenalty = 0.2
): (number | undefined)[] {
    const ids: (number | undefined)[] = new Array(detections.length).fill(undefined);
    for (const [row, col] of associate(detections, tracks, minIou, classPenalty).matches) ids[row] = tracks[col].id;
    return ids;
}

function expand(box: Box, buffer: number): Box {
    if (buffer === 0) return box;
    return {
        x: box.x - buffer * box.width,
        y: box.y - buffer * box.height,
        width: box.width * (1 + 2 * buffer),
        height: box.height * (1 + 2 * buffer)
    };
}
