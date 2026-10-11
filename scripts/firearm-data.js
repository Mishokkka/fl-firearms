import { FIREARM_FEATURES, MODULE_ID } from "./constants.js";

const FEATURE_BY_KEY = new Map(FIREARM_FEATURES.map(feature => [feature.key, feature]));

export function isRangedWeapon(item) {
    return !!item && item.type === "weapon" && item.system?.category === "ranged";
}

export function isFirearm(item) {
    return isRangedWeapon(item) && !!item.getFlag?.(MODULE_ID, "isFirearm");
}

export function getFeatureDefinition(key) {
    return FEATURE_BY_KEY.get(key) ?? null;
}

export function hasFeature(item, key) {
    return !!(item?.getFlag?.(MODULE_ID, `feat_${key}`) || (key === "Kamora" && item?.getFlag?.(MODULE_ID, "feat_kamora")));
}

export function getFeatureValue(item, key) {
    return item?.getFlag?.(MODULE_ID, `val_${key}`) ?? "";
}

export function getFeatureOrder(item) {
    const raw = item?.getFlag?.(MODULE_ID, "featureOrder");
    if (!Array.isArray(raw)) return [];

    const seen = new Set();
    return raw.filter(key => FEATURE_BY_KEY.has(key) && !seen.has(key) && seen.add(key));
}

export function getOrderedActiveFeatureKeys(item) {
    const active = FIREARM_FEATURES
        .filter(feature => hasFeature(item, feature.key))
        .map(feature => feature.key);
    const activeSet = new Set(active);
    const ordered = getFeatureOrder(item).filter(key => activeSet.has(key));

    for (const key of active) {
        if (!ordered.includes(key)) ordered.push(key);
    }
    return ordered;
}

export function getActiveFeatures(item) {
    return getOrderedActiveFeatureKeys(item)
        .map(key => FEATURE_BY_KEY.get(key))
        .filter(Boolean)
        .map(feature => ({
            ...feature,
            value: feature.hasInput ? getFeatureValue(item, feature.key) : "",
            enabled: true
        }));
}

export function getFirearmData(item) {
    if (!item) return null;

    const capacity = toInteger(item.getFlag?.(MODULE_ID, "magCapacity"), 0, 999, 0);
    const rawCurrent = item.getFlag?.(MODULE_ID, "magCurrent");
    const current = rawCurrent === undefined || rawCurrent === null || rawCurrent === ""
        ? null
        : toInteger(rawCurrent, 0, capacity, 0);

    return {
        enabled: !!item.getFlag?.(MODULE_ID, "isFirearm"),
        validRangedWeapon: isRangedWeapon(item),
        firearmType: item.getFlag?.(MODULE_ID, "firearmType") || "regular",
        reloadType: item.getFlag?.(MODULE_ID, "reloadType") || "Slow",
        reloadValue: item.getFlag?.(MODULE_ID, "reloadValue") ?? "",
        armorPiercing: {
            op: item.getFlag?.(MODULE_ID, "apOp") || "*",
            value: item.getFlag?.(MODULE_ID, "apValue") ?? ""
        },
        magazine: {
            capacity,
            current
        },
        features: getActiveFeatures(item)
    };
}

export function getMisfireProfile(item) {
    const kamora = hasFeature(item, "Kamora");
    const fickle = hasFeature(item, "Fickle");
    const faultless = hasFeature(item, "Faultless");

    return {
        hasKamora: kamora,
        primaryFormula: kamora || faultless ? null : (fickle ? "1d10" : "1d20"),
        kamoraFormula: kamora ? (fickle ? "1d6" : "1d12") : null,
        tableModifiers: {
            reliable: hasFeature(item, "Reliable"),
            thickened: hasFeature(item, "Thickened"),
            thinned: hasFeature(item, "Thinned"),
            risky: hasFeature(item, "Risky")
        }
    };
}

export function getArmorPiercingProfile(item) {
    const data = getFirearmData(item);
    if (!data) return null;
    return { ...data.armorPiercing };
}

export function sanitizeFeatureValue(feature, value) {
    if (!feature?.hasInput) return null;
    const text = String(value ?? "").trim();
    if (!text) return "";
    if (feature.valueType !== "number") return text.slice(0, 80);

    const number = Number(text.replace(",", "."));
    return Number.isFinite(number) ? String(Math.max(number, 0)) : "";
}

export function toInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}
