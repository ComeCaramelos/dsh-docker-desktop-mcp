/**
 * Catalog entries — the named rows behind the Web card's two pickers.
 *
 * A row is `{ id, name }`: the id drives the wire (`--profile <id>` for
 * profiles, the executable spawn target for executables) while `name` is purely
 * what the user wanted to see in the UI. Everything the catalog needs is pure
 * and total here: nothing throws on odd input, so a validation path can never
 * stall the settings gate (the failure that once left the plugin discovering
 * nothing).
 *
 * Merge rule (the reference card's "Fetch available" behaviour): keep every
 * stored row in its order and custom name, append the recovered ids not present
 * with an empty name. A row removed by the user comes back only if the source
 * still reports its id — exactly the model-catalog semantics this UI copies.
 */
import { CATALOG_NAME_MAX_LENGTH, COMMAND_PATTERN, COMMAND_MAX_LENGTH, PROFILE_PATTERN, SMOKE_PATH_PATTERN } from "./constants.js";
import type { CatalogEntry } from "./types/index.js";

/** Which id rule a catalog's rows follow. */
export type CatalogKind = "profiles" | "executables";

/**
 * Whether one path is a checkout-local smoke fixture (the `.smoke/` shims).
 * They are test harness, not docker installs, so they never belong in the
 * executable catalog — not as a saved row, not as a discovery candidate, and
 * never offered as a picker option. The row-config `command` is not validated
 * this way, so the smoke overlays keep spawning.
 */
export function isSmokeFixturePath(candidate: string): boolean {
    return SMOKE_PATH_PATTERN.test(candidate);
}

/** Whether one id is usable as a row id for one catalog. */
export function isValidEntryId(kind: CatalogKind, id: unknown): boolean {
    if (typeof id !== "string" || id === "") return false;
    if (kind === "profiles") return PROFILE_PATTERN.test(id);
    return id.length <= COMMAND_MAX_LENGTH && COMMAND_PATTERN.test(id) && !isSmokeFixturePath(id);
}

/** One row label: the custom name when set, else the id. */
export function entryLabel(entry: CatalogEntry): string {
    const name = entry.name.trim();
    return name === "" ? entry.id : name;
}

/**
 * Coerce anything into well-formed rows: trim both fields, drop ids the kind
 * cannot use, keep the first row per id, and cap the name.
 */
export function normalizeEntries(value: unknown, kind: CatalogKind): CatalogEntry[] {
    if (!Array.isArray(value)) return [];
    const out: CatalogEntry[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
        const raw = item as { id?: unknown; name?: unknown };
        const id = typeof raw.id === "string" ? raw.id.trim() : "";
        if (!isValidEntryId(kind, id) || seen.has(id)) continue;
        seen.add(id);
        const rawName = typeof raw.name === "string" ? raw.name.trim() : "";
        out.push({ id, name: rawName.slice(0, CATALOG_NAME_MAX_LENGTH) });
    }
    return out;
}

/**
 * Merge recovered ids into the stored rows. Rows keep their order and names;
 * ids that are not represented come last, with no name.
 * @returns the merged rows, plus `changed` so a caller can skip a no-op write.
 */
export function mergeEntries(stored: unknown, ids: readonly string[], kind: CatalogKind): { entries: CatalogEntry[]; changed: boolean } {
    const entries = normalizeEntries(stored, kind);
    const present = new Set(entries.map((entry) => entry.id));
    const merged = entries.slice();
    for (const id of ids) {
        const trimmed = typeof id === "string" ? id.trim() : "";
        if (!isValidEntryId(kind, trimmed) || present.has(trimmed)) continue;
        present.add(trimmed);
        merged.push({ id: trimmed, name: "" });
    }
    return { entries: merged, changed: JSON.stringify(merged) !== JSON.stringify(entries) };
}

/** The ids a catalog currently carries, in order. */
export function entryIds(entries: readonly CatalogEntry[] | undefined): string[] {
    return (entries === void 0 ? [] : entries).map((entry) => entry.id);
}

/** One row lookup by id (undefined when absent). */
export function findEntry(entries: readonly CatalogEntry[], id: string): CatalogEntry | undefined {
    return entries.find((entry) => entry.id === id);
}
