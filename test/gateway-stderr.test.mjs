// Tests for gateway-stderr redirection (lib/index.js buildGatewaySpawn /
// gatewayStderrLogPath). The console noise comes from the MCP stdio
// transport spawning the gateway with inherited stderr; the wrapper must
// preserve the gateway argv verbatim while sending stderr to a log file.
// Run: node test/gateway-stderr.test.mjs
import assert from "node:assert";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildGatewaySpawn, gatewayStderrLogPath, readPersistedStderrMode, resolveStderrMode } from "../lib/index.js";

// ── effective-mode resolution: UI toggle > row config, never a third state ──
assert.equal(resolveStderrMode("log", "console"), "log", "explicit log override wins over row config console");
assert.equal(resolveStderrMode("console", "log"), "console", "explicit console override wins over row config log");
assert.equal(resolveStderrMode("", "console"), "console", "untouched toggle falls back to row config");
assert.equal(resolveStderrMode("", "log"), "log", "untouched toggle + default row config = capture");
assert.equal(resolveStderrMode(void 0, "log"), "log", "missing override falls back");
assert.equal(resolveStderrMode("bogus", "log"), "log", "invalid override is ignored, not trusted");
{
    const settings = (section) => ({ get: (name) => (name === "settings" ? { document: { "docker-desktop-mcp": section } } : void 0) });
    assert.equal(readPersistedStderrMode(settings({ stderrMode: "console" })), "console", "persisted console selection");
    assert.equal(readPersistedStderrMode(settings({ stderrMode: "log" })), "log", "persisted log selection");
    assert.equal(readPersistedStderrMode(settings({ stderrMode: "" })), "", "empty persisted value means auto");
    assert.equal(readPersistedStderrMode(settings({ stderrMode: "bogus" })), "", "invalid persisted value ignored");
    assert.equal(readPersistedStderrMode(settings({})), "", "absent field means auto");
    assert.equal(readPersistedStderrMode(settings(void 0)), "", "absent section means auto");
    assert.equal(readPersistedStderrMode({ get: () => void 0 }), "", "no settings service means auto (onChange applies later)");
}

const target = { command: "/usr/bin/docker", args: ["mcp", "gateway", "run", "--profile", "demo"] };
const options = { platform: "linux", exists: (candidate) => candidate === "/bin/sh", tmpdir: "/tmp", pid: 4321 };

// Default mode: wrapped in sh -c, gateway argv preserved, stderr -> log file.
let built = buildGatewaySpawn(target, options);
assert.equal(built.command, "/bin/sh");
assert.equal(built.args[0], "-c");
assert.equal(built.args[2], "docker-desktop-mcp");
assert.equal(built.args[3], "/usr/bin/docker");
assert.equal(built.args[4], "/tmp/dsh-docker-mcp-gateway-gateway-4321.log");
assert.deepEqual(built.args.slice(5), target.args);
assert.equal(built.redirect, "/tmp/dsh-docker-mcp-gateway-gateway-4321.log");
assert.equal(built.fallback, "");

// The script keeps stdout (the protocol stream) and only routes stderr.
assert.match(built.args[1], /exec "\$GATEWAY" "\$@" 2>\"\$LOG\"/);

// console mode: raw command/args, no redirect, no fallback.
built = buildGatewaySpawn({ ...target, stderr: "console" }, options);
assert.equal(built.command, "/usr/bin/docker");
assert.deepEqual(built.args, target.args);
assert.equal(built.redirect, "");
assert.equal(built.fallback, "");

// Platform without a known POSIX shell: identity + platform fallback.
built = buildGatewaySpawn(target, { ...options, platform: "win32" });
assert.equal(built.command, "/usr/bin/docker");
assert.deepEqual(built.args, target.args);
assert.equal(built.fallback, "platform");

// No sh found: identity + shell fallback.
built = buildGatewaySpawn(target, { ...options, exists: () => false });
assert.equal(built.command, "/usr/bin/docker");
assert.deepEqual(built.args, target.args);
assert.equal(built.fallback, "shell");

// logPath override wins over the default.
built = buildGatewaySpawn({ ...target, logPath: "/custom/path/g.log" }, options);
assert.equal(built.args[4], "/custom/path/g.log");
assert.equal(built.redirect, "/custom/path/g.log");

// serverName shapes the default path.
const named = gatewayStderrLogPath("desktop-docker", { tmpdir: "/tmp", pid: 7 });
assert.equal(named, "/tmp/dsh-docker-mcp-desktop-docker-gateway-7.log");

// Extra args with spaces survive as single argv entries.
built = buildGatewaySpawn({ ...target, args: ["mcp", "gateway", "run", "--profile", "demo", "--tools", "a b"] }, options);
assert.deepEqual(built.args.slice(5), ["mcp", "gateway", "run", "--profile", "demo", "--tools", "a b"]);

// ── Integration: a real sh spawn keeps stdout clean and writes stderr to
// the log file, proving the transport-visible protocol stream survives and
// only stderr is diverted.
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
        assert.equal(code, 0, "wrapped gateway exited 0");
        assert.equal(stdout, "PROTO-OK\n", "stdout (the protocol stream) reaches the transport untouched");

        const logged = fs.readFileSync(logPath, "utf8");
        assert.ok(logged.includes("NOISE-LINE"), "stderr landed in the log file");
        fs.rmSync(fake);

        // Missing executable: exit 127 + message on stderr (never silent).
        const missing = buildGatewaySpawn({
            command: path.join(dir, "definitely-absent"),
            args: ["mcp", "gateway", "run", "--profile", "demo"],
            stderr: "log",
            logPath
        });
        const missingCode = await new Promise((resolve) => {
            const child = spawn(missing.command, missing.args, { stdio: ["ignore", "ignore", "ignore"] });
            child.once("close", resolve);
            child.once("error", () => resolve(-1));
        });
        assert.equal(missingCode, 127, "missing executable fails loud with 127");

        // The gateway keeps its argv: echo-style shim reports $* back.
        const argvFake = path.join(dir, "argv-echo");
        const argvLog = path.join(dir, "argv.log");
        fs.writeFileSync(argvFake, "#!/bin/sh\nprintf '%s\\n' \"$@\"\nexit 0\n");
        fs.chmodSync(argvFake, 0o755);
        const argvWrapped = buildGatewaySpawn({ command: argvFake, args: ["mcp", "gateway", "run", "--profile", "demo x"], stderr: "log", logPath: argvLog });
        const echoed = await new Promise((resolve, reject) => {
            const child = spawn(argvWrapped.command, argvWrapped.args, { stdio: ["ignore", "pipe", "ignore"] });
            let out = "";
            child.stdout.on("data", (chunk) => (out += String(chunk)));
            child.once("close", () => resolve(out));
            child.once("error", reject);
        });
        assert.equal(echoed, "mcp\ngateway\nrun\n--profile\ndemo x\n", "argv preserved verbatim (spaces included)");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

console.log("gateway-stderr.test.mjs: all assertions passed");
