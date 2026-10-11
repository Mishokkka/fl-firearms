import { MODULE_ID } from "./constants.js";
import { isFirearm } from "./firearm-data.js";
import { buildRollContext, cancelPendingRollContext, setPendingRollContext } from "./roll-context.js";
import { createEmptyMagazineNotice, getMagazineCapacity, getMagazineCurrent, isEmptyMagazineAttack, isMagazineWeapon } from "./magazine.js";
import { SETTINGS, getSetting } from "./settings.js";
import { debug, log, warn } from "./logger.js";

const ROLL_METHOD_NAMES = Object.freeze(["rollGear"]);
const adapterStatus = { patchedClasses: 0, patchedMethods: 0, classNames: [] };

export function initActorSheetPatches() {
    const sheetClasses = collectActorSheetClasses();

    for (const sheetClass of sheetClasses) {
        let patchedForClass = 0;
        for (const methodName of ROLL_METHOD_NAMES) {
            if (patchSheetRollMethod(sheetClass, methodName)) patchedForClass += 1;
        }
        if (patchedForClass > 0) {
            adapterStatus.patchedClasses += 1;
            adapterStatus.patchedMethods += patchedForClass;
            adapterStatus.classNames.push(sheetClass.name ?? "UnknownActorSheet");
        }
    }

    if (adapterStatus.patchedMethods === 0) {
        warn("rollGear was not found on registered Actor sheets");
        if (game.user?.isGM) ui.notifications.error("FL Firearms: не удалось подключиться к броскам Forbidden Lands. Откройте диагностику модуля.");
    } else {
        log(`roll adapter: ${adapterStatus.patchedMethods} methods on ${adapterStatus.patchedClasses} sheet classes`);
    }
}

export function getRollAdapterStatus() {
    return { ...adapterStatus, classNames: [...adapterStatus.classNames] };
}

function collectActorSheetClasses() {
    const classes = new Set();
    for (const byType of Object.values(CONFIG.Actor.sheetClasses ?? {})) {
        for (const entry of Object.values(byType ?? {})) {
            if (entry?.cls) classes.add(entry.cls);
            else if (typeof entry === "function") classes.add(entry);
        }
    }
    return classes;
}

function patchSheetRollMethod(sheetClass, methodName) {
    if (!sheetClass?.prototype) return false;
    const original = sheetClass.prototype[methodName];
    if (typeof original !== "function") return false;

    const marker = `__${MODULE_ID.replaceAll("-", "_")}_${methodName}_wrapped`;
    if (sheetClass.prototype[marker]) return true;

    Object.defineProperty(sheetClass.prototype, marker, { value: true, configurable: false });
    sheetClass.prototype[methodName] = async function (...args) {
        const actor = this.actor;
        const item = extractOwnedItemFromRollCall(this, args);
        if (!actor || !isFirearm(item)) return original.apply(this, args);

        const snapshot = buildAttackSnapshot(item);
        const context = buildRollContext(actor, item, { isPushRoll: false, ...snapshot });

        const hookResult = Hooks.call(`${MODULE_ID}.preAttack`, actor, item, context);
        if (hookResult === false) return null;

        if (snapshot.emptyMagazineAttack && getSetting(SETTINGS.BLOCK_EMPTY_MAGAZINE_ATTACK)) {
            await createEmptyMagazineNotice(actor, item, { source: "preflight" });
            Hooks.callAll(`${MODULE_ID}.dryFire`, actor, item, context);
            return null;
        }

        const nonce = setPendingRollContext(context, null);
        try {
            return await original.apply(this, args);
        } finally {
            cancelPendingRollContext(nonce);
        }
    };

    debug(`patched ${sheetClass.name}.${methodName}`);
    return true;
}

function buildAttackSnapshot(item) {
    const magazine = isMagazineWeapon(item);
    const capacity = magazine ? getMagazineCapacity(item) : 0;
    const current = magazine ? getMagazineCurrent(item) : null;
    return {
        magazineWeapon: magazine,
        magazineCapacity: capacity,
        magazineBeforeShot: current,
        ammoCost: 1,
        emptyMagazineAttack: magazine && capacity > 0 && current <= 0
    };
}

function extractOwnedItemFromRollCall(sheet, args) {
    const actor = sheet?.actor;
    if (!actor?.items) return null;

    const directId = args.find(arg => typeof arg === "string" && actor.items.has(arg));
    if (directId) return actor.items.get(directId);

    for (const arg of args) {
        const item = extractOwnedItemFromArgument(actor, arg);
        if (item) return item;
    }
    return null;
}

function extractOwnedItemFromArgument(actor, arg) {
    if (!arg) return null;
    const isFoundryItem = typeof Item !== "undefined" && arg instanceof Item;
    if ((arg.documentName === "Item" || isFoundryItem) && actor.items.has(arg.id)) return actor.items.get(arg.id);

    const candidateIds = [
        arg.itemId, arg.id, arg.dataset?.itemId, arg.currentTarget?.dataset?.itemId,
        arg.target?.dataset?.itemId, arg.currentTarget?.closest?.("[data-item-id]")?.dataset?.itemId,
        arg.target?.closest?.("[data-item-id]")?.dataset?.itemId
    ].filter(Boolean);
    for (const itemId of candidateIds) if (actor.items.has(itemId)) return actor.items.get(itemId);

    for (const candidate of [arg.item, arg.document, arg.currentTarget?.item, arg.target?.item].filter(Boolean)) {
        const item = extractOwnedItemFromArgument(actor, candidate);
        if (item) return item;
    }
    return null;
}
