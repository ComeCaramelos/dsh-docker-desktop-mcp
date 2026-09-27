/**
 * `/docker-refresh` — re-discover profiles, and merge them into the saved rows.
 *
 * The Web card offers its fetched ids through a dialog the user chooses in. A
 * slash command has no dialog to answer, so this headless mirror keeps the
 * merge the card used to do silently: discovered ids land in the saved rows
 * (kept rows keep their order and custom names). The dialog is the UI's "which
 * ones do you actually want" step; this command is the headless equivalent of
 * answering "the ones you found".
 */
import { SETTINGS_NAMESPACE } from "../constants.js";
import { mergeEntries } from "../catalog.js";
import type { CommandDefinition } from "../types/index.js";
import type { GatewayController } from "../controller/index.js";

/** The `/docker-refresh` definition, bound to one live controller. */
export function createRefreshCommand(controller: GatewayController): CommandDefinition {
    return {
        name: "docker-refresh",
        description: "Re-discover Docker MCP profiles from gateway",
        input: { hint: "(no arguments)" },
        async handler() {
            const before = controller.entry.discoveryRevision;
            try {
                await controller.runDiscovery();
            } catch (error) {
                return {
                    kind: "error",
                    text: `Discovery failed: ${error instanceof Error ? error.message : String(error)}.`
                };
            }
            if (controller.entry.discoveryRevision === before) {
                return {
                    kind: "error",
                    text: "Profile discovery did not complete."
                };
            }
            if (controller.entry.lastRefreshError) {
                return {
                    kind: "error",
                    text: controller.entry.lastRefreshError
                };
            }
            const settings = controller.settings;
            const merged = mergeEntries(controller.source().profileEntries, controller.entry.profiles, "profiles");
            if (merged.changed) {
                if (settings === void 0) {
                    return {
                        kind: "error",
                        text: `Discovered ${controller.entry.profiles.length} profile(s): ${controller.entry.profiles.join(", ") || "(none)"} — settings are not available, the rows could not be updated.`
                    };
                }
                try {
                    await settings.mutate(SETTINGS_NAMESPACE, [
                        { op: "set", path: ["profileEntries"], value: merged.entries }
                    ]);
                } catch (error) {
                    return {
                        kind: "error",
                        text: `Failed to persist discovered profiles: ${error instanceof Error ? error.message : String(error)}.`
                    };
                }
                return {
                    kind: "success",
                    text: `Discovered ${controller.entry.profiles.length} profile(s): ${controller.entry.profiles.join(", ") || "(none)"} — merged into the saved rows.`
                };
            }
            return {
                kind: "success",
                text: `Discovered ${controller.entry.profiles.length} profile(s): ${controller.entry.profiles.join(", ") || "(none)"}.`
            };
        }
    };
}
