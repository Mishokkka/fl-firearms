import { error } from "./logger.js";
import { patchConsumableLabels } from "./actor-sheet.js";
import { patchMagazineControlsForActor } from "./magazine.js";

const ROOT_STATES = new WeakMap();
const APP_ROOTS = new WeakMap();

export function initSheetPatcherHooks() {
    Hooks.on("renderActorSheet", handleRenderedActorSheet);
    Hooks.on("renderApplication", handleRenderedApplication);
    Hooks.on("closeApplication", handleClosedApplication);
}

function handleRenderedActorSheet(app, html, data) {
    // Специализированный хук гарантирует, что перед нами именно лист Actor.
    // Здесь допустим legacy-fallback через app.actor.
    scheduleActorSheetPatch(app, html, { allowActorProperty: true });
    void data;
}

function handleRenderedApplication(app, html, data) {
    // renderApplication вызывается и для Item Sheet. У листа встроенного Item
    // также может быть app.actor, указывающий на владельца предмета. Использовать
    // это поле здесь нельзя: иначе модуль пытается искать строки оружия внутри
    // окна предмета и выдаёт ложное предупреждение при выборе MAG.
    const actor = getActorFromApp(app, { allowActorProperty: false });
    if (!actor) return;

    scheduleActorSheetPatch(app, html, { allowActorProperty: false });
    void data;
}

function handleClosedApplication(app) {
    const root = APP_ROOTS.get(app);
    if (!root) return;
    cleanupRoot(root);
    APP_ROOTS.delete(app);
}

function scheduleActorSheetPatch(app, html, { allowActorProperty = false } = {}) {
    const actor = getActorFromApp(app, { allowActorProperty });
    if (!actor) return;

    const root = getRoot(app, html);
    if (!root) return;

    const previousRoot = APP_ROOTS.get(app);
    if (previousRoot && previousRoot !== root) cleanupRoot(previousRoot);
    APP_ROOTS.set(app, root);

    let state = ROOT_STATES.get(root);
    if (!state) {
        state = {
            actor,
            app,
            scheduled: false,
            observer: null
        };
        ROOT_STATES.set(root, state);
    } else {
        state.actor = actor;
        state.app = app;
    }

    installObserver(root, state);
    schedulePatch(root, state);
}

function schedulePatch(root, state) {
    // Legacy ActorSheet вызывает renderActorSheet и renderApplication в одном
    // render-проходе. Оба сигнала сводятся к одной микрозадаче без задержки UI.
    if (state.scheduled) return;
    state.scheduled = true;

    queueMicrotask(() => {
        state.scheduled = false;

        if (root.isConnected === false) {
            cleanupRoot(root);
            return;
        }

        applySheetPatches(state.actor, root);

        // Если Observer уже видел системный full render или собственные вставки
        // магазина, они теперь обработаны этим patch cycle. Удаляем накопленные
        // records, чтобы не запускать второй проход за тем же DOM-изменением.
        state.observer?.takeRecords?.();
    });
}

function applySheetPatches(actor, root) {
    if (!root?.querySelector) return;

    try {
        patchConsumableLabels(actor, root);
        patchMagazineControlsForActor(actor, root);
    } catch (err) {
        error("actor sheet patch failed", err);
    }
}

function installObserver(root, state) {
    if (state.observer) return;

    const observer = new MutationObserver(mutations => {
        // Собственные вставки/удаления магазина не должны запускать второй
        // полный проход по листу. Любое стороннее изменение по-прежнему
        // обрабатывается, поэтому частичные render системы остаются совместимы.
        if (!mutations.some(mutationNeedsPatch)) return;
        schedulePatch(root, state);
    });

    observer.observe(root, {
        childList: true,
        subtree: true
    });

    state.observer = observer;
}

function mutationNeedsPatch(mutation) {
    const nodes = [...(mutation.addedNodes ?? []), ...(mutation.removedNodes ?? [])];
    if (!nodes.length) return false;
    return nodes.some(node => !isModuleMagazineNode(node));
}

function isModuleMagazineNode(node) {
    if (!node) return false;

    if (node.nodeType === 1) {
        return node.matches?.(".fl-mag-counter, .fl-mag-actions")
            || !!node.closest?.(".fl-mag-counter, .fl-mag-actions");
    }

    if (node.nodeType === 3) {
        return !!node.parentElement?.closest?.(".fl-mag-counter, .fl-mag-actions");
    }

    return false;
}

function cleanupRoot(root) {
    const state = ROOT_STATES.get(root);
    if (!state) return;

    state.observer?.disconnect();
    state.observer = null;
    state.scheduled = false;
    ROOT_STATES.delete(root);
}

function getActorFromApp(app, { allowActorProperty = false } = {}) {
    // Для общего renderApplication источником истины служит документ самого
    // приложения. app.actor у Item Sheet означает владельца Item, а не тип окна.
    const primaryDocument = app?.document ?? app?.object ?? null;
    if (primaryDocument?.documentName === "Actor") return primaryDocument;

    if (allowActorProperty && app?.actor?.documentName === "Actor") {
        return app.actor;
    }

    return null;
}

function getRoot(app, html) {
    if (html instanceof HTMLElement) return html;
    if (html?.[0] instanceof HTMLElement) return html[0];

    if (app?.element instanceof HTMLElement) return app.element;
    if (app?.element?.[0] instanceof HTMLElement) return app.element[0];

    return null;
}
