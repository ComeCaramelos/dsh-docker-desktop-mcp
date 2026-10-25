/**
 * Host-half zod schema — the ONE `Config` the row declares and the Web GUI card
 * edits.
 *
 * Since dsh 0.2.0 there is no separate settings namespace: the row's `Config`
 * is the configuration form, keyed by the profile entry id (`ENTRY_ID`, see
 * ./constants.ts). What the card edits and what the Host answers with are
 * therefore one schema, separated by what `.volatile()` marks:
 *
 * - **ordinary fields** (`serverName`, `command`, `extraArgs`, the stderr/log
 *   pair, `env`, `cwd`, …) are composition-only. A form write naming one is
 *   refused Host-side — they steer a spawn, they are not UI state. Among them
 *   sit the three keys a **standalone** install let the card edit
 *   (`profile`, `dockerPath`, `stderrMode`): they no longer drive this row's
 *   bridge — the connection's own `extra` does — but they keep meaning what the
 *   row config said, so an installed row keeps running what it ran, and what a
 *   pre-component config is translated from (./migration.ts).
 * - **`.volatile()` user fields** (the two catalogs, the two refresh triggers,
 *   and `migrationDismissed`) land in the profile's own patch layer and commit
 *   without remounting the fiber.
 * - **`.volatile()` live fields** (the executable and mode a live connection
 *   runs with, the discovery lists and counters, the last failure) are
 *   Host-published. They ride the same references the user fields edit and are
 *   cleared back to their row answers by every persisted write, so a live answer
 *   can never ride a save back into the patch file (see ./controller/persist.ts).
 *   They are also what the kind's `select` choices are read off (./kind.ts).
 *
 * Every field's own pattern is the refusal surface: a bad value never resolves,
 * so the write is refused Host-side rather than reaching argv or the spawn.
 * Validation is deliberately permissive on the two catalog lists — every reader
 * re-normalizes them (./catalog.ts), so a hand-written row must not be able to
 * throw its way into a commit.
 */
import z from "@deepseek-ai/schemastery";
import { OPTIONAL_PATH_PATTERN, PROFILE_PATTERN, STDERR_MODE_PATTERN } from "./constants.js";

/** One catalog row: the id on the wire plus the custom UI label. */
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

/**
 * The plugin row's configuration, and the configuration form the Web GUI card
 * edits.
 */
export const Config = z.object({
    serverName: z.string().pattern(/^[A-Za-z0-9_-]{1,32}$/).default("docker"),
    /**
     * Gateway executable in the ROW CONFIG — composition-only, and the fallback
     * every UI pick (`dockerPath`) stands over. On WSL the literal default is
     * auto-resolved to the Windows-side CLI (./docker.ts).
     */
    command: z.string().default("docker"),
    /**
     * The row's profile default. A `docker-profile` connection's own
     * `extra.profile` stands over it, and `DSH_DOCKER_MCP_PROFILE` stands over
     * that (see ./kind.ts). A row written before the component existed holds a
     * value the card wrote here — which is why it still resolves the same way.
     */
    profile: z.string().min(1).pattern(PROFILE_PATTERN).default("default"),
    extraArgs: z.array(String).default([]),
    /** Gateway console-output routing (row config): "log" (default) redirects
     * the gateway's inherited stderr into a log file; "console" inherits it.
     * The card's `stderrMode` toggle stands over this. See ./gateway.ts. */
    gatewayStderr: z.union([z.const("log"), z.const("console")]).default("log"),
    /** Log path override for "log" mode; empty = auto (see
     * {@link gatewayStderrLogPath}). Absolute paths only. */
    gatewayStderrLog: z.string().default("").pattern(OPTIONAL_PATH_PATTERN),
    env: z.dict(String).default({}),
    cwd: z.string().default(""),
    toolCallTimeoutMs: z.number().default(60000),
    failOnStartupError: z.boolean().default(false),
    reconnect: Reconnect,

    // ---- user-authored, form-editable -------------------------------------

    /**
     * The executable the gateway spawns with, when a connection does not pick
     * one itself: the saved path, else "" to fall back to `command`
     * (auto-resolved). Composition-only — the pick lives on the connection.
     */
    dockerPath: z.string().default("").pattern(OPTIONAL_PATH_PATTERN),
    /** Named profile rows: manual ids + the names the user gave them. */
    profileEntries: z.array(CatalogEntry).default([]).volatile(),
    /** Named docker-executable rows (the executable dropdown's catalog). */
    executables: z.array(CatalogEntry).default([]).volatile(),
    /** Written by the profile-list refresh button; the Host reacts to its change. */
    refreshNonce: z.number().default(0).volatile(),
    /** Written by the executable-catalog refresh button; the Host reacts. */
    refreshExecutablesNonce: z.number().default(0).volatile(),
    /**
     * Where a gateway's stderr goes when a connection does not pick a mode
     * itself: `"log"` captures, `"console"` echoes, `""` follows
     * `gatewayStderr`. Composition-only for the same reason as the two above.
     */
    stderrMode: z.string().default("").pattern(STDERR_MODE_PATTERN),
    /**
     * What a translation of a **standalone** row config has been offered for and
     * the person turned down (`MIGRATION_DISMISSED_FIELD`). Nothing lands in
     * `servers` without a click, so a dismissal is the only state a proposal
     * needs — and it is this row's own, not a connection's.
     */
    migrationDismissed: z.boolean().default(false).volatile(),

    // ---- Host-published live answers ---------------------------------------

    /** The executable the gateway actually spawns with ("" = not answered). */
    effectiveCommand: z.string().default("").pattern(OPTIONAL_PATH_PATTERN).volatile(),
    /** The last source the effective executable came from. */
    effectiveSource: z.string().default("").pattern(OPTIONAL_PATH_PATTERN).volatile(),
    /** The stderr mode actually routing console output — what the card's
     * toggle reads itself against, mirrored by `resolveStderrMode` and never
     * a third state (see ./controller/publish.ts; the type of this field is
     * {@link DockerMcpConfig}'s live `stderrEffective`). */
    stderrEffective: z.union([z.const("log"), z.const("console")]).default("log").volatile(),
    /** Profile ids the last profile discovery reported. Candidate list only —
     * ids reach the saved rows only through an explicit selection. */
    profiles: z.array(z.string().pattern(PROFILE_PATTERN)).default([]).volatile(),
    /** Executable paths the last filesystem scan found (candidate list only). */
    executableCandidates: z.array(z.string().pattern(OPTIONAL_PATH_PATTERN)).default([]).volatile(),
    /** Last profile-discovery failure, human-readable; empty when healthy. */
    lastRefreshError: z.string().default("").volatile(),
    /** Profile-list discovery run counter; the fetch dialog's settle signal. */
    discoveryRevision: z.number().default(0).volatile(),
    /** Executable-catalog run counter; lets a card tell the two runs apart. */
    executableDiscoveryRevision: z.number().default(0).volatile()
});
