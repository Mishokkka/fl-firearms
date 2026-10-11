import assert from "node:assert/strict";

const hooks = new Map();
const settings = new Map();
const documents = new Map();
const messages = [];
let id = 0;
let rolled = 0;
const getProperty = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
function setProperty(object, path, value) {
    const keys = path.split(".");
    for (const key of keys.slice(0, -1)) object = object[key] ??= {};
    object[keys.at(-1)] = value;
}
function merge(target, source) {
    for (const [key, value] of Object.entries(source)) {
        if (value && typeof value === "object" && !Array.isArray(value)) merge(target[key] ??= {}, value);
        else target[key] = value;
    }
    return target;
}
globalThis.Hooks = {
    on(name, fn) { const list = hooks.get(name) ?? []; list.push(fn); hooks.set(name, list); },
    call() { return true; }, callAll() {}
};
globalThis.foundry = {
    utils: { getProperty, setProperty, mergeObject: merge, randomID: () => `id${++id}` },
    applications: { api: { ApplicationV2: class { constructor(options) { this.options = options; } }, HandlebarsApplicationMixin: Base => Base } }
};
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.fromUuidSync = uuid => documents.get(uuid);
globalThis.fromUuid = async uuid => documents.get(uuid);
globalThis.renderTemplate = async (_path, data) => JSON.stringify(data);
globalThis.Roll = class {
    constructor(formula) { this.formula = formula; }
    async evaluate() {
        rolled++;
        this.total = this.formula.includes("d") ? 1 : Number(this.formula);
        this.terms = [{ results: [{ result: 1 }] }];
        return this;
    }
};
globalThis.AudioHelper = { async play() {} };
const users = [{ id: "gm", isGM: true, active: true }, { id: "player", isGM: false, active: true }];
globalThis.game = {
    user: users[0], users: { contents: users },
    settings: { get: (_scope, key) => settings.get(key), async set(_scope, key, value) { settings.set(key, value); } },
    actors: { get: key => documents.get(`Actor.${key}`), contents: [] }, items: { contents: [] },
    playlists: { getName() { return null; } }, tables: { getName() { return null; } }, scenes: { contents: [] }
};
class Message {
    constructor(data) { Object.assign(this, data); this.id = `m${++id}`; this.author = { id: game.user.id }; this.rolls ??= []; this.flags ??= {}; }
    getFlag(scope, key) { return this.flags[scope]?.[key]; }
    updateSource(update) { merge(this, update); }
    async setFlag(scope, key, value) { this.flags[scope] ??= {}; this.flags[scope][key] = value; }
}
globalThis.ChatMessage = {
    getSpeaker: ({ actor } = {}) => ({ actor: actor?.id, token: actor?.token?.id, scene: actor?.token?.parent.id }),
    getSpeakerActor: speaker => speaker.token ? game.scenes.get(speaker.scene).tokens.get(speaker.token).actor : game.actors.get(speaker.actor),
    applyRollMode(data, mode) { Object.assign(data, { whisper: mode === "publicroll" ? [] : ["gm"], blind: mode === "blindroll" }); },
    async create(data) {
        const message = new Message(data);
        for (const hook of hooks.get("preCreateChatMessage") ?? []) hook(message, data, {}, game.user.id);
        messages.push(message);
        for (const hook of hooks.get("createChatMessage") ?? []) hook(message, {}, game.user.id);
        return message;
    }
};
const { SETTINGS } = await import("../scripts/settings.js");
const { MODULE_ID: M, DATA_SCHEMA_VERSION } = await import("../scripts/constants.js");
const { DocumentActionQueue, documentActions } = await import("../scripts/action-queue.js");
const magazine = await import("../scripts/magazine.js");
const context = await import("../scripts/roll-context.js");
const { patchRollDialog } = await import("../scripts/roll-dialog.js");
const { runMigrations, normalizeFirearmItemData } = await import("../scripts/migrations.js");
const { getFirearmTooltipData } = await import("../scripts/api.js");
const { drawMishapTableForItem } = await import("../scripts/utils.js");
const { patchConsumableLabels } = await import("../scripts/actor-sheet.js");
const { runPrimaryFirearmChecks } = await import("../scripts/kamora.js");
const { checkFirearmMishap } = await import("../scripts/mishap.js");
const { FirearmConfigApp } = await import("../scripts/apps/firearm-config-app.js");
settings.set(SETTINGS.DEFAULT_MAGAZINE_STATE, "empty");
settings.set(SETTINGS.MAGAZINE_LOAD_RESOURCE_MODE, "perAction");
settings.set(SETTINGS.AUTO_SPEND_AMMO, true);
settings.set(SETTINGS.BLOCK_EMPTY_MAGAZINE_ATTACK, true);
settings.set(SETTINGS.AMMO_SPEND_FEEDBACK, "silent");
settings.set(SETTINGS.ENABLE_PRIMARY_MISHAP, false);
settings.set(SETTINGS.REGULAR_MISHAP_TABLE, "mishaps");
settings.set("rollMode", "publicroll");
context.initRollContextHooks();

function fixture(actorId = `a${++id}`, token = null) {
    const actor = {
        id: actorId, uuid: token ? `Scene.s.Token.${token}.Actor.${actorId}` : `Actor.${actorId}`, token: token ? { id: token, parent: { id: "s" } } : null,
        name: "Hero", documentName: "Actor", system: { consumable: { arrows: { value: 4 } } },
        async update(updates) { await new Promise(resolve => setImmediate(resolve)); for (const [path, value] of Object.entries(updates)) setProperty(this, path, value); return this; }
    };
    const items = new Map();
    Object.defineProperty(items, "contents", { get: () => [...items.values()] });
    actor.items = items;
    actor.updateEmbeddedDocuments = async (_type, updates) => Promise.all(updates.map(update => items.get(update._id).update(update)));
    const add = (itemId = "gun") => {
        const item = {
            id: itemId, uuid: `${actor.uuid}.Item.${itemId}`, actor, parent: actor, documentName: "Item", name: "Pistol", isOwner: true,
            type: "weapon", system: { category: "ranged", ammo: "arrows" },
            flags: { [M]: { isFirearm: true, reloadType: "MAG", magCapacity: 6, magCurrent: 0, feat_TopOff: true } },
            getFlag(scope, key) { return this.flags[scope]?.[key]; }, testUserPermission() { return true; },
            async setFlag(scope, key, value) { return this.update({ [`flags.${scope}.${key}`]: value }); },
            async update(updates) {
                await new Promise(resolve => setImmediate(resolve));
                if (this.failUpdate) throw new Error("write failed");
                for (const [path, value] of Object.entries(updates)) {
                    if (path === "_id") continue;
                    if (path.includes(".-=")) delete this.flags[M][path.split(".-=")[1]];
                    else setProperty(this, path, value);
                }
                return this;
            }
        };
        items.set(item.id, item); documents.set(item.uuid, item); return item;
    };
    documents.set(actor.uuid, actor);
    return { actor, item: add(), add };
}

// Only consumable buttons are renamed, regardless of text elsewhere.
settings.set(SETTINGS.RENAME_CONSUMABLES_MODE, "all");
const labels = { arrows: { textContent: "Arrows" }, torches: { textContent: "Torches" } };
const biography = { textContent: "Arrowsmith carries Torches" };
patchConsumableLabels({ items: [] }, { querySelectorAll: selector => [labels[selector.includes("arrows") ? "arrows" : "torches"]] });
assert.equal(labels.arrows.textContent, "Bullets"); assert.equal(labels.torches.textContent, "Lamp Oil"); assert.equal(biography.textContent, "Arrowsmith carries Torches");

// Same actor, separate weapons: reloads must share a resource queue.
const f = fixture();
const second = f.add("gun2");
await Promise.all([magazine.loadFullMagazine(f.actor, f.item), magazine.loadFullMagazine(f.actor, second)]);
assert.equal(f.actor.system.consumable.arrows.value, 2);
assert.equal(f.item.getFlag(M, "magCurrent"), 6);
assert.equal(second.getFlag(M, "magCurrent"), 6);
f.item.flags[M].magCurrent = 0;
const beforeRolls = rolled;
await Promise.all([magazine.loadFullMagazine(f.actor, f.item), magazine.loadFullMagazine(f.actor, f.item)]);
assert.equal(rolled - beforeRolls, 1, "second full load must re-read current state");
f.item.flags[M].magCurrent = 0; f.actor.system.consumable.arrows.value = 4;
await Promise.all([magazine.topOffMagazine(f.actor, f.item), magazine.topOffMagazine(f.actor, f.item)]);
assert.equal(f.item.getFlag(M, "magCurrent"), 2);
assert.equal(f.actor.system.consumable.arrows.value, 2);
await assert.rejects(magazine.loadFullMagazine(fixture().actor, f.item));
await assert.rejects(magazine.spendMagazineAmmo(f.item, 1.5));
assert.equal((await magazine.spendMagazineAmmo(f.item, 0)).spent, 0);
f.item.failUpdate = true;
await assert.rejects(magazine.topOffMagazine(f.actor, f.item));
assert.equal(f.actor.system.consumable.arrows.value, 2, "failed item write must restore resource");
f.item.failUpdate = false;
await magazine.topOffMagazine(f.actor, f.item);
assert.equal(f.item.getFlag(M, "magCurrent"), 3, "failed operation must release queue");

// Separate coordinator instances emulate GM/player clients. Duplicate packets
// are delivered while the first request is still running, like real sockets.
const listeners = [];
let dropResponses = false;
let packets = 0;
const bus = {
    on(_channel, fn) { listeners.push(fn); },
    emit(_channel, packet) {
        packets++;
        if (dropResponses && packet.kind === "response") return;
        for (const listener of listeners) {
            queueMicrotask(() => listener(structuredClone(packet)));
            if (packet.kind === "request") queueMicrotask(() => listener(structuredClone(packet)));
        }
    }
};
const gmGame = { user: users[0], users: { contents: users }, socket: bus };
const playerGame = { user: users[1], users: { contents: users }, socket: bus };
const gm = new DocumentActionQueue({ getGame: () => gmGame, resolve: uuid => documents.get(uuid) });
const player = new DocumentActionQueue({ getGame: () => playerGame, resolve: uuid => documents.get(uuid) });
for (const [key, handler] of documentActions.handlers) gm.register(key, handler);
gm.init(); player.init();
f.item.flags[M].magCurrent = 2;
// Player replica has its own stale flags; only the elected executor reads them.
const replica = { ...f.item, flags: structuredClone(f.item.flags) };
const shots = await Promise.all([player.run(replica, "spend", { amount: 1 }), gm.run(f.item, "spend", { amount: 1 })]);
assert.equal(shots.reduce((sum, result) => sum + result.spent, 0), 2);
assert.equal(f.item.getFlag(M, "magCurrent"), 0);
assert.equal(replica.getFlag(M, "magCurrent"), 2, "test clients must not share a live Item object");
f.item.flags[M].magCurrent = 1;
const finalShots = await Promise.all([player.run(replica, "spend", { amount: 1 }), gm.run(f.item, "spend", { amount: 1 })]);
assert.equal(finalShots.filter(result => result.spent === 1).length, 1, "last cartridge can be spent once");
const originalTimeout = globalThis.setTimeout;
dropResponses = true;
f.item.flags[M].magCurrent = 3;
globalThis.setTimeout = (fn, delay, ...args) => originalTimeout(fn, delay === 30000 ? 20 : delay, ...args);
await assert.rejects(player.run(replica, "spend", { amount: 1 }), /Нет ответа/);
globalThis.setTimeout = originalTimeout;
assert.equal(f.item.getFlag(M, "magCurrent"), 2, "timeout must not run a local fallback");
dropResponses = false;
users[0].active = false;
player.register("spend", gm.handlers.get("spend"));
await player.run(f.item, "spend", { amount: 1 });
assert.equal(f.item.getFlag(M, "magCurrent"), 1, "owner can play without an active GM");
users[0].active = true;
assert.ok(packets > 0);

// Dialog carries exact context even after long thought, without stealing a
// consumable roll; duplicate submission and actions/parries are harmless.
function dialog(actor, item) {
    return {
        getRollOptions() { return { actorId: actor.id, tokenId: actor.token?.id, sceneId: actor.token?.parent.id, itemId: item.id, isAttack: true }; },
        handleRollArrows() { this.nativeArrows = (this.nativeArrows ?? 0) + 1; },
        async executeRoll() { this.executed = (this.executed ?? 0) + 1; const roll = { options: this.getRollOptions(), pushed: false }; return { roll, message: await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls: [roll] }) }; }
    };
}
f.item.flags[M].magCurrent = 1;
const app = dialog(f.actor, f.item);
patchRollDialog(app);
app.handleRollArrows();
assert.equal(app.nativeArrows, undefined, "MAG must not roll native arrows again");
const unrelated = await ChatMessage.create({ speaker: { actor: f.actor.id }, rolls: [{ options: { consumable: "arrows" } }] });
assert.equal(unrelated.getFlag(M, "isFirearmAttack"), undefined);
const realNow = Date.now;
Date.now = () => realNow() + 120000;
const shot = await app.executeRoll();
Date.now = realNow;
assert.equal(shot.message.getFlag(M, "isFirearmAttack"), true);
assert.equal(shot.message.getFlag(M, "ammoHandled"), true);
assert.equal(f.item.getFlag(M, "magCurrent"), 0);
await magazine.handleCreatedChatMessageForAmmoSpend(shot.message, {}, "gm");
assert.equal(f.item.getFlag(M, "magCurrent"), 0, "create hook must not charge again");
assert.equal(await dialogDryFire(f), null);
async function dialogDryFire(fixture) { const empty = dialog(fixture.actor, fixture.item); patchRollDialog(empty); return empty.executeRoll(); }
f.item.flags[M].magCurrent = 1;
const appA = dialog(f.actor, f.item), appB = dialog(f.actor, f.item);
patchRollDialog(appA); patchRollDialog(appB);
const attacks = await Promise.all([appA.executeRoll(), appB.executeRoll()]);
assert.equal(attacks.filter(Boolean).length, 1, "second dialog must stop at submission when last round has gone");
f.item.flags[M].magCurrent = 2;
const failed = dialog(f.actor, f.item);
failed.executeRoll = async () => { throw new Error("evaluation failed"); };
patchRollDialog(failed);
await assert.rejects(failed.executeRoll());
assert.equal(f.item.getFlag(M, "magCurrent"), 2, "failed roll must refund through the same queue");
const createdThenFailed = dialog(f.actor, f.item);
const realExecute = createdThenFailed.executeRoll;
createdThenFailed.executeRoll = async function () { await realExecute.call(this); throw new Error("late failure"); };
patchRollDialog(createdThenFailed);
await assert.rejects(createdThenFailed.executeRoll());
assert.equal(f.item.getFlag(M, "magCurrent"), 1, "confirmed ChatMessage must not refund a completed shot");
const parry = dialog(f.actor, f.item);
parry.getRollOptions = () => ({ actorId: f.actor.id, itemId: f.item.id, isAttack: false });
patchRollDialog(parry); parry.handleRollArrows();
await parry.executeRoll();
assert.equal(parry.nativeArrows, 1);
const tokenA = fixture("npc", "t1"), tokenB = fixture("npc", "t2");
game.scenes.get = () => ({ tokens: new Map([["t1", { actor: tokenA.actor }], ["t2", { actor: tokenB.actor }]]) });
tokenA.item.flags[M].magCurrent = tokenB.item.flags[M].magCurrent = 2;
const tokenDialog = dialog(tokenA.actor, tokenA.item);
patchRollDialog(tokenDialog);
assert.equal((await tokenDialog.executeRoll()).message.getFlag(M, "itemUuid"), tokenA.item.uuid);
assert.equal(tokenB.item.getFlag(M, "magCurrent"), 2);

// Migrations retain the old version on failed documents, then retry successfully.
const migration = fixture();
migration.item.flags[M].feat_kamora = true;
migration.item.failUpdate = true;
game.actors.contents = [migration.actor];
settings.set(SETTINGS.DATA_VERSION, 0);
await runMigrations();
assert.equal(settings.get(SETTINGS.DATA_VERSION), 0);
migration.item.failUpdate = false;
await runMigrations();
assert.equal(settings.get(SETTINGS.DATA_VERSION), DATA_SCHEMA_VERSION);
migration.item.isOwner = false;
assert.equal(await normalizeFirearmItemData(migration.item), false);
migration.item.isOwner = true;
delete migration.item.flags[M].magCurrent;
assert.equal(getFirearmTooltipData(migration.item).magCurrent, 0);

// Fixed numbered mishaps ignore drawn flags, await delay, and preserve source
// privacy. Push checks use roll data, independent of translated HTML.
const source = new Message({ speaker: { actor: f.actor.id }, whisper: ["gm"], blind: true });
let tableMessages = 0;
const result = { range: [1, 6], drawn: true, type: "text" };
const table = { results: [result], async toMessage(results, options) {
    tableMessages++; assert.equal(results[0], result); assert.deepEqual(options.messageData.whisper, ["gm"]); assert.equal(options.messageData.blind, true); assert.equal(options.messageOptions.rollMode, "blindroll");
} };
game.tables.getName = () => table;
let settled = false;
const drawing = drawMishapTableForItem(f.item, 20, source).then(() => { settled = true; });
await Promise.resolve(); assert.equal(settled, false); await drawing;
const push = new Message({ ...source, id: undefined, content: "Forzada", rolls: [{ pushed: 1, successCount: 0 }], flags: { [M]: { isFirearmAttack: true, isPushRoll: true, itemUuid: f.item.uuid } } });
await checkFirearmMishap(push);
assert.equal(push.getFlag(M, "mishapRolled"), true);
const count = tableMessages;
await checkFirearmMishap(push); assert.equal(tableMessages, count);
const brokenPush = new Message({ ...push, flags: { [M]: { ...push.flags[M], mishapRolled: false } } });
game.tables.getName = () => null;
await assert.rejects(checkFirearmMishap(brokenPush));
assert.equal(brokenPush.getFlag(M, "mishapRolled"), false);
game.tables.getName = () => table;
await checkFirearmMishap(brokenPush);
assert.equal(brokenPush.getFlag(M, "mishapRolled"), true);

settings.set(SETTINGS.ENABLE_PRIMARY_MISHAP, true);
f.item.flags[M].feat_Reliable = true;
const previousMessages = messages.length;
await runPrimaryFirearmChecks(f.actor, f.item, source);
assert.ok(messages.length > previousMessages);
for (const card of messages.slice(previousMessages)) { assert.deepEqual(card.whisper, ["gm"]); assert.equal(card.blind, true); }
settings.set(SETTINGS.ENABLE_PRIMARY_MISHAP, false);

// Config actions change drafts without committing or rerendering unrelated fields.
const config = new FirearmConfigApp(f.item);
const otherConfig = new FirearmConfigApp(fixture().item);
assert.notEqual(config.options.id, otherConfig.options.id);
const fields = { magCapacity: { value: "9" }, magCurrent: { value: "2" }, reloadValue: { value: "draft" } };
config.element = { querySelector: selector => fields[selector.match(/name=(\w+)/)?.[1]] };
const oldAmmo = f.item.getFlag(M, "magCurrent");
await FirearmConfigApp.fillMagazine.call(config);
assert.equal(fields.magCurrent.value, "9"); assert.equal(fields.reloadValue.value, "draft"); assert.equal(f.item.getFlag(M, "magCurrent"), oldAmmo);
await FirearmConfigApp.emptyMagazine.call(config); assert.equal(fields.magCurrent.value, "0");

console.log("FL Firearms reliability tests: OK (queues, sockets, dialogs, tokens, migration recovery, privacy, Push, drafts)");
