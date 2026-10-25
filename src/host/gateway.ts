/**
 * Gateway spawn construction — the argv shape and where its stderr goes.
 *
 * The argv stays exactly `mcp gateway run --profile <id> [extraArgs]` — the one
 * shape the gateway accepts and the only place the profile id is read from. What
 * used to keep the console quiet was a `sh -c` wrapper; since dsh 0.2 that job
 * belongs to `@comecaramelos/dsh-ancesters`' `buildSpawn`, which wraps the spawn
 * in one Node wrapper (`process.execPath` + a shipped script) on Linux, WSL and
 * Windows alike. That is why this module no longer has a shell script, a shell
 * probe or a `fallback` answer: there is nothing platform-dependent left to fall
 * back from, and the log file lands in ancestros' private per-host directory
 * (`<tmpdir>/dsh-ancesters-bridge-XXXX/<server>-bridge.log`) instead of the flat
 * `dsh-docker-mcp-…-gateway-<pid>.log` file the `sh -c` era wrote.
 *
 * The wrapper is strictly per-spawn: it rewrites only this bridge's command and
 * args, never a shared transport.
 */
import { buildSpawn, stderrLogPath } from "@comecaramelos/dsh-ancesters/host";
import type {
    GatewayConnection,
    GatewaySpawnOptions,
    GatewaySpawnResult,
    GatewayStderrMode,
    GatewaySpawnTarget,
    ReconnectConfig
} from "./types/index.js";

/**
 * Default location of the gateway stderr log — ancestros' private bridge log for
 * this server namespace.
 * @param serverName - the bridge server namespace.
 * @param options - tmpdir/pid overrides for tests and diagnostics.
 */
export function gatewayStderrLogPath(serverName: unknown, options: { tmpdir?: string; pid?: number } = {}): string {
    return stderrLogPath(serverName, options);
}

/**
 * Build the stdio spawn target for one gateway run, honouring the effective
 * stderr mode. `"log"` (the default) routes the gateway's stderr into the log
 * file; `"console"` leaves the raw command in place, so the gateway's progress
 * lines keep landing on the dsh console.
 * @param target - { command, args, stderr?, logPath?, serverName? }.
 * @param options - execPath/tmpdir/pid overrides for tests and diagnostics.
 * @returns { command, args, redirect } — the log file when redirected, "" when
 * the console echoes. The shape no longer carries a `fallback`: there is no
 * platform without a wrapper any more.
 */
export function buildGatewaySpawn(target: GatewaySpawnTarget, options: GatewaySpawnOptions = {}): GatewaySpawnResult {
    const mode: GatewayStderrMode = target.stderr === void 0 ? "log" : target.stderr;
    const spawned = buildSpawn(
        {
            command: target.command,
            args: [...target.args],
            stderr: mode,
            ...(typeof target.logPath === "string" && target.logPath !== "" ? { logPath: target.logPath } : {}),
            ...(target.serverName === void 0 ? {} : { serverName: target.serverName })
        },
        {
            ...(options.execPath === void 0 ? {} : { execPath: options.execPath }),
            ...(options.tmpdir === void 0 ? {} : { tmpdir: options.tmpdir }),
            ...(options.pid === void 0 ? {} : { pid: options.pid })
        }
    );
    return { command: spawned.command, args: spawned.args, redirect: spawned.redirect };
}

/**
 * The stdio config for one gateway connection: the fixed argv, wrapped so the
 * gateway's stderr lands in a log file when the mode says "log". The invocation
 * shape stays verbatim:
 * `docker mcp gateway run --profile <profile> [extraArgs]`.
 *
 * The returned `config` carries ONLY `dsh-mcp-client` fields — what the manager
 * hands the pool and the pool hands `ctx.plugin(McpClient, …)`. `redirect`
 * describes the wrapper for the host's own diagnostics and the kind's `note`; it
 * never rides the config.
 */
export function gatewayConfig(connection: GatewayConnection): GatewaySpawnResult & { config: Record<string, unknown> } {
    const spawned = buildGatewaySpawn({
        command: connection.command,
        args: ["mcp", "gateway", "run", "--profile", connection.profile, ...(connection.extraArgs ?? [])],
        stderr: connection.stderr === void 0 ? "log" : connection.stderr,
        ...(connection.logPath === void 0 ? {} : { logPath: connection.logPath }),
        serverName: connection.serverName
    });
    return {
        command: spawned.command,
        args: spawned.args,
        redirect: spawned.redirect,
        config: {
            serverName: connection.serverName,
            transport: "stdio" as const,
            command: spawned.command,
            args: spawned.args,
            ...(connection.env === void 0 ? {} : { env: connection.env }),
            ...(connection.cwd === void 0 ? {} : { cwd: connection.cwd }),
            ...(connection.toolCallTimeoutMs === void 0 ? {} : { toolCallTimeoutMs: connection.toolCallTimeoutMs }),
            ...(connection.failOnStartupError === void 0 ? {} : { failOnStartupError: connection.failOnStartupError }),
            ...(connection.reconnect === void 0 ? {} : { reconnect: connection.reconnect })
        }
    };
}
