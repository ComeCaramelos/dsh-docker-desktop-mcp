/**
 * Controller face — the public shape of one running component instance.
 *
 * The configuration form, the slash commands and the manager's `docker-profile`
 * kind all call into this; nothing about the UI lives here.
 *
 * What the face offers is what the two callers need: the kind reads the two
 * catalogs and asks for a `prepare` before resolving an entry; the card's two
 * triggers fire the two discovery runs; the form routes commits.
 *
 * Note what a controller no longer owns: no bridge fiber, no cold-start spawn
 * and no in-place switch. A live `docker-profile` connection is the manager's
 * pool's business — this face is what it calls when it needs what only this
 * component knows.
 */
import type { SettingsFormHandle } from "@comecaramelos/dsh-ancesters/host";
import type { CatalogEntry } from "../types/settings.js";
import type { DockerMcpConfig, PluginContext } from "../types/index.js";
import type { ControllerState } from "./state.js";

/** The public face of one running component instance. */
export type Controller = {
    /** The plugin context (the fiber the live publish commits through). */
    readonly ctx: PluginContext;
    /** The validated config as `apply` handed it. */
    readonly config: DockerMcpConfig;
    /** The mutable half — the mirror, the layers source, the runs. */
    readonly state: ControllerState;
    /** The form once attached (entry id + settings service), else undefined. */
    readonly form: SettingsFormHandle | undefined;
    /** Attach the row's configuration form. The attach itself owns its own
     * effect, so this only records what the state reads through. */
    attachForm(form: SettingsFormHandle): void;
    /** Release the described row; the references keep answering. */
    detachForm(): void;
    /** Route what the form just committed (see ./commits.ts). */
    onFormCommit(): void;
    /** Open the live answers: publish the mirror, scan the executables, run the
     * first profile list. Nothing here spawns a gateway. */
    start(): void;
    /** One profile-list discovery run (candidate list only). */
    runDiscovery(command?: string): Promise<void>;
    /** One executable-candidate run (paths only — the dialog decides which ones
     * land in the saved rows). */
    runExecutablesDiscovery(): Promise<void>;
    /** Make one executable safe to run against: the bounded readiness wait,
     * armed once per path. What `prepare` is. */
    prepare(command: string): Promise<void>;
    /** Say what a live connection runs with, so the mirror and the choices
     * answer with the executable the next run should probe. */
    noteRunning(command: string, consoleOutput: boolean): void;
    /** The saved profile rows the kind's `select` offers. */
    profileEntries(): CatalogEntry[];
    /** The saved executable rows the kind's `select` offers. */
    executables(): CatalogEntry[];
    /** Write the saved profile rows a merge produced. */
    persistProfileEntries(entries: readonly CatalogEntry[]): Promise<void>;
    /** Say that a standalone row config was turned down, so it is not offered
     * again (D4). */
    dismissMigration(): Promise<void>;
    /** Publish every live answer the mirror carries. */
    publish(): void;
    /** Stop any pending retry and mark this half dead. */
    dispose(): void;
};

export type { ControllerState };
