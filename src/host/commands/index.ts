/**
 * Slash commands — `/docker-profile` and `/docker-refresh`.
 *
 * They are the headless mirror of what the Web card does: the same persisted
 * `profile` write (so the picker, the command and the gateway always agree) and
 * the same discovery re-run. This section owns only the registration plumbing;
 * the two handlers live next to it (`./profile.js`, `./refresh.js`).
 *
 * Registration goes through the COMMANDS provider's own context (this bundle is
 * injected with `commands`, which may be absent), and every `register()`
 * disposer is retained so a hot re-apply of this plugin releases them —
 * otherwise the still-live definitions collide on re-register.
 */
import type { CommandDefinition, DockerMcpConfig, PluginContext } from "../types/index.js";
import type { GatewayController } from "../controller/index.js";
import { createProfileCommand } from "./profile.js";
import { createRefreshCommand } from "./refresh.js";

/**
 * Register this plugin's commands on the `commands` service.
 *
 * @param ctx - plugin context.
 * @param config - validated row config (for the log prefix).
 * @param controller - the live gateway controller.
 */
export function registerCommands(ctx: PluginContext, config: DockerMcpConfig, controller: GatewayController): void {
    // The registrations land on the COMMAND provider's own context effect, not
    // this plugin's — so without plugin-scoped cleanup a hot re-apply would
    // collide with the still-live definitions (the registry throws on a
    // duplicate name). This effect releases them when this plugin ctx is
    // disposed, keeping re-applies clean.
    const commandDisposers: Array<() => void> = [];
    ctx.effect(() => () => {
        for (const dispose of commandDisposers.splice(0)) dispose();
    });

    ctx.inject(["commands"], (commandsCtx: PluginContext) => {
        const cmds = (commandsCtx as unknown as { commands: { register(definition: CommandDefinition): () => void } }).commands;
        /**
         * Register one definition and retain its disposer so the effect above
         * can release it. The registry throws on a duplicate name (a re-apply
         * racing a still-registered pair); in that case the earlier definitions
         * stay live, so a warning beats breaking apply.
         */
        const registerCommand = (definition: CommandDefinition) => {
            try {
                commandDisposers.push(cmds.register(definition));
            } catch (error) {
                ctx.logger.warn(`docker-desktop-mcp(${config.serverName}): command "${definition.name}" registration skipped: ${String(error)}`);
            }
        };

        registerCommand(createProfileCommand(controller));
        registerCommand(createRefreshCommand(controller));
    });
}
