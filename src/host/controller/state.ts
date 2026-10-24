/**
 * Controller state — the mutable half one apply owns.
 *
 * Since the live connection belongs to the manager (kind `docker-profile`), what
 * is mutable *here* is everything the machine answers: the two named catalogs,
 * the discovery runs and their bounded retry, the executable the runs probe, and
 * the live mirror every client reads. There is no nested bridge here, no
 * cold-start spawn and no in-place switch — the pool the manager owns starts,
 * switches and stops the gateway, and calls here for what it needs to know.
 */
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import type { LiveMirror, PersistUser, SettingsFormHandle } from "@comecaramelos/dsh-ancesters/host";
import type { McpConnectionsService } from "@comecaramelos/dsh-mcp-manager/api";
import { PROFILE_ENV_VAR, PROFILE_PATTERN } from "../constants.js";
import { createLiveMirror, liveMirrorKeys, readConfigForm, readConfigLayers, resolveEffectiveCommand } from "../values.js";
import type { ConfigLayers, ConfigLiveFields, DockerMcpConfig, PluginContext } from "../types/index.js";

/** Everything mutable about one apply. */
export type ControllerState = {
    /** The validated config as `apply` handed it (every volatile field a
     * reference — read through `readConfigField`, never a captured value). */
    readonly config: DockerMcpConfig;
    /** The live mirror: every Host-published volatile field's current answer.
     * Mutated through ./publish.ts, which coalesces per microtask. */
    readonly live: ConfigLiveFields;
    /** The live layers read: the references answer what the row says now, and
     * once the form is described the two layers answer the "user or row config?"
     * distinction with it. Read live on every commit — cordis starts the
     * `settings` injection callback after `apply` returns, so a value captured
     * here could never be trusted. */
    source: () => ConfigLayers;
    /** The attached configuration form (entry id + settings service), or
     * undefined until the entry id resolves and the service answers. */
    form: SettingsFormHandle | undefined;
    /** The coalescing live publisher, stood up on the first publish. */
    mirror: LiveMirror | undefined;
    /** The Host's own write channel, stood up on the first write. */
    persister: PersistUser | undefined;
    /** The executable the discovery runs probe: the one the last resolved
     * connection used, else the row config's answer (WSL-rewritten default). */
    currentCommand: string;
    /** Every live-only key, for the `unset` half of every persisted write. */
    readonly liveKeys: readonly string[];
    /** Serializes discovery runs so rapid refreshes never interleave. */
    discovery: Promise<void>;
    /** Pending failed-run retry timer; armed only while discovery keeps failing. */
    retryTimer: NodeJS.Timeout | undefined;
    /** Consecutive scheduled retries after failed runs; reset on success. */
    retriesPending: number;
    /** Set once this half is disposed; nothing may schedule anything after. */
    disposed: boolean;
    /** The readiness gate the profile run waits on (see ./discovery.ts). */
    gatewayGate: Promise<void>;
    /** The executable the standing gate waits on, so a second run against the
     * same path never arms a second wait. */
    gateCommand: string;
    /** The launch environment's `DSH_DOCKER_MCP_PROFILE` seed, resolved once at
     * apply time (it never changes without a remount). */
    readonly envProfile: unknown;
    /** Called after every publish so the manager re-reads what the kind's
     * `select` choices would answer. Installed by ./manager.ts; a no-op until. */
    notifyKindsChanged: () => void;
    /** The manager's `mcpConnections` service, once the injection answers.
     * Undefined when no manager is mounted — which is exactly what "the component
     * is off" means: the row answers everything it knows and runs nothing. */
    connections: McpConnectionsService | undefined;
};

/**
 * Resolve what the machine answers first and build the mutable state around it.
 *
 * @param ctx - plugin context.
 * @param config - validated config (every volatile field a reference).
 */
export function createControllerState(ctx: PluginContext, config: DockerMcpConfig): ControllerState {
    // The launch environment's profile seed, resolved once through the layered
    // environment helper — never `process.env` directly.
    const envProfile = launchEnvironmentOf(ctx).get(PROFILE_ENV_VAR)?.value;
    if (envProfile !== void 0 && envProfile !== "" && !(typeof envProfile === "string" && PROFILE_PATTERN.test(envProfile))) {
        ctx.logger.warn(`docker-desktop-mcp(${config.serverName}): ignoring ${PROFILE_ENV_VAR}="${String(envProfile)}" — not a valid profile id (pattern ${PROFILE_PATTERN})`);
    }

    // What the first discovery run probes: the row config's executable, with the
    // WSL host-CLI rewrite applied to the literal default.
        const opening = resolveEffectiveCommand(config);
    const live = createLiveMirror();
    live.effectiveCommand = opening.path;
    live.effectiveSource = opening.source;

    const state: ControllerState = {
        config,
        live,
        form: void 0,
        mirror: void 0,
        persister: void 0,
        source: () => {
            const current = state.form?.current();
            return readConfigLayers(config, current?.settings === void 0 ? void 0 : readConfigForm(current.settings, current.entryId));
        },
        currentCommand: opening.path,
        liveKeys: liveMirrorKeys(),
        discovery: Promise.resolve(),
        retryTimer: void 0,
        retriesPending: 0,
        disposed: false,
        gatewayGate: Promise.resolve(),
        gateCommand: "",
        envProfile,
        notifyKindsChanged: () => void 0,
        connections: void 0
    };
    return state;
}
