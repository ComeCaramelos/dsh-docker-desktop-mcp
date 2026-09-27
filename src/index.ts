/**
 * @comecaramelos/dsh-docker-desktop-mcp — host half, public surface.
 *
 * Connects the Docker Desktop MCP gateway (`docker mcp gateway run
 * --profile <name>`) as an MCP server through the stock
 * @deepseek-ai/dsh-mcp-client bridge, and exposes the gateway `--profile`
 * choice as a user setting: the Web GUI's Plugins settings page renders a
 * picker (see ./client.js) backed by the `docker-desktop-mcp` settings
 * namespace. Selecting a profile re-applies the nested mcp-client plugin in
 * place (fiber.update), which restarts the gateway connection with the new
 * `--profile` argument.
 *
 * Persistence boundary: only the user-authored fields land in
 * `$DSH_HOME/settings.yaml` — `profile` (the last UI profile selection),
 * `command` (the last UI executable id), `stderrMode` (the last "Reduce log
 * output" toggle), the two catalog rows (`profileEntries` / `executables` — the
 * named options both dropdowns list, kept in step with what the store reports)
 * and the two refresh triggers (`refreshNonce` / `refreshExecutablesNonce`;
 * `harness.handle` is reserved for code-string halves). The executable actually
 * in use (`effectiveCommand`) plus discovery state (`profiles`,
 * `lastRefreshError`, `discoveryRevision`, `executableDiscoveryRevision`) ride
 * the composition base layer — held in memory, never persisted — but
 * `dsh-settings` recomputes the `describe()` resolved value it serves only when
 * the user section is written, so the host pushes after every discovery run with
 * a host-owned negative refresh-nonce bump (profile runs on `refreshNonce`,
 * executable-catalog runs on `refreshExecutablesNonce`): that raw change
 * recomputes the served value and fires `settings/document-updated`, the only
 * host→client channel. The two counters exist so a client can tell which of the
 * two waits finished.
 *
 * One plugin instance per dsh host: the settings namespace is fixed.
 *
 * Everything behind this surface lives in ./host/*:
 *
 *   ./host/apply.ts       the wiring (controller + commands + section)
 *   ./host/controller/    live state: base layer, bridge, discovery, retries
 *   ./host/settings.ts    namespace install, commit routing, validation
 *   ./host/commands/      `/docker-profile` + `/docker-refresh`
 *   ./host/discovery.ts   `docker mcp profile list` + its tolerant parser
 *   ./host/executables.ts the filesystem scan behind the executable catalog
 *   ./host/catalog.ts     the named rows' validation + merge rules
 *   ./host/gateway.ts     the spawn argv + the stderr wrapper
 *   ./host/readiness.ts   the bounded cold-start wait
 *   ./host/docker.ts      the WSL host-CLI resolution
 *   ./host/values.ts      precedence resolution + persisted reads
 *   ./host/schema.ts      the zod schemas
 *   ./host/constants.ts   fixed identifiers, budgets, patterns
 *   ./host/types/         shared type sections (config, settings, services, …)
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

// ── identity ────────────────────────────────────────────────────────────────
export { inject, name } from "./host/plugin-meta.js";

// ── fixed identifiers and budgets ───────────────────────────────────────────
export {
    DISCOVERY_RETRY_DELAY_MS,
    DISCOVERY_RETRY_MAX,
    GATEWAY_STDERR_MODES,
    PROFILE_ENV_VAR,
    SETTINGS_NAMESPACE,
    WSL_DOCKER_HOST_COMMAND,
    WSL_DOCKER_PATH_CANDIDATE
} from "./host/constants.js";

// ── the two schemas ─────────────────────────────────────────────────────────
export { Config, SettingsSchema } from "./host/schema.js";

// ── the wiring ──────────────────────────────────────────────────────────────
export { apply } from "./host/apply.js";

// ── the behavior tests and diagnostics drive directly ───────────────────────
export { entryIds, entryLabel, isSmokeFixturePath, isValidEntryId, mergeEntries, normalizeEntries } from "./host/catalog.js";
export { extractProfileIds, listProfiles } from "./host/discovery.js";
export { discoverExecutables } from "./host/executables.js";
export { buildGatewaySpawn, gatewayStderrLogPath } from "./host/gateway.js";
export { resolveDockerCommand } from "./host/docker.js";
export { backendApiSocketPaths, dockerDaemonResponds, probeBackendApiSocket, waitForGatewayReady } from "./host/readiness.js";
export {
    readPersistedCommand,
    readPersistedProfile,
    readPersistedStderrMode,
    resolveBaseProfile,
    resolveEffectiveCommand,
    resolveStderrMode
} from "./host/values.js";

// The composition (./host/controller.ts, ./host/settings.ts, ./host/commands.ts)
// and the internal identifiers (the profile-id pattern, the shell script, the
// POSIX-shell candidates) stay off this surface: they are implementation, and
// widening it is a public-API change.

export type { DockerMcpConfig, GatewayStderrMode, ReconnectConfig } from "./host/types/index.js";
export type {
    CatalogEntry,
    CommandDefinition,
    CommandInvocation,
    CommandResult,
    DiscoveryOptions,
    ExecutableDiscoveryOptions,
    GatewayReadyOptions,
    GatewayReadyState,
    GatewaySpawnOptions,
    GatewaySpawnResult,
    GatewaySpawnTarget,
    GatewayStderrLogPathOptions,
    GatewayStderrNotice,
    McpBridge,
    PluginContext,
    SettingsBaseLayer,
    SettingsOp,
    SettingsResolved,
    SettingsService,
    SettingsUserFields,
    SocketProbeState,
    WslDockerOptions
} from "./host/types/index.js";
