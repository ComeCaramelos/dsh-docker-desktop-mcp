/**
 * Host-side unit tests for the slash commands (/docker-profile, /docker-refresh)
 * injected by apply().
 *
 * Uses the same fake context / shim conventions as discovery.test.mjs.
 * Commands handler execution is tested directly: invoke the registered
 * handler with a synthetic CommandInvocation-like object and assert the
 * returned CommandResult.
 */
import * as assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../lib/index.js";

const NS = "docker-desktop-mcp";

// ── Fake docker shim ──────────────────────────────────────────────────────
function makeShim(opts = {}) {
    const { profilesJson = '[]', profilesOk = true } = opts;
    const dir = mkdtempSync(join(tmpdir(), "dshcmd-shim-"));
    const file = join(dir, "docker");
    writeFileSync(
        file,
        `#!/bin/sh
if [ "$1" = "version" ]; then printf '99.99.99\\n'; exit 0; fi
if [ "$1" = "mcp" ] && [ "$2" = "profile" ]; then
${profilesOk ? `    printf '${profilesJson}'\n    exit 0` : `    printf 'Error: profile store unavailable\\n' 1>&2\n    exit 1`}
fi
exit 1
`
    );
    chmodSync(file, 0o755);
    return { file, dir };
}

// ── Fake docker config ────────────────────────────────────────────────────
function makeConfig(command) {
    return {
        serverName: "docker",
        command,
        profile: "default",
        extraArgs: [],
        env: {},
        cwd: "",
        toolCallTimeoutMs: 60000,
        failOnStartupError: false,
        reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
    };
}

/**
 * Shared fake settings object.  The module's apply() closure captures the
 * reference that we mutate here, so overrides land where the command
 * handlers actually read it.
 */
function makeFakeSettings() {
    const user = {};
    const document = {};
    let currentEntry = {};
    const hooks = { current: undefined };

    const source = () => ({
        profile: "default",
        refreshNonce: 0,
        profiles: [],
        lastRefreshError: "",
        discoveryRevision: 0,
        ...currentEntry,
        ...(user[NS] ?? {})
    });

    const settings = {
        document,
        installSection(_ctx, _ns, _schema, entry, options) {
            currentEntry = entry;
            options.setSource(source);
            hooks.current = options;
            options.onChange(); // synchronous first commit
        },
        async mutate(sectionNs, ops) {
            const section = { ...(user[sectionNs] ?? {}) };
            for (const op of ops) {
                if (op.op === "set") section[op.path[0]] = op.value;
                else Reflect.deleteProperty(section, op.path[0]);
            }
            user[sectionNs] = section;
            document[sectionNs] = { ...section };
            hooks.current?.onChange();
        }
    };

    return {
        settings,
        /** Override settings.mutate for a test. Returns a reset function. */
        overrideMutate(fn) {
            const orig = settings.mutate;
            settings.mutate = fn;
            return () => { settings.mutate = orig; };
        },
        /** Source of truth after registration. */
        source,
        /** Reset everything for the next boot. */
        reset() {
            for (const key of Object.keys(user)) delete user[key];
            for (const key of Object.keys(document)) delete document[key];
            currentEntry = {};
            hooks.current = undefined;
        }
    };
}

/**
 * Minimal fake context that captures commands registrations and provides a
 * settings service mirroring the real dsh-settings contract.
 */
function makeCtx(fakeSettings) {
    const source = fakeSettings.source;
    const hooks = { current: undefined };

    const registered = [];
    const warnings = [];
    const errors = [];
    const disposers = [];
    const updates = [];
    let bridgeRef = undefined;
    /** Count of register-disposers fired; the cleanup test asserts this. */
    let offCalls = 0;

    // Use the shared settings object so the module's closure captures it.
    const settings = fakeSettings.settings;

    const ctx = {
        plugin(_plugin, config) {
            bridgeRef = { update: async (cfg) => void updates.push(cfg) };
            return bridgeRef;
        },
        effect(fn) {
            const disposer = fn();
            if (typeof disposer === "function") disposers.push(disposer);
        },
        inject(deps, callback) {
            if (deps.includes("commands")) {
                const fakeCommands = {
                    register(def) {
                        registered.push(def);
                        return () => { offCalls += 1; }; // disposer
                    }
                };
                callback({ commands: fakeCommands });
            }
            if (deps.includes("settings")) {
                callback({ settings });
            }
        },
        get(name) {
            if (name === "settings") return settings;
            if (name === "commands") return { isEmpty: () => true, register: () => () => {} };
            return undefined;
        },
        logger: {
            warn: (...args) => warnings.push(args.join(" ")),
            info: () => {},
            error: (...args) => errors.push(args.join(" "))
        }
    };

    return {
        ctx,
        settings,
        source,
        registered,
        warnings,
        errors,
        disposers,
        updates,
        /** Get a command handler by name. */
        getHandler(name) {
            const def = registered.find(r => r.name === name);
            return def ? def.handler : undefined;
        },
        /** Get all registered command names. */
        getNames() {
            return registered.map(r => r.name);
        },
        /** How many times a register() disposer has fired. */
        disposerCalls() {
            return offCalls;
        }
    };
}

/**
 * Build a synthetic CommandInvocation.
 */
function makeInvocation(rawInput, options = {}) {
    return {
        rawInput: rawInput ?? "",
        signal: options.signal ?? new AbortController().signal,
        agent: undefined,
        commandId: undefined,
        attachments: []
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────
/** Wait for condition, max 2000 iterations. */
async function settle(cond, { max = 2000 } = {}) {
    for (let i = 0; i < max; i++) {
        if (cond()) return true;
        await new Promise(r => setTimeout(r, 2));
    }
    return false;
}

// ── 1: command registration ──────────────────────────────────────────────
{
    const { file } = makeShim();
    const fs = makeFakeSettings();
    const h = makeCtx(fs);
    apply(h.ctx, makeConfig(file));

    const names = h.getNames();
    assert.ok(names.includes("docker-profile"), "docker-profile command registered");
    assert.ok(names.includes("docker-refresh"), "docker-refresh command registered");
    assert.equal(names.length, 2, "exactly two commands registered");

    assert.ok(typeof h.getHandler("docker-profile") === "function", "docker-profile has a handler");
    assert.ok(typeof h.getHandler("docker-refresh") === "function", "docker-refresh has a handler");

    // Registration metadata the registry itself demands (a blank hint is a
    // TypeError in @deepseek-ai/dsh-commands).
    for (const def of h.registered) {
        assert.ok(typeof def.input?.hint === "string" && def.input.hint.trim() !== "", `${def.name} advertises a non-empty input hint`);
    }

    // Plugin cleanup disposes the registrations: the register() disposers the
    // fake hands back must fire when the plugin ctx effect cleans up.
    assert.equal(h.disposerCalls(), 0, "disposers are not called before cleanup");
    for (const d of h.disposers) d();
    assert.equal(h.disposerCalls(), 2, "cleanup disposes both command registrations");

    fs.reset();
}

// ── 2: /docker-profile — no args ─────────────────────────────────────────
{
    const { file } = makeShim();
    const fs = makeFakeSettings();
    const h = makeCtx(fs);
    apply(h.ctx, makeConfig(file));
    await settle(() => h.source().discoveryRevision >= 1);

    const handler = h.getHandler("docker-profile");
    const result = await handler(makeInvocation(""));
    assert.equal(result.kind, "error");
    assert.ok(result.text.includes("Usage:"), "error includes usage");
    assert.ok(result.text.includes("Available:"), "error lists available");

    for (const d of h.disposers) d();
    fs.reset();
}

// ── 3: /docker-profile — multiple tokens (spaces) ────────────────────────
{
    const { file } = makeShim();
    const fs = makeFakeSettings();
    const h = makeCtx(fs);
    apply(h.ctx, makeConfig(file));
    await settle(() => h.source().discoveryRevision >= 1);

    const handler = h.getHandler("docker-profile");
    const result = await handler(makeInvocation("dev extra"));
    assert.equal(result.kind, "error");
    assert.ok(result.text.includes("one profile"), "rejects multiple tokens");

    for (const d of h.disposers) d();
    fs.reset();
}

// ── 4: /docker-profile — invalid profile id ──────────────────────────────
{
    const { file } = makeShim();
    const fs = makeFakeSettings();
    const h = makeCtx(fs);
    apply(h.ctx, makeConfig(file));

    const handler = h.getHandler("docker-profile");

    // Spaces
    const r1 = await handler(makeInvocation("dev profile"));
    assert.equal(r1.kind, "error", "rejects spaces");
    assert.ok(r1.text.includes("one profile"), "rejects multiple tokens");

    // Too long (129 chars)
    const longId = "a".repeat(129);
    const r2 = await handler(makeInvocation(longId));
    assert.equal(r2.kind, "error", "rejects 129-char id");
    assert.ok(r2.text.includes("Invalid profile"), "mentions pattern");

    // Exactly 128 chars — valid
    const maxId = "a".repeat(128);
    const r3 = await handler(makeInvocation(maxId));
    assert.equal(r3.kind, "success", "accepts 128-char id");

    for (const d of h.disposers) d();
    fs.reset();
}

// ── 5: /docker-profile — valid profile persists and applies ──────────────
{
    const { file } = makeShim({ profilesJson: '[{"id":"alpha"},{"id":"beta"}]' });
    const fs = makeFakeSettings();
    const h = makeCtx(fs);
    apply(h.ctx, makeConfig(file));
    await settle(() => h.source().discoveryRevision >= 1);

    const handler = h.getHandler("docker-profile");
    const result = await handler(makeInvocation("alpha"));
    assert.equal(result.kind, "success", "handler returns success");
    assert.ok(result.text.includes("selected"), "message confirms selection");
    assert.equal(h.source().profile, "alpha", "settings persisted the profile");

    for (const d of h.disposers) d();
    fs.reset();
}

// ── 6: /docker-profile — bridge already started ──────────────────────────
{
    const { file } = makeShim({ profilesJson: '[{"id":"alpha"},{"id":"beta"}]' });
    const fs = makeFakeSettings();
    const h = makeCtx(fs);
    apply(h.ctx, makeConfig(file));
    await settle(() => h.updates.length > 0); // bridge was updated

    const handler = h.getHandler("docker-profile");
    const result = await handler(makeInvocation("alpha"));
    assert.equal(result.kind, "success");
    assert.ok(result.text.includes("reconnecting"), "bridge started: mentions reconnecting");
    assert.equal(h.source().profile, "alpha", "settings persisted new profile");

    for (const d of h.disposers) d();
    fs.reset();
}

// ── 6b: /docker-profile — already-active profile is a no-op report ───────
{
    const { file } = makeShim({ profilesJson: '[{"id":"alpha"},{"id":"beta"}]' });
    const fs = makeFakeSettings();
    const h = makeCtx(fs);
    apply(h.ctx, makeConfig(file));
    await settle(() => h.updates.length > 0);

    const handler = h.getHandler("docker-profile");
    const first = await handler(makeInvocation("alpha"));
    assert.equal(first.kind, "success");
    const updatesAfterFirst = h.updates.length;

    const second = await handler(makeInvocation("alpha"));
    assert.equal(second.kind, "success");
    assert.ok(second.text.includes("already active"), "re-selecting the running profile says already active");
    assert.equal(h.updates.length, updatesAfterFirst, "no extra bridge update for a no-op switch");

    for (const d of h.disposers) d();
    fs.reset();
}

// ── 7: /docker-profile — profile not in discovered list (allowed) ────────
{
    const { file } = makeShim({ profilesJson: '[]' });
    const fs = makeFakeSettings();
    const h = makeCtx(fs);
    apply(h.ctx, makeConfig(file));
    await settle(() => h.source().discoveryRevision >= 1);

    const handler = h.getHandler("docker-profile");
    const result = await handler(makeInvocation("new-profile"));
    assert.equal(result.kind, "success", "allows profile not in discovered list");
    assert.equal(h.source().profile, "new-profile", "still persisted");

    for (const d of h.disposers) d();
    fs.reset();
}

// ── 8: /docker-profile — settings mutate fails ───────────────────────────
{
    const { file } = makeShim();
    const fs = makeFakeSettings();
    const h = makeCtx(fs);
    const restoreMutate = fs.overrideMutate(async () => {
        throw new Error("write failed");
    });

    apply(h.ctx, makeConfig(file));
    await settle(() => h.source().discoveryRevision >= 1);

    const handler = h.getHandler("docker-profile");
    const result = await handler(makeInvocation("test"));
    assert.equal(result.kind, "error", "returns error on mutate failure");
    assert.ok(result.text.includes("Failed to persist"), "mentions persist failure");

    restoreMutate();
    for (const d of h.disposers) d();
    fs.reset();
}

// ── 9: /docker-refresh — discovery succeeds ──────────────────────────────
{
    const { file } = makeShim({ profilesJson: '[{"id":"alpha","name":"Alpha"},{"id":"beta","name":"Beta"}]' });
    const fs = makeFakeSettings();
    const h = makeCtx(fs);
    apply(h.ctx, makeConfig(file));
    // Initial discovery settles, then we trigger another
    await settle(() => h.source().discoveryRevision >= 1);

    const handler = h.getHandler("docker-refresh");
    const result = await handler(makeInvocation());
    assert.equal(result.kind, "success");
    assert.ok(result.text.includes("Discovered 2 profile"), "includes profile count");
    assert.ok(result.text.includes("alpha"), "lists profile ids");

    for (const d of h.disposers) d();
    fs.reset();
}

// ── 10: /docker-refresh — discovery fails ────────────────────────────────
{
    const { file } = makeShim({ profilesOk: false });
    const fs = makeFakeSettings();
    const h = makeCtx(fs);
    apply(h.ctx, makeConfig(file));
    // Wait for the initial failed discovery
    await settle(() => h.source().lastRefreshError !== "");

    const handler = h.getHandler("docker-refresh");
    const result = await handler(makeInvocation());
    assert.equal(result.kind, "error", "returns error when discovery fails");
    assert.ok(result.text.includes("Error: profile store"), "includes failure reason");

    for (const d of h.disposers) d();
    fs.reset();
}

// ── 11: /docker-refresh — with no arguments and with arguments (same result) ─
{
    const { file } = makeShim();
    const fs = makeFakeSettings();
    const h = makeCtx(fs);
    apply(h.ctx, makeConfig(file));
    await settle(() => h.source().discoveryRevision >= 1);

    const handler = h.getHandler("docker-refresh");
    const r1 = await handler(makeInvocation());
    assert.equal(r1.kind, "success");

    const r2 = await handler(makeInvocation("extra"));
    assert.equal(r2.kind, "success", "ignores extra input");

    for (const d of h.disposers) d();
    fs.reset();
}

// ── 12: /docker-profile — no commands service → no crash ─────────────────
{
    const { file } = makeShim();
    const fs = makeFakeSettings();

    const registered = [];
    const disposers = [];
    let bridgeRef = undefined;

    const settings = fs.settings;
    const ctx = {
        plugin(_plugin, config) {
            bridgeRef = { update: async (cfg) => cfg };
            return bridgeRef;
        },
        effect(fn) { fn(); },
        inject(deps, callback) {
            // Only settings, no commands
            if (deps.includes("settings")) {
                callback({ settings });
            }
        },
        get() { return undefined; },
        logger: { warn: () => {}, info: () => {}, error: () => {} }
    };

    // This should NOT throw — commands registration is inside ctx.inject
    // which only fires when the provider is available.
    apply(ctx, makeConfig(file));
    // If we get here without throwing, the test passes.
    assert.ok(true, "no commands service → no crash");
    for (const d of disposers) d();
    fs.reset();
}

console.log("commands.test.mjs: all assertions passed");
