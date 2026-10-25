/**
 * Controller — commits the configuration form routed here.
 *
 * Since the live connection belongs to the manager, a commit has nothing to
 * switch: the profile, the executable and the console-output mode are the
 * entry's own `extra` values, and the pool already hot-switches when one of them
 * moves. What is left for this component is what a commit does to what the
 * machine answers:
 *
 * - the two fetch triggers fire through `attachSettingsForm`'s `actions` (the
 *   scalar-nonce idiom, diffed once — a stored nonce read back at boot fires
 *   nothing);
 * - every other user-authored write re-publishes the mirror. The two catalogs
 *   are what the kind's `select` choices are read off, so a saved row is a
 *   choice moved — and the write's own document re-answers the live-only fields
 *   it clears, which is why the mirror goes straight back out with it.
 *
 * A commit naming nothing user-authored never gets here: the live publish
 * commits live fields only, and `attachSettingsForm` filters by field.
 */
import { normalizeEntries } from "../catalog.js";
import { readConfigField } from "../values.js";
import { runProfileDiscovery } from "./discovery.js";
import type { Controller } from "./types.js";

/** Route one configuration-form commit. Never throws out of a commit. */
export function onFormCommit(controller: Controller): void {
    const { ctx, state } = controller;
    // Saved rows moved, so what the choices answer moved.
    void ctx;
    if (state.disposed) return;
    controller.publish();
}

/** The saved profile rows, read through the references and re-normalized (a
 * hand-written row must not be able to reach a picker's choices unvalidated). */
export function savedProfileEntries(controller: Controller) {
    return normalizeEntries(readConfigField(controller.config.profileEntries, []), "profiles");
}

/** The saved executable rows, same rule. */
export function savedExecutableEntries(controller: Controller) {
    return normalizeEntries(readConfigField(controller.config.executables, []), "executables");
}

/** One discovery run armed against whatever trigger moved. */
export function runRefresh(controller: Controller): Promise<void> {
    return runProfileDiscovery(controller.ctx, controller.state);
}
