import { MODULE_ID } from "./constants.js";
import { SETTINGS, getSetting } from "./settings.js";

export function log(...args) {
    console.log(`${MODULE_ID} |`, ...args);
}

export function debug(...args) {
    try {
        if (!getSetting(SETTINGS.DEBUG_LOGS)) return;
    } catch (_error) {
        return;
    }
    console.debug(`${MODULE_ID} |`, ...args);
}

export function warn(...args) {
    console.warn(`${MODULE_ID} |`, ...args);
}

export function error(...args) {
    console.error(`${MODULE_ID} |`, ...args);
}
