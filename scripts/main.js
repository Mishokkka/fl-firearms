import { MODULE_ID } from "./constants.js";
import { initItemSheetHooks } from "./item-sheet.js";
import { initRollContextHooks } from "./roll-context.js";
import { documentActions } from "./action-queue.js";
import { initRollDialogHooks } from "./roll-dialog.js";
import { initActorSheetPatches } from "./patch-actor-sheet.js";
import { initMishapHooks } from "./mishap.js";
import { initPublicApi } from "./api.js";
import { initMagazineHooks } from "./magazine.js";
import { initSettings } from "./settings.js";
import { initDataCleanupHooks, runMigrations } from "./migrations.js";
import { initSheetPatcherHooks } from "./sheet-patcher.js";
import { FirearmDiagnosticsApp } from "./apps/diagnostics-app.js";
import { notifySetupProblemsOnce } from "./diagnostics.js";
import { log, warn } from "./logger.js";
import { initTooltipCacheHooks } from "./utils.js";

Hooks.once("init", () => {
    initSettings(FirearmDiagnosticsApp);
    initDataCleanupHooks();
    log("init");
});

Hooks.once("ready", async () => {
    initActorSheetPatches();
    documentActions.init();
    initPublicApi();
    try { await runMigrations(); }
    catch (error) { warn("startup migration failed", error); ui.notifications.warn("FL Firearms: миграция не завершена. Подробности в консоли."); }
    notifySetupProblemsOnce();
    log("ready");
});

initRollDialogHooks();
initItemSheetHooks();
initMagazineHooks();
initRollContextHooks();
initMishapHooks();
initSheetPatcherHooks();
initTooltipCacheHooks();
