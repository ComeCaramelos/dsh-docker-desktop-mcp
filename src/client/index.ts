/**
 * Browser half — the body of the row's own card.
 *
 * The card is built from `@comecaramelos/dsh-ancesters`' `mountSettingsCard`: the
 * styles, the dictionaries, the controller over this row's configuration form and
 * the `plugins.row.config` registration keyed by `<bundle>#<row id>` all come from
 * the shared half, and what is declared here is the descriptor and the two blocks
 * this row actually owns.
 *
 * What the card edits is only the **machine half** — the two named catalogs and
 * the two fetch runs. The profile and the executable a live connection runs with
 * are the connection's own (`extra.profile`, `extra.dockerPath`), and the manager
 * renders those on the entry it owns, along with the composer pill. A selector
 * here would be a second control writing what is not this row's; the card shows
 * what this row remembers instead, which is what the manager's pickers read.
 */
import { mountSettingsCard } from "@comecaramelos/dsh-ancesters/client";
import { CatalogBlock } from "./blocks.js";
import { DICTIONARIES } from "./locales/index.js";
import { BUNDLE_ID, ENTRY_ID, LOCALE_NAMESPACE, PLUGIN_ID } from "./plugin-meta.js";
import { injectCardStyles } from "./styles/index.js";

/** The live-only fields the card reads (never edits). */
const LIVE_KEYS = [
    "effectiveCommand",
    "effectiveSource",
    "stderrEffective",
    "profiles",
    "executableCandidates",
    "lastRefreshError",
    "discoveryRevision",
    "executableDiscoveryRevision"
];

/** The descriptor that makes this component's card. */
export const card = mountSettingsCard({
    entryId: ENTRY_ID,
    pluginId: PLUGIN_ID,
    bundleId: BUNDLE_ID,
    localeNamespace: LOCALE_NAMESPACE,
    locale: DICTIONARIES,
    fields: {
        // A saved row is a write on the click that asked for it: the picker the
        // manager renders reads these rows, so staging would make a pick appear
        // later than the person clicked it.
        immediate: ["profileEntries", "executables"],
        // Fetch triggers: an immediate nonce whose value the Host diffs.
        triggers: ["refreshNonce", "refreshExecutablesNonce"],
        liveKeys: [...LIVE_KEYS]
    },
    blocks: [
        {
            block: CatalogBlock as never,
            bind: (snapshot: any, controller: any, t: (key: string) => string) => catalogProps(snapshot, controller, t, "executables")
        },
        {
            block: CatalogBlock as never,
            bind: (snapshot: any, controller: any, t: (key: string) => string) => catalogProps(snapshot, controller, t, "profiles")
        }
    ],
    /**
     * The collapsed line. What is worth answering there is whether anything the
     * connection could pick is known at all — two counts, because an empty
     * profile list is exactly the case a person opens the card for.
     */
    renderSummary: (snapshot: any, t: (key: string) => string) => {
        const profiles = Array.isArray(snapshot.values.profileEntries) ? (snapshot.values.profileEntries as unknown[]).length : 0;
        const executables = Array.isArray(snapshot.values.executables) ? (snapshot.values.executables as unknown[]).length : 0;
        return t("summaryProfiles") + ": " + String(profiles) + " · " + t("summaryExecutables") + ": " + String(executables);
    },
    /** The notices the controller stages (a stall, a refused write) ride the
     * page-wide toast root, not the card: the row's page is closed most of the
     * time a fetch is happening. */
    toasts: true,
    /** The profile fetch settles on the profile counter; the executable scan has
     * its own counter, so the two runs never settle on each other's answer. */
    settleField: "discoveryRevision"
});

/** Services the shell must resolve before `apply` runs. */
export const inject = card.inject;

/**
 * The loader entry: the card's own stylesheet first (the shared machinery injects
 * only its own sheet), then the mounted card.
 */
export function apply(ctx: Parameters<typeof card.apply>[0]): void {
    injectCardStyles();
    card.apply(ctx);
}

/** One catalog block's props — rows, the answer that fills its dialog, and the
 * two write doors. */
function catalogProps(
    snapshot: any,
    controller: any,
    t: (key: string) => string,
    kind: "profiles" | "executables"
): Record<string, unknown> {
    const profiles = kind === "profiles";
    return {
        kind,
        entries: snapshot.values[profiles ? "profileEntries" : "executables"] ?? [],
        candidates: snapshot.values[profiles ? "profiles" : "executableCandidates"] ?? [],
        lastRefreshError: snapshot.values.lastRefreshError ?? "",
        // A run is standing while its counter has not moved off what it stood on
        // when the wait was armed — the card cannot see that directly, so it
        // reads the counter it is waiting on instead.
        busy: snapshot.saving === true,
        writable: snapshot.writable === true,
        available: snapshot.available === true,
        copy: {
            idLabel: profiles ? t("profileIdLabel") : t("executableIdLabel"),
            nameLabel: profiles ? t("profileNameLabel") : t("executableNameLabel"),
            namePlaceholder: t("namePlaceholder"),
            addLabel: profiles ? t("addProfile") : t("addExecutable"),
            removeLabel: t("removeEntry"),
            rowsLabel: profiles ? t("profileRows") : t("executableRows"),
            emptyText: profiles ? t("profileEmpty") : t("executableEmpty"),
            fetchLabel: profiles ? t("fetchProfiles") : t("fetchExecutables"),
            dialogTitle: profiles ? t("dialogProfilesTitle") : t("dialogExecutablesTitle"),
            dialogDescription: profiles ? t("dialogProfilesDescription") : t("dialogExecutablesDescription"),
            searchLabel: profiles ? t("searchProfiles") : t("searchExecutables")
        },
        save: (rows: readonly { id: string; name: string }[]) => controller.writeField(profiles ? "profileEntries" : "executables", rows),
        run: () => controller.settleTrigger(profiles ? "refreshNonce" : "refreshExecutablesNonce", profiles ? "discoveryRevision" : "executableDiscoveryRevision"),
        // The dialog's own controls (`cancel`, `close`, `addSelected`, …) are the
        // shared dictionary's copy, so the translator goes with the block — the
        // labels above are resolved here, these keys resolve inside the block.
        t
    };
}
