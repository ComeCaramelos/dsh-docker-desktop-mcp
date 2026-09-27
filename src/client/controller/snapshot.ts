/**
 * Browser half — the card snapshot the widget renders.
 *
 * The snapshot is the card's whole view: it is derived from the served settings
 * scope (the `dsh-settings` resolved value), and every write action stages its
 * state here so the card stays consistent while a write is in flight.
 */
import { normalizeEntries, type CatalogEntry } from "../catalog.js";

/** One catalog row: re-exported so the card's props type stays next to the
 * snapshot it belongs to. The rules over the rows live in ./catalog.ts. */
export type { CatalogEntry };

/** The card's snapshot: the fields the widget renders, plus action state. */
export type CardSnapshot = {
    available: boolean;
    writable: boolean;
    profile: string;
    command: string;
    effectiveCommand: string;
    stderrMode: "" | "log" | "console";
    rowStderr: "log" | "console";
    /** Saved profile rows (ids + custom names). */
    profileEntries: CatalogEntry[];
    /** Saved docker-executable rows. */
    executables: CatalogEntry[];
    /** Profile ids the last profile-discovery run reported. The profile fetch
     * dialog's candidate list — ids land in `profileEntries` only through an
     * explicit "Add selected" (or the /docker-refresh merge). */
    profiles: string[];
    /** Executable paths the last executable scan found. The executable fetch
     * dialog's candidate list — same rule. */
    executableCandidates: string[];
    lastRefreshError: string;
    discoveryRevision: number;
    /** Counter of executable-catalog runs (the executable refresh signal). */
    executableDiscoveryRevision: number;
    actionError: string;
    notice: { seq: number; kind: "error" | "stall"; text: string } | null;
};

/** The store's initial state — everything an unbound controller shows. */
export function initialSnapshot(): CardSnapshot {
    return {
        available: false,
        writable: false,
        profile: "",
        command: "",
        effectiveCommand: "",
        stderrMode: "",
        rowStderr: "log",
        profileEntries: [],
        executables: [],
        profiles: [],
        executableCandidates: [],
        lastRefreshError: "",
        discoveryRevision: 0,
        executableDiscoveryRevision: 0,
        actionError: "",
        notice: null
    };
}

/**
 * A scope snapshot that is not ready (no namespace served, still resolving):
 * everything back to the blank view, keeping only what the user has been told
 * already (the action error and the pending failure notice), so a transient
 * re-describe never wipes what the card itself staged.
 */
export function unavailableSnapshot(previous: CardSnapshot): CardSnapshot {
    return {
        ...initialSnapshot(),
        actionError: previous.actionError,
        notice: previous.notice
    };
}

/**
 * Project one READY scope snapshot onto the card snapshot: coalesce every field
 * (a served value can carry anything the user typed), normalize both catalogs
 * through the same id rules the host's rows follow, and carry the staged notice
 * across untouched.
 */
export function servedSnapshot(scopeSnapshot: any, previous: CardSnapshot): CardSnapshot {
    var value = scopeSnapshot.value;
    return {
        available: true,
        writable: scopeSnapshot.writable === true,
        profile: typeof value.profile === "string" ? value.profile : "",
        command: typeof value.command === "string" ? value.command : "",
        effectiveCommand: typeof value.effectiveCommand === "string" ? value.effectiveCommand : "",
        stderrMode: typeof value.stderrMode === "string" ? value.stderrMode : "",
        rowStderr: value.rowStderr === "console" ? "console" : "log",
        profileEntries: normalizeEntries(value.profileEntries, "profiles"),
        executables: normalizeEntries(value.executables, "executables"),
        profiles: Array.isArray(value.profiles) ? value.profiles : [],
        executableCandidates: Array.isArray(value.executableCandidates) ? value.executableCandidates : [],
        lastRefreshError: value.lastRefreshError ?? "",
        discoveryRevision: typeof value.discoveryRevision === "number" ? value.discoveryRevision : 0,
        executableDiscoveryRevision:
            typeof value.executableDiscoveryRevision === "number" ? value.executableDiscoveryRevision : 0,
        actionError: "",
        notice: previous.notice
    };
}
