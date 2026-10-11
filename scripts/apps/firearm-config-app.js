import { FEATURE_GROUPS, FIREARM_FEATURES, MODULE_ID } from "../constants.js";
import { getFirearmData, getMisfireProfile, getFeatureOrder, sanitizeFeatureValue, toInteger } from "../firearm-data.js";
import { SETTINGS, getSetting } from "../settings.js";
import { getMagazineCurrent, updateFirearmConfiguration } from "../magazine.js";
import { ensureItemSheetRendered, getItemSheetRenderGeneration } from "../item-sheet.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const OPEN_APPS = new Map();

export class FirearmConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(item, options = {}) {
        super({ ...options, id: `${MODULE_ID}-config-${Array.from(item.uuid, char => char.codePointAt(0).toString(16)).join("-")}` });
        this.item = item;
        this._draftOrder = getFeatureOrder(item);
        this._activeTab = "basic";
    }

    static DEFAULT_OPTIONS = {
        classes: ["flf-app", "flf-config"],
        tag: "form",
        position: { width: 700, height: 760 },
        window: { title: "FL Firearms: настройка оружия", icon: "fa-solid fa-gun", resizable: true },
        form: { closeOnSubmit: false, handler: FirearmConfigApp.submit },
        actions: {
            fillMagazine: FirearmConfigApp.fillMagazine,
            emptyMagazine: FirearmConfigApp.emptyMagazine,
            testMisfire: FirearmConfigApp.testMisfire,
            moveFeatureUp: FirearmConfigApp.moveFeatureUp,
            moveFeatureDown: FirearmConfigApp.moveFeatureDown
        }
    };

    static PARTS = {
        main: { template: `modules/${MODULE_ID}/templates/apps/firearm-config.hbs`, scrollable: [".flf-config__body"] }
    };

    get title() {
        return `FL Firearms: ${this.item?.name ?? "оружие"}`;
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const data = getFirearmData(this.item);
        const misfire = getMisfireProfile(this.item);
        if (!getSetting(SETTINGS.ENABLE_PRIMARY_MISHAP)) misfire.primaryFormula = null;
        const groups = Object.entries(FEATURE_GROUPS).map(([key, label]) => ({
            key,
            label,
            features: FIREARM_FEATURES.filter(feature => feature.group === key).map(feature => ({
                ...feature,
                enabled: !!this.item.getFlag(MODULE_ID, `feat_${feature.key}`),
                value: this.item.getFlag(MODULE_ID, `val_${feature.key}`) ?? "",
                isNumber: feature.valueType === "number"
            }))
        }));

        return {
            ...context,
            item: this.item,
            data,
            misfire,
            groups,
            editable: this.item.isOwner,
            isRegular: data.firearmType === "regular",
            isArtifact: data.firearmType === "artifact",
            reloadFast: data.reloadType === "Fast",
            reloadSlow: data.reloadType === "Slow",
            reloadSeconds: data.reloadType === "S",
            reloadMagazine: data.reloadType === "MAG",
            apMultiply: data.armorPiercing.op === "*",
            apPlus: data.armorPiercing.op === "+",
            apMinus: data.armorPiercing.op === "-",
            magazineCurrent: data.magazine.current ?? getMagazineCurrent(this.item),
            warnings: getValidationWarnings(this.item)
        };
    }

    async _onRender(context, options) {
        await super._onRender(context, options);
        const root = this.element;
        this._ammoDraftChanged = false;
        root.querySelector("[name=magCurrent]")?.addEventListener("input", () => { this._ammoDraftChanged = true; });
        if (!this.item.isOwner) root.querySelectorAll("input:not([data-feature-search]), select, button[data-action]:not([data-action=testMisfire])").forEach(control => { control.disabled = true; });
        for (const panel of root.querySelectorAll("[data-tab-panel]")) panel.hidden = panel.dataset.tabPanel !== this._activeTab;
        for (const tab of root.querySelectorAll("[data-tab-target]")) tab.classList.toggle("active", tab.dataset.tabTarget === this._activeTab);
        root.querySelector("[name=magCapacity]")?.addEventListener("input", event => {
            const current = root.querySelector("[name=magCurrent]");
            if (current) current.max = String(toInteger(event.target.value, 0, 999, 0));
        });
        const search = root.querySelector("[data-feature-search]");
        search?.addEventListener("input", () => {
            const query = search.value.trim().toLocaleLowerCase("ru");
            for (const card of root.querySelectorAll(".flf-feature")) {
                card.hidden = !!query && !card.textContent.toLocaleLowerCase("ru").includes(query);
            }
        });

        for (const tab of root.querySelectorAll("[data-tab-target]")) {
            tab.addEventListener("click", event => {
                event.preventDefault();
                const target = tab.dataset.tabTarget;
                this._activeTab = target;
                for (const button of root.querySelectorAll("[data-tab-target]")) button.classList.toggle("active", button === tab);
                for (const panel of root.querySelectorAll("[data-tab-panel]")) panel.hidden = panel.dataset.tabPanel !== target;
            });
        }
    }

    static async submit(_event, form, _formData) {
        if (!this.item?.isOwner) return;

        const capacity = toInteger(form.elements.magCapacity?.value, 0, 999, 0);
        const current = toInteger(form.elements.magCurrent?.value, 0, capacity, 0);
        const reloadType = form.elements.reloadType?.value || "Slow";
        const updates = {
            [`flags.${MODULE_ID}.isFirearm`]: !!form.elements.isFirearm?.checked,
            [`flags.${MODULE_ID}.firearmType`]: form.elements.firearmType?.value || "regular",
            [`flags.${MODULE_ID}.reloadType`]: reloadType,
            [`flags.${MODULE_ID}.reloadValue`]: String(form.elements.reloadValue?.value ?? "").trim().slice(0, 40),
            [`flags.${MODULE_ID}.magCapacity`]: capacity,
            [`flags.${MODULE_ID}.magCurrent`]: reloadType === "MAG" ? current : null,
            [`flags.${MODULE_ID}.apOp`]: form.elements.apOp?.value || "*",
            [`flags.${MODULE_ID}.apValue`]: sanitizeNumberOrBlank(form.elements.apValue?.value)
        };

        const order = [];
        for (const feature of FIREARM_FEATURES) {
            const checkbox = form.elements[`feat_${feature.key}`];
            const enabled = !!checkbox?.checked;
            updates[`flags.${MODULE_ID}.feat_${feature.key}`] = enabled;
            if (enabled) order.push(feature.key);
            if (feature.hasInput) {
                updates[`flags.${MODULE_ID}.val_${feature.key}`] = enabled
                    ? sanitizeFeatureValue(feature, form.elements[`val_${feature.key}`]?.value)
                    : null;
            }
        }
        updates[`flags.${MODULE_ID}.featureOrder`] = preserveOrder(this._draftOrder, order);

        if (reloadType === "MAG" && !this._ammoDraftChanged) delete updates[`flags.${MODULE_ID}.magCurrent`];
        const nativeSheet = this.item.sheet;
        const nativeGeneration = getItemSheetRenderGeneration(nativeSheet);
        await updateFirearmConfiguration(this.item, updates);
        this._draftOrder = updates[`flags.${MODULE_ID}.featureOrder`];
        await ensureItemSheetRendered(nativeSheet, nativeGeneration);
        ui.notifications.info(`${this.item.name}: настройки огнестрела сохранены.`);
        await this.render({ force: true });
    }

    static async fillMagazine() {
        if (!this.item?.isOwner) return;
        this._ammoDraftChanged = true;
        const form = this.element;
        const capacity = toInteger(form.querySelector("[name=magCapacity]")?.value, 0, 999, 0);
        const current = form.querySelector("[name=magCurrent]");
        if (current) { current.value = String(capacity); current.max = String(capacity); }
    }

    static async emptyMagazine() {
        if (!this.item?.isOwner) return;
        this._ammoDraftChanged = true;
        const current = this.element.querySelector("[name=magCurrent]");
        if (current) current.value = "0";
    }

    static async testMisfire() {
        const profile = getMisfireProfile({ getFlag: (_scope, key) => {
            const input = this.element.querySelector(`[name="${key}"]`);
            return input?.type === "checkbox" ? input.checked : this.item.getFlag(MODULE_ID, key);
        } });
        if (!getSetting(SETTINGS.ENABLE_PRIMARY_MISHAP)) profile.primaryFormula = null;
        const formulas = [profile.primaryFormula, profile.kamoraFormula].filter(Boolean);
        if (!formulas.length) {
            ui.notifications.info(`${this.item.name}: первичная проверка осечки отключена.`);
            return;
        }
        const results = [];
        for (const formula of formulas) {
            const roll = await new Roll(formula).evaluate();
            results.push(`${formula} = ${roll.total}`);
        }
        ui.notifications.info(`${this.item.name}: ${results.join("; ")}`);
    }


    static async moveFeatureUp(_event, target) {
        return this._moveFeature(String(target.dataset.feature ?? ""), -1);
    }

    static async moveFeatureDown(_event, target) {
        return this._moveFeature(String(target.dataset.feature ?? ""), 1);
    }

    async _moveFeature(key, delta) {
        if (!this.item?.isOwner || !key) return;
        const order = this._draftOrder;
        const active = this.element.querySelector(`[name="feat_${key}"]`)?.checked;
        if (!active) return;
        const normalized = Array.isArray(order) ? [...order] : [];
        for (const feature of FIREARM_FEATURES) {
            if (this.element.querySelector(`[name="feat_${feature.key}"]`)?.checked && !normalized.includes(feature.key)) normalized.push(feature.key);
        }
        const index = normalized.indexOf(key);
        const next = index + delta;
        if (index < 0 || next < 0 || next >= normalized.length) return;
        [normalized[index], normalized[next]] = [normalized[next], normalized[index]];
        this._draftOrder = normalized;
        const list = this.element.querySelector(".flf-active-order");
        if (!list) return;
        const rows = new Map([...list.querySelectorAll(":scope > div")].map(row => [row.querySelector("[data-feature]")?.dataset.feature, row]));
        for (const featureKey of normalized) if (rows.has(featureKey)) list.appendChild(rows.get(featureKey));
    }

    async _onClose(options) {
        OPEN_APPS.delete(this.item?.uuid);
        return super._onClose(options);
    }
}

export async function openFirearmConfig(item) {
    if (!item) return null;
    const existing = OPEN_APPS.get(item.uuid);
    if (existing?.rendered) {
        existing.bringToFront?.();
        return existing;
    }

    const app = new FirearmConfigApp(item);
    OPEN_APPS.set(item.uuid, app);
    try {
        await app.render({ force: true });
        return app;
    } catch (error) {
        OPEN_APPS.delete(item.uuid);
        console.error(`${MODULE_ID} | failed to open FirearmConfigApp`, error);
        ui.notifications.error("FL Firearms: не удалось открыть расширенные настройки. Подробности записаны в консоль.");
        return null;
    }
}

function sanitizeNumberOrBlank(value) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    const number = Number(text.replace(",", "."));
    return Number.isFinite(number) ? number : "";
}

function preserveOrder(previous, activeKeys) {
    const active = new Set(activeKeys);
    const next = Array.isArray(previous) ? previous.filter(key => active.has(key)) : [];
    for (const key of activeKeys) if (!next.includes(key)) next.push(key);
    return next;
}

function getValidationWarnings(item) {
    const warnings = [];
    const data = getFirearmData(item);
    if (!data.validRangedWeapon) warnings.push("Предмет не является дальнобойным оружием Forbidden Lands. Автоматизация атак будет отключена.");
    if (data.reloadType === "MAG" && data.magazine.capacity <= 0) warnings.push("Выбран магазин, но его емкость равна нулю.");
    if (item.getFlag(MODULE_ID, "feat_Thickened") && item.getFlag(MODULE_ID, "feat_Thinned")) warnings.push("Одновременно включены Утолщенное и Истонченное. Их модификаторы взаимно компенсируются.");
    if (data.features.some(feature => !feature.automated)) warnings.push("Часть свойств пока информационная: модуль хранит их и отдает через API, но не применяет без точного правила.");
    return warnings;
}
