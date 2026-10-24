/**
 * The two slash commands, driven directly off one live controller.
 *
 * Both are the headless mirror of what the Web card does, and both speak to the
 * **connection**, not the row: `/docker-profile` writes `extra.profile` through
 * the manager's own write channel (so pill, command and running gateway always
 * agree), and `/docker-refresh` merges what discovery reported into the saved
 * rows. What the row config carries is only what a person edits.
 *
 * So every case here stands a manager — and one whose answers the command can
 * contradict:
 *
 *   - no manager mounted → nothing to write (the row runs nothing on its own);
 *   - a manager with no `docker-profile` entry → the same, with the saved rows
 *     named as what a picker would offer;
 *   - a refused write (a read-only row) → the failure says *why*.
 *
 * A healthy, non-empty discovery list is AUTHORITATIVE (the same rule the
 * picker's choices follow); an empty or failed list is not, so a write is
 * allowed there — the last write wins over what discovery might be hiding.
 */
import * as assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createController } from "../lib/host/controller/index.js";
import { createProfileCommand } from "../lib/host/commands/profile.js";
import { createRefreshCommand } from "../lib/host/commands/refresh.js";
import { profileChoices, DISCOVERY_RETRY_DELAY_MS } from "../lib/index.js";
import { writeFakeDocker } from "./fake-docker.mjs";

const ENTRY_ID = "mcp-docker";
const KIND_ID = "docker-profile";
/** The fields a served config hands as a live reference (`.volatile()`). */
const LIVE_FIELDS = [
    "profileEntries", "executables", "refreshNonce", "refreshExecutablesNonce", "migrationDismissed",
    "effectiveCommand", "effectiveSource", "stderrEffective", "profiles", "executableCandidates",
    "lastRefreshError", "discoveryRevision", "executableDiscoveryRevision"
];

// Retry timers must not run on the wall clock: the profile-store retry budget
// is 15 s × 4, so a suite that let them stand would wait a minute per failed run.
const retryTimers = [];
globalThis.setTimeout = (fn, ms) => {
    if (ms >= DISCOVERY_RETRY_DELAY_MS) {
        const entry = { fn };
        retryTimers.push(entry);
        return entry;
    }
    return realSetTimeout(fn, ms);
};
globalThis.clearTimeout = (id) => {
    if (id !== null && typeof id === "object" && "fn" in id) return;
    realClearTimeout(id);
};

/** Dispose a controller and drop whatever retry timer it left standing. */
function shutdown(controller) {
    controller.dispose();
    retryTimers.length = 0;
}
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;

function makeShim({ profilesJson = "[]", profilesOk = true } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "dshdm-cmd-"));
    // A Node shim behind a sh/.cmd launcher: the same fake on POSIX and Windows.
    const file = writeFakeDocker(dir, { profilesJson, profilesOk });
    return { file, dir };
}

/**
 * One live controller over a fake row. `connections` stands what the manager
 * answers with: an entry list (the live connections of this kind), the write
 * channel and — when absent — no manager at all.
 */
function makeHarness({ command = "", user = {}, connections } = {}) {
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
    const state = { writes: [], updates: [], refused: false };
    const entry = { options: { id: ENTRY_ID, config: { ...base } }, update: (next) => { entry.options.config = { ...entry.options.config, ...next.config }; } };
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
        configure: () => () => void 0
    };
    // Only the `.volatile()` fields arrive as references; an ordinary field is
    // a plain value even on a served row.
    const config = {};
    for (const [key, value] of Object.entries(base)) {
        config[key] = LIVE_FIELDS.includes(key)
            ? { get: () => (Object.prototype.hasOwnProperty.call(layer, key) ? layer[key] : value) }
            : value;
    }
    const service = connections === undefined ? undefined : {
        registerKind: () => () => void 0,
        notifyKindsChanged: () => void 0,
        entries: () => connections.entries ?? [],
        propose: () => () => void 0,
        update: async (id, patch) => {
            state.updates.push({ id, patch });
            if (connections.refused === true) return false;
            for (const [key, value] of Object.entries(patch.extra ?? {})) {
                const row = (connections.entries ?? []).find((candidate) => candidate.id === id);
                if (row !== void 0) row.extra[key] = value;
            }
            return true;
        }
    };
    const logs = [];
    const ctx = {
        logger: { warn: (...args) => logs.push(args.map(String).join(" ")), info: () => void 0, error: (...args) => logs.push(args.map(String).join(" ")) },
        fiber: { state: 2, entry, await: async () => void 0 },
        get: (name) => (name === "settings" ? settings : void 0),
        on: () => () => void 0,
        inject: (deps, callback) => {
            if (deps.includes("settings")) callback({ settings });
            if (deps.includes("mcpConnections") && service !== void 0) callback({ mcpConnections: service });
        },
        effect: (execute) => { execute(); }
    };
    const controller = createController(ctx, config);
    controller.state.connections = service;
    // The Host's own writes (the merge, a dismissal) go through the attached
    // form; standing it here is what `installDockerMcpForm` would do.
    controller.attachForm({
        current: () => ({ entryId: ENTRY_ID, settings }),
        liveKeys: () => ["effectiveCommand", "effectiveSource", "stderrEffective", "profiles", "executableCandidates", "lastRefreshError", "discoveryRevision", "executableDiscoveryRevision"],
        attached: () => true
    });
    return { controller, config, entry, layer, state };
}

/** One saved connection of this component's kind. */
const connection = (extra = {}, id = "docker-mcp") => ({ id, kind: KIND_ID, extra });

/** Run `/docker-profile <input>`; returns the handler's own answer. */
async function profile(harness, input) {
    return (await createProfileCommand(harness.controller).handler({ rawInput: input })).text;
}
async function refresh(harness) {
    return (await createRefreshCommand(harness.controller).handler({ rawInput: "" })).text;
}

// ── 1: no manager means nothing to write — a silent no-op is the wrong answer ─
{
    const harness = makeHarness({ connections: void 0 });
    const text = await profile(harness, "alpha");
    assert.equal(text.includes("no MCP Connections manager is mounted"), true, "the command says there is nothing to write");
    shutdown(harness.controller);
    assert.equal(harness.state.updates.length, 0, "nothing is written");
    shutdown(harness.controller);
}

// ── 2: a manager with no connection of this kind ─────────────────────────────
{
    const harness = makeHarness({ connections: { entries: [] }, user: { profileEntries: [{ id: "saved", name: "Saved" }] } });
    const text = await profile(harness, "alpha");
    assert.equal(text.includes("No Docker MCP Toolkit connection exists yet"), true, "the command names the missing connection");
    assert.equal(text.includes("saved"), true, "the saved rows are offered as what a picker would show");
    assert.equal(harness.state.updates.length, 0, "the absence is not answered with a write");
    shutdown(harness.controller);
}

// ── 3: a write lands on the CONNECTION, not on this row's config ─────────────
{
    const live = connection({ profile: "default" });
    const harness = makeHarness({ connections: { entries: [live] } });
    const text = await profile(harness, "alpha");
    assert.equal(text.includes('Profile "alpha" selected'), true, "a successful write reads as a switch");
    assert.deepEqual(harness.state.updates, [{ id: live.id, patch: { extra: { profile: "alpha" } } }], "the write goes to the entry's extra profile");
    assert.equal(live.extra.profile, "alpha", "the entry is what stands differently afterwards");
    assert.equal(harness.state.writes.length, 0, "the row's own config is untouched by a connection switch");

    // Already what it runs with: nothing to do, and it says so.
    const again = await profile(harness, "alpha");
    assert.equal(again.includes("already"), true, "a no-op switch is answered, not repeated");
    shutdown(harness.controller);
}

// ── 4: the authoritative-list rule, the same one the picker follows ──────────
{
    const live = connection({ profile: "default" });
    const harness = makeHarness({ connections: { entries: [live] } });
    harness.controller.state.live.profiles = ["alpha", "beta"];
    const refused = await profile(harness, "gamma");
    assert.equal(refused.includes('Unknown profile "gamma"'), true, "an id a healthy list did not report is refused");
    assert.equal(refused.includes("alpha, beta"), true, "the refusal lists what is available");

    const accepted = await profile(harness, "beta");
    assert.equal(accepted.includes('Profile "beta" selected'), true, "an id the list reported is accepted");

    // A saved row's id counts as known too, so a picker row never disappears.
    harness.controller.state.live.profiles = ["alpha"];
    harness.layer.profileEntries = [{ id: "keep", name: "Keep" }];
    const kept = await profile(harness, "keep");
    assert.equal(kept.includes('Profile "keep" selected'), true, "a saved row's id is never refused");
    shutdown(harness.controller);
}

// ── 5: an empty or failed list is not trustworthy — the write stands ─────────
{
    const live = connection({ profile: "default" });
    const harness = makeHarness({ connections: { entries: [live] } });
    harness.controller.state.live.lastRefreshError = "profile store unavailable";
    const text = await profile(harness, "anything");
    assert.equal(text.includes('Profile "anything" selected'), true, "an untrustworthy store never blocks the last write");

    const invalid = await profile(harness, "bad/profile!");
    assert.equal(invalid.includes("Invalid profile id"), true, "the pattern is enforced before anything else");

    const spaced = await profile(harness, "two words");
    assert.equal(spaced.includes("Exactly one profile id"), true, "one id, never two");
    shutdown(harness.controller);
}

// ── 6: a refused write says why — a read-only row is the user's own situation ─
{
    const live = connection({ profile: "default" });
    const harness = makeHarness({ connections: { entries: [live], refused: true } });
    const text = await profile(harness, "alpha");
    assert.equal(text.includes("refused the write"), true, "the refusal is reported, not swallowed");
    assert.equal(text.includes("read-only"), true, "and it names the reason a person can act on");
    shutdown(harness.controller);
}

// ── 7: the usage line answers with the live discoveries, saved rows first ────
{
    const live = connection({ profile: "default" });
    const harness = makeHarness({ connections: { entries: [live] } });
    harness.controller.state.live.profiles = ["alpha"];
    harness.layer.profileEntries = [{ id: "saved", name: "Saved" }];
    const text = await profile(harness, "");
    assert.equal(text.includes("Usage: /docker-profile <profile-id>"), true, "the usage line is what an empty call answers with");
    assert.equal(text.includes("alpha") && text.includes("saved"), true, "both answers are listed");
    shutdown(harness.controller);
}

// ── 8: /docker-refresh merges what discovery found into the saved rows ───────
{
    const { file } = makeShim({ profilesJson: '[{"id":"alpha","name":"Alpha"},{"id":"beta","name":"Beta"}]' });
    const live = connection({ profile: "default" }, "docker");
    const harness = makeHarness({ command: file, connections: { entries: [live] }, user: { profileEntries: [{ id: "keep", name: "Keep" }] } });
    const text = await refresh(harness);
    assert.equal(text.includes("merged into the saved rows"), true, "the merge is reported, not silent");
    const rows = harness.layer.profileEntries;
    assert.deepEqual(rows.map((row) => row.id), ["keep", "alpha", "beta"], "saved rows keep their order and names; discoveries land last and nameless");
    assert.deepEqual(rows[0], { id: "keep", name: "Keep" }, "the kept row keeps its custom name");
    assert.equal(harness.state.writes.length >= 1, true, "the merge is what gets persisted");

    // A second run finds nothing new: the rows stand, and it says so.
    const again = await refresh(harness);
    assert.equal(again.includes("Discovered 2 profile(s)"), true, "the second run still reports the discovery");
    assert.equal(again.includes("merged"), false, "and merges nothing the rows already carry");
    shutdown(harness.controller);
}

// ── 9: a failed discovery is the CLI's own line, not a generic failure ───────
{
    const { file } = makeShim({ profilesOk: false });
    const harness = makeHarness({ command: file, connections: { entries: [connection({}, "docker")] } });
    const text = await refresh(harness);
    assert.equal(text.includes("profile store unavailable"), true, "the CLI's own line is what the command answers with");
    shutdown(harness.controller);
}

// ── 10: profileChoices is what the manager's picker reads ────────────────────
{
    const saved = [{ id: "keep", name: "Keep" }, { id: "alpha", name: "Alpha" }];
    const choices = profileChoices({ profiles: ["alpha", "beta"], lastRefreshError: "" }, saved);
    assert.deepEqual(choices.map((choice) => choice.value), ["keep", "alpha", "beta"], "saved rows come first, then what discovery reported");
    assert.deepEqual(choices.map((choice) => choice.label), ["Keep", "Alpha", "beta"], "a custom name is what the picker shows");

    // A failed or empty run says nothing about the store: `default` stays offered.
    const failed = profileChoices({ profiles: [], lastRefreshError: "boom" }, []);
    assert.deepEqual(failed.map((choice) => choice.value), ["default"], "a failed run keeps the fallback option");
}

console.log("commands.test.mjs: all assertions passed");
