/**
 * The named picker — one Menu pill over the saved rows plus a catalog list you
 * can refresh, extend by hand and prune. Both card blocks render through this
 * component; the only difference is the props each block hands it.
 *
 * `showSelector: false` drops the dropdown pill entirely. The profile block
 * uses it: selecting the profile happens from the composer pill, so the card
 * block keeps only what the composer cannot edit — the saved rows (plus their
 * field row, hint and the fetch link). The executable block keeps its own pill.
 *
 * Rows live inside a collapsed `<details>` disclosure (the reference card's
 * "Customized settings" idiom): only the dropdown (when present) and its field
 * row are visible until the user opens the row list.
 *
 * Rows come from the served snapshot, with a local draft overlaying them only
 * while an edit is pending (the reference card's `editing` map idiom): typing
 * does not persist, a blur/Enter commits the whole list, a delete persists
 * immediately, and "add" appends a local blank row that only becomes a saved
 * row once it carries a usable id. Once the field is idle, the next host push
 * (a discovery merge that added ids, for instance) becomes the view again.
 */

/// <reference path="../shell-modules.d.ts" />
import * as react from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import type { CatalogEntry } from "../catalog.js";
import STYLES from "../styles/DockerMcpCard.module.css";
import { CHEVRON_PATH, TRASH_PATH } from "./icons.js";

/** One named picker: the profile one or the executable one. */
export function CatalogPicker(props: any): any {
    var t = props.t;
    var entries: CatalogEntry[] = props.entries;
    var selectedId = props.selectedId;
    var writable = props.writable;
    var busy = props.busy === true;
    var idPlaceholder = props.kind === "profiles" ? t("profileIdPlaceholder") : t("executableIdPlaceholder");
    var namePlaceholder = t("namePlaceholder");
    var draftState = react.useState<CatalogEntry[] | null>(null);
    var draft = draftState[0];
    var setDraft = draftState[1];
    var focusedState = react.useState(false);
    var focused = focusedState[0];
    var setFocused = focusedState[1];
    var servedKey = JSON.stringify(entries);
    var syncState = react.useState("");
    var servedSync = syncState[0];
    var setServedSync = syncState[1];
    // A host push replaces an idle draft — that is how a discovery merge that
    // added ids (or a refresh's fresh list) becomes visible again.
    if (servedKey !== servedSync) {
        setServedSync(servedKey);
        if (!focused) setDraft(null);
    }
    var rows: CatalogEntry[] = draft === null ? entries : draft;

    var save = (next: CatalogEntry[]) => {
        if (typeof props.saveEntries !== "function") return;
        Promise.resolve(props.saveEntries(next)).catch(() => {});
    };

    var withDraft = (make: (current: CatalogEntry[]) => CatalogEntry[]) => make(draft === null ? entries : draft);

    var patchRow = (index: number, field: "id" | "name", value: string) => {
        setFocused(true);
        setDraft(
            withDraft((current: CatalogEntry[]) =>
                current.map((entry: CatalogEntry, at: number) =>
                    at === index ? { id: field === "id" ? value : entry.id, name: field === "name" ? value : entry.name } : entry
                )
            )
        );
    };

    var removeRow = (index: number) => {
        if (!writable || rows[index] === void 0) return;
        // A delete is structural: keep the local view steady AND persist it
        // (the controller normalizes on write, so nothing invalid lands).
        var remaining = rows.filter((_entry: CatalogEntry, at: number) => at !== index);
        setDraft(remaining);
        save(remaining);
    };

    var addRow = () => {
        if (!writable) return;
        // A blank row is local until it has a usable id: a write would strip
        // the id-less row, so it only becomes a saved row when it is typed in
        // and committed.
        setDraft(withDraft((current: CatalogEntry[]) => current.concat([{ id: "", name: "" }])));
    };

    var commit = () => {
        if (typeof props.saveEntries !== "function") return;
        if (draft === null) return; // idle: served rows already are the truth
        save(rows);
    };

    return jsxs("div", {
        className: STYLES.catalog,
        children: [
            // No block heading: the row's own title + description (and the
            // disclosure summary) already name what this picker edits, so a
            // heading duplicated it. The field row leads the block.
            jsxs("div", {
                className: STYLES.field,
                children: [
                    jsxs("div", {
                        className: STYLES.fieldRow,
                        children: [
                            jsx("span", { className: STYLES.fieldTitle, children: props.selectorLabel }),
                            props.showSelector === false ? null : jsx("span", {
                                className: STYLES.selectorWrap,
                                children: jsx(Menu, {
                                    open: props.menuOpen,
                                    onClose: () => {
                                        props.setMenuOpen(false);
                                    },
                                    items: props.options,
                                    selectedId: selectedId,
                                    onSelect: (id: string) => {
                                        props.setMenuOpen(false);
                                        props.select(id);
                                    },
                                    align: "end",
                                    portal: true,
                                    anchor: jsxs("button", {
                                        type: "button",
                                        className: STYLES.selector,
                                        "aria-haspopup": "menu",
                                        "aria-expanded": props.menuOpen,
                                        disabled: !writable || busy,
                                        onClick: () => {
                                            props.setMenuOpen(!props.menuOpen);
                                        },
                                        children: [
                                            props.selectedLabel,
                                            jsx("svg", {
                                                width: 14,
                                                height: 14,
                                                className: STYLES.pillChevron,
                                                viewBox: "0 0 14 14",
                                                fill: "none",
                                                xmlns: "http://www.w3.org/2000/svg",
                                                children: jsx("path", { d: CHEVRON_PATH, fill: "currentColor" })
                                            })
                                        ]
                                    })
                                })
                            })
                        ]
                    }),
                    jsx("div", { className: STYLES.fieldDesc, children: props.hint })
                ]
            }),
            // Only the empty-state notice and the row boxes are hidden behind
            // the collapsed disclosure (the reference card's "Customized
            // settings" shape); the head and the dropdown stay visible.
            rows.length === 0 ? jsx("p", { className: STYLES.empty, children: props.emptyText }) : null,
            jsxs("details", {
                className: STYLES.disclosure,
                children: [
                    jsxs("summary", {
                        className: STYLES.disclosureSummary,
                        children: [
                            jsx("span", { className: STYLES.disclosureLabel, children: props.rowsLabel }),
                            jsx("span", { className: STYLES.disclosureCount, children: String(rows.length) })
                        ]
                    }),
                    jsxs("div", {
                        className: STYLES.disclosureBody,
                        children: [
                            // The refresh action belongs to this catalog's rows,
                            // so it lives inside the disclosure, not its head.
                            jsx("button", {
                                type: "button",
                                className: STYLES.linkButton,
                                disabled: !writable || busy,
                                onClick: () => {
                                    props.refresh();
                                },
                                children: busy ? props.busyLabel : props.refreshLabel
                            }),
                            rows.map((entry: CatalogEntry, index: number) =>
                            jsx("div", {
                                className: STYLES.catalogEntry,
                                children: jsxs("div", {
                                    className: STYLES.catalogRow,
                                    children: [
                                        jsx("input", {
                                            className: STYLES.catalogInput,
                                            type: "text",
                                            value: entry.id,
                                            placeholder: idPlaceholder,
                                            "aria-label": props.idLabel + " " + (index + 1),
                                            disabled: !writable,
                                            spellCheck: false,
                                            autoComplete: "off",
                                            autocapitalize: "off",
                                            onChange: (event: any) => {
                                                patchRow(index, "id", event && event.target ? String(event.target.value ?? "") : "");
                                            },
                                            onFocus: () => setFocused(true),
                                            onBlur: () => {
                                                setFocused(false);
                                                commit();
                                            },
                                            onKeyDown: (event: any) => {
                                                if (event && event.key === "Enter") {
                                                    setFocused(false);
                                                    commit();
                                                }
                                            }
                                        }),
                                        jsx("input", {
                                            className: STYLES.catalogInput,
                                            type: "text",
                                            value: entry.name,
                                            placeholder: namePlaceholder,
                                            "aria-label": props.nameLabel + " " + (index + 1),
                                            disabled: !writable,
                                            spellCheck: false,
                                            autoComplete: "off",
                                            onChange: (event: any) => {
                                                patchRow(index, "name", event && event.target ? String(event.target.value ?? "") : "");
                                            },
                                            onFocus: () => setFocused(true),
                                            onBlur: () => {
                                                setFocused(false);
                                                commit();
                                            },
                                            onKeyDown: (event: any) => {
                                                if (event && event.key === "Enter") {
                                                    setFocused(false);
                                                    commit();
                                                }
                                            }
                                        }),
                                        jsx("button", {
                                            type: "button",
                                            className: STYLES.iconButton + " " + STYLES.iconButtonDanger,
                                            "aria-label": props.removeLabel + " " + (index + 1),
                                            title: props.removeLabel,
                                            disabled: !writable,
                                            onClick: () => {
                                                removeRow(index);
                                            },
                                            children: jsx("svg", {
                                                width: 14,
                                                height: 14,
                                                viewBox: "0 0 16 16",
                                                fill: "none",
                                                aria: "hidden",
                                                children: jsx("path", { d: TRASH_PATH, stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round" })
                                            })
                                        })
                                    ]
                                })
                            }, index + ":" + entry.id)
                        ),
                            jsx("button", {
                                type: "button",
                                className: STYLES.addButton,
                                disabled: !writable || busy,
                                onClick: addRow,
                                children: props.addLabel
                            })
                        ]
                    })
                ]
            })
        ]
    });
}
