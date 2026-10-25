/**
 * Gateway spawn-target shapes — the argv the bridge hands the gateway process,
 * plus the stderr-wrapper diagnostics `noteStderr` announces.
 *
 * The wrapper never changes the argv shape: it rewrites only this bridge's
 * spawn target, so a wrapper decision is always local to one spawn (the live
 * rule in AGENTS.md "Gateway console noise").
 */
import type { GatewayStderrMode, ReconnectConfig } from "./config.js";

/** Options for {@link gatewayStderrLogPath}. */
export type GatewayStderrLogPathOptions = { tmpdir?: string; pid?: number };

/** Spawn-target shape consumed by {@link buildGatewaySpawn}. */
export type GatewaySpawnTarget = {
    command: string;
    args: string[];
    stderr?: GatewayStderrMode;
    logPath?: string;
    serverName?: string;
};

/** Options for {@link buildGatewaySpawn} — passed through to `buildSpawn`. */
export type GatewaySpawnOptions = GatewayStderrLogPathOptions & {
    /** The Node executable the wrapper runs under (defaults to this process's). */
    execPath?: string;
};

/** One gateway spawn target: raw command/args plus where the stderr went. */
export type GatewaySpawnResult = { command: string; args: string[]; redirect: string };

/**
 * Everything one gateway connection runs with — what a `docker-profile` kind
 * answers when the manager asks what a live entry should spawn.
 */
export type GatewayConnection = {
    /** The executable to spawn. */
    command: string;
    /** The profile the gateway runs with — the only place that argument goes. */
    profile: string;
    /** Arguments appended after `--profile`. */
    extraArgs?: readonly string[];
    /** Where the gateway's stderr goes. */
    stderr?: GatewayStderrMode;
    /** The bridge server namespace (an entry id is the natural one). */
    serverName: string;
    /** Explicit log path ("" = auto, per `gatewayStderrLogPath`). */
    logPath?: string;
    /** Stdio-bridge passthroughs, all optional. */
    env?: Record<string, string>;
    cwd?: string;
    toolCallTimeoutMs?: number;
    failOnStartupError?: boolean;
    reconnect?: ReconnectConfig;
};
