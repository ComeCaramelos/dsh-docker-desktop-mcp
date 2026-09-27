/**
 * Structural views of the services this half consumes without depending on them.
 *
 * The slash-command shapes come from the `commands` service, the bridge view
 * from the nested `dsh-mcp-client` row, and the plugin context from cordis.
 * None of them own behavior; they are the minimum surface the host half reads.
 */
import type { Context } from "@deepseek-ai/cordis";

/** Slash-command invocation/result shapes from the `commands` service. */
export type CommandInvocation = { rawInput: string };
export type CommandResult = { kind: "success" | "error"; text: string };
export type CommandDefinition = {
    name: string;
    description: string;
    input?: { hint?: string };
    handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>;
};

/** Nested `dsh-mcp-client` bridge fiber (only `update` is consumed). */
export interface McpBridge {
    update(config: unknown): unknown;
}

/**
 * Plugin context as consumed by this host half. `ctx.effect`, `ctx.inject`,
 * `ctx.plugin`, and `ctx.get` all come from cordis `Context` itself.
 */
export type PluginContext = Context;
