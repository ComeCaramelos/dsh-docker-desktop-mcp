/**
 * Discovery runs — the two chained, gated runs a refresh triggers.
 *
 * Both run through ONE promise chain so rapid refreshes never interleave, and
 * both wait on the settings gate (a push needs a writable section). The profile
 * run additionally waits on gateway readiness: discovery against a still-booting
 * Docker Desktop is the useless early attempt that showed "Profile not found".
 * A failed profile run arms one bounded retry.
 */
import { DISCOVERY_RETRY_DELAY_MS, DISCOVERY_RETRY_MAX } from "../constants.js";
import { listProfiles } from "../discovery.js";
import { discoverExecutables } from "../executables.js";
import type { DiscoveryOptions, PluginContext } from "../types/index.js";
import type { ControllerState } from "./state.js";
import { pushBaseLayer } from "./push.js";

/**
 * One profile-list discovery. The recovered ids land ONLY in the base-layer
 * candidate list — the run merges nothing into the persisted profile rows; the
 * Web card's fetch dialog turns the candidates into saved rows through an
 * explicit user selection. The run then pushes the candidate state to open
 * clients by {@link pushBaseLayer}; a failure additionally arms
 * {@link scheduleRetry}. `options.echo` is the received negative sync marker:
 * the push (and any retry push) writes it back UNCHANGED so the re-run never
 * re-broadcasts to sibling instances.
 */
export function runProfileDiscovery(
    ctx: PluginContext,
    state: ControllerState,
    options?: DiscoveryOptions
): Promise<void> {
    const echoValue = options !== void 0 && typeof options.echo === "number" ? options.echo : void 0;
    state.discovery = state.discovery
        .then(async () => {
            await state.settingsGate;
            await state.gatewayGate;
            if (state.disposed) return;
            let ids: string[] = [];
            try {
                state.entry.effectiveCommand = state.runningCommand;
                ids = await listProfiles(state.runningCommand);
                state.entry.profiles = ids;
                state.entry.lastRefreshError = "";
            } catch (error) {
                state.entry.profiles = [];
                state.entry.lastRefreshError = (error instanceof Error ? error.message : String(error)).split(/\r?\n/u)[0];
                ctx.logger.warn(`docker-desktop-mcp(${state.row.serverName}): profile discovery failed: ${state.entry.lastRefreshError}`);
            }
            state.entry.discoveryRevision += 1;
            void pushBaseLayer(ctx, state, echoValue, "refreshNonce");
            if (state.entry.lastRefreshError === "") state.retriesPending = 0;
            else scheduleRetry(ctx, state, echoValue);
        })
        .catch(() => {});
    return state.discovery;
}

/**
 * One executable-candidate run: a filesystem scan (nothing spawns), so it only
 * needs the settings gate — a booting Docker Desktop is not involved. The found
 * paths land ONLY in the base-layer candidate list; exactly like profile
 * discovery, the run merges nothing into the persisted rows — the Web card's
 * fetch dialog adds rows only on an explicit user selection.
 */
export function runExecutableDiscovery(
    ctx: PluginContext,
    state: ControllerState,
    options?: DiscoveryOptions
): Promise<void> {
    const echoValue = options !== void 0 && typeof options.echo === "number" ? options.echo : void 0;
    state.discovery = state.discovery
        .then(async () => {
            await state.settingsGate;
            if (state.disposed) return;
            state.entry.executableCandidates = discoverExecutables();
            state.entry.executableDiscoveryRevision += 1;
            void pushBaseLayer(ctx, state, echoValue, "refreshExecutablesNonce");
        })
        .catch(() => {});
    return state.discovery;
}

/**
 * Schedule one retry of a FAILED run — at boot the profile store may only
 * become reachable seconds after the first attempt. Bounded (capped consecutive
 * retries, reset on success, cancelled on dispose) so an unavailable Docker
 * Desktop is never retried forever.
 */
function scheduleRetry(ctx: PluginContext, state: ControllerState, echoValue?: number): void {
    if (state.disposed) return;
    if (state.retryTimer !== void 0 || state.retriesPending >= DISCOVERY_RETRY_MAX) return;
    state.retriesPending += 1;
    state.retryTimer = setTimeout(() => {
        state.retryTimer = void 0;
        if (state.disposed || state.entry.lastRefreshError === "") return;
        void runProfileDiscovery(ctx, state, echoValue === void 0 ? void 0 : { echo: echoValue });
    }, DISCOVERY_RETRY_DELAY_MS);
}
