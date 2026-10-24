/**
 * Browser half — the body block this component owns.
 *
 * One card section per named catalog: the saved rows the manager's pickers read
 * from, a **Fetch** link that asks the machine what it can see, and a dialog
 * that says which of those to keep. Those shapes are what the shared block set
 * already draws (`RowsBlock`, `LinkButtonRow`, `DialogBlock`, `ErrorLine`); this
 * file composes them and owns the dialog's open state, which the shared halves
 * deliberately do not.
 *
 * What is deliberately **not** here is a selector. The profile and the
 * executable a live connection runs with belong to the *connection* — the
 * manager renders both on the entry it owns, and draws the composer pill over
 * that same entry — so a dropdown here would be a second control writing what
 * is not this row's to write.
 */
/// <reference path="./shell-modules.d.ts" />
import { jsx } from "react/jsx-runtime";
import { useState } from "react";
import { DialogBlock, ErrorLine, LinkButtonRow, RowsBlock } from "@comecaramelos/dsh-ancesters/client";
import STYLES from "./styles/DockerMcpCard.module.css";

/** One composed block: the rows, what the last run reported, and how to write. */
export type CatalogBlockProps = {
    /** Which catalog this block draws — decides the merge rule and the copy. */
    kind: "profiles" | "executables";
    /** The saved rows, as this row serves them. */
    entries: readonly { id: string; name: string }[];
    /** What the last run reported — the dialog's candidate list. */
    candidates: readonly string[];
    /** The last run's failure line, empty when the run answered. */
    lastRefreshError: string;
    /** A run is standing. */
    busy: boolean;
    /** False while the row is read-only (an overlay owns it). */
    writable: boolean;
    /** False until the row serves anything. */
    available: boolean;
    /** Every label, already resolved from the card's locale namespace. */
    copy: CatalogCopy;
    /** Whole-list write of the saved rows. */
    save: (rows: readonly { id: string; name: string }[]) => Promise<boolean>;
    /** Fire one Host run and wait for its answer. */
    run: () => Promise<void>;
    /** The card's translator. The dialog draws its own controls through it, so
     * it is handed to `DialogBlock` untouched. */
    t?: (key: string) => string;
};

/** The copy one catalog draws, resolved by the card's own translator. */
export type CatalogCopy = {
    idLabel: string;
    nameLabel: string;
    namePlaceholder: string;
    addLabel: string;
    removeLabel: string;
    rowsLabel: string;
    emptyText: string;
    fetchLabel: string;
    dialogTitle: string;
    dialogDescription: string;
    searchLabel: string;
};

/**
 * One catalog block: the saved rows, the fetch link, and — while it is open —
 * the candidate dialog over them.
 */
export function CatalogBlock(props: CatalogBlockProps): unknown {
    const t = typeof props.t === "function" ? props.t : (key: string) => key;
    const [open, setOpen] = useState(false);
    const running = props.busy === true;
    const entries = Array.isArray(props.entries) ? props.entries : [];
    const candidates = Array.isArray(props.candidates) ? props.candidates : [];
    const savedIds = entries.map((row) => row.id);
    // A dialog with nothing to choose from is a dead button, not an empty
    // dialog: a failed run leaves the candidate list empty and the error line
    // below says why.
    const dialogOpen = open === true && candidates.length > 0;

    /**
     * Ask the machine what it can see and open the dialog on the answer that
     * landed. The wait belongs to the shared controller and is armed **before**
     * the trigger crosses the wire, so a run that answers fast cannot slip past
     * it — and a Host that answers nothing still answers eventually.
     */
    const fetchAnswers = () => {
        if (running) return;
        // The dialog opens off the settle, not off the write: what the person
        // chose was an answer, not a "the request went through".
        void props.run().finally(() => setOpen(true));
    };

    return [
        RowsBlock({
            values: entries.map((row) => [row.id, row.name]),
            save: (values: readonly (readonly string[])[]) =>
                props.save(values.map((row) => ({ id: row[0] ?? "", name: row[1] ?? "" }))),
            labels: [props.copy.idLabel, props.copy.nameLabel],
            placeholders: [props.copy.idLabel, props.copy.namePlaceholder],
            writable: props.writable === true && props.available === true,
            busy: running,
            emptyLabel: props.copy.emptyText,
            addLabel: props.copy.addLabel,
            removeLabel: props.copy.removeLabel,
            disclosure: true,
            disclosureLabel: props.copy.rowsLabel,
            renderAction: () =>
                LinkButtonRow({
                    children: jsx("button", {
                        type: "button",
                        className: STYLES.linkButton,
                        // A read-only row is exactly the case a link must not
                        // pretend to work: the write would be refused.
                        disabled: props.writable !== true || running,
                        onClick: () => fetchAnswers(),
                        children: props.copy.fetchLabel
                    })
                })
        }),
        dialogOpen
            ? DialogBlock({
                candidates: candidates.map((id) => ({ id, label: id })),
                savedIds,
                title: props.copy.dialogTitle,
                description: props.copy.dialogDescription,
                searchPlaceholder: props.copy.searchLabel,
                onClose: () => setOpen(false),
                /**
                 * Only the checked ids that are not saved already land. The merge
                 * rule itself is the Host's (saved rows keep their order and
                 * names, additions land last and nameless) — this half decides
                 * only *which*, never how they fold in.
                 */
                onAdd: (ids: readonly string[]) => {
                    const additions = ids.filter((id) => !savedIds.includes(id)).map((id) => ({ id, name: "" }));
                    setOpen(false);
                    if (additions.length === 0) return void 0;
                    void props.save([...entries, ...additions]);
                    return void 0;
                },
                // The dialog's own controls (`close`, `selectAll`, `cancel`,
                // `addSelected`, `dialogEmpty`) ride the shared namespace, which
                // the card's translator already resolves — the card binds it
                // over the shared dictionaries merged under its own.
                t
            })
            : null,
        ErrorLine({ text: props.lastRefreshError })
    ];
}
