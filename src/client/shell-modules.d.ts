/**
 * Structural views of the modules the shell seeds into its module table.
 *
 * Only the two `@deepseek-ai/dsh-client-*` ids need describing: they resolve
 * inside the running GUI's module table and appear in no local `node_modules`
 * tree (no `@types/*` for them exists), so they are described here — the same
 * structural-view idiom the host half uses for services it does not depend on —
 * rather than imported. `react`, `react/jsx-runtime` and `react-dom/client` are
 * the baseline modules that DO have local types (`react` + `react-dom` and their
 * `@types/*` are devDependencies, kept external by scripts/build-client.mjs),
 * so those imports resolve normally through `node_modules/@types`.
 *
 * Keep the shapes as narrow as what this half actually calls; widening them to
 * match upstream's real surface is a drift risk the tests cannot catch.
 */
declare module "@deepseek-ai/dsh-client-store" {
    /** A subscriber store: `getSnapshot` is stable identity, `set` notifies. */
    export interface SnapshotStore<T> {
        subscribe(listener: () => void): () => void;
        getSnapshot(): T;
        set(next: T): void;
    }

    /** Create a snapshot store seeded with `initial`. */
    export function createSnapshotStore<T>(initial: T): SnapshotStore<T>;
}

declare module "@deepseek-ai/dsh-client-ui-primitives" {
    /** A closed-choice dropdown: the list, the portal, and the keyboard
     *  handling are the primitive's; only `anchor` is drawn by the plugin. */
    export const Menu: (props: {
        open: boolean;
        onClose: () => void;
        items: { id: string; label: string }[];
        selectedId: string;
        onSelect: (id: string) => void;
        align?: string;
        /** Which side the portal list opens toward — the composer's pills open "top". */
        side?: string;
        portal?: boolean;
        anchor: any;
    }) => any;

    /** Renders only the control — `label` names it for assistive tech. */
    export const Switch: (props: { checked: boolean; label?: string; disabled?: boolean; onChange?: () => void }) => any;

    /** A transient notice; portals itself to `body`, dismisses on its timer. */
    export const Toast: (props: { text: string; icon?: any; onDone?: () => void }, key?: any) => any;

    export const IconWarningOutline16: (props?: any) => any;

    /** 14px chevron used by the shell's own composer pills. */
    export const IconChevronDownOutline14: (props?: any) => any;
}
