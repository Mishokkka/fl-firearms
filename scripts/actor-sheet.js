import { SETTINGS, getSetting } from "./settings.js";
import { isFirearm } from "./firearm-data.js";

const CONSUMABLE_REPLACEMENTS = Object.freeze([
    ["Arrows", "Bullets"],
    ["Torches", "Lamp Oil"]
]);

export function patchConsumableLabels(actor, root) {
    if (!actor || !root) return;

    const mode = getSetting(SETTINGS.RENAME_CONSUMABLES_MODE);
    if (mode === "off") return;
    if (mode === "firearmActorsOnly" && !actor.items?.some?.(isFirearm)) return;

    replaceConsumableText(root);
}

function replaceConsumableText(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
        const node = walker.currentNode;
        const value = node.nodeValue;
        if (!value) continue;

        let nextValue = value;
        for (const [from, to] of CONSUMABLE_REPLACEMENTS) {
            if (nextValue.includes(from)) nextValue = nextValue.replaceAll(from, to);
        }

        if (nextValue !== value) node.nodeValue = nextValue;
    }
}
