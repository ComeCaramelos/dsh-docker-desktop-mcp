/**
 * The live controller — one per apply, assembled from five sections.
 *
 * Everything mutable lives in ./state.ts; the others are behavior over it:
 *
 *   ./state.ts      the mirror, the layers source, the runs
 *   ./start.ts      what the machine answers first (the two opening runs)
 *   ./discovery.ts  the two chained, gated runs + the bounded retry
 *   ./publish.ts    the coalesced live commit every answer rides
 *   ./commits.ts    what a configuration-form commit means for the row
 *   ./persist.ts    the Host's own writes into the row's patch layer
 *
 * No section spawns a gateway any more: the live connection belongs to the
 * manager (kind `docker-profile`), which asks what the executable, the profile
 * and the console-output mode are, and starts the pool fiber itself. What this
 * controller owns is the **machine** half — what to probe, what to remember,
 * and what to answer with.
 *
 * The rules that must survive the split (see ../../../../AGENTS.md "Hard
 * constraints"):
 *
 * - The live mirror is the only Host→client channel. Every run publishes it, and
 *   every persisted write clears those fields back to their row answers.
 * - A run never merges anything into the saved rows, and never writes the row
 *   out of a retry.
 * - A readiness wait is armed once per executable, never per tick.
 */
import { normalizeEntries } from "../catalog.js";
import { readConfigField } from "../values.js";
import { dismissMigration, persistProfileEntries } from "./persist.js";
import { publishLive } from "./publish.js";
import { prepareFor, runExecutableDiscovery, runProfileDiscovery } from "./discovery.js";
import { onFormCommit } from "./commits.js";
import { startRuns } from "./start.js";
import { createControllerState } from "./state.js";
import type { Controller } from "./types.js";
import type { CatalogEntry, DockerMcpConfig, PluginContext } from "../types/index.js";
import type { SettingsFormHandle } from "@comecaramelos/dsh-ancesters/host";

export type { Controller } from "./types.js";
export type { ControllerState } from "./state.js";

/**
 * Build the live controller for one apply of `config`.
 * @param ctx - plugin context.
 * @param config - validated config (every volatile field a reference).
 */
export function createController(ctx: PluginContext, config: DockerMcpConfig): Controller {
    const state = createControllerState(ctx, config);

    const controller: Controller = {
        ctx,
        config,
        state,
        get form() {
            return state.form;
        },

        attachForm(form: SettingsFormHandle) {
            state.form = form;
        },
        detachForm() {
            state.form = void 0;
        },
        onFormCommit() {
            onFormCommit(controller);
        },
        start() {
            startRuns(ctx, state);
        },
        runDiscovery(command?: string) {
            return runProfileDiscovery(ctx, state, command);
        },
        runExecutablesDiscovery() {
            return runExecutableDiscovery(ctx, state);
        },
        prepare(command: string) {
            return prepareFor(ctx, state, command);
        },
        noteRunning(command: string, consoleOutput: boolean) {
            const changed = state.currentCommand !== command || state.live.stderrEffective !== (consoleOutput ? "console" : "log");
            state.currentCommand = command;
            state.live.effectiveCommand = command;
            state.live.effectiveSource = command === "" ? "" : "row-config";
            state.live.stderrEffective = consoleOutput ? "console" : "log";
            // A different executable reads a different profile store, so the
            // choices the picker offers have to be re-learned.
            if (changed) void runProfileDiscovery(ctx, state, command);
            else publishLive(ctx, state);
        },
        profileEntries() {
            return normalizeEntries(readConfigField(config.profileEntries, []), "profiles");
        },
        executables() {
            return normalizeEntries(readConfigField(config.executables, []), "executables");
        },
        persistProfileEntries(entries: readonly CatalogEntry[]) {
            return persistProfileEntries(controller, entries);
        },
        dismissMigration() {
            return dismissMigration(controller);
        },
        publish() {
            publishLive(ctx, state);
        },
        dispose() {
            state.disposed = true;
            if (state.retryTimer !== void 0) {
                clearTimeout(state.retryTimer);
                state.retryTimer = void 0;
            }
        }
    };
    return controller;
}

/** Older name kept for the first consumers of this face. */
export const createGatewayController = createController;
