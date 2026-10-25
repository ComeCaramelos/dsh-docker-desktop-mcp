/**
 * Controller — persisting what the Host itself writes.
 *
 * Two writes land back in the profile patch: the saved profile rows a headless
 * merge produced, and the flag saying a standalone row config was turned down.
 * Since dsh 0.2 the store is the profile's **own patch layer** (no
 * `settings.yaml`), written through the `settings` service keyed by the row's
 * profile **entry id** — the same key the card addresses by.
 *
 * Both halves of the rule live in `@comecaramelos/dsh-ancesters`'
 * `createPersister`, which is why this file is short:
 *
 * - **one `unset` per live-mirror key rides every write.** A persisted write
 *   re-persists the volatile fields it answers, so without the clear every live
 *   answer would ride the write back into the patch file — where it would
 *   outlive the run that produced it. An `unset` returns a field to whatever the
 *   row config answers, so the live boundary holds from the write channel
 *   rather than from a check.
 * - **the mirror is re-asserted on both sides of the write** — landed or
 *   refused — so a run's answers never go quiet just because a save failed.
 *
 * A write issued from a form commit would also have to leave the commit's async
 * context, or the platform reads it as a nested write transaction and refuses
 * it; the two writes here come from a slash command and a dismissal, never from
 * a commit, so nothing has to hop.
 */
import { createPersister } from "@comecaramelos/dsh-ancesters/host";
import type { PersistUser } from "@comecaramelos/dsh-ancesters/host";
import { publishLive } from "./publish.js";
import type { Controller } from "./types.js";
import type { CatalogEntry } from "../types/settings.js";

/** The Host's own write channel for one instance, stood up on the first write. */
function persister(controller: Controller): PersistUser {
    if (controller.state.persister === void 0) {
        controller.state.persister = createPersister(controller.ctx as never, {
            // Read through the state every write: the form attaches *after* the
            // first publish, so a handle captured here would stand empty forever.
            form: { current: () => controller.state.form?.current() } as never,
            liveKeys: controller.state.liveKeys,
            publishLive: () => publishLive(controller.ctx, controller.state),
            name: `docker-desktop-mcp(${controller.config.serverName})`
        });
    }
    return controller.state.persister;
}

/** Write the saved profile rows a merge produced. */
export async function persistProfileEntries(controller: Controller, entries: readonly CatalogEntry[]): Promise<void> {
    await persister(controller)({ profileEntries: [...entries] }, "failed to persist the discovered profile rows");
}

/** Record that a standalone row config was turned down (D4). Nothing else in
 * the row changes; this only says "do not offer this again". */
export async function dismissMigration(controller: Controller): Promise<void> {
    await persister(controller)({ migrationDismissed: true }, "failed to record the dismissed migration");
}
