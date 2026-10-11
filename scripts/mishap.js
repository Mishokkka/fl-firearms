import { MODULE_ID, TIMING } from "./constants.js";
import {
    drawMishapTableForItem,
    getRoot,
    isFirearm,
    isOwnMessage,
    playRandomCritBadSound,
    resolveActorFromMessage,
    resolveItemFromMessage
} from "./utils.js";
import { buildRollContext } from "./roll-context.js";
import { debug, warn } from "./logger.js";

const processingMessageIds = new Set();
const completedMessages = new WeakSet();

export function initMishapHooks() {
    Hooks.on("renderChatMessageHTML", handleRenderedChatMessage);
    Hooks.on("createChatMessage", (message, _options, userId) => {
        if (userId === game.user.id) void checkFirearmMishap(message).catch(reportMishapError);
    });
}

function handleRenderedChatMessage(message, htmlElement, context) {
    installPushContextBridge(message, htmlElement);
    void checkFirearmMishap(message).catch(reportMishapError);
}

function installPushContextBridge(message, htmlElement) {
    // Только карточки огнестрельных атак нуждаются в bridge для Push.
    // Флаг записывается в preCreateChatMessage, поэтому обычные FBL-броски
    // больше не получают лишний listener.
    if (!message.getFlag(MODULE_ID, "isFirearmAttack")) return;
    if (message.rolls?.[0]?.options?.flFirearmsContext) return;

    const root = getRoot(htmlElement);
    if (!root?.querySelectorAll) return;

    const pushButtons = root.querySelectorAll(".fbl-button.push");

    for (const button of pushButtons) {
        if (button.dataset.flFirearmsPushHook === "1") continue;

        button.dataset.flFirearmsPushHook = "1";

        button.addEventListener("click", () => {
            if (message.getFlag(MODULE_ID, "emptyMagazineAttack")) return;

            const actor = resolveActorFromMessage(message);
            const item = resolveItemFromMessage(message);

            if (!actor || !isFirearm(item)) return;

            const roll = message.rolls?.[0];
            if (roll?.options) roll.options.flFirearmsContext = buildRollContext(actor, item, { isPushRoll: true, emptyMagazineAttack: false });
        }, { capture: true });
    }
}

export async function checkFirearmMishap(message) {
    if (!isOwnMessage(message)) return;

    const messageId = message.id ?? message.uuid;
    if (!messageId) return;

    if (processingMessageIds.has(messageId)) return;
    if (message.getFlag(MODULE_ID, "mishapRolled")) return;

    // Flags identify the attack; the Roll supplies localized-independent results.
    if (!message.getFlag(MODULE_ID, "isFirearmAttack")) return;
    if (!message.getFlag(MODULE_ID, "isPushRoll")) return;

    const roll = message.rolls?.[0];
    const successes = Number(roll?.successCount);
    if (!roll?.pushed || !Number.isFinite(successes) || successes > 0 || message.getFlag(MODULE_ID, "emptyMagazineAttack")) return;

    const item = resolveItemFromMessage(message);
    if (!isFirearm(item)) return;

    processingMessageIds.add(messageId);

    try {
        debug(`failed Push mishap: successes=${successes}; item=${item.name}`);

        if (!completedMessages.has(message)) {
            await playRandomCritBadSound(message);
            const actor = resolveActorFromMessage(message);
            Hooks.callAll(`${MODULE_ID}.misfire`, actor, item, { type: "push", successes, message });
            await drawMishapTableForItem(item, TIMING.MISHAP_TABLE_DRAW_DELAY, message);
            completedMessages.add(message);
        }
        await message.setFlag(MODULE_ID, "mishapRolled", true);
    } finally {
        processingMessageIds.delete(messageId);
    }
}
function reportMishapError(error) {
    warn("Push mishap failed", error);
    ui.notifications.error(`FL Firearms: ${error.message}`);
}
