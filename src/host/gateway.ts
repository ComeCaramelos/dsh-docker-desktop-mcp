/**
 * Gateway spawn construction — the argv shape and the stderr wrapper.
 *
 * The argv stays exactly `mcp gateway run --profile <id> [extraArgs]`. The
 * only way to keep the console quiet without touching that shape is to wrap
 * the spawn in `sh -c`, whose script `exec`s the gateway with the argv passed
 * positionally (never re-quoted, never joined) so the gateway process never
 * sees the wrapper. stdout stays the MCP protocol stream; stderr lands in a
 * per-spawn log file.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SH_PATH_CANDIDATES } from "./constants.js";
import type {
    DockerMcpConfig,
    GatewaySpawnOptions,
    GatewaySpawnResult,
    GatewaySpawnTarget,
    GatewayStderrMode
} from "./types/index.js";

/**
 * The `sh -c` script behind a redirecting gateway spawn: keep stdout as the
 * MCP protocol stream (only stdout carries it), send stderr to the captured
 * log file, and fail with 127 (and a message ON stderr) if the executable
 * is missing — otherwise the transport would report a bare exit code and
 * the reason would be buried in the log file.
 */
const GATEWAY_STDERR_SHELL_SCRIPT = [
    'GATEWAY="$1"',
    'LOG="$2"',
    "shift 2",
    'command -v "$GATEWAY" >/dev/null 2>&1 || { echo "docker-desktop-mcp: gateway executable not found: $GATEWAY" >&2; exit 127; }',
    'exec "$GATEWAY" "$@" 2>"$LOG"'
].join("; ");

/**
 * Default location of the gateway stderr log:
 * `<tmpdir>/dsh-docker-mcp-<serverName>-gateway-<pid>.log`. One file per
 * running dsh instance; the wrapper truncates it on every gateway spawn, so
 * it always holds the latest gateway session's output.
 * @param serverName - the bridge server namespace.
 * @param options - tmpdir/pid overrides for tests and diagnostics.
 */
export function gatewayStderrLogPath(serverName: unknown, options: { tmpdir?: string; pid?: number } = {}): string {
    const tmp = typeof options.tmpdir === "string" && options.tmpdir !== "" ? options.tmpdir : os.tmpdir();
    const pid = options.pid === void 0 ? process.pid : options.pid;
    const safe = typeof serverName === "string" ? serverName.replace(/[^A-Za-z0-9_-]/gu, "-") : "gateway";
    return path.join(tmp, `dsh-docker-mcp-${safe}-gateway-${pid}.log`);
}

/**
 * Build the stdio spawn target for one gateway run, honouring
 * `gatewayStderr`. The MCP stdio transport spawns the gateway with the
 * default `stderr: "inherit"`, so every progress line the gateway prints
 * lands directly on the dsh console — that is what makes connection feel
 * loud. "log" (default) wraps the spawn in `sh -c`: stdout keeps flowing as
 * the MCP protocol stream, and stderr is redirected into a log file.
 * "console" returns the raw command/args (inherited console output). When no
 * POSIX shell is available the redirect is impossible: the raw command is
 * returned with `fallback` set, and `apply` warns once.
 * @param target - { command, args, stderr?, logPath?, serverName? }.
 * @param options - platform/exists/tmpdir/pid overrides for tests.
 * @returns { command, args, redirect, fallback } — the log file when
 * redirected ("" otherwise) and why not ("" when redirected or console).
 */
export function buildGatewaySpawn(target: GatewaySpawnTarget, options: GatewaySpawnOptions = {}): GatewaySpawnResult {
    const raw = { command: target.command, args: [...target.args], redirect: "", fallback: "" };
    const mode = target.stderr === void 0 ? "log" : target.stderr;
    if (mode !== "log") return raw;
    const platform = options.platform === void 0 ? process.platform : options.platform;
    if (platform !== "linux" && platform !== "darwin") return { ...raw, fallback: "platform" };
    const exists =
        options.exists === void 0
            ? (candidate: string) => {
                  try {
                      fs.accessSync(candidate, fs.constants.X_OK);
                      return true;
                  } catch {
                      return false;
                  }
              }
            : options.exists;
    const sh = SH_PATH_CANDIDATES.find((candidate) => exists(candidate));
    if (sh === void 0) return { ...raw, fallback: "shell" };
    const logPath =
        typeof target.logPath === "string" && target.logPath !== ""
            ? target.logPath
            : gatewayStderrLogPath(target.serverName ?? "gateway", options);
    return {
        command: sh,
        args: ["-c", GATEWAY_STDERR_SHELL_SCRIPT, "docker-desktop-mcp", target.command, logPath, ...target.args],
        redirect: logPath,
        fallback: ""
    };
}

/**
 * Build the stdio config for the nested mcp-client bridge for one profile and
 * one executable + effective stderr mode. Args keep the user's original
 * invocation shape:
 * `docker mcp gateway run --profile <profile> [extraArgs]`, run as `command`
 * — wrapped through {@link buildGatewaySpawn} so the gateway's stderr lands
 * in a log file instead of the console when the mode is "log". The returned
 * config carries only dsh-mcp-client fields; `redirect`/`fallback` describe
 * the wrapper for the host's own diagnostics.
 */
export function bridgeConfig(entry: DockerMcpConfig, profile: string, command: string, stderrMode?: GatewayStderrMode) {
    const spawned = buildGatewaySpawn(
        {
            command,
            args: ["mcp", "gateway", "run", "--profile", profile, ...entry.extraArgs],
            stderr: stderrMode === void 0 ? entry.gatewayStderr : stderrMode,
            logPath: entry.gatewayStderrLog,
            serverName: entry.serverName
        },
        { serverName: entry.serverName }
    );
    return {
        config: {
            serverName: entry.serverName,
            transport: "stdio" as const,
            command: spawned.command,
            args: spawned.args,
            env: entry.env,
            cwd: entry.cwd,
            toolCallTimeoutMs: entry.toolCallTimeoutMs,
            failOnStartupError: entry.failOnStartupError,
            reconnect: entry.reconnect
        },
        redirect: spawned.redirect,
        fallback: spawned.fallback
    };
}
