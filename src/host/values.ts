/**
 * Reading the row — references, layers, precedence, and the mirror's shape.
 *
 * Since dsh 0.2 there is one `Config` per profile row: what `apply` receives is
 * a **reference** for every `.volatile()` field and a plain value for every
 * ordinary one. Reading therefore has one rule and one exception: read the
 * references with `readConfigField` (never a captured value, which a running
 * fiber would have moved), and read the *described* row through `settings` only
 * when the distinction between the two layers actually matters — which is the
 * case for the fields a card writes, never for the row-config composition.
 *
 * What a row can still author is the machine half — the two named catalogs and
 * the two triggers, plus what a pre-component install left behind (`profile`,
 * `dockerPath`, `stderrMode`, which now feed a connection rather than a bridge).
 * Everything else the answers need is resolved here so no consumer re-derives it.
 */
import { PROFILE_PATTERN } from "./constants.js";
import { resolveDockerCommand } from "./docker.js";
import { normalizeEntries } from "./catalog.js";
import type { ConfigField, DockerMcpConfig, GatewayStderrMode } from "./types/config.js";
import type { CatalogEntry, ConfigLayerFields, ConfigLayers, ConfigLiveFields, ConfigUserFields, SettingsFormRow } from "./types/settings.js";

/**
 * Read one volatile field: a live reference in a running fiber, or the plain
 * value a hand-built config (or a test) carries. Never a mutation.
 * @param field - the field as `apply` handed it.
 * @param fallback - what to answer when the reference says nothing yet.
 */
export function readConfigField<T>(field: ConfigField<T> | undefined, fallback: T): T {
    const holder = field as unknown as { get?: () => T | undefined } | undefined;
    if (typeof holder?.get === "function") {
        const value = holder.get();
        if (value === void 0) return fallback;
        return Array.isArray(value) ? (value as unknown[]).slice() as T : value;
    }
    if (field === void 0 || field === null) return fallback;
    return Array.isArray(field) ? (field as unknown[]).slice() as T : (field as T);
}

/**
 * Read the row's two layers through the settings service — undefined when the
 * service (or this entry) is not described yet, i.e. the cold path where only
 * the references answer.
 * @param settings - the `settings` service (`SettingsForms`), when resolved.
 * @param entryId - the profile entry id this row is keyed by.
 */
export function readConfigForm(settings: unknown, entryId: string): SettingsFormRow | undefined {
    // Read structurally, not by interface: what the `settings` service answers
    // with is described by whoever owns it (dsh-settings today, `ancesters`'
    // adapter view tomorrow), and only `describe()` is promised.
    const service = settings as { describe?: unknown } | undefined;
    if (service === void 0 || typeof service.describe !== "function") return void 0;
    try {
        return (service.describe as () => readonly SettingsFormRow[])().find((row) => row.ns === entryId);
    } catch {
        // A service that cannot answer is the same cold path as no service.
        return void 0;
    }
}

/** One layer's raw object narrowed to the fields the card edits. */
function describedLayer(layer: unknown): ConfigLayerFields {
    const source = layer === null || typeof layer !== "object" || Array.isArray(layer) ? {} : (layer as Record<string, unknown>);
    const entries = (key: string, kind: "profiles" | "executables"): CatalogEntry[] | undefined =>
        Array.isArray(source[key]) ? normalizeEntries(source[key] as readonly unknown[], kind) : void 0;
    const profileEntries = entries("profileEntries", "profiles");
    const executables = entries("executables", "executables");
    const refreshNonce = typeof source.refreshNonce === "number" ? source.refreshNonce : void 0;
    const refreshExecutablesNonce = typeof source.refreshExecutablesNonce === "number" ? source.refreshExecutablesNonce : void 0;
    const migrationDismissed = source.migrationDismissed === true ? true : void 0;
    return {
        ...(profileEntries === void 0 ? {} : { profileEntries }),
        ...(executables === void 0 ? {} : { executables }),
        ...(refreshNonce === void 0 ? {} : { refreshNonce }),
        ...(refreshExecutablesNonce === void 0 ? {} : { refreshExecutablesNonce }),
        ...(migrationDismissed === void 0 ? {} : { migrationDismissed })
    };
}

/**
 * One read of the row: what the references answer now, plus — when there is a
 * described row — what each of its two layers answers.
 * @param config - the config `apply` validated.
 * @param row - the described row, when the settings service answers for it.
 */
export function readConfigLayers(config: DockerMcpConfig, row?: SettingsFormRow): ConfigLayers {
    const described = row === undefined || row === null || typeof row !== "object" ? {} : (row as { user?: unknown; base?: unknown });
    const value: ConfigUserFields = {
        profileEntries: normalizeEntries(readConfigField(config.profileEntries, []), "profiles"),
        executables: normalizeEntries(readConfigField(config.executables, []), "executables"),
        refreshNonce: readConfigField(config.refreshNonce, 0),
        refreshExecutablesNonce: readConfigField(config.refreshExecutablesNonce, 0),
        migrationDismissed: readConfigField(config.migrationDismissed, false)
    };
    const base = describedLayer(described.base);
    const hasLayers = described.user !== void 0 || described.base !== void 0;
    return {
        value,
        // Before the form attaches nothing distinguishes the layers, so the
        // references answer for both; the first read of a described row settles
        // the distinction.
        user: hasLayers ? describedLayer(described.user) : {},
        base: hasLayers ? base : { ...value }
    };
}

/**
 * The profile a connection runs with when the entry itself names none —
 * `DSH_DOCKER_MCP_PROFILE`, then the row config, then the schema default. An env
 * value the profile pattern refuses is ignored, never thrown: it is a mis-set
 * environment, not a broken row.
 * @param config - the config `apply` validated (for the row-config profile).
 * @param envValue - the launch environment's profile value, when any.
 */
export function resolveProfileFromConfig(config: DockerMcpConfig, envValue?: unknown): string {
    if (typeof envValue === "string" && envValue !== "" && PROFILE_PATTERN.test(envValue)) return envValue;
    const row = typeof config.profile === "string" ? config.profile.trim() : "";
    if (row !== "" && PROFILE_PATTERN.test(row)) return row;
    return "default";
}

/** The source the effective executable came from. */
export type EffectiveCommandSource = "row-config" | "";

/**
 * The executable the runs probe when no connection names one: an explicit
 * row-config `dockerPath` (the pre-component key that still means "run this
 * one") wins over `command`, which answers with the WSL host-CLI rewrite applied
 * to the literal default. The second half of the answer is *where* it came from,
 * so nothing has to guess whether a path is the row's.
 * @param config - the config `apply` validated.
 */
export function resolveEffectiveCommand(config: DockerMcpConfig): { path: string; source: EffectiveCommandSource } {
    const configured = config.dockerPath.trim();
    if (configured !== "") return { path: configured, source: "row-config" };
    const resolved = resolveDockerCommand(config.command);
    return resolved === "" ? { path: "", source: "" } : { path: resolved, source: "row-config" };
}

/**
 * The gateway stderr mode a connection runs with when its own field says
 * nothing: the row-config `stderrMode` (the pre-component toggle key) wins, else
 * the row-config `gatewayStderr`. Never a third state.
 * @param config - the config `apply` validated.
 */
export function resolveStderrMode(config: DockerMcpConfig): GatewayStderrMode {
    if (config.stderrMode === "log" || config.stderrMode === "console") return config.stderrMode;
    return config.gatewayStderr === "console" ? "console" : "log";
}

/** The mirror's opening answers — what a Host that has run nothing serves.
 * (`createLiveMirror` keeps the older name so a consumer written against the
 * first host surface keeps working; the two are the same function.) */
export function createLiveAnswers(): ConfigLiveFields {
    return {
        effectiveCommand: "",
        effectiveSource: "",
        stderrEffective: "log",
        profiles: [],
        executableCandidates: [],
        lastRefreshError: "",
        discoveryRevision: 0,
        executableDiscoveryRevision: 0
    };
}

/** Every live-only key, for the `unset` half of every persisted write. */
export function liveMirrorKeys(): readonly string[] {
    return Object.keys(createLiveAnswers());
}

/** Older name of {@link createLiveAnswers}, kept for its first consumers. */
export const createLiveMirror = createLiveAnswers;
