/**
 * Host half — the configuration form.
 *
 * Since dsh 0.2 the card edits the **row configuration** through the profile's
 * configuration form: one `Config` (./schema.ts), keyed by the row's profile
 * entry id. What used to be three hand-rolled jobs — the entry-id rule, keeping
 * the generated page off, and filtering which commit paths mean anything — now
 * belongs to `@comecaramelos/dsh-ancesters`' `attachSettingsForm`, which owns
 * all three invariants (identity, `auto: false` once per fiber, user-field
 * routing) so no consumer can repeat them wrong.
 *
 * What stays here is only what is specific to this row: **which** fields the
 * card edits, and what each commit means. The fields a card writes used to
 * include the profile, the executable and the stderr mode; those belong to the
 * `docker-profile` **connection** now (the manager's entry owns them), so this
 * row's form owns what the machine answers — the two named catalogs and the two
 * fetch triggers — plus one dismissal flag the proposal needs.
 */
import { attachSettingsForm } from "@comecaramelos/dsh-ancesters/host";
import type { SettingsFormHandle } from "@comecaramelos/dsh-ancesters/host";
import { liveMirrorKeys, readConfigField } from "./values.js";
import type { Controller } from "./controller/index.js";
import type { DockerMcpConfig, PluginContext } from "./types/index.js";

/** The fields the card edits. A commit touching nothing here changes nothing
 * this component does, which is what keeps a live publish out of the router. */
export const USER_FIELDS = ["profileEntries", "executables", "refreshNonce", "refreshExecutablesNonce", "migrationDismissed"] as const;

/** Every live-only key the row must never persist (the unset half of every
 * persisted write). */
export const LIVE_MIRROR_KEYS = liveMirrorKeys();

/**
 * Attach the row's configuration form to one controller: the entry id, the auto
 * page, the routing and the two fetch triggers all arrive through the shared
 * adapter; what is left is what a commit *means* here.
 *
 * @param ctx - plugin context.
 * @param controller - the live state the form drives.
 */
export function installDockerMcpForm(ctx: PluginContext, controller: Controller): SettingsFormHandle {
    // The effect that keeps the attach disposed is `attachSettingsForm`'s own —
    // this half only states what the form means.
    const handle: SettingsFormHandle = attachSettingsForm(ctx as never, {
        name: `docker-desktop-mcp(${controller.config.serverName})`,
        userFields: [...USER_FIELDS],
        liveKeys: [...LIVE_MIRROR_KEYS],
        // A trigger fires only on a later diff of its own value, so reading a
        // stored nonce back at boot never launches a run.
        readValue: (field: string) => readConfigField(fieldValue(controller.config, field), defaultFor(field)),
        actions: {
            refreshNonce: () => controller.runDiscovery(),
            refreshExecutablesNonce: () => controller.runExecutablesDiscovery()
        },
        // A user-authored commit changes what the machine answers with (the saved
        // rows are what the kind's `select` choices read), so every routed commit
        // re-publishes the answers it moved.
        onCommit: () => controller.onFormCommit()
    });
    controller.attachForm(handle);
    return handle;
}

/** One field of the validated config, addressed by name (the volatile ones are
 * references; ordinary ones are plain values). */
function fieldValue(config: DockerMcpConfig, field: string): unknown {
    return (config as unknown as Record<string, unknown>)[field];
}

/** The fallback a field answers before anything is read — enough for a trigger
 * diff, nothing more. */
function defaultFor(field: string): unknown {
    switch (field) {
        case "refreshNonce":
        case "refreshExecutablesNonce":
            return 0;
        case "profileEntries":
        case "executables":
            return [];
        case "migrationDismissed":
            return false;
        default:
            return void 0;
    }
}
