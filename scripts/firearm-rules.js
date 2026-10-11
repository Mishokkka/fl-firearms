export function calculatePowderMishapResult(baseValue, modifiers = {}) {
    const baseResult = clampInteger(baseValue, 1, 6);
    const appliedFeatures = [];
    const steps = [{ label: "Бросок", text: `Выпало ${baseResult}`, value: baseResult }];
    let current = baseResult;
    let afterReliable = current;

    if (modifiers.reliable && current === 1) {
        current = 6;
        afterReliable = current;
        appliedFeatures.push("Надежное");
        steps.push({ label: "Надежное", text: "1 → 6", value: current });
    }

    let modifier = 0;
    const modifierLabels = [];
    if (modifiers.thickened) {
        modifier += 1;
        modifierLabels.push("Утолщенное");
        appliedFeatures.push("Утолщенное");
    }
    if (modifiers.thinned) {
        modifier -= 1;
        modifierLabels.push("Истонченное");
        appliedFeatures.push("Истонченное");
    }

    if (modifier !== 0) {
        const before = current;
        current = clampInteger(current + modifier, 1, 6);
        steps.push({
            label: modifierLabels.join(" + "),
            text: `${before} ${modifier > 0 ? "+" : ""}${modifier} = ${current}`,
            value: current
        });
    }
    const afterModifier = current;

    if (modifiers.risky && (current === 2 || current === 3)) {
        const before = current;
        current = 1;
        appliedFeatures.push("Рисковое");
        steps.push({ label: "Рисковое", text: `${before} → 1`, value: current });
    }

    return {
        baseResult,
        afterReliable,
        modifier,
        afterModifier,
        finalResult: current,
        appliedFeatures,
        steps,
        hasTableModifiers: !!(modifiers.reliable || modifiers.thickened || modifiers.thinned || modifiers.risky)
    };
}

function clampInteger(value, min, max) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return min;
    return Math.min(Math.max(number, min), max);
}
