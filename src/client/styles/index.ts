/**
 * Browser half — the card's stylesheet surface.
 *
 * The rules and the class names live in `DockerMcpCard.module.css`; the build's
 * CSS-modules step (scripts/build-client.mjs) compiles it — postcss-checked,
 * minified, class names scoped `hash_local` — and the components import that
 * map directly, the same way every shipped `dsh-client-ui-*` card consumes its
 * own stylesheet. This module keeps only the one-shot injection.
 *
 * The injection idiom is what every other plugin card uses: a `style` element
 * tagged with the plugin id, so a re-materialized bundle never stacks a second
 * copy. It is called from `apply`, never from a module body, so importing a
 * module for its class names cannot have DOM side effects.
 */
import { PLUGIN_ID } from "../plugin-meta.js";
import { cssText } from "./DockerMcpCard.module.css";

/** The one-shot `style` element's identity: `<plugin id>/<card>.module.css`. */
const CARD_CSS_ID = PLUGIN_ID + "/DockerMcpCard.module.css";

/**
 * Append the card's stylesheet once.
 *
 * Idempotent by construction: the element is tagged with the plugin id plus the
 * card's stylesheet id, so a re-materialized bundle never stacks a second copy.
 */
export function injectCardStyles(): void {
    if (typeof document === "undefined") return;
    if (document.querySelector('style[data-plugin-css="' + CARD_CSS_ID + '"]') !== null) return;
    const styleTag = document.createElement("style");
    styleTag.dataset.plugin = PLUGIN_ID;
    styleTag.dataset.pluginCss = CARD_CSS_ID;
    styleTag.textContent = cssText;
    document.head.appendChild(styleTag);
}
