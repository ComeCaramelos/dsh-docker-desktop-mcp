/**
 * Host-half plugin identity.
 *
 * `name` is what the cordis loader reports for diagnostics and `inject` is the
 * list of host services this half needs of its own; the nested mcp-client row
 * declares the tools, so nothing is injected here.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = "docker-desktop-mcp";

/**
 * The host services this component needs of its own.
 *
 * `mcpConnections` is what the MCP manager *provides*: it is how this component
 * says "there is a kind of connection called `docker-profile`, and here is what
 * one runs with". Declaring it is what the component being a component means —
 * without the manager the injection never answers, so the row describes itself,
 * answers its picker, and starts nothing.
 *
 * The command service is NOT declared: `/docker-profile` and `/docker-refresh`
 * register through `ctx.inject(["commands"], …)` so a bundle that carries no
 * command service leaves them absent instead of blocking the row.
 */
export const inject: string[] = ["mcpConnections"];
