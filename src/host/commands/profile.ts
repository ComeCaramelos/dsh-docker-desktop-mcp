/**
 * `/docker-profile` — the headless mirror of the composer pill.
 *
 * The pill and this command both write the **connection's** `extra.profile`
 * through the manager's own write channel, so the picker, the command and the
 * running gateway always agree — and both go through the pool's in-place switch
 * rather than a second write path. Nothing here is cancellable: the handler must
 * not rely on `invocation.signal`.
 *
 * What is not written is this row's config: the row keeps what a person edits
 * (the two catalogs and the two fetch triggers); the profile the gateway runs
 * with is a property of the live connection, which is what the manager owns.
 */
import { KIND_FIELDS, KIND_ID, PROFILE_PATTERN } from "../constants.js";
import { entryIds } from "../catalog.js";
import type { CommandDefinition } from "../types/index.js";
import type { Controller } from "../controller/index.js";

/** The `/docker-profile` definition, bound to one live controller. */
export function createProfileCommand(controller: Controller): CommandDefinition {
    return {
        name: "docker-profile",
        description: "Switch the Docker MCP Toolkit connection profile",
        input: { hint: "profile-id" },
        async handler(invocation) {
            const input = invocation.rawInput.trim();
            const live = controller.state.live;
            const saved = entryIds(controller.profileEntries());
            // No manager mounted, or no connection to switch: the command has
            // nothing to write, and saying so beats a silent no-op.
            const service = controller.state.connections;
            if (service === void 0) {
                return {
                    kind: "error",
                    text: "Docker MCP Toolkit profiles belong to a connection, and no MCP Connections manager is mounted — the row runs nothing on its own."
                };
            }
            const entry = service.entries().find((row) => row.kind === KIND_ID);
            if (entry === void 0) {
                return {
                    kind: "error",
                    text: `No Docker MCP Toolkit connection exists yet — create one on the MCP Connections page${saved.length > 0 ? `, or pick from the saved profiles: ${saved.join(", ")}` : ""}.`
                };
            }
            if (input.length === 0) {
                const known = live.profiles;
                return {
                    kind: "error",
                    text: `Usage: /docker-profile <profile-id>\nAvailable: ${[...new Set(known.concat(saved))].join(", ") || "(none discovered yet)"}`
                };
            }
            if (input.includes(" ")) {
                return { kind: "error", text: "Exactly one profile id required (no spaces)." };
            }
            if (!PROFILE_PATTERN.test(input)) {
                return { kind: "error", text: `Invalid profile id (pattern: ${PROFILE_PATTERN.source}).` };
            }
            // A healthy, non-empty discovery list is AUTHORITATIVE (the same rule
            // the pill's choices follow): an id it did not report is refused with
            // the usage listing rather than switched to a gateway that would fail
            // on it. An empty list — or a failed run — is not trustworthy, so a
            // write is allowed there (last write wins over what discovery might
            // be hiding). A saved row's id counts as known too, so a picker row
            // never disappears.
            const authoritative = live.lastRefreshError === "" && live.profiles.length > 0;
            if (authoritative && !live.profiles.includes(input) && !saved.includes(input)) {
                return {
                    kind: "error",
                    text: `Unknown profile "${input}". Usage: /docker-profile <profile-id>\nAvailable: ${[...new Set(live.profiles.concat(saved))].join(", ")}`
                };
            }
            const current = typeof entry.extra[KIND_FIELDS.profile] === "string" ? entry.extra[KIND_FIELDS.profile] : "";
            if (current === "" ? input === "default" : current === input) {
                return { kind: "success", text: `Profile "${input}" is already what this connection runs with.` };
            }
            let accepted: boolean;
            try {
                accepted = await service.update(entry.id, { extra: { [KIND_FIELDS.profile]: input } });
            } catch (error) {
                return {
                    kind: "error",
                    text: `Failed to write the connection: ${error instanceof Error ? error.message : String(error)}.`
                };
            }
            if (!accepted) {
                return {
                    kind: "error",
                    text: `The connection "${entry.id}" refused the write — its row may be read-only (a command-line or home patch layer wins over an edit).`
                };
            }
            return { kind: "success", text: `Profile "${input}" selected. The connection is switching.` };
        }
    };
}
