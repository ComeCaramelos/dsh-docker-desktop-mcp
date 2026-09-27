/**
 * The `docker-desktop-mcp` settings section.
 *
 * Installs the namespace the Web GUI card edits, and routes every commit into
 * the controller: a switch of the profile or executable, a stderr-mode toggle,
 * or a refresh request. Two contract details decide the shape of this module:
 *
 * - `installSection` runs `hooks.onChange()` synchronously at registration,
 *   which is how a persisted profile/executable/stderr mode lands on the FIRST
 *   connection when the settings service is already up (the cold path is
 *   `readPersisted*` in ./values.ts).
 * - The served `describe()` value is recomputed only when the USER section is
 *   written, so base-layer-only state (discovery results) reaches clients
 *   through the host's own negative `refreshNonce` bump — owned by the
 *   controller and pushed after every run.
 */
import { COMMAND_PATTERN, PROFILE_PATTERN, SETTINGS_NAMESPACE } from "./constants.js";
import { SettingsSchema } from "./schema.js";
import { resolveEffectiveCommand, resolveStderrMode } from "./values.js";
import type { DockerMcpConfig, PluginContext, SettingsOp, SettingsService, SettingsResolved } from "./types/index.js";
import type { GatewayController } from "./controller/index.js";

/** Base-layer-only keys earlier versions persisted into the user layer. */
const PERSISTED_BASE_KEYS = ["profiles", "lastRefreshError", "discoveryRevision", "effectiveCommand", "rowStderr", "executableCandidates"] as const;

/**
 * Validate the resolved settings value.
 *
 * `stderrMode` MUST accept the empty string alongside "log"/"console": a fresh
 * `settings.yaml` resolves it to "", and a strict non-empty check throws inside
 * `installSection` — a caught, console-invisible error that leaves the settings
 * gate unresolved, so the plugin never discovers (this bit us live: empty-home
 * boots failed while seeded ones worked).
 *
 * The two catalog lists are NOT validated here: every row is normalized when
 * read/merged (see ./catalog.ts), so an odd persisted row can never throw its
 * way into the settings gate.
 */
export function validateSettings(value: SettingsResolved): void {
    if (!PROFILE_PATTERN.test(value.profile)) {
        throw new Error(`settings "${SETTINGS_NAMESPACE}": profile must match ${PROFILE_PATTERN}`);
    }
    if (value.command !== "" && !COMMAND_PATTERN.test(value.command)) {
        throw new Error(`settings "${SETTINGS_NAMESPACE}": command must be a single trimmed path/command with no control characters`);
    }
    if (value.stderrMode !== "" && value.stderrMode !== "log" && value.stderrMode !== "console") {
        throw new Error(`settings "${SETTINGS_NAMESPACE}": stderrMode must be "log", "console" or empty (row-config default)`);
    }
}

/**
 * The per-apply commit router, created by {@link installSettingsSection}.
 *
 * The refresh trigger: a POSITIVE nonce change is a user refresh; the FIRST
 * commit is not (the readiness continuation schedules that run instead) and a
 * value this instance pushed itself (or echoed) is not either. A NEGATIVE
 * change this instance did not write came from a SIBLING instance sharing the
 * same `settings.yaml` and is answered with an echo run — never broadcast.
 */
export type SettingsCommitRouter = (current: SettingsResolved) => void;

/**
 * Build the commit router for one apply.
 *
 * @param config - validated row config.
 * @param controller - the live gateway controller.
 */
export function createSettingsRouter(config: DockerMcpConfig, controller: GatewayController): SettingsCommitRouter {
    /** Last observed refreshNonce; `undefined` until the first settings commit. */
    let lastNonce: number | undefined = void 0;
    /** Same for the executable-catalog trigger. */
    let lastExecNonce: number | undefined = void 0;

    return (current) => {
        // Executable-override changes (including an empty value that falls back
        // to the auto-resolved row config) switch the bridge AND re-discover: a
        // different executable reads a different profile store. A
        // same-executable profile change only switches. Order matters: the
        // executable switch already updates the running profile, so skip the
        // profile-only switch when both land in one commit.
        const nextCommand = resolveEffectiveCommand(current.command, config.command);
        const commandChanged = nextCommand !== controller.runningCommand;
        if (commandChanged) {
            controller.switchConnection(current.profile, nextCommand);
            // A live bridge must restart its discovery on the new executable;
            // while the first start is still gated on readiness the scheduled
            // run already reads the updated executable, so an extra run would be
            // redundant.
            if (controller.started) void controller.runDiscovery();
        } else if (current.profile !== controller.runningProfile) controller.switchProfile(current.profile);

        // The "Reduce log output" toggle lives here too: a change of the
        // effective stderr mode restarts the gateway connection with/without
        // the stderr-capturing wrapper, and is independent of the profile and
        // executable branches above.
        const nextStderrMode = resolveStderrMode(current.stderrMode, config.gatewayStderr);
        if (nextStderrMode !== controller.runningStderrMode) controller.applyStderrMode(nextStderrMode);

        if (current.refreshNonce !== lastNonce) {
            const firstCommit = lastNonce === void 0;
            lastNonce = current.refreshNonce;
            if (!firstCommit && current.refreshNonce !== controller.pushedNonce) {
                if (typeof current.refreshNonce === "number" && current.refreshNonce < 0) void controller.runDiscovery({ echo: current.refreshNonce });
                else void controller.runDiscovery();
            }
        }

        // The executable catalog's own refresh trigger: same sign convention as
        // the profile nonce (a POSITIVE change is a user fetch, a NEGATIVE one
        // this instance did not write is a sibling marker answered with an echo
        // run, and the FIRST commit never triggers anything).
        if (current.refreshExecutablesNonce !== lastExecNonce) {
            const firstCommit = lastExecNonce === void 0;
            lastExecNonce = current.refreshExecutablesNonce;
            if (!firstCommit && current.refreshExecutablesNonce !== controller.pushedExecNonce) {
                if (typeof current.refreshExecutablesNonce === "number" && current.refreshExecutablesNonce < 0) {
                    void controller.runExecutablesDiscovery({ echo: current.refreshExecutablesNonce });
                } else void controller.runExecutablesDiscovery();
            }
        }
    };
}

/**
 * Install the namespace on the `settings` service.
 *
 * Called from the plugin's `ctx.inject(["settings"], …)`, i.e. only when the
 * host actually provides the service — the plugin is inert without it (the
 * bridge still runs on env/row-config resolution).
 *
 * @param ctx - plugin context.
 * @param config - validated row config.
 * @param controller - the live gateway controller.
 */
export function installSettingsSection(ctx: PluginContext, config: DockerMcpConfig, controller: GatewayController): void {
    const commit = createSettingsRouter(config, controller);
    ctx.inject(["settings"], (settingsCtx: PluginContext) => {
        const settings = (settingsCtx as unknown as { settings: SettingsService }).settings;
        settings.installSection(ctx, SETTINGS_NAMESPACE, SettingsSchema, controller.entry, {
            setSource: (source) => controller.setSource(source),
            validate: validateSettings,
            onChange: () => {
                try {
                    commit(controller.source());
                } catch (error) {
                    ctx.logger.error(`docker-desktop-mcp(${config.serverName}): ${String(error)}`);
                }
            }
        });
        controller.attachSettings(settings);
        // Legacy migration: earlier versions persisted the discovery state into
        // the user layer, and the base-layer fields must never be persisted —
        // unset them so `settings.yaml` carries only user-authored fields (the
        // raw-section change also re-serves the fresh base layer to open
        // clients).
        void Promise.resolve()
            .then(() => {
                const section = settings.document?.[SETTINGS_NAMESPACE];
                const ops: SettingsOp[] = [];
                if (section !== null && typeof section === "object" && !Array.isArray(section)) {
                    for (const key of PERSISTED_BASE_KEYS) {
                        if (key in section) ops.push({ op: "unset", path: [key] });
                    }
                }
                if (ops.length === 0) return;
                return settings.mutate(SETTINGS_NAMESPACE, ops);
            })
            .catch((error) => {
                ctx.logger.warn(`docker-desktop-mcp(${config.serverName}): legacy settings cleanup failed: ${String(error)}`);
            });
    });
}
