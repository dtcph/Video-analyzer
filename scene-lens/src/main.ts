import { detect, loadDetector, setMode, setThreshold, type Det } from "./detector";
import { annotate, clearFaces, loadFaces, refresh, type Emotion } from "./faces";
import { applyStatic, onLang, setLang, t } from "./i18n";
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
  stopSources(); kind = k; generation++;
  go("analysis"); closeTreemap();
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
  stopSources(); kind = "none"; generation++; resetCounts(); go("home");
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

/** One analysis at a time (inference is async); results of a source that was replaced meanwhile are dropped. */
/**
 * One analysis at a time: detection and the face stage share one ONNX runtime, and overlapping runs block it.
 * Results of a source that was replaced meanwhile are dropped; a paused frame that asked again is redone afterwards.
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
  if (again) { again = false; if (gen === generation && paused()) await process(); }
}

async function analyseFrame(src: HTMLImageElement | HTMLVideoElement, gen: number, w: number, h: number): Promise<void> {
  const dets = await detect(src);
  if (gen !== generation) return;
  // video: the tracker's majority class (smoothed over the track) replaces the per-frame class for display and counts
  if (kind !== "image") { const labels = tracker.update(dets); for (const d of dets) d.name = labels.get(d) ?? d.name; }
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

function render(force = false): void {
  const now = performance.now();
  if (!force && now - lastRender < 250) return;
  lastRender = now;
  const tot = totals(), keys = [...new Set([...tot.keys(), ...current.keys()])].sort((a, b) => (tot.get(b) ?? 0) - (tot.get(a) ?? 0));
  $("counts").innerHTML = keys.length
    ? keys.map((k) => `<li><span class="n">${label(k)}</span><span class="v">${tot.get(k) ?? 0}</span><span class="v cur">${current.get(k) ?? 0}</span></li>`).join("")
    : `<li class="muted">${t("counts.none")}</li>`;
  const sm = smoothed();
  renderScene(rank(sm), sm);
  renderFaces();
  updateTreemap(tot, current);
}

function renderFaces(): void {
  const box = $("faces"); box.hidden = !facesOn || emotions.size === 0;
  if (box.hidden) return;
  const n = new Map<string, number>();
  for (const e of emotions.values()) { const k = e ?? "none"; n.set(k, (n.get(k) ?? 0) + 1); }
  $("faces-list").innerHTML = ["happy", "neutral", "surprised", "sad", "angry", "disgusted", "afraid", "contempt", "uncertain", "none"].filter((k) => n.has(k))
    .map((k) => `<li><span class="n">${t(`emo.${k}`)}</span><span class="v">${n.get(k)}</span></li>`).join("")
    + `<li><span class="n"><b>${t("people.total")}</b></span><span class="v">${emotions.size}</span></li>`;
}

function renderScene(matches: Match[], sm: Map<string, number>): void {
  const sc = $("scene"), cmp = $("compare");
  if (!matches.length) {
    sc.className = "scene muted"; sc.textContent = t("sug.empty");
    cmp.className = "muted"; cmp.textContent = t("cmp.empty");
    return;
  }
  sc.className = "scene";
  const [best, ...rest] = matches;
  sc.innerHTML = `<div class="best">${t("sug.best", { n: t(`scene.${best.scene.id}`) })}</div><p>${t(`scene.${best.scene.id}.hint`)} · ${t("sug.match", { p: Math.round(best.score * 100) })}</p>`
    + rest.slice(0, 2).map((m) => `<div class="alt"><span>${t("sug.also", { n: t(`scene.${m.scene.id}`) })}</span><span>${Math.round(m.score * 100)} %</span></div>`).join("");
  const typ = best.scene.typical;
  const rows = [...new Set([...Object.keys(typ), ...sm.keys()])]
    .filter((k) => (typ[k] ?? 0) >= 1 || (sm.get(k) ?? 0) >= 0.5)
    .sort((a, b) => Math.max(typ[b] ?? 0, sm.get(b) ?? 0) - Math.max(typ[a] ?? 0, sm.get(a) ?? 0)).slice(0, 8);
  const max = Math.max(1, ...rows.map((k) => Math.max(typ[k] ?? 0, sm.get(k) ?? 0)));
  cmp.className = "";
  cmp.innerHTML = `<div class="muted legend">${t("cmp.legend", { n: t(`scene.${best.scene.id}`) })}</div>`
    + rows.map((k) => {
      const y = sm.get(k) ?? 0, t = typ[k] ?? 0;
      return `<div class="cmp-row"><span>${label(k)}</span><div class="bar-track"><i style="width:${(y / max) * 100}%"></i><b style="left:${(t / max) * 100}%"></b></div><span class="num">${y.toFixed(1)} / ${t}</span></div>`;
    }).join("")
    + `<div class="note">${t("cmp.note")}</div>`;
}

function loop(): void {
  if (ready && !inflight && (kind === "video" || kind === "camera") && !vid.paused && !vid.ended && vid.readyState >= 2) void process().then(() => render());
  if (kind === "video") {
    time.textContent = `${fmt(vid.currentTime)} / ${fmt(vid.duration || 0)}`;
    if (document.activeElement !== seek && vid.duration) seek.value = String((vid.currentTime / vid.duration) * 1000);
  }
  const pl = t(vid.paused ? "ctl.play" : "ctl.pause");
  if (playBtn.textContent !== pl) playBtn.textContent = pl;
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

// Space toggles playback anywhere (also while the treemap is open), except on checkboxes.
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
$<HTMLInputElement>("faces-on").onchange = async (e) => {
  const box = e.target as HTMLInputElement;
  if (!box.checked) { facesOn = false; emotions = new Map(); reanalyse(); render(true); return; }
  setText(status, () => t("status.faceLoading"));
  try { await loadFaces(); facesOn = true; setText(status, () => t("status.readyShort")); reanalyse(); render(true); }
  catch (err) { box.checked = false; setText(status, () => t("status.faceFailed", { e: String(err) })); }
};
$("open-tm").onclick = () => openTreemap();
initTreemap();

loadDetector(threshold)
  .then((d) => { ready = true; setText(status, () => t("status.ready", { d })); reanalyse(); })
  .catch((e) => { setText(status, () => t("status.failed", { e: String(e) })); });
setText(status, () => t("status.loading"));
setText(homeMsg, () => t("home.privacy"));
render(true);
requestAnimationFrame(loop);

/* ---------- language ---------- */
onLang(() => { for (const [e, f] of dynamic) e.textContent = f(); render(true); });
$("lang-ko").onclick = () => setLang("ko");
$("lang-en").onclick = () => setLang("en");
