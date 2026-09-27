/**
 * Row-config shapes — what the plugin's own settings carry.
 *
 * Every validated row config is a `DockerMcpConfig`: the gateway command plus
 * the reconnect policy mirrored from the `dsh-mcp-client` bridge config.
 * Nothing here decides behavior; it is the vocabulary the other sections read.
 */

/** Gateway console-output routing accepted by `gatewayStderr`. */
export type GatewayStderrMode = "log" | "console";

/** Reconnect policy, mirroring the `dsh-mcp-client` bridge config. */
export type ReconnectConfig = {
    enabled: boolean;
    initialDelayMs: number;
    maxDelayMs: number;
    maxAttempts: number;
};

/** Validated row config (every field carries a schema default). */
export type DockerMcpConfig = {
    serverName: string;
    command: string;
    profile: string;
    extraArgs: string[];
    gatewayStderr: GatewayStderrMode;
    gatewayStderrLog: string;
    env: Record<string, string>;
    cwd: string;
    toolCallTimeoutMs: number;
    failOnStartupError: boolean;
    reconnect: ReconnectConfig;
};
