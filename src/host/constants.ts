/**
 * Host-half fixed identifiers, budgets and validation patterns.
 *
 * The strings are a public contract — the settings namespace is both the
 * persistence key and the Web card's slot key — and the budgets are what the
 * README and the tests quote, so they live here once and every module imports
 * rather than repeats them.
 */
import type { GatewayStderrMode } from "./types/index.js";

/** Fixed settings namespace; also the client card's slot key. */
export const SETTINGS_NAMESPACE = "docker-desktop-mcp";

/** Environment variable that seeds the base profile for one dsh run. */
export const PROFILE_ENV_VAR = "DSH_DOCKER_MCP_PROFILE";

/**
 * Profile ids are CLI identifiers; keep the charset shell-safe (they are
 * appended to the gateway argv as `--profile <id>` and matched by the card).
 */
export const PROFILE_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * A user-authored docker executable is just a trimmed path/command; no shell
 * metacharacters, no control characters. Kept permissive (paths contain
 * `/`, spaces, `:` and `\`). Also used for optional paths that allow the
 * empty string (auto-resolution).
 */
export const COMMAND_PATTERN = /^[\t -~¡-￿]{1,1024}$/;

/** An optional path: a command-shaped string, or empty for auto-resolve. */
export const OPTIONAL_PATH_PATTERN = /^(?:[\t -~¡-￿]{1,1024})?$/;

/**
 * Paths carrying a `.smoke/` directory segment belong to the checkout's smoke
 * fixtures (the shims under `.smoke/`). They are test harness, never a docker
 * install, so they must never surface as executable-catalog rows, discovery
 * candidates or picker options. The row-config `command` is NOT validated this
 * way — the smoke overlays keep spawning their shims untouched.
 */
export const SMOKE_PATH_PATTERN = /(?:^|[\\/])\.smoke[\\/]/;

/** Modes accepted by the `gatewayStderr` row-config field. */
export const GATEWAY_STDERR_MODES: GatewayStderrMode[] = ["log", "console"];

/** Timeout for one profile discovery subprocess. */
export const DISCOVERY_TIMEOUT_MS = 15000;

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
export const GATEWAY_READY_POLL_MS = 1500;
export const GATEWAY_READY_TIMEOUT_MS = 15000;
/** One connect attempt at a backend API socket path is capped at this. */
export const BACKEND_API_CONNECT_TIMEOUT_MS = 2000;

/** Candidate POSIX shells used only to redirect the gateway's stderr. The
 * wrapper `exec`s the gateway with its original argv, so the gateway process
 * never sees the wrapper and the argv shape (`mcp gateway run --profile
 * <id>` + extraArgs) is untouched — the hard constraint holds verbatim. */
export const SH_PATH_CANDIDATES = ["/bin/sh", "/usr/bin/sh"];

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
 * Absolute candidate paths probed by {@link discoverExecutables} per platform
 * (the Web card's executable catalog refresh), in precedence order. Platform
 * paths come first, then the bare `PATH` names below.
 */
export const EXECUTABLE_PATH_CANDIDATES_LINUX = [
    WSL_DOCKER_HOST_COMMAND,
    "/usr/bin/docker",
    "/usr/local/bin/docker",
    "/snap/bin/docker",
    "/usr/local/bin/docker-compose"
];

/** macOS candidates: the Desktop bundle ships the CLI under Resources/bin. */
export const EXECUTABLE_PATH_CANDIDATES_DARWIN = [
    "/Applications/Docker.app/Contents/Resources/bin/docker",
    "/usr/local/bin/docker",
    "/opt/homebrew/bin/docker"
];

/** Windows candidates: the two install layouts Docker Desktop has shipped. */
export const EXECUTABLE_PATH_CANDIDATES_WIN32 = [
    "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
    "C:\\Program Files\\Docker Desktop\\Docker Desktop\\resources\\bin\\docker.exe"
];

/**
 * Bare `PATH` names probed after the absolute candidates. `docker.exe` first
 * (the Windows-side CLI the WSL interop exposes), then the POSIX binary.
 */
export const EXECUTABLE_PATH_NAMES = ["docker.exe", "docker", "docker-compose"];

/** Longest executable-path id the catalog accepts. */
export const COMMAND_MAX_LENGTH = 1024;

/** Longest custom display name the catalog accepts. */
export const CATALOG_NAME_MAX_LENGTH = 200;
