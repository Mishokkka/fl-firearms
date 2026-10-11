import { SETTINGS, getSetting } from "./settings.js";
import { isFirearm } from "./firearm-data.js";

export function patchConsumableLabels(actor, root) {
    if (!actor || !root?.querySelectorAll) return;
    const mode = getSetting(SETTINGS.RENAME_CONSUMABLES_MODE);
    if (mode === "off" || (mode === "firearmActorsOnly" && !actor.items?.some?.(isFirearm))) return;
    for (const [key, label] of [["arrows", "Bullets"], ["torches", "Lamp Oil"]]) {
        for (const button of root.querySelectorAll(`.roll-consumable[data-consumable="${key}"]`)) {
            if (button.textContent !== label) button.textContent = label;
        }
    }
}
