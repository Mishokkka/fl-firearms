import { DEFAULT_MISHAP_TABLE_NAMES, MODULE_ID } from "./constants.js";

export const SETTINGS = Object.freeze({
    DATA_VERSION: "dataVersion",
    CRIT_BAD_PLAYLIST: "critBadPlaylist",
    CRIT_BAD_VOLUME: "critBadVolume",
    ENABLE_PRIMARY_MISHAP: "enablePrimaryMishap",
    AUTO_SPEND_AMMO: "autoSpendAmmo",
    MAGAZINE_LOAD_RESOURCE_MODE: "magazineLoadResourceMode",
    BLOCK_EMPTY_MAGAZINE_ATTACK: "blockEmptyMagazineAttack",
    DEFAULT_MAGAZINE_STATE: "defaultMagazineState",
    RENAME_CONSUMABLES_MODE: "renameConsumablesMode",
    AMMO_SPEND_FEEDBACK: "ammoSpendFeedback",
    DEBUG_LOGS: "debugLogs",
    WARN_SETUP_PROBLEMS: "warnSetupProblems",
    REGULAR_MISHAP_TABLE: "regularMishapTable",
    ARTIFACT_MISHAP_TABLE: "artifactMishapTable"
});

export function initSettings(DiagnosticsApp = null) {
    game.settings.register(MODULE_ID, SETTINGS.DATA_VERSION, {
        name: "Версия данных FL Firearms",
        scope: "world",
        config: false,
        type: Number,
        default: 0
    });

    registerString(SETTINGS.CRIT_BAD_PLAYLIST, "Плейлист звуков осечки", "Имя плейлиста для Каморы, скрытой осечки и проваленного Push.", "CritBad");
    game.settings.register(MODULE_ID, SETTINGS.CRIT_BAD_VOLUME, {
        name: "Громкость звука осечки",
        hint: "Громкость проигрывания случайного звука из плейлиста осечки.",
        scope: "world", config: true, type: Number, default: 0.8,
        range: { min: 0, max: 1, step: 0.05 }
    });
    registerBoolean(SETTINGS.ENABLE_PRIMARY_MISHAP, "Скрытая проверка осечки d20/d10", "Камора продолжает работать независимо от этой настройки.", true);
    registerBoolean(SETTINGS.AUTO_SPEND_AMMO, "Автоматически тратить патрон из магазина", "Push не тратит дополнительный патрон.", true);
    registerBoolean(SETTINGS.BLOCK_EMPTY_MAGAZINE_ATTACK, "Блокировать атаку с пустым магазином", "Останавливает rollGear/rollAction до открытия броска и создает карточку сухого щелчка.", true);
    registerBoolean(SETTINGS.DEBUG_LOGS, "Отладочный журнал", "Показывает подробные сообщения FL Firearms в консоли.", false);
    registerBoolean(SETTINGS.WARN_SETUP_PROBLEMS, "Предупреждать о проблемах настройки", "Один раз при входе ГМа сообщает об отсутствующих таблицах, журнале или плейлисте.", true);

    game.settings.register(MODULE_ID, SETTINGS.MAGAZINE_LOAD_RESOURCE_MODE, {
        name: "Расход Bullets при зарядке магазина",
        hint: "По патронам: бросок за каждый недостающий патрон. За действие: один бросок за всю зарядку.",
        scope: "world", config: true, type: String,
        choices: { perBullet: "По патронам", perAction: "За действие" },
        default: "perBullet"
    });
    game.settings.register(MODULE_ID, SETTINGS.DEFAULT_MAGAZINE_STATE, {
        name: "Начальное состояние нового магазина",
        hint: "Применяется один раз, когда у многозарядного оружия отсутствует magCurrent.",
        scope: "world", config: true, type: String,
        choices: { full: "Полный", empty: "Пустой" }, default: "full"
    });
    game.settings.register(MODULE_ID, SETTINGS.RENAME_CONSUMABLES_MODE, {
        name: "Переименование расходников",
        hint: "Заменяет Arrows на Bullets и Torches на Lamp Oil в интерфейсе листа персонажа.",
        scope: "world", config: true, type: String,
        choices: { off: "Не переименовывать", all: "На всех листах", firearmActorsOnly: "Только у владельцев огнестрела" },
        default: "all"
    });
    game.settings.register(MODULE_ID, SETTINGS.AMMO_SPEND_FEEDBACK, {
        name: "Сообщение о расходе патрона",
        hint: "Определяет, показывать ли обычное списание патрона. Пустой магазин всегда сообщает о себе.",
        scope: "client", config: true, type: String,
        choices: { silent: "Без сообщения", notification: "Уведомление", chat: "Карточка в чате" },
        default: "silent"
    });

    registerString(SETTINGS.REGULAR_MISHAP_TABLE, "Таблица обычной пороховой осечки", "Точное имя мировой RollTable.", DEFAULT_MISHAP_TABLE_NAMES.regular);
    registerString(SETTINGS.ARTIFACT_MISHAP_TABLE, "Таблица артефактной пороховой осечки", "Точное имя мировой RollTable.", DEFAULT_MISHAP_TABLE_NAMES.artifact);

    if (DiagnosticsApp) {
        game.settings.registerMenu(MODULE_ID, "diagnostics", {
            name: "FL Firearms: диагностика",
            label: "Открыть диагностику",
            hint: "Проверяет интеграцию с Forbidden Lands, таблицы, журнал, плейлист и данные оружия.",
            icon: "fa-solid fa-stethoscope",
            type: DiagnosticsApp,
            restricted: true
        });
    }
}

function registerString(key, name, hint, defaultValue) {
    game.settings.register(MODULE_ID, key, { name, hint, scope: "world", config: true, type: String, default: defaultValue });
}

function registerBoolean(key, name, hint, defaultValue) {
    game.settings.register(MODULE_ID, key, { name, hint, scope: "world", config: true, type: Boolean, default: defaultValue });
}

export function getSetting(key) {
    return game.settings.get(MODULE_ID, key);
}
