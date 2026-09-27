/**
 * Write actions — every way the card can change the settings namespace.
 *
 * Each action writes one field of the user layer through the bound scope and
 * never re-runs discovery: rows are data, and the ids that actually drive the
 * gateway stay in `profile` / `command`. A failed write is surfaced as the
 * card's `actionError` (the card shows it; the poll never re-runs).
 */
import { isValidEntryId, mergeEntries, normalizeEntries, type CatalogEntry, type CatalogKind } from "../catalog.js";
import { DISCOVERY_POLL_TIMEOUT_MS, waitForRevision, type PollHost } from "./poll.js";

/** A write needs the bound scope on top of what the revision poll reads. */
export type ActionHost = PollHost & {
    /** The bound `docker-desktop-mcp` settings scope. */
    scope: any;
    /** Surface a failed settings write as the card's action error. */
    noteError(error: any): void;
};

/** Stage-less immediate write of the selected profile (persisted; the next connect starts with it). */
export function selectProfile(host: ActionHost, profile: string): Promise<unknown> {
    return host.scope.set("profile", profile).catch((error: any) => host.noteError(error));
}

/**
 * Write the selected executable (persisted as `command`). The value is the
 * chosen row's id; anything else falls back to the host's auto-resolution.
 * The host re-discovers on the new executable (a different binary reads a
 * different profile store) and pushes the refreshed state.
 */
export function selectExecutable(host: ActionHost, id: string): Promise<unknown> {
    if (host.disposed) return Promise.resolve();
    var value = typeof id === "string" ? id.trim() : "";
    var write = value === "" ? host.scope.unset("command") : host.scope.set("command", value);
    return Promise.resolve(write).catch((error: any) => host.noteError(error));
}

/**
 * Persist one catalog's rows wholesale (a row edit, an added row or a
 * deletion). Nothing here re-runs discovery: rows are data, and the ids
 * that actually drive the gateway stay in `profile` / `command`.
 */
export function saveEntries(host: ActionHost, kind: CatalogKind, entries: CatalogEntry[]): Promise<unknown> {
    if (host.disposed) return Promise.resolve();
    var field = kind === "profiles" ? "profileEntries" : "executables";
    return host.scope.set(field, normalizeEntries(entries, kind)).catch((error: any) => host.noteError(error));
}

/**
 * Flip the "Reduce log output" toggle (persisted `stderrMode`: "log" captures
 * the gateway's console noise into the host's log file, "console" echoes it for
 * debugging). The effective mode is read from the served snapshot: an explicit
 * override wins; an empty one (never toggled) falls back to the row-config
 * `rowStderr` the host serves — exactly what the host resolves, so the switch
 * never lies about the current state. The toggle always writes an explicit
 * value (the row config stops applying once the user has touched it).
 */
export function toggleStderr(host: ActionHost): Promise<unknown> {
    if (host.disposed) return Promise.resolve();
    var snapshot = host.store.getSnapshot();
    var current =
        typeof snapshot.stderrMode === "string" && snapshot.stderrMode !== ""
            ? snapshot.stderrMode
            : snapshot.rowStderr === "console"
              ? "console"
              : "log";
    var next = current === "log" ? "console" : "log";
    return host.scope.set("stderrMode", next).catch((error: any) => host.noteError(error));
}

/**
 * Ask the host to re-run `docker mcp profile list`, wait for the result, and
 * resolve with the profiles it reported — the fetch dialog's candidate ids. The
 * host pushes fresh discovery state by bumping its own `refreshNonce` after the
 * run (recomputed served value + `settings/document-updated`), which already
 * re-describes this scope — the mirror re-read is the backstop for a missed
 * push, settling when the served `discoveryRevision` advances past the
 * click-time value or the discovery timeout budget elapses. The run itself
 * merges NOTHING into the saved rows — a run only updates the candidate list;
 * the card opens its "Choose profiles to add" dialog over the ids it resolves,
 * and nothing lands until the user picks (see {@link addDetected}). A failed or
 * stalled wait resolves empty, so the card skips the dialog (the failure is
 * announced through the toast host instead).
 */
export function refreshProfiles(host: ActionHost): Promise<string[]> {
    if (host.disposed) return Promise.resolve([]);
    var wait = waitForRevision(host, "discoveryRevision", Date.now() + DISCOVERY_POLL_TIMEOUT_MS);
    return host.scope
        .set("refreshNonce", Date.now())
        .catch((error: any) => host.noteError(error))
        .then(() => wait)
        .then(() => detectedIds(host, "profiles"));
}

/**
 * Ask the host to re-scan the docker executables present on the machine and
 * resolve with the paths it found — the executable fetch dialog's candidate
 * ids. The same push channel and the same budgets apply — the host bumps its
 * own `refreshExecutablesNonce` and the served `executableDiscoveryRevision` is
 * the completion signal.
 */
export function refreshExecutables(host: ActionHost): Promise<string[]> {
    if (host.disposed) return Promise.resolve([]);
    var wait = waitForRevision(host, "executableDiscoveryRevision", Date.now() + DISCOVERY_POLL_TIMEOUT_MS);
    return host.scope
        .set("refreshExecutablesNonce", Date.now())
        .catch((error: any) => host.noteError(error))
        .then(() => wait)
        .then(() => detectedIds(host, "executables"));
}

/**
 * The candidate ids one catalog's last discovery run reported, id-rule filtered
 * (a candidate the catalog could never carry is never offered). Read at
 * resolution time, so a refresh that found nothing resolves to an empty list
 * and the dialog stays closed.
 */
export function detectedIds(host: ActionHost, kind: CatalogKind): string[] {
    if (host.disposed) return [];
    var snapshot = host.store.getSnapshot();
    var ids = kind === "profiles" ? snapshot.profiles : snapshot.executableCandidates;
    var seen = new Set<string>();
    var out: string[] = [];
    for (var index = 0; index < (Array.isArray(ids) ? ids.length : 0); index++) {
        var id = typeof ids[index] === "string" ? ids[index].trim() : "";
        if (id === "" || seen.has(id) || !isValidEntryId(kind, id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

/**
 * "Add selected" of a fetch dialog: merge the checked candidate ids into the
 * catalog's saved rows (rows keep their order and names, additions land last,
 * nameless) and persist. A same-set selection never writes.
 */
export function addDetected(
    host: ActionHost,
    kind: CatalogKind,
    selectedIds: readonly string[]
): Promise<unknown> {
    if (host.disposed) return Promise.resolve();
    var field = kind === "profiles" ? "profileEntries" : "executables";
    var saved = normalizeEntries(host.store.getSnapshot()[field], kind);
    var merged = mergeEntries(saved, selectedIds, kind);
    if (!merged.changed) return Promise.resolve();
    return host.scope.set(field, merged.entries).catch((error: any) => host.noteError(error));
}
