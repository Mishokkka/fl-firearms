import { MODULE_ID } from "./constants.js";
import { isFirearm } from "./firearm-data.js";
import { buildRollContext, takePendingRollContext, wasRollMessageCreated } from "./roll-context.js";
import { createEmptyMagazineNotice, getMagazineCapacity, getMagazineCurrent, isMagazineWeapon, spendMagazineAmmo, refundMagazineAmmo } from "./magazine.js";
import { SETTINGS, getSetting } from "./settings.js";

const PATCHED_DIALOGS = new WeakSet();

export function initRollDialogHooks() {
    Hooks.on("renderApplication", patchRollDialog);
}

// Forbidden Lands 13.0.5 exposes these instance methods even though the class
// is bundled privately. This also covers game.fbl.roll and Quick Access dialogs.
export function patchRollDialog(app) {
    if (PATCHED_DIALOGS.has(app) || typeof app.executeRoll !== "function" || typeof app.getRollOptions !== "function" || typeof app.handleRollArrows !== "function") return;
    PATCHED_DIALOGS.add(app);
    const getOptions = app.getRollOptions;
    const execute = app.executeRoll;
    const arrows = app.handleRollArrows;
    const initial = resolveAttack(getOptions.call(app));
    let context = initial ? takePendingRollContext(initial.actor, initial.item) : null;
    let executing = false;

    app.getRollOptions = function (...args) {
        const options = getOptions.apply(this, args);
        if (context && executing) options.flFirearmsContext = { ...context };
        return options;
    };
    app.handleRollArrows = function (...args) {
        const attack = resolveAttack(getOptions.call(this));
        // MAG already spends the arrows resource when loading the magazine.
        if (attack && isMagazineWeapon(attack.item)) return;
        return arrows.apply(this, args);
    };
    app.executeRoll = async function (...args) {
        if (executing) return null;
        const attack = resolveAttack(getOptions.call(this));
        if (!attack) return execute.apply(this, args);
        const { actor, item } = attack;
        if (!context || context.itemUuid !== item.uuid) {
            context = buildRollContext(actor, item);
            if (Hooks.call(`${MODULE_ID}.preAttack`, actor, item, context) === false) return null;
        }
        executing = true;
        let spent = 0;
        try {
            const magazine = isMagazineWeapon(item);
            const capacity = magazine ? getMagazineCapacity(item) : 0;
            context.magazineWeapon = magazine;
            context.magazineCapacity = capacity;
            context.magazineBeforeShot = magazine ? getMagazineCurrent(item) : null;
            context.ammoCost ??= 1;
            context.emptyMagazineAttack = magazine && capacity > 0 && context.magazineBeforeShot <= 0;
            if (magazine && capacity > 0 && getSetting(SETTINGS.AUTO_SPEND_AMMO)) {
                const ammo = await spendMagazineAmmo(item, context.ammoCost, { reason: "shot" });
                spent = ammo.spent;
                context.magazineBeforeShot = ammo.oldAmmo;
                context.magazineAfterShot = ammo.newAmmo;
                context.ammoHandled = true;
                context.emptyMagazineAttack = ammo.oldAmmo <= 0;
            }
            if (context.emptyMagazineAttack && getSetting(SETTINGS.BLOCK_EMPTY_MAGAZINE_ATTACK)) {
                await createEmptyMagazineNotice(actor, item, { source: "submit" });
                Hooks.callAll(`${MODULE_ID}.dryFire`, actor, item, context);
                return null;
            }
            return await execute.apply(this, args);
        } catch (error) {
            if (spent && !wasRollMessageCreated(context.nonce)) {
                try { await refundMagazineAmmo(item, spent); }
                catch (refundError) { ui.notifications.error(`FL Firearms: не удалось вернуть патрон после ошибки: ${refundError.message}`); }
            }
            throw error;
        } finally {
            executing = false;
        }
    };
}

function resolveAttack(options) {
    if (options?.isAttack !== true) return null;
    const actor = options.tokenId && options.sceneId
        ? game.scenes?.get(options.sceneId)?.tokens?.get(options.tokenId)?.actor
        : game.actors?.get(options.actorId);
    const ids = Array.isArray(options.itemId) ? options.itemId : [options.itemId];
    if (ids.length !== 1) return null;
    const item = actor?.items?.get(ids[0]);
    return isFirearm(item) ? { actor, item } : null;
}
