import { getLang, t } from "./i18n";
import { label } from "./labels";
import { squarify, unitGrid, type Item, type Rect } from "./treemap";
import { fitLabel, type Fit } from "./treemapLabel";

const SHADES = ["#0b0b0c", "#2a2c33", "#474a55", "#666a78", "#868a99", "#a6aab8"];
const LIGHT = 4; // from this shade on, dark text reads better than white
const ANIMALS = new Set(["bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe"]);
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

export function closeTreemap(): void { $("tm").hidden = true; $("tm-tip").hidden = true; nodes.clear(); $("tm-map").innerHTML = ""; }

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
  $("tm-map").addEventListener("pointermove", showTip);
  $("tm-map").addEventListener("pointerdown", showTip);
  $("tm-map").addEventListener("pointerleave", () => { $("tm-tip").hidden = true; });
}

/** Tooltip at the pointer while it is over one of the unit parts ("1 Person"). */
function showTip(e: PointerEvent): void {
  const tip = $("tm-tip"), unit = (e.target as HTMLElement).closest<HTMLElement>(".unit");
  tip.hidden = !unit;
  if (!unit) return;
  const key = unit.closest<HTMLElement>(".cell")!.dataset.key!;
  const counter = key === "person" ? "명" : ANIMALS.has(key) ? "마리" : "개";
  tip.textContent = t("tm.unit", { n: label(key), c: getLang() === "ko" ? counter : "" });
  const gap = 16, w = tip.offsetWidth, h = tip.offsetHeight; // stay inside the window
  tip.style.left = `${e.clientX + gap + w > innerWidth ? e.clientX - gap - w : e.clientX + gap}px`;
  tip.style.top = `${e.clientY + gap + h > innerHeight ? e.clientY - gap - h : e.clientY + gap}px`;
}

/**
 * Areas are proportional to the counts. Only if a title would not fit even at the smallest type step,
 * that box is enlarged step by step until it does.
 */
function layout(items: Item[], w: number, h: number, border: number): { rect: Rect; fit: Fit | null }[] {
  const weight = new Map(items.map((i) => [i.key, i.value]));
  const count = new Map(weight);
  for (let pass = 0; ; pass++) {
    const out = squarify(items.map((i) => ({ ...i, value: weight.get(i.key)! })), w, h)
      .map((rect) => ({ rect, fit: fitLabel(rect.label, count.get(rect.key)!, rect.w - 2 * border, rect.h - 2 * border) }));
    const tight = out.filter((o) => !o.fit);
    if (!tight.length || tight.length === out.length || pass === 40) return out;
    for (const o of tight) weight.set(o.rect.key, weight.get(o.rect.key)! * 1.2);
  }
}

/** Live update; cells glide to their new position and size (300 ms ease-in-out, see CSS). */
export function updateTreemap(total: Map<string, number>, current: Map<string, number>): void {
  last = [total, current];
  if (!isOpen()) return;
  const map = $("tm-map");
  const data = mode === "total" ? total : current;
  const border = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rule"));
  const items = [...data].map(([key, value]) => ({ key, label: label(key), value }));
  const cells = layout(items, map.clientWidth, map.clientHeight, border);
  let empty = map.querySelector<HTMLElement>(".empty");
  if (!cells.length) {
    for (const n of nodes.values()) n.remove();
    nodes.clear();
    $("tm-tip").hidden = true;
    if (!empty) { empty = document.createElement("div"); empty.className = "empty"; map.appendChild(empty); }
    empty.textContent = t("tm.empty");
    return;
  }
  empty?.remove();
  const live = new Set(cells.map((c) => c.rect.key));
  for (const [k, n] of nodes) if (!live.has(k)) { n.remove(); nodes.delete(k); $("tm-tip").hidden = true; }
  cells.forEach(({ rect: r, fit }, i) => {
    let n = nodes.get(r.key);
    if (!n) {
      n = document.createElement("div"); n.className = "cell"; n.dataset.key = r.key;
      n.innerHTML = `<div class="units"></div><div class="title"></div>`;
      map.appendChild(n); nodes.set(r.key, n);
    }
    const value = data.get(r.key)!, shade = Math.min(i, SHADES.length - 1);
    n.classList.toggle("top", i === 0);
    n.classList.toggle("light", i > 0 && shade >= LIGHT);
    n.setAttribute("aria-label", `${r.label}: ${value}`);
    Object.assign(n.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, backgroundColor: SHADES[shade] });
    renderUnits(n.querySelector<HTMLElement>(".units")!, value, r.w, r.h);
    renderTitle(n.querySelector<HTMLElement>(".title")!, fit, r.label, value);
  });
}

/** One part per counted object. Rebuilt only when the division changes, so hovering survives live updates. */
function renderUnits(box: HTMLElement, value: number, w: number, h: number): void {
  const parts = unitGrid(value, w, h);
  const signature = parts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(";");
  if (box.dataset.signature === signature) return;
  box.dataset.signature = signature;
  box.replaceChildren(...parts.map((p) => {
    const u = document.createElement("i"); u.className = "unit";
    Object.assign(u.style, { left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, height: `${p.h}%` });
    return u;
  }));
}

function renderTitle(box: HTMLElement, fit: Fit | null, name: string, value: number): void {
  box.classList.toggle("vertical", !!fit?.vertical);
  box.hidden = !fit; // no room at all (tiny window): the tooltip still names the box
  if (!fit) return;
  Object.assign(box.style, { fontSize: `${fit.size}px`, lineHeight: `${fit.line}px`, padding: `${fit.pad}px` });
  const html = `<b>${(fit.count === null ? [`${name} ${value}`] : fit.lines).join("<br>")}</b>${fit.count === null ? "" : `<span>${fit.count}</span>`}`;
  if (box.innerHTML !== html) box.innerHTML = html;
}
