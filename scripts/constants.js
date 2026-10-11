export const MODULE_ID = "fl-firearms";
export const MODULE_VERSION = "0.4.7";
export const DATA_SCHEMA_VERSION = 4;

export const DEFAULT_MISHAP_TABLE_NAMES = Object.freeze({
    regular: "Пороховая осечка",
    artifact: "Пороховая осечка - особое"
});

export const TOOLTIP_JOURNAL_NAME = "Rich Info Tooltips";

export const TIMING = Object.freeze({
    MISHAP_TABLE_DRAW_DELAY: 800,
    MESSAGE_DEDUPE_WINDOW: 10000,
    ATTACK_ROLL_CONTEXT_TTL: 15000,
    PUSH_ROLL_CONTEXT_TTL: 10000,
    CONTEXT_FALLBACK_WITHOUT_ITEM_MAX_AGE: 4000
});

export const FIREARM_FEATURES = Object.freeze([
    { key: "Explosive", label: "Разрывное", group: "combat", automated: false },
    { key: "Upor", label: "Упор", group: "combat", automated: false },
    { key: "Vplotnuyu", label: "Вплотную", group: "range", hasInput: true, valueType: "number", placeholder: "X", automated: false },
    { key: "Range", label: "Прицельная дальность", group: "range", hasInput: true, valueType: "number", placeholder: "X", automated: false },
    { key: "Melee", label: "Рукопашное", group: "combat", automated: false },
    { key: "Mushku", label: "На мушку!", group: "combat", automated: false },
    { key: "Reliable", label: "Надежное", group: "mishap", automated: true },
    { key: "Faultless", label: "Безотказное", group: "mishap", automated: true },
    { key: "Fickle", label: "Капризное", group: "mishap", automated: true },
    { key: "Carbine", label: "Карабин", group: "range", automated: false },
    { key: "RearSight", label: "Целик", group: "range", automated: false },
    { key: "Takedown", label: "Разборное", group: "quality", automated: false },
    { key: "Silent", label: "Тихое", group: "quality", automated: false },
    { key: "Extended", label: "Удлиненное", group: "range", automated: false },
    { key: "Thickened", label: "Утолщенное", group: "mishap", automated: true },
    { key: "Thinned", label: "Истонченное", group: "mishap", automated: true },
    { key: "Risky", label: "Рисковое", group: "mishap", automated: true },
    { key: "ResonanceM", label: "Резонанс(М)", group: "artifact", automated: false },
    { key: "ResonanceS", label: "Резонанс(С)", group: "artifact", automated: false },
    { key: "ResonanceB", label: "Резонанс(Б)", group: "artifact", automated: false },
    { key: "Fragile", label: "Хрупкое", group: "artifact", automated: false },
    { key: "Striking", label: "Поражающее", group: "artifact", hasInput: true, valueType: "number", placeholder: "X", automated: false },
    { key: "Kamora", label: "Камора", group: "mishap", automated: true },
    { key: "Repeater", label: "Повторитель", group: "magazine", automated: false },
    { key: "TopOff", label: "Дозарядка", group: "magazine", hasInput: true, valueType: "text", placeholder: "действие", automated: true },
    { key: "Pocket", label: "Малоразмерное", group: "quality", automated: false },
    { key: "Izgotovka", label: "Изготовка", group: "combat", automated: false },
    { key: "Rapid", label: "Скорострельное", group: "magazine", hasInput: true, valueType: "number", placeholder: "X", automated: false }
]);

export const FEATURE_GROUPS = Object.freeze({
    mishap: "Осечки и надежность",
    magazine: "Магазин и темп огня",
    range: "Дальность и прицеливание",
    combat: "Боевое применение",
    quality: "Конструкция",
    artifact: "Артефактные свойства"
});


