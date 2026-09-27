/**
 * Base-layer push — how a discovery run's fresh state reaches open clients.
 *
 * `dsh-settings` recomputes the resolved value it serves through `describe()`
 * ONLY when the user section is written (at registration or in `write()`), never
 * when the composition base entry mutates in memory — so a client-initiated
 * re-read would keep seeing the stale registration-time value. The only
 * host→client channel is a raw user-section change (which recomputes the value
 * and fires `settings/document-updated`), so every discovery run ends with a
 * host-owned refresh-nonce bump — a negative `-(Date.now())`, guarded by
 * `pushedNonce` so it never re-triggers this instance's own `onChange`.
 */
import { SETTINGS_NAMESPACE } from "../constants.js";
import type { PluginContext, SettingsOp } from "../types/index.js";
import type { ControllerState } from "./state.js";

/**
 * Push one candidate-state bump through its own nonce field.
 *
 * This also reaches clients that open later: the recomputed resolved value is
 * host state, so their first `describe` read answers with it. `echoValue` writes
 * a received sync marker back UNCHANGED instead, so a re-run triggered by a
 * sibling instance never re-broadcasts. `ops` is reserved for a row write that
 * travels with the bump — no discovery run needs one any more (runs only update
 * the candidate state; rows land through the dialog's "Add selected" or the
 * `/docker-refresh` merge).
 */
export function pushBaseLayer(
    ctx: PluginContext,
    state: ControllerState,
    echoValue?: number,
    field?: "refreshNonce" | "refreshExecutablesNonce",
    ops?: SettingsOp[]
): Promise<void> {
    const value = echoValue === void 0 ? -Date.now() : echoValue;
    if (field === void 0 || field === "refreshNonce") state.pushedNonce = value;
    else state.pushedExecNonce = value;
    const write = [
        ...(ops === void 0 ? [] : ops),
        { op: "set" as const, path: [field === void 0 ? "refreshNonce" : field], value }
    ];
    return state.settingsGate
        .then((settings) => settings.mutate(SETTINGS_NAMESPACE, write))
        .then(() => undefined)
        .catch((error) =>
            ctx.logger.warn(`docker-desktop-mcp(${state.row.serverName}): discovery state push failed: ${String(error)}`)
        );
}
