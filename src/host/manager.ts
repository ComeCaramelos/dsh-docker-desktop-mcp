/**
 * The manager seam — what this component says to `mcpConnections`, and when.
 *
 * The component is a *companion* of the manager bundle: it injects the
 * `mcpConnections` service the manager provides, so this module only runs while
 * the manager runs, and whatever it registers is withdrawn when the injector's
 * effect does (no global state, nothing left behind when the component is off).
 *
 * Three things happen here, in the only order that works:
 *
 * 1. **The kind comes first.** A `docker-profile` entry cannot be saved, nor
 *    `resolve`d, until the kind answers for it — so the row is registered before
 *    anything may be proposed, and its choices are what the field renders.
 * 2. **Every publish re-notifies.** The `select` choices are read off this
 *    component's live mirror (the two catalogs plus what discovery reported), so
 *    what a picker shows is only as fresh as the last `notifyKindsChanged`.
 * 3. **The translation is offered last, never earlier.** A standalone row config
 *    is proposed only once the kind exists, because a proposal names a kind and
 *    the row is useless without it; a dismissal then remembers itself in this
 *    row's config (./migration.ts).
 *
 * The manager's own `Proposals` view is *not* cached here: the manager re-reads
 * this component's answers through the live mirror, so a run shows up without
 * anything being re-registered.
 */
import { KIND_ID, MIGRATION_DISMISSED_FIELD } from "./constants.js";
import { createDockerKind } from "./kind.js";
import { standaloneProposal } from "./migration.js";
import { readConfigField } from "./values.js";
import type { McpConnectionsService, McpProposal } from "@comecaramelos/dsh-mcp-manager/api";
import type { Controller } from "./controller/index.js";
import type { PluginContext } from "./types/index.js";

/**
 * Attach one live component to the manager's `mcpConnections` service: register
 * the kind, keep the kind's choices fresh, and offer what a standalone config
 * means now.
 *
 * @param ctx - plugin context (the injection is this component's own effect).
 * @param controller - the live state every answer is read from.
 */
export function attachToManager(ctx: PluginContext, controller: Controller): void {
    ctx.inject(["mcpConnections"], (inner) => {
        const service = (inner as unknown as { mcpConnections?: McpConnectionsService }).mcpConnections;
        if (service === void 0) return;
        const state = controller.state;
        state.connections = service;
        // What a picker would answer just moved — every live publish says so.
        state.notifyKindsChanged = () => {
            try {
                service.notifyKindsChanged();
            } catch {
                // A manager that has already gone away answers nothing; the next
                // publish says it again.
            }
        };

        const kind = createDockerKind(controller);
        ctx.effect(() => {
            const unregister = service.registerKind(kind);
            return () => {
                unregister();
                state.connections = void 0;
                state.notifyKindsChanged = () => void 0;
            };
        }, "docker-desktop-mcp: manager kind");

        // An entry already standing under `docker-profile` was answered "kind
        // nobody registered" by the manager's first reconcile; registering is
        // enough — the manager reconciles again when a kind arrives (or leaves),
        // and that answer was never kept.

        // The standalone translation, offered once per apply: what it offers is
        // fixed by the row config, which does not change underneath. A dismissal
        // withdraws it (the manager drops a dismissed proposal itself); the reason
        // it is not offered again is the row's own `migrationDismissed`.
        ctx.effect(() => {
            const proposal = standingProposal(controller);
            if (proposal === void 0) return () => void 0;
            let withdraw: (() => void) | undefined;
            try {
                withdraw = service.propose(proposal);
            } catch (error) {
                controller.ctx.logger.warn(`docker-desktop-mcp(${controller.config.serverName}): the standalone configuration could not be offered: ${String(error)}`);
                return () => void 0;
            }
            return () => {
                withdraw?.();
            };
        }, "docker-desktop-mcp: standalone translation");
    });
}

/**
 * The translation currently worth offering, or `undefined` — when it has been
 * turned down, or when there is nothing to say.
 * @param controller - the live state.
 */
function standingProposal(controller: Controller): McpProposal | undefined {
    if (readConfigField(controller.config[MIGRATION_DISMISSED_FIELD], false) === true) return void 0;
    const proposal = standaloneProposal(controller);
    if (proposal === void 0) return void 0;
    if (proposal.entry.kind !== KIND_ID) return void 0;
    return proposal;
}
