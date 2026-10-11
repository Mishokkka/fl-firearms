import { MODULE_ID, TIMING } from "./constants.js";
import { isFirearm } from "./firearm-data.js";
import { collectMessageItemIds, collectMessageItemUuids, fromUuidSyncSafe, messageLooksLikeFblRoll } from "./utils.js";
import { debug } from "./logger.js";

const pendingContexts = new Map();
const MAX_PENDING_CONTEXTS = 32;
const CONFIRMED_ROLLS = new Set();

export function buildRollContext(actor, item, extra = {}) {
    return {
        nonce: foundry.utils.randomID(), actorId: actor.id, actorUuid: actor.uuid,
        itemId: item.id, itemUuid: item.uuid, itemName: item.name,
        tokenId: actor.token?.id ?? null, sceneId: actor.token?.parent?.id ?? null,
        isFirearmAttack: true, isPushRoll: false, createdAt: Date.now(), ...extra
    };
}

export function setPendingRollContext(context, ttl = TIMING.ATTACK_ROLL_CONTEXT_TTL) {
    cleanupExpiredContexts();
    while (pendingContexts.size >= MAX_PENDING_CONTEXTS) pendingContexts.delete(pendingContexts.keys().next().value);
    const stored = { ...context, expires: ttl === null ? Infinity : Date.now() + ttl };
    pendingContexts.set(stored.nonce, stored);
    if (ttl !== null) setTimeout(() => pendingContexts.delete(stored.nonce), ttl + 250);
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
    Hooks.on("createChatMessage", (message, _options, userId) => {
        const nonce = message.getFlag?.(MODULE_ID, "nonce");
        if (userId !== game.user.id || !nonce) return;
        CONFIRMED_ROLLS.add(nonce);
        if (CONFIRMED_ROLLS.size > 1000) CONFIRMED_ROLLS.delete(CONFIRMED_ROLLS.values().next().value);
    });
}

function attachPendingRollContextToMessage(message, data, _options, userId) {
    if (userId !== game.user.id) return;
    const roll = (message.rolls ?? data.rolls ?? [])[0];
    const direct = roll?.options?.flFirearmsContext;
    if (direct?.isFirearmAttack) {
        attachContext(message, data, { ...direct, isPushRoll: !!roll.pushed });
        cancelPendingRollContext(direct.nonce);
        return;
    }
    if (pendingContexts.size === 0 || roll?.options?.isAttack !== true) return;
    cleanupExpiredContexts();
    if (isModuleServiceMessage(message, data) || !messageLooksLikeFblRoll(message, data)) return;

    const itemIds = collectMessageItemIds(message, data).map(String);
    const itemUuids = collectMessageItemUuids(message, data).map(String);
    const speaker = message.speaker ?? data.speaker ?? {};
    const rollOptions = roll?.options ?? {};
    const speakerTokenId = speaker.token ?? rollOptions.tokenId;
    const speakerSceneId = speaker.scene ?? rollOptions.sceneId;
    const speakerActorId = String(message.speaker?.actor ?? data?.speaker?.actor ?? "");
    const now = Date.now();
    const candidates = [];

    for (const context of pendingContexts.values()) {
        const contextItem = fromUuidSyncSafe(context.itemUuid);
        if (contextItem && !isFirearm(contextItem)) {
            pendingContexts.delete(context.nonce);
            continue;
        }
        if (context.tokenId && (context.tokenId !== speakerTokenId || context.sceneId !== speakerSceneId)) continue;
        if (!context.tokenId && speakerTokenId) continue;
        if (speakerActorId && context.actorId && speakerActorId !== String(context.actorId)) continue;
        if (hasConflictingItemReference(itemIds, itemUuids, context)) continue;

        const exactId = itemIds.includes(String(context.itemId));
        const exactUuid = itemUuids.includes(String(context.itemUuid));
        const hasItemReference = itemIds.length > 0 || itemUuids.length > 0;
        const age = now - context.createdAt;
        if (!hasItemReference) continue;

        const score = (exactUuid ? 100 : 0) + (exactId ? 80 : 0) + (speakerActorId ? 20 : 0) - age / 1000;
        candidates.push({ context, score });
    }

    candidates.sort((a, b) => b.score - a.score || b.context.createdAt - a.context.createdAt);
    const selected = candidates[0]?.context;
    if (!selected) return;

    if (candidates.length > 1 && candidates[0].context.itemUuid === candidates[1].context.itemUuid) return;
    attachContext(message, data, { ...selected, isPushRoll: !!roll?.pushed || selected.isPushRoll });

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

function attachContext(message, data, context) {
    const update = {};
    for (const [key, value] of Object.entries(context)) {
        if (key === "expires") continue;
        foundry.utils.setProperty(update, `flags.${MODULE_ID}.${key}`, value);
    }
    foundry.utils.setProperty(update, `flags.${MODULE_ID}.contextAttachedAt`, Date.now());
    if (typeof message.updateSource === "function") message.updateSource(update);
    else foundry.utils.mergeObject(data, update);
}

export function takePendingRollContext(actor, item) {
    for (const [nonce, context] of pendingContexts) {
        if (context.actorUuid === actor.uuid && context.itemUuid === item.uuid) {
            pendingContexts.delete(nonce);
            const { expires, ...data } = context;
            return data;
        }
    }
    return null;
}

export function wasRollMessageCreated(nonce) { return CONFIRMED_ROLLS.has(nonce); }
