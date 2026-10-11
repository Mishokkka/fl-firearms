import { FIREARM_FEATURES, MODULE_ID } from "./constants.js";
import {
    getActiveFeatures,
    getFeatureOrder,
    isRangedWeapon,
    sanitizeFeatureValue
} from "./firearm-data.js";
import { normalizeFirearmItemData } from "./migrations.js";
import { debug, warn } from "./logger.js";
import { escapeAttribute, getTooltipContent } from "./utils.js";

const ITEM_SHEET_RENDER_GENERATIONS = new WeakMap();
const NORMALIZATION_PROMISES = new WeakMap();

export function initItemSheetHooks() {
    Hooks.on("renderItemSheet", renderFirearmItemSheet);
}

function asRoot(html) {
    if (html instanceof HTMLElement) return html;
    if (html?.[0] instanceof HTMLElement) return html[0];
    return null;
}

function renderFirearmItemSheet(app, html) {
    const root = asRoot(html);
    const item = app.document;
    if (!root || !item || item.documentName !== "Item") return;

    const generation = markItemSheetRender(app);
    const hasModuleData = !!item.getFlag(MODULE_ID, "isFirearm");
    if (item.type === "weapon" || hasModuleData) {
        normalizeItemOnRender(item, app, generation);
    }

    cleanupInjectedUi(root);
    if (!isRangedWeapon(item)) return;

    renderToggle(app, root, item);
    if (!item.getFlag(MODULE_ID, "isFirearm")) return;

    const row = renderMainRow(app, root, item);
    if (!row) return;
    renderFeatureChips(app, root, item, row);
}

function cleanupInjectedUi(root) {
    root.querySelectorAll(".fl-firearms-row, .fl-features-wrapper").forEach(element => element.remove());
}

function renderToggle(app, root, item) {
    const container = root.querySelector(".features.flex.row");
    if (!container) {
        debug("item sheet .features.flex.row not found", item.name);
        return;
    }

    container.querySelector(".fl-firearm-toggle")?.remove();

    const enabled = !!item.getFlag(MODULE_ID, "isFirearm");
    const toggle = document.createElement("a");
    toggle.className = `feature fl-firearm-toggle${enabled ? " active" : ""}`;
    toggle.setAttribute("role", "button");
    toggle.setAttribute("tabindex", "0");
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.innerHTML = `<i class="far ${enabled ? "fa-check-circle" : "fa-circle"}"></i> Огнестрел`;

    const activate = async event => {
        event.preventDefault();
        event.stopPropagation();
        const generation = getItemSheetRenderGeneration(app);
        const next = !item.getFlag(MODULE_ID, "isFirearm");
        await item.setFlag(MODULE_ID, "isFirearm", next);
        await ensureItemSheetRendered(app, generation);
    };

    toggle.addEventListener("click", activate);
    toggle.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        void activate(event);
    });
    container.appendChild(toggle);
}

function renderMainRow(app, root, item) {
    const damageInput = root.querySelector('[name="system.damage"]');
    const damageRow = damageInput?.closest(".flex.row") ?? damageInput?.parentElement?.parentElement;
    if (!damageRow) {
        debug("item sheet damage row not found", item.name);
        return null;
    }

    const firearmType = item.getFlag(MODULE_ID, "firearmType") || "regular";
    const reloadValue = item.getFlag(MODULE_ID, "reloadValue") ?? "";
    const reloadType = item.getFlag(MODULE_ID, "reloadType") || "Slow";
    const apValue = item.getFlag(MODULE_ID, "apValue") ?? "";
    const apOp = item.getFlag(MODULE_ID, "apOp") || "*";
    const magCapacity = item.getFlag(MODULE_ID, "magCapacity") ?? "";

    const row = document.createElement("div");
    row.className = "flex row fl-firearms-row";
    row.innerHTML = `
      <div class="fl-group">
        <label class="fl-tooltip-firearm">Огнестрел</label>
        <select class="fl-firearm-type-select" name="flags.${MODULE_ID}.firearmType">
          <option value="regular" ${firearmType === "regular" ? "selected" : ""}>Обычный</option>
          <option value="artifact" ${firearmType === "artifact" ? "selected" : ""}>Артефактный</option>
        </select>
      </div>

      <div class="fl-group fl-reload-group">
        <label class="fl-tooltip-reload">Перезарядка</label>
        <div class="fl-combo">
          <input type="text" class="fl-reload-val${reloadType === "MAG" ? " fl-hidden" : ""}"
            name="flags.${MODULE_ID}.reloadValue" value="${escapeAttribute(reloadValue)}" maxlength="40" placeholder="X">
          <select class="fl-reload-type" name="flags.${MODULE_ID}.reloadType">
            <option value="Fast" ${reloadType === "Fast" ? "selected" : ""}>Fast</option>
            <option value="Slow" ${reloadType === "Slow" ? "selected" : ""}>Slow</option>
            <option value="S" ${reloadType === "S" ? "selected" : ""}>сек</option>
            <option value="MAG" ${reloadType === "MAG" ? "selected" : ""}>MAG</option>
          </select>
          <input type="number" class="fl-mag-val${reloadType === "MAG" ? "" : " fl-hidden"}"
            name="flags.${MODULE_ID}.magCapacity" value="${escapeAttribute(magCapacity)}" min="0" max="999" step="1" placeholder="0">
        </div>
      </div>

      <div class="fl-group">
        <label class="fl-tooltip-ap">БП</label>
        <div class="fl-combo">
          <input type="number" class="fl-ap-val" name="flags.${MODULE_ID}.apValue"
            value="${escapeAttribute(apValue)}" step="0.01" placeholder="0">
          <select class="fl-ap-op" name="flags.${MODULE_ID}.apOp">
            <option value="*" ${apOp === "*" ? "selected" : ""}>МНОЖ</option>
            <option value="+" ${apOp === "+" ? "selected" : ""}>ПЛЮС</option>
            <option value="-" ${apOp === "-" ? "selected" : ""}>МИНУС</option>
          </select>
        </div>
      </div>
    `;

    damageRow.insertAdjacentElement("afterend", row);
    updateMainRowState(row);
    bindMainRowListeners(app, item, row);
    return row;
}

function bindMainRowListeners(app, item, row) {
    const firearmType = row.querySelector(".fl-firearm-type-select");
    const reloadType = row.querySelector(".fl-reload-type");
    const reloadValue = row.querySelector(".fl-reload-val");
    const magCapacity = row.querySelector(".fl-mag-val");
    const apValue = row.querySelector(".fl-ap-val");
    const apOp = row.querySelector(".fl-ap-op");

    firearmType?.addEventListener("change", async event => {
        await item.setFlag(MODULE_ID, "firearmType", event.currentTarget.value || "regular");
        updateMainRowState(row);
    });

    reloadType?.addEventListener("change", async event => {
        const value = event.currentTarget.value || "Slow";
        await item.setFlag(MODULE_ID, "reloadType", value);
        updateMainRowState(row);
    });

    reloadValue?.addEventListener("change", event => {
        void item.setFlag(MODULE_ID, "reloadValue", String(event.currentTarget.value ?? "").trim().slice(0, 40));
    });

    magCapacity?.addEventListener("change", async event => {
        const capacity = clampInteger(event.currentTarget.value, 0, 999);
        event.currentTarget.value = String(capacity);
        const rawCurrent = item.getFlag(MODULE_ID, "magCurrent");
        const updates = { [`flags.${MODULE_ID}.magCapacity`]: capacity };
        if (rawCurrent !== null && rawCurrent !== undefined && rawCurrent !== "" && Number(rawCurrent) > capacity) {
            updates[`flags.${MODULE_ID}.magCurrent`] = capacity;
        }
        await item.update(updates);
    });

    apValue?.addEventListener("change", event => {
        const text = String(event.currentTarget.value ?? "").trim().replace(",", ".");
        const value = text === "" ? "" : Number(text);
        void item.setFlag(MODULE_ID, "apValue", Number.isFinite(value) ? value : "");
    });

    apOp?.addEventListener("change", event => {
        const value = ["*", "+", "-"].includes(event.currentTarget.value) ? event.currentTarget.value : "*";
        void item.setFlag(MODULE_ID, "apOp", value);
    });

    row.querySelectorAll("input, select").forEach(control => {
        control.addEventListener("click", event => event.stopPropagation());
    });

    void app;
}

function updateMainRowState(row) {
    const firearmType = row.querySelector(".fl-firearm-type-select")?.value;
    const reloadType = row.querySelector(".fl-reload-type")?.value;
    row.querySelector(".fl-reload-val")?.classList.toggle("fl-hidden", reloadType === "MAG");
    row.querySelector(".fl-mag-val")?.classList.toggle("fl-hidden", reloadType !== "MAG");

    setDomTooltip(row.querySelector(".fl-tooltip-firearm"), firearmType === "artifact" ? "Артефактный Огнестрел" : "Огнестрел");
    setDomTooltip(row.querySelector(".fl-tooltip-reload"), reloadType === "MAG" ? "Магазин" : "Перезарядка");
    setDomTooltip(row.querySelector(".fl-tooltip-ap"), "БП");
}

function renderFeatureChips(app, root, item, row) {
    const active = getActiveFeatures(item);
    const activeKeys = new Set(active.map(feature => feature.key));
    const inactive = FIREARM_FEATURES
        .filter(feature => !activeKeys.has(feature.key))
        .sort((left, right) => left.label.localeCompare(right.label, "ru", { sensitivity: "base" }));

    const wrapper = document.createElement("div");
    wrapper.className = "fl-features-wrapper";

    const activeContainer = document.createElement("div");
    activeContainer.className = "fl-active-features";
    activeContainer.setAttribute("aria-label", "Активные свойства огнестрела");
    for (const feature of active) activeContainer.appendChild(createActiveFeatureChip(app, item, feature));
    wrapper.appendChild(activeContainer);

    if (inactive.length) {
        const menu = document.createElement("div");
        menu.className = "fl-features-menu";
        menu.innerHTML = `
          <a class="fl-toggle-menu" role="button" tabindex="0" aria-expanded="false">
            <i class="fas fa-chevron-right"></i> Добавить свойство
          </a>
          <div class="fl-inactive-features" hidden></div>
        `;
        const inactiveContainer = menu.querySelector(".fl-inactive-features");
        for (const feature of inactive) inactiveContainer.appendChild(createInactiveFeatureChip(app, item, feature));

        const toggle = menu.querySelector(".fl-toggle-menu");
        const toggleMenu = event => {
            event.preventDefault();
            event.stopPropagation();
            const expanded = toggle.getAttribute("aria-expanded") === "true";
            toggle.setAttribute("aria-expanded", String(!expanded));
            inactiveContainer.hidden = expanded;
            toggle.querySelector("i")?.classList.toggle("fa-chevron-right", expanded);
            toggle.querySelector("i")?.classList.toggle("fa-chevron-down", !expanded);
        };
        toggle.addEventListener("click", toggleMenu);
        toggle.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return;
            toggleMenu(event);
        });
        wrapper.appendChild(menu);
    }

    row.insertAdjacentElement("afterend", wrapper);
    activateFeatureDragAndDrop(app, item, activeContainer);
    void root;
}

function createActiveFeatureChip(app, item, feature) {
    const chip = document.createElement("div");
    chip.className = "fl-feature-badge active";
    chip.draggable = true;
    chip.dataset.feature = feature.key;
    chip.innerHTML = `
      <i class="fas fa-grip-lines fl-feature-drag-handle" title="Перетащить"></i>
      <span class="fl-feature-label">${escapeText(feature.label)}</span>
      ${feature.hasInput ? `<input type="${feature.valueType === "number" ? "number" : "text"}" class="fl-feat-val" data-feature="${escapeAttribute(feature.key)}" value="${escapeAttribute(feature.value)}" placeholder="${escapeAttribute(feature.placeholder ?? "")}" ${feature.valueType === "number" ? 'min="0" step="1"' : ""}>` : ""}
      <button type="button" class="fl-remove-feature" title="Удалить свойство" aria-label="Удалить ${escapeAttribute(feature.label)}"><i class="fas fa-times"></i></button>
    `;
    setDomTooltip(chip.querySelector(".fl-feature-label"), feature.label);

    chip.querySelector(".fl-remove-feature")?.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        const generation = getItemSheetRenderGeneration(app);
        await removeFeature(item, feature.key);
        await ensureItemSheetRendered(app, generation);
    });

    const input = chip.querySelector(".fl-feat-val");
    input?.addEventListener("change", async event => {
        event.preventDefault();
        event.stopPropagation();
        const value = sanitizeFeatureValue(feature, event.currentTarget.value);
        event.currentTarget.value = value ?? "";
        await item.setFlag(MODULE_ID, `val_${feature.key}`, value);
    });
    input?.addEventListener("mousedown", event => event.stopPropagation());
    input?.addEventListener("dragstart", event => event.stopPropagation());
    return chip;
}

function createInactiveFeatureChip(app, item, feature) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "fl-feature-badge inactive fl-add-feature";
    chip.dataset.feature = feature.key;
    chip.textContent = `+ ${feature.label}`;
    setDomTooltip(chip, feature.label);
    chip.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        const generation = getItemSheetRenderGeneration(app);
        await addFeature(item, feature.key);
        await ensureItemSheetRendered(app, generation);
    });
    return chip;
}

async function addFeature(item, key) {
    const order = getOrderedActiveFeatureKeys(item);
    if (!order.includes(key)) order.push(key);
    await item.update({
        [`flags.${MODULE_ID}.feat_${key}`]: true,
        [`flags.${MODULE_ID}.featureOrder`]: order
    });
}

async function removeFeature(item, key) {
    const order = getFeatureOrder(item).filter(existingKey => existingKey !== key);
    await item.update({
        [`flags.${MODULE_ID}.feat_${key}`]: false,
        [`flags.${MODULE_ID}.val_${key}`]: null,
        [`flags.${MODULE_ID}.featureOrder`]: order
    });
}

function getOrderedActiveFeatureKeys(item) {
    const active = getActiveFeatures(item).map(feature => feature.key);
    const activeSet = new Set(active);
    const ordered = getFeatureOrder(item).filter(key => activeSet.has(key));
    for (const key of active) if (!ordered.includes(key)) ordered.push(key);
    return ordered;
}

function activateFeatureDragAndDrop(app, item, container) {
    let draggedKey = null;
    const chips = [...container.querySelectorAll(".fl-feature-badge.active")];

    for (const chip of chips) {
        chip.addEventListener("dragstart", event => {
            if (event.target.closest("input, button")) {
                event.preventDefault();
                return;
            }
            draggedKey = chip.dataset.feature;
            chip.classList.add("fl-feature-dragging");
            event.dataTransfer?.setData("text/plain", draggedKey);
            if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        });

        chip.addEventListener("dragend", () => {
            draggedKey = null;
            container.querySelectorAll(".fl-feature-dragging, .fl-feature-drop-target").forEach(element => {
                element.classList.remove("fl-feature-dragging", "fl-feature-drop-target");
            });
        });

        chip.addEventListener("dragover", event => {
            if (!draggedKey || draggedKey === chip.dataset.feature) return;
            event.preventDefault();
            chip.classList.add("fl-feature-drop-target");
        });

        chip.addEventListener("dragleave", () => chip.classList.remove("fl-feature-drop-target"));
        chip.addEventListener("drop", async event => {
            event.preventDefault();
            event.stopPropagation();
            const droppedKey = event.dataTransfer?.getData("text/plain") || draggedKey;
            const targetKey = chip.dataset.feature;
            if (!droppedKey || !targetKey || droppedKey === targetKey) return;
            const rect = chip.getBoundingClientRect();
            const placement = event.clientX > rect.left + rect.width / 2 ? "after" : "before";
            const generation = getItemSheetRenderGeneration(app);
            await reorderFeatures(item, droppedKey, targetKey, placement);
            await ensureItemSheetRendered(app, generation);
        });
    }

    container.addEventListener("dragover", event => {
        if (draggedKey) event.preventDefault();
    });
    container.addEventListener("drop", async event => {
        if (event.target.closest(".fl-feature-badge.active")) return;
        event.preventDefault();
        const droppedKey = event.dataTransfer?.getData("text/plain") || draggedKey;
        if (!droppedKey) return;
        const order = getOrderedActiveFeatureKeys(item).filter(key => key !== droppedKey);
        order.push(droppedKey);
        const generation = getItemSheetRenderGeneration(app);
        await item.setFlag(MODULE_ID, "featureOrder", order);
        await ensureItemSheetRendered(app, generation);
    });
}

async function reorderFeatures(item, draggedKey, targetKey, placement) {
    const order = getOrderedActiveFeatureKeys(item).filter(key => key !== draggedKey);
    const targetIndex = order.indexOf(targetKey);
    if (targetIndex < 0) return;
    order.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, draggedKey);
    await item.setFlag(MODULE_ID, "featureOrder", order);
}

function setDomTooltip(element, pageName) {
    if (!element) return;
    const content = getTooltipContent(pageName);
    if (!content) {
        element.removeAttribute("data-tooltip");
        element.removeAttribute("data-tooltip-direction");
        return;
    }
    element.setAttribute("data-tooltip", content);
    element.setAttribute("data-tooltip-direction", "UP");
}

function normalizeItemOnRender(item, app, generation) {
    if (NORMALIZATION_PROMISES.has(item)) return;

    const promise = normalizeFirearmItemData(item)
        .then(changed => changed && ensureItemSheetRendered(app, generation))
        .catch(error => warn("lazy item normalization failed", error))
        .finally(() => NORMALIZATION_PROMISES.delete(item));

    NORMALIZATION_PROMISES.set(item, promise);
}

function markItemSheetRender(app) {
    const generation = (ITEM_SHEET_RENDER_GENERATIONS.get(app) ?? 0) + 1;
    ITEM_SHEET_RENDER_GENERATIONS.set(app, generation);
    return generation;
}

export function getItemSheetRenderGeneration(app) {
    return ITEM_SHEET_RENDER_GENERATIONS.get(app) ?? 0;
}

export async function ensureItemSheetRendered(app, previousGeneration) {
    if (!app?.render) return false;

    // Document.update в Foundry обычно сам инициирует render связанного sheet.
    // Если этот render уже дошел до renderItemSheet, не дублируем его. Если нет,
    // сохраняем прежнее поведение и явно обновляем интерфейс один раз.
    await Promise.resolve();
    if (getItemSheetRenderGeneration(app) !== previousGeneration) return false;

    await app.render(true);
    return true;
}

function clampInteger(value, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(Math.max(parsed, min), max);
}

function escapeText(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
