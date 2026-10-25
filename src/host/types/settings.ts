/**
 * Types — the configuration form's layers, the live mirror, and the settings
 * service surface the Host reads and writes through.
 *
 * Since dsh 0.2.0 there is one `Config` (./../schema.ts) and one form per profile
 * row: the card edits the row's volatile fields, and every live answer the Host
 * has to serve rides the very same references. There is no separate persisted
 * section and no base layer to publish over — what the Host reads for the fields
 * it edits is one read of the row's two layers, and what it serves is one
 * volatile commit of the mirror.
 */
import type { GatewayStderrMode } from "./config.js";

/** One catalog row: an id plus the custom label the user gave it for the UI. */
export type CatalogEntry = {
    id: string;
    name: string;
};

/**
 * The fields the card edits — the fields the Host persists, and the only ones
 * whose commits the Host routes. A commit that touches nothing here changes
 * nothing the running gateway does, which is what keeps a live publish from
 * re-entering the router.
 */
/**
 * The fields this component's own card edits — the fields the Host persists, and
 * the only ones whose commits route anywhere. Note what is NOT here: the profile,
 * the executable and the console-output mode. Those belong to the
 * `docker-profile` **connection** (the manager owns that entry), not to this row.
 * What the row keeps is the machine half — what runs, where, and when to look
 * again.
 */
export type ConfigUserFields = {
    /** The saved profile rows: `{ id, name }`, the picker's catalog. A discovery
     * run only offers ids; nothing reaches these rows without an explicit
     * selection (the fetch dialog, or `/docker-refresh`). */
    profileEntries: CatalogEntry[];
    /** The saved executable rows: `{ id, name }`, the executable picker's
     * catalog. Same add-only-on-selection rule. */
    executables: CatalogEntry[];
    /** Written by the card's **Fetch profiles** trigger. */
    refreshNonce: number;
    /** Written by the card's **Fetch executables** trigger. */
    refreshExecutablesNonce: number;
    /** Whether the translation of a standalone row config has been turned down.
     * Host-written (the proposal's dismissal), not card-written. */
    migrationDismissed: boolean;
};

/**
 * The live mirror: what the Host answers through the same volatile references
 * the card edits, and never persists. Every field here is a volatile field of
 * the single `Config`, published by one coalesced commit per change batch.
 */
export type ConfigLiveFields = {
    /** Executable the live connection spawns with ("" = nothing answered yet). */
    effectiveCommand: string;
    /** Where `effectiveCommand` came from — "connection" | "row-config" | "". */
    effectiveSource: string;
    /** The stderr mode actually routing console output — what the toggle reads
     * itself against, so it never shows a phantom state. */
    stderrEffective: GatewayStderrMode;
    /** Profile ids the last discovery run reported. Candidate list only — ids
     * reach the saved rows only through an explicit selection. */
    profiles: string[];
    /** Executable paths the last filesystem scan found (candidates only). */
    executableCandidates: string[];
    /** Last profile-discovery failure, human-readable; "" when healthy. */
    lastRefreshError: string;
    /** Profile-list discovery run counter — the profile fetch's settle signal. */
    discoveryRevision: number;
    /** Executable-scan run counter — lets a card tell the two runs apart. */
    executableDiscoveryRevision: number;
};

/** One layer's answers: a field is absent when that layer said nothing. */
export type ConfigLayerFields = { [K in keyof ConfigUserFields]?: ConfigUserFields[K] };

/**
 * One read of the form: what runs now (the references resolve the user layer
 * over the row config, which is exactly what the gateway launches with) plus the
 * two layers the distinction "did the user edit this, or does the row config say
 * it?" reads. Before the form is attached the references answer for both layers,
 * so the first commit settles the distinction.
 */
export type ConfigLayers = {
    value: ConfigUserFields;
    user: ConfigLayerFields;
    base: ConfigLayerFields;
};

/**
 * One ordered edit a write carries through `mutate`: a `set` names a field with
 * a value; an `unset` returns the field to whatever the row config answers (an
 * unset of a path no layer answers drops out of the stored row entirely — this
 * is exactly how the Host clears its live-only fields back to their row answers;
 * see ./values.ts `liveMirrorKeys`).
 */
export type SettingsPathOp = { op: "set"; path: readonly string[]; value?: unknown } | { op: "unset"; path: readonly string[] };

/**
 * Surface of the `settings` service (`SettingsForms`) as consumed here. Typed
 * structurally the way `commands` is consumed: the service lives in the loader's
 * module table, and the Host only reads a described row, writes a patch and turns
 * the generated page off. The patch row is keyed by the **profile entry id**,
 * never by a namespace of the Host's own.
 */
export interface SettingsForms {
    describe(options?: unknown): SettingsFormRow[];
    /** Write fields into the row's own patch layer (the store dsh 0.2.0 uses
     * instead of `settings.yaml`). Never called with a live field. */
    update(entryId: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<unknown> | unknown;
    /** One ordered field edit; every edit addresses a volatile field, and an
     * `unset` falls back to the row-config answer. The Host's write-backs go
     * through this channel, carrying the live-only fields' clear alongside the
     * one user field they write, so a live answer can never ride a write back
     * into the stored layer (see ./values.ts `liveMirrorKeys`). */
    mutate(entryId: string, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<unknown> | unknown;
    /** `auto: false` keeps the generated page off while this card owns the
     * row's page. Disposable, and calling it twice for one fiber throws. Owned
     * by `attachSettingsForm` (see @comecaramelos/dsh-ancesters/host) — this
     * component never calls it directly. */
    configure(presentation: { auto?: boolean }, owner?: unknown): () => void;
}

/** One `settings.describe()` row, narrowed to what the Host consults. */
export interface SettingsFormRow {
    /** The profile entry id this row is keyed by. */
    ns: string;
    /** Live effective value, Host live commits included. */
    value?: unknown;
    /** Composition base — what the row config carries under the user layer. */
    base?: unknown;
    /** What the profile patch carries (`{}` when it carries nothing). */
    user?: unknown;
    /** Revision fencing the next write. */
    revision?: number;
}
