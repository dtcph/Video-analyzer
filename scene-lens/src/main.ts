import { closeCompare, initCompare, openCompare, resetCompare, updateCompare } from "./compareModal";
import { detect, loadDetector, setMode, setThreshold, type Det } from "./detector";
import { annotate, clearFaces, loadFaces, refresh, type Emotion } from "./faces";
import { applyStatic, onLang, setLang, t } from "./i18n";
import { applyIcons, setIcon } from "./icons";
import { label } from "./labels";
import { rank, type Match } from "./scenes";
import { Tracker } from "./tracker";
import { closeTreemap, initTreemap, openTreemap, updateTreemap } from "./treemapModal";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const img = $<HTMLImageElement>("img"), vid = $<HTMLVideoElement>("vid"), overlay = $<HTMLCanvasElement>("overlay");
const stage = $("stage"), status = $("status"), playBtn = $<HTMLButtonElement>("play");
const seek = $<HTMLInputElement>("seek"), time = $("time"), homeMsg = $("home-msg");
const ctx = overlay.getContext("2d")!;

applyStatic();
applyIcons();

/** Texts that change at runtime: re-evaluated whenever the language switches. */
const dynamic = new Map<HTMLElement, () => string>();
const setText = (e: HTMLElement, f: () => string): void => { dynamic.set(e, f); e.textContent = f(); };

type Kind = "none" | "image" | "video" | "camera";
let kind: Kind = "none";
let ready = false, threshold = 0.65, objectUrl: string | undefined, stream: MediaStream | undefined;
let cameras: MediaDeviceInfo[] = [], camIndex = 0;
let current = new Map<string, number>();
const tracker = new Tracker();
const history: Map<string, number>[] = [];
let lastRender = 0;
let facesOn = false, emotions = new Map<Det, Emotion | null>();
/** People & emotions: off per source, switched on by the first detected person until the user decides by hand. */
const facesBox = $<HTMLInputElement>("faces-on");
let facesAuto = true, faceRequest = 0, faceStatus = false;

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const el = (): HTMLImageElement | HTMLVideoElement => (kind === "image" ? img : vid);
const paused = (): boolean => kind === "image" || vid.paused;

/* ---------- screens ---------- */
function go(screen: "home" | "analysis"): void {
  $("home").hidden = screen !== "home"; $("analysis").hidden = screen !== "analysis";
  document.body.dataset.screen = screen; // the shared header shows back/status only on the analysis screen
  window.scrollTo(0, 0);
}

function stopSources(): void {
  vid.pause(); vid.removeAttribute("src"); vid.srcObject = null; vid.load();
  stream?.getTracks().forEach((t) => t.stop()); stream = undefined;
  if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = undefined;
  img.removeAttribute("src");
}

function resetCounts(): void {
  clearFaces(); emotions = new Map(); tracker.reset(); current = new Map(); history.length = 0;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  render(true);
}

async function show(k: Kind): Promise<void> {
  ensureDetector();
  stopSources(); kind = k; generation++; resetFaces();
  go("analysis"); closeTreemap(); resetCompare();
  img.hidden = k !== "image"; vid.hidden = k === "image" || k === "none";
  const video = k === "video", cam = k === "camera";
  $("controls").hidden = k === "image";
  for (const id of ["back", "fwd", "reset", "seek", "time"]) $(id).hidden = !video;
  playBtn.hidden = k === "image";
  await setMode(k === "image" ? "IMAGE" : "VIDEO");
  resetCounts();
  $("switch-cam").hidden = !cam || cameras.length < 2;
}

function backHome(): void {
  stopSources(); kind = "none"; generation++; resetFaces(); resetCounts(); go("home");
  for (const id of ["file-img", "file-vid"]) $<HTMLInputElement>(id).value = "";
}

/* ---------- analysis ---------- */
function fitOverlay(w: number, h: number): void {
  overlay.width = w; overlay.height = h;
  const r = el().getBoundingClientRect(), s = stage.getBoundingClientRect();
  Object.assign(overlay.style, { width: `${r.width}px`, height: `${r.height}px`, left: `${r.left - s.left}px`, top: `${r.top - s.top}px` });
}

function draw(dets: Det[]): void {
  const tag = (d: Det): string => { const e = emotions.get(d); return e ? ` · ${t(`emo.${e}`)}` : ""; };
  const lw = Math.max(2, overlay.width / 400), fs = Math.max(12, overlay.width / 55);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`; ctx.lineWidth = lw; ctx.textBaseline = "top";
  for (const d of dets) {
    ctx.strokeStyle = "#fff"; ctx.strokeRect(d.x - lw, d.y - lw, d.w + 2 * lw, d.h + 2 * lw);
    ctx.strokeStyle = "#5468d4"; ctx.strokeRect(d.x, d.y, d.w, d.h);
    const t = `${label(d.name)} ${Math.round(d.score * 100)}%${tag(d)}`, tw = ctx.measureText(t).width + 10;
    ctx.fillStyle = "#0b0b0c"; ctx.fillRect(d.x, Math.max(0, d.y - fs - 6), tw, fs + 6);
    ctx.fillStyle = "#fff"; ctx.fillText(t, d.x + 5, Math.max(0, d.y - fs - 6) + 3);
  }
}

/**
 * One analysis at a time: detection and the face stage share one ONNX runtime, and overlapping runs block it.
 * Results of a source that was replaced meanwhile are dropped; a paused frame (of the current source) that asked
 * meanwhile is analysed afterwards.
 */
let inflight = false, generation = 0, again = false;

async function process(): Promise<void> {
  if (inflight) { again ||= paused(); return; }
  const src = el(), gen = generation;
  const w = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth;
  const h = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
  if (!w || !h) return;
  inflight = true;
  try { await analyseFrame(src, gen, w, h); } finally { inflight = false; }
  if (again) { again = false; if (paused()) await process(); } // also for a source opened meanwhile
}

async function analyseFrame(src: HTMLImageElement | HTMLVideoElement, gen: number, w: number, h: number): Promise<void> {
  const dets = await detect(src);
  if (gen !== generation) return;
  // video: the tracker's majority class (smoothed over the track) replaces the per-frame class for display and counts
  if (kind !== "image") { const labels = tracker.update(dets); for (const d of dets) d.name = labels.get(d) ?? d.name; }
  if (facesAuto && !facesBox.checked && dets.some((d) => d.name === "person")) void setFaces(true); // loads beside the analysis
  if (facesOn) { await refresh(src, dets, paused()); if (gen !== generation) return; emotions = annotate(dets); } else emotions = new Map();
  fitOverlay(w, h);
  draw(dets);
  current = new Map();
  for (const d of dets) current.set(d.name, (current.get(d.name) ?? 0) + 1);
  history.push(current); if (history.length > 30) history.shift();
  if (kind === "image") { tracker.reset(); for (const [k, v] of current) tracker.totals.set(k, v); }
}

const totals = (): Map<string, number> => (kind === "image" ? current : tracker.totals);

/** Average of the last ~30 analysed frames: calmer than a single frame. */
function smoothed(): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of history) for (const [k, v] of f) m.set(k, (m.get(k) ?? 0) + v / history.length);
  return m;
}

const EXPRESSIONS: Emotion[] = ["happy", "neutral", "surprised", "sad", "angry", "disgusted", "afraid", "contempt"];

/** Expressions of the persons in the current frame; no readable face and an unclear one are both null (not recognised). */
function expressions(): [Emotion | null, number][] {
  const n = new Map<Emotion | null, number>();
  for (const e of emotions.values()) { const k = e === "uncertain" ? null : e; n.set(k, (n.get(k) ?? 0) + 1); }
  return [...EXPRESSIONS, null].filter((k) => n.has(k)).map((k) => [k, n.get(k)!]);
}

const countRow = (name: string, total: number | "", now: number, sub = false): string =>
  `<li${sub ? ' class="sub"' : ""}><span class="n">${name}</span><span class="v">${total}</span><span class="v cur">${now}</span></li>`;

/**
 * Rows of one class. While expressions are estimated, "person" is broken down underneath (current frame only, so the
 * total column stays empty there); a single person with a single result fits into one row.
 */
function countRows(name: string, total: number, now: number): string {
  const parts = name === "person" ? expressions() : [];
  if (!parts.length) return countRow(label(name), total, now);
  const text = (e: Emotion | null): string => t(e ? `emo.${e}` : "emo.none");
  const withText = (e: Emotion | null): string => t("counts.with", { n: label(name), e: text(e).toLocaleLowerCase() });
  if (total === 1 && now === 1 && parts.length === 1) return countRow(withText(parts[0][0]), total, now);
  return countRow(t("counts.sum", { n: label(name) }), total, now)
    + parts.map(([e, c]) => countRow(e ? withText(e) : text(e), "", c, true)).join("");
}

function render(force = false): void {
  const now = performance.now();
  if (!force && now - lastRender < 250) return;
  lastRender = now;
  const tot = totals(), keys = [...new Set([...tot.keys(), ...current.keys()])].sort((a, b) => (tot.get(b) ?? 0) - (tot.get(a) ?? 0));
  $("counts").innerHTML = keys.length
    ? keys.map((k) => countRows(k, tot.get(k) ?? 0, current.get(k) ?? 0)).join("")
    : `<li class="muted">${t("counts.none")}</li>`;
  const sm = smoothed();
  const matches = rank(sm);
  renderScene(matches);
  updateCompare(matches, sm);
  updateTreemap(tot, current);
}

function renderScene(matches: Match[]): void {
  const sc = $("scene");
  if (!matches.length) { sc.className = "scene muted"; sc.textContent = t("sug.empty"); return; }
  sc.className = "scene";
  const [best, ...rest] = matches;
  sc.innerHTML = `<div class="best">${t("sug.best", { n: t(`scene.${best.scene.id}`) })}</div><p>${t(`scene.${best.scene.id}.hint`)} · ${t("sug.match", { p: Math.round(best.score * 100) })}</p>`
    + rest.slice(0, 2).map((m) => `<div class="alt"><span>${t("sug.also", { n: t(`scene.${m.scene.id}`) })}</span><span>${Math.round(m.score * 100)} %</span></div>`).join("");
}

function loop(): void {
  if (ready && !inflight && (kind === "video" || kind === "camera") && !vid.paused && !vid.ended && vid.readyState >= 2) void process().then(() => render());
  if (kind === "video") {
    time.textContent = `${fmt(vid.currentTime)} / ${fmt(vid.duration || 0)}`;
    if (document.activeElement !== seek && vid.duration) seek.value = String((vid.currentTime / vid.duration) * 1000);
  }
  const state = vid.paused ? "play" : "pause", pl = t(`ctl.${state}`);
  if ($("play-text").textContent !== pl) { $("play-text").textContent = pl; setIcon($("play-icon"), state); }
  requestAnimationFrame(loop);
}

const reanalyse = (): void => { if (ready && kind !== "none" && paused()) void process().then(() => render(true)); };

/* ---------- sources ---------- */
async function openImage(f: File): Promise<void> {
  await show("image");
  objectUrl = URL.createObjectURL(f); img.src = objectUrl; await img.decode();
  reanalyse();
}
async function openVideo(f: File): Promise<void> {
  await show("video");
  objectUrl = URL.createObjectURL(f); vid.src = objectUrl; vid.muted = true; await vid.play().catch(() => undefined);
}
async function openCamera(deviceId?: string): Promise<void> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, width: 1280, height: 720 } : { width: 1280, height: 720 } });
    cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    const active = s.getVideoTracks()[0]?.getSettings().deviceId;
    camIndex = Math.max(0, cameras.findIndex((d) => d.deviceId === active));
    await show("camera"); stream = s; vid.srcObject = s; await vid.play();
    $("switch-cam").hidden = cameras.length < 2;
  } catch {
    setText(homeMsg, () => t("home.cameraFail"));
    if (kind === "camera") setText(status, () => t("status.camera"));
  }
}

$<HTMLInputElement>("file-img").onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void openImage(f); };
$<HTMLInputElement>("file-vid").onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void openVideo(f); };
$("cam").onclick = () => { setText(homeMsg, () => t("home.cameraWait")); void openCamera(); };
$("switch-cam").onclick = () => { if (cameras.length > 1) void openCamera(cameras[(camIndex + 1) % cameras.length].deviceId); };
$("back-home").onclick = backHome;

/* ---------- controls ---------- */
const togglePlay = (): void => { if (kind === "video" || kind === "camera") void (vid.paused ? vid.play() : vid.pause()); };
const seekBy = (d: number): void => { vid.currentTime = Math.min(vid.duration || 0, Math.max(0, vid.currentTime + d)); tracker.reset(false); };
playBtn.onclick = togglePlay;
$("back").onclick = () => seekBy(-10);
$("fwd").onclick = () => seekBy(10);
$("reset").onclick = () => { vid.currentTime = 0; resetCounts(); void vid.play(); };
seek.oninput = () => { if (vid.duration) { vid.currentTime = (+seek.value / 1000) * vid.duration; tracker.reset(false); } };

// Space toggles playback anywhere (also while a popup is open), except on checkboxes.
const spaceTarget = (e: KeyboardEvent): boolean => e.code === "Space" && !(e.target instanceof HTMLInputElement && e.target.type === "checkbox");
document.addEventListener("keydown", (e) => { if (spaceTarget(e)) { e.preventDefault(); if (!e.repeat) togglePlay(); } });
document.addEventListener("keyup", (e) => { if (spaceTarget(e)) e.preventDefault(); });
vid.addEventListener("seeked", () => { if (vid.paused) reanalyse(); });
vid.addEventListener("pause", () => { if (kind === "video") render(true); });

/* ---------- settings ---------- */
$<HTMLInputElement>("thr").oninput = (e) => {
  threshold = +(e.target as HTMLInputElement).value / 100; $("thr-val").textContent = `${Math.round(threshold * 100)} %`;
  void setThreshold(threshold).then(reanalyse);
};
/** Replaces a face-model message in the header once it no longer applies. */
function clearFaceStatus(): void {
  if (faceStatus) setText(status, () => t(ready ? "status.readyShort" : "status.loading"));
  faceStatus = false;
}

/** A newer call (manual switch, new source) wins over a model load that is still running. */
async function setFaces(on: boolean): Promise<void> {
  const request = ++faceRequest;
  facesBox.checked = on;
  if (!on) { facesOn = false; emotions = new Map(); clearFaceStatus(); reanalyse(); render(true); return; }
  faceStatus = true; setText(status, () => t("status.faceLoading"));
  try {
    await loadFaces();
    if (request !== faceRequest) return;
    facesOn = true; clearFaceStatus(); reanalyse(); render(true);
  } catch (err) {
    if (request !== faceRequest) return;
    facesBox.checked = false; facesAuto = false; // no retry on every frame
    setText(status, () => t("status.faceFailed", { e: String(err) }));
  }
}

function resetFaces(): void {
  faceRequest++; facesAuto = true; facesOn = false; facesBox.checked = false;
  clearFaceStatus();
}

facesBox.onchange = () => { facesAuto = false; void setFaces(facesBox.checked); };
$("open-tm").onclick = () => { closeCompare(); openTreemap(); };
$("open-cmp").onclick = () => openCompare();
initTreemap();
initCompare();

let detectorLoading: Promise<void> | undefined;
/** Lazy (eval/04-runtime.md): the detector loads when a source is chosen, or earlier when pointer or focus reaches the choices. */
function ensureDetector(): void {
  if (detectorLoading) return;
  setText(status, () => t("status.loading"));
  detectorLoading = loadDetector(threshold)
    .then((d) => { ready = true; setText(status, () => t("status.ready", { d })); reanalyse(); })
    .catch((e) => { detectorLoading = undefined; setText(status, () => t("status.failed", { e: String(e) })); });
}
for (const ev of ["pointerover", "focusin", "touchstart"]) $("home").querySelector(".choices")!.addEventListener(ev, ensureDetector, { once: true, passive: true });
setText(homeMsg, () => t("home.privacy"));
render(true);
requestAnimationFrame(loop);

/* ---------- language ---------- */
onLang(() => { for (const [e, f] of dynamic) e.textContent = f(); render(true); });
$("lang-ko").onclick = () => setLang("ko");
$("lang-en").onclick = () => setLang("en");
