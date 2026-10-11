import { MODULE_ID } from "./constants.js";

const CHANNEL = `module.${MODULE_ID}`;
const REQUEST_TIMEOUT = 30000;

// One writer per actor serializes both its magazines and its shared resource.
// A timed-out request is never executed locally: its server update may have succeeded.
export class DocumentActionQueue {
    constructor({ getGame = () => game, resolve = uuid => globalThis.fromUuid ? fromUuid(uuid) : fromUuidSync(uuid) } = {}) {
        this.getGame = getGame;
        this.resolve = resolve;
        this.handlers = new Map();
        this.locks = new Map();
        this.requests = new Map();
        this.pending = new Map();
    }

    register(name, handler) { this.handlers.set(name, handler); }

    init() {
        this.getGame().socket?.on(CHANNEL, packet => { void this.receive(packet); });
    }

    authority(item) {
        const currentGame = this.getGame();
        const users = (currentGame.users?.contents ?? []).filter(user => user.active);
        const gms = users.filter(user => user.isGM);
        const owners = users.filter(user => item.testUserPermission?.(user, "OWNER"));
        return (gms.length ? gms : owners).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[0]?.id
            ?? currentGame.user.id;
    }

    async run(item, name, payload = {}) {
        if (!item?.isOwner) throw new Error("Нет прав на изменение оружия.");
        const currentGame = this.getGame();
        const packet = {
            version: 1, kind: "request", id: foundry.utils.randomID(),
            sender: currentGame.user.id, target: this.authority(item), itemUuid: item.uuid, name, payload
        };
        if (packet.target === currentGame.user.id) return this.unwrap(await this.execute(packet));
        if (!currentGame.socket) throw new Error("Соединение Foundry недоступно.");
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(packet.id);
                reject(new Error("Нет ответа на команду оружия. Проверьте состояние магазина перед повтором."));
            }, REQUEST_TIMEOUT);
            this.pending.set(packet.id, { resolve, reject, timer, target: packet.target });
            currentGame.socket.emit(CHANNEL, packet);
        });
    }

    unwrap(response) {
        if (!response.ok) throw new Error(response.error);
        return response.result;
    }

    async receive(packet) {
        const currentGame = this.getGame();
        if (packet?.version !== 1 || packet.target !== currentGame.user.id) return;
        if (packet.kind === "response") {
            const pending = this.pending.get(packet.id);
            if (!pending || pending.target !== packet.sender) return;
            clearTimeout(pending.timer);
            this.pending.delete(packet.id);
            if (packet.ok) pending.resolve(packet.result);
            else pending.reject(new Error(packet.error));
        } else if (packet.kind === "request") {
            const response = await this.execute(packet);
            currentGame.socket.emit(CHANNEL, {
                ...response, version: 1, kind: "response", id: packet.id,
                sender: currentGame.user.id, target: packet.sender
            });
        }
    }

    execute(packet) {
        const requestKey = `${packet.sender}:${packet.id}`;
        const cached = this.requests.get(requestKey);
        if (cached) return cached.promise;
        const entry = { completed: false, createdAt: Date.now() };
        entry.promise = (async () => {
            try {
                const item = await this.resolve(packet.itemUuid);
                if (!item?.isOwner || this.authority(item) !== this.getGame().user.id) {
                    throw new Error("Исполнитель команды изменился. Проверьте состояние оружия и повторите действие.");
                }
                const handler = this.handlers.get(packet.name);
                if (!handler) throw new Error("Неизвестная команда оружия. Проверьте версии модуля у участников.");
                const key = item.actor?.uuid ?? item.uuid;
                const previous = this.locks.get(key) ?? Promise.resolve();
                const operation = previous.catch(() => undefined).then(() => {
                    if (this.authority(item) !== this.getGame().user.id) throw new Error("Исполнитель команды изменился до выполнения.");
                    return handler(item, packet.payload);
                });
                this.locks.set(key, operation);
                try { return { ok: true, result: await operation }; }
                finally { if (this.locks.get(key) === operation) this.locks.delete(key); }
            } catch (error) {
                return { ok: false, error: error.message ?? String(error) };
            } finally {
                entry.completed = true;
            }
        })();
        this.requests.set(requestKey, entry);
        for (const [key, value] of this.requests) {
            if (value.completed && (Date.now() - value.createdAt > 300000 || this.requests.size > 1000)) this.requests.delete(key);
        }
        return entry.promise;
    }
}

export const documentActions = new DocumentActionQueue();
