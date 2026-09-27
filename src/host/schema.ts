/**
 * Host-half zod schemas: the row config and the `docker-desktop-mcp` settings
 * namespace.
 *
 * The namespace schema is the persistence contract. Only `profile`, `command`,
 * `stderrMode` and `refreshNonce` are user-authored; `rowStderr`,
 * `effectiveCommand`, `profiles`, `lastRefreshError` and `discoveryRevision`
 * exist in the schema purely so the composition base layer (held in memory by
 * the host) can be served alongside them.
 */
import z from "@deepseek-ai/schemastery";
import { COMMAND_PATTERN, OPTIONAL_PATH_PATTERN, PROFILE_PATTERN } from "./constants.js";

/**
 * One catalog row: the id on the wire plus the custom UI label.
 *
 * Deliberately permissive: the real rules live in `catalog.ts` (id pattern,
 * length cap, de-duplication), applied by every reader. A stricter schema would
 * throw inside a `describe()`/resolution path over a hand-edited
 * `settings.yaml`, and a throw during `installSection` leaves the settings gate
 * unresolved — which silently stops discovery.
 */
const CatalogEntry = z.object({
    id: z.string().default(""),
    name: z.string().default("")
});

/** Reconnect policy passthrough; mirrors dsh-mcp-client's schema. */
const Reconnect = z.object({
    enabled: z.boolean().default(true),
    initialDelayMs: z.number().min(1).max(600000).default(500),
    maxDelayMs: z.number().min(1).max(600000).default(30000),
    maxAttempts: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(10)
});

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
 * User-settings section served to the Web GUI pickers.
 *
 * Persisted (user layer in `$DSH_HOME/settings.yaml`): `profile` (the last UI
 * selection), `command` (the last UI executable id), `stderrMode`, the two
 * catalog lists (`profileEntries` / `executables` — the named rows the two
 * dropdowns list and the card edits) and the two refresh triggers
 * (`refreshNonce`, `refreshExecutablesNonce`). Never persisted (composition
 * base layer held in memory by the host): `lastRefreshError` and
 * `discoveryRevision` — re-served to clients only through a write, so every
 * discovery run ends with the host bumping its own refresh nonce (guarded
 * against re-discovery); the client's refresh poll treats the served
 * `discoveryRevision` advancing past its click-time value as the completion
 * signal.
 */
export const SettingsSchema = z.object({
    /** Active gateway --profile value; persisted last UI selection. */
    profile: z.string().min(1).pattern(PROFILE_PATTERN).default("default"),
    /** Persisted UI executable id; empty means "auto-resolve". */
    command: z.string().default(""),
    /** Written by the profile-list refresh button; the host reacts to its change. */
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
    /** Named profile rows: manual ids and names given to recovered ids. */
    profileEntries: z.array(CatalogEntry).default([]),
    /** Named docker-executable rows (the executable dropdown's catalog). */
    executables: z.array(CatalogEntry).default([]),
    /** Profile ids the last profile discovery reported (in-memory base layer;
     * never persisted). The fetch dialog's candidate list — the ids reach the
     * saved rows only through an explicit selection. */
    profiles: z.array(z.string()).default([]),
    /** Executable paths the last executable scan found (in-memory base layer;
     * never persisted). The executable fetch dialog's candidate list. */
    executableCandidates: z.array(z.string()).default([]),
    /** Written by the executable-catalog refresh button; the host reacts. */
    refreshExecutablesNonce: z.number().default(0),
    /** Last profile discovery failure, human-readable; empty when healthy. */
    lastRefreshError: z.string().default(""),
    /** Profile discovery run counter (success or failure); completion signal. */
    discoveryRevision: z.number().default(0),
    /** Executable-discovery run counter (in-memory base layer). The client
     * poll uses it to tell an executable fetch apart from a profile one. */
    executableDiscoveryRevision: z.number().default(0)
});
