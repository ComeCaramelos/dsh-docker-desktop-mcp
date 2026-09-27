/**
 * Cold start — the first spawn and the first discovery run.
 *
 * The initial connection uses the resolved profile/executable (persisted UI
 * selection > env var > row config > schema default) and starts as soon as
 * spawning is safe: the gateway's OAuth notification monitor dials the Docker
 * Desktop backend API socket once without retrying, so a too-early spawn strands
 * the stream and prints the cold-start `Failed to connect to OAuth
 * notifications` line. The wait is bounded; a timeout starts the gateway anyway.
 */
import { GATEWAY_READY_TIMEOUT_MS } from "../constants.js";
import { waitForGatewayReady } from "../readiness.js";
import type { PluginContext } from "../types/index.js";
import { startBridge } from "./bridge.js";
import { runExecutableDiscovery, runProfileDiscovery } from "./discovery.js";
import type { ControllerState } from "./state.js";

/**
 * Begin the cold-start wait: the executable scan runs straight away (it needs
 * neither the gateway nor Desktop), and the first profile run waits for the
 * readiness continuation to have scheduled it.
 */
export function startGateway(ctx: PluginContext, state: ControllerState): void {
    // The executable catalog is a filesystem scan — no gateway, no Desktop — so
    // it runs straight away and leaves the card with named executable options
    // before the first gateway spawn lands.
    void runExecutableDiscovery(ctx, state);
    const serverName = state.row.serverName;
    state.gatewayGate = waitForGatewayReady(state.runningCommand, { shouldStop: () => state.disposed })
        .then((ready) => {
            if (state.disposed) return;
            if (ready === "timed-out") {
                ctx.logger.warn(`docker-desktop-mcp(${serverName}): Docker Desktop never accepted a gateway backend API connection within ${GATEWAY_READY_TIMEOUT_MS}ms — starting the gateway anyway (the OAuth notification stream may be unavailable)`);
            }
            startBridge(ctx, state);
            void runProfileDiscovery(ctx, state);
        })
        .catch((error) => ctx.logger.error(`docker-desktop-mcp(${serverName}): gateway start wait failed: ${String(error)}`));
}
