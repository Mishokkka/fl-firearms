import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let checked = 0;
function check(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) check(path);
        else if (/\.(m?js)$/.test(entry.name)) {
            const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8", windowsHide: true });
            if (result.status !== 0) throw new Error(`${path}: ${result.error?.message ?? result.stderr}`);
            checked++;
        }
    }
}
check("scripts");
check("tests");
for (const path of ["module.json", "lang/ru.json", "package.json"]) JSON.parse(readFileSync(path, "utf8"));
console.log(`FL Firearms syntax/JSON checks: OK (${checked} scripts)`);
