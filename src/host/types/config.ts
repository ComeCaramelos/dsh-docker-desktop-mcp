/**
 * Types — the config `apply` receives, and the plugin context.
 *
 * One `Config` (./../schema.ts) carries everything: the ordinary row-config
 * fields the card only reads, the user-authored fields the card edits, and the
 * live answers the Host publishes. What decides the shape is the runtime
 * handing: dsh 0.2.0 gives `apply` a **reference** for every `.volatile()` field
 * and a plain value for every ordinary one, so reading a volatile field's type
 * is not reading what it holds (see ./values.ts `readConfigField`). The two
 * halves are typed apart for exactly that reason.
 */
import type { CatalogEntry } from "./settings.js";

/** Gateway console-output routing accepted by `gatewayStderr`. */
export type GatewayStderrMode = "log" | "console";

/** A `.volatile()` field as `apply` hands it: a live reference the fiber
 * resolves on every read, or — the shape a hand-built config (or a test) hands
 * — the plain value itself. Read it through `readConfigField` (./values.ts). */
export type ConfigField<T> = T | { get(): T };

/** Reconnect policy, mirroring the `dsh-mcp-client` bridge config. */
export type ReconnectConfig = {
    enabled: boolean;
    initialDelayMs: number;
    maxDelayMs: number;
    maxAttempts: number;
};

/**
 * The validated config as `apply` sees it: ordinary fields resolved to their
 * final shape (the card reads them, it never edits them), every volatile field
 * handed as a reference. This is the one config type the host half passes around
 * — the spawn argv and the bridge config read ordinary fields directly and take
 * every volatile one through `readConfigField`.
 */
export type DockerMcpConfig = {
    // ---- composition-only: read-only for the form ----
    serverName: string;
    /** Row-config gateway executable: the spawn target every UI pick
     * (`dockerPath`) stands over — and, for the literal default, the one the
     * WSL host-CLI rewrite applies to. */
    command: string;
    extraArgs: string[];
    /** Gateway console-output routing: "log" (default) redirects the spawned
     * gateway's inherited stderr into a log file; "console" inherits it. The
     * card's `stderrMode` toggle stands over this. See ./gateway.ts. */
    gatewayStderr: GatewayStderrMode;
    /** Optional absolute path for the stderr log ("" → auto; see ./gateway.ts
     * `gatewayStderrLogPath`). */
    gatewayStderrLog: string;
    env: Record<string, string>;
    cwd: string;
    toolCallTimeoutMs: number;
    failOnStartupError: boolean;
    reconnect: ReconnectConfig;

    // ---- form-editable (user layer) + Host-published (live mirror) ----
    /** The row's profile default. A connection's own `extra.profile` stands over
     * it, and the launch environment's `DSH_DOCKER_MCP_PROFILE` stands over that
     * (./kind.ts `entryProfile`). Composition-only — what a live connection runs
     * with is a live answer, not a field of this row. */
    profile: string;
    /** The executable the runs probe when no connection picks one ("" = the
     * row-config `command`, auto-resolved). Composition-only. */
    dockerPath: string;
    /** The profile catalog rows — `{ id, name }`, user-authored. */
    profileEntries: ConfigField<CatalogEntry[]>;
    /** The executable catalog rows — `{ id, name }`, user-authored. */
    executables: ConfigField<CatalogEntry[]>;
    /** The card's **Refresh profiles** trigger. */
    refreshNonce: ConfigField<number>;
    /** The card's **Fetch executables** trigger. */
    refreshExecutablesNonce: ConfigField<number>;
    /** Where a connection's stderr goes when it states no mode of its own:
     * `"log"`/`"console"`/"" (meaning "follow `gatewayStderr`"). Composition-only. */
    stderrMode: "" | GatewayStderrMode;
    /** Whether the translation of this row's standalone configuration has been
     * turned down (see ./kind.ts + ./migration.ts). Host-written through the
     * row's own write channel, so it is a volatile reference. */
    migrationDismissed: ConfigField<boolean>;

    // ---- Host-published live answers (never persisted) ----
    /** Executable the gateway actually spawns with ("" = not answered yet). */
    effectiveCommand: ConfigField<string>;
    /** Where `effectiveCommand` came from — "user" or "row-config" ("" = not
     * answered). */
    effectiveSource: ConfigField<string>;
    /** The stderr mode the live connection actually runs with — the answer the
     * kind's field is read against, and never a third state. */
    stderrEffective: ConfigField<GatewayStderrMode>;
    /** Profile ids the last discovery reported — candidate list only. */
    profiles: ConfigField<string[]>;
    /** Executable paths the last scan found — candidate list only. */
    executableCandidates: ConfigField<string[]>;
    /** Last profile-discovery failure line; "" when healthy. */
    lastRefreshError: ConfigField<string>;
    /** Profile-list discovery run counter — the fetch's settle signal. */
    discoveryRevision: ConfigField<number>;
    /** Executable-scan run counter — lets a card tell the two runs apart. */
    executableDiscoveryRevision: ConfigField<number>;
};
