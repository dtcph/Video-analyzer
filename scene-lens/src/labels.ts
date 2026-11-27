import { getLang } from "./i18n";
import { CLASS_KO } from "./strings";

/** Display name of a COCO class in the current language. */
export const label = (name: string): string =>
  getLang() === "ko" ? (CLASS_KO[name] ?? name) : name.charAt(0).toUpperCase() + name.slice(1);
