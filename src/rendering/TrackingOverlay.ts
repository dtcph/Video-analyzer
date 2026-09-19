import type { CameraMotionEstimate, Track } from "../tracking/TrackTypes";
import { pointAtOrBeforeFrame } from "../tracking/Track";

const DEBUG_PREDICTED_COLOR = "rgb(255, 210, 0)";
const DEBUG_GATE_COLOR = "rgba(255, 210, 0, 0.35)";
const DEBUG_VELOCITY_COLOR = "rgb(0, 180, 255)";
const DEBUG_CAMERA_COLOR = "rgb(255, 100, 220)";

const ACTIVE_COLOR = "rgb(0, 255, 180)";
const LOST_COLOR = "rgb(255, 80, 80)";
const ACTIVE_FILL = "rgba(0, 255, 179, 0.02)";
const LOST_FILL = "rgba(255, 80, 80, 0.02)";
const PATH_COLOR = "rgba(0, 255, 180, 0.65)";
const SELECTED_PATH_COLOR = "rgb(0, 255, 180)";
const HALO_COLOR = "rgba(0, 0, 0, 0)";
/* const HALO_COLOR = "rgba(0, 0, 0, 0.85)"; */

const CONFIDENCE_BAR_WIDTH = 36;
const CONFIDENCE_BAR_HEIGHT = 3;

/** Opacity applied to every track other than the selected one, once a selection exists. */
const DIMMED_OPACITY = 0.3;

/**
 * How many frames on either side of the playhead an unselected track's
 * path shows — an onion-skin window, like a trail of recent/upcoming
 * positions rather than the full history. The selected track ignores
 * this and always shows its complete start-to-finish path.
 */
const ONION_SKIN_FRAMES = 10;

/**
 * Draws bounding boxes, center points, IDs, confidence, and motion
 * paths for tracks onto the tracking canvas layer. Reads Track data
 * only — never mutates it. Position is resolved live from each
 * track's most recent point at or before the current frame (see
 * pointAtOrBeforeFrame), matching the annotation layer's "no
 * keyframing" behavior: a track holds its last known position between
 * samples rather than flickering out on frames between them, and draws
 * nothing once the current frame passes its last recorded point.
 *
 * When selectedTrackId is set, every other track is drawn at reduced
 * opacity and the selected track's path is drawn in full (start to
 * finish) so its whole trajectory reads clearly against the dimmed
 * rest. Unselected tracks otherwise show only an onion-skin window of
 * their path (see ONION_SKIN_FRAMES) around the current frame, rather
 * than their full history, to keep the overlay from becoming a tangle
 * of trajectories in busy scenes.
 */
export class TrackingOverlay {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  clear(): void {
    const { canvas } = this.ctx;
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  render(
    tracks: Track[],
    frame: number,
    selectedTrackId: number | null = null,
    debug: boolean = false,
    camera: CameraMotionEstimate | null = null,
  ): void {
    this.clear();
    const { canvas } = this.ctx;
    const hasSelection = selectedTrackId !== null;

    for (const track of tracks) {
      const isSelected = track.id === selectedTrackId;
      // "Prominent" covers both cases that should look their most
      // visible: the one track actually selected, and every track
      // when nothing is selected at all. Only a track that's losing
      // out to another one's selection gets dimmed and de-emphasized.
      const isProminent = !hasSelection || isSelected;
      this.ctx.globalAlpha = isProminent ? 1 : DIMMED_OPACITY;

      this.renderPath(
        track,
        frame,
        canvas.width,
        canvas.height,
        isSelected,
        isProminent,
      );

      const point = pointAtOrBeforeFrame(track, frame);
      if (!point) continue;

      const isLost = track.status === "lost" || track.status === "abandoned";
      const color = isLost ? LOST_COLOR : ACTIVE_COLOR;
      const fill = isLost ? LOST_FILL : ACTIVE_FILL;
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      const w = point.width * canvas.width;
      const h = point.height * canvas.height;

      const boxWidth = isProminent ? 3 : 2;

      this.ctx.save();

      // A soft fill inside the box helps it read as a highlighted
      // region rather than just an outline, especially against busy
      // or similarly-colored footage.
      if (isProminent) {
        this.ctx.fillStyle = fill;
        this.ctx.fillRect(x - w / 2, y - h / 2, w, h);
      }

      // A dark halo behind the colored stroke keeps the box legible
      // against light or busy video content, not just dark backgrounds.
      this.ctx.strokeStyle = HALO_COLOR;
      this.ctx.lineWidth = boxWidth + 3.5;
      this.ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = boxWidth;
      this.ctx.strokeRect(x - w / 2, y - h / 2, w, h);

      this.renderCenterMarker(x, y, color, isLost, isProminent);

      const label = `#${track.id}${isLost ? " LOST" : ""}`;
      const labelY = y - h / 2 - 4;
      this.ctx.font = isProminent ? "bold 12px monospace" : "12px monospace";
      this.ctx.strokeStyle = HALO_COLOR;
      this.ctx.lineWidth = 3;
      this.ctx.lineJoin = "round";
      this.ctx.strokeText(label, x - w / 2, labelY);
      this.ctx.fillStyle = color;
      this.ctx.fillText(label, x - w / 2, labelY);

      this.renderConfidenceBar(
        x - w / 2,
        y - h / 2 - 13,
        point.confidence,
        color,
      );
      this.ctx.restore();

      if (debug) this.renderDebugTrack(track, x, y, canvas.width, canvas.height);
    }

    this.ctx.globalAlpha = 1;
    if (debug && camera) this.renderCameraHud(camera, canvas.width);
  }

  /**
   * Draws the tracker's internal state for one track — its predicted
   * position, the gating region a detection had to fall within to
   * match it (Track.searchRadius, drawn as an ellipse since normalized
   * x/y radii map to different pixel extents on a non-square frame),
   * an association line from the actual observed position to the
   * prediction, and a rough velocity vector from the last two
   * recorded points. Reads only plain fields already on Track — see
   * TrackTypes.Track's predictedPosition/predictedSize/searchRadius —
   * so this stays rendering-only code with no dependency on the
   * tracking/analysis modules that computed them.
   */
  private renderDebugTrack(track: Track, actualX: number, actualY: number, width: number, height: number): void {
    const px = track.predictedPosition.x * width;
    const py = track.predictedPosition.y * height;

    this.ctx.save();

    if (track.searchRadius > 0) {
      this.ctx.strokeStyle = DEBUG_GATE_COLOR;
      this.ctx.setLineDash([4, 3]);
      this.ctx.lineWidth = 1.5;
      this.ctx.beginPath();
      this.ctx.ellipse(px, py, track.searchRadius * width, track.searchRadius * height, 0, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    }

    this.ctx.strokeStyle = DEBUG_PREDICTED_COLOR;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(actualX, actualY);
    this.ctx.lineTo(px, py);
    this.ctx.stroke();

    this.ctx.fillStyle = DEBUG_PREDICTED_COLOR;
    this.ctx.beginPath();
    this.ctx.arc(px, py, 4, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();

    const n = track.blobs.length;
    if (n >= 2) {
      const prev = track.blobs[n - 2];
      const last = track.blobs[n - 1];
      const vx = (last.x - prev.x) * width;
      const vy = (last.y - prev.y) * height;
      const scale = 6; // exaggerate for legibility — this is a direction/magnitude cue, not a to-scale prediction
      this.ctx.strokeStyle = DEBUG_VELOCITY_COLOR;
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(actualX, actualY);
      this.ctx.lineTo(actualX + vx * scale, actualY + vy * scale);
      this.ctx.stroke();
    }

    this.ctx.font = "10px monospace";
    this.ctx.fillStyle = DEBUG_PREDICTED_COLOR;
    this.ctx.fillText(
      `conf ${(track.confidence * 100).toFixed(0)}% · lost ${track.lostFrames} · ${track.status}`,
      actualX + 8,
      actualY + 16,
    );

    this.ctx.restore();
  }

  /** Fixed-position readout of the current camera-motion estimate — see CameraMotionEstimate. */
  private renderCameraHud(camera: CameraMotionEstimate, canvasWidth: number): void {
    this.ctx.save();
    this.ctx.font = "bold 11px monospace";
    this.ctx.fillStyle = DEBUG_CAMERA_COLOR;
    const x = 12;
    let y = 20;
    this.ctx.fillText("CAMERA MOTION", x, y);
    y += 14;
    this.ctx.font = "11px monospace";
    this.ctx.fillText(`dx: ${(camera.dx * canvasWidth).toFixed(1)}px`, x, y);
    y += 14;
    this.ctx.fillText(`dy: ${(camera.dy * canvasWidth).toFixed(1)}px`, x, y);
    y += 14;
    this.ctx.fillText(`confidence: ${camera.confidence.toFixed(2)}`, x, y);
    if (camera.sudden) {
      y += 14;
      this.ctx.fillStyle = "rgb(255, 80, 80)";
      this.ctx.fillText("SUDDEN MOVEMENT", x, y);
    }
    if (camera.confidence > 0.05) {
      const arrowScale = 40;
      const originX = x + 90;
      const originY = 20;
      this.ctx.strokeStyle = DEBUG_CAMERA_COLOR;
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(originX, originY);
      this.ctx.lineTo(originX + camera.dx * arrowScale * canvasWidth, originY + camera.dy * arrowScale * canvasWidth);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  private renderCenterMarker(
    x: number,
    y: number,
    color: string,
    isLost: boolean,
    isProminent: boolean,
  ): void {
    this.ctx.save();
    const r = isProminent ? 5.5 : 4;

    if (isLost) {
      // An "x" marks the track's last known position, per the
      // ● -> × lifecycle: the moment a track is lost is the last
      // frame it draws anything at all.
      this.ctx.strokeStyle = HALO_COLOR;
      this.ctx.lineWidth = isProminent ? 4.5 : 3;
      this.strokeCross(x, y, r);
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = isProminent ? 4.5 : 1;
      this.strokeCross(x, y, r);
    } else {
      this.ctx.fillStyle = HALO_COLOR;
      this.ctx.beginPath();
      this.ctx.arc(x, y, r, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.arc(x, y, isProminent ? 3.5 : 2.5, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  private strokeCross(x: number, y: number, r: number): void {
    this.ctx.beginPath();
    this.ctx.moveTo(x - r, y - r);
    this.ctx.lineTo(x + r, y + r);
    this.ctx.moveTo(x + r, y - r);
    this.ctx.lineTo(x - r, y + r);
    this.ctx.stroke();
  }

  private renderConfidenceBar(
    x: number,
    y: number,
    confidence: number,
    color: string,
  ): void {
    this.ctx.save();
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    this.ctx.strokeRect(x, y, CONFIDENCE_BAR_WIDTH, CONFIDENCE_BAR_HEIGHT);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(
      x,
      y,
      CONFIDENCE_BAR_WIDTH * Math.max(0, Math.min(1, confidence)),
      CONFIDENCE_BAR_HEIGHT,
    );
    this.ctx.restore();
  }

  private renderPath(
    track: Track,
    frame: number,
    width: number,
    height: number,
    isSelected: boolean,
    isProminent: boolean,
  ): void {
    const pathPoints = isSelected
      ? track.blobs
      : track.blobs.filter(
          (p) => Math.abs(p.frame - frame) <= ONION_SKIN_FRAMES,
        );
    if (pathPoints.length < 2) return;

    const pathColor = isSelected
      ? SELECTED_PATH_COLOR
      : isProminent
        ? ACTIVE_COLOR
        : PATH_COLOR;
    const lineWidth = isProminent ? 2.5 : 2;
    const dotRadius = isProminent ? 2.5 : 2;

    this.ctx.save();
    this.ctx.lineJoin = "round";
    this.ctx.beginPath();
    pathPoints.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      if (index === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    });

    // A dark halo under the path line keeps it legible over light or
    // busy video content, matching the box/label treatment above.
    this.ctx.strokeStyle = HALO_COLOR;
    this.ctx.lineWidth = lineWidth + 1.5;
    this.ctx.stroke();
    this.ctx.strokeStyle = pathColor;
    this.ctx.lineWidth = lineWidth;
    this.ctx.stroke();

    // Small dots at each historical sample make the trajectory read
    // as discrete measured data points, not a smoothed curve.
    for (const point of pathPoints) {
      const x = point.x * width;
      const y = point.y * height;
      this.ctx.fillStyle = HALO_COLOR;
      this.ctx.beginPath();
      this.ctx.arc(x, y, dotRadius + 1, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.fillStyle = pathColor;
      this.ctx.beginPath();
      this.ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();
  }
}

/**
 * Finds the track whose current-frame bounding box contains a
 * normalized (0..1) point, for click-to-select on the tracking canvas.
 * When boxes overlap, the smallest one wins — it's the more specific
 * target under the cursor.
 */
export function hitTestTracks(
  tracks: Track[],
  frame: number,
  nx: number,
  ny: number,
): Track | null {
  let best: Track | null = null;
  let bestArea = Infinity;

  for (const track of tracks) {
    const point = pointAtOrBeforeFrame(track, frame);
    if (!point) continue;

    const left = point.x - point.width / 2;
    const right = point.x + point.width / 2;
    const top = point.y - point.height / 2;
    const bottom = point.y + point.height / 2;

    if (nx < left || nx > right || ny < top || ny > bottom) continue;

    const area = point.width * point.height;
    if (area < bestArea) {
      bestArea = area;
      best = track;
    }
  }

  return best;
}
