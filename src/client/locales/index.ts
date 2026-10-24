/**
 * Locale dictionaries registered on the shell locale service.
 *
 * One dictionary per tag, keyed by the tag itself — and the tag has to be one
 * the shell's locale service declares (`zh`, `en`: `LOCALE_IDS` in dsh's
 * `client/locale`). A dictionary under any other id (`en-US`) is never read:
 * every key it carries comes back as the key itself. The shared and the
 * plugin's dictionaries are merged **per tag**, so both sit under `en`.
 *
 * The first key is the fallback every other tag resolves through, so the tag
 * that stands there is also what an unknown page language reads.
 */
import { enUS } from "./en-US.js";

/** tag → dictionary, registered wholesale under the plugin's locale namespace. */
export const DICTIONARIES: Record<string, Record<string, string>> = { en: enUS };

/** Every tag this half registers; the first entry is the fallback. */
export const TAGS = ["en"];
