# FL Firearms

Модуль огнестрельного оружия 18–19 века для Foundry VTT 13.351 и Forbidden Lands 13.0.5.

## Возможности

- обычный и артефактный огнестрел;
- Камора `d12`, Капризная Камора `d6`;
- обычная скрытая осечка `d20`, Капризное `d10`;
- осечка после проваленного Push;
- модификаторы таблицы: Надежное, Утолщенное, Истонченное, Рисковое;
- магазин, полный заряд и Дозарядка;
- блокировка атаки с пустым магазином;
- ApplicationV2-диагностика мира;
- публичный API и hooks для других модулей.

## Установка

Скопировать каталог `fl-firearms` в `Data/modules/`, перезапустить Foundry и включить модуль в мире Forbidden Lands.

## Обязательные мировые данные

По умолчанию модуль ищет:

- RollTable `Пороховая осечка`;
- RollTable `Пороховая осечка - особое`;
- JournalEntry `Rich Info Tooltips` с отдельными страницами, названными точно как свойства оружия;
- Playlist `CritBad`.

Имена можно изменить в настройках. Отсутствие журнала не ломает базовые свойства: для автоматизированных правил есть fallback-подсказки. Отсутствие таблицы блокирует только итоговый draw осечки.

После включения откройте:

`Configure Settings → Module Settings → FL Firearms: диагностика`.

## Настройка Item

Откройте дальнобойное оружие и включите `Огнестрел` в системной строке Features. Под основными характеристиками появится встроенная строка типа, перезарядки и БП, а ниже — чипы свойств.

## API

```js
const api = game.modules.get("fl-firearms").api;
```

Доступны:

```js
api.isFirearm(item);
api.getFirearmData(item);
api.getMisfireProfile(item);
api.getMagazineProfile(item);
api.getArmorPiercingProfile(item);
api.spendMagazineAmmo(item, 2, { reason: "rapid" });
api.loadMagazine(actor, item);
api.topOffMagazine(actor, item);
api.openFirearmConfig(item);
api.runDiagnostics();
```

## Hooks

```js
Hooks.on("fl-firearms.preAttack", (actor, item, context) => {});
Hooks.on("fl-firearms.attackFired", (actor, item, context) => {});
Hooks.on("fl-firearms.dryFire", (actor, item, context) => {});
Hooks.on("fl-firearms.misfire", (actor, item, result) => {});
Hooks.on("fl-firearms.magazineChanged", (actor, item, oldValue, newValue, context) => {});
```

Возврат `false` из `fl-firearms.preAttack` отменяет вызов системного roll-метода.

## Разработка

Запуск доменных тестов:

```bash
node --experimental-default-type=module tests/run-tests.mjs
```

Подробный аудит и roadmap находятся в `REVIEW-AND-IMPLEMENTATION-PLAN.md`.
