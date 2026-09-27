/**
 * Browser half — identity and the services the shell must resolve.
 *
 * The identifiers are contracts with the host half: the settings namespace key
 * is also the card's slot key, the locale namespace is the lookup root for every
 * string the card renders, and the plugin id tags every DOM node this half owns.
 * The browser half is emitted on its own, so it cannot import ./host/constants.ts
 * and they are mirrored here — `test/client.test.mjs` pins the mirror against the
 * host half's export so a drift fails loudly.
 */

/** Fixed settings namespace served by the host half; also the slot key. */
export const SETTINGS_NAMESPACE = "docker-desktop-mcp";

/** Locale dictionary namespace this half registers and renders from. */
export const LOCALE_NAMESPACE = "dockerDesktopMcp";

/** npm id of this bundle; tags the injected `style` element and toast host. */
export const PLUGIN_ID = "@comecaramelos/dsh-docker-desktop-mcp";

/**
 * Services the shell must resolve before `apply` runs: the settings scope (the
 * card's whole data source), the locale service (copy), and the slot service
 * (where the card is registered).
 */
export const inject = ["slots", "locale", "settingsScope"];
