/**
 * Host-half shared types — one surface, six sections.
 *
 * The shapes every host module reads and writes: the validated row config, the
 * two settings layers, the services this half consumes through structural views,
 * the spawn-target shapes behind the gateway wrapper, the cold-start readiness
 * shapes, and the discovery-run options. Nothing here decides behavior — every
 * module behind this surface imports its own section.
 */
export type { DockerMcpConfig, GatewayStderrMode, ReconnectConfig } from "./config.js";
export type {
    CatalogEntry,
    SettingsBaseLayer,
    SettingsOp,
    SettingsResolved,
    SettingsService,
    SettingsUserFields
} from "./settings.js";
export type { CommandDefinition, CommandInvocation, CommandResult, McpBridge, PluginContext } from "./services.js";
export type {
    GatewaySpawnOptions,
    GatewaySpawnResult,
    GatewaySpawnTarget,
    GatewayStderrLogPathOptions,
    GatewayStderrNotice
} from "./gateway.js";
export type { GatewayReadyOptions, GatewayReadyState, SocketProbeState } from "./readiness.js";
export type { DiscoveryOptions, ExecutableDiscoveryOptions, WslDockerOptions } from "./discovery.js";
