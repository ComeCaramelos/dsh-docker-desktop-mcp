/**
 * Browser half — the catalog rows both pickers list.
 *
 * This is the client-side mirror of `src/host/catalog.ts` (the two halves
 * compile into separate bundles and cannot share a module). Both halves follow
 * the same rules — trim the id, ignore ids that cannot go on the wire, keep the
 * first row per id, label a row by its custom name when it has one — and
 * `test/client.test.mjs` pins the mirror against the same fixtures the host
 * tests use, so a drift between the halves fails loudly.
 */
/** One catalog row: the id on the wire + the custom UI label. */
export type CatalogEntry = { id: string; name: string };

/** Which id rule a catalog's rows follow. */
export type CatalogKind = "profiles" | "executables";

/** The same profile-id rule the host half validates against. */
const PROFILE_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** A docker executable is a trimmed path/command with no control characters. */
const COMMAND_PATTERN = /^[\t -~¡-￿]{1,1024}$/;

/**
 * Mirror of the host's `SMOKE_PATH_PATTERN`: paths under a `.smoke/`
 * directory are checkout-local smoke fixtures (the shims), test harness and
 * not docker installs, so they never belong in the executable catalog.
 */
const SMOKE_PATH_PATTERN = /(?:^|[\\/])\.smoke[\\/]/;

/** Whether one path is a checkout-local smoke fixture. */
export function isSmokeFixturePath(candidate: string): boolean {
    return SMOKE_PATH_PATTERN.test(candidate);
}

/** Whether one id is usable as a row id for one catalog. */
export function isValidEntryId(kind: CatalogKind, id: string): boolean {
    if (id === "") return false;
    return kind === "profiles" ? PROFILE_PATTERN.test(id) : !SMOKE_PATH_PATTERN.test(id) && COMMAND_PATTERN.test(id);
}

/** One row label: the custom name when set, else the id. */
export function entryLabel(entry: CatalogEntry): string {
    const name = entry.name.trim();
    return name === "" ? entry.id : name;
}

/**
 * Coerce a served value into well-formed rows. Host-served arrays are already
 * normalized; a value read straight from the settings document may not be, so
 * the card can be handed anything.
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
        out.push({ id, name: typeof raw.name === "string" ? raw.name.trim() : "" });
    }
    return out;
}

/**
 * Merge the ids a fetch dialog confirmed into the stored rows: stored rows keep
 * their order and names; selected ids that are not represented land last with
 * no name. The browser-side mirror of `src/host/catalog.ts`'s same rule — the
 * dialog's "Add selected" is the only path that turns discovery candidates
 * into saved rows, so it must produce exactly what a host merge would have
 * produced (a client `saveEntries` write carries the result).
 * @returns the merged rows, plus `changed` so the caller can skip a no-op write.
 */
export function mergeEntries(
    stored: readonly CatalogEntry[],
    ids: readonly string[],
    kind: CatalogKind
): { entries: CatalogEntry[]; changed: boolean } {
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
