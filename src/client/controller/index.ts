/**
 * Browser half — the card controller.
 *
 * Projects the bound `docker-desktop-mcp` settings scope onto the snapshot store
 * the card reads through its `useDockerMcpCard` hook, and owns every write the
 * card can perform, split into its two behavior sections:
 *
 *   ./snapshot.ts  the snapshot shape + how a served value is projected onto it
 *   ./actions.ts   the write actions (pick, override, toggle, fetch, add)
 *   ./poll.ts      the revision backstop wait behind the two fetch actions
 *
 * Freshness rule the host half forces on this half: `dsh-settings` only
 * re-serves the resolved value when the user section is written, and the host
 * bumps its own negative `refreshNonce` after every discovery run — so new
 * discovery results reach open clients through `settings/document-updated`,
 * with no client re-read needed. The mirror re-read is the backstop for a
 * missed push (and for a wait that never advances, which stages the failure
 * notice).
 */

/// <reference path="../shell-modules.d.ts" />
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import type { CatalogEntry, CatalogKind } from "../catalog.js";
import {
    addDetected as writeDetected,
    detectedIds,
    refreshExecutables as fetchExecutables,
    refreshProfiles as fetchProfiles,
    saveEntries as writeEntries,
    selectExecutable,
    selectProfile,
    toggleStderr,
    type ActionHost
} from "./actions.js";
import { DISCOVERY_POLL_MAX_TICKS, DISCOVERY_POLL_TICK_MS, DISCOVERY_POLL_TIMEOUT_MS, waitForRevision, type PollHost } from "./poll.js";
import {
    initialSnapshot,
    servedSnapshot,
    unavailableSnapshot,
    type CardSnapshot
} from "./snapshot.js";

export type { CardSnapshot, CatalogEntry };
export { DISCOVERY_POLL_MAX_TICKS, DISCOVERY_POLL_TICK_MS, DISCOVERY_POLL_TIMEOUT_MS };

/**
 * The controller behind one mounted card.
 */
export class DockerMcpCardController {
    /** Instance state (`declare` members erase; the constructor owns them). */
    declare scope: any;
    declare mirror: any;
    declare disposed: boolean;
    declare pollTimer: any;
    declare store: any;
    declare unsubscribe: any;

    /**
     * @param scope - the bound settings scope (getSnapshot/subscribe/set/unset).
     * @param mirror - the shared settings describe mirror (`settingsScope.describe()`).
     */
    constructor(scope: any, mirror: any) {
        this.scope = scope;
        this.mirror = mirror;
        this.disposed = false;
        this.pollTimer = null;
        this.store = createSnapshotStore<CardSnapshot>(initialSnapshot());
        this.unsubscribe = scope.subscribe(() => this.publish());
        this.publish();
        // Boot-time backstop: normally the host's post-run refreshNonce bump
        // re-describes this client and the served discoveryRevision is already
        // > 0 at mount (a push that landed before this controller subscribed
        // resolves in the first publish). Only a missed/absent bump keeps a
        // served revision of 0, and this silent poll (no refreshNonce write)
        // re-reads the mirror until the state lands — otherwise the card reads
        // "Profile not found" until the user clicks Refresh.
        if (this.store.getSnapshot().discoveryRevision === 0) {
            waitForRevision(this, "discoveryRevision", Date.now() + DISCOVERY_POLL_TIMEOUT_MS);
        }
    }

    /** Republish the latest scope snapshot into the card store. */
    publish(): void {
        if (this.disposed) return;
        var previous = this.store.getSnapshot();
        var snapshot = this.scope.getSnapshot();
        if (snapshot.status !== "ready" || snapshot.value === void 0) {
            this.store.set(unavailableSnapshot(previous));
            return;
        }
        this.store.set(servedSnapshot(snapshot, previous));
    }

    /** Stage-less immediate write of the selected profile (persisted; the next connect starts with it). */
    selectProfile(profile: string): Promise<unknown> {
        return selectProfile(this, profile);
    }

    /** Write the selected executable (persisted as `command`). */
    selectExecutable(id: string): Promise<unknown> {
        return selectExecutable(this, id);
    }

    /** Persist one catalog's rows wholesale (a row edit, an added row or a deletion). */
    saveEntries(kind: CatalogKind, entries: CatalogEntry[]): Promise<unknown> {
        return writeEntries(this, kind, entries);
    }

    /** Flip the "Reduce log output" toggle. */
    toggleStderr(): Promise<unknown> {
        return toggleStderr(this);
    }

    /** Fetch the profile ids, open the dialog over whatever the run reported. */
    refreshProfiles(): Promise<string[]> {
        return fetchProfiles(this);
    }

    /** Fetch the executable paths, open the dialog over whatever the scan found. */
    refreshExecutables(): Promise<string[]> {
        return fetchExecutables(this);
    }

    /** The candidate ids one catalog's last discovery run reported. */
    detectedIds(kind: CatalogKind): string[] {
        return detectedIds(this, kind);
    }

    /** "Add selected" of a fetch dialog: merge the checked ids into the rows. */
    addDetected(kind: CatalogKind, selectedIds: readonly string[]): Promise<unknown> {
        return writeDetected(this, kind, selectedIds);
    }

    /** Surface a failed settings write as the card's action error. */
    noteError(error: any): void {
        if (this.disposed) return;
        var previous = this.store.getSnapshot();
        this.store.set({
            ...previous,
            actionError: error != null && typeof error.message === "string" ? error.message : String(error)
        });
    }

    /**
     * Stage a one-shot failure notice the toast host announces through the
     * shared Toast primitive (an error kind carries the host's lastRefreshError
     * text verbatim; a stall kind is locale-resolved). It replaces the previous
     * notice and bumps its seq so the toast remounts and the dismiss of an
     * already-stale toast is ignored. Nothing here re-runs the poll — the
     * controller stays idle until the user acts.
     */
    noteNotice(kind: "error" | "stall", text: unknown): void {
        if (this.disposed) return;
        var previous = this.store.getSnapshot();
        this.store.set({
            ...previous,
            notice: {
                seq: previous.notice == null || previous.notice === void 0 ? 1 : previous.notice.seq + 1,
                kind: kind,
                text: kind === "error" ? String(text ?? "") : ""
            }
        });
    }

    /** Drop the staged notice once the toast finished displaying it. */
    clearNotice(seq: number): void {
        if (this.disposed) return;
        var previous = this.store.getSnapshot();
        var notice = previous.notice;
        if (notice === null || notice === void 0 || notice.seq !== seq) return;
        this.store.set({ ...previous, notice: null });
    }

    /** The face the card's slot registration injects. */
    inject(): any {
        return {
            hooks: { dockerMcpCard: this.store },
            selectProfile: (profile: string) => this.selectProfile(profile),
            selectExecutable: (id: string) => this.selectExecutable(id),
            saveProfileEntries: (entries: CatalogEntry[]) => this.saveEntries("profiles", entries),
            saveExecutables: (entries: CatalogEntry[]) => this.saveEntries("executables", entries),
            toggleStderr: () => this.toggleStderr(),
            refreshProfiles: () => this.refreshProfiles(),
            refreshExecutables: () => this.refreshExecutables(),
            addDetected: (kind: CatalogKind, selectedIds: readonly string[]) => this.addDetected(kind, selectedIds),
            clearNotice: (seq: number) => this.clearNotice(seq)
        };
    }

    /** Stop subscribing and cancel any pending poll. */
    dispose(): void {
        this.disposed = true;
        if (this.pollTimer !== null) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        this.unsubscribe();
    }
}

/** The controller shape the poll/action sections read — satisfied by the class. */
export type { ActionHost, PollHost };
