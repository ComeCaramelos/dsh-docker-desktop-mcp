/**
 * Link the sibling checkouts this component builds against.
 *
 * `@comecaramelos/dsh-ancesters` and `@comecaramelos/dsh-mcp-manager` are not
 * published yet (and, for the manager, are a *peer*: this component imports its
 * types only, never a runtime module). The `package.json` `file:` entries are
 * what `npm ci` would use once they are publishable; locally the same two links
 * have to exist inside `node_modules` before `tsc` can read the exports maps.
 *
 * This script just creates them: `node_modules/@comecaramelos/<name>` → the
 * sibling checkout, resolved next to this checkout (`../<name>`), overridable
 * with `<NAME>_DIR` in the environment. It never deletes an existing real
 * directory — a populated install stays a real install.
 */
import { existsSync, mkdirSync, lstatSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scope = "@comecaramelos";
const targets = [
    { name: "dsh-ancesters", env: "DSH_ANCESTERS_DIR", fallback: "dsh-ancesters" },
    { name: "dsh-mcp-manager", env: "DSH_MCP_MANAGER_DIR", fallback: "dsh-mcp-manager" }
];

const scopeDir = join(root, "node_modules", scope);
mkdirSync(scopeDir, { recursive: true });

for (const target of targets) {
    const wanted = join(scopeDir, target.name);
    const source = resolve(root, "..", process.env[target.env] ?? target.fallback);
    if (!existsSync(source)) {
        console.warn(`link-dev: ${source} not found — skipping ${scope}/${target.name} (set ${target.env} to point at it)`);
        continue;
    }
    let existing;
    try {
        existing = lstatSync(wanted);
    } catch {
        existing = undefined;
    }
    if (existing !== undefined && existing.isSymbolicLink() === false) {
        console.log(`link-dev: kept the installed ${scope}/${target.name} (a real directory — nothing linked)`);
        continue;
    }
    if (existing !== undefined) rmSync(wanted, { recursive: true, force: true });
    symlinkSync(source, wanted, process.platform === "win32" ? "junction" : "dir");
    console.log(`link-dev: ${scope}/${target.name} → ${source}`);
}

// The link list is what the build resolves; a missing link is caught at build
// time by `require.resolve`, so a warning here is enough to point at the fix.
const linked = readdirSync(scopeDir);
for (const target of targets) {
    if (!linked.includes(target.name)) console.warn(`link-dev: ${scope}/${target.name} is not linked — build and typecheck cannot resolve it`);
}
