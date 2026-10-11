import { MODULE_ID } from "./constants.js";
import { SETTINGS, getSetting } from "./settings.js";
import { escapeAttribute, evaluateRoll, resolveItemFromMessage } from "./utils.js";
import { isFirearm } from "./firearm-data.js";
import { renderModuleTemplate } from "./templates.js";
import { warn } from "./logger.js";


const RESOURCE_STEPS = Object.freeze({
    0: 0,
    1: 6,
    2: 8,
    3: 10,
    4: 12
});

const MAGAZINE_LOCKS = new Map();
const PROCESSED_AMMO_MESSAGES = new WeakSet();

export function initMagazineHooks() {
    Hooks.on("createChatMessage", handleCreatedChatMessageForAmmoSpend);
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
        bindMagazineInput(item, input, capacity);
    }

    if (max && max.textContent !== String(capacity)) {
        max.textContent = String(capacity);
    }
}

function bindMagazineInput(item, input, capacity) {
    if (input.dataset.flFirearmsBound === "1") return;

    input.dataset.flFirearmsBound = "1";

    input.addEventListener("change", async event => {
        event.preventDefault();
        event.stopPropagation();

        const raw = parseInt(input.value, 10);
        const next = clampNumber(Number.isFinite(raw) ? raw : 0, 0, capacity);

        input.value = String(next);
        updateMagazineInputWidth(input);

        await item.setFlag(MODULE_ID, "magCurrent", next);
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

            await loadFullMagazine(actor, item);
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

            await topOffMagazine(actor, item);
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

async function handleCreatedChatMessageForAmmoSpend(message, options, userId) {
    if (userId !== game.user.id) return;
    if (!getSetting(SETTINGS.AUTO_SPEND_AMMO)) return;
    if (!message.getFlag(MODULE_ID, "isFirearmAttack")) return;
    if (message.getFlag(MODULE_ID, "isPushRoll") || message.getFlag(MODULE_ID, "ammoSpent")) return;
    if (PROCESSED_AMMO_MESSAGES.has(message)) return;

    const item = resolveItemFromMessage(message);
    if (!isMagazineWeapon(item)) return;

    const capacity = getMagazineCapacity(item);
    if (capacity <= 0) return;

    // createChatMessage должен обрабатываться один раз на объект сообщения.
    // WeakSet дает ту же идемпотентность без persisted ChatMessage.setFlag().
    PROCESSED_AMMO_MESSAGES.add(message);
    const emptyAtTrigger = !!message.getFlag(MODULE_ID, "emptyMagazineAttack");

    if (emptyAtTrigger) {
        await createEmptyMagazineNotice(item.actor, item, { speaker: message.speaker, source: "chat-fallback" });
        return;
    }

    await withMagazineLock(item, async () => {
        const oldAmmo = getMagazineCurrent(item);
        const ammoCost = Math.max(Number(message.getFlag(MODULE_ID, "ammoCost")) || 1, 1);
        const newAmmo = Math.max(oldAmmo - ammoCost, 0);
        await item.setFlag(MODULE_ID, "magCurrent", newAmmo);
        Hooks.callAll(`${MODULE_ID}.magazineChanged`, item.actor, item, oldAmmo, newAmmo, { reason: "shot", message });
        Hooks.callAll(`${MODULE_ID}.attackFired`, item.actor, item, { message, oldAmmo, newAmmo, ammoCost });
        await showAmmoSpendFeedback(item, oldAmmo, newAmmo, capacity, message.speaker);
    });
}

export async function createEmptyMagazineNotice(actor, item, { speaker = null, source = "manual" } = {}) {
    const capacity = getMagazineCapacity(item);
    ui.notifications.warn(`${item.name}: магазин пуст.`);
    const content = await renderModuleTemplate(`modules/${MODULE_ID}/templates/chat/empty-magazine.hbs`, { itemName: item.name, capacity });
    return ChatMessage.create({
        speaker: speaker ?? ChatMessage.getSpeaker({ actor }),
        content,
        flags: { [MODULE_ID]: { emptyMagazineNotice: true, emptyMagazineAttack: true, source, actorId: actor?.id ?? null, actorUuid: actor?.uuid ?? null, itemId: item.id, itemUuid: item.uuid } }
    });
}

async function showAmmoSpendFeedback(item, oldAmmo, newAmmo, capacity, speaker) {
    const mode = getSetting(SETTINGS.AMMO_SPEND_FEEDBACK);
    if (mode === "silent") return;
    if (mode === "notification") {
        ui.notifications.info(`${item.name}: ${newAmmo}/${capacity} патронов.`);
        return;
    }
    const content = await renderModuleTemplate(`modules/${MODULE_ID}/templates/chat/ammo-spent.hbs`, { itemName: item.name, oldAmmo, newAmmo, capacity });
    await ChatMessage.create({ speaker, content, flags: { [MODULE_ID]: { ammoSpendNotice: true, itemId: item.id, itemUuid: item.uuid } } });
}

async function withMagazineLock(item, operation) {
    const key = item.uuid;
    const previous = MAGAZINE_LOCKS.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    MAGAZINE_LOCKS.set(key, current);
    try {
        return await current;
    } finally {
        if (MAGAZINE_LOCKS.get(key) === current) MAGAZINE_LOCKS.delete(key);
    }
}

// =========================================================================
// 4. ЛОГИКА ЗАРЯДКИ
// =========================================================================

export async function loadFullMagazine(actor, item) {
    const capacity = getMagazineCapacity(item);
    const current = getMagazineCurrent(item);
    const missing = Math.max(capacity - current, 0);

    if (capacity <= 0) {
        ui.notifications.warn(`${item.name}: не указана емкость магазина.`);
        return;
    }

    if (missing <= 0) {
        ui.notifications.info(`${item.name}: магазин уже полон.`);
        return;
    }

    const resource = getConsumableResource(actor, "arrows");

    if (!resource) {
        ui.notifications.warn(`${actor.name}: ресурс Bullets/Arrows не найден.`);
        warn("actor consumable snapshot", actor.toObject?.(false)?.system ?? actor.system);
        return;
    }

    if (!resource.dieSize) {
        ui.notifications.warn(`${actor.name}: ресурс Bullets/Arrows пуст.`);
        return;
    }

    const resourceMode = getSetting(SETTINGS.MAGAZINE_LOAD_RESOURCE_MODE);
    const formula = resourceMode === "perAction"
        ? `1d${resource.dieSize}`
        : `${missing}d${resource.dieSize}`;

    const roll = await evaluateRoll(formula);
    const results = getRollResults(roll);
    const shouldDeplete = results.some(value => value <= 2);

    if (shouldDeplete) {
        await decreaseConsumableResource(actor, resource);
    }

    await item.setFlag(MODULE_ID, "magCurrent", capacity);

    await createMagazineMessage(actor, item, {
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
    });
}

export async function topOffMagazine(actor, item) {
    const capacity = getMagazineCapacity(item);
    const current = getMagazineCurrent(item);

    if (capacity <= 0) {
        ui.notifications.warn(`${item.name}: не указана емкость магазина.`);
        return;
    }

    if (current >= capacity) {
        ui.notifications.info(`${item.name}: магазин уже полон.`);
        return;
    }

    const resource = getConsumableResource(actor, "arrows");

    if (!resource) {
        ui.notifications.warn(`${actor.name}: ресурс Bullets/Arrows не найден.`);
        warn("actor consumable snapshot", actor.toObject?.(false)?.system ?? actor.system);
        return;
    }

    if (!resource.dieSize) {
        ui.notifications.warn(`${actor.name}: ресурс Bullets/Arrows пуст.`);
        return;
    }

    const formula = `1d${resource.dieSize}`;
    const roll = await evaluateRoll(formula);
    const results = getRollResults(roll);
    const shouldDeplete = results.some(value => value <= 2);

    if (shouldDeplete) {
        await decreaseConsumableResource(actor, resource);
    }

    const nextAmmo = Math.min(current + 1, capacity);

    await item.setFlag(MODULE_ID, "magCurrent", nextAmmo);

    await createMagazineMessage(actor, item, {
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
    });
}

export function getMagazineCapacity(item) {
    const raw = item.getFlag(MODULE_ID, "magCapacity");
    const value = parseInt(raw, 10);

    return Number.isFinite(value) ? Math.max(value, 0) : 0;
}

export async function spendMagazineAmmo(item, amount = 1, context = {}) {
    if (!isMagazineWeapon(item)) return null;
    return withMagazineLock(item, async () => {
        const capacity = getMagazineCapacity(item);
        const oldAmmo = getMagazineCurrent(item);
        const cost = Math.max(Number.parseInt(amount, 10) || 1, 1);
        const newAmmo = Math.max(oldAmmo - cost, 0);
        await item.setFlag(MODULE_ID, "magCurrent", newAmmo);
        Hooks.callAll(`${MODULE_ID}.magazineChanged`, item.actor, item, oldAmmo, newAmmo, { reason: "api", ...context });
        return { oldAmmo, newAmmo, capacity, spent: oldAmmo - newAmmo };
    });
}

export function getMagazineCurrent(item) {
    const capacity = getMagazineCapacity(item);
    const raw = item.getFlag(MODULE_ID, "magCurrent");

    if (raw === null || raw === undefined || raw === "") {
        return getSetting(SETTINGS.DEFAULT_MAGAZINE_STATE) === "empty" ? 0 : capacity;
    }

    const value = parseInt(raw, 10);

    return Number.isFinite(value)
        ? clampNumber(value, 0, capacity)
        : capacity;
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
    await ChatMessage.create({
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