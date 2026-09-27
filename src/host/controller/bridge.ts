/**
 * Bridge section — the nested mcp-client row and every way to switch it.
 *
 * A profile / executable / stderr-mode change is always `fiber.update()` on the
 * live row, never a recreated plugin row, and a fiber that does not exist yet
 * (the readiness wait is still in flight) only records the value so the first
 * start picks it up. Failure paths are logged, never thrown.
 */
import * as McpClient from "@deepseek-ai/dsh-mcp-client";
import { bridgeConfig } from "../gateway.js";
import type { GatewayStderrMode, GatewayStderrNotice, PluginContext } from "../types/index.js";
import type { ControllerState } from "./state.js";

/**
 * Start the nested mcp-client row with the current profile, executable and
 * stderr mode. Idempotent (`switchConnection`/`applyStderrMode` update the live
 * fiber afterwards).
 */
export function startBridge(ctx: PluginContext, state: ControllerState): void {
    if (state.bridge === void 0) {
        const built = bridgeConfig(state.row, state.runningProfile, state.runningCommand, state.runningStderrMode);
        noteStderr(ctx, state, built);
        // `ctx.plugin` returns the cordis fiber; only `update` is used.
        state.bridge = ctx.plugin(McpClient, built.config) as unknown as ControllerState["bridge"];
    }
}

/**
 * Restart the nested bridge with one profile + executable; failures are
 * logged, never thrown. Called for a profile change, an executable override
 * change, or both — a hot `fiber.update` re-validates and restarts the
 * connection in place (the row config is never recreated).
 */
export function switchConnection(
    ctx: PluginContext,
    state: ControllerState,
    profile: string,
    command: string
): void {
    state.runningProfile = profile;
    state.runningCommand = command;
    state.entry.effectiveCommand = command;
    // Bridge not started yet: the first start reads these fields.
    if (state.bridge === void 0) return;
    ctx.logger.info(`docker-desktop-mcp(${state.row.serverName}): switching gateway connection to profile "${profile}" executable "${command}"`);
    const built = bridgeConfig(state.row, profile, command, state.runningStderrMode);
    noteStderr(ctx, state, built);
    Promise.resolve(state.bridge.update(built.config)).catch((error) =>
        ctx.logger.error(`docker-desktop-mcp(${state.row.serverName}): connection switch to profile "${profile}" executable "${command}" failed: ${String(error)}`)
    );
}

/**
 * Switch the effective gateway-stderr mode in place — the Web card's "Reduce
 * log output" toggle. Only the spawn wrapper changes, but that means restarting
 * the gateway connection (the stream routing is fixed at spawn); the
 * profile/executable stay exactly as they were. While the first start is still
 * gated on readiness the later `startBridge` reads `runningStderrMode`, so only
 * recording is done then.
 */
export function applyStderrMode(ctx: PluginContext, state: ControllerState, mode: GatewayStderrMode): void {
    state.runningStderrMode = mode;
    if (state.bridge === void 0) return;
    ctx.logger.info(`docker-desktop-mcp(${state.row.serverName}): gateway stderr mode → "${mode}" (restarting the gateway connection)`);
    const built = bridgeConfig(state.row, state.runningProfile, state.runningCommand, mode);
    noteStderr(ctx, state, built);
    Promise.resolve(state.bridge.update(built.config)).catch((error) =>
        ctx.logger.error(`docker-desktop-mcp(${state.row.serverName}): gateway stderr mode switch to "${mode}" failed: ${String(error)}`)
    );
}

/**
 * Announce where the gateway's console output goes — one line per change of
 * state, keyed on what actually happened, so neither the "log" capture nor a
 * switch to console echo is silent. An unavailable redirect (no POSIX shell)
 * warns with the reason so the fallback is not mysterious.
 */
export function noteStderr(ctx: PluginContext, state: ControllerState, built: GatewayStderrNotice): void {
    const key = built.redirect !== "" ? `file:${built.redirect}` : built.fallback !== "" ? `fallback:${built.fallback}` : "console";
    if (state.stderrNotice === key) return;
    state.stderrNotice = key;
    if (built.fallback === "platform") {
        ctx.logger.warn(`docker-desktop-mcp(${state.row.serverName}): gatewayStderr="log" is unavailable on this platform (no POSIX shell wrapper) — gateway logs keep going to the console`);
    } else if (built.fallback === "shell") {
        ctx.logger.warn(`docker-desktop-mcp(${state.row.serverName}): gatewayStderr="log" is unavailable (no /bin/sh was found) — gateway logs keep going to the console`);
    } else if (built.redirect !== "") {
        ctx.logger.info(`docker-desktop-mcp(${state.row.serverName}): gateway stderr → ${built.redirect}`);
    } else {
        ctx.logger.info(`docker-desktop-mcp(${state.row.serverName}): gateway stderr → console (echo)`);
    }
}
