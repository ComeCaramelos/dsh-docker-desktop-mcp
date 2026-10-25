/**
 * Browser half — identity, and the services the shell must resolve.
 *
 * The identifiers are contracts with the host half: the profile entry id is the
 * key every read and write goes through, the bundle id is the package the row's
 * patch layer belongs to (the row's configuration page is answered under
 * `<bundle>#<row id>`, not `<this package>#<row id>`), and the locale namespace
 * is the lookup root for every string the card renders. This half is emitted on
 * its own and cannot import `./host/constants.js`, so the values are mirrored
 * here — `test/client.test.mjs` pins the mirror against the host half's exports
 * so a drift fails loudly.
 */

/** Profile entry id the host half serves; the configuration form's key. */
export const ENTRY_ID = "mcp-docker";

/** npm id of this package. */
export const PLUGIN_ID = "@comecaramelos/dsh-docker-desktop-mcp";

/**
 * npm id of the bundle the row's patch layer lives in. A component is not its
 * own bundle — the row arrives through the manager bundle's patch, so the page
 * this card registers into is keyed by that id, not by this package.
 */
export const BUNDLE_ID = "@comecaramelos/dsh-mcp-manager-bundle";

/** Locale dictionary namespace this half registers and renders from. */
export const LOCALE_NAMESPACE = "dockerDesktopMcp";

/** Services the shell must resolve before `apply` runs. */
export const inject = ["configForms", "slots", "locale"];
