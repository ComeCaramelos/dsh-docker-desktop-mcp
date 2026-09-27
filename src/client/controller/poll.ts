/**
 * The revision poll — the client-side backstop for a discovery state that has
 * not reached this card yet.
 *
 * Freshness rule the host half forces on this half: `dsh-settings` only
 * re-serves the resolved value when the user section is written, and the host
 * bumps its own negative `refreshNonce` after every discovery run — so new
 * discovery results reach open clients through `settings/document-updated`,
 * with no client re-read needed. The mirror re-read is the backstop for a
 * missed push (and for a wait that never advances, which stages the failure
 * notice through {@link poll.PollHost.noteNotice}).
 */
import type { CardSnapshot } from "./snapshot.js";

/** Re-describe cadence (ms) while waiting for the host's discovery run. */
export const DISCOVERY_POLL_TICK_MS = 15000;

/** Give up waiting for the discovery revision to advance after this (ms) —
 * the tick budget below: 5 attempts x 15 s. */
export const DISCOVERY_POLL_TIMEOUT_MS = 75000;

/** Max mirror re-read attempts per wait — the attempt cap, complementary to
 * the wall-clock budget: an unavailable Docker Desktop fails the host
 * discovery once (which still bumps discoveryRevision) and nothing may keep
 * re-polling forever. */
export const DISCOVERY_POLL_MAX_TICKS = 5;

/** The revision field one wait is watching: the profile run's counter, or the
 * executable scan's. */
export type RevisionField = "discoveryRevision" | "executableDiscoveryRevision";

/** The poll's view of the card controller — exactly what re-reads and budgets
 * need, so the wait stays a stand-alone section. */
export type PollHost = {
    store: { getSnapshot(): CardSnapshot };
    /** The shared settings describe mirror (`settingsScope.describe()`). */
    mirror: any;
    /** Armed timer id; owned by the wait so `dispose()` can cancel it. */
    pollTimer: any;
    /** Whether the card was torn down while the wait was running. */
    disposed: boolean;
    /** Stage one failure notice the toast host announces. */
    noteNotice(kind: "error" | "stall", text: unknown): void;
};

/**
 * Re-describe the settings mirror every tick until one revision field advances,
 * the wall-clock deadline passes, or the re-read attempt cap elapses —
 * whichever comes first. The next tick is armed BEFORE touching the mirror so a
 * mirror read that never settles cannot stall the budgets.
 */
export function waitForRevision(host: PollHost, field: RevisionField, deadline: number): Promise<void> {
    var baseline = host.store.getSnapshot()[field];
    return new Promise<void>((resolve) => {
        var timer: any;
        var settled = false;
        var ticks = 0;
        var arm = (delay: number) => {
            timer = setTimeout(tick, delay);
            host.pollTimer = timer;
        };
        var finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (host.pollTimer === timer) host.pollTimer = null;
            resolve();
            // The wait ended without a healthy discovery result: the host
            // published a lastRefreshError (an unreachable Docker Desktop
            // surfaces exactly this way), or the budget ran out without the
            // revision ever advancing — "ran out of attempts and did not
            // connect". Announce it once through the shared Toast primitive.
            if (host.disposed) return;
            var result = host.store.getSnapshot();
            if (result.lastRefreshError !== "") host.noteNotice("error", result.lastRefreshError);
            else if (!(result[field] > baseline)) host.noteNotice("stall", "");
        };
        var satisfied = () =>
            host.store.getSnapshot()[field] > baseline || Date.now() >= deadline || ticks >= DISCOVERY_POLL_MAX_TICKS;
        var tick = () => {
            ticks += 1;
            if (host.disposed || satisfied()) {
                finish();
                return;
            }
            // Arm before touching the mirror: a load that never settles
            // must not stall the budget check.
            arm(DISCOVERY_POLL_TICK_MS);
            var loaded;
            try {
                loaded = host.mirror.load();
            } catch {
                loaded = void 0; // mirror read failure: the next tick retries
            }
            Promise.resolve(loaded)
                .catch(() => {})
                .then(() => {
                    if (host.disposed || satisfied()) {
                        finish();
                        return;
                    }
                });
        };
        arm(DISCOVERY_POLL_TICK_MS);
    });
}
