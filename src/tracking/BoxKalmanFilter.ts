import type { Box } from "../utils/geometry";

/**
 * Frame rate the noise constants are tuned for. ByteTrack/SORT tune them per
 * frame at ~30 fps; our frames arrive at a variable rate, so every step is
 * expressed in nominal frames: dt seconds = dt * NOMINAL_FPS frames.
 */
export const NOMINAL_FPS = 30;

// ByteTrack's constants (yolox/tracker/kalman_filter.py): noise std relative to the box height.
const STD_WEIGHT_POSITION = 1 / 20;
const STD_WEIGHT_VELOCITY = 1 / 160;
// The aspect ratio (dimension 2) gets fixed, small noise.
const ASPECT_STD_POSITION = 1e-2;
const ASPECT_STD_VELOCITY = 1e-5;
const ASPECT_STD_MEASUREMENT = 1e-1;
const MIN_HEIGHT = 1e-6;

/**
 * Constant-velocity Kalman filter on a box as (center x, center y, aspect
 * ratio w/h, height) plus their velocities: the motion model of SORT and
 * ByteTrack, with a variable time step.
 *
 * ByteTrack's 8-dimensional filter has diagonal noise and a transition that
 * only couples each quantity with its own velocity, so the covariance stays
 * block-diagonal: it is exactly four independent (position, velocity)
 * filters whose noise scales with the current height. That is how it is
 * stored here (2x2 covariance per dimension), which keeps the code small.
 *
 * Units: whatever the boxes use (normalized 0..1 here); velocities are per
 * nominal frame.
 */
export class BoxKalmanFilter {
    /** cx, cy, aspect, height */
    private readonly mean = new Float64Array(4);
    private readonly velocity = new Float64Array(4);
    /** Per dimension: variance of position, covariance, variance of velocity. */
    private readonly cov = new Float64Array(12);

    constructor(box: Box) {
        const z = toMeasurement(box);
        const h = z[3];
        for (let i = 0; i < 4; i++) {
            this.mean[i] = z[i];
            this.velocity[i] = 0;
            const posStd = i === 2 ? ASPECT_STD_POSITION : 2 * STD_WEIGHT_POSITION * h;
            const velStd = i === 2 ? ASPECT_STD_VELOCITY : 10 * STD_WEIGHT_VELOCITY * h;
            this.cov[3 * i] = posStd * posStd;
            this.cov[3 * i + 1] = 0;
            this.cov[3 * i + 2] = velStd * velStd;
        }
    }

    /** Advances the state by `dtSeconds`. Process noise grows linearly with the step. */
    predict(dtSeconds: number): void {
        const k = Math.max(0, dtSeconds) * NOMINAL_FPS;
        if (k === 0) return;
        const h = this.mean[3];
        for (let i = 0; i < 4; i++) {
            const posStd = i === 2 ? ASPECT_STD_POSITION : STD_WEIGHT_POSITION * h;
            const velStd = i === 2 ? ASPECT_STD_VELOCITY : STD_WEIGHT_VELOCITY * h;
            this.mean[i] += this.velocity[i] * k;
            const p00 = this.cov[3 * i];
            const p01 = this.cov[3 * i + 1];
            const p11 = this.cov[3 * i + 2];
            // P' = F P F^T + Q k, with F = [[1, k], [0, 1]].
            this.cov[3 * i] = p00 + 2 * k * p01 + k * k * p11 + posStd * posStd * k;
            this.cov[3 * i + 1] = p01 + k * p11;
            this.cov[3 * i + 2] = p11 + velStd * velStd * k;
        }
        this.mean[3] = Math.max(this.mean[3], MIN_HEIGHT);
    }

    /** Corrects the (already predicted) state with a measured box. */
    update(box: Box): void {
        const z = toMeasurement(box);
        const h = this.mean[3];
        for (let i = 0; i < 4; i++) {
            const rStd = i === 2 ? ASPECT_STD_MEASUREMENT : STD_WEIGHT_POSITION * h;
            const p00 = this.cov[3 * i];
            const p01 = this.cov[3 * i + 1];
            const p11 = this.cov[3 * i + 2];
            const s = p00 + rStd * rStd;
            const k0 = p00 / s;
            const k1 = p01 / s;
            const innovation = z[i] - this.mean[i];
            this.mean[i] += k0 * innovation;
            this.velocity[i] += k1 * innovation;
            this.cov[3 * i] = p00 - k0 * p00;
            this.cov[3 * i + 1] = p01 - k0 * p01;
            this.cov[3 * i + 2] = p11 - k1 * p01;
        }
        this.mean[3] = Math.max(this.mean[3], MIN_HEIGHT);
    }

    /** ByteTrack stops the height velocity of tracks that are not being seen, so lost boxes don't grow or shrink. */
    stopHeightVelocity(): void {
        this.velocity[3] = 0;
    }

    /** The box now, or extrapolated `aheadSeconds` from now (state unchanged). */
    box(aheadSeconds = 0): Box {
        const k = aheadSeconds * NOMINAL_FPS;
        const cx = this.mean[0] + this.velocity[0] * k;
        const cy = this.mean[1] + this.velocity[1] * k;
        const aspect = this.mean[2] + this.velocity[2] * k;
        const height = Math.max(this.mean[3] + this.velocity[3] * k, MIN_HEIGHT);
        const width = Math.max(aspect * height, 0);
        return { x: cx - width / 2, y: cy - height / 2, width, height };
    }

    /** Velocity of the box center, box units per second. */
    centerVelocity(): { x: number; y: number } {
        return { x: this.velocity[0] * NOMINAL_FPS, y: this.velocity[1] * NOMINAL_FPS };
    }
}

function toMeasurement(box: Box): [number, number, number, number] {
    const height = Math.max(box.height, MIN_HEIGHT);
    return [box.x + box.width / 2, box.y + box.height / 2, box.width / height, height];
}
