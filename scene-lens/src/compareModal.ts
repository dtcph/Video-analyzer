import { t } from "./i18n";
import { label } from "./labels";
import { SCENES, type Match } from "./scenes";

const $ = (id: string): HTMLElement => document.getElementById(id)!;

/** Scene chosen by the user; null follows the most likely one. */
let pick: string | null = null;
let last: [Match[], Map<string, number>] = [[], new Map()];
/** One button per scene, created once and kept in a fixed order, so live updates never move or replace a button under the pointer. */
const buttons = new Map<string, HTMLButtonElement>();

const isOpen = (): boolean => !$("cmp").hidden;

export function openCompare(): void {
  $("cmp").hidden = false;
  (document.activeElement as HTMLElement | null)?.blur();
  $("cmp-panel").focus({ preventScroll: true });
  updateCompare(...last);
}

export const closeCompare = (): void => { $("cmp").hidden = true; };

/** For a new source: back to following the most likely scene. */
export const resetCompare = (): void => { pick = null; closeCompare(); };

export function initCompare(): void {
  for (const scene of SCENES) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.scene = scene.id;
    b.onclick = () => { pick = scene.id === last[0][0]?.scene.id ? null : scene.id; updateCompare(...last); };
    $("cmp-scenes").appendChild(b);
    buttons.set(scene.id, b);
  }
  $("cmp-close").onclick = closeCompare;
  $("cmp").onclick = (e) => { if (e.target === $("cmp")) closeCompare(); }; // click outside the panel
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) closeCompare(); });
}

export function updateCompare(matches: Match[], seen: Map<string, number>): void {
  last = [matches, seen];
  if (!isOpen()) return;
  const box = $("compare");
  $("cmp-scenes").hidden = !matches.length;
  if (!matches.length) { box.innerHTML = `<div class="span-all muted">${t("cmp.empty")}</div>`; return; }
  const best = matches[0].scene.id;
  const chosen = matches.find((m) => m.scene.id === (pick ?? best))!;
  for (const m of matches) {
    const b = buttons.get(m.scene.id)!, on = m === chosen;
    b.classList.toggle("on", on); b.classList.toggle("likely", m.scene.id === best);
    b.setAttribute("aria-pressed", String(on));
    b.textContent = `${t(`scene.${m.scene.id}`)} ${Math.round(m.score * 100)} %`;
  }
  const typical = chosen.scene.typical;
  const rows = [...new Set([...Object.keys(typical), ...seen.keys()])]
    .filter((k) => (typical[k] ?? 0) >= 1 || (seen.get(k) ?? 0) >= 0.5)
    .sort((a, b) => Math.max(typical[b] ?? 0, seen.get(b) ?? 0) - Math.max(typical[a] ?? 0, seen.get(a) ?? 0)).slice(0, 8);
  const max = Math.max(1, ...rows.map((k) => Math.max(typical[k] ?? 0, seen.get(k) ?? 0)));
  // the chosen button already names the scene; one line explains the bars and that the typical values are estimates
  box.innerHTML = `<div class="span-all muted legend">${t("cmp.legend")}</div>`
    + rows.map((k) => {
      const y = seen.get(k) ?? 0, typ = typical[k] ?? 0;
      return `<div class="cmp-row"><span>${label(k)}</span><div class="bar-track"><i style="width:${(y / max) * 100}%"></i><b style="left:${(typ / max) * 100}%"></b></div><span class="num">${y.toFixed(1)} / ${typ}</span></div>`;
    }).join("");
}
