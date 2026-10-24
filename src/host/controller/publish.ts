/**
 * Controller — publishing the live mirror.
 *
 * Every answer a card reads and every choice the manager's `select` fields offer
 * is a `.volatile()` field of the same `Config` the card edits, so publishing is
 * one volatile commit. The mechanics (the ACTIVE-state rule, the microtask
 * coalescing, the `describe()` that turns a revision into
 * `settings/document-updated`) belong to `@comecaramelos/dsh-ancesters`'
 * `createLiveMirror`, so this file owns nothing but the answers themselves.
 *
 * The one thing specific to this component is the follow-up: publishing is also
 * what moves what the kind's `select` choices answer, so every publish ends with
 * `notifyKindsChanged()` — that is how a discovery run shows up in the picker
 * without the browser half knowing a discovery ever ran.
 */
import { createLiveMirror } from "@comecaramelos/dsh-ancesters/host";
import type { PluginContext } from "../types/index.js";
import type { ControllerState } from "./state.js";

/** Queue one coalesced publish of whatever the mirror answers now. */
export function publishLive(ctx: PluginContext, state: ControllerState): void {
    if (state.mirror === void 0) {
        state.mirror = createLiveMirror(ctx as never, {
            name: `docker-desktop-mcp(${state.config.serverName})`,
            read: () => ({ ...state.live }),
            settings: () => state.form?.current()?.settings
        });
    }
    state.mirror.publish();
    state.notifyKindsChanged();
}
