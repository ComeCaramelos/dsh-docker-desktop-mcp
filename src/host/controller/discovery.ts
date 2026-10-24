/**
 * Discovery runs — the two chained runs a refresh triggers, plus the readiness
 * gate a connection's preparation stands behind.
 *
 * Both runs go through ONE promise chain so rapid refreshes never interleave.
 * The profile run additionally waits on gateway readiness: discovery against a
 * still-booting Docker Desktop is the useless early attempt that showed "Profile
 * not found". A failed profile run arms one bounded retry.
 *
 * What a run finds lands in the **live mirror** and nothing else: the candidate
 * lists (`profiles` / `executableCandidates`), the last failure line and the two
 * run counters. A run merges NOTHING into the saved rows — the card's fetch
 * dialog turns candidates into rows through an explicit user selection, and
 * `/docker-refresh` performs that merge itself.
 *
 * The mirror is also what the manager re-reads for the kind's `select` choices,
 * so publishing is what makes a run visible in a picker.
 */
import { DISCOVERY_RETRY_DELAY_MS, DISCOVERY_RETRY_MAX, GATEWAY_READY_TIMEOUT_MS } from "../constants.js";
import { listProfiles } from "../discovery.js";
import { discoverExecutables } from "../executables.js";
import { waitForGatewayReady } from "../readiness.js";
import type { PluginContext } from "../types/index.js";
import type { ControllerState } from "./state.js";
import { publishLive } from "./publish.js";

/**
 * One profile-list discovery against `command`. The run answers into the mirror
 * and publishes it; a failure additionally arms {@link scheduleRetry}.
 * @param ctx - plugin context.
 * @param state - the mutable half.
 * @param command - the executable to ask; defaults to what the runs last probed.
 */
export function runProfileDiscovery(ctx: PluginContext, state: ControllerState, command = state.currentCommand): Promise<void> {
    state.discovery = state.discovery
        .then(async () => {
            await prepareFor(ctx, state, command);
            if (state.disposed) return;
            let ids: string[] = [];
            try {
                ids = await listProfiles(command);
                state.live.profiles = ids;
                state.live.lastRefreshError = "";
            } catch (error) {
                state.live.profiles = [];
                state.live.lastRefreshError = (error instanceof Error ? error.message : String(error)).split(/\r?\n/u)[0];
                ctx.logger.warn(`docker-desktop-mcp(${state.config.serverName}): profile discovery failed: ${state.live.lastRefreshError}`);
            }
            state.live.effectiveCommand = command;
            state.live.discoveryRevision += 1;
            publishLive(ctx, state);
            if (state.live.lastRefreshError === "") state.retriesPending = 0;
            else scheduleRetry(ctx, state, command);
        })
        .catch(() => {});
    return state.discovery;
}

/**
 * One executable-candidate run: a filesystem scan (nothing spawns), so it needs
 * neither the gateway nor a reachable Desktop. The found paths land only in the
 * candidate list — exactly like profile discovery, the run merges nothing into
 * the saved rows.
 * @param ctx - plugin context.
 * @param state - the mutable half.
 */
export function runExecutableDiscovery(ctx: PluginContext, state: ControllerState): Promise<void> {
    state.discovery = state.discovery
        .then(async () => {
            if (state.disposed) return;
            state.live.executableCandidates = discoverExecutables();
            state.live.executableDiscoveryRevision += 1;
            publishLive(ctx, state);
        })
        .catch(() => {});
    return state.discovery;
}

/**
 * Make one executable safe to ask about: the bounded readiness wait, armed once
 * per executable path. A second call for the same path waits on the same gate;
 * a different path (a picked executable, a second install) arms a fresh one —
 * every profile id is read off the store that executable owns.
 * @param ctx - plugin context.
 * @param state - the mutable half.
 * @param command - the executable being prepared.
 */
export function prepareFor(ctx: PluginContext, state: ControllerState, command: string): Promise<void> {
    if (state.gateCommand !== command) {
        state.gateCommand = command;
        state.gatewayGate = waitForGatewayReady(command, { shouldStop: () => state.disposed })
            .then((ready) => {
                if (state.disposed) return;
                if (ready === "timed-out") {
                    ctx.logger.warn(
                        `docker-desktop-mcp(${state.config.serverName}): Docker Desktop never accepted a gateway backend API connection within ${GATEWAY_READY_TIMEOUT_MS}ms — running the gateway anyway (the OAuth notification stream may be unavailable)`
                    );
                }
            })
            .catch((error) => ctx.logger.error(`docker-desktop-mcp(${state.config.serverName}): gateway readiness wait failed: ${String(error)}`));
    }
    return state.gatewayGate;
}

/**
 * Schedule one retry of a FAILED run — at boot the profile store may only
 * become reachable seconds after the first attempt. Bounded (capped consecutive
 * retries, reset on success, cancelled on dispose) so an unavailable Docker
 * Desktop is never retried forever, and no retry ever writes the row.
 * @param ctx - plugin context.
 * @param state - the mutable half.
 * @param command - the executable the failed run asked.
 */
function scheduleRetry(ctx: PluginContext, state: ControllerState, command: string): void {
    if (state.disposed) return;
    if (state.retryTimer !== void 0 || state.retriesPending >= DISCOVERY_RETRY_MAX) return;
    state.retriesPending += 1;
    state.retryTimer = setTimeout(() => {
        state.retryTimer = void 0;
        if (state.disposed || state.live.lastRefreshError === "") return;
        void runProfileDiscovery(ctx, state, command);
    }, DISCOVERY_RETRY_DELAY_MS);
}
