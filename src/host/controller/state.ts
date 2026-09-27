/**
 * Controller state — the mutable half one apply owns.
 *
 * Everything a running gateway can change lives in one object, so every other
 * controller section is a pure function over it (no closure state to thread
 * through five modules). What the first spawn runs with is resolved here, once:
 * the WSL host-CLI rewrite, the profile precedence, the composition base layer
 * and the two gates every wait hangs on.
 */
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { PROFILE_ENV_VAR, PROFILE_PATTERN } from "../constants.js";
import { resolveDockerCommand } from "../docker.js";
import {
    readPersistedCommand,
    readPersistedProfile,
    readPersistedStderrMode,
    resolveBaseProfile,
    resolveEffectiveCommand,
    resolveStderrMode
} from "../values.js";
import type {
    DockerMcpConfig,
    GatewayStderrMode,
    McpBridge,
    PluginContext,
    SettingsBaseLayer,
    SettingsResolved,
    SettingsService
} from "../types/index.js";

/** Everything mutable about one running gateway, one per apply. */
export type ControllerState = {
    /** Row config with the WSL host-CLI rewrite applied (the bridge spawn target). */
    readonly row: DockerMcpConfig;
    /** The in-memory composition base layer handed to `installSection`. */
    readonly entry: SettingsBaseLayer;
    /** Live resolved settings value; swapped by the section's `setSource` hook. */
    source: () => SettingsResolved;
    /** Profile the bridge runs (or will start) with. */
    runningProfile: string;
    /** Executable the bridge runs (or will start) with. */
    runningCommand: string;
    /** Effective gateway-stderr mode of the running/spawning bridge. */
    runningStderrMode: GatewayStderrMode;
    /** Nested mcp-client row; created when starting the gateway is safe. */
    bridge: McpBridge | undefined;
    /** Last `refreshNonce` written by the HOST itself — the loop guard that
     * keeps its own `onChange` from re-running discovery. */
    pushedNonce: number | undefined;
    /** Same guard for the executable-catalog refresh trigger. */
    pushedExecNonce: number | undefined;
    /** Pending failed-run retry timer; armed only while discovery keeps failing. */
    retryTimer: NodeJS.Timeout | undefined;
    /** Consecutive scheduled retries after failed runs; reset on success. */
    retriesPending: number;
    /** Set once this half is disposed; readiness must not start anything. */
    disposed: boolean;
    /** Serializes discovery runs so rapid refreshes never interleave. */
    discovery: Promise<void>;
    /** Resolves with the settings service once its section is installed —
     * every base-layer push needs a write, so every discovery run waits on it. */
    settingsGate: Promise<SettingsService>;
    resolveSettingsGate: (value: SettingsService) => void;
    /** Settings service as installed by ../settings.ts (undefined until then). */
    installed: SettingsService | undefined;
    /** Last emitted gateway-stderr notice (redirect target or fallback reason);
     * suppresses repeats across switch/reconnect churn. */
    stderrNotice: string;
    /** Gateway-readiness gate; also the trigger for the FIRST discovery run —
     * the first connection starts as soon as spawning is safe (see
     * ../readiness.ts) and discovery only answers with the real profile store
     * once the daemon is reachable, so the initial run waits on this gate
     * instead of running blind at section registration. Assigned by `start`. */
    gatewayGate: Promise<void>;
};

/**
 * Resolve what the first spawn runs with and build the mutable state around it.
 *
 * @param ctx - plugin context.
 * @param config - validated row config.
 */
export function createControllerState(ctx: PluginContext, config: DockerMcpConfig): ControllerState {
    // ── what the first spawn runs with ─────────────────────────────────────
    // WSL + Docker Desktop: the default `docker` target is rewritten to the
    // Windows-side CLI whose store actually holds the UI-created profiles
    // (see ../docker.ts). The resolved value is the base-layer
    // `effectiveCommand` when no UI override is set; a UI-set executable
    // override wins verbatim. Both feed discovery, the bridge spawn and the
    // readiness probes.
    const rowCommand = resolveDockerCommand(config.command);
    if (rowCommand !== config.command) {
        ctx.logger.info(`docker-desktop-mcp(${config.serverName}): WSL host detected — using the Docker Desktop CLI at "${rowCommand}" (override in the card or with row-config "command")`);
    }
    const row: DockerMcpConfig = rowCommand === config.command ? config : { ...config, command: rowCommand };
    const envProfile = launchEnvironmentOf(ctx).get(PROFILE_ENV_VAR)?.value;
    const baseProfile = resolveBaseProfile(config.profile, envProfile);
    if (envProfile !== void 0 && envProfile !== "" && baseProfile !== envProfile) {
        ctx.logger.warn(`docker-desktop-mcp(${config.serverName}): ignoring ${PROFILE_ENV_VAR}="${envProfile}" — not a valid profile id (pattern ${PROFILE_PATTERN}); using "${baseProfile}"`);
    }
    // The persisted UI selection wins over env/row config: seed the first
    // gateway spawn with it. When the settings service is not up yet this
    // yields the base profile, and the installSection initial onChange
    // switches the bridge to the persisted selection in place right after.
    const initialProfile = readPersistedProfile(ctx) ?? baseProfile;

    // Composition base layer: held in memory, never persisted. The executable
    // actually in use (`effectiveCommand`) and the discovery state live here.
    // The discovery state is the CANDIDATE list (`profiles` /
    // `executableCandidates`) the fetch dialogs offer — a run never merges
    // anything into the persisted catalogs; rows are added only through an
    // explicit user selection (the dialog's "Add selected") or an explicit
    // merge by `/docker-refresh`.
    // NOTE: `dsh-settings` only re-serves the resolved value on writes, so a
    // base-entry mutation is invisible to clients until the host pushes it —
    // see ./push.ts `pushBaseLayer`.
    const entry: SettingsBaseLayer = {
        profile: initialProfile,
        effectiveCommand: "",
        /** Row-config `gatewayStderr` in effect — static base-layer value, the
         * "Reduce log output" fallback when no persisted UI toggle is set. */
        rowStderr: config.gatewayStderr === "console" ? "console" : "log",
        profiles: [],
        executableCandidates: [],
        lastRefreshError: "",
        discoveryRevision: 0,
        executableDiscoveryRevision: 0
    };
    /** Live resolved settings value; swapped by installSection hooks. */
    const source: () => SettingsResolved = () => entry as SettingsResolved;
    // Profile the nested bridge runs with — or, while the readiness wait is
    // still in flight, the profile its first start will use.
    const runningProfile = initialProfile;
    // Executable the nested bridge runs with — or, while the readiness wait is
    // still in flight, the executable its first start will use. A UI write of
    // `command` switches it verbatim; an empty override falls back to the
    // auto-resolved row config.
    const runningCommand = resolveEffectiveCommand(readPersistedCommand(ctx), config.command);
    entry.effectiveCommand = runningCommand;
    // Effective gateway-stderr mode ("log"/"console"): the persisted UI toggle
    // when set, else the row-config `gatewayStderr`. Every spawn reads it, and
    // a UI write of `stderrMode` hot-switches it.
    const runningStderrMode = resolveStderrMode(readPersistedStderrMode(ctx), config.gatewayStderr);

    let resolveSettingsGate!: (value: SettingsService) => void;
    const settingsGate = new Promise<SettingsService>((resolve) => {
        resolveSettingsGate = resolve;
    });

    return {
        row,
        entry,
        source,
        runningProfile,
        runningCommand,
        runningStderrMode,
        bridge: void 0,
        pushedNonce: void 0,
        pushedExecNonce: void 0,
        retryTimer: void 0,
        retriesPending: 0,
        disposed: false,
        discovery: Promise.resolve(),
        settingsGate,
        resolveSettingsGate,
        installed: void 0,
        stderrNotice: "",
        gatewayGate: Promise.resolve()
    };
}
