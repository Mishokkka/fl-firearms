import { MODULE_ID, TIMING } from "./constants.js";
import { isFirearm } from "./firearm-data.js";
import { collectMessageItemIds, collectMessageItemUuids, fromUuidSyncSafe, messageLooksLikeFblRoll } from "./utils.js";
import { debug } from "./logger.js";

const pendingContexts = new Map();
const MAX_PENDING_CONTEXTS = 32;

export function buildRollContext(actor, item, extra = {}) {
    return {
        nonce: foundry.utils.randomID(), actorId: actor.id, actorUuid: actor.uuid,
        itemId: item.id, itemUuid: item.uuid, itemName: item.name,
        isFirearmAttack: true, isPushRoll: false, createdAt: Date.now(), ...extra
    };
}

export function setPendingRollContext(context, ttl = TIMING.ATTACK_ROLL_CONTEXT_TTL) {
    cleanupExpiredContexts();
    while (pendingContexts.size >= MAX_PENDING_CONTEXTS) pendingContexts.delete(pendingContexts.keys().next().value);
    const stored = { ...context, expires: Date.now() + ttl };
    pendingContexts.set(stored.nonce, stored);
    setTimeout(() => pendingContexts.delete(stored.nonce), ttl + 250);
    debug("queued roll context", stored.nonce, stored.itemName, stored.isPushRoll ? "push" : "attack");
    return stored.nonce;
}

export function cancelPendingRollContext(nonce) {
    if (nonce) pendingContexts.delete(nonce);
}

export function getPendingRollContextCount() {
    cleanupExpiredContexts();
    return pendingContexts.size;
}

export function initRollContextHooks() {
    Hooks.on("preCreateChatMessage", attachPendingRollContextToMessage);
}

function attachPendingRollContextToMessage(message, data, _options, userId) {
    if (userId !== game.user.id || pendingContexts.size === 0) return;
    cleanupExpiredContexts();
    if (isModuleServiceMessage(message, data) || !messageLooksLikeFblRoll(message, data)) return;

    const itemIds = collectMessageItemIds(message, data).map(String);
    const itemUuids = collectMessageItemUuids(message, data).map(String);
    const speakerActorId = String(message.speaker?.actor ?? data?.speaker?.actor ?? "");
    const now = Date.now();
    const candidates = [];

    for (const context of pendingContexts.values()) {
        const contextItem = fromUuidSyncSafe(context.itemUuid);
        if (contextItem && !isFirearm(contextItem)) {
            pendingContexts.delete(context.nonce);
            continue;
        }
        if (speakerActorId && context.actorId && speakerActorId !== String(context.actorId)) continue;
        if (hasConflictingItemReference(itemIds, itemUuids, context)) continue;

        const exactId = itemIds.includes(String(context.itemId));
        const exactUuid = itemUuids.includes(String(context.itemUuid));
        const hasItemReference = itemIds.length > 0 || itemUuids.length > 0;
        const age = now - context.createdAt;
        if (!hasItemReference && age > TIMING.CONTEXT_FALLBACK_WITHOUT_ITEM_MAX_AGE) continue;

        const score = (exactUuid ? 100 : 0) + (exactId ? 80 : 0) + (speakerActorId ? 20 : 0) - age / 1000;
        candidates.push({ context, score });
    }

    candidates.sort((a, b) => b.score - a.score || b.context.createdAt - a.context.createdAt);
    const selected = candidates[0]?.context;
    if (!selected) return;

    const update = {};
    for (const [key, value] of Object.entries(selected)) foundry.utils.setProperty(update, `flags.${MODULE_ID}.${key}`, value);
    foundry.utils.setProperty(update, `flags.${MODULE_ID}.contextAttachedAt`, now);

    if (typeof message.updateSource === "function") message.updateSource(update);
    else foundry.utils.mergeObject(data, update);

    pendingContexts.delete(selected.nonce);
    debug("attached roll context", selected.nonce, selected.itemName);
}

function cleanupExpiredContexts() {
    const now = Date.now();
    for (const [nonce, context] of pendingContexts) if (context.expires <= now) pendingContexts.delete(nonce);
}

function isModuleServiceMessage(message, data = {}) {
    const flags = foundry.utils.getProperty(data, `flags.${MODULE_ID}`) ?? {};
    const keys = ["kamoraRoll", "kamoraMishapNotice", "primaryMishapNotice", "powderMishapBreakdown", "magazineAction", "emptyMagazineNotice", "ammoSpendNotice"];
    return keys.some(key => message.getFlag?.(MODULE_ID, key) || flags[key]);
}

function hasConflictingItemReference(itemIds, itemUuids, context) {
    if (itemIds.length > 0 && !itemIds.includes(String(context.itemId))) return true;
    if (itemUuids.length > 0 && !itemUuids.includes(String(context.itemUuid))) {
        const resolvedIds = itemUuids.map(uuid => fromUuidSyncSafe(uuid)?.id).filter(Boolean).map(String);
        if (!resolvedIds.includes(String(context.itemId))) return true;
    }
    return false;
}
