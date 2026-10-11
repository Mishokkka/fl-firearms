import { DATA_SCHEMA_VERSION, FIREARM_FEATURES, MODULE_ID } from "./constants.js";
import { SETTINGS, getSetting } from "./settings.js";
import { isRangedWeapon, sanitizeFeatureValue, toInteger } from "./firearm-data.js";
import { log, warn } from "./logger.js";

const VALID_FEATURE_KEYS = new Set(FIREARM_FEATURES.map(feature => feature.key));
const MIGRATION_BATCH_SIZE = 100;

export function initDataCleanupHooks() {
    Hooks.on("preUpdateItem", clearFirearmFlagOnInvalidWeaponUpdate);
    const normalizeActorItems = actor => Promise.all((actor?.items?.contents ?? []).map(normalizeFirearmItemData));
    Hooks.on("createActor", (actor, _options, userId) => {
        if (userId === game.user.id) void normalizeActorItems(actor).catch(error => warn("new actor normalization failed", error));
    });
    Hooks.on("createToken", (token, _options, userId) => {
        if (!token.actorLink && userId === game.user.id) void normalizeActorItems(token.actor).catch(error => warn("new token normalization failed", error));
    });
    Hooks.on("createItem", (item, _options, userId) => {
        if (userId === game.user.id) void normalizeFirearmItemData(item).catch(error => warn("new item normalization failed", error));
    });
}

export async function runMigrations() {
    if (!game.user?.isGM) return;
    const activeGM = (game.users?.contents ?? []).filter(user => user.active && user.isGM).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[0];
    if (activeGM && activeGM.id !== game.user.id) return;
    const currentVersion = Number(game.settings.get(MODULE_ID, SETTINGS.DATA_VERSION) ?? 0);
    if (currentVersion >= DATA_SCHEMA_VERSION) return;

    log(`running migrations ${currentVersion} -> ${DATA_SCHEMA_VERSION}`);
    const changes = collectMigrationChanges(currentVersion);
    const updated = await applyMigrationChanges(changes);

    const expected = changes.world.length + [...changes.ownedByActor.values()].reduce((sum, batch) => sum + batch.length, 0);
    if (updated !== expected) {
        warn(`migration incomplete: ${updated}/${expected}; version unchanged`);
        ui.notifications.warn("FL Firearms: часть данных не удалось обновить. Миграция повторится при следующем запуске.");
        return false;
    }
    await game.settings.set(MODULE_ID, SETTINGS.DATA_VERSION, DATA_SCHEMA_VERSION);
    log(`migrations complete; updated ${updated} item(s)`);
}

export async function normalizeFirearmItemData(item) {
    if (!item?.isOwner) return false;
    const updates = buildItemMigrationUpdates(item, 0);
    if (!Object.keys(updates).length) return false;
    await item.update(updates);
    return true;
}

function collectMigrationChanges(fromVersion) {
    const world = [];
    const ownedByActor = new Map();

    for (const item of game.items?.contents ?? []) {
        const updates = buildItemMigrationUpdates(item, fromVersion);
        if (Object.keys(updates).length) world.push({ item, updates });
    }

    const actors = new Map((game.actors?.contents ?? []).map(actor => [actor.uuid, actor]));
    for (const scene of game.scenes?.contents ?? []) {
        for (const token of scene.tokens?.contents ?? []) {
            if (!token.actorLink && token.actor) actors.set(token.actor.uuid, token.actor);
        }
    }
    for (const actor of actors.values()) {
        const changes = [];
        for (const item of actor.items?.contents ?? []) {
            const updates = buildItemMigrationUpdates(item, fromVersion);
            if (Object.keys(updates).length) changes.push({ item, updates });
        }
        if (changes.length) ownedByActor.set(actor, changes);
    }

    return { world, ownedByActor };
}

async function applyMigrationChanges({ world, ownedByActor }) {
    let updated = 0;

    if (world.length) {
        const ItemClass = globalThis.CONFIG?.Item?.documentClass ?? globalThis.Item;
        for (const batch of chunk(world, MIGRATION_BATCH_SIZE)) {
            if (typeof ItemClass?.updateDocuments === "function") {
                try {
                    await ItemClass.updateDocuments(batch.map(({ item, updates }) => ({ _id: item.id, ...updates })));
                    const remaining = batch.filter(({ item }) => Object.keys(buildItemMigrationUpdates(item)).length);
                    updated += batch.length - remaining.length;
                    updated += await applyIndividually(remaining);
                    continue;
                } catch (error) {
                    warn(`world item migration batch failed; retrying ${batch.length} item(s) individually`, error);
                }
            }

            updated += await applyIndividually(batch);
        }
    }

    for (const [actor, changes] of ownedByActor) {
        for (const batch of chunk(changes, MIGRATION_BATCH_SIZE)) {
            if (typeof actor.updateEmbeddedDocuments === "function") {
                try {
                    await actor.updateEmbeddedDocuments("Item", batch.map(({ item, updates }) => ({ _id: item.id, ...updates })));
                    const remaining = batch.filter(({ item }) => Object.keys(buildItemMigrationUpdates(item)).length);
                    updated += batch.length - remaining.length;
                    updated += await applyIndividually(remaining);
                    continue;
                } catch (error) {
                    warn(`owned item migration batch failed for ${actor.uuid ?? actor.id}; retrying ${batch.length} item(s) individually`, error);
                }
            }

            updated += await applyIndividually(batch);
        }
    }

    return updated;
}

async function applyIndividually(changes) {
    let updated = 0;
    for (const { item, updates } of changes) {
        try {
            await item.update(updates);
            if (!Object.keys(buildItemMigrationUpdates(item)).length) updated += 1;
        } catch (error) {
            warn(`migration failed for ${item.uuid ?? item.id}`, error);
        }
    }
    return updated;
}

function chunk(values, size) {
    const result = [];
    for (let index = 0; index < values.length; index += size) {
        result.push(values.slice(index, index + size));
    }
    return result;
}

function buildItemMigrationUpdates(item, fromVersion = 0) {
    const updates = {};
    void fromVersion;

    const oldKamora = item.getFlag(MODULE_ID, "feat_kamora");
    if (oldKamora && !item.getFlag(MODULE_ID, "feat_Kamora")) updates[`flags.${MODULE_ID}.feat_Kamora`] = true;
    if (oldKamora !== undefined) updates[`flags.${MODULE_ID}.-=feat_kamora`] = null;

    const order = item.getFlag(MODULE_ID, "featureOrder");
    if (Array.isArray(order)) {
        const normalized = [...new Set(order.filter(key => VALID_FEATURE_KEYS.has(key)))];
        if (JSON.stringify(normalized) !== JSON.stringify(order)) updates[`flags.${MODULE_ID}.featureOrder`] = normalized;
    }

    if (item.getFlag(MODULE_ID, "isFirearm") && !isRangedWeapon(item)) updates[`flags.${MODULE_ID}.isFirearm`] = false;

    const reloadType = item.getFlag(MODULE_ID, "reloadType");
    if (reloadType === "MAG") {
        const capacity = toInteger(item.getFlag(MODULE_ID, "magCapacity"), 0, 999, 0);
        const rawCurrent = item.getFlag(MODULE_ID, "magCurrent");
        if (rawCurrent === undefined || rawCurrent === null || rawCurrent === "") {
            updates[`flags.${MODULE_ID}.magCurrent`] = getSetting(SETTINGS.DEFAULT_MAGAZINE_STATE) === "empty" ? 0 : capacity;
        } else {
            const current = toInteger(rawCurrent, 0, capacity, 0);
            if (String(current) !== String(rawCurrent)) updates[`flags.${MODULE_ID}.magCurrent`] = current;
        }
        if (String(capacity) !== String(item.getFlag(MODULE_ID, "magCapacity") ?? "")) updates[`flags.${MODULE_ID}.magCapacity`] = capacity;
    }

    for (const feature of FIREARM_FEATURES) {
        if (!feature.hasInput || !item.getFlag(MODULE_ID, `feat_${feature.key}`)) continue;
        const raw = item.getFlag(MODULE_ID, `val_${feature.key}`);
        const normalized = sanitizeFeatureValue(feature, raw);
        if (String(normalized ?? "") !== String(raw ?? "")) updates[`flags.${MODULE_ID}.val_${feature.key}`] = normalized;
    }

    return updates;
}

function clearFirearmFlagOnInvalidWeaponUpdate(item, change) {
    const nextCategory = foundry.utils.getProperty(change, "system.category") ?? item.system?.category;
    const nextIsFirearm = foundry.utils.getProperty(change, `flags.${MODULE_ID}.isFirearm`) ?? item.getFlag(MODULE_ID, "isFirearm");
    if (!nextIsFirearm) return;
    if (item.type === "weapon" && nextCategory === "ranged") return;
    foundry.utils.setProperty(change, `flags.${MODULE_ID}.isFirearm`, false);
}
