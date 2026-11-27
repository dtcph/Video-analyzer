import { STRINGS } from "./strings";

export type Lang = "ko" | "en";
let lang: Lang = "ko"; // the default is always Korean, nothing is remembered
const listeners: (() => void)[] = [];

export const getLang = (): Lang => lang;
export const onLang = (f: () => void): void => { listeners.push(f); };

export function t(key: string, params: Record<string, string | number> = {}): string {
  const s = STRINGS[key]?.[lang] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ""));
}

/** Fills every element marked with data-i18n, data-i18n-title or data-i18n-aria. */
export function applyStatic(): void {
  document.documentElement.lang = lang;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((e) => { e.textContent = t(e.dataset.i18n!); });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((e) => { e.title = t(e.dataset.i18nTitle!); });
  document.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((e) => { e.setAttribute("aria-label", t(e.dataset.i18nAria!)); });
  document.querySelectorAll<HTMLElement>("[data-lang]").forEach((e) => e.classList.toggle("on", e.dataset.lang === lang));
}

export function setLang(l: Lang): void {
  if (l === lang) return;
  lang = l; applyStatic(); listeners.forEach((f) => f());
}
