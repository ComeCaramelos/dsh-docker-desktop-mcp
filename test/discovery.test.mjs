/**
 * Host-side tests for the live controller — what the machine answers and what it
 * never answers. Three properties stand in for the whole wiring:
 *
 *   - A run publishes into the live mirror and nothing else. It merges nothing
 *     into the saved rows, persists nothing, and re-runs no form.
 *   - The profile run waits on the executable's readiness gate; the executable
 *     scan is a filesystem probe and answers without it.
 *   - A failed run arms one bounded retry. Nothing retries forever, and no retry
 *     ever writes the row.
 *
 * The stub fiber answers every live field through its own config, because the
 * live mirror IS what every client reads; retry timers are captured and fired
 * by hand so no test waits on a wall clock.
 */
import * as assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createController } from "../lib/host/controller/index.js";
import { apply } from "../lib/index.js";
import { DISCOVERY_RETRY_DELAY_MS, DISCOVERY_RETRY_MAX } from "../lib/index.js";
import { writeFakeDocker } from "./fake-docker.mjs";

const ENTRY_ID = "mcp-docker";
/** The fields a served config hands as a live reference (`.volatile()`). */
const LIVE_FIELDS = [
    "profileEntries", "executables", "refreshNonce", "refreshExecutablesNonce", "migrationDismissed",
    "effectiveCommand", "effectiveSource", "stderrEffective", "profiles", "executableCandidates",
    "lastRefreshError", "discoveryRevision", "executableDiscoveryRevision"
];

// ── timer capture: the retry scheduler is the only thing that waits on a clock
const timers = [];
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
globalThis.setTimeout = (fn, ms) => {
    if (ms >= DISCOVERY_RETRY_DELAY_MS) {
        const entry = { fn, cleared: false };
        timers.push(entry);
        return entry;
    }
    return realSetTimeout(fn, ms);
};
globalThis.clearTimeout = (id) => {
    if (id !== null && typeof id === "object" && "fn" in id) id.cleared = true;
    else realClearTimeout(id);
};

/** Fire one captured retry timer; reports whether anything was standing. */
function fireRetryTimer() {
    const next = timers.shift();
    if (next === void 0) return false;
    if (next.cleared) return true;
    next.fn();
    return true;
}

/** Wait for `condition`, pumping retry timers while asked to. */
async function settle(condition, { pumpRetries = false } = {}) {
    for (let attempt = 0; attempt < 2000; attempt += 1) {
        if (pumpRetries) fireRetryTimer();
        await new Promise((resolve) => realSetTimeout(resolve, 2));
        if (condition()) return true;
    }
    return false;
}

/**
 * Fake `docker`: `version` answers fast (the readiness fallback), the profile
 * list answers `profilesJson` or the CLI-style failure line, and every call
 * appends its argv to `argv.log` beside the shim.
 */
function makeShim({ profilesJson = "[]", profilesOk = true } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "dshdm-controller-"));
    // A Node shim behind a sh/.cmd launcher: the same fake on POSIX and Windows.
    const file = writeFakeDocker(dir, { profilesJson, profilesOk });
    return { file, dir };
}

const argvLog = (dir) => {
    try {
        return readFileSync(join(dir, "argv.log"), "utf8");
    } catch {
        return "";
    }
};

/**
 * Stub host context faithful to the component model: the fiber's own config
 * answers every live field (that is what `createLiveMirror` commits), the
 * settings service answers the two layers through `describe`, a patch write
 * routes through `mutate`, and a mounted manager is optional — which is exactly
 * the "component is off" case.
 */
function makeStub({ command = "", user = {}, manager = false } = {}) {
    process.env.HOME = mkdtempSync(join(tmpdir(), "dshdm-home-"));
    const base = {
        serverName: "docker",
        command,
        profile: "default",
        extraArgs: [],
        gatewayStderr: "console",
        gatewayStderrLog: "",
        env: {},
        cwd: "",
        toolCallTimeoutMs: 60000,
        failOnStartupError: false,
        reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 },
        dockerPath: "",
        profileEntries: [],
        executables: [],
        refreshNonce: 0,
        refreshExecutablesNonce: 0,
        stderrMode: "",
        migrationDismissed: false,
        effectiveCommand: "",
        effectiveSource: "",
        stderrEffective: "log",
        profiles: [],
        executableCandidates: [],
        lastRefreshError: "",
        discoveryRevision: 0,
        executableDiscoveryRevision: 0
    };
    const layer = { ...user };
    const logs = [];
    const state = { writes: [], kinds: [], notified: 0, configured: 0, disposers: [] };
    const entry = {
        options: { id: ENTRY_ID, config: { ...base } },
        update: (next) => {
            entry.options.config = { ...entry.options.config, ...next.config };
        }
    };
    const settings = {
        describe: () => [{ ns: ENTRY_ID, base: { ...base }, user: { ...layer }, value: { ...entry.options.config } }],
        mutate: async (entryId, ops) => {
            if (entryId !== ENTRY_ID) throw new Error(`unknown entry id: ${entryId}`);
            for (const op of ops) {
                if (op.op === "set") layer[op.path[0]] = op.value;
                else delete layer[op.path[0]];
            }
            state.writes.push({ entryId, ops });
        },
        configure: () => {
            state.configured += 1;
            return () => {
                state.configured -= 1;
            };
        }
    };
    // Every VOLATILE field rides as a live reference — what the patch layer
    // carries answers first, the row config below it. The ordinary fields are
    // plain values (only volatile fields arrive as references).
    const config = {};
    for (const [key, value] of Object.entries(base)) {
        config[key] = LIVE_FIELDS.includes(key)
            ? { get: () => (Object.prototype.hasOwnProperty.call(layer, key) ? layer[key] : value) }
            : value;
    }
    const managerService = manager === false ? void 0 : {
        registerKind: (kind) => {
            state.kinds.push(kind);
            return () => {
                state.kinds = state.kinds.filter((candidate) => candidate !== kind);
            };
        },
        notifyKindsChanged: () => {
            state.notified += 1;
        },
        entries: () => [],
        propose: () => () => void 0,
        update: async () => true
    };
    const ctx = {
        logger: {
            warn: (...args) => logs.push(args.map(String).join(" ")),
            info: () => void 0,
            error: (...args) => logs.push(args.map(String).join(" "))
        },
        fiber: { state: 2, entry, await: async () => void 0 },
        get: (name) => (name === "settings" ? settings : void 0),
        on: () => () => void 0,
        inject: (deps, callback) => {
            if (deps.includes("settings")) callback({ settings });
            if (deps.includes("mcpConnections") && managerService !== void 0) callback({ mcpConnections: managerService });
        },
        effect: (execute) => {
            const dispose = execute();
            if (typeof dispose === "function") state.disposers.push(dispose);
        }
    };
    return { ctx, config, base, entry, logs, state, layer };
}

/** What every live answer reaches clients through. */
const published = (stub) => stub.entry.options.config;

// ── 1: one profile run answers through the live mirror, merges nothing ───────
{
    const { file, dir } = makeShim({ profilesJson: '[{"id":"alpha","name":"Alpha"},{"id":"beta","name":"Beta"}]' });
    const stub = makeStub({ command: file, user: { profileEntries: [{ id: "saved", name: "Saved" }] } });
    const controller = createController(stub.ctx, stub.config);
    timers.length = 0;

    await controller.runDiscovery();

    assert.equal(published(stub).discoveryRevision >= 1, true, "the run advances the profile counter");
    assert.deepEqual(published(stub).profiles, ["alpha", "beta"], "the ids the gateway reported are live answers");
    assert.equal(published(stub).lastRefreshError, "", "a successful run clears the failure line");
    const log = argvLog(dir);
    assert.equal(log.includes("mcp\nprofile\nlist\n--format\njson"), true, "the run asks for the machine-readable profile list");
    // The saved rows are the patch layer, read through the reference — a run
    // answers into the live mirror, never into the rows.
    assert.deepEqual(stub.config.profileEntries.get(), [{ id: "saved", name: "Saved" }], "a run merges NOTHING into the saved rows");
    assert.equal(stub.state.writes.length, 0, "a run persists nothing");
    controller.dispose();
}

// ── 2: a failed run answers a capped line and arms bounded retries ───────────
{
    const { file } = makeShim({ profilesOk: false });
    const stub = makeStub({ command: file });
    const controller = createController(stub.ctx, stub.config);
    timers.length = 0;

    await controller.runDiscovery();

    assert.deepEqual(published(stub).profiles, [], "a failed run leaves no phantom profiles");
    assert.equal(published(stub).lastRefreshError.includes("profile store unavailable"), true, "the CLI's own line is what the card reads");
    assert.equal(timers.length, 1, "a failed run arms exactly one retry");

    // Every retry fails and re-arms — up to the cap, and never past it.
    let fired = 0;
    while (fired < DISCOVERY_RETRY_MAX && timers.length > 0 && fireRetryTimer()) {
        fired += 1;
        await settle(() => published(stub).discoveryRevision >= fired + 1);
    }
    assert.equal(fired >= 1, true, "the armed retry does run");
    assert.equal(timers.length === 0, true, "the retries stay bounded: nothing stands past the cap");
    assert.equal(stub.state.writes.length, 0, "no retry ever writes the row");
    controller.dispose();
}

// ── 3: the executable scan is filesystem-only, so it answers without a spawn ─
{
    const { file } = makeShim({ profilesOk: false });
    const stub = makeStub({ command: file });
    const controller = createController(stub.ctx, stub.config);
    const before = 0;
    await controller.runExecutablesDiscovery();
    assert.equal(published(stub).executableDiscoveryRevision >= 1, true, "the scan advances its own counter");
    assert.deepEqual(published(stub).executableCandidates, published(stub).executableCandidates, "the candidates are paths found on disk");
    assert.equal(published(stub).executableCandidates.every((candidate) => typeof candidate === "string"), true, "every candidate is a path");
    assert.equal(before, 0, "the scan never spawns anything");
    controller.dispose();
}

// ── 4: with a manager mounted, every publish re-notifies the picker ──────────
{
    const { file } = makeShim({ profilesJson: "[]" });
    const stub = makeStub({ command: file, manager: true });
    apply(stub.ctx, stub.config);
    assert.equal(stub.state.kinds.length, 1, "the kind is registered once the manager answers");
    assert.equal(stub.state.kinds[0].id, "docker-profile", "the kind is the component's own id");
    assert.equal(await settle(() => published(stub).executableDiscoveryRevision >= 1), true, "the opening scan answers");
    assert.equal(stub.state.notified >= 1, true, "publishing tells the manager what a picker would offer has moved");
}

// ── 5: the same executable never arms a second readiness wait ────────────────
{
    const { file } = makeShim({ profilesJson: "[]" });
    const stub = makeStub({ command: file });
    const controller = createController(stub.ctx, stub.config);
    const first = controller.prepare(file);
    const second = controller.prepare(file);
    await Promise.all([first, second]);
    // The gate is per executable path, so the second call is the same promise.
    assert.equal(first === second, true, "one executable stands one readiness gate");
    controller.dispose();
}

console.log("discovery.test.mjs: all assertions passed");
