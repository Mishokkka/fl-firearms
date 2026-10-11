export async function renderModuleTemplate(path, data = {}) {
    const render = foundry?.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
    if (typeof render !== "function") throw new Error("Foundry renderTemplate API is unavailable");
    return render(path, data);
}
