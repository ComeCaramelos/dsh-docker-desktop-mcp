/**
 * Gateway spawn-target shapes — the argv the bridge hands the gateway process,
 * plus the stderr-wrapper diagnostics `noteStderr` announces.
 *
 * The wrapper never changes the argv shape: it rewrites only this bridge's
 * spawn target, so a wrapper decision is always local to one spawn (the live
 * rule in AGENTS.md "Gateway console noise").
 */
import type { GatewayStderrMode } from "./config.js";

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

/** Options for {@link buildGatewaySpawn}. */
export type GatewaySpawnOptions = GatewayStderrLogPathOptions & {
    platform?: NodeJS.Platform;
    exists?: (candidate: string) => boolean;
    serverName?: string;
};

/** One gateway spawn target: raw command/args plus wrapper diagnostics. */
export type GatewaySpawnResult = { command: string; args: string[]; redirect: string; fallback: string };

/** The wrapper-diagnostics subset {@link noteGatewayStderr} reads. */
export type GatewayStderrNotice = { redirect: string; fallback: string };
