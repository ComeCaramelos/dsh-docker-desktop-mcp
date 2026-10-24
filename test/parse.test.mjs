// Parse + discovery tests for @comecaramelos/dsh-docker-desktop-mcp host half.
// Run: node test/parse.test.mjs (needs `npm install` first).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractProfileIds, listProfiles, readConfigField, resolveDockerCommand, resolveProfileFromConfig, WSL_DOCKER_HOST_COMMAND } from "../lib/index.js";
import { writeFakeExecutable } from "./fake-docker.mjs";

const cases = [
    // bare array of objects with id
    [JSON.stringify([{ id: "dev", name: "Dev" }, { id: "prod", name: "Prod" }]), ["dev", "prod"]],
    // wrapper object under profiles key
    [JSON.stringify({ profiles: [{ profileID: "a", name: "A" }, { profileId: "b", name: "B" }] }), ["a", "b"]],
    // bare array of strings
    [JSON.stringify(["x", "y", "x"]), ["x", "y"]],
    // object wrapping first array value
    [JSON.stringify({ data: [{ name: "n1" }, { name: "n2" }] }), ["n1", "n2"]],
    // empty list
    [JSON.stringify([]), []],
    // empty wrapper
    [JSON.stringify({ profiles: [] }), []],
    // mixed junk entries are skipped
    [JSON.stringify([null, 42, { other: true }, "keep", { id: "id2" }]), ["keep", "id2"]]
];

for (const [input, expected] of cases) {
    assert.deepEqual(extractProfileIds(input), expected, `extractProfileIds(${input})`);
}

// resolveProfileFromConfig: the launch environment folds over the row config,
// which folds over the schema default — an env value the profile pattern refuses
// is ignored, never thrown. (The entry's own `extra.profile` is folded in by the
// kind, above this — see test/kind.test.mjs.)
const row = (profile) => ({ profile, dockerPath: "", stderrMode: "", profileEntries: [], executables: [], refreshNonce: 0, refreshExecutablesNonce: 0 });
assert.equal(resolveProfileFromConfig(row("cfg"), "env-profile"), "env-profile", "valid env lands above the row config");
assert.equal(resolveProfileFromConfig(row("cfg"), undefined), "cfg", "no env keeps the row config");
assert.equal(resolveProfileFromConfig(row(""), undefined), "default", "no layer at all keeps the schema default");
assert.equal(resolveProfileFromConfig(row("cfg"), "BAD PROFILE!"), "cfg", "invalid env is ignored, never trusted");
assert.equal(resolveProfileFromConfig(row("cfg"), ""), "cfg", "empty env is ignored");
assert.equal(resolveProfileFromConfig(row("cfg"), 42), "cfg", "non-string env is ignored");
assert.equal(resolveProfileFromConfig(row(""), "env-profile"), "env-profile", "env stands above the default when the row config is silent");

// readConfigField: a volatile field is handed either as a live reference or (a
// hand-built config, e.g. in tests) as the plain value — the same read answers
// both, and an array never aliases the reference's own list.
assert.equal(readConfigField("plain", "fallback"), "plain", "plain value passes through");
assert.equal(readConfigField({ get: () => "live" }, "fallback"), "live", "reference is resolved");
assert.equal(readConfigField({ get: () => undefined }, "fallback"), "fallback", "a reference that answers nothing falls back");
assert.equal(readConfigField(undefined, "fallback"), "fallback", "absent field falls back");
const servedList = ["a", "b"];
const readList = readConfigField(servedList, []);
assert.deepEqual(readList, servedList, "the list reads back the same");
readList.push("c");
assert.equal(servedList.length, 2, "the read is a copy, never the reference's own array");

// resolveDockerCommand: only the literal default "docker" is rewritten, only
// on linux, only when a Windows-side docker.exe exists (canonical host path
// first, else the first `docker.exe` on PATH).
assert.equal(resolveDockerCommand("docker", { platform: "linux", exists: () => true }), WSL_DOCKER_HOST_COMMAND, "linux + wsl cli present rewrites default docker");
assert.equal(resolveDockerCommand("docker", { platform: "linux", exists: () => false }), "docker", "no wsl cli path keeps default");
assert.equal(resolveDockerCommand("docker", { platform: "darwin", exists: () => true }), "docker", "non-linux never rewrites");
assert.equal(resolveDockerCommand("win32-docker", { platform: "linux", exists: () => true }), "win32-docker", "explicit command always wins");
assert.equal(resolveDockerCommand("/Docker/host/bin/docker.exe", { platform: "linux", exists: () => true }), "/Docker/host/bin/docker.exe", "explicit host path stays put");
assert.equal(
    resolveDockerCommand("docker", { platform: "linux", env: { PATH: "/Docker/host/bin:/usr/bin" }, exists: () => true }),
    WSL_DOCKER_HOST_COMMAND,
    "canonical host path wins over a PATH docker.exe",
);
assert.equal(
    resolveDockerCommand("docker", { platform: "linux", env: { PATH: "/usr/bin:/opt/win/bin/" }, exists: (c) => c === "/opt/win/bin/docker.exe" }),
    "/opt/win/bin/docker.exe",
    "PATH docker.exe used when the host path is absent",
);
assert.equal(
    resolveDockerCommand("docker", { platform: "linux", env: { PATH: "C:\\Windows\\system32:/usr/bin" }, exists: () => false }),
    "docker",
    "Windows-style PATH entries are skipped and nothing found keeps default",
);

// blank stdout → no profiles
assert.deepEqual(extractProfileIds("   \n"), []);
// non-JSON stdout throws (caller stores the reason)
assert.throws(() => extractProfileIds("not json"));

// listProfiles through a fake docker shim
const dir = mkdtempSync(join(tmpdir(), "dshdmc-"));
try {
    // Node shims behind a sh/.cmd launcher: the same fake on POSIX and Windows.
    const shim = writeFakeExecutable(
        dir,
        "docker",
        `if (args.join(" ") === "mcp profile list --format json") {
    process.stdout.write(${JSON.stringify(JSON.stringify([{ id: "shim-profile", name: "Shim" }]))});
    process.exit(0);
}
process.stderr.write("unexpected args: " + args.join(" ") + "\\n");
process.exit(3);`
    );
    const ids = await listProfiles(shim);
    assert.deepEqual(ids, ["shim-profile"], "shim discovery");

    const failShim = writeFakeExecutable(dir, "docker-fail", 'process.stderr.write("unknown flag: --profile\\n");\nprocess.exit(1);');
    await assert.rejects(
        listProfiles(failShim),
        /failed: unknown flag: --profile — enable the profiles feature first/,
        "failure reason surfaces with feature hint"
    );
} finally {
    rmSync(dir, { recursive: true, force: true });
}

console.log("parse.test.mjs: all assertions passed");
