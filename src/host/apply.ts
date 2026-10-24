/**
 * Host-half assembly — the wiring file.
 *
 * `apply` is deliberately the only host module that knows the four parts exist;
 * each part keeps its own behavior:
 *
 *   ./controller/   the live mirror, the two runs, the bounded retry
 *   ./settings.ts   the configuration form's attach (the shared adapter owns the
 *                   entry-id rule, the auto page and the commit routing)
 *   ./manager.ts    the `docker-profile` kind + the standalone-config translation
 *   ./commands/     `/docker-profile` + `/docker-refresh`
 *
 * The ordering rule that must survive the split: read the row through the
 * references at commit time, never capture them — cordis starts the injection
 * callbacks after `apply` returns, so a captured value would pin every consumer
 * to the row config and no later edit would reach anything.
 *
 * What changed with the component model: this row **no longer starts a
 * gateway itself**. It answers a live `docker-profile` connection instead, and
 * answers nothing at all when no manager is mounted. Mounting therefore stands
 * up the machine half (the mirror, the two catalogs, the two runs) and says what
 * it can answer; whether anything runs is the pool's decision.
 *
 * @param ctx - plugin context.
 * @param config - validated config (every volatile field a reference).
 */
import { createController } from "./controller/index.js";
import { registerCommands } from "./commands/index.js";
import { installDockerMcpForm } from "./settings.js";
import { attachToManager } from "./manager.js";
import type { DockerMcpConfig, PluginContext } from "./types/index.js";

export function apply(ctx: PluginContext, config: DockerMcpConfig): void {
    const controller = createController(ctx, config);
    // Disposing stops any pending discovery retry; no run may start after this.
    ctx.effect(() => () => controller.dispose());
    // The machine half opens first: publish the mirror and run both scans, so
    // the very first answer a picker reads is already there. Nothing here
    // spawns — the readiness wait belongs to a connection's `prepare`.
    controller.start();
    attachToManager(ctx, controller);
    registerCommands(ctx, config, controller);
    installDockerMcpForm(ctx, controller);
}
