import { label } from "./labels";
import { squarify } from "./treemap";

const SHADES = ["#0b0b0c", "#2a2c33", "#474a55", "#666a78", "#868a99", "#a6aab8"];
const $ = (id: string): HTMLElement => document.getElementById(id)!;

let mode: "total" | "current" = "total";
let last: [Map<string, number>, Map<string, number>] = [new Map(), new Map()];
const nodes = new Map<string, HTMLElement>();

export const isOpen = (): boolean => !$("tm").hidden;

export function openTreemap(): void {
  $("tm").hidden = false;
  (document.activeElement as HTMLElement | null)?.blur();
  $("tm-panel").focus({ preventScroll: true });
  updateTreemap(...last);
}

export function closeTreemap(): void { $("tm").hidden = true; nodes.clear(); $("tm-map").innerHTML = ""; }

export function initTreemap(): void {
  $("tm-close").onclick = closeTreemap;
  $("tm").onclick = (e) => { if (e.target === $("tm")) closeTreemap(); }; // click outside the panel
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) closeTreemap(); });
  const set = (m: typeof mode): void => {
    mode = m; $("tm-total").classList.toggle("on", m === "total"); $("tm-cur").classList.toggle("on", m === "current");
    updateTreemap(...last);
  };
  $("tm-total").onclick = () => set("total");
  $("tm-cur").onclick = () => set("current");
  window.addEventListener("resize", () => updateTreemap(...last));
}

/** Live update; cells glide to their new position and size (300 ms ease-in-out, see CSS). */
export function updateTreemap(total: Map<string, number>, current: Map<string, number>): void {
  last = [total, current];
  if (!isOpen()) return;
  const map = $("tm-map");
  const rects = squarify([...(mode === "total" ? total : current)].map(([key, value]) => ({ key, label: label(key), value })), map.clientWidth, map.clientHeight);
  let empty = map.querySelector<HTMLElement>(".empty");
  if (!rects.length) {
    for (const n of nodes.values()) n.remove();
    nodes.clear();
    if (!empty) { empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "No objects yet."; map.appendChild(empty); }
    return;
  }
  empty?.remove();
  const live = new Set(rects.map((r) => r.key));
  for (const [k, n] of nodes) if (!live.has(k)) { n.remove(); nodes.delete(k); }
  rects.forEach((r, i) => {
    let n = nodes.get(r.key);
    if (!n) { n = document.createElement("div"); n.className = "cell"; map.appendChild(n); nodes.set(r.key, n); }
    n.classList.toggle("top", i === 0);
    Object.assign(n.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, background: SHADES[Math.min(i, SHADES.length - 1)] });
    n.innerHTML = `<b>${r.label}</b><span>${r.value}</span>`;
  });
}
