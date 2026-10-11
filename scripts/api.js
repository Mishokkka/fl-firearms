import { MODULE_ID } from "./constants.js";
import { getActiveFeatures, getArmorPiercingProfile, getFirearmData, getMisfireProfile, isFirearm } from "./firearm-data.js";
import { getTooltipContent } from "./utils.js";
import { getMagazineCapacity, getMagazineCurrent, loadFullMagazine, spendMagazineAmmo, topOffMagazine } from "./magazine.js";
import { openFirearmConfig } from "./apps/firearm-config-app.js";
import { runDiagnostics } from "./diagnostics.js";
import { log } from "./logger.js";

export function initPublicApi() {
    const module = game.modules.get(MODULE_ID);
    if (!module) return;

    module.api = {
        isFirearm,
        getFirearmData,
        getFirearmTooltipData,
        getActiveFirearmFeatures,
        getMisfireProfile,
        getMagazineProfile,
        getArmorPiercingProfile,
        spendMagazineAmmo,
        loadMagazine: loadFullMagazine,
        topOffMagazine,
        openFirearmConfig,
        runDiagnostics
    };
    log("public API registered");
}

export function getFirearmTooltipData(item) {
    if (!isFirearm(item)) return null;

    const data = getFirearmData(item);
    const features = getActiveFirearmFeatures(item);
    const current = data.magazine.current ?? data.magazine.capacity;

    // Keep the original flat contract used by FBL Quick Access and old macros.
    // New structured fields are returned alongside it, never instead of it.
    return {
        ...data,
        isFirearm: true,
        firearmType: data.firearmType,
        reloadType: data.reloadType,
        reloadValue: data.reloadValue,
        magCapacity: data.magazine.capacity,
        magCurrent: current,
        apValue: data.armorPiercing.value,
        apOp: data.armorPiercing.op,
        features
    };
}

export function getActiveFirearmFeatures(item) {
    return getActiveFeatures(item).map(feature => ({
        ...feature,
        descriptionHtml: getTooltipContent(feature.label) || ""
    }));
}

export function getMagazineProfile(item) {
    return {
        type: item?.getFlag?.(MODULE_ID, "reloadType") || "Slow",
        capacity: getMagazineCapacity(item),
        current: getMagazineCurrent(item)
    };
}
