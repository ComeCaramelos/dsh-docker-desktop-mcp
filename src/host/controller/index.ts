/**
 * The live gateway controller — one per apply, assembled from five sections.
 *
 * Everything mutable about a running gateway lives in {@link createControllerState
 * ./state.ts}; the other sections are behavior over that state:
 *
 *   ./state.ts       what the first spawn runs with + the composition base layer
 *   ./startup.ts     the bounded cold-start wait + the first runs
 *   ./discovery.ts   the two chained, gated discovery runs + the bounded retry
 *   ./push.ts        the host-owned nonce bump that re-serves the base layer
 *   ./bridge.ts      the nested mcp-client row and every way to switch it
 *
 * Rules it owns (see ../../../../AGENTS.md "Hard constraints"):
 *
 * - The base layer is served to clients only through a write, so a run ends
 *   with a host-owned NEGATIVE `refreshNonce` bump — the only raw user-section
 *   change that recomputes the served value and travels on the wire. A negative
 *   marker this instance did not write is a SIBLING instance's sync marker and
 *   is answered with a silent echo run.
 * - Switching profile / executable / stderr mode is always `fiber.update()` on
 *   the nested bridge, never a recreated row; a fiber that does not exist yet
 *   (readiness still in flight) just records the value for the first start.
 *
 * The controller owns no UI knowledge; the settings section and the slash
 * commands call into it.
 */
import { applyStderrMode, noteStderr, switchConnection } from "./bridge.js";
import { runExecutableDiscovery, runProfileDiscovery } from "./discovery.js";
import { startGateway } from "./startup.js";
import { createControllerState } from "./state.js";
import type { GatewayController } from "./types.js";
import type { DiscoveryOptions, DockerMcpConfig, PluginContext, SettingsResolved, SettingsService } from "../types/index.js";

export type { GatewayController } from "./types.js";

/**
 * Build the live controller for one apply of `config`.
 *
 * @param ctx - plugin context.
 * @param config - validated row config.
 */
export function createGatewayController(ctx: PluginContext, config: DockerMcpConfig): GatewayController {
    const state = createControllerState(ctx, config);

    return {
        get entry() {
            return state.entry;
        },
        source: () => state.source(),
        setSource(next: () => SettingsResolved) {
            state.source = next;
        },
        get settings() {
            return state.installed;
        },
        get runningProfile() {
            return state.runningProfile;
        },
        get runningCommand() {
            return state.runningCommand;
        },
        get runningStderrMode() {
            return state.runningStderrMode;
        },
        get started() {
            return state.bridge !== void 0;
        },
        get pushedNonce() {
            return state.pushedNonce;
        },
        get pushedExecNonce() {
            return state.pushedExecNonce;
        },

        start() {
            startGateway(ctx, state);
        },
        runDiscovery(options?: DiscoveryOptions) {
            return runProfileDiscovery(ctx, state, options);
        },
        runExecutablesDiscovery(options?: DiscoveryOptions) {
            return runExecutableDiscovery(ctx, state, options);
        },
        switchConnection(profile: string, command: string) {
            switchConnection(ctx, state, profile, command);
        },
        switchProfile(profile: string) {
            switchConnection(ctx, state, profile, state.runningCommand);
        },
        applyStderrMode(mode) {
            applyStderrMode(ctx, state, mode);
        },
        noteStderr(built) {
            noteStderr(ctx, state, built);
        },
        attachSettings(settings: SettingsService) {
            state.installed = settings;
            state.resolveSettingsGate(settings);
        },
        dispose() {
            state.disposed = true;
            if (state.retryTimer !== void 0) {
                clearTimeout(state.retryTimer);
                state.retryTimer = void 0;
            }
        }
    } satisfies GatewayController;
}
