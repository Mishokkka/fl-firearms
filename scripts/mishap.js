import { MODULE_ID, TIMING } from "./constants.js";
import {
    drawMishapTableForItem,
    getRoot,
    getText,
    isFirearm,
    isOwnMessage,
    playRandomCritBadSound,
    resolveActorFromMessage,
    resolveItemFromMessage
} from "./utils.js";
import { buildRollContext, setPendingRollContext } from "./roll-context.js";
import { debug, warn } from "./logger.js";

const processingMessageIds = new Set();

export function initMishapHooks() {
    Hooks.on("renderChatMessageHTML", handleRenderedChatMessage);
}

function handleRenderedChatMessage(message, htmlElement, context) {
    installPushContextBridge(message, htmlElement);
    checkFirearmMishapFromHTML(message, htmlElement);
}

function installPushContextBridge(message, htmlElement) {
    // Только карточки огнестрельных атак нуждаются в bridge для Push.
    // Флаг записывается в preCreateChatMessage, поэтому обычные FBL-броски
    // больше не получают лишний listener.
    if (!message.getFlag(MODULE_ID, "isFirearmAttack")) return;

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

            setPendingRollContext(
                buildRollContext(actor, item, { isPushRoll: true }),
                TIMING.PUSH_ROLL_CONTEXT_TTL
            );
        }, { capture: true });
    }
}

async function checkFirearmMishapFromHTML(message, htmlElement) {
    if (!isOwnMessage(message)) return;

    const messageId = message.id ?? message.uuid;
    if (!messageId) return;

    if (processingMessageIds.has(messageId)) return;
    if (message.getFlag(MODULE_ID, "mishapRolled")) return;

    // Осечка после Push должна происходить только для сообщений, к которым
    // roll-context явно прикрепил огнестрельный контекст. HTML-парсинг ниже
    // остается только для чтения результата броска, а не для угадывания оружия.
    if (!message.getFlag(MODULE_ID, "isFirearmAttack")) return;
    if (!message.getFlag(MODULE_ID, "isPushRoll")) return;

    const root = getRoot(htmlElement);
    if (!root?.querySelector) return;

    if (!root.querySelector(".fbl-chat-roll")) return;

    const formulaText = getText(root, ".dice-formula");
    const fullCardText = root.textContent || "";

    if (!/pushed/i.test(`${formulaText} ${fullCardText}`)) return;

    const successText = getText(root, ".dice-total .special-number");

    if (!successText) {
        // Если этот селектор перестал совпадать (например, после обновления
        // системы Forbidden Lands), проверка осечки после Push молча перестанет
        // работать. Хотя бы лог в консоли даст шанс заметить это.
        warn("mishap: .dice-total .special-number not found in pushed roll card");
        if (game.user?.isGM) ui.notifications.error("FL Firearms: разметка Push-броска Forbidden Lands изменилась. Проверка осечки не смогла прочитать успехи.");
        return;
    }

    const successes = parseInt(successText, 10);

    if (isNaN(successes) || successes > 0) return;

    const item = resolveItemFromMessage(message);
    if (!isFirearm(item)) return;

    processingMessageIds.add(messageId);

    try {
        await message.setFlag(MODULE_ID, "mishapRolled", true);

        debug(`failed Push mishap: successes=${successes}; item=${item.name}`);

        await playRandomCritBadSound();
        const actor = resolveActorFromMessage(message);
        Hooks.callAll(`${MODULE_ID}.misfire`, actor, item, { type: "push", successes, message });
        await drawMishapTableForItem(item, TIMING.MISHAP_TABLE_DRAW_DELAY);
    } finally {
        setTimeout(() => processingMessageIds.delete(messageId), TIMING.MESSAGE_DEDUPE_WINDOW);
    }
}