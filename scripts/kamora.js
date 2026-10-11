import { MODULE_ID, TIMING } from "./constants.js";
import { SETTINGS, getSetting } from "./settings.js";
import { getMisfireProfile, isFirearm } from "./firearm-data.js";
import { drawMishapTableForItem, evaluateRoll, playRandomCritBadSound, createServiceMessage } from "./utils.js";
import { renderModuleTemplate } from "./templates.js";
import { debug } from "./logger.js";

const CHECK_RESULTS = new WeakMap();

export async function runPrimaryFirearmChecks(actor, item, sourceMessage = null) {
    if (!actor || !isFirearm(item) || sourceMessage?.getFlag?.(MODULE_ID, "primaryFirearmChecksDone")) return false;

    const profile = getMisfireProfile(item);
    const primaryFormula = getSetting(SETTINGS.ENABLE_PRIMARY_MISHAP) ? profile.primaryFormula : null;
    const cached = sourceMessage ? CHECK_RESULTS.get(sourceMessage) : null;
    if (cached?.done) return cached.misfire;
    const results = cached?.results ?? {
        randomMishap: false, randomFormula: primaryFormula, randomResult: null,
        kamoraMishap: false, kamoraFormula: profile.kamoraFormula, kamoraResult: null
    };

    if (!cached && primaryFormula) {
        const roll = await evaluateRoll(primaryFormula);
        results.randomResult = roll.total;
        results.randomMishap = roll.total === 1;
    }
    if (!cached && profile.kamoraFormula) {
        const roll = await evaluateRoll(profile.kamoraFormula);
        results.kamoraResult = roll.total;
        results.kamoraMishap = roll.total === 1;
    }

    const state = cached ?? { results };
    if (sourceMessage) CHECK_RESULTS.set(sourceMessage, state);
    debug(`primary checks: ${item.name}`, results);
    if (!results.randomMishap && !results.kamoraMishap) { state.done = true; state.misfire = false; return false; }

    if (!state.notice) {
        await playRandomCritBadSound(sourceMessage);
        state.notice = await createPrimaryFirearmMishapMessage(actor, item, results, sourceMessage);
    }
    const notice = state.notice;
    if (!state.notified) {
        state.notified = true;
        Hooks.callAll(`${MODULE_ID}.misfire`, actor, item, { type: "primary", results, sourceMessage, notice });
    }
    await drawMishapTableForItem(item, TIMING.MISHAP_TABLE_DRAW_DELAY, sourceMessage);
    state.done = true; state.misfire = true;
    return true;
}

async function createPrimaryFirearmMishapMessage(actor, item, results, sourceMessage) {
    const reasons = [];
    if (results.randomMishap) reasons.push(`скрытая проверка ${results.randomFormula}`);
    if (results.kamoraMishap) reasons.push(`Камора ${results.kamoraFormula}`);
    const content = await renderModuleTemplate(`modules/${MODULE_ID}/templates/chat/mishap-notice.hbs`, {
        itemName: item.name,
        reason: reasons.join(" + ")
    });

    return createServiceMessage({
        speaker: ChatMessage.getSpeaker({ actor }), content,
        flags: { [MODULE_ID]: {
            primaryMishapNotice: true, actorId: actor.id, actorUuid: actor.uuid,
            itemId: item.id, itemUuid: item.uuid,
            randomFormula: results.randomFormula, randomResult: results.randomResult, randomMishap: results.randomMishap,
            kamoraFormula: results.kamoraFormula, kamoraResult: results.kamoraResult, kamoraMishap: results.kamoraMishap
        } }
    }, sourceMessage);
}
