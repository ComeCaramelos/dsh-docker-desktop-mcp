/**
 * Host-half assembly — the wiring file.
 *
 * `apply` is deliberately the only host module that knows the four parts
 * exist; each part keeps its own behavior:
 *
 *   ./controller/     the live gateway state (state, startup, discovery, push, bridge)
 *   ./commands/       `/docker-profile` + `/docker-refresh`
 *   ./settings.ts     the namespace install + commit routing + cleanup
 *   ./readiness.ts    the cold-start wait the controller runs before spawning
 *
 * The ordering rule that must survive the split: read the config through
 * `controller.source()` at commit time, never capture it — cordis starts the
 * `settings` injection callback after `apply` returns, so a captured value
 * would pin every consumer to the row config and no mid-session GUI edit would
 * ever reach the running gateway.
 *
 * Mount the Docker Desktop MCP gateway and its settings-backed profile picker.
 * Profile precedence: settings user layer (UI selection) > DSH_DOCKER_MCP_PROFILE
 * env var > row config `profile` > schema default.
 * Executable precedence: the settings user-layer `command` override > the
 * auto-resolved row-config `command` (WSL host path for the literal default).
 * Stderr-mode precedence: the settings user-layer `stderrMode` (the card's
 * "Reduce log output" toggle) > the row-config `gatewayStderr`.
 *
 * @param ctx - plugin context.
 * @param config - validated row config.
 */
import { createGatewayController } from "./controller/index.js";
import { registerCommands } from "./commands/index.js";
import { installSettingsSection } from "./settings.js";
import type { DockerMcpConfig, PluginContext } from "./types/index.js";

export function apply(ctx: PluginContext, config: DockerMcpConfig): void {
    const controller = createGatewayController(ctx, config);
    // Disposing this half stops any pending discovery retry; readiness must not
    // start anything after this point.
    ctx.effect(() => () => controller.dispose());
    // The gateway-start wait runs first so a settings commit racing a still
    // cold Desktop can never schedule a blind discovery run before readiness.
    controller.start();
    registerCommands(ctx, config, controller);
    installSettingsSection(ctx, config, controller);
}
