/**
 * A fake `docker` CLI for the tests, on every platform.
 *
 * The behaviour is a Node script (`<name>-shim.mjs`); what the code under test
 * spawns is a launcher beside it — a `sh` script on POSIX, a `.cmd` on Windows —
 * that runs that script with **this** Node (absolute path, so the scrubbed
 * environment a spawn gets never has to find `node` on PATH). The code spawns
 * through `cross-spawn`, which runs a `.cmd` the way it runs anything else.
 *
 * Not a test file: `node --test` only collects `*.test.mjs`.
 */
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Write one fake executable into `dir`.
 * @param {string} dir - where it lives (beside its `argv.log`).
 * @param {string} name - its base name (`docker`, `docker-fail`…).
 * @param {string} body - the shim's JavaScript; `args` holds its argv.
 * @returns {string} the path to spawn.
 */
export function writeFakeExecutable(dir, name, body) {
    const script = join(dir, `${name}-shim.mjs`);
    writeFileSync(script, `const args = process.argv.slice(2);\n${body}\n`);
    if (process.platform === "win32") {
        const launcher = join(dir, `${name}.cmd`);
        writeFileSync(launcher, `@"${process.execPath}" "%~dp0${name}-shim.mjs" %*\r\n`);
        return launcher;
    }
    const launcher = join(dir, name);
    writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/${name}-shim.mjs" "$@"\n`);
    chmodSync(launcher, 0o755);
    return launcher;
}

/**
 * The fake `docker` most tests want: `version` answers fast (the readiness
 * fallback), `mcp profile …` answers `profilesJson` or the CLI-style failure
 * line, and every call appends its argv (one item per line) to `argv.log`.
 * @param {string} dir - where it lives.
 * @param {{ profilesJson?: string, profilesOk?: boolean }} [options]
 * @returns {string} the path to spawn.
 */
export function writeFakeDocker(dir, { profilesJson = "[]", profilesOk = true } = {}) {
    return writeFakeExecutable(
        dir,
        "docker",
        [
            'import { appendFileSync } from "node:fs";',
            'import { dirname, join } from "node:path";',
            'import { fileURLToPath } from "node:url";',
            'appendFileSync(join(dirname(fileURLToPath(import.meta.url)), "argv.log"), args.map((arg) => arg + "\\n").join(""));',
            'if (args[0] === "version") { process.stdout.write("99.99.99\\n"); process.exit(0); }',
            'if (args[0] === "mcp" && args[1] === "profile") {',
            profilesOk
                ? `    process.stdout.write(${JSON.stringify(profilesJson)}); process.exit(0);`
                : '    process.stderr.write("Error: profile store unavailable\\n"); process.exit(1);',
            "}",
            "process.exit(1);"
        ].join("\n")
    );
}
