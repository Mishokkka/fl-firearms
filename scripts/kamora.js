import { MODULE_ID, TIMING } from "./constants.js";
import { SETTINGS, getSetting } from "./settings.js";
import { getMisfireProfile, isFirearm } from "./firearm-data.js";
import { drawMishapTableForItem, evaluateRoll, messageLooksLikeFblRoll, playRandomCritBadSound, resolveActorFromMessage, resolveItemFromMessage } from "./utils.js";
import { renderModuleTemplate } from "./templates.js";
import { debug } from "./logger.js";

const processedMessages = new WeakSet();

export function initKamoraHooks() {
    Hooks.on("createChatMessage", handleCreatedChatMessageForFirearmChecks);
}

async function handleCreatedChatMessageForFirearmChecks(message, _options, userId) {
    if (userId !== game.user.id) return;
    const messageId = message.id ?? message.uuid;
    if (!messageId || processedMessages.has(message)) return;
    if (!message.getFlag(MODULE_ID, "isFirearmAttack") || message.getFlag(MODULE_ID, "isPushRoll")) return;
    if (message.getFlag(MODULE_ID, "kamoraRoll") || message.getFlag(MODULE_ID, "kamoraMishapNotice") || message.getFlag(MODULE_ID, "primaryMishapNotice")) return;
    if (message.getFlag(MODULE_ID, "primaryFirearmChecksDone") || !messageLooksLikeFblRoll(message)) return;

    const item = resolveItemFromMessage(message);
    if (!isFirearm(item)) return;

    // Решение фиксируется до создания сообщения. Оно не зависит от того,
    // успел ли magazine.js уже списать последний патрон.
    if (message.getFlag(MODULE_ID, "emptyMagazineAttack")) return;

    // Локальная WeakSet-защита сохраняет идемпотентность create hook без
    // отдельного persisted update ChatMessage ради служебного маркера.
    processedMessages.add(message);
    const actor = resolveActorFromMessage(message);
    await runPrimaryFirearmChecks(actor, item, message);
}

export async function runPrimaryFirearmChecks(actor, item, sourceMessage = null) {
    if (!actor || !isFirearm(item)) return false;

    const profile = getMisfireProfile(item);
    const primaryFormula = getSetting(SETTINGS.ENABLE_PRIMARY_MISHAP) ? profile.primaryFormula : null;
    const results = {
        randomMishap: false, randomFormula: primaryFormula, randomResult: null,
        kamoraMishap: false, kamoraFormula: profile.kamoraFormula, kamoraResult: null
    };

    if (primaryFormula) {
        const roll = await evaluateRoll(primaryFormula);
        results.randomResult = roll.total;
        results.randomMishap = roll.total === 1;
    }
    if (profile.kamoraFormula) {
        const roll = await evaluateRoll(profile.kamoraFormula);
        results.kamoraResult = roll.total;
        results.kamoraMishap = roll.total === 1;
    }

    debug(`primary checks: ${item.name}`, results);
    if (!results.randomMishap && !results.kamoraMishap) return false;

    await playRandomCritBadSound();
    const notice = await createPrimaryFirearmMishapMessage(actor, item, results);
    Hooks.callAll(`${MODULE_ID}.misfire`, actor, item, { type: "primary", results, sourceMessage, notice });
    await drawMishapTableForItem(item, TIMING.MISHAP_TABLE_DRAW_DELAY);
    return true;
}

async function createPrimaryFirearmMishapMessage(actor, item, results) {
    const reasons = [];
    if (results.randomMishap) reasons.push(`скрытая проверка ${results.randomFormula}`);
    if (results.kamoraMishap) reasons.push(`Камора ${results.kamoraFormula}`);
    const content = await renderModuleTemplate(`modules/${MODULE_ID}/templates/chat/mishap-notice.hbs`, {
        itemName: item.name,
        reason: reasons.join(" + ")
    });

    return ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }), content,
        flags: { [MODULE_ID]: {
            primaryMishapNotice: true, actorId: actor.id, actorUuid: actor.uuid,
            itemId: item.id, itemUuid: item.uuid,
            randomFormula: results.randomFormula, randomResult: results.randomResult, randomMishap: results.randomMishap,
            kamoraFormula: results.kamoraFormula, kamoraResult: results.kamoraResult, kamoraMishap: results.kamoraMishap
        } }
    });
}
