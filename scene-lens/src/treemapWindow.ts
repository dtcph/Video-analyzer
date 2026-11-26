import { label } from "./labels";
import { squarify } from "./treemap";

let win: Window | null = null;
let mode: "total" | "current" = "total";
const SHADES = ["#0b0b0c", "#2a2c33", "#474a55", "#666a78", "#868a99", "#a6aab8"];

const STYLE = `*{box-sizing:border-box}body{margin:0;font:14px Inter,system-ui,sans-serif;background:#fff;color:#0b0b0c;height:100vh;display:flex;flex-direction:column;padding:24px;gap:16px}
h1{margin:0;font-size:36px;font-weight:800;letter-spacing:-.03em}.bar{display:flex;gap:8px;align-items:center}
button{border:1px solid #0b0b0c;background:#fff;color:#0b0b0c;border-radius:999px;padding:7px 14px;font:600 13px inherit;font-family:inherit;cursor:pointer}
button.on{background:#0b0b0c;color:#fff}#map{position:relative;flex:1;border-radius:12px;overflow:hidden;background:#f5f5f6}
.c{position:absolute;border:2px solid #fff;color:#fff;padding:10px;overflow:hidden;transition:all .3s ease}.c b{display:block;font-size:clamp(13px,2.2vw,26px);letter-spacing:-.02em}.c span{opacity:.75}
.c.top{background:#5468d4!important}.empty{padding:24px;color:#6b6e76}`;

export function openTreemap(total: Map<string, number>, current: Map<string, number>): void {
  if (win && !win.closed) { win.focus(); return; }
  win = window.open("", "scene-lens-treemap", "width=900,height=640");
  if (!win) { alert("Pop-up wurde blockiert. Bitte Pop-ups für diese Seite erlauben."); return; }
  win.document.title = "Scene Lens · Treemap";
  win.document.head.innerHTML = `<style>${STYLE}</style>`;
  win.document.body.innerHTML = `<h1>Treemap</h1><div class="bar"><button id="t" class="on">Gesamt</button><button id="c">Aktuelles Bild</button></div><div id="map"></div>`;
  const set = (m: typeof mode): void => { mode = m; win!.document.getElementById("t")!.className = m === "total" ? "on" : ""; win!.document.getElementById("c")!.className = m === "current" ? "on" : ""; };
  win.document.getElementById("t")!.onclick = () => set("total");
  win.document.getElementById("c")!.onclick = () => set("current");
  win.addEventListener("resize", () => lastArgs && updateTreemap(...lastArgs));
  lastArgs = [total, current]; updateTreemap(total, current);
}

let lastArgs: [Map<string, number>, Map<string, number>] | undefined;
const nodes = new Map<string, HTMLElement>();

/** Live update; called from the analysis loop while the popup is open. */
export function updateTreemap(total: Map<string, number>, current: Map<string, number>): void {
  lastArgs = [total, current];
  if (!win || win.closed) { nodes.clear(); return; }
  const map = win.document.getElementById("map"); if (!map) return;
  const src = mode === "total" ? total : current;
  const rects = squarify([...src].map(([key, value]) => ({ key, label: label(key), value })), map.clientWidth, map.clientHeight);
  if (!rects.length) { map.innerHTML = `<div class="empty">Noch keine Objekte.</div>`; nodes.clear(); return; }
  map.querySelector(".empty")?.remove();
  const live = new Set(rects.map((r) => r.key));
  for (const [k, n] of nodes) if (!live.has(k)) { n.remove(); nodes.delete(k); }
  rects.forEach((r, i) => {
    let n = nodes.get(r.key);
    if (!n || !n.isConnected) { n = win!.document.createElement("div"); n.className = "c"; map.appendChild(n); nodes.set(r.key, n); }
    n.classList.toggle("top", i === 0);
    Object.assign(n.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, background: SHADES[Math.min(i, SHADES.length - 1)] });
    n.innerHTML = `<b>${r.label}</b><span>${r.value}</span>`;
  });
}
