/**
 * Cold start — the runs every apply opens with.
 *
 * The executable scan runs straight away (it is a filesystem probe, needing
 * neither the gateway nor a reachable Desktop) and the profile run waits on the
 * readiness gate inside {@link prepareFor} — discovery against a still-booting
 * Docker Desktop is the useless early attempt that produced the empty list.
 *
 * What this module no longer does is start anything: the gateway connection
 * belongs to the manager (kind `docker-profile`, prepared and resolved through
 * `./discovery.ts` + `../kind.ts`), so the only first-run work left is to get
 * the answers the picker needs onto the mirror.
 */
import type { PluginContext } from "../types/index.js";
import { runExecutableDiscovery, runProfileDiscovery } from "./discovery.js";
import { publishLive } from "./publish.js";
import type { ControllerState } from "./state.js";

/** Open the live answers: publish the mirror's opening answers, then run. */
export function startRuns(ctx: PluginContext, state: ControllerState): void {
    // Seed the mirror before the first snapshot lands, so a card that reads
    // before anything ran still gets the real opening answers, never defaults.
    publishLive(ctx, state);
    void runExecutableDiscovery(ctx, state);
    void runProfileDiscovery(ctx, state, state.currentCommand);
}
