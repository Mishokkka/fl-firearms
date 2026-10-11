import { MODULE_ID } from "./constants.js";
import { initItemSheetHooks } from "./item-sheet.js";
import { initRollContextHooks } from "./roll-context.js";
import { initActorSheetPatches } from "./patch-actor-sheet.js";
import { initKamoraHooks } from "./kamora.js";
import { initMishapHooks } from "./mishap.js";
import { initPublicApi } from "./api.js";
import { initMagazineHooks } from "./magazine.js";
import { initSettings } from "./settings.js";
import { initDataCleanupHooks, runMigrations } from "./migrations.js";
import { initSheetPatcherHooks } from "./sheet-patcher.js";
import { FirearmDiagnosticsApp } from "./apps/diagnostics-app.js";
import { notifySetupProblemsOnce } from "./diagnostics.js";
import { log } from "./logger.js";
import { initTooltipCacheHooks } from "./utils.js";

Hooks.once("init", () => {
    initSettings(FirearmDiagnosticsApp);
    initDataCleanupHooks();
    log("init");
});

Hooks.once("ready", async () => {
    initActorSheetPatches();
    await runMigrations();
    initPublicApi();
    notifySetupProblemsOnce();
    log("ready");
});

initItemSheetHooks();
initMagazineHooks();
initRollContextHooks();
initKamoraHooks();
initMishapHooks();
initSheetPatcherHooks();
initTooltipCacheHooks();
