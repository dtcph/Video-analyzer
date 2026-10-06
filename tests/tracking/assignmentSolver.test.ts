import { describe, expect, it } from "vitest";
import { solveAssignment } from "../../src/tracking/AssignmentSolver";

function cost(matrix: number[][], assignment: number[]): number {
    return assignment.reduce((sum, col, row) => (col === -1 ? sum : sum + matrix[row][col]), 0);
}

/** Exhaustive minimum over all injective row->column assignments covering min(rows, cols) pairs. */
function bruteForceMinCost(matrix: number[][]): number {
    const rows = matrix.length;
    const cols = matrix[0].length;
    const pairs = Math.min(rows, cols);
    let best = Infinity;
    const usedCols = new Set<number>();
    const visit = (row: number, assigned: number, sum: number) => {
        if (assigned === pairs) {
            best = Math.min(best, sum);
            return;
        }
        if (row === rows) return;
        if (rows - row > pairs - assigned) visit(row + 1, assigned, sum);
        for (let col = 0; col < cols; col++) {
            if (usedCols.has(col)) continue;
            usedCols.add(col);
            visit(row + 1, assigned + 1, sum + matrix[row][col]);
            usedCols.delete(col);
        }
    };
    visit(0, 0, 0);
    return best;
}

function seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 2 ** 32;
        return state / 2 ** 32;
    };
}

describe("solveAssignment", () => {
    it("handles empty input", () => {
        expect(solveAssignment([])).toEqual([]);
        expect(solveAssignment([[], []])).toEqual([-1, -1]);
    });

    it("prefers the global optimum over greedy choices", () => {
        // Greedy row 0 -> col 0 (cost 1) forces row 1 -> col 1 (cost 10): total 11. Optimal is 2 + 2 = 4.
        const matrix = [
            [1, 2],
            [2, 10]
        ];
        expect(solveAssignment(matrix)).toEqual([1, 0]);
    });

    it("leaves extra rows unassigned when rows > cols", () => {
        const result = solveAssignment([[5], [1], [3]]);
        expect(result).toEqual([-1, 0, -1]);
    });

    it("matches brute force on random rectangular matrices", () => {
        const random = seededRandom(42);
        for (let trial = 0; trial < 200; trial++) {
            const rows = 1 + Math.floor(random() * 5);
            const cols = 1 + Math.floor(random() * 5);
            const matrix = Array.from({ length: rows }, () =>
                Array.from({ length: cols }, () => Math.round(random() * 100))
            );
            const result = solveAssignment(matrix);

            const assignedCols = result.filter((col) => col !== -1);
            expect(assignedCols.length).toBe(Math.min(rows, cols));
            expect(new Set(assignedCols).size).toBe(assignedCols.length);
            expect(cost(matrix, result)).toBe(bruteForceMinCost(matrix));
        }
    });
});
