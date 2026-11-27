import { detect, loadDetector, setMode, setThreshold, type Det } from "./detector";
import { EMOTIONS, NO_FACE, annotate, clearFaces, loadFaces, refresh, type Emotion } from "./faces";
import { label } from "./labels";
import { rank, type Match } from "./scenes";
import { Tracker } from "./tracker";
import { closeTreemap, initTreemap, openTreemap, updateTreemap } from "./treemapModal";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const img = $<HTMLImageElement>("img"), vid = $<HTMLVideoElement>("vid"), overlay = $<HTMLCanvasElement>("overlay");
const stage = $("stage"), status = $("status"), playBtn = $<HTMLButtonElement>("play");
const seek = $<HTMLInputElement>("seek"), time = $("time"), homeMsg = $("home-msg");
const ctx = overlay.getContext("2d")!;

type Kind = "none" | "image" | "video" | "camera";
let kind: Kind = "none";
let ready = false, threshold = 0.4, objectUrl: string | undefined, stream: MediaStream | undefined;
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
  stopSources(); kind = k;
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
  stopSources(); kind = "none"; resetCounts(); go("home");
  for (const id of ["file-img", "file-vid"]) $<HTMLInputElement>(id).value = "";
}

/* ---------- analysis ---------- */
function fitOverlay(w: number, h: number): void {
  overlay.width = w; overlay.height = h;
  const r = el().getBoundingClientRect(), s = stage.getBoundingClientRect();
  Object.assign(overlay.style, { width: `${r.width}px`, height: `${r.height}px`, left: `${r.left - s.left}px`, top: `${r.top - s.top}px` });
}

function draw(dets: Det[]): void {
  const tag = (d: Det): string => { const e = emotions.get(d); return e ? ` · ${EMOTIONS[e]}` : ""; };
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

function process(): void {
  const src = el();
  const w = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth;
  const h = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
  if (!w || !h) return;
  fitOverlay(w, h);
  const dets = detect(src);
  if (facesOn) { refresh(src, dets, paused()); emotions = annotate(dets); } else emotions = new Map();
  draw(dets);
  current = new Map();
  for (const d of dets) current.set(d.name, (current.get(d.name) ?? 0) + 1);
  history.push(current); if (history.length > 30) history.shift();
  if (kind === "image") { tracker.reset(); for (const [k, v] of current) tracker.totals.set(k, v); }
  else tracker.update(dets);
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
    : `<li class="muted">Nothing detected yet.</li>`;
  const sm = smoothed();
  renderScene(rank(sm), sm);
  renderFaces();
  updateTreemap(tot, current);
}

function renderFaces(): void {
  const box = $("faces"); box.hidden = !facesOn || emotions.size === 0;
  if (box.hidden) return;
  const n = new Map<string, number>();
  for (const e of emotions.values()) { const k = e ? EMOTIONS[e] : NO_FACE; n.set(k, (n.get(k) ?? 0) + 1); }
  $("faces-list").innerHTML = [...Object.values(EMOTIONS), NO_FACE].filter((k) => n.has(k))
    .map((k) => `<li><span class="n">${k}</span><span class="v">${n.get(k)}</span></li>`).join("")
    + `<li><span class="n"><b>People total</b></span><span class="v">${emotions.size}</span></li>`;
}

function renderScene(matches: Match[], sm: Map<string, number>): void {
  const sc = $("scene"), cmp = $("compare");
  if (!matches.length) {
    sc.className = "scene muted"; sc.textContent = "Appears as soon as objects are detected.";
    cmp.className = "muted"; cmp.textContent = "Typical values for the guessed place show up here.";
    return;
  }
  sc.className = "scene";
  const [best, ...rest] = matches;
  sc.innerHTML = `<div class="best">Probably: ${best.scene.name}</div><p>${best.scene.hint} · match ${Math.round(best.score * 100)} %</p>`
    + rest.slice(0, 2).map((m) => `<div class="alt"><span>Also possible: ${m.scene.name}</span><span>${Math.round(m.score * 100)} %</span></div>`).join("");
  const typ = best.scene.typical;
  const rows = [...new Set([...Object.keys(typ), ...sm.keys()])]
    .filter((k) => (typ[k] ?? 0) >= 1 || (sm.get(k) ?? 0) >= 0.5)
    .sort((a, b) => Math.max(typ[b] ?? 0, sm.get(b) ?? 0) - Math.max(typ[a] ?? 0, sm.get(a) ?? 0)).slice(0, 8);
  const max = Math.max(1, ...rows.map((k) => Math.max(typ[k] ?? 0, sm.get(k) ?? 0)));
  cmp.className = "";
  cmp.innerHTML = `<div class="muted" style="font-size:13px;margin-bottom:6px">${best.scene.name}: typical (tick) vs. yours (bar)</div>`
    + rows.map((k) => {
      const y = sm.get(k) ?? 0, t = typ[k] ?? 0;
      return `<div class="cmp-row"><span>${label(k)}</span><div class="bar-track"><i style="width:${(y / max) * 100}%"></i><b style="left:${(t / max) * 100}%"></b></div><span class="num">${y.toFixed(1)} / ${t}</span></div>`;
    }).join("")
    + `<div class="note">Typical values are rough estimates, not measured statistics.</div>`;
}

function loop(): void {
  if (ready && (kind === "video" || kind === "camera") && !vid.paused && !vid.ended && vid.readyState >= 2) { process(); render(); }
  if (kind === "video") {
    time.textContent = `${fmt(vid.currentTime)} / ${fmt(vid.duration || 0)}`;
    if (document.activeElement !== seek && vid.duration) seek.value = String((vid.currentTime / vid.duration) * 1000);
  }
  playBtn.textContent = vid.paused ? "Play" : "Pause";
  requestAnimationFrame(loop);
}

const reanalyse = (): void => { if (ready && kind !== "none" && paused()) { process(); render(true); } };

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
    homeMsg.textContent = "Camera unavailable or permission denied.";
    if (kind === "camera") status.textContent = "Camera unavailable.";
  }
}

$<HTMLInputElement>("file-img").onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void openImage(f); };
$<HTMLInputElement>("file-vid").onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void openVideo(f); };
$("cam").onclick = () => { homeMsg.textContent = "Waiting for camera permission …"; void openCamera(); };
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
  status.textContent = "Loading face model …";
  try { await loadFaces(); facesOn = true; status.textContent = "Model ready"; reanalyse(); render(true); }
  catch (err) { box.checked = false; status.textContent = `Face model failed to load: ${err}`; }
};
$("open-tm").onclick = () => openTreemap();
initTreemap();

loadDetector(threshold)
  .then((d) => { ready = true; status.textContent = `Model ready (${d})`; reanalyse(); })
  .catch((e) => { status.textContent = `Model failed to load: ${e}`; });
requestAnimationFrame(loop);
