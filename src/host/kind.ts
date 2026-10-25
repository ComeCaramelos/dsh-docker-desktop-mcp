/**
 * The `docker-profile` connection kind — the live half, seen from this component.
 *
 * The manager's pool starts, switches and stops the connection; what this module
 * answers is what it needs: what each `select` offers (the saved rows plus
 * whatever discovery reported), how one entry turns into the fixed
 * `docker mcp gateway run --profile <id>` argv, and what preparing costs — the
 * bounded readiness wait for the executable that entry names.
 *
 * Three properties of the kind decide how the card behaves:
 *
 * - `transport: "none"` — this kind owns everything through its `fields`, so the
 *   core's stdio/http fields stay hidden and what the entry's editor shows is
 *   exactly the profile, the executable and the console-output choice.
 * - `maxEntries: 1` — the composer pill points at *the* connection of this kind,
 *   so a second one has no pill and no answer. A second entry is reported
 *   `conflict` ("only one Docker MCP Toolkit connection is allowed"), never a
 *   silently-dropped row.
 * - `resolve()` is **async**: preparing is the readiness gate plus one
 *   profile-list run. The pool caches the preparation per entry, so the wait is
 *   once per state, not once per tick.
 *
 * The choices a `select` offers are **Host-served**: read off the live mirror
 * when the manager asks for them. `notifyKindsChanged` (installed by
 * ./manager.ts) is what says "what they would answer moved" — that is how a
 * discovery run shows up in a picker.
 */
import type { KindOption, McpKind, ResolvedConnection, ServerEntry } from "@comecaramelos/dsh-mcp-manager/api";
import { DOCKER_MARK_PATHS, KIND_FIELDS, KIND_ID, KIND_LABEL, KIND_MAX_ENTRIES, KIND_SUMMARY, PROFILE_PATTERN } from "./constants.js";
import { resolveDockerCommand } from "./docker.js";
import { gatewayConfig } from "./gateway.js";
import { resolveProfileFromConfig, resolveStderrMode } from "./values.js";
import type { Controller } from "./controller/index.js";
import type { CatalogEntry } from "./types/settings.js";

/**
 * What the profile field offers: every saved row (a name the user gave is worth
 * more than the bare id discovery reported), then whatever the last run
 * reported.
 *
 * A healthy, non-empty discovery list is authoritative — `default` appears only
 * when the store actually reported it, never as a phantom. A failed or empty run
 * says nothing about the store, so `default` stays offered as the fallback. A
 * stored pick the answers stopped carrying is kept offered by the card itself,
 * so it never silently becomes another one.
 * @param live - the mirror's profile answers.
 * @param saved - the saved profile rows.
 */
export function profileChoices(live: { profiles: readonly string[]; lastRefreshError: string }, saved: readonly CatalogEntry[]): readonly KindOption[] {
    const seen = new Map<string, KindOption>();
    for (const row of saved) {
        if (row.id === "") continue;
        seen.set(row.id, { value: row.id, label: row.name === "" ? row.id : row.name });
    }
    const healthy = live.lastRefreshError === "" && live.profiles.length > 0;
    const ids = healthy || live.profiles.length > 0 ? live.profiles : ["default"];
    for (const id of ids) {
        if (!seen.has(id)) seen.set(id, { value: id, label: id });
    }
    if (!healthy && !seen.has("default")) seen.set("default", { value: "default", label: "default" });
    return [...seen.values()];
}

/**
 * What the executable field offers: the saved rows first, then every path the
 * filesystem scan found, then what a live connection actually runs — the running
 * path is the answer the Host knows best, and it may not be a saved row yet.
 * @param live - the mirror's executable answers.
 * @param saved - the saved executable rows.
 * @param running - the executable the live connection runs with.
 */
export function executableChoices(live: { executableCandidates: readonly string[] }, saved: readonly CatalogEntry[], running: string): readonly KindOption[] {
    const seen = new Map<string, KindOption>();
    for (const row of saved) {
        if (row.id === "") continue;
        seen.set(row.id, { value: row.id, label: row.name === "" ? row.id : row.name });
    }
    for (const path of live.executableCandidates) {
        if (!seen.has(path)) seen.set(path, { value: path, label: path });
    }
    if (running !== "" && !seen.has(running)) seen.set(running, { value: running, label: running });
    return [...seen.values()];
}

/**
 * The profile one entry runs with: its own `extra.profile`, else the launch
 * environment's `DSH_DOCKER_MCP_PROFILE`, else the row config, else the schema
 * default. A value the pattern refuses is never picked and never thrown — it is
 * a mis-set value, not a broken row.
 * @param entry - the connection as the manager's row names it.
 * @param controller - the live state (for the environment and row answers).
 */
export function entryProfile(entry: ServerEntry, controller: Controller): string {
    const picked = typeof entry.extra[KIND_FIELDS.profile] === "string" ? String(entry.extra[KIND_FIELDS.profile]).trim() : "";
    // A picked id stands as it was picked, usable or not. The unusable case is
    // answered by the caller — a profile that was *edited to* something the
    // pattern refuses must not quietly run `default` instead, because the last
    // write is what the editor is claiming. Everything that answers as a
    // fallback (the environment, the row config) stays tolerant.
    if (picked !== "") return picked;
    return resolveProfileFromConfig(controller.config, controller.state.envProfile);
}

/**
 * The executable one entry runs with: its picked path, else the row config's
 * with the WSL host-CLI rewrite applied (which touches only the literal default).
 * @param entry - the connection as the row names it.
 * @param controller - the live state.
 */
export function entryCommand(entry: ServerEntry, controller: Controller): string {
    const picked = typeof entry.extra[KIND_FIELDS.dockerPath] === "string" ? String(entry.extra[KIND_FIELDS.dockerPath]).trim() : "";
    if (picked !== "") return picked;
    const configured = controller.config.dockerPath.trim();
    if (configured !== "") return configured;
    return resolveDockerCommand(controller.config.command);
}

/**
 * The console-output mode one entry runs with: its own pick, else the row
 * config's answer. Never a third state.
 * @param entry - the connection as the row names it.
 * @param controller - the live state.
 */
export function entryStderrMode(entry: ServerEntry, controller: Controller): "log" | "console" {
    const picked = entry.extra[KIND_FIELDS.stderrMode];
    if (picked === "console") return "console";
    if (picked === "log") return "log";
    return resolveStderrMode(controller.config);
}

/**
 * The arguments appended after `--profile`: the entry's own, else the row
 * config's. The argv shape is fixed, so these are the only way it moves.
 * @param entry - the connection as the row names it.
 * @param controller - the live state.
 */
export function entryExtraArgs(entry: ServerEntry, controller: Controller): string[] {
    const own = Array.isArray(entry.args) ? entry.args.filter((arg) => typeof arg === "string" && arg !== "") : [];
    return own.length > 0 ? own : controller.config.extraArgs;
}

/** One reason an entry cannot run, phrased once. */
const BAD_PROFILE = "the profile must be 1–128 characters of A-Z a-z 0-9 or \".\" \"_\" \"-\"";
const NO_EXECUTABLE = "no `docker` executable could be found — install Docker Desktop, or save its path in the executable catalog";

/**
 * One `docker-profile` kind, bound to one live controller.
 * @param controller - the live state every answer is read from.
 */
export function createDockerKind(controller: Controller): McpKind {
    const state = controller.state;
    const kind: McpKind = {
        id: KIND_ID,
        label: KIND_LABEL,
        summary: KIND_SUMMARY,
        builtIn: false,
        transport: "none",
        maxEntries: KIND_MAX_ENTRIES,
        icon: DOCKER_MARK_PATHS,
        fields: [
            {
                key: KIND_FIELDS.profile,
                label: "Profile",
                type: "select",
                placeholder: "default",
                help: "The profile `docker mcp gateway run --profile` starts with. Choices come from what the Host discovered.",
                composer: true,
                options: () => profileChoices({ profiles: state.live.profiles, lastRefreshError: state.live.lastRefreshError }, controller.profileEntries())
            },
            {
                key: KIND_FIELDS.dockerPath,
                label: "Docker executable",
                type: "select",
                placeholder: "auto",
                help: "Which `docker` runs the gateway: the saved rows, plus every path the scan found.",
                options: () => executableChoices({ executableCandidates: state.live.executableCandidates }, controller.executables(), state.currentCommand)
            },
            {
                key: KIND_FIELDS.stderrMode,
                label: "Reduce gateway log output",
                type: "select",
                placeholder: "log",
                help: "A log file keeps the gateway's progress lines off the console; print echoes them.",
                options: [
                    { value: "log", label: "Log file" },
                    { value: "console", label: "Print to console" }
                ]
            }
        ],
        /** Prepare and resolve: the readiness gate for THIS executable, the
         * fixed argv, and the answer's reason — never a spawn that cannot work.
         * An entry that cannot run says why, in the line the card shows. */
        async resolve(entry: ServerEntry): Promise<ResolvedConnection> {
            const profile = entryProfile(entry, controller);
            if (!PROFILE_PATTERN.test(profile)) {
                return { error: `profile "${profile}" is not usable — ${BAD_PROFILE}` };
            }
            const command = entryCommand(entry, controller);
            if (command === "") return { error: NO_EXECUTABLE };
            const stderrMode = entryStderrMode(entry, controller);
            await controller.prepare(command);
            const spawned = gatewayConfig({
                command,
                profile,
                extraArgs: entryExtraArgs(entry, controller),
                stderr: stderrMode,
                logPath: controller.config.gatewayStderrLog,
                serverName: entry.id,
                env: controller.config.env,
                cwd: controller.config.cwd,
                toolCallTimeoutMs: controller.config.toolCallTimeoutMs,
                failOnStartupError: controller.config.failOnStartupError,
                reconnect: controller.config.reconnect
            });
            controller.noteRunning(command, stderrMode === "console");
            return {
                config: spawned.config as never,
                note: spawned.redirect === "" ? "" : `gateway stderr → ${spawned.redirect}`
            };
        }
    };
    return kind;
}
