import type { DetectorDebugInfo, FrameAnalysis } from "../analysis/AnalysisTypes";
import { ExposureMaskBit } from "../analysis/AnalysisTypes";
import type { RegionalMotionCell } from "../analysis/GlobalMotionEstimator";

export interface AnalysisVisibility {
  clip: boolean;
  highlight: boolean;
  crushedBlacks: boolean;
  blobs: boolean;
  /** Detector-debug channels (see DetectorDebugInfo) — each independently toggleable, drawn as small thumbnails regardless of the others so they can be compared side by side. Only draw anything when FrameAnalysis.detectorDebug is actually present (AnalysisSettings.detectorDebugEnabled on). */
  rawDiff: boolean;
  compensatedDiff: boolean;
  motionMask: boolean;
  /** Draws MotionCandidateFilter's rejected candidates (dim, with their rejection reason) — explicitly opt-in and separate from the other debug channels, since seeing *why* the detector didn't produce a blob somewhere is a deeper debugging need than the usual "what did it produce" view. */
  rejectedCandidates: boolean;
}

const CLIP_COLOR = [255, 60, 60, 170] as const;
const HIGHLIGHT_COLOR = [255, 220, 0, 130] as const;
const CRUSHED_COLOR = [70, 100, 255, 140] as const;
const BLOB_COLOR = "rgba(255, 165, 0, 0.9)";
const DEBUG_THUMB_WIDTH = 160;
const DEBUG_HUD_COLOR = "rgb(255, 100, 220)";

/**
 * Draws per-pixel exposure-analysis feedback (RGB clipping, luminance
 * highlights, crushed blacks) plus the current frame's raw blob
 * detections (bounding box, center point, temporary per-frame ID) onto
 * the analysis canvas layer. The exposure mask is built from the
 * worker's per-pixel category mask at analysis resolution and scaled
 * up to the video's native size; blob boxes are drawn directly at
 * native size from FrameAnalysis.blobs' normalized coordinates. The
 * original video frame is never touched — this is a separate canvas
 * layered on top of it. Blob IDs here are per-frame detection
 * identifiers only, not persistent tracking IDs (see TrackingOverlay
 * for those).
 */
export class AnalysisOverlay {
  private readonly maskCanvas = document.createElement("canvas");
  private readonly maskCtx: CanvasRenderingContext2D;
  private readonly debugCanvas = document.createElement("canvas");
  private readonly debugCtx: CanvasRenderingContext2D;

  constructor(private readonly ctx: CanvasRenderingContext2D) {
    const maskCtx = this.maskCanvas.getContext("2d");
    if (!maskCtx)
      throw new Error(
        "AnalysisOverlay: could not acquire 2D context for mask canvas",
      );
    this.maskCtx = maskCtx;

    const debugCtx = this.debugCanvas.getContext("2d");
    if (!debugCtx)
      throw new Error(
        "AnalysisOverlay: could not acquire 2D context for debug canvas",
      );
    this.debugCtx = debugCtx;
  }

  clear(): void {
    const { canvas } = this.ctx;
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  render(result: FrameAnalysis | null, visibility: AnalysisVisibility): void {
    this.clear();
    if (!result) return;

    if (visibility.clip || visibility.highlight || visibility.crushedBlacks) {
      this.renderExposureMask(result, visibility);
    }

    if (visibility.blobs) {
      this.renderBlobs(result, Boolean(result.detectorDebug));
    }

    if (result.detectorDebug) {
      if (visibility.rejectedCandidates) this.renderRejectedCandidates(result.detectorDebug);
      this.renderDetectorDebug(result.detectorDebug, visibility);
    }
  }

  private renderExposureMask(
    result: FrameAnalysis,
    visibility: AnalysisVisibility,
  ): void {
    const { canvas } = this.ctx;
    const { width, height, exposureMask } = result;

    this.maskCanvas.width = width;
    this.maskCanvas.height = height;
    const maskImage = this.maskCtx.createImageData(width, height);

    for (let p = 0; p < exposureMask.length; p++) {
      const bits = exposureMask[p];
      let color: readonly [number, number, number, number] | null = null;

      if (visibility.clip && bits & ExposureMaskBit.Clip) color = CLIP_COLOR;
      else if (visibility.highlight && bits & ExposureMaskBit.Highlight)
        color = HIGHLIGHT_COLOR;
      else if (visibility.crushedBlacks && bits & ExposureMaskBit.CrushedBlack)
        color = CRUSHED_COLOR;

      if (!color) continue;
      const o = p * 4;
      maskImage.data[o] = color[0];
      maskImage.data[o + 1] = color[1];
      maskImage.data[o + 2] = color[2];
      maskImage.data[o + 3] = color[3];
    }

    this.maskCtx.putImageData(maskImage, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(
      this.maskCanvas,
      0,
      0,
      width,
      height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }

  /**
   * `showMotionDebug` adds a persistence count and a direction arrow
   * (from BlobData.persistence/motionDx/motionDy — see MotionCandidate)
   * next to each blob's label, only when AnalysisSettings.detectorDebugEnabled
   * is on: this is detection-level debug information (how many frames a
   * candidate has held together, which way it's been moving), not part
   * of the normal "here are this frame's blobs" view.
   */
  private renderBlobs(result: FrameAnalysis, showMotionDebug: boolean): void {
    const { canvas } = this.ctx;

    for (const blob of result.blobs) {
      const x = blob.x * canvas.width;
      const y = blob.y * canvas.height;
      const w = blob.width * canvas.width;
      const h = blob.height * canvas.height;
      const cx = blob.centerX * canvas.width;
      const cy = blob.centerY * canvas.height;

      this.ctx.save();
      this.ctx.strokeStyle = BLOB_COLOR;
      this.ctx.lineWidth = 4.5;
      this.ctx.strokeRect(x, y, w, h);

      this.ctx.fillStyle = BLOB_COLOR;
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.font = "bold 16px monospace";
      this.ctx.fillText(
        `BLOB ${String(blob.id).padStart(2, "0")}`,
        x,
        y + h + 18,
      );

      if (showMotionDebug && blob.persistence !== undefined) {
        this.ctx.font = "11px monospace";
        this.ctx.fillText(`persist ${blob.persistence}`, x, y + h + 34);

        if (blob.motionDx !== undefined && blob.motionDy !== undefined) {
          const scale = 8; // exaggerate for legibility, same convention as TrackingOverlay's velocity vector
          const dx = blob.motionDx * canvas.width * scale;
          const dy = blob.motionDy * canvas.height * scale;
          this.ctx.strokeStyle = DEBUG_HUD_COLOR;
          this.ctx.lineWidth = 2;
          this.ctx.beginPath();
          this.ctx.moveTo(cx, cy);
          this.ctx.lineTo(cx + dx, cy + dy);
          this.ctx.stroke();
        }
      }

      this.ctx.restore();
    }
  }

  /** Draws every candidate MotionCandidateFilter rejected this frame — dim, labeled with its rejection reason, and deliberately visually de-emphasized relative to accepted blobs since this is a "why not" view, opt-in via AnalysisVisibility.rejectedCandidates. */
  private renderRejectedCandidates(debug: DetectorDebugInfo): void {
    const { canvas } = this.ctx;
    this.ctx.save();
    this.ctx.strokeStyle = "rgba(255, 80, 80, 0.5)";
    this.ctx.fillStyle = "rgba(255, 80, 80, 0.85)";
    this.ctx.lineWidth = 1.5;
    this.ctx.font = "10px monospace";
    this.ctx.setLineDash([3, 2]);

    for (const candidate of debug.rejectedCandidates) {
      const x = candidate.x * canvas.width;
      const y = candidate.y * canvas.height;
      const w = candidate.width * canvas.width;
      const h = candidate.height * canvas.height;
      this.ctx.strokeRect(x, y, w, h);
      this.ctx.fillText(candidate.reason ?? "rejected", x, y - 3);
    }

    this.ctx.restore();
  }

  /**
   * Draws whichever detector-debug channels are toggled on as small
   * grayscale thumbnails stacked in the top-right corner, plus a text
   * HUD for the global-motion vector/confidence — lets a user see
   * exactly where in the pipeline (diff -> camera compensation ->
   * threshold+morphology -> contours) a given frame's blobs came from,
   * each channel independently toggleable rather than one all-or-nothing
   * debug mode. Thumbnails, not full-canvas overlays, so they don't
   * obscure the main blob/exposure view they're meant to explain.
   */
  private renderDetectorDebug(debug: DetectorDebugInfo, visibility: AnalysisVisibility): void {
    const { canvas } = this.ctx;
    const { width, height } = debug;
    const thumbHeight = Math.round((DEBUG_THUMB_WIDTH * height) / width);

    this.debugCanvas.width = width;
    this.debugCanvas.height = height;

    const channels: { label: string; data: Uint8Array; show: boolean }[] = [
      { label: "RAW DIFF", data: debug.rawDiff, show: visibility.rawDiff },
      { label: "COMPENSATED DIFF", data: debug.compensatedDiff, show: visibility.compensatedDiff },
      { label: "MOTION MASK", data: debug.motionMask, show: visibility.motionMask }
    ];

    let y = 8;
    for (const channel of channels) {
      if (!channel.show) continue;
      this.drawGrayscaleThumbnail(channel.data, width, height, canvas.width - DEBUG_THUMB_WIDTH - 8, y, thumbHeight, channel.label);
      y += thumbHeight + 22;
    }

    const motion = debug.globalMotion;
    if (visibility.rawDiff || visibility.compensatedDiff || visibility.motionMask) {
      this.ctx.save();
      this.ctx.font = "bold 11px monospace";
      this.ctx.fillStyle = DEBUG_HUD_COLOR;
      const lines = [
        `camera dx ${motion.dx.toFixed(1)}px dy ${motion.dy.toFixed(1)}px conf ${motion.confidence.toFixed(2)} ${motion.valid ? "(compensating)" : "(not compensating)"}`,
        `model ${motion.model} | inliers ${(motion.inlierRatio * 100).toFixed(0)}% | residual ${motion.residualError.toFixed(2)}px | parallax ${motion.parallaxDetected ? "YES" : "no"}`
      ];
      let textY = y + 4;
      for (const line of lines) {
        this.ctx.fillText(line, canvas.width - DEBUG_THUMB_WIDTH - 8, textY);
        textY += 14;
      }
      this.ctx.restore();

      this.renderRegionalMotionField(motion.regionalMotion, width, height);
    }
  }

  /**
   * Draws each RegionalMotionCell's residual displacement as a small
   * arrow at its cell's own center on the main canvas — the ASCII
   * "motion field" the debug spec asked for, made concrete: this is
   * where a genuine parallax/depth-layer residual (arrows of visibly
   * different length/direction across cells) is visually distinguished
   * from ordinary noise (short, inconsistent arrows) or a clean single
   * camera motion (all near-zero, since the global model already
   * explains it). Non-coherent cells (too few samples, or too much
   * internal disagreement to trust — see GlobalMotionEstimator) are
   * drawn faint/dashed rather than omitted, so their absence of evidence
   * is itself visible instead of silently blank.
   */
  private renderRegionalMotionField(cells: RegionalMotionCell[], debugWidth: number, debugHeight: number): void {
    if (cells.length === 0) return;
    const { canvas } = this.ctx;
    const gridSize = Math.round(Math.sqrt(cells.length));
    const scale = 6; // exaggerate for legibility, same convention as blob/track velocity vectors elsewhere

    this.ctx.save();
    for (const cell of cells) {
      const cx = ((cell.col + 0.5) / gridSize) * debugWidth * (canvas.width / debugWidth);
      const cy = ((cell.row + 0.5) / gridSize) * debugHeight * (canvas.height / debugHeight);
      const dx = cell.dx * scale;
      const dy = cell.dy * scale;

      this.ctx.strokeStyle = cell.coherent ? "rgba(255, 100, 220, 0.85)" : "rgba(255, 100, 220, 0.3)";
      this.ctx.fillStyle = this.ctx.strokeStyle;
      this.ctx.lineWidth = cell.coherent ? 2 : 1;
      if (!cell.coherent) this.ctx.setLineDash([3, 3]);
      else this.ctx.setLineDash([]);

      this.ctx.beginPath();
      this.ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.moveTo(cx, cy);
      this.ctx.lineTo(cx + dx, cy + dy);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  /** Renders one grayscale (0..255 per pixel) buffer as a labeled thumbnail at (x, y). */
  private drawGrayscaleThumbnail(
    data: Uint8Array,
    srcWidth: number,
    srcHeight: number,
    x: number,
    y: number,
    thumbHeight: number,
    label: string,
  ): void {
    const image = this.debugCtx.createImageData(srcWidth, srcHeight);
    for (let p = 0; p < data.length; p++) {
      const v = data[p];
      const o = p * 4;
      image.data[o] = v;
      image.data[o + 1] = v;
      image.data[o + 2] = v;
      image.data[o + 3] = 255;
    }
    this.debugCtx.putImageData(image, 0, 0);

    this.ctx.save();
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.debugCanvas, 0, 0, srcWidth, srcHeight, x, y, DEBUG_THUMB_WIDTH, thumbHeight);
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(x, y, DEBUG_THUMB_WIDTH, thumbHeight);
    this.ctx.font = "bold 10px monospace";
    this.ctx.fillStyle = DEBUG_HUD_COLOR;
    this.ctx.fillText(label, x, y + thumbHeight + 12);
    this.ctx.restore();
  }
}
