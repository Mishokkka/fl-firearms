import { MODULE_ID } from "../constants.js";
import { runDiagnostics } from "../diagnostics.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class FirearmDiagnosticsApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: `${MODULE_ID}-diagnostics`,
        classes: ["flf-app", "flf-diagnostics"],
        tag: "section",
        position: { width: 620, height: 620 },
        window: { title: "FL Firearms: диагностика", icon: "fa-solid fa-stethoscope", resizable: true },
        actions: { refresh: FirearmDiagnosticsApp.refresh }
    };

    static PARTS = {
        main: { template: `modules/${MODULE_ID}/templates/apps/diagnostics.hbs`, scrollable: [".flf-diagnostics__checks"] }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        return { ...context, report: runDiagnostics() };
    }

    static refresh(_event, _target) {
        return this.render({ force: true });
    }
}
