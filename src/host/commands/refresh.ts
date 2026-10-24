/**
 * `/docker-refresh` — re-discover profiles, and merge them into the saved rows.
 *
 * The Web card offers its fetched ids through a dialog the person chooses in. A
 * slash command has no dialog to answer, so this headless mirror keeps the merge
 * the card does explicitly: discovered ids land in the saved rows (kept rows keep
 * their order and custom names). The dialog is the UI's "which ones do you
 * actually want" step; this command is the headless equivalent of answering "the
 * ones you found".
 *
 * The run asks the executable the **connection** names when there is one — the
 * profile store is per executable, so asking the row config's path while a saved
 * connection runs a different install would report the wrong store. With no
 * connection it is the row config's answer, exactly as before.
 */
import { KIND_ID } from "../constants.js";
import { mergeEntries } from "../catalog.js";
import { entryCommand } from "../kind.js";
import type { CommandDefinition } from "../types/index.js";
import type { Controller } from "../controller/index.js";

/** The `/docker-refresh` definition, bound to one live controller. */
export function createRefreshCommand(controller: Controller): CommandDefinition {
    return {
        name: "docker-refresh",
        description: "Re-discover Docker MCP profiles from the connection's gateway",
        input: { hint: "(no arguments)" },
        async handler() {
            const live = controller.state.live;
            const before = live.discoveryRevision;
            const entry = controller.state.connections?.entries().find((row) => row.kind === KIND_ID);
            const command = entry === void 0 ? void 0 : entryCommand(entry, controller);
            try {
                await controller.runDiscovery(command);
            } catch (error) {
                return {
                    kind: "error",
                    text: `Discovery failed: ${error instanceof Error ? error.message : String(error)}.`
                };
            }
            if (live.discoveryRevision === before) {
                return { kind: "error", text: "Profile discovery did not complete." };
            }
            if (live.lastRefreshError !== "") {
                return { kind: "error", text: live.lastRefreshError };
            }
            const ids = live.profiles;
            const merged = mergeEntries(controller.profileEntries(), ids, "profiles");
            if (!merged.changed) {
                return { kind: "success", text: `Discovered ${ids.length} profile(s): ${ids.join(", ") || "(none)"}.` };
            }
            try {
                await controller.persistProfileEntries(merged.entries);
            } catch (error) {
                return {
                    kind: "error",
                    text: `Discovered ${ids.length} profile(s): ${ids.join(", ") || "(none)"} — the saved rows could not be updated: ${error instanceof Error ? error.message : String(error)}`
                };
            }
            return {
                kind: "success",
                text: `Discovered ${ids.length} profile(s): ${ids.join(", ") || "(none)"} — merged into the saved rows.`
            };
        }
    };
}
