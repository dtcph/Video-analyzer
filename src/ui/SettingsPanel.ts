import type { AnySettingDef, NumberDef, SettingGroup, SettingKey } from "../settings/SettingsSchema";
import { SETTING_KEYS, settingDef } from "../settings/SettingsSchema";
import type { SettingsStore } from "../settings/SettingsStore";

/**
 * The settings panel, generated entirely from SettingsSchema:
 * - "main" settings, always visible;
 * - "Advanced", a <details> that starts closed on every load (its open
 *   state is deliberately never persisted);
 * - "Debug", a separate <details>; `debugBody` is where App adds
 *   read-only diagnostics (timings, backend, dropped frames);
 * - "Reset to defaults".
 *
 * The panel owns no settings state: it renders SettingsStore and writes
 * user input back to it.
 */
export class SettingsPanel {
    readonly element: HTMLElement;
    readonly debugBody: HTMLElement;
    private readonly syncers: (() => void)[] = [];
    private readonly resetButton: HTMLButtonElement;

    constructor(private readonly store: SettingsStore) {
        this.element = document.createElement("section");
        this.element.className = "panel settings-panel";
        this.element.innerHTML = `<h2 class="panel-title">Settings</h2>`;

        const main = document.createElement("div");
        main.className = "settings-group";
        main.dataset.group = "main";
        const advanced = section("Advanced", "advanced");
        const debug = section("Debug", "debug");
        this.debugBody = debug.body;

        const containers: Record<SettingGroup, HTMLElement> = {
            main,
            advanced: advanced.body,
            debug: debug.body
        };
        for (const key of SETTING_KEYS) {
            const def = settingDef(key);
            containers[def.group].appendChild(this.buildControl(key, def));
        }

        this.resetButton = document.createElement("button");
        this.resetButton.type = "button";
        this.resetButton.className = "settings-reset-button";
        this.resetButton.textContent = "Reset to defaults";
        this.resetButton.addEventListener("click", () => this.store.resetToDefaults());

        this.element.append(main, advanced.details, debug.details, this.resetButton);
        this.store.onChange(() => this.sync());
        this.sync();
    }

    private sync(): void {
        for (const sync of this.syncers) sync();
        this.resetButton.disabled = this.store.isAtDefaults();
    }

    private buildControl(key: SettingKey, def: AnySettingDef): HTMLElement {
        const row = document.createElement("div");
        row.className = `settings-control is-${def.kind}`;
        row.dataset.setting = key;
        row.title = def.description;
        const store = this.store;

        if (def.kind === "boolean") {
            const label = document.createElement("label");
            label.className = "settings-check";
            const input = document.createElement("input");
            input.type = "checkbox";
            input.addEventListener("change", () => store.set(key, input.checked as never));
            label.append(input, document.createTextNode(` ${def.label}`));
            row.appendChild(label);
            this.syncers.push(() => (input.checked = Boolean(store.get(key))));
            return row;
        }

        const header = document.createElement("label");
        header.className = "settings-control-header";
        const name = document.createElement("span");
        name.textContent = def.label;
        header.appendChild(name);
        row.appendChild(header);

        if (def.kind === "choice") {
            const select = document.createElement("select");
            def.options.forEach((option, index) => {
                const el = document.createElement("option");
                el.value = String(index);
                el.textContent = option.label;
                select.appendChild(el);
            });
            // Option values may be numbers; map through the index so the type survives the DOM round trip.
            select.addEventListener("change", () => store.set(key, def.options[Number(select.value)].value as never));
            header.appendChild(select);
            this.syncers.push(() => {
                select.value = String(def.options.findIndex((option) => option.value === store.get(key)));
            });
            return row;
        }

        const value = document.createElement("span");
        value.className = "settings-value";
        header.appendChild(value);
        const input = document.createElement("input");
        input.type = "range";
        input.min = String(def.min);
        input.max = String(def.max);
        input.step = String(def.step);
        input.setAttribute("aria-label", def.label);
        input.addEventListener("input", () => store.set(key, Number(input.value) as never));
        row.appendChild(input);
        this.syncers.push(() => {
            const current = Number(store.get(key));
            input.value = String(current);
            value.textContent = formatSettingValue(def, current);
        });
        return row;
    }
}

export function formatSettingValue(def: NumberDef, value: number): string {
    switch (def.format) {
        case "percent":
            return `${Math.round(value * 100)}%`;
        case "integer":
            return String(Math.round(value));
        case "fps":
            return `${Math.round(value)} fps`;
        case "frames":
            return `${Math.round(value)} ${Math.round(value) === 1 ? "frame" : "frames"}`;
        case "seconds":
            return `${value.toFixed(1)} s`;
        default:
            return value.toFixed(2);
    }
}

/** A collapsible group. Starts closed and is never restored from storage: "closed on every load" is a requirement. */
function section(title: string, group: SettingGroup): { details: HTMLDetailsElement; body: HTMLElement } {
    const details = document.createElement("details");
    details.className = "settings-section";
    details.dataset.group = group;
    const summary = document.createElement("summary");
    summary.textContent = title;
    const body = document.createElement("div");
    body.className = "settings-section-body";
    details.append(summary, body);
    return { details, body };
}
