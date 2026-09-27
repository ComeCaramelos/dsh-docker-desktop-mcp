/**
 * Browser half — the plugin body.
 *
 * The entry the loader calls: inject the stylesheet, hand the shell the card's
 * locales, bind the namespace scope behind the controller, mount the card into
 * the Settings slot, and mount the body-level failure-toast host. Every other
 * module here is a dependency of this one, never the other way round.
 */
import * as react from "react";
import { createRoot } from "react-dom/client";
import { LOCALE_NAMESPACE, PLUGIN_ID, SETTINGS_NAMESPACE } from "./plugin-meta.js";
import { DICTIONARIES } from "./locales/index.js";
import { injectCardStyles } from "./styles/index.js";
import { DockerMcpCardController } from "./controller/index.js";
import { DockerMcpCard } from "./card/index.js";
import { DockerMcpProfilePill } from "./composer.js";
import { DockerMcpToastHost } from "./toast.js";

/**
 * Mount the profile card.
 * @param ctx - the browser plugin context (slots + locale + settingsScope).
 */
export function apply(ctx: any): void {
    // Styles first: the card slot may render on the same turn, and the
    // injection is guarded by the tag's data-plugin-css marker, so a hot
    // re-apply is a no-op.
    injectCardStyles();
    ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, DICTIONARIES), `${SETTINGS_NAMESPACE}: dictionaries`);
    var binder = ctx.settingsScope;
    var scope = binder.bind({ namespace: SETTINGS_NAMESPACE });
    // The shared describe mirror: the refresh action re-reads it while the
    // host's in-memory discovery state is en route.
    var controller = new DockerMcpCardController(scope, binder.describe());
    ctx.effect(
        () => () => controller.dispose(),
        `${SETTINGS_NAMESPACE}: card controller`
    );
    // Failure-toast host: an always-mounted body root, so a discovery failure
    // that lands while the user is anywhere else in the app is announced
    // immediately, not only after they open Settings.
    var translate = ctx.locale.bind(LOCALE_NAMESPACE);
    ctx.effect(() => {
        var toastHost = document.createElement("div");
        toastHost.dataset.plugin = PLUGIN_ID;
        toastHost.dataset.pluginToasts = "1";
        document.body.appendChild(toastHost);
        var toastRoot = createRoot(toastHost);
        toastRoot.render(
            react.createElement(DockerMcpToastHost, {
                store: controller.store,
                t: translate,
                clearNotice: (seq: number) => controller.clearNotice(seq)
            })
        );
        return () => {
            toastRoot.unmount();
            toastHost.remove();
        };
    }, `${SETTINGS_NAMESPACE}: failure-toast host`);
    ctx.slots.inject("settings.plugin.item", () =>
        ctx.slots.register(
            {
                name: "settings.plugin.item",
                key: SETTINGS_NAMESPACE,
                locale: LOCALE_NAMESPACE,
                inject: () => controller.inject()
            },
            DockerMcpCard
        )
    );
    // The composer pill: the same controller/store, mounted in the input
    // tool row (`conversation.input.left` — the shell's own mode/model pills
    // seat there, and the only one nobody else claims). Sharing the controller
    // is what keeps the two selectors honest: same snapshot, same writes,
    // same option rules — a Refresh anywhere shows up here without a second
    // subscription or a second poll.
    ctx.slots.inject("conversation.input.left", () =>
        ctx.slots.register(
            {
                name: "conversation.input.left",
                // The slot is kind `list`, so the renderer requires a stable
                // entry `id` (not a keyed `key`): it dedupes/positions entries
                // by id, exactly like the shell's own pills that seat here.
                id: SETTINGS_NAMESPACE + "-profile",
                locale: LOCALE_NAMESPACE,
                inject: () => ({
                    hooks: { dockerMcpCard: controller.store },
                    selectProfile: (profile: string) => controller.selectProfile(profile)
                })
            },
            DockerMcpProfilePill
        )
    );
}
