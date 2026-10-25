/**
 * @comecaramelos/dsh-docker-desktop-mcp — host half, public surface.
 *
 * A **component** of the MCP manager bundle: it teaches the manager what a
 * Docker Desktop profile *is*, and answers for every live
 * `docker mcp gateway run --profile <name>` connection the manager starts. It is
 * not a bridge of its own any more: nothing here spawns a gateway unless a
 * `docker-profile` connection asks what to run, which is what
 * `inject: ["mcpConnections"]` stands for — no manager mounted, no connection,
 * nothing running.
 *
 * What stays this row's own is the machine half, and it is edited through the
 * row's configuration form (there is no `settings.yaml`): the two named catalogs
 * (`profileEntries`, `executables`) and the two fetch triggers
 * (`refreshNonce`, `refreshExecutablesNonce`), plus what a **standalone** install
 * left behind (`profile`, `dockerPath`, `stderrMode`, `command`, `extraArgs`, …)
 * — read, never rewritten, because it is what the row says, and what the
 * translation offered under D4 is read from. Every live answer the Host serves
 * (`profiles`, `executableCandidates`, `effectiveCommand`, `effectiveSource`,
 * `stderrEffective`, `lastRefreshError` and the two run counters) rides volatile
 * fields of the same `Config`, committed without a remount and never persisted —
 * a persisted write clears those keys back to their row answers.
 *
 * One profile entry per instance, keyed by its profile entry id — the key every
 * read and write goes through, and the id the card's slot key is composed from.
 *
 * Config (the cordis row, and the form the GUI edits):
 *   serverName          tool namespace prefix                (default "docker")
 *   command             gateway executable, auto-resolved on
 *                       WSL to the Windows-side CLI           (default "docker")
 *   profile             row-config profile default           (default "default")
 *   dockerPath          row-config executable override       (default "")
 *   stderrMode          "log" | "console" | "" = follow gatewayStderr
 *   extraArgs           args appended after `--profile`
 *   gatewayStderr       console-output routing when nothing picks it
 *   gatewayStderrLog    explicit log path for "log" mode (empty = auto)
 *   env / cwd / toolCallTimeoutMs / failOnStartupError / reconnect
 *                       the spawn passthroughs a connection inherits
 *
 * Everything behind this surface lives in ./host/*:
 *
 *   ./host/apply.ts       the wiring (controller + manager + commands + form)
 *   ./host/manager.ts     the `docker-profile` kind + the D4 translation
 *   ./host/kind.ts        what one connection runs with, and why it cannot
 *   ./host/migration.ts   the standalone-config translation (offer, never write)
 *   ./host/controller/    live mirror, runs, retries, commit routing, writes
 *   ./host/settings.ts    the form's attach (the shared adapter owns the rest)
 *   ./host/commands/      `/docker-profile` + `/docker-refresh`
 *   ./host/discovery.ts   `docker mcp profile list` + its tolerant parser
 *   ./host/executables.ts the filesystem scan behind the executable catalog
 *   ./host/catalog.ts     the named rows' validation + merge rules
 *   ./host/gateway.ts     the spawn argv + where its stderr goes
 *   ./host/readiness.ts   the bounded cold-start wait
 *   ./host/docker.ts      the WSL host-CLI resolution
 *   ./host/values.ts      reference/layer reads + precedence resolution
 *   ./host/schema.ts      the zod schema (one `Config`)
 *   ./host/constants.ts   fixed identifiers, budgets, patterns
 *   ./host/types/         shared type sections (config, form layers, services)
 */

// ── identity ────────────────────────────────────────────────────────────────
export { inject, name } from "./host/plugin-meta.js";

// ── fixed identifiers and budgets ───────────────────────────────────────────
export {
    DISCOVERY_RETRY_DELAY_MS,
    DISCOVERY_RETRY_MAX,
    ENTRY_ID,
    GATEWAY_READY_TIMEOUT_MS,
    GATEWAY_STDERR_MODES,
    KIND_FIELDS,
    KIND_ID,
    KIND_LABEL,
    KIND_MAX_ENTRIES,
    KIND_SUMMARY,
    MANAGER_BUNDLE_ID,
    MIGRATION_DISMISSED_FIELD,
    PROFILE_ENV_VAR,
    WSL_DOCKER_HOST_COMMAND,
    WSL_DOCKER_PATH_CANDIDATE
} from "./host/constants.js";

// ── the row's single Config (also the configuration form) ───────────────────
export { Config } from "./host/schema.js";

// ── the wiring ──────────────────────────────────────────────────────────────
export { apply } from "./host/apply.js";

// ── the connection kind, and what one entry runs with ───────────────────────
export {
    createDockerKind,
    entryCommand,
    entryExtraArgs,
    entryProfile,
    entryStderrMode,
    executableChoices,
    profileChoices
} from "./host/kind.js";
export { carriesStandaloneConfig, standaloneProposal } from "./host/migration.js";

// ── the behavior tests and diagnostics drive directly ───────────────────────
export { entryIds, entryLabel, isSmokeFixturePath, isValidEntryId, mergeEntries, normalizeEntries } from "./host/catalog.js";
export { extractProfileIds, listProfiles } from "./host/discovery.js";
export { discoverExecutables } from "./host/executables.js";
export { buildGatewaySpawn, gatewayConfig, gatewayStderrLogPath } from "./host/gateway.js";
export { resolveDockerCommand } from "./host/docker.js";
export { backendApiSocketPaths, dockerDaemonResponds, probeBackendApiSocket, waitForGatewayReady } from "./host/readiness.js";
export {
    createLiveMirror,
    liveMirrorKeys,
    readConfigField,
    readConfigLayers,
    resolveEffectiveCommand,
    resolveProfileFromConfig,
    resolveStderrMode
} from "./host/values.js";

// The composition (./host/controller, ./host/manager.ts, ./host/settings.ts,
// ./host/commands) and the internal identifiers (the profile-id pattern, the
// readiness probe budgets) stay off this surface: they are implementation, and
// widening it is a public-API change.

export type {
    CatalogEntry,
    ConfigField,
    ConfigLayerFields,
    ConfigLayers,
    ConfigLiveFields,
    ConfigUserFields,
    CommandDefinition,
    CommandInvocation,
    CommandResult,
    DockerMcpConfig,
    ExecutableDiscoveryOptions,
    GatewayConnection,
    GatewayReadyOptions,
    GatewayReadyState,
    GatewaySpawnOptions,
    GatewaySpawnResult,
    GatewaySpawnTarget,
    GatewayStderrLogPathOptions,
    GatewayStderrMode,
    PluginContext,
    ReconnectConfig,
    SettingsFormRow,
    SettingsForms,
    SettingsPathOp,
    SocketProbeState,
    WslDockerOptions
} from "./host/types/index.js";
