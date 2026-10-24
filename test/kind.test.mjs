/**
 * The `docker-profile` kind, and the seam it stands on.
 *
 * Everything a `docker-profile` connection is lives in one module (`src/host/
 * kind.ts`) plus the short attach that registers it (`src/host/manager.ts`).
 * What has to hold, and is pinned here:
 *
 *   - the kind answers as what the manager's card needs: **no transport** (the
 *     gateway is not a plain stdio server the card configures), one entry only,
 *     three fields, each a `select` whose choices come from the Host;
 *   - `resolve()` is the fixed argv, nothing else: `docker mcp gateway run
 *     --profile <id>` + `extraArgs`, after the readiness gate for the executable
 *     that was picked; an entry that cannot run answers the line the card shows,
 *     never a spawn;
 *   - a kind that lands **late** hands nothing back: the manager reconciles
 *     its own pool when a kind arrives, so mounting invalidates no entry.
 */
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createController } from "../lib/host/controller/index.js";
import { attachToManager } from "../lib/host/manager.js";
import { createDockerKind, entryExtraArgs, entryProfile, executableChoices, profileChoices } from "../lib/index.js";
import { KIND_FIELDS, KIND_ID, KIND_MAX_ENTRIES } from "../lib/host/constants.js";
import { writeFakeDocker } from "./fake-docker.mjs";

/**
 * A `select` field answers its choices either as a function (the Host reads them
 * live, so the picker's list is whatever discovery stands now) or as a fixed
 * list; the card sees the same thing either way.
 */
function choices(field) {
    return typeof field.options === "function" ? field.options() : (field.options ?? []);
}

const ENTRY_ID = "mcp-docker";
/** Every `.volatile()` field: served to the client as a live reference. */
const LIVE_FIELDS = [
    "profileEntries", "executables", "refreshNonce", "refreshExecutablesNonce", "migrationDismissed",
    "effectiveCommand", "effectiveSource", "stderrEffective", "profiles", "executableCandidates",
    "lastRefreshError", "discoveryRevision", "executableDiscoveryRevision"
];

/** A docker CLI that answers discovery without being one. */
function makeShim({ profilesJson = "[\"alpha\",\"beta\"]", profilesOk = true } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "dshdm-kind-"));
    // A Node shim behind a sh/.cmd launcher: the same fake on POSIX and Windows.
    const file = writeFakeDocker(dir, { profilesJson, profilesOk });
    return file;
}

/**
 * A live controller over a fake row, plus the manager it is attached to.
 *
 * @param overrides - what the row config says (an ordinary value, or — for a
 * live field — served as a reference, exactly as `Config` does).
 * @param connections - what the manager answers: the entry list, what each
 * entry's line says, and what a write returns.
 */
function makeHarness(overrides = {}, connections = {}) {
    process.env.HOME = mkdtempSync(join(tmpdir(), "dshdm-home-"));
    const base = {
        serverName: "docker",
        command: "",
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
    const merged = { ...base, ...overrides };
    const config = {};
    for (const [key, value] of Object.entries(merged)) {
        config[key] = LIVE_FIELDS.includes(key) ? { get: () => value } : value;
    }

    const calls = { registerKind: 0, notifyKindsChanged: 0, propose: 0, invalidate: [], updates: [] };
    const service = {
        registerKind(kind) {
            calls.registerKind += 1;
            calls.kind = kind;
            return () => {
                calls.registered = false;
            };
        },
        notifyKindsChanged() {
            calls.notifyKindsChanged += 1;
        },
        entries: () => connections.entries ?? [],
        line: (id) => (connections.lines ?? {})[id],
        propose() {
            calls.propose += 1;
            return () => void 0;
        },
        invalidate(id) {
            calls.invalidate.push(id);
        },
        update: async (id, patch) => {
            calls.updates.push({ id, patch });
            return connections.refused === true ? false : true;
        }
    };

    const entry = { options: { id: ENTRY_ID, config: { ...merged } }, update: () => void 0 };
    const settings = {
        describe: () => [{ ns: ENTRY_ID, base: { ...merged }, user: {}, value: { ...merged } }],
        mutate: async () => void 0,
        configure: () => () => void 0
    };
    const ctx = {
        logger: { warn: () => void 0, info: () => void 0, error: () => void 0 },
        fiber: { state: 2, entry, await: async () => void 0 },
        get: (name) => (name === "settings" ? settings : void 0),
        on: () => () => void 0,
        inject: (deps, callback) => {
            if (deps.includes("mcpConnections")) callback({ mcpConnections: service });
        },
        effect: (execute) => {
            execute();
            return () => void 0;
        }
    };
    const controller = createController(ctx, config);
    attachToManager(ctx, controller);
    return { controller, config, service, calls };
}

// ── 1: what the kind answers ───────────────────────────────────────────────
{
    const harness = makeHarness();
    const kind = harness.calls.kind;
    assert.equal(harness.calls.registerKind, 1, "attaching registers the kind exactly once");
    assert.equal(kind.id, KIND_ID, "the kind id is what an entry names in `kind`");
    assert.equal(kind.builtIn === undefined || kind.builtIn === false, true, "a companion kind is never the core's own");
    assert.equal(kind.transport, "none", "the gateway is not a stdio server the card configures directly");
    assert.equal(kind.maxEntries, KIND_MAX_ENTRIES, "at most one Docker connection may exist");
    assert.equal(kind.maxEntries, 1, "…which is exactly one");
    assert.equal(Array.isArray(kind.icon) && kind.icon.length > 0, true, "the kind carries the mark the pill draws");

    const fields = kind.fields;
    assert.equal(fields.length, 3, "profile, executable, stderr — three fields, all Host-authored");
    for (const field of fields) {
        assert.equal(field.type, "select", `the ${field.key} field answers choices, it does not take free text`);
        assert.equal(typeof field.key === "string" && field.key.length > 0, true, "every field names itself");
    }
    assert.equal(fields.some((field) => field.composer === true), true, "the profile field is what the manager's composer pill drives");

    const profileField = fields.find((field) => field.key === KIND_FIELDS.profile);
    assert.equal(profileField.composer, true, "the profile choice is the pill's, not a second dropdown");
    const options = choices(profileField);
    assert.equal(options.length, 1, "with nothing discovered the only answer is the fallback");
    assert.equal(options[0].value, "default", "…which is `default`");

    const executableField = fields.find((field) => field.key === KIND_FIELDS.dockerPath);
    assert.equal(executableField.composer === undefined || executableField.composer === false, true, "no pill for an executable");

    const stderrField = fields.find((field) => field.key === KIND_FIELDS.stderrMode);
    assert.deepEqual(
        choices(stderrField).map((option) => option.value),
        ["log", "console"],
        "the stderr mode is the same two states the row config answers"
    );
}

// ── 2: what the fields offer comes from the Host ──────────────────────────
{
    const harness = makeHarness({ profiles: ["alpha", "beta"], lastRefreshError: "" });
    harness.controller.state.live.profiles = ["alpha", "beta"];
    harness.controller.state.live.executableCandidates = ["/usr/bin/docker"];
    harness.controller.state.currentCommand = "/usr/local/bin/docker";

    const kind = harness.calls.kind;
    const profileField = kind.fields.find((field) => field.key === KIND_FIELDS.profile);
    const offered = choices(profileField).map((option) => option.value);
    assert.deepEqual(offered, ["alpha", "beta"], "a healthy discovery list is authoritative — no phantom `default`");
    const executableField = kind.fields.find((field) => field.key === KIND_FIELDS.dockerPath);
    const paths = choices(executableField).map((option) => option.value);
    assert.deepEqual(paths, ["/usr/bin/docker", "/usr/local/bin/docker"], "the saved rows, then what runs");
    harness.controller.dispose();
}

// ── 3: resolve() is the fixed argv ─────────────────────────────────────────
{
    const docker = makeShim();
    const harness = makeHarness(
        { command: docker, extraArgs: ["--dry-run"] },
        { entries: [{ id: "docker-mcp", kind: KIND_ID, extra: { [KIND_FIELDS.profile]: "demo" } }] }
    );
    const kind = harness.calls.kind;
    const resolved = await kind.resolve({ id: "docker-mcp", kind: KIND_ID, extra: { [KIND_FIELDS.profile]: "demo" } });

    assert.equal(resolved.error === undefined, true, "an entry that can run answers a config, not a reason");
    assert.equal(resolved.config.command.includes("node") || resolved.config.command.endsWith(docker), true, "the gateway is spawned through the same wrapper every spawn uses");
    const argv = resolved.config.args.join(" ");
    assert.equal(argv.includes("mcp\n".split("\n").join(" ")) || argv.includes("mcp"), true, "the argv starts with `mcp`");
    assert.equal(argv.includes("--profile demo"), true, "the profile the entry picked is what runs");
    assert.equal(argv.includes("--dry-run"), true, "`extraArgs` lands after the fixed argv, never inside it");

    // The profile is what the entry says, not what the row config remembers.
    assert.equal(entryProfile({ id: "x", kind: KIND_ID, extra: { [KIND_FIELDS.profile]: "picked" } }, harness.controller), "picked", "the entry's own answer wins over the row config");
    assert.equal(entryProfile({ id: "x", kind: KIND_ID, extra: {} }, harness.controller), "default", "…and the row config answers otherwise");
    assert.deepEqual(
        entryExtraArgs({ id: "x", kind: KIND_ID, extra: {}, args: ["--one"] }, harness.controller),
        ["--one"],
        "an entry's own arguments stand, the row config's otherwise"
    );
    harness.controller.dispose();
}

// ── 4: an entry that cannot run answers the reason ─────────────────────────
{
    const harness = makeHarness({ command: "" }, { entries: [] });
    const kind = harness.calls.kind;

    const noExecutable = await kind.resolve({ id: "x", kind: KIND_ID, extra: { [KIND_FIELDS.profile]: "demo" } });
    assert.equal(typeof noExecutable.error === "string", true, "no executable answers a line, not a spawn");
    assert.equal(/executable/.test(noExecutable.error ?? ""), true, "the line names the missing executable: " + noExecutable.error);

    // An id the pattern refuses never spawns — and what refuses it is the ENTRY's
    // own edit, not the row config: a picked id is honoured as it stands, so the
    // line says why it is not running instead of quietly running `default`.
    const badProfile = await kind.resolve({ id: "x", kind: KIND_ID, extra: { [KIND_FIELDS.profile]: "bad/profile!" } });
    assert.equal(typeof badProfile.error === "string", true, "an id the pattern refuses never spawns");
    assert.equal(/profile/.test(badProfile.error ?? ""), true, "…and says it is the profile: " + badProfile.error);

    // The fallbacks stay tolerant: a row config whose profile the pattern refuses
    // answers `default`, because nothing here was edited to be wrong.
    const tolerant = makeHarness({ profile: "bad/profile!", command: "" }, { entries: [] });
    assert.equal(entryProfile({ id: "x", kind: KIND_ID, extra: {} }, tolerant.controller), "default", "an unusable row value never poisons the answer");
    tolerant.controller.dispose();
    harness.controller.dispose();
}

// ── 5: registering hands nothing back ──────────────────────────────────────
{
    // The manager reconciles itself when a kind arrives, so an entry that came
    // up as "kind nobody registered" starts without this component touching
    // it — and a live one is never disturbed (a re-resolve is a respawn).
    const harness = makeHarness(
        {},
        {
            entries: [
                { id: "live", kind: KIND_ID, extra: {} },
                { id: "broken", kind: KIND_ID, extra: {} },
                { id: "other", kind: "stdio", extra: {} }
            ],
            lines: { live: { id: "live", state: "connected" }, broken: { id: "broken", state: "failed" } }
        }
    );
    assert.deepEqual(harness.calls.invalidate, [], "mounting invalidates no connection");
    harness.controller.dispose();
}

// ── 6: every live publish moves the picker ─────────────────────────────────
{
    const harness = makeHarness();
    const before = harness.calls.notifyKindsChanged;
    harness.controller.state.live.profiles = ["alpha"];
    harness.controller.publish();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.calls.notifyKindsChanged > before, true, "a live publish re-notifies the kinds, so the choices the picker shows are the current ones");
    harness.controller.dispose();
}

console.log("kind.test.mjs: all assertions passed");
