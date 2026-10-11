import { MODULE_ID } from "./constants.js";
import { SETTINGS, getSetting } from "./settings.js";
import { escapeAttribute, evaluateRoll, resolveItemFromMessage, createServiceMessage } from "./utils.js";
import { documentActions } from "./action-queue.js";
import { runPrimaryFirearmChecks } from "./kamora.js";
import { isFirearm, toInteger } from "./firearm-data.js";
import { renderModuleTemplate } from "./templates.js";
import { warn } from "./logger.js";


const RESOURCE_STEPS = Object.freeze({
    0: 0,
    1: 6,
    2: 8,
    3: 10,
    4: 12
});

const AMMO_MESSAGE_STATE = new WeakMap();

export function initMagazineHooks() {
    Hooks.on("createChatMessage", (message, options, userId) => {
        void handleCreatedChatMessageForAmmoSpend(message, options, userId).catch(error => {
            warn("firearm action failed", error);
            ui.notifications.error(`FL Firearms: ${error.message}`);
        });
    });
    Hooks.on("renderChatMessageHTML", message => {
        if (!AMMO_MESSAGE_STATE.get(message)?.failed) return;
        void handleCreatedChatMessageForAmmoSpend(message, {}, game.user.id).catch(error => {
            warn("firearm action retry failed", error);
            ui.notifications.error(`FL Firearms: ${error.message}`);
        });
    });
}

// =========================================================================
// 1. HOOKS / RENDER
// =========================================================================

export function patchMagazineControlsForActor(actor, root) {
    if (!actor || actor.documentName !== "Actor") return;
    if (!root?.querySelector) return;

    renderMagazineControls(actor, root);
}

// =========================================================================
// 2. ПОИСК И ОТРИСОВКА МАГАЗИНОВ
// =========================================================================

function renderMagazineControls(actor, root) {
    const activeIds = new Set();
    const weaponRows = root.querySelectorAll(".weapon");

    // Источник истины здесь — строки, которые система реально вывела в текущей
    // вкладке Combat. Оружие из Backpack/Dropped может оставаться Item актёра,
    // но не иметь строки в DOM, и это является нормальным состоянием.
    for (const weaponRow of weaponRows) {
        const item = resolveItemFromWeaponRow(actor, weaponRow);
        if (!isMagazineWeapon(item)) continue;

        activeIds.add(item.id);
        renderMagazineCounter(item, weaponRow);
        renderMagazineButtons(actor, item, weaponRow);
    }

    cleanupMagazineControls(root, activeIds);
}

export function isMagazineWeapon(item) {
    return isFirearm(item) && item?.getFlag(MODULE_ID, "reloadType") === "MAG";
}

export function isEmptyMagazineAttack(item) {
    return isMagazineWeapon(item) && getMagazineCapacity(item) > 0 && getMagazineCurrent(item) <= 0;
}

function hasTopOff(item) {
    return !!item.getFlag(MODULE_ID, "feat_TopOff");
}

function resolveItemFromWeaponRow(actor, weaponRow) {
    const cachedId = weaponRow.dataset?.flFirearmsItemId;
    if (cachedId) {
        const cached = actor.items.get?.(cachedId) ?? actor.items.find(item => item.id === cachedId);
        if (cached) return cached;
        delete weaponRow.dataset.flFirearmsItemId;
    }

    const itemId = readItemIdFromRow(weaponRow);
    if (itemId) {
        const byId = actor.items.get?.(itemId) ?? actor.items.find(item => item.id === itemId);
        if (byId) {
            weaponRow.dataset.flFirearmsItemId = byId.id;
            return byId;
        }
    }

    const nameElement = weaponRow.querySelector(".name");
    const normalizedName = normalizeText(readWeaponName(nameElement));
    if (!normalizedName) return null;

    let match = null;
    for (const item of actor.items) {
        if (normalizeText(item.name) !== normalizedName) continue;
        if (match) return null;
        match = item;
    }
    if (!match) return null;

    weaponRow.dataset.flFirearmsItemId = match.id;
    return match;
}

function readWeaponName(nameElement) {
    if (!nameElement) return "";
    const clone = nameElement.cloneNode(true);
    clone.querySelectorAll?.(".fl-mag-counter").forEach(element => element.remove());
    return clone.textContent || "";
}

function readItemIdFromRow(weaponRow) {
    const datasetKeys = ["itemId", "documentId", "entryId"];

    for (const key of datasetKeys) {
        const value = weaponRow.dataset?.[key];
        if (value) return value;
    }

    const child = weaponRow.querySelector("[data-item-id], [data-document-id], [data-entry-id]");
    if (child) {
        return child.dataset?.itemId || child.dataset?.documentId || child.dataset?.entryId || null;
    }

    const parent = weaponRow.parentElement?.closest?.("[data-item-id], [data-document-id], [data-entry-id]");
    return parent?.dataset?.itemId || parent?.dataset?.documentId || parent?.dataset?.entryId || null;
}

function renderMagazineCounter(item, weaponRow) {
    const capacity = getMagazineCapacity(item);
    if (capacity <= 0) return;

    const nameElement = weaponRow.querySelector(".name");
    if (!nameElement) return;

    const current = getMagazineCurrent(item);

    let counter = nameElement.querySelector(`.fl-mag-counter[data-item-id="${cssEscape(item.id)}"]`);

    if (!counter) {
        counter = document.createElement("span");
        counter.className = "fl-mag-counter";
        counter.dataset.itemId = item.id;
        counter.title = "Патроны в магазине";

        counter.innerHTML = `
            <input
                type="number"
                class="fl-mag-current"
                data-item-id="${escapeAttribute(item.id)}"
                min="0"
            >
            <span class="fl-mag-separator">/</span>
            <span class="fl-mag-max"></span>
        `;

        const image = nameElement.querySelector("img");

        if (image) {
            image.insertAdjacentElement("afterend", counter);
        } else {
            nameElement.insertAdjacentElement("afterbegin", counter);
        }
    }

    const input = counter.querySelector(".fl-mag-current");
    const max = counter.querySelector(".fl-mag-max");

    if (input) {
        if (input.max !== String(capacity)) input.max = String(capacity);

        if (document.activeElement !== input && input.value !== String(current)) {
            input.value = String(current);
        }

        updateMagazineInputWidth(input);
        input.disabled = !item.isOwner;
        bindMagazineInput(item, input);
    }

    if (max && max.textContent !== String(capacity)) {
        max.textContent = String(capacity);
    }
}

function bindMagazineInput(item, input) {
    if (input.dataset.flFirearmsBound === "1") return;

    input.dataset.flFirearmsBound = "1";

    input.addEventListener("change", async event => {
        event.preventDefault();
        event.stopPropagation();

        const raw = parseInt(input.value, 10);
        const next = clampNumber(Number.isFinite(raw) ? raw : 0, 0, getMagazineCapacity(item));

        input.value = String(next);
        updateMagazineInputWidth(input);

        if (!item.isOwner) return;
        try { await setMagazineCurrent(item, next); }
        catch (error) { ui.notifications.error(error.message); input.value = String(getMagazineCurrent(item)); }
    });

    input.addEventListener("input", () => {
        updateMagazineInputWidth(input);
    });

    input.addEventListener("click", event => event.stopPropagation());
    input.addEventListener("mousedown", event => event.stopPropagation());
}

function renderMagazineButtons(actor, item, weaponRow) {
    const actionsElement = weaponRow.querySelector(".weapon-actions");
    if (!actionsElement) return;

    let container = actionsElement.querySelector(`.fl-mag-actions[data-item-id="${cssEscape(item.id)}"]`);

    if (!container) {
        container = document.createElement("span");
        container.className = "fl-mag-actions";
        container.dataset.itemId = item.id;
        actionsElement.appendChild(container);
    }

    ensureLoadMagazineButton(actor, item, container);
    ensureTopOffButton(actor, item, container);
    container.querySelectorAll("button").forEach(button => { button.disabled = !item.isOwner || button.dataset.pending === "1"; });
}

function ensureLoadMagazineButton(actor, item, container) {
    let button = container.querySelector(".fl-load-mag");

    if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "roll-action fl-mag-action fl-load-mag";
        button.dataset.itemId = item.id;
        button.dataset.action = "load-magazine";
        button.title = "Зарядить магазин до максимума";
        button.textContent = "Зарядить";

        button.addEventListener("click", async event => {
            event.preventDefault();
            event.stopPropagation();

            await runButtonAction(button, () => loadFullMagazine(actor, item));
        });

        container.appendChild(button);
    }
}

function ensureTopOffButton(actor, item, container) {
    const shouldExist = hasTopOff(item);
    let button = container.querySelector(".fl-topoff-mag");

    if (!shouldExist) {
        if (button) button.remove();
        return;
    }

    const topOffText = String(item.getFlag(MODULE_ID, "val_TopOff") || "").trim();

    const label = topOffText
        ? `Дозарядка (${topOffText})`
        : "Дозарядка";

    if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "roll-action fl-mag-action fl-topoff-mag";
        button.dataset.itemId = item.id;
        button.dataset.action = "topoff-magazine";
        button.title = "Дозарядить один патрон";

        button.addEventListener("click", async event => {
            event.preventDefault();
            event.stopPropagation();

            await runButtonAction(button, () => topOffMagazine(actor, item));
        });

        container.appendChild(button);
    }

    if (button.textContent !== label) {
        button.textContent = label;
    }
}

function cleanupMagazineControls(root, activeIds) {
    const controls = root.querySelectorAll(".fl-mag-counter, .fl-mag-actions");

    for (const element of controls) {
        const itemId = element.dataset.itemId;
        if (itemId && !activeIds.has(itemId)) element.remove();
    }
}

// =========================================================================
// 3. АВТОМАТИЧЕСКИЙ РАСХОД ПАТРОНА ПРИ ВЫСТРЕЛЕ
// =========================================================================

export async function handleCreatedChatMessageForAmmoSpend(message, options, userId) {
    if (userId !== game.user.id || !message.getFlag(MODULE_ID, "isFirearmAttack") || message.getFlag(MODULE_ID, "isPushRoll")) return;
    const item = resolveItemFromMessage(message);
    if (!isFirearm(item)) return;
    const state = AMMO_MESSAGE_STATE.get(message) ?? {};
    AMMO_MESSAGE_STATE.set(message, state);
    if (state.promise || state.done) return state.promise;
    state.failed = false;
    state.promise = (async () => {
        if (message.getFlag(MODULE_ID, "emptyMagazineAttack")) {
            if (!state.emptyNotice) {
                await createEmptyMagazineNotice(item.actor, item, { speaker: message.speaker, source: "chat-fallback", sourceMessage: message });
                state.emptyNotice = true;
                Hooks.callAll(`${MODULE_ID}.dryFire`, item.actor, item, { message });
            }
            state.done = true;
            return;
        }
        if (!state.ammo) {
            if (message.getFlag(MODULE_ID, "ammoHandled")) {
                state.ammo = { oldAmmo: message.getFlag(MODULE_ID, "magazineBeforeShot"), newAmmo: message.getFlag(MODULE_ID, "magazineAfterShot"), spent: message.getFlag(MODULE_ID, "magazineBeforeShot") - message.getFlag(MODULE_ID, "magazineAfterShot") };
            } else if (isMagazineWeapon(item) && getMagazineCapacity(item) > 0 && getSetting(SETTINGS.AUTO_SPEND_AMMO) && !message.getFlag(MODULE_ID, "ammoSpent")) {
                state.ammo = await spendMagazineAmmo(item, message.getFlag(MODULE_ID, "ammoCost") ?? 1, { reason: "shot", message });
                if (!state.ammo.spent) {
                    await createEmptyMagazineNotice(item.actor, item, { sourceMessage: message });
                    Hooks.callAll(`${MODULE_ID}.dryFire`, item.actor, item, { message });
                    state.done = true;
                    return;
                }
            } else state.ammo = {};
        }
        if (!state.fired) {
            state.fired = true;
            Hooks.callAll(`${MODULE_ID}.attackFired`, item.actor, item, { message, ammoCost: message.getFlag(MODULE_ID, "ammoCost") ?? 1, ...state.ammo });
        }
        if (!state.feedback) {
            await showAmmoSpendFeedback(item, state.ammo.oldAmmo, state.ammo.newAmmo, getMagazineCapacity(item), message);
            state.feedback = true;
        }
        await runPrimaryFirearmChecks(item.actor, item, message);
        state.done = true;
    })();
    try { return await state.promise; }
    catch (error) { state.failed = true; throw error; }
    finally { state.promise = null; }
}

export async function createEmptyMagazineNotice(actor, item, { speaker = null, source = "manual", sourceMessage = null } = {}) {
    const capacity = getMagazineCapacity(item);
    ui.notifications.warn(`${item.name}: магазин пуст.`);
    const content = await renderModuleTemplate(`modules/${MODULE_ID}/templates/chat/empty-magazine.hbs`, { itemName: item.name, capacity });
    return createServiceMessage({
        speaker: speaker ?? ChatMessage.getSpeaker({ actor }),
        content,
        flags: { [MODULE_ID]: { emptyMagazineNotice: true, emptyMagazineAttack: true, source, actorId: actor?.id ?? null, actorUuid: actor?.uuid ?? null, itemId: item.id, itemUuid: item.uuid } }
    }, sourceMessage);
}

async function showAmmoSpendFeedback(item, oldAmmo, newAmmo, capacity, sourceMessage) {
    if (oldAmmo === undefined || newAmmo === undefined) return;
    const mode = getSetting(SETTINGS.AMMO_SPEND_FEEDBACK);
    if (mode === "silent") return;
    if (mode === "notification") {
        ui.notifications.info(`${item.name}: ${newAmmo}/${capacity} патронов.`);
        return;
    }
    const content = await renderModuleTemplate(`modules/${MODULE_ID}/templates/chat/ammo-spent.hbs`, { itemName: item.name, oldAmmo, newAmmo, capacity });
    await createServiceMessage({ speaker: sourceMessage.speaker, content, flags: { [MODULE_ID]: { ammoSpendNotice: true, itemId: item.id, itemUuid: item.uuid } } }, sourceMessage);
}

// =========================================================================
// 4. ЛОГИКА ЗАРЯДКИ
// =========================================================================

async function executeLoadMagazine(item) {
    const actor = item.actor;
    validateMagazine(actor, item);
    const capacity = getMagazineCapacity(item);
    const current = getMagazineCurrent(item);
    const missing = Math.max(capacity - current, 0);

    if (capacity <= 0) {
        return { notice: `${item.name}: не указана емкость магазина.`, level: "warn" };
    }

    if (missing <= 0) {
        return { notice: `${item.name}: магазин уже полон.`, level: "info" };
    }

    const resource = getConsumableResource(actor, "arrows");

    if (!resource) {
        return { notice: `${actor.name}: ресурс Bullets/Arrows не найден.`, level: "warn" };
    }

    if (!resource.dieSize) {
        return { notice: `${actor.name}: ресурс Bullets/Arrows пуст.`, level: "warn" };
    }

    const resourceMode = getSetting(SETTINGS.MAGAZINE_LOAD_RESOURCE_MODE);
    const formula = resourceMode === "perAction"
        ? `1d${resource.dieSize}`
        : `${missing}d${resource.dieSize}`;

    const roll = await evaluateRoll(formula);
    const results = getRollResults(roll);
    const shouldDeplete = results.some(value => value <= 2);


    await commitLoadedMagazine(item, capacity, resource, shouldDeplete);

    return {
        title: "Зарядка магазина",
        oldAmmo: current,
        newAmmo: capacity,
        capacity,
        formula,
        resourceMode,
        results,
        resourceDecreased: shouldDeplete,
        oldResourceDie: resource.dieSize,
        newResourceDie: shouldDeplete ? resourceStepToDie(resource.step - 1) : resource.dieSize
    };
}

async function executeTopOffMagazine(item) {
    const actor = item.actor;
    validateMagazine(actor, item, true);
    const capacity = getMagazineCapacity(item);
    const current = getMagazineCurrent(item);

    if (capacity <= 0) {
        return { notice: `${item.name}: не указана емкость магазина.`, level: "warn" };
    }

    if (current >= capacity) {
        return { notice: `${item.name}: магазин уже полон.`, level: "info" };
    }

    const resource = getConsumableResource(actor, "arrows");

    if (!resource) {
        return { notice: `${actor.name}: ресурс Bullets/Arrows не найден.`, level: "warn" };
    }

    if (!resource.dieSize) {
        return { notice: `${actor.name}: ресурс Bullets/Arrows пуст.`, level: "warn" };
    }

    const formula = `1d${resource.dieSize}`;
    const roll = await evaluateRoll(formula);
    const results = getRollResults(roll);
    const shouldDeplete = results.some(value => value <= 2);


    const nextAmmo = Math.min(current + 1, capacity);

    await commitLoadedMagazine(item, nextAmmo, resource, shouldDeplete);

    return {
        title: "Дозарядка",
        oldAmmo: current,
        newAmmo: nextAmmo,
        capacity,
        formula,
        resourceMode: null,
        results,
        resourceDecreased: shouldDeplete,
        oldResourceDie: resource.dieSize,
        newResourceDie: shouldDeplete ? resourceStepToDie(resource.step - 1) : resource.dieSize
    };
}

function validateMagazine(actor, item, topOff = false) {
    if (!actor || actor.uuid !== item?.actor?.uuid || !isMagazineWeapon(item) || !item.isOwner) throw new Error("Команда доступна только владельцу магазина этого персонажа.");
    if (topOff && !hasTopOff(item)) throw new Error("У оружия нет свойства Дозарядка.");
}

export async function loadFullMagazine(actor, item) {
    validateMagazine(actor, item);
    const data = await documentActions.run(item, "load");
    if (data?.notice) ui.notifications[data.level](data.notice);
    else if (data) await createMagazineMessage(actor, item, data);
    return data;
}

export async function topOffMagazine(actor, item) {
    validateMagazine(actor, item, true);
    const data = await documentActions.run(item, "topOff");
    if (data?.notice) ui.notifications[data.level](data.notice);
    else if (data) await createMagazineMessage(actor, item, data);
    return data;
}

async function commitLoadedMagazine(item, nextAmmo, resource, shouldDeplete) {
    if (shouldDeplete) await decreaseConsumableResource(item.actor, resource);
    try { await item.setFlag(MODULE_ID, "magCurrent", nextAmmo); }
    catch (error) {
        if (shouldDeplete) await item.actor.update({ [resource.path]: resource.step });
        throw error;
    }
}

export function getMagazineCapacity(item) {
    return toInteger(item?.getFlag?.(MODULE_ID, "magCapacity"), 0, 999, 0);
}

export async function spendMagazineAmmo(item, amount = 1, context = {}) {
    if (!isMagazineWeapon(item)) return null;
    const cost = Number(amount);
    if (!Number.isSafeInteger(cost) || cost < 0) throw new Error("Расход патронов должен быть целым неотрицательным числом.");
    const result = await documentActions.run(item, "spend", { amount: cost });
    if (result.spent) Hooks.callAll(`${MODULE_ID}.magazineChanged`, item.actor, item, result.oldAmmo, result.newAmmo, { reason: "api", ...context });
    return result;
}

export async function setMagazineCurrent(item, value, context = {}) {
    if (!isMagazineWeapon(item)) return null;
    const result = await documentActions.run(item, "setAmmo", { value });
    if (result.oldAmmo !== result.newAmmo) Hooks.callAll(`${MODULE_ID}.magazineChanged`, item.actor, item, result.oldAmmo, result.newAmmo, { reason: "manual", ...context });
    return result;
}

documentActions.register("load", executeLoadMagazine);
documentActions.register("topOff", executeTopOffMagazine);
documentActions.register("spend", async (item, { amount }) => {
    validateMagazine(item.actor, item);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Некорректный расход патронов.");
    const oldAmmo = getMagazineCurrent(item);
    const newAmmo = Math.max(oldAmmo - amount, 0);
    if (newAmmo !== oldAmmo) await item.setFlag(MODULE_ID, "magCurrent", newAmmo);
    return { oldAmmo, newAmmo, capacity: getMagazineCapacity(item), spent: oldAmmo - newAmmo };
});
export async function refundMagazineAmmo(item, amount) {
    const result = await documentActions.run(item, "refund", { amount });
    Hooks.callAll(`${MODULE_ID}.magazineChanged`, item.actor, item, result.oldAmmo, result.newAmmo, { reason: "failed-roll" });
    return result;
}

documentActions.register("refund", async (item, { amount }) => {
    validateMagazine(item.actor, item);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Некорректный возврат патронов.");
    const oldAmmo = getMagazineCurrent(item);
    const newAmmo = Math.min(oldAmmo + amount, getMagazineCapacity(item));
    if (oldAmmo !== newAmmo) await item.setFlag(MODULE_ID, "magCurrent", newAmmo);
    return { oldAmmo, newAmmo };
});

documentActions.register("setAmmo", async (item, { value }) => {
    validateMagazine(item.actor, item);
    const oldAmmo = getMagazineCurrent(item);
    const newAmmo = toInteger(value, 0, getMagazineCapacity(item), 0);
    if (newAmmo !== oldAmmo) await item.setFlag(MODULE_ID, "magCurrent", newAmmo);
    return { oldAmmo, newAmmo };
});

export function getMagazineCurrent(item) {
    if (!item) return 0;
    const capacity = getMagazineCapacity(item);
    const raw = item.getFlag(MODULE_ID, "magCurrent");

    if (raw === null || raw === undefined || raw === "") {
        return getSetting(SETTINGS.DEFAULT_MAGAZINE_STATE) === "empty" ? 0 : capacity;
    }

    const value = parseInt(raw, 10);

    return Number.isFinite(value)
        ? clampNumber(value, 0, capacity)
        : 0;
}

// =========================================================================
// 5. РЕСУРС ARROWS / BULLETS
// =========================================================================

function getConsumableResource(actor, key) {
    const path = `system.consumable.${key}.value`;
    const raw = foundry.utils.getProperty(actor, path);

    if (raw === undefined || raw === null) return null;

    const step = parseInt(raw, 10);

    if (!Number.isFinite(step)) return null;
    if (!(step in RESOURCE_STEPS)) return null;

    return {
        key,
        path,
        raw,
        step,
        dieSize: resourceStepToDie(step)
    };
}

async function decreaseConsumableResource(actor, resource) {
    const nextStep = Math.max(resource.step - 1, 0);

    await actor.update({
        [resource.path]: nextStep
    });
}

function resourceStepToDie(step) {
    return RESOURCE_STEPS[step] ?? 0;
}

// =========================================================================
// 6. БРОСКИ И СООБЩЕНИЯ
// =========================================================================

function getRollResults(roll) {
    const results = [];

    for (const term of roll.terms ?? []) {
        if (!Array.isArray(term.results)) continue;

        for (const result of term.results) {
            if (typeof result.result === "number") {
                results.push(result.result);
            }
        }
    }

    return results;
}

async function createMagazineMessage(actor, item, data) {
    const oldResource = data.oldResourceDie > 0 ? `d${data.oldResourceDie}` : "0";
    const newResource = data.newResourceDie > 0 ? `d${data.newResourceDie}` : "0";
    const content = await renderModuleTemplate(`modules/${MODULE_ID}/templates/chat/magazine-action.hbs`, {
        itemName: item.name, ...data, oldResource, newResource, resourceModeLabel: data.resourceMode ? getResourceModeLabel(data.resourceMode) : ""
    });
    await createServiceMessage({
        speaker: ChatMessage.getSpeaker({ actor }), content,
        flags: { [MODULE_ID]: { magazineAction: true, actorId: actor.id, actorUuid: actor.uuid, itemId: item.id, itemUuid: item.uuid, action: data.title, oldAmmo: data.oldAmmo, newAmmo: data.newAmmo, capacity: data.capacity, formula: data.formula, resourceMode: data.resourceMode ?? null, results: data.results, resourceDecreased: data.resourceDecreased, oldResourceDie: data.oldResourceDie, newResourceDie: data.newResourceDie } }
    });
    Hooks.callAll(`${MODULE_ID}.magazineChanged`, actor, item, data.oldAmmo, data.newAmmo, { reason: data.title });
}

// =========================================================================
// 7. МЕЛОЧИ
// =========================================================================

function getResourceModeLabel(mode) {
    if (mode === "perAction") return "за действие";
    if (mode === "perBullet") return "по патронам";

    return String(mode ?? "");
}

function updateMagazineInputWidth(input) {
    const digits = Math.max(String(input.value ?? "").length, 1);
    input.dataset.digits = String(Math.min(digits, 3));
}

function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clampNumber(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function cssEscape(value) {
    if (globalThis.CSS?.escape) return CSS.escape(value);

    return String(value).replace(/["\\]/g, "\\$&");
}
async function runButtonAction(button, operation) {
    if (button.dataset.pending === "1") return;
    button.dataset.pending = "1";
    button.disabled = true;
    try { await operation(); }
    catch (error) { warn("magazine command failed", error); ui.notifications.error(error.message); }
    finally { delete button.dataset.pending; button.disabled = false; }
}

export async function updateFirearmConfiguration(item, updates) {
    const result = await documentActions.run(item, "configure", { updates });
    if (result.oldAmmo !== result.newAmmo) Hooks.callAll(`${MODULE_ID}.magazineChanged`, item.actor, item, result.oldAmmo, result.newAmmo, { reason: "configure" });
    return result;
}

documentActions.register("configure", async (item, { updates }) => {
    const prefix = `flags.${MODULE_ID}.`;
    if (!updates || Object.keys(updates).some(key => !key.startsWith(prefix))) throw new Error("Некорректные настройки огнестрела.");
    const oldAmmo = getMagazineCurrent(item);
    const capacityKey = `${prefix}magCapacity`;
    if (Object.hasOwn(updates, capacityKey)) {
        const capacity = toInteger(updates[capacityKey], 0, 999, 0);
        updates[capacityKey] = capacity;
        const currentKey = `${prefix}magCurrent`;
        if (Object.hasOwn(updates, currentKey) && updates[currentKey] !== null) updates[currentKey] = toInteger(updates[currentKey], 0, capacity, 0);
        else if (getMagazineCurrent(item) > capacity) updates[currentKey] = capacity;
    }
    await item.update(updates);
    return { oldAmmo, newAmmo: getMagazineCurrent(item) };
});
