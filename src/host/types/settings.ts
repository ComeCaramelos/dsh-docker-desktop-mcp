/**
 * Settings shapes — the two layers `dsh-settings` composes into the value the
 * Web card renders.
 *
 * The persistence boundary is stated here: only `SettingsUserFields` may reach
 * `$DSH_HOME/settings.yaml`; the base layer is in-memory composition, never
 * persisted. `SettingsService` is the structural view of the service the host
 * half consumes without depending on it.
 */
import type { GatewayStderrMode } from "./config.js";

/** One catalog row: an id plus the custom label the user gave it for the UI. */
export type CatalogEntry = {
    id: string;
    name: string;
};

/** User-authored settings fields — the only keys that persist. */
export type SettingsUserFields = {
    profile: string;
    command: string;
    refreshNonce: number;
    stderrMode: "" | GatewayStderrMode;
    /** Custom-named profile rows (manual ids + names for the discovered ids). */
    profileEntries: CatalogEntry[];
    /** Custom-named docker executables (manual paths + names). */
    executables: CatalogEntry[];
    /** Written by the executable-catalog refresh; the host reacts to its change. */
    refreshExecutablesNonce: number;
};

/** In-memory composition base layer served alongside the user layer. */
export type SettingsBaseLayer = {
    profile: string;
    effectiveCommand: string;
    /** Static mirror of the row-config `gatewayStderr` (never persisted). */
    rowStderr: GatewayStderrMode;
    /** Profile ids the last discovery run reported (memory only). The fetch
     * dialog's candidate list — the ids land in the saved catalog only through
     * an explicit user action (the dialog's "Add selected", or a merge by
     * /docker-refresh), never by the discovery run itself. */
    profiles: string[];
    /** Executable paths the last executable scan found (memory only). The
     * executable dialog's candidate list — same add-only-on-selection rule. */
    executableCandidates: string[];
    lastRefreshError: string;
    /** Counter of profile-list discovery runs; the profile-refresh signal. */
    discoveryRevision: number;
    /** Counter of executable-catalog runs; the executable-refresh signal. */
    executableDiscoveryRevision: number;
};

/** Resolved value served to the client card. */
export type SettingsResolved = SettingsBaseLayer & SettingsUserFields;

/** One `settings.mutate` operation: `set` a path, or `unset` it. */
export type SettingsOp = { op: "set"; path: string[]; value?: unknown } | { op: "unset"; path: string[] };

/** Surface of the `settings` service as consumed here. */
export interface SettingsService {
    document?: Record<string, Record<string, any> | undefined> | undefined;
    mutate(ns: string, ops: SettingsOp[]): Promise<unknown> | unknown;
    installSection(
        ctx: unknown,
        ns: string,
        schema: unknown,
        base: Partial<SettingsResolved>,
        hooks: {
            setSource?: (source: () => SettingsResolved) => void;
            validate?: (value: SettingsResolved) => void;
            onChange?: () => void;
        }
    ): void;
}
