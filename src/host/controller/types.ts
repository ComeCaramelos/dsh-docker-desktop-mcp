/**
 * Controller face — the public shape of one running gateway controller.
 *
 * The settings section and the slash commands call into this; nothing about the
 * UI lives here.
 */
import type {
    DiscoveryOptions,
    GatewayStderrMode,
    GatewayStderrNotice,
    SettingsBaseLayer,
    SettingsResolved,
    SettingsService
} from "../types/index.js";

/** The public face of one running gateway controller. */
export type GatewayController = {
    /** The in-memory composition base layer handed to `installSection`. */
    readonly entry: SettingsBaseLayer;
    /** The live resolved settings value (base layer merged with the user layer). */
    source(): SettingsResolved;
    /** Swapped in by the settings section's `setSource` hook. */
    setSource(source: () => SettingsResolved): void;
    /** The settings service once installed (undefined until then). */
    readonly settings: SettingsService | undefined;
    /** Profile the bridge runs (or will start) with. */
    readonly runningProfile: string;
    /** Executable the bridge runs (or will start) with. */
    readonly runningCommand: string;
    /** Effective gateway-stderr mode of the running/spawning bridge. */
    readonly runningStderrMode: GatewayStderrMode;
    /** Whether the nested bridge exists yet (readiness still in flight: false). */
    readonly started: boolean;
    /** The last `refreshNonce` this host pushed itself (loop guard). */
    readonly pushedNonce: number | undefined;
    /** The last `refreshExecutablesNonce` this host pushed itself (loop guard). */
    readonly pushedExecNonce: number | undefined;
    /** Begin the cold-start wait: start the bridge + the first discovery run. */
    start(): void;
    /** One profile-list discovery run (`echo` = a received sync marker). */
    runDiscovery(options?: DiscoveryOptions): Promise<void>;
    /** One executable-candidate discovery run (candidates only — the dialog
     * decides which paths land in the saved rows). */
    runExecutablesDiscovery(options?: DiscoveryOptions): Promise<void>;
    /** Restart the bridge on one profile + executable. */
    switchConnection(profile: string, command: string): void;
    /** Restart the bridge on one profile, keeping the current executable. */
    switchProfile(profile: string): void;
    /** Restart the bridge with/without the stderr-capturing wrapper. */
    applyStderrMode(mode: GatewayStderrMode): void;
    /** Announce where the gateway's console output goes (once per state change). */
    noteStderr(built: GatewayStderrNotice): void;
    /** Resolve the settings gate (called by the section installer). */
    attachSettings(settings: SettingsService): void;
    /** Stop any pending retry and mark this half dead. */
    dispose(): void;
};
