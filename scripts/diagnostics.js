import { MODULE_ID, TOOLTIP_JOURNAL_NAME } from "./constants.js";
import { getSetting, SETTINGS } from "./settings.js";
import { isFirearm, isRangedWeapon } from "./firearm-data.js";
import { getRollAdapterStatus } from "./patch-actor-sheet.js";
import { getPendingRollContextCount } from "./roll-context.js";

export function runDiagnostics() {
    const checks = [];
    const add = (id, label, ok, detail, severity = "error") => checks.push({ id, label, ok, detail, severity, status: ok ? "ok" : severity, icon: ok ? "fa-circle-check" : (severity === "warning" ? "fa-triangle-exclamation" : "fa-circle-xmark") });

    const system = game.system;
    add("system", "Система Forbidden Lands", system?.id === "forbidden-lands", `${system?.title ?? system?.id ?? "не найдена"} ${system?.version ?? ""}`);

    const adapter = getRollAdapterStatus();
    add("adapter", "Перехват бросков оружия", adapter.patchedMethods > 0, `Классов: ${adapter.patchedClasses}; методов: ${adapter.patchedMethods}`);

    const regularTableName = getSetting(SETTINGS.REGULAR_MISHAP_TABLE);
    const artifactTableName = getSetting(SETTINGS.ARTIFACT_MISHAP_TABLE);
    add("regularTable", "Обычная таблица осечки", !!game.tables.getName(regularTableName), regularTableName);
    add("artifactTable", "Артефактная таблица осечки", !!game.tables.getName(artifactTableName), artifactTableName);

    const journal = game.journal.getName(TOOLTIP_JOURNAL_NAME);
    add("journal", "Журнал справки", !!journal, journal?.name ?? TOOLTIP_JOURNAL_NAME, "warning");

    const playlistName = String(getSetting(SETTINGS.CRIT_BAD_PLAYLIST) ?? "").trim();
    const playlist = game.playlists.getName(playlistName);
    add("playlist", "Плейлист осечки", !!playlist, playlist ? `${playlist.name}: ${playlist.sounds?.size ?? playlist.sounds?.contents?.length ?? 0} звуков` : playlistName, "warning");

    const itemDiagnostics = collectItemDiagnostics();
    const stale = itemDiagnostics.stale;
    add("stale", "Устаревшие флаги на не-дальнобойном оружии", stale.length === 0, stale.length ? `${stale.length}: ${stale.slice(0, 5).map(item => item.name).join(", ")}` : "Не найдены", "warning");

    const firearmCount = itemDiagnostics.firearmCount;
    const magazineCount = itemDiagnostics.magazineCount;
    const duplicates = itemDiagnostics.duplicates;
    add("duplicates", "Дубли имен многозарядного оружия", duplicates.length === 0, duplicates.length ? duplicates.slice(0, 5).join("; ") : "Не найдены", "warning");

    return {
        checks,
        summary: {
            errors: checks.filter(check => !check.ok && check.severity === "error").length,
            warnings: checks.filter(check => !check.ok && check.severity === "warning").length,
            firearms: firearmCount,
            magazines: magazineCount,
            pendingContexts: getPendingRollContextCount()
        },
        generatedAt: new Date().toLocaleString()
    };
}

export function notifySetupProblemsOnce() {
    if (!game.user?.isGM || !getSetting(SETTINGS.WARN_SETUP_PROBLEMS)) return;
    const report = runDiagnostics();
    const problems = report.summary.errors + report.summary.warnings;
    if (!problems) return;
    ui.notifications.warn(`FL Firearms: диагностика обнаружила проблем: ${problems}. Откройте настройки модуля → Диагностика.`);
}

function collectItemDiagnostics() {
    const stale = [];
    const duplicates = [];
    let firearmCount = 0;
    let magazineCount = 0;

    const inspectItem = item => {
        const firearm = isFirearm(item);
        if (item.getFlag?.(MODULE_ID, "isFirearm") && !isRangedWeapon(item)) stale.push(item);
        if (!firearm) return false;
        firearmCount += 1;
        if (item.getFlag(MODULE_ID, "reloadType") === "MAG") {
            magazineCount += 1;
            return true;
        }
        return false;
    };

    for (const item of game.items?.contents ?? []) inspectItem(item);

    for (const actor of game.actors?.contents ?? []) {
        const counts = new Map();
        for (const item of actor.items?.contents ?? []) {
            const isMagazine = inspectItem(item);
            if (!isMagazine) continue;
            const key = String(item.name ?? "").trim().toLocaleLowerCase("ru");
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        for (const [name, count] of counts) {
            if (count > 1) duplicates.push(`${actor.name}: ${name} ×${count}`);
        }
    }

    return { stale, duplicates, firearmCount, magazineCount };
}
