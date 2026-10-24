// Tests for gateway-stderr routing (`buildGatewaySpawn` / `gatewayStderrLogPath`
// / `gatewayConfig`). The console noise comes from the MCP stdio transport
// spawning the gateway with inherited stderr; the shared wrapper launches the
// gateway under the running Node so ONLY stderr is diverted — on every
// platform, since Node is always there.
// Run: node test/gateway-stderr.test.mjs
import assert from "node:assert";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildGatewaySpawn, gatewayConfig, gatewayStderrLogPath, resolveStderrMode } from "../lib/index.js";

// ── effective-mode resolution: the user toggle first, the row config second,
// never a third state. `""` means "not touched yet" and must never throw.
assert.equal(resolveStderrMode({ stderrMode: "log", gatewayStderr: "console" }), "log", "explicit log override wins over row config console");
assert.equal(resolveStderrMode({ stderrMode: "console", gatewayStderr: "log" }), "console", "explicit console override wins over row config log");
assert.equal(resolveStderrMode({ stderrMode: "", gatewayStderr: "console" }), "console", "untouched toggle falls back to row config");
assert.equal(resolveStderrMode({ stderrMode: "", gatewayStderr: "log" }), "log", "untouched toggle + capture row config = keep capturing");
assert.equal(resolveStderrMode({ gatewayStderr: "log" }), "log", "a row that never answered the toggle falls back");
assert.equal(resolveStderrMode({ stderrMode: "bogus", gatewayStderr: "console" }), "console", "an invalid toggle is ignored, not trusted");

// ── the spawn shape. A bridging gateway that logs is launched through the
// shared Node wrapper everywhere (the old `sh -c` script had no Windows answer);
// the gateway's own argv passes through verbatim.
const target = { command: "/usr/bin/docker", args: ["mcp", "gateway", "run", "--profile", "demo"], serverName: "docker" };
const options = { execPath: "/usr/bin/node", tmpdir: "/tmp", pid: 4321 };
const expectedLog = path.join("/tmp", "dsh-ancesters-bridge-docker-bridge-4321.log");

let built = buildGatewaySpawn(target, options);
assert.equal(built.command, "/usr/bin/node", "the wrapper runs under the same Node that runs the host");
assert.equal(built.redirect, expectedLog, "the redirect names the log file");
assert.equal(built.args[0].endsWith("stderr-wrapper.js"), true, "the wrapper script is the first argument");
assert.equal(built.args[1], expectedLog, "the log path is the wrapper's first argument");
assert.equal(built.args[2], "docker", "the bridge is named for the line the wrapper prints");
assert.equal(built.args[3], "/usr/bin/docker", "the gateway executable follows the name");
assert.deepEqual(built.args.slice(4), target.args, "the gateway argv reaches the wrapper verbatim");

// console mode: nothing wrapped — the gateway's progress lines keep landing on
// the console, which is exactly what the toggle says.
built = buildGatewaySpawn({ ...target, stderr: "console" }, options);
assert.equal(built.command, "/usr/bin/docker");
assert.deepEqual(built.args, target.args);
assert.equal(built.redirect, "", "console mode redirects nothing");

// An explicit log path wins over the derived default.
built = buildGatewaySpawn({ ...target, logPath: "/custom/g.log" }, options);
assert.equal(built.args[1], "/custom/g.log");
assert.equal(built.redirect, "/custom/g.log");

// Extra args with spaces survive as single argv entries (nothing re-quotes).
built = buildGatewaySpawn({ ...target, args: ["mcp", "gateway", "run", "--profile", "demo", "--tools", "a b"] }, options);
assert.deepEqual(built.args.slice(4), ["mcp", "gateway", "run", "--profile", "demo", "--tools", "a b"]);

// The log file is named by the safe subset of the server name.
const named = gatewayStderrLogPath("weird/name!", { tmpdir: "/tmp", pid: 7 });
assert.equal(named, path.join("/tmp", "dsh-ancesters-bridge-weird-name--bridge-7.log"), "only [A-Za-z0-9_-] survives the name");

// ── the pool config carries ONLY mcp-client fields — the redirect never rides
// it (the SDK would choke on it), and the argv stays argv.
const configured = gatewayConfig({ command: "/usr/bin/docker", profile: "demo", extraArgs: ["--tools", "a b"], stderr: "log", serverName: "docker" });
assert.deepEqual(configured.config.args.slice(-4), ["--profile", "demo", "--tools", "a b"], "the fixed argv shape holds");
assert.equal(configured.config.command, configured.command, "the config spawns what the spawn resolves");
assert.ok(!("redirect" in configured.config), "the redirect stays out of the pool config");
assert.ok(!("serverName" in configured.args), "nothing that is not argv rides the argv");
assert.equal(configured.config.serverName, "docker", "the bridge server namespace is the entry id");

// console mode: the pool config spawns the gateway directly.
const raw = gatewayConfig({ command: "/usr/bin/docker", profile: "demo", stderr: "console", serverName: "docker" });
assert.deepEqual(raw.config.args, ["mcp", "gateway", "run", "--profile", "demo"]);
assert.equal(raw.redirect, "");

// ── Integration: a real spawn keeps stdout clean and sends stderr to the log
// file — the transport-visible protocol stream survives, only stderr diverted.
if (process.platform === "linux" || process.platform === "darwin") {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-dm-stderr-"));
    try {
        const logPath = path.join(dir, "gateway.log");
        const fake = path.join(dir, "docker");
        fs.writeFileSync(fake, "#!/bin/sh\nprintf 'PROTO-OK\\n'\nprintf 'NOISE-LINE\\n' >&2\nexit 0\n");
        fs.chmodSync(fake, 0o755);

        const wrapped = buildGatewaySpawn({ command: fake, args: ["mcp", "gateway", "run", "--profile", "demo"], stderr: "log", logPath });
        let stdout = "";
        const code = await new Promise((resolve) => {
            const child = spawn(wrapped.command, wrapped.args, { stdio: ["ignore", "pipe", "ignore"] });
            child.stdout.on("data", (chunk) => (stdout += String(chunk)));
            child.once("close", resolve);
            child.once("error", () => resolve(-1));
        });
        assert.equal(code, 0, "the wrapped gateway exits 0");
        assert.equal(stdout, "PROTO-OK\n", "stdout (the protocol stream) reaches the transport untouched");
        assert.ok(fs.readFileSync(logPath, "utf8").includes("NOISE-LINE"), "stderr landed in the log file");

        // A missing executable fails loud (127) with the reason on the console
        // stream, never silently.
        const missing = buildGatewaySpawn({ command: path.join(dir, "definitely-absent"), args: ["mcp"], stderr: "log", logPath });
        const missingCode = await new Promise((resolve) => {
            const child = spawn(missing.command, missing.args, { stdio: ["ignore", "ignore", "ignore"] });
            child.once("close", resolve);
            child.once("error", () => resolve(-1));
        });
        assert.equal(missingCode, 127, "a missing executable fails loud with 127");

        // The argv survives a value that carries a space.
        const argvFake = path.join(dir, "argv-echo");
        fs.writeFileSync(argvFake, "#!/bin/sh\nprintf '%s\\n' \"$@\"\nexit 0\n");
        fs.chmodSync(argvFake, 0o755);
        const argvWrapped = buildGatewaySpawn({ command: argvFake, args: ["mcp", "gateway", "run", "--profile", "demo x"], stderr: "log", logPath });
        const echoed = await new Promise((resolve) => {
            const child = spawn(argvWrapped.command, argvWrapped.args, { stdio: ["ignore", "pipe", "ignore"] });
            let out = "";
            child.stdout.on("data", (chunk) => (out += String(chunk)));
            child.once("close", () => resolve(out));
            child.once("error", () => resolve(""));
        });
        assert.equal(echoed, "mcp\ngateway\nrun\n--profile\ndemo x\n", "argv preserved verbatim (spaces included)");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

console.log("gateway-stderr.test.mjs: all assertions passed");
