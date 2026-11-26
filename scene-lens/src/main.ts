import { detect, loadDetector, setMode, setThreshold, type Det } from "./detector";
import { label } from "./labels";
import { rank, type Match } from "./scenes";
import { Tracker } from "./tracker";
import { openTreemap, updateTreemap } from "./treemapWindow";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const img = $<HTMLImageElement>("img"), vid = $<HTMLVideoElement>("vid"), overlay = $<HTMLCanvasElement>("overlay");
const stage = $("stage"), controls = $("controls"), status = $("status"), playBtn = $<HTMLButtonElement>("play");
const seek = $<HTMLInputElement>("seek"), time = $("time"), openTm = $<HTMLButtonElement>("open-tm");
const ctx = overlay.getContext("2d")!;

type Kind = "none" | "image" | "video" | "camera";
let kind: Kind = "none";
let ready = false, threshold = 0.4, objectUrl: string | undefined, stream: MediaStream | undefined;
let current = new Map<string, number>();
const tracker = new Tracker();
const window_: number[] = []; const history: Map<string, number>[] = [];
let lastRender = 0;

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const el = (): HTMLImageElement | HTMLVideoElement => (kind === "image" ? img : vid);

function resetCounts(): void { tracker.reset(); current = new Map(); history.length = 0; render(true); }

async function show(k: Kind): Promise<void> {
  kind = k; stream?.getTracks().forEach((t) => t.stop()); if (k !== "camera") stream = undefined;
  $("empty").hidden = true;
  img.hidden = k !== "image"; vid.hidden = k === "image" || k === "none";
  controls.hidden = k !== "video" && k !== "camera";
  $("seek").hidden = k !== "video"; $("back").hidden = $("fwd").hidden = $("reset").hidden = k !== "video"; time.hidden = k !== "video";
  await setMode(k === "image" ? "IMAGE" : "VIDEO");
  resetCounts();
}

function fitOverlay(w: number, h: number): void {
  overlay.width = w; overlay.height = h;
  const r = el().getBoundingClientRect(), s = stage.getBoundingClientRect();
  Object.assign(overlay.style, { width: `${r.width}px`, height: `${r.height}px`, left: `${r.left - s.left}px`, top: `${r.top - s.top}px` });
}

function draw(dets: Det[]): void {
  const lw = Math.max(2, overlay.width / 400), fs = Math.max(12, overlay.width / 55);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`; ctx.lineWidth = lw; ctx.textBaseline = "top";
  for (const d of dets) {
    ctx.strokeStyle = "#fff"; ctx.strokeRect(d.x - lw, d.y - lw, d.w + 2 * lw, d.h + 2 * lw);
    ctx.strokeStyle = "#5468d4"; ctx.strokeRect(d.x, d.y, d.w, d.h);
    const t = `${label(d.name)} ${Math.round(d.score * 100)}%`, tw = ctx.measureText(t).width + 10;
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
  draw(dets);
  current = new Map();
  for (const d of dets) current.set(d.name, (current.get(d.name) ?? 0) + 1);
  history.push(current); if (history.length > 30) history.shift();
  if (kind === "image") { tracker.reset(); for (const [k, v] of current) tracker.totals.set(k, v); }
  else tracker.update(dets);
}

function totals(): Map<string, number> { return kind === "image" ? current : tracker.totals; }

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
    : `<li class="muted">Noch nichts erkannt.</li>`;
  const sm = smoothed(), matches = rank(sm);
  renderScene(matches, sm);
  updateTreemap(tot, current);
}

function renderScene(matches: Match[], sm: Map<string, number>): void {
  const sc = $("scene"), cmp = $("compare");
  if (!matches.length) { sc.className = "scene muted"; sc.textContent = "Wird angezeigt, sobald Objekte erkannt sind."; return; }
  sc.className = "scene";
  const [best, ...rest] = matches;
  sc.innerHTML = `<div class="best">Vermutlich: ${best.scene.name}</div><p>${best.scene.hint} · Übereinstimmung ${Math.round(best.score * 100)} %</p>`
    + rest.slice(0, 2).map((m) => `<div class="alt"><span>Auch möglich: ${m.scene.name}</span><span>${Math.round(m.score * 100)} %</span></div>`).join("");
  const typ = best.scene.typical;
  const rows = [...new Set([...Object.keys(typ), ...sm.keys()])]
    .filter((k) => (typ[k] ?? 0) >= 1 || (sm.get(k) ?? 0) >= 0.5)
    .sort((a, b) => Math.max(typ[b] ?? 0, sm.get(b) ?? 0) - Math.max(typ[a] ?? 0, sm.get(a) ?? 0)).slice(0, 8);
  const max = Math.max(1, ...rows.map((k) => Math.max(typ[k] ?? 0, sm.get(k) ?? 0)));
  cmp.className = "";
  cmp.innerHTML = `<div class="muted" style="font-size:13px;margin-bottom:6px">${best.scene.name}: typisch (Strich) vs. bei dir (Balken)</div>`
    + rows.map((k) => {
      const y = sm.get(k) ?? 0, t = typ[k] ?? 0;
      return `<div class="cmp-row"><span>${label(k)}</span><div class="bar"><i style="width:${(y / max) * 100}%"></i><b style="left:${(t / max) * 100}%"></b></div><span class="num">${y.toFixed(1)} / ${t}</span></div>`;
    }).join("")
    + `<div class="note">Richtwerte sind grobe Schätzungen, keine gemessene Statistik.</div>`;
}

function loop(): void {
  if (ready && (kind === "video" || kind === "camera") && !vid.paused && !vid.ended && vid.readyState >= 2) {
    process(); render();
  }
  if (kind === "video") {
    time.textContent = `${fmt(vid.currentTime)} / ${fmt(vid.duration || 0)}`;
    if (document.activeElement !== seek && vid.duration) seek.value = String((vid.currentTime / vid.duration) * 1000);
  }
  playBtn.textContent = vid.paused ? "Abspielen" : "Pause";
  requestAnimationFrame(loop);
}

function revoke(): void { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = undefined; }

$<HTMLInputElement>("file-img").onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
  vid.pause(); revoke(); await show("image");
  objectUrl = URL.createObjectURL(f); img.src = objectUrl; await img.decode();
  if (ready) { process(); render(true); }
};
$<HTMLInputElement>("file-vid").onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
  revoke(); await show("video");
  vid.srcObject = null; objectUrl = URL.createObjectURL(f); vid.src = objectUrl; vid.muted = true; await vid.play().catch(() => undefined);
};
$("cam").onclick = async () => {
  try {
    revoke(); stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    await show("camera"); stream = stream; vid.removeAttribute("src"); vid.srcObject = stream; await vid.play();
  } catch { status.textContent = "Kamera nicht verfügbar oder nicht erlaubt."; }
};

const togglePlay = (): void => { if (kind === "video" || kind === "camera") void (vid.paused ? vid.play() : vid.pause()); };
playBtn.onclick = togglePlay;
$("back").onclick = () => { vid.currentTime = Math.max(0, vid.currentTime - 10); tracker.reset(false); };
$("fwd").onclick = () => { vid.currentTime = Math.min(vid.duration, vid.currentTime + 10); tracker.reset(false); };
$("reset").onclick = () => { vid.currentTime = 0; resetCounts(); void vid.play(); };
seek.oninput = () => { if (vid.duration) { vid.currentTime = (+seek.value / 1000) * vid.duration; tracker.reset(false); } };
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !(e.target instanceof HTMLInputElement && e.target.type !== "range") && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); togglePlay(); }
});
vid.addEventListener("seeked", () => { if (vid.paused && ready) { process(); render(true); } });
vid.addEventListener("pause", () => { if (kind === "video") render(true); });

$<HTMLInputElement>("thr").oninput = (e) => {
  threshold = +(e.target as HTMLInputElement).value / 100; $("thr-val").textContent = `${Math.round(threshold * 100)} %`;
  void setThreshold(threshold).then(() => { if (ready && kind !== "none" && (kind === "image" || vid.paused)) { process(); render(true); } });
};
openTm.onclick = () => openTreemap(totals(), current);

loadDetector(threshold).then((d) => { ready = true; openTm.disabled = false; status.textContent = `Modell bereit (${d})`; if (kind === "image") { process(); render(true); } })
  .catch((e) => { status.textContent = `Modell konnte nicht geladen werden: ${e}`; });
requestAnimationFrame(loop);
void window_;
