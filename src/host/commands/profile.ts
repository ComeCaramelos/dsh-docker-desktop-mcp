/**
 * `/docker-profile` — the headless mirror of the Web card's profile picker.
 *
 * It writes the SAME persisted `profile` field the picker does, so the
 * picker, the command and the running gateway always agree. Nothing here is
 * cancellable: the handler must not rely on `invocation.signal`.
 */
import { PROFILE_PATTERN, SETTINGS_NAMESPACE } from "../constants.js";
import { entryIds } from "../catalog.js";
import type { CommandDefinition } from "../types/index.js";
import type { GatewayController } from "../controller/index.js";

/** The `/docker-profile` definition, bound to one live controller. */
export function createProfileCommand(controller: GatewayController): CommandDefinition {
    return {
        name: "docker-profile",
        description: "Switch Docker MCP gateway profile",
        input: { hint: "profile-id" },
        async handler(invocation) {
            const settings = controller.settings;
            if (settings === void 0) {
                return {
                    kind: "error",
                    text: "Settings not yet available."
                };
            }
            const input = invocation.rawInput.trim();
            // Reject: empty, spaces, tabs, newlines, multiple tokens.
            if (input.length === 0) {
                return {
                    kind: "error",
                    text: `Usage: /docker-profile <profile-id>\nAvailable: ${[...new Set(controller.entry.profiles.concat(entryIds(controller.source().profileEntries)))].join(", ") || "(none discovered yet)"}`
                };
            }
            if (input.includes(" ")) {
                return {
                    kind: "error",
                    text: "Exactly one profile id required (no spaces)."
                };
            }
            if (!PROFILE_PATTERN.test(input)) {
                return {
                    kind: "error",
                    text: `Invalid profile id (pattern: ${PROFILE_PATTERN.source}).`
                };
            }
            const alreadyActive = controller.started && controller.runningProfile === input;
            try {
                await settings.mutate(SETTINGS_NAMESPACE, [{ op: "set", path: ["profile"], value: input }]);
            } catch (error) {
                return {
                    kind: "error",
                    text: `Failed to persist profile: ${error instanceof Error ? error.message : String(error)}.`
                };
            }
            // No-op case: the requested id is already what the running gateway
            // uses — report it as such instead of claiming a reconnect that
            // never happens (the commit skips a same-profile write, so no bridge
            // update is issued either).
            if (alreadyActive) {
                return { kind: "success", text: `Profile "${input}" is already active.` };
            }
            // Bridge not yet started: the settings commit will apply it.
            if (!controller.started) {
                return { kind: "success", text: `Profile "${input}" selected. Gateway will start with it.` };
            }
            return { kind: "success", text: `Profile "${input}" selected. Gateway reconnecting.` };
        }
    };
}
