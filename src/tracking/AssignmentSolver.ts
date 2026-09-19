/**
 * Global (Hungarian / Kuhn-Munkres) bipartite assignment: given a cost
 * matrix, finds the row-to-column assignment that minimizes total cost
 * across ALL pairs at once, rather than each row greedily grabbing its
 * own best column. That's what keeps two tracks near the same blob
 * from both being greedily pulled toward whichever one happens first —
 * a classic source of ID switches on crossing objects — since the
 * globally optimal assignment reasons about every track and detection
 * together.
 *
 * O(n^2 * m) — trivial at the scale of blobs this app expects (tens,
 * not thousands) per frame. Rectangular matrices (unequal track/blob
 * counts) are supported directly; unfilled cells should be a very
 * large but finite cost (see HungarianBlobMatcher.GATED_OUT_COST) — use
 * Infinity/NaN nowhere in the matrix, since the algorithm's arithmetic
 * (potentials, reduced costs) needs finite values throughout.
 *
 * Implementation follows the standard shortest-augmenting-path /
 * potentials formulation (the same one commonly attributed to
 * cp-algorithms.com's "Assignment problem" writeup), adapted to
 * TypeScript with a plain row->column result instead of raw duals.
 */
export function solveAssignment(costMatrix: number[][]): number[] {
    const rows = costMatrix.length;
    if (rows === 0) return [];
    const cols = costMatrix[0].length;
    if (cols === 0) return rows > 0 ? new Array(rows).fill(-1) : [];

    // The reference algorithm assumes rows <= cols; transpose if not,
    // then map the result back.
    if (rows > cols) {
        const transposed: number[][] = Array.from({ length: cols }, (_, c) => costMatrix.map((row) => row[c]));
        const colForRow = solveAssignment(transposed); // colForRow[c] = row assigned to (transposed-)row c, i.e. original column c's assigned row
        const rowForOriginalRow = new Array(rows).fill(-1);
        for (let c = 0; c < cols; c++) {
            const r = colForRow[c];
            if (r !== -1) rowForOriginalRow[r] = c;
        }
        return rowForOriginalRow;
    }

    const n = rows;
    const m = cols;
    const INF = Number.POSITIVE_INFINITY;

    // 1-indexed internal arrays, matching the reference formulation.
    const u = new Array(n + 1).fill(0);
    const v = new Array(m + 1).fill(0);
    const p = new Array(m + 1).fill(0); // p[j] = row (1-indexed) currently assigned to column j
    const way = new Array(m + 1).fill(0);

    for (let i = 1; i <= n; i++) {
        p[0] = i;
        let j0 = 0;
        const minv = new Array(m + 1).fill(INF);
        const used = new Array(m + 1).fill(false);

        do {
            used[j0] = true;
            const i0 = p[j0];
            let delta = INF;
            let j1 = -1;
            for (let j = 1; j <= m; j++) {
                if (used[j]) continue;
                const cur = costMatrix[i0 - 1][j - 1] - u[i0] - v[j];
                if (cur < minv[j]) {
                    minv[j] = cur;
                    way[j] = j0;
                }
                if (minv[j] < delta) {
                    delta = minv[j];
                    j1 = j;
                }
            }
            for (let j = 0; j <= m; j++) {
                if (used[j]) {
                    u[p[j]] += delta;
                    v[j] -= delta;
                } else {
                    minv[j] -= delta;
                }
            }
            j0 = j1;
        } while (p[j0] !== 0);

        while (j0) {
            const j1 = way[j0];
            p[j0] = p[j1];
            j0 = j1;
        }
    }

    const colForRow = new Array(n).fill(-1);
    for (let j = 1; j <= m; j++) {
        if (p[j] !== 0) colForRow[p[j] - 1] = j - 1;
    }
    return colForRow;
}
