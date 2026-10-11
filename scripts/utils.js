import { MODULE_ID, TOOLTIP_JOURNAL_NAME } from "./constants.js";
import { SETTINGS, getSetting } from "./settings.js";
import { hasFeature as hasFirearmFeature, isFirearm as isFirearmItem, isRangedWeapon as isRangedWeaponItem } from "./firearm-data.js";
import { debug, error, warn } from "./logger.js";
import { calculatePowderMishapResult } from "./firearm-rules.js";
import { renderModuleTemplate } from "./templates.js";

export function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export function escapeAttribute(value) {
    return escapeHtml(value)
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

let tooltipCacheInitialized = false;
let cachedTooltipJournal = null;
let cachedTooltipPages = null;

export function clearTooltipCache() {
    tooltipCacheInitialized = false;
    cachedTooltipJournal = null;
    cachedTooltipPages = null;
}

export function initTooltipCacheHooks() {
    const invalidate = document => {
        const journal = document?.documentName === "JournalEntry" ? document : document?.parent;
        if (!journal) return;
        if (journal.name === TOOLTIP_JOURNAL_NAME || journal === cachedTooltipJournal) clearTooltipCache();
    };

    for (const hook of [
        "createJournalEntry",
        "updateJournalEntry",
        "deleteJournalEntry",
        "createJournalEntryPage",
        "updateJournalEntryPage",
        "deleteJournalEntryPage"
    ]) Hooks.on(hook, invalidate);
}

export function getTooltipContent(pageName) {
    const requestedPage = String(pageName ?? "").trim();
    if (!requestedPage) return null;

    if (!tooltipCacheInitialized) {
        tooltipCacheInitialized = true;
        cachedTooltipJournal = game.journal?.getName?.(TOOLTIP_JOURNAL_NAME) ?? null;
        cachedTooltipPages = new Map();

        const pages = cachedTooltipJournal?.pages?.contents ?? cachedTooltipJournal?.pages ?? [];
        for (const page of pages) {
            const content = page?.text?.content ?? page?.system?.text?.content ?? "";
            if (page?.name && String(content).trim()) cachedTooltipPages.set(page.name, content);
        }
    }

    return cachedTooltipPages?.get(requestedPage) ?? null;
}

export function tooltipAttr(pageName) {
    const content = getTooltipContent(pageName);
    if (!content) return "";

    return `data-tooltip="${escapeAttribute(content)}" data-tooltip-direction="UP"`;
}

export function setTooltip($element, pageName) {
    const content = getTooltipContent(pageName);

    if (!content) {
        $element.removeAttr("data-tooltip");
        $element.removeAttr("data-tooltip-direction");
        return;
    }

    $element.attr("data-tooltip", content);
    $element.attr("data-tooltip-direction", "UP");
}

export function isOwnMessage(message) {
    const authorId = message.author?.id ?? message.user?.id ?? message.user;
    return game.user.id === authorId;
}

export function getRoot(htmlElement) {
    if (!htmlElement) return null;
    if (htmlElement instanceof HTMLElement) return htmlElement;
    if (htmlElement[0] instanceof HTMLElement) return htmlElement[0];

    return null;
}

export function getText(root, selector) {
    return root?.querySelector(selector)?.textContent?.trim() ?? "";
}

export function fromUuidSyncSafe(uuid) {
    if (!uuid) return null;

    if (typeof globalThis.fromUuidSync === "function") {
        try { return globalThis.fromUuidSync(uuid); }
        catch (err) { debug("UUID resolution failed", uuid, err); return null; }
    }

    return null;
}

export function resolveActorFromMessage(message) {
    const actorUuid = message.getFlag(MODULE_ID, "actorUuid");
    const actorId = message.getFlag(MODULE_ID, "actorId");

    let actor = fromUuidSyncSafe(actorUuid);
    if (!actor && message.speaker?.token && message.speaker?.scene) actor = ChatMessage.getSpeakerActor(message.speaker);

    if (!actor && actorId) actor = game.actors.get(actorId);
    if (!actor) actor = ChatMessage.getSpeakerActor(message.speaker);

    return actor ?? null;
}

export function resolveItemFromMessage(message, data = {}) {
    const itemUuid = getMessageFlag(message, data, "itemUuid");

    let item = fromUuidSyncSafe(itemUuid);
    if (item) return item;

    const actor = resolveActorFromMessage(message);
    if (!actor) return null;

    const itemIds = collectMessageItemIds(message, data);

    for (const itemId of itemIds) {
        item = actor.items.get(itemId);
        if (item) return item;
    }

    const itemUuids = collectMessageItemUuids(message, data);

    for (const uuid of itemUuids) {
        item = fromUuidSyncSafe(uuid);
        if (item) return item;
    }

    const rollOptions = getFirstRollOptions(message, data);

    if (rollOptions.item) {
        item = findUniqueNamedItem(actor, rollOptions.item);
        if (item) return item;
    }

    if (rollOptions.itemName) {
        item = findUniqueNamedItem(actor, rollOptions.itemName);
        if (item) return item;
    }

    const flaggedItemName = getMessageFlag(message, data, "itemName");

    if (flaggedItemName) {
        item = findUniqueNamedItem(actor, flaggedItemName);
        if (item) return item;
    }

    return null;
}

function findUniqueNamedItem(actor, name) {
    if (typeof name !== "string") return null;
    const items = [...actor.items].filter(item => item.name === name);
    return items.length === 1 ? items[0] : null;
}

export function getMessageFlag(message, data, key) {
    const value = message.getFlag?.(MODULE_ID, key);
    if (value !== undefined) return value;

    return foundry.utils.getProperty(data, `flags.${MODULE_ID}.${key}`);
}

export function collectMessageItemIds(message, data = {}) {
    const itemIds = new Set();

    addIfTruthy(itemIds, getMessageFlag(message, data, "itemId"));

    const rollOptions = getFirstRollOptions(message, data);
    addIfTruthy(itemIds, rollOptions.itemId);

    const rollDataItemId = foundry.utils.getProperty(rollOptions, "rollData.item.id")
        ?? foundry.utils.getProperty(rollOptions, "item.id");
    addIfTruthy(itemIds, rollDataItemId);

    const content = String(message.content ?? data.content ?? "");

    for (const itemId of extractHtmlDataValues(content, "item-id")) {
        addIfTruthy(itemIds, itemId);
    }

    for (const itemId of extractHtmlDataValues(content, "itemId")) {
        addIfTruthy(itemIds, itemId);
    }

    return Array.from(itemIds);
}

export function collectMessageItemUuids(message, data = {}) {
    const itemUuids = new Set();

    addIfTruthy(itemUuids, getMessageFlag(message, data, "itemUuid"));

    const rollOptions = getFirstRollOptions(message, data);
    addIfTruthy(itemUuids, rollOptions.itemUuid);
    addIfTruthy(itemUuids, rollOptions.uuid);

    const rollDataItemUuid = foundry.utils.getProperty(rollOptions, "rollData.item.uuid")
        ?? foundry.utils.getProperty(rollOptions, "item.uuid");
    addIfTruthy(itemUuids, rollDataItemUuid);

    const content = String(message.content ?? data.content ?? "");

    for (const uuid of extractHtmlDataValues(content, "item-uuid")) {
        addIfTruthy(itemUuids, uuid);
    }

    return Array.from(itemUuids);
}

export function getFirstRollOptions(message, data = {}) {
    const rolls = message.rolls ?? data.rolls ?? [];
    const firstRoll = Array.isArray(rolls) ? rolls[0] : null;

    return firstRoll?.options ?? {};
}

function extractHtmlDataValues(content, dataName) {
    const escapedName = String(dataName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`data-${escapedName}=["']([^"']+)["']`, "gi");
    const values = [];

    let match = null;

    while ((match = pattern.exec(content))) {
        values.push(match[1]);
    }

    return values;
}

function addIfTruthy(set, value) {
    if (Array.isArray(value)) { value.forEach(entry => addIfTruthy(set, entry)); return; }
    if (value === undefined || value === null || value === "" || typeof value === "object") return;
    set.add(String(value));
}

export function hasFirearmFlag(item) {
    return !!item?.getFlag(MODULE_ID, "isFirearm");
}

export function isRangedWeapon(item) {
    return isRangedWeaponItem(item);
}

export function isFirearm(item) {
    return isFirearmItem(item);
}

export function hasStaleFirearmFlag(item) {
    return hasFirearmFlag(item) && !isRangedWeapon(item);
}

export function hasKamora(item) {
    if (!item) return false;

    if (hasFirearmFeature(item, "Kamora")) return true;

    // Поддержка старого ошибочного ключа, если он уже где-то сохранен.
    if (item.getFlag(MODULE_ID, "feat_kamora")) return true;

    const rawFeatures = String(item.system?.features?.others ?? "");
    if (/камора/i.test(rawFeatures)) return true;

    return false;
}

export function messageLooksLikeFblRoll(message, data = {}) {
    const content = String(message.content ?? data.content ?? "");

    if (content.includes("fbl-chat-roll")) return true;
    if (content.includes("dice-roll")) return true;

    if (Array.isArray(message.rolls) && message.rolls.length > 0) return true;
    if (Array.isArray(data.rolls) && data.rolls.length > 0) return true;

    return false;
}

export async function evaluateRoll(formula) {
    const roll = new Roll(formula);

    return roll.evaluate();
}


export async function playRandomCritBadSound(sourceMessage = null) {
    const playlistName = String(getSetting(SETTINGS.CRIT_BAD_PLAYLIST) || "CritBad").trim();
    const playlist = game.playlists.getName(playlistName);

    if (!playlist) {
        warn(`playlist "${playlistName}" not found`);
        return;
    }

    const sounds = playlist.sounds
        .filter(sound => {
            const src = getPlaylistSoundSource(sound);
            return !!src;
        });

    if (!sounds.length) {
        warn(`playlist "${playlistName}" has no playable sounds`);
        return;
    }

    const sound = sounds[Math.floor(Math.random() * sounds.length)];
    const src = getPlaylistSoundSource(sound);

    try {
        await AudioHelper.play({
            src,
            volume: clampVolume(getSetting(SETTINGS.CRIT_BAD_VOLUME)),
            autoplay: true,
            loop: false,
            channel: "interface"
        }, !sourceMessage?.blind && !sourceMessage?.whisper?.length);
    } catch (err) {
        error("failed to play CritBad sound", err);
    }
}

function getPlaylistSoundSource(sound) {
    return sound.path
        ?? sound.src
        ?? sound.system?.path
        ?? sound.toObject?.()?.path
        ?? sound.toObject?.()?.src
        ?? null;
}

function clampVolume(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0.8;

    return Math.min(Math.max(number, 0), 1);
}

const MISHAP_RESULTS = new WeakMap();

export async function drawMishapTableForItem(item, delay = 0, sourceMessage = null) {
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    const firearmType = item?.getFlag(MODULE_ID, "firearmType") || "regular";
    const tableName = getSetting(firearmType === "artifact" ? SETTINGS.ARTIFACT_MISHAP_TABLE : SETTINGS.REGULAR_MISHAP_TABLE);
    const table = game.tables.getName(tableName);
    if (!table) throw new Error(`Осечка: таблица "${tableName}" не найдена.`);
    const mishapRollData = (sourceMessage && MISHAP_RESULTS.get(sourceMessage)) ?? await rollPowderMishapResult(item);
    if (sourceMessage) MISHAP_RESULTS.set(sourceMessage, mishapRollData);
    const forcedRoll = await evaluateRoll(String(mishapRollData.finalResult));
    // This is a numbered mishap lookup, not a deck. Drawn flags must not turn
    // a fixed number into Foundry's 10,000-attempt reroll loop.
    const results = [...table.results].filter(result => {
        const [min, max] = result.range ?? [];
        return forcedRoll.total >= min && forcedRoll.total <= max;
    });
    if (!results.length) throw new Error(`Таблица "${tableName}" не содержит результата ${forcedRoll.total}.`);
    const expanded = [];
    for (const result of results) {
        const nested = result.type === "document" && result.documentUuid ? await fromUuid(result.documentUuid) : null;
        if (nested?.documentName === "RollTable") expanded.push(...(await nested.roll({ recursive: true })).results);
        else expanded.push(result);
    }
    if (!expanded.length) throw new Error(`Вложенная таблица "${tableName}" не вернула результата.`);
    if (mishapRollData.hasTableModifiers) await createPowderMishapBreakdownMessage(item, mishapRollData, sourceMessage);
    await table.toMessage(expanded, {
        roll: forcedRoll,
        messageData: { ...getMessageVisibility(sourceMessage), speaker: sourceMessage?.speaker ?? ChatMessage.getSpeaker({ actor: item.actor }), flags: { [MODULE_ID]: { powderMishapResult: true, itemUuid: item.uuid } } },
        messageOptions: { rollMode: getVisibilityRollMode(sourceMessage) }
    });
    return { roll: forcedRoll, results: expanded };
}

async function rollPowderMishapResult(item) {
    const baseRoll = await evaluateRoll("1d6");
    return calculatePowderMishapResult(baseRoll.total, {
        reliable: hasFeature(item, "Reliable"),
        thickened: hasFeature(item, "Thickened"),
        thinned: hasFeature(item, "Thinned"),
        risky: hasFeature(item, "Risky")
    });
}

async function createPowderMishapBreakdownMessage(item, mishapRollData, sourceMessage) {
    if (!item || !mishapRollData) return;
    const actor = item.parent?.documentName === "Actor" ? item.parent : null;
    const content = await renderModuleTemplate(`modules/${MODULE_ID}/templates/chat/mishap-breakdown.hbs`, {
        itemName: item.name,
        steps: mishapRollData.steps,
        finalResult: mishapRollData.finalResult,
        featureText: mishapRollData.appliedFeatures.length ? mishapRollData.appliedFeatures.join(", ") : "нет"
    });
    await createServiceMessage({
        speaker: actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker(),
        content,
        flags: { [MODULE_ID]: { powderMishapBreakdown: true, itemId: item.id, itemUuid: item.uuid, baseResult: mishapRollData.baseResult, finalResult: mishapRollData.finalResult, appliedFeatures: mishapRollData.appliedFeatures } }
    }, sourceMessage);
}

function hasFeature(item, key) {
    return hasFirearmFeature(item, key);
}

export function getMessageVisibility(sourceMessage = null) {
    if (sourceMessage) return { whisper: [...(sourceMessage.whisper ?? [])].map(user => user.id ?? user), blind: !!sourceMessage.blind };
    const data = {};
    ChatMessage.applyRollMode?.(data, game.settings.get("core", "rollMode") ?? "publicroll");
    return data;
}

function getVisibilityRollMode(sourceMessage) {
    if (!sourceMessage) return game.settings.get("core", "rollMode") ?? "publicroll";
    return sourceMessage.blind ? "blindroll" : sourceMessage.whisper?.length ? "gmroll" : "publicroll";
}

export function createServiceMessage(data, sourceMessage = null) {
    return ChatMessage.create({ ...data, ...getMessageVisibility(sourceMessage) });
}
