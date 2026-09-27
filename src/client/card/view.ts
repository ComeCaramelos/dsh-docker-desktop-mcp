/**
 * The card's derived view — what one served snapshot actually means.
 *
 * Everything the widget renders but does not own: the two saved catalogs (run
 * through the same id rules the rows follow), the dropdown options each pill
 * lists, the effective stderr mode behind the toggle, and the header status dot.
 * Pure derivation, no hooks — the widget owns its state, this section reads it.
 */
import { isSmokeFixturePath, normalizeEntries, type CatalogEntry } from "../catalog.js";

/** What the card renders, derived from the served snapshot. */
export type CardView = {
    /** The error line the header dot and the body paragraphs report. */
    error: string;
    /** Whether the "Reduce log output" switch reads as on. */
    reduceChecked: boolean;
    /** Saved profile rows, normalized. */
    profileEntries: CatalogEntry[];
    /** Saved executable rows, normalized. */
    executableEntries: CatalogEntry[];
    /** The profile dropdown's ids: the saved rows, plus the active profile. */
    profileOptionIds: string[];
    /** The executable dropdown's ids: the saved rows, plus the executable in use. */
    executableOptionIds: string[];
    /** Whether the active profile is absent from the store's report. */
    missing: boolean;
    /** Whether the status dot reports an error (true) or a missing profile. */
    dotIsError: boolean;
};

/** One row's UI label: its custom name when it has one, else the id. */
function labelOf(entries: readonly CatalogEntry[], id: string): string {
    var row = entries.find((entry: CatalogEntry) => entry.id === id);
    return row === void 0 ? id : row.name.trim() === "" ? id : row.name.trim();
}

/** Project one served snapshot onto everything the widget renders. */
export function describeCard(state: any): CardView {
    var error = state.lastRefreshError || state.actionError || "";
    // The "Reduce log output" switch mirrors what the host actually resolves:
    // the explicit `stderrMode` when set, else the row-config fallback
    // (`rowStderr`). Never a phantom state.
    var stderrServed = typeof state.stderrMode === "string" ? state.stderrMode : "";
    var stderrEffective = stderrServed !== "" ? stderrServed : state.rowStderr === "console" ? "console" : "log";
    var profileEntries = normalizeEntries(state.profileEntries, "profiles");
    var executableEntries = normalizeEntries(state.executables, "executables");
    // Selector options: a healthy, non-empty discovery list is authoritative, so
    // `default` only appears when the store reported it; the current value is
    // always appended so a picked id never disappears from the list.
    var savedProfileIds = profileEntries.map((entry: CatalogEntry) => entry.id);
    var profileOptionIds = savedProfileIds.length === 0 && error !== "" ? ["default", state.profile] : savedProfileIds;
    if (profileOptionIds.indexOf(state.profile) === -1) profileOptionIds = profileOptionIds.concat([state.profile]);
    var executableOptionIds = executableEntries.map((entry: CatalogEntry) => entry.id);
    // The executable in use is appended so a picked value never disappears
    // from the list — EXCEPT a `.smoke/` fixture path: a smoke run's
    // configured shim command is a harness detail, never a user-selectable
    // option (the running value still shows as the pill's current label).
    if (executableOptionIds.indexOf(state.effectiveCommand) === -1 && !isSmokeFixturePath(state.effectiveCommand)) {
        executableOptionIds = executableOptionIds.concat([state.effectiveCommand]);
    }
    // Header status dot (credentialDot pattern): red while a discovery/action
    // error is present, or the active profile is absent from the ids the store
    // reported (gateway runs with an empty configuration); hidden while healthy.
    var missing = error === "" && state.profiles.length > 0 && state.profiles.indexOf(state.profile) === -1;
    return {
        error: error,
        reduceChecked: stderrEffective === "log",
        profileEntries: profileEntries,
        executableEntries: executableEntries,
        profileOptionIds: profileOptionIds,
        executableOptionIds: executableOptionIds,
        missing: missing,
        dotIsError: error !== ""
    };
}

/** A profile row's UI label. */
export function profileLabel(view: CardView, id: string): string {
    return labelOf(view.profileEntries, id);
}

/** An executable row's UI label. */
export function executableLabel(view: CardView, id: string): string {
    return labelOf(view.executableEntries, id);
}
