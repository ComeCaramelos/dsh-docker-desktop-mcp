/**
 * @comecaramelos/dsh-docker-desktop-mcp — host half.
 *
 * Connects the Docker Desktop MCP gateway (`docker mcp gateway run
 * --profile <name>`) as an MCP server through the stock
 * @deepseek-ai/dsh-mcp-client bridge, and exposes the gateway `--profile`
 * choice as a user setting: the Web GUI's Plugins settings page renders a
 * picker (see ./client.js) backed by the `docker-desktop-mcp` settings
 * namespace. Selecting a profile re-applies the nested mcp-client plugin
 * in place (fiber.update), which restarts the gateway connection with the
 * new `--profile` argument.
 *
 * Persistence boundary: only the user-authored fields land in
 * `$DSH_HOME/settings.yaml` — `profile` (the last UI selection, used to
 * connect on (re)start), `command` (the last UI executable override, used
 * to connect on (re)start) and `refreshNonce` (the client→host refresh
 * trigger AND the host's base-layer push channel; `harness.handle` is
 * reserved for code-string halves). The in-use executable
 * (`effectiveCommand`) plus discovery state (`profiles`, `lastRefreshError`,
 * `discoveryRevision`) ride the composition base layer — held in memory,
 * never persisted — but `dsh-settings` recomputes the `describe()` resolved
 * value it serves only when the user section is written, so the host pushes
 * the base layer after every discovery run with a host-owned
 * `refreshNonce` bump: that raw change recomputes the served value and fires
 * `settings/document-updated`, the only host→client channel.
 *
 * One plugin instance per dsh host: the settings namespace is fixed.
 *
 * Config (cordis row):
 *   serverName          tool namespace prefix          (default "docker")
 *   command             gateway executable             (default "docker";
 *                       on WSL with Docker Desktop the default auto-resolves
 *                       to /Docker/host/bin/docker.exe — or, failing that,
 *                       to a `docker.exe` found on PATH — the Linux CLI reads
 *                       the empty Linux-side MCP store, not the Windows one)
 *   profile             row-config --profile value     (default "default")
 *   extraArgs           extra gateway args after --profile
 *   gatewayStderr       gateway console-output routing: "log" (default)
 *                       redirects the gateway's inherited stderr into a log
 *                       file instead of the dsh console; "console" keeps it
 *   gatewayStderrLog    explicit log path for "log" mode (empty = auto in
 *                       the tmp dir)
 *   env / cwd / toolCallTimeoutMs / failOnStartupError / reconnect
 *                       passed through to dsh-mcp-client
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import z from "@deepseek-ai/schemastery";
import * as McpClient from "@deepseek-ai/dsh-mcp-client";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { scrubbedParentEnv } from "@deepseek-ai/dsh-subprocess";

/** Cordis plugin name used by loader diagnostics. */
const name = "docker-desktop-mcp";

/** No host services of our own: the nested bridge declares `tools`. */
const inject = [];

/** Fixed settings namespace; also the client card's slot key. */
export const SETTINGS_NAMESPACE = "docker-desktop-mcp";

/** Profile ids are CLI identifiers; keep the charset shell-safe. */
const PROFILE_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** Reconnect policy passthrough; mirrors dsh-mcp-client's schema. */
const Reconnect = z.object({
    enabled: z.boolean().default(true),
    initialDelayMs: z.number().min(1).max(600000).default(500),
    maxDelayMs: z.number().min(1).max(600000).default(30000),
    maxAttempts: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(10)
});

/**
 * A user-authored docker executable is just a trimmed path/command; no shell
 * metacharacters, no control characters. Kept permissive (paths contain
 * `/`, spaces, `:` and `\`). Also used for optional paths that allow the
 * empty string (auto-resolution).
 */
const COMMAND_PATTERN = /^[\t -~¡-￿]{1,1024}$/;

/** An optional path: a command-shaped string, or empty for auto-resolve. */
const OPTIONAL_PATH_PATTERN = /^(?:[\t -~¡-￿]{1,1024})?$/;

export const Config = z.object({
    serverName: z.string().pattern(/^[A-Za-z0-9_-]{1,32}$/).default("docker"),
    command: z.string().default("docker"),
    profile: z.string().min(1).pattern(PROFILE_PATTERN).default("default"),
    extraArgs: z.array(String).default([]),
    /** Gateway console-output routing: "log" (default) redirects the
     * gateway's inherited stderr into a log file instead of echoing every
     * progress line (catalog loads, image pulls, `Running …`, OAuth lines,
     * initialize dumps) into the dsh console; "console" keeps the inherited
     * stderr. See {@link buildGatewaySpawn}. */
    gatewayStderr: z.union([z.const("log"), z.const("console")]).default("log"),
    /** Log path override for "log" mode; empty = auto (see
     * {@link gatewayStderrLogPath}). Absolute paths only. */
    gatewayStderrLog: z.string().default("").pattern(OPTIONAL_PATH_PATTERN),
    env: z.dict(String).default({}),
    cwd: z.string().default(""),
    toolCallTimeoutMs: z.number().default(60000),
    failOnStartupError: z.boolean().default(false),
    reconnect: Reconnect
});

/**
 * User-settings section served to the Web GUI profile picker.
 *
 * Persisted (user layer in `$DSH_HOME/settings.yaml`): `profile` (the last
 * UI selection), `command` (the last UI executable override) and
 * `refreshNonce`. Never persisted (composition base layer held in memory by
 * the host): `effectiveCommand`, `profiles`, `lastRefreshError`,
 * `discoveryRevision` — re-served to clients only through a write, so every
 * discovery run ends with the host bumping `refreshNonce` (guarded against
 * re-discovery); the client's refresh poll treats the served
 * `discoveryRevision` advancing past its click-time value as the completion
 * signal. `effectiveCommand` carries the executable actually in use (the
 * override when set, else the auto-resolved row config) so the UI text field
 * can both show it and override it.
 */
export const SettingsSchema = z.object({
    /** Active gateway --profile value; persisted last UI selection. */
    profile: z.string().min(1).pattern(PROFILE_PATTERN).default("default"),
    /** Persisted UI executable override; empty means "auto-resolve". */
    command: z.string().default(""),
    /** Written by the UI refresh button; the host reacts to its change. */
    refreshNonce: z.number().default(0),
    /**
     * Persisted UI "Reduce log output" toggle: "log" captures the gateway's
     * stderr into the log file, "console" echoes it (debug). Empty = follow
     * the row-config `gatewayStderr`.
     */
    stderrMode: z.string().default("").pattern(/^(?:log|console)?$/),
    /** Row-config `gatewayStderr` in effect (static base layer; never
     * persisted) — the fallback when `stderrMode` is unset. */
    rowStderr: z.union([z.const("log"), z.const("console")]).default("log"),
    /** Executable actually in use (in-memory base layer; never persisted). */
    effectiveCommand: z.string().default(""),
    /** Profile ids discovered from `docker mcp profile list --format json`. */
    profiles: z.array(String).default([]),
    /** Last discovery failure, human-readable; empty when healthy. */
    lastRefreshError: z.string().default(""),
    /** Discovery run counter (success or failure); completion signal for the client. */
    discoveryRevision: z.number().default(0)
});

/** Timeout for one profile discovery subprocess. */
const DISCOVERY_TIMEOUT_MS = 15000;

/** Delay before retrying a failed discovery run — the Docker Desktop profile
 * store may still be loading at the first boot attempt. */
export const DISCOVERY_RETRY_DELAY_MS = 15000;

/** Consecutive retries after failed discovery runs; reset on the first
 * success, capped so an unavailable Docker Desktop is never retried forever. */
export const DISCOVERY_RETRY_MAX = 4;

/**
 * The gateway's OAuth notification monitor makes exactly ONE connection
 * attempt to the Docker Desktop backend API socket and never retries (the
 * upstream `pkg/oauth.NotificationMonitor` calls `connect` once and returns
 * on failure). Spawning the gateway while that socket is not yet listening
 * therefore strands the stream for the whole session and prints the
 * cold-start `Failed to connect to OAuth notifications: ...` error line. The
 * first gateway spawn waits — bounded — until the socket answers. On
 * timeout the gateway starts anyway (previous behavior, never a stall).
 */
const GATEWAY_READY_POLL_MS = 1500;
const GATEWAY_READY_TIMEOUT_MS = 15000;
/** One connect attempt at a backend API socket path is capped at this. */
const BACKEND_API_CONNECT_TIMEOUT_MS = 2000;

/**
 * Platform mirror of the Docker Desktop backend API socket the gateway OAuth
 * notification monitor dials (the upstream
 * `pkg/desktop.Paths().BackendSocket`).
 * @param platform - platform identifier, defaults to `process.platform`.
 * @param homedir - home directory used by the user-level socket variant.
 * @returns candidate socket paths; empty for platforms with no known socket
 * location, which never wait.
 */
export function backendApiSocketPaths(platform = process.platform, homedir = os.homedir()) {
    if (platform === "win32") return ["\\\\.\\pipe\\dockerBackendApiServer"];
    if (platform === "linux") return ["/run/host-services/backend.sock", path.join(homedir, ".docker", "desktop", "backend.sock")];
    return [];
}

/**
 * One `connect(2)` attempt against a single socket path.
 * @param socketPath - unix socket or Windows named pipe path.
 * @returns `"connected"` when accepted, `"absent"` when no socket exists at
 * the path, and `"closed"` for every other failure (including a path that
 * exists but is not accepting connections).
 */
export function probeBackendApiSocket(socketPath) {
    return new Promise((resolve) => {
        let settled = false;
        let socket;
        try {
            socket = net.connect({ path: socketPath });
        } catch {
            resolve("closed");
            return;
        }
        const settle = (state) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(state);
        };
        socket.setTimeout(BACKEND_API_CONNECT_TIMEOUT_MS, () => settle("closed"));
        socket.once("connect", () => settle("connected"));
        socket.once("error", (error) => settle(error && error.code === "ENOENT" ? "absent" : "closed"));
    });
}

/**
 * Daemon-reachability fallback: the `docker version` subprocess exit code.
 * @param command - docker executable from row config.
 * @returns whether the daemon answered within the subprocess timeout.
 */
export function dockerDaemonResponds(command) {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(command, ["version", "--format", "{{.Server.Version}}"], {
                env: scrubbedParentEnv(),
                stdio: ["ignore", "ignore", "ignore"],
                timeout: 5000
            });
        } catch {
            resolve(false);
            return;
        }
        child.once("error", () => resolve(false));
        child.once("close", (code) => resolve(code === 0));
    });
}

/**
 * Bounded wait for the point where starting the gateway is safe: the backend
 * API socket answers (a Desktop that is still booting will listen within
 * the cap), or it is absent everywhere while the daemon still answers
 * (plain Docker CE has no backend API to wait for).
 * @param command - docker executable from row config.
 * @param options - poll/timeout/paths overrides for tests and diagnostics.
 * @returns `"ready"` (safe to spawn), `"no-backend-api"` (nothing to wait
 * for), or `"timed-out"` (spawn anyway, with a warning).
 */
export async function waitForGatewayReady(command, options = {}) {
    const startedAt = Date.now();
    for (;;) {
        if (options.shouldStop === void 0 ? void 0 : options.shouldStop()) return "ready";
        const paths = options.paths === void 0 ? backendApiSocketPaths() : options.paths;
        if (paths.length === 0) return "ready";
        const probes = await Promise.all(paths.map(probeBackendApiSocket));
        if (probes.includes("connected")) return "ready";
        if (!probes.includes("closed") && await dockerDaemonResponds(command)) return "no-backend-api";
        if (Date.now() - startedAt >= (options.timeoutMs === void 0 ? GATEWAY_READY_TIMEOUT_MS : options.timeoutMs)) return "timed-out";
        await new Promise((resolve) => setTimeout(resolve, options.pollMs === void 0 ? GATEWAY_READY_POLL_MS : options.pollMs));
    }
}

/**
 * Spawn `docker mcp profile list --format json` and return the discovered
 * profile ids. Fails when the CLI lacks the profiles feature; the caller
 * keeps the reason in the in-memory base layer (`lastRefreshError`).
 */
export function listProfiles(command) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, ["mcp", "profile", "list", "--format", "json"], {
            env: scrubbedParentEnv(),
            stdio: ["ignore", "pipe", "pipe"],
            timeout: DISCOVERY_TIMEOUT_MS,
            killSignal: "SIGKILL"
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("error", (error) => {
            reject(new Error(`could not run "${command} mcp profile list": ${error.message}`));
        });
        child.on("close", (code) => {
            if (code === null) {
                reject(new Error(`"${command} mcp profile list" timed out after ${DISCOVERY_TIMEOUT_MS}ms`));
                return;
            }
            if (code !== 0) {
                let detail =
                    (stderr || stdout).trim().split(/\r?\n/u).find((line) => line.trim() !== "") ?? `exit code ${String(code)}`;
                if (/unknown (flag|command)/u.test(detail)) {
                    detail += " — enable the profiles feature first (docker mcp feature enable profiles, or the MCPWorkingSets flag in Docker Desktop)";
                }
                reject(new Error(`"${command} mcp profile list" failed: ${detail.slice(0, 240)}`));
                return;
            }
            try {
                resolve(extractProfileIds(stdout));
            } catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    });
}

/**
 * Tolerant parse of `docker mcp profile list --format json`: accepts a bare
 * array, or an object wrapping the array under a common key (profiles /
 * items / data / results / first array value). Entries are ids when strings,
 * else their id / profileID / profileId / name field.
 */
export function extractProfileIds(stdout) {
    const text = String(stdout ?? "").trim();
    if (text === "") return [];
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed)
        ? parsed
        : typeof parsed === "object" && parsed !== null
            ? Array.isArray(parsed.profiles)
                ? parsed.profiles
                : Object.values(parsed).find((value) => Array.isArray(value)) ?? []
            : [];
    const ids = [];
    for (const item of items) {
        if (typeof item === "string" && item !== "") {
            ids.push(item);
            continue;
        }
        if (typeof item === "object" && item !== null) {
            const id = item.id ?? item.profileID ?? item.profileId ?? item.name;
            if (typeof id === "string" && id !== "") ids.push(id);
        }
    }
    return [...new Set(ids)];
}

/**
 * Windows-side Docker CLI path exposed inside WSL. Docker Desktop keeps its
 * MCP profiles in the Windows store (`%USERPROFILE%\.docker\mcp`); the Linux
 * `docker` CLI reads the (usually empty) `~/.docker/mcp` instead, so
 * discovery finds no UI-created profiles and `gateway run --profile <id>`
 * fails. When this binary is present and executable, it is the right target.
 */
export const WSL_DOCKER_HOST_COMMAND = "/Docker/host/bin/docker.exe";

/**
 * Fallback candidate name: WSL interop often exposes the Windows-side
 * `docker.exe` on `PATH` (either a link under the Docker Desktop host bin
 * directory or the interop-mounted Windows PATH). When the canonical host
 * path is absent, the first executable `docker.exe` found on `PATH` is used.
 */
export const WSL_DOCKER_PATH_CANDIDATE = "docker.exe";

/**
 * Candidate Windows-side CLI paths, in precedence order: the canonical
 * {@link WSL_DOCKER_HOST_COMMAND} first, then `docker.exe` resolved through
 * `PATH` (from `options.env` when given, else `process.env`).
 * @param options - env override for tests and diagnostics.
 * @returns ordered, de-duplicated candidate paths.
 */
function wslDockerCommandCandidates(options) {
    const candidates = new Set([WSL_DOCKER_HOST_COMMAND]);
    const env = options.env === void 0 ? process.env : options.env;
    const envPath = typeof env?.PATH === "string" ? env.PATH : "";
    for (const dir of envPath.split(":")) {
        // Linux-side PATH only; skip empty and Windows-style entries so the
        // join below never produces junk paths.
        if (dir === "" || dir.includes("\\")) continue;
        candidates.add(path.posix.join(dir.endsWith("/") ? dir : `${dir}/`, WSL_DOCKER_PATH_CANDIDATE));
    }
    return [...candidates];
}

/**
 * Resolve the gateway executable. A row-config `command` always wins; only
 * the literal default `"docker"` is rewritten — on linux to the first
 * existing Windows-side CLI (the canonical
 * {@link WSL_DOCKER_HOST_COMMAND}, else a `docker.exe` found on `PATH`) —
 * so discovery and the gateway target the Docker Desktop (Windows-side) MCP
 * store instead of the empty Linux-side one. Set `command` explicitly
 * (absolute path) to keep a Linux CLI running inside WSL.
 * @param configured - row-config command.
 * @param options - platform/env/existence overrides for tests and diagnostics.
 * @returns the executable to spawn.
 */
export function resolveDockerCommand(configured, options = {}) {
    if (configured !== "docker") return configured;
    const platform = options.platform === void 0 ? process.platform : options.platform;
    if (platform !== "linux") return configured;
    const exists =
        options.exists === void 0
            ? (candidate) => {
                  try {
                      fs.accessSync(candidate, fs.constants.X_OK);
                      return true;
                  } catch {
                      return false;
                  }
              }
            : options.exists;
    for (const candidate of wslDockerCommandCandidates(options)) {
        if (exists(candidate)) return candidate;
    }
    return configured;
}

/** Modes accepted by the `gatewayStderr` row-config field. */
export const GATEWAY_STDERR_MODES = ["log", "console"];

/** Candidate POSIX shells used only to redirect the gateway's stderr. The
 * wrapper `exec`s the gateway with its original argv, so the gateway process
 * never sees the wrapper and the argv shape (`mcp gateway run --profile
 * <id>` + extraArgs) is untouched — the hard constraint holds verbatim. */
const SH_PATH_CANDIDATES = ["/bin/sh", "/usr/bin/sh"];

/**
 * Default location of the gateway stderr log:
 * `<tmpdir>/dsh-docker-mcp-<serverName>-gateway-<pid>.log`. One file per
 * running dsh instance; the wrapper truncates it on every gateway spawn, so
 * it always holds the latest gateway session's output.
 * @param serverName - the bridge server namespace.
 * @param options - tmpdir/pid overrides for tests and diagnostics.
 */
export function gatewayStderrLogPath(serverName, options = {}) {
    const tmp = typeof options.tmpdir === "string" && options.tmpdir !== "" ? options.tmpdir : os.tmpdir();
    const pid = options.pid === void 0 ? process.pid : options.pid;
    const safe = typeof serverName === "string" ? serverName.replace(/[^A-Za-z0-9_-]/gu, "-") : "gateway";
    return path.join(tmp, `dsh-docker-mcp-${safe}-gateway-${pid}.log`);
}

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
export function buildGatewaySpawn(target, options = {}) {
    const raw = { command: target.command, args: [...target.args], redirect: "", fallback: "" };
    const mode = target.stderr === void 0 ? "log" : target.stderr;
    if (mode !== "log") return raw;
    const platform = options.platform === void 0 ? process.platform : options.platform;
    if (platform !== "linux" && platform !== "darwin") return { ...raw, fallback: "platform" };
    const exists =
        options.exists === void 0
            ? (candidate) => {
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
function bridgeConfig(entry, profile, command, stderrMode) {
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
            transport: "stdio",
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

/** Environment variable that seeds the base profile for one dsh run. */
export const PROFILE_ENV_VAR = "DSH_DOCKER_MCP_PROFILE";

/**
 * Resolve the base (pre-UI) profile for one run.
 * @param configured - the row config `profile` value.
 * @param envValue - `DSH_DOCKER_MCP_PROFILE` as seen in the launch env.
 * @returns the env value when it is a valid profile id, else the configured one.
 */
export function resolveBaseProfile(configured, envValue) {
    if (typeof envValue === "string" && envValue !== "" && PROFILE_PATTERN.test(envValue)) return envValue;
    return configured;
}

/**
 * Resolve the executable actually in use for one (UI override, row config)
 * pair. An explicit override wins verbatim (paths are not rewritten); an
 * empty override falls back to {@link resolveDockerCommand} of the row-config
 * command, so the WSL host-path rewrite applies only to the literal default.
 * @param override - the persisted `command` user field, or "" when unset.
 * @param configuredCommand - the row-config `command`.
 */
export function resolveEffectiveCommand(override, configuredCommand) {
    const o = typeof override === "string" ? override.trim() : "";
    return resolveDockerCommand(o !== "" ? o : configuredCommand);
}

/**
 * Read the last UI-selected executable override from the persisted user layer
 * when the settings service is already up. Empty/absent means "auto-resolve".
 * @param ctx - plugin context.
 * @returns the persisted command string, or "" when unset/invalid/not ready.
 */
export function readPersistedCommand(ctx) {
    try {
        const settings = ctx.get("settings");
        const section = settings?.document?.[SETTINGS_NAMESPACE];
        if (section === null || typeof section !== "object" || Array.isArray(section)) return "";
        const value = section.command;
        if (typeof value === "string" && value.trim() !== "") return value.trim();
    } catch {
        // settings service not available yet: the initial onChange applies it.
    }
    return "";
}

/**
 * Read the last UI-selected profile from the persisted user layer when the
 * settings service is already up and the stored value is a valid profile id.
 * The host consults this before spawning the gateway so the very first
 * connection runs with the persisted selection — and every in-process
 * reconnect, which reuses the bridge config, comes back on it as well.
 * @param ctx - plugin context.
 * @returns the persisted profile id, or undefined when absent, invalid, or the settings service is not available yet (the installSection initial onChange then applies the persisted selection in place).
 */
export function readPersistedProfile(ctx) {
    try {
        const settings = ctx.get("settings");
        const section = settings?.document?.[SETTINGS_NAMESPACE];
        if (section === null || typeof section !== "object" || Array.isArray(section)) return void 0;
        const value = section.profile;
        if (typeof value === "string" && PROFILE_PATTERN.test(value)) return value;
    } catch {
        // settings service not available yet: env/row resolution still applies.
    }
    return void 0;
}

/**
 * Resolve the effective gateway-stderr mode: the persisted UI toggle
 * (`stderrMode`) wins when set; otherwise the row-config
 * `gatewayStderr`. An invalid/empty override falls back to the row config.
 * @param override - persisted `stderrMode` value, or "".
 * @param rowDefault - the validated row-config `gatewayStderr` ("log"/"console").
 * @returns "log" | "console".
 */
export function resolveStderrMode(override, rowDefault) {
    if (override === "log" || override === "console") return override;
    return rowDefault === "console" ? "console" : "log";
}

/**
 * Read the last UI "Reduce log output" selection from the persisted user
 * layer when the settings service is already up. Empty/absent/invalid means
 * "follow the row config".
 * @param ctx - plugin context.
 * @returns "log" | "console" when explicitly set, "" otherwise.
 */
export function readPersistedStderrMode(ctx) {
    try {
        const settings = ctx.get("settings");
        const section = settings?.document?.[SETTINGS_NAMESPACE];
        if (section === null || typeof section !== "object" || Array.isArray(section)) return "";
        const value = section.stderrMode;
        if (value === "log" || value === "console") return value;
    } catch {
        // settings service not available yet: the installSection initial onChange applies it.
    }
    return "";
}

/**
 * Mount the Docker Desktop MCP gateway and its settings-backed profile picker.
 * Profile precedence: settings user layer (UI selection) > DSH_DOCKER_MCP_PROFILE
 * env var > row config `profile` > schema default.
 * Executable precedence: the settings user-layer `command` override > the
 * auto-resolved row-config `command` (WSL host path for the literal default).
 * Stderr-mode precedence: the settings user-layer `stderrMode` (the card's
 * "Reduce log output" toggle) > the row-config `gatewayStderr`.
 * @param ctx - plugin context.
 * @param config - validated {@link Config}.
 */
function apply(ctx, config) {
    const ns = SETTINGS_NAMESPACE;
    // WSL + Docker Desktop: the default `docker` target is rewritten to the
    // Windows-side CLI whose store actually holds the UI-created profiles
    // (see {@link resolveDockerCommand}). The resolved value is the base-layer
    // `effectiveCommand` when no UI override is set; a UI-set executable
    // override wins verbatim. Both feed discovery, the bridge spawn and the
    // readiness probes.
    const rowCommand = resolveDockerCommand(config.command);
    if (rowCommand !== config.command) {
        ctx.logger.info(`docker-desktop-mcp(${config.serverName}): WSL host detected — using the Docker Desktop CLI at "${rowCommand}" (override in the card or with row-config "command")`);
    }
    const row = rowCommand === config.command ? config : { ...config, command: rowCommand };
    const envProfile = launchEnvironmentOf(ctx).get(PROFILE_ENV_VAR)?.value;
    const baseProfile = resolveBaseProfile(config.profile, envProfile);
    if (envProfile !== void 0 && envProfile !== "" && baseProfile !== envProfile) {
        ctx.logger.warn(`docker-desktop-mcp(${config.serverName}): ignoring ${PROFILE_ENV_VAR}="${envProfile}" — not a valid profile id (pattern ${PROFILE_PATTERN}); using "${baseProfile}"`);
    }
    // The persisted UI selection wins over env/row config: seed the first
    // gateway spawn with it. When the settings service is not up yet this
    // yields the base profile, and the installSection initial onChange below
    // switches the bridge to the persisted selection in place right after.
    const initialProfile = readPersistedProfile(ctx) ?? baseProfile;

    // Composition base layer: held in memory, never persisted. The executable
    // actually in use (`effectiveCommand`) and the discovery results live here.
    // NOTE: `dsh-settings` only re-serves the resolved value on writes, so a
    // base-entry mutation is invisible to clients until the host pushes it —
    // see {@link pushBaseLayer}.
    const entry = {
        profile: initialProfile,
        effectiveCommand: "",
        /** Row-config `gatewayStderr` in effect — static base-layer value, the
         * "Reduce log output" fallback when no persisted UI toggle is set. */
        rowStderr: config.gatewayStderr === "console" ? "console" : "log",
        profiles: [],
        lastRefreshError: "",
        discoveryRevision: 0
    };
    /** Live resolved settings value; swapped by installSection hooks. */
    let source = () => entry;
    /** Profile the nested bridge runs with — or, while the readiness wait is
     * still in flight, the profile its first start will use. */
    let runningProfile = initialProfile;
    /** Executable the nested bridge runs with — or, while the readiness wait
     * is still in flight, the executable its first start will use. A UI write
     * of `command` switches it verbatim; an empty override falls back to the
     * auto-resolved row config. */
    let runningCommand = resolveEffectiveCommand(readPersistedCommand(ctx), config.command);
    entry.effectiveCommand = runningCommand;
    /** Effective gateway-stderr mode ("log"/"console"): the persisted UI
     * toggle when set, else the row-config `gatewayStderr`. Every spawn
     * reads it, and a UI write of `stderrMode` hot-switches it. */
    let runningStderrMode = resolveStderrMode(readPersistedStderrMode(ctx), config.gatewayStderr);
    /** Nested mcp-client row; created when starting the gateway is safe. */
    let bridge = void 0;
    /** Last refreshNonce written BY THE HOST itself (the base-layer push below);
     * the loop guard that keeps its own `onChange` from re-running discovery. */
    let pushedNonce = void 0;
    /** Pending failed-run retry timer; armed only while discovery keeps failing. */
    let retryTimer = void 0;
    /** Consecutive scheduled retries after failed runs; reset on success. */
    let retriesPending = 0;
    /** Set once this host half is disposed; readiness must not start anything. */
    let disposed = false;
    ctx.effect(() => () => {
        disposed = true;
        if (retryTimer !== void 0) {
            clearTimeout(retryTimer);
            retryTimer = void 0;
        }
    });
    /** Last refreshNonce observed; undefined until the first settings commit. */
    let lastNonce = void 0;
    /** Serializes discovery runs so rapid refreshes never interleave. */
    let discovery = Promise.resolve();
    /** Resolves with the settings service once this half has installed its
     * section — every base-layer push needs a write, so every discovery run
     * waits for this gate. */
    let resolveSettingsGate;
    const settingsGate = new Promise((resolve) => {
        resolveSettingsGate = resolve;
    });

    /**
     * Push channel value convention: a POSITIVE `refreshNonce` is written only
     * by the browser (a refresh request); the host's own pushes are always
     * NEGATIVE (`-(Date.now())`). A negative marker that this instance did not
     * write itself therefore came from another dsh instance sharing the same
     * `settings.yaml` — a sync event that must never be re-broadcast (two
     * live instances would otherwise discovery-ping-pong forever), so it is
     * answered with a silent re-run that writes the marker value back
     * UNCHANGED: the resolved value is recomputed (raw-section write path) but
     * `bumpRevision` sees no raw change, fires no `document-updated`, and
     * nothing travels the wire.
     */
    /** Re-serve the base layer to open clients. `dsh-settings` recomputes the
     * resolved value it serves through `describe()` ONLY when the user
     * section is written (at registration or in `write()`), never when the
     * composition base entry mutates in memory — so a client-initiated
     * re-read would keep seeing the stale registration-time value. The only
     * host→client channel is a raw user-section change (which recomputes the
     * value and fires `settings/document-updated`), so every discovery run
     * ends with a host-owned `refreshNonce` bump — a negative
     * `-(Date.now())`, guarded by `pushedNonce` so it never re-triggers
     * discovery. This also reaches clients that open later: the recomputed
     * resolved value is host state, so their first `describe` read answers
     * with it. `echoValue` writes a received sync marker back unchanged
     * instead (see {@link pushBaseLayer} convention above).
     */
    const pushBaseLayer = (echoValue) => {
        pushedNonce = echoValue === void 0 ? -Date.now() : echoValue;
        return settingsGate
            .then((settings) => settings.mutate(ns, [{ op: "set", path: ["refreshNonce"], value: pushedNonce }]))
            .catch((error) =>
                ctx.logger.warn(`docker-desktop-mcp(${config.serverName}): discovery state push failed: ${String(error)}`)
            );
    };

    /**
     * Schedule one retry of a FAILED run — at boot the profile store may only
     * become reachable seconds after the first attempt. Bounded (capped
     * consecutive retries, reset on success, cancelled on dispose) so an
     * unavailable Docker Desktop is never retried forever.
     */
    const scheduleRetry = (echoValue) => {
        if (disposed) return;
        if (retryTimer !== void 0 || retriesPending >= DISCOVERY_RETRY_MAX) return;
        retriesPending += 1;
        retryTimer = setTimeout(() => {
            retryTimer = void 0;
            if (disposed || entry.lastRefreshError === "") return;
            void runDiscovery(echoValue === void 0 ? void 0 : { echo: echoValue });
        }, DISCOVERY_RETRY_DELAY_MS);
    };

    /**
     * One profile-list discovery. The run waits for BOTH gates (the settings
     * section — pushes need a writable section, and the gateway readiness —
     * discovery against a still-booting Docker Desktop is the useless early
     * attempt that showed the GUI "Profile not found" until the next click).
     * The result lands in the base layer (memory) AND is pushed to open
     * clients by {@link pushBaseLayer}; a failure additionally arms
     * {@link scheduleRetry}. `options.echo` is the received negative sync
     * marker: the push (and any retry push) writes it back UNCHANGED so the
     * re-run never re-broadcasts to sibling instances.
     */
    const runDiscovery = (options) => {
        const echoValue = options !== void 0 && typeof options.echo === "number" ? options.echo : void 0;
        discovery = discovery
            .then(async () => {
                await settingsGate;
                await gatewayGate;
                if (disposed) return;
                try {
                    entry.effectiveCommand = runningCommand;
                    entry.profiles = await listProfiles(runningCommand);
                    entry.lastRefreshError = "";
                } catch (error) {
                    entry.profiles = [];
                    entry.lastRefreshError = (error instanceof Error ? error.message : String(error)).split(/\r?\n/u)[0];
                    ctx.logger.warn(`docker-desktop-mcp(${config.serverName}): profile discovery failed: ${entry.lastRefreshError}`);
                }
                entry.discoveryRevision += 1;
                void pushBaseLayer(echoValue);
                if (entry.lastRefreshError === "") retriesPending = 0;
                else scheduleRetry(echoValue);
            })
            .catch(() => {});
        return discovery;
    };

    // Initial connection with the resolved profile/executable (persisted UI
    // selection > env var > row config > schema default), started as soon as
    // starting the gateway is safe (see waitForGatewayReady): the gateway's
    // OAuth notification monitor dials the Docker Desktop backend API socket
    // once without retrying, so a too-early spawn strands the stream and
    // prints the cold-start `Failed to connect to OAuth notifications` line.
    /** Last emitted gateway-stderr notice (redirect target or fallback
     * reason); suppresses repeats across switch/reconnect churn. */
    let stderrNotice = "";

    /**
     * Announce where the gateway's console output goes — one line per change
     * of state, keyed on what actually happened, so neither the "log" capture
     * nor a switch to console echo is silent. An unavailable redirect (no
     * POSIX shell) warns with the reason so the fallback is not mysterious.
     */
    const noteGatewayStderr = (built) => {
        const key = built.redirect !== "" ? `file:${built.redirect}` : built.fallback !== "" ? `fallback:${built.fallback}` : "console";
        if (stderrNotice === key) return;
        stderrNotice = key;
        if (built.fallback === "platform") {
            ctx.logger.warn(`docker-desktop-mcp(${config.serverName}): gatewayStderr="log" is unavailable on this platform (no POSIX shell wrapper) — gateway logs keep going to the console`);
        } else if (built.fallback === "shell") {
            ctx.logger.warn(`docker-desktop-mcp(${config.serverName}): gatewayStderr="log" is unavailable (no /bin/sh was found) — gateway logs keep going to the console`);
        } else if (built.redirect !== "") {
            ctx.logger.info(`docker-desktop-mcp(${config.serverName}): gateway stderr → ${built.redirect}`);
        } else {
            ctx.logger.info(`docker-desktop-mcp(${config.serverName}): gateway stderr → console (echo)`);
        }
    };

    const startBridge = () => {
        if (bridge === void 0) {
            const built = bridgeConfig(row, runningProfile, runningCommand, runningStderrMode);
            noteGatewayStderr(built);
            bridge = ctx.plugin(McpClient, built.config);
        }
        return bridge;
    };
    /** Gateway-readiness gate; also the trigger for the FIRST discovery run —
     * the first connection starts as soon as spawning is safe (see above) and
     * discovery only answers with the real profile store once the daemon is
     * reachable, so the initial run waits for this gate instead of running
     * blind at section registration. */
    const gatewayGate = waitForGatewayReady(runningCommand, { shouldStop: () => disposed })
        .then((state) => {
            if (disposed) return;
            if (state === "timed-out") {
                ctx.logger.warn(`docker-desktop-mcp(${config.serverName}): Docker Desktop never accepted a gateway backend API connection within ${GATEWAY_READY_TIMEOUT_MS}ms — starting the gateway anyway (the OAuth notification stream may be unavailable)`);
            }
            startBridge();
            void runDiscovery();
        })
        .catch((error) => ctx.logger.error(`docker-desktop-mcp(${config.serverName}): gateway start wait failed: ${String(error)}`));

    /**
     * Restart the nested bridge with one profile + executable; failures are
     * logged, never thrown. Called for a profile change, an executable
     * override change, or both — a hot `fiber.update` re-validates and restarts
     * the connection in place (the row config is never recreated).
     */
    const switchConnection = (profile, command) => {
        runningProfile = profile;
        runningCommand = command;
        entry.effectiveCommand = command;
        // Bridge not started yet: the first start above reads these fields.
        if (bridge === void 0) return;
        ctx.logger.info(`docker-desktop-mcp(${config.serverName}): switching gateway connection to profile "${profile}" executable "${command}"`);
        const built = bridgeConfig(row, profile, command, runningStderrMode);
        noteGatewayStderr(built);
        Promise.resolve(bridge.update(built.config)).catch((error) =>
            ctx.logger.error(`docker-desktop-mcp(${config.serverName}): connection switch to profile "${profile}" executable "${command}" failed: ${String(error)}`)
        );
    };

    /** Switch the running profile, keeping the current executable. */
    const switchProfile = (profile) => switchConnection(profile, runningCommand);

    /**
     * Switch the effective gateway-stderr mode in place — the Web card's
     * "Reduce log output" toggle. Only the spawn wrapper changes, but that
     * means restarting the gateway connection (the stream routing is fixed
     * at spawn); the profile/executable stay exactly as they were. While the
     * first start is still gated on readiness the later `startBridge` reads
     * `runningStderrMode`, so only recording is done then.
     */
    const applyStderrMode = (mode) => {
        runningStderrMode = mode;
        if (bridge === void 0) return;
        ctx.logger.info(`docker-desktop-mcp(${config.serverName}): gateway stderr mode → "${mode}" (restarting the gateway connection)`);
        const built = bridgeConfig(row, runningProfile, runningCommand, mode);
        noteGatewayStderr(built);
        Promise.resolve(bridge.update(built.config)).catch((error) =>
            ctx.logger.error(`docker-desktop-mcp(${config.serverName}): gateway stderr mode switch to "${mode}" failed: ${String(error)}`)
        );
    };

    // Mutable ref to the settings service, populated when the settings
    // inject callback fires (synchronously during apply).  Commands closure
    // captures this reference; it will be available by the time a handler
    // actually runs.
    let settings = undefined;

    // Registrations land in the COMMAND provider's own context effect, not
    // this plugin's — so without plugin-scoped cleanup a hot re-apply would
    // collide with the still-live definitions (the registry throws on a
    // duplicate name). The effect below releases this half's registrations
    // when this plugin ctx is disposed, keeping re-applies clean.
    const commandDisposers = [];
    ctx.effect(() => () => {
        for (const dispose of commandDisposers.splice(0)) dispose();
    });

    // ── slash commands ─────────────────────────────────────────────────────
    ctx.inject(["commands"], (commandsCtx) => {
        const cmds = commandsCtx.commands;
        /** Register one definition and retain its disposer so the plugin-ctx
         * effect above can release it. The registry throws on a duplicate
         * name (a re-apply racing a still-registered pair); in that case the
         * earlier definitions stay live, so a warning beats breaking apply. */
        const registerCommand = (definition) => {
            try {
                commandDisposers.push(cmds.register(definition));
            } catch (error) {
                ctx.logger.warn(`docker-desktop-mcp(${config.serverName}): command "${definition.name}" registration skipped: ${String(error)}`);
            }
        };

        // /docker-profile <profile-id>
        registerCommand({
            name: "docker-profile",
            description: "Switch Docker MCP gateway profile",
            input: { hint: "profile-id" },
            async handler(invocation) {
                if (settings === void 0) {
                    return {
                        kind: "error",
                        text: "Settings not yet available."
                    };
                }
                const input = invocation.rawInput.trim();
                // Reject: empty, spaces, tabs, newlines, multiple tokens.
                if (input.length === 0) {
                    return {
                        kind: "error",
                        text: `Usage: /docker-profile <profile-id>\nAvailable: ${entry.profiles.join(", ") || "(none discovered yet)"}`
                    };
                }
                if (input.includes(" ")) {
                    return {
                        kind: "error",
                        text: "Exactly one profile id required (no spaces)."
                    };
                }
                if (!PROFILE_PATTERN.test(input)) {
                    return {
                        kind: "error",
                        text: `Invalid profile id (pattern: ${PROFILE_PATTERN.source}).`
                    };
                }
                const alreadyActive = bridge !== void 0 && runningProfile === input;
                try {
                    await settings.mutate(ns, [{ op: "set", path: ["profile"], value: input }]);
                } catch (error) {
                    return {
                        kind: "error",
                        text: `Failed to persist profile: ${error instanceof Error ? error.message : String(error)}.`
                    };
                }
                // No-op case: the requested id is already what the running
                // gateway uses — report it as such instead of claiming a
                // reconnect that never happens (onChange skips a same-profile
                // write, so no bridge update is issued either).
                if (alreadyActive) {
                    return { kind: "success", text: `Profile "${input}" is already active.` };
                }
                // Bridge not yet started: settings.onChange will apply it.
                if (bridge === void 0) {
                    return { kind: "success", text: `Profile "${input}" selected. Gateway will start with it.` };
                }
                return { kind: "success", text: `Profile "${input}" selected. Gateway reconnecting.` };
            }
        });

        // /docker-refresh
        registerCommand({
            name: "docker-refresh",
            description: "Re-discover Docker MCP profiles from gateway",
            input: { hint: "(no arguments)" },
            async handler(invocation) {
                const before = entry.discoveryRevision;
                try {
                    await runDiscovery();
                } catch (error) {
                    return {
                        kind: "error",
                        text: `Discovery failed: ${error instanceof Error ? error.message : String(error)}.`
                    };
                }
                if (entry.discoveryRevision === before) {
                    return {
                        kind: "error",
                        text: "Profile discovery did not complete."
                    };
                }
                if (entry.lastRefreshError) {
                    return {
                        kind: "error",
                        text: entry.lastRefreshError
                    };
                }
                return {
                    kind: "success",
                    text: `Discovered ${entry.profiles.length} profile(s): ${entry.profiles.join(", ") || "(none)"}.`
                };
            }
        });
    });

    ctx.inject(["settings"], (settingsCtx) => {
        settings = settingsCtx.settings;
        settings.installSection(ctx, ns, SettingsSchema, entry, {
            setSource: (next) => {
                source = next;
            },
            validate: (value) => {
                if (!PROFILE_PATTERN.test(value.profile)) {
                    throw new Error(`settings "${ns}": profile must match ${PROFILE_PATTERN}`);
                }
                if (value.command !== "" && !COMMAND_PATTERN.test(value.command)) {
                    throw new Error(`settings "${ns}": command must be a single trimmed path/command with no control characters`);
                }
                if (
                    value.stderrMode !== "" &&
                    value.stderrMode !== "log" &&
                    value.stderrMode !== "console"
                ) {
                    throw new Error(`settings "${ns}": stderrMode must be "log", "console" or empty (row-config default)`);
                }
            },
            onChange: () => {
                try {
                    const current = source();
                    // Executable override changes (including an empty value
                    // that falls back to the auto-resolved row config) switch
                    // the bridge AND re-discover: a different executable reads
                    // a different profile store. A same-executable profile
                    // change only switches. Order matters: the executable
                    // switch already updates the running profile, so skip the
                    // profile-only switch when both land in one commit.
                    const nextCommand = resolveEffectiveCommand(current.command, config.command);
                    const commandChanged = nextCommand !== runningCommand;
                    if (commandChanged) {
                        switchConnection(current.profile, nextCommand);
                        // A live bridge must restart its discovery on the new
                        // executable; while the first start is still gated on
                        // readiness the scheduled run already reads the updated
                        // runningCommand, so an extra run would be redundant.
                        if (bridge !== void 0) void runDiscovery();
                    } else if (current.profile !== runningProfile) switchProfile(current.profile);
                    // The "Reduce log output" toggle lives here too: a change
                    // of the effective stderr mode restarts the gateway
                    // connection with/without the stderr-capturing wrapper.
                    // Independent of the profile/command handling above — a
                    // toggle commit leaves both untouched.
                    const nextStderrMode = resolveStderrMode(current.stderrMode, config.gatewayStderr);
                    if (nextStderrMode !== runningStderrMode) applyStderrMode(nextStderrMode);
                    if (current.refreshNonce !== lastNonce) {
                        const firstCommit = lastNonce === void 0;
                        lastNonce = current.refreshNonce;
                        // The first commit is not a refresh request — the
                        // initial run is scheduled by the gateway-readiness
                        // continuation — and the host's own pushes (and
                        // echoes) must not re-trigger discovery. A positive
                        // change is a UI refresh request; a NEGATIVE one this
                        // instance did not write is a sibling host's sync
                        // marker: answer locally and silently (echo run),
                        // never as a broadcast.
                        if (!firstCommit && current.refreshNonce !== pushedNonce) {
                            if (typeof current.refreshNonce === "number" && current.refreshNonce < 0) {
                                void runDiscovery({ echo: current.refreshNonce });
                            } else void runDiscovery();
                        }
                    }
                } catch (error) {
                    ctx.logger.error(`docker-desktop-mcp(${config.serverName}): ${String(error)}`);
                }
            }
        });
        resolveSettingsGate(settings);
        // One-time cleanup: earlier versions persisted the discovery state
        // (profiles, lastRefreshError) into the user layer, and `effectiveCommand`
        // is base-layer-only — the user-authored user fields are just
        // `profile`, `command` and `refreshNonce`. Unset the non-user keys so
        // settings.yaml carries only user-authored fields; the raw section
        // change also re-serves the fresh base layer to open clients.
        Promise.resolve()
            .then(() => {
                const section = settings.document?.[ns];
                const ops = [];
                if (section !== null && typeof section === "object" && !Array.isArray(section)) {
                    if ("profiles" in section) ops.push({ op: "unset", path: ["profiles"] });
                    if ("lastRefreshError" in section) ops.push({ op: "unset", path: ["lastRefreshError"] });
                    if ("discoveryRevision" in section) ops.push({ op: "unset", path: ["discoveryRevision"] });
                    if ("effectiveCommand" in section) ops.push({ op: "unset", path: ["effectiveCommand"] });
                    if ("rowStderr" in section) ops.push({ op: "unset", path: ["rowStderr"] });
                }
                if (ops.length === 0) return;
                return settings.mutate(ns, ops);
            })
            .catch((error) => {
                ctx.logger.warn(`docker-desktop-mcp(${config.serverName}): legacy settings cleanup failed: ${String(error)}`);
            });
    });
}

export { apply, inject, name };
