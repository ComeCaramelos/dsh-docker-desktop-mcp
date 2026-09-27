/**
 * The fetch dialog — the "choose which ids to add" modal both fetch actions
 * open once the host run finished.
 *
 * One checkbox row per detected id, already-saved ids carried pre-checked (and
 * disabled — removal is the row list's delete button, never a dialog side
 * effect), a search field to sift long path lists, and a footer whose "Add
 * selected" merges the checked ids into the saved rows. Nothing here persists
 * on its own: closing with Cancel or the header X leaves the catalog untouched.
 */
import * as react from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import STYLES from "../styles/DockerMcpCard.module.css";
import { CLOSE_PATHS } from "./icons.js";

/**
 * Candidate ids arrive from the fetch that opened the dialog (the controller's
 * detected list); the dialog itself is stateless besides its filter/selection
 * draft, so a re-render of the card cannot disturb the draft.
 */
export function CandidateDialog(props: any): any {
    var t = props.t;
    var candidates: string[] = props.candidates;
    var savedIds: string[] = props.savedIds;
    var savedSet = new Set(savedIds);
    var initialChecked = candidates.filter((id: string) => savedSet.has(id));
    // The dialog is mounted over a fetch that just landed; one keyed draft
    // object holds the filter + selection so a new candidate list resets the
    // whole draft (the served-sync idiom of the row list, but for a whole
    // session's worth of edits — nothing may bleed from a previous dialog).
    var servedKey = JSON.stringify(candidates) + "|" + JSON.stringify(savedIds);
    var draftState = react.useState({ key: "", query: "", checked: [] as string[] });
    var draft = draftState[0];
    var setDraft = draftState[1];
    var dirty = draft.key !== servedKey;
    var query = dirty ? "" : draft.query;
    var checked = dirty ? initialChecked : draft.checked;
    var checkedSet = new Set(checked);
    var setQuery = (value: string) => {
        setDraft({ key: servedKey, query: value, checked: Array.from(checkedSet) });
    };
    var setChecked = (make: (current: string[]) => string[]) => {
        setDraft({ key: servedKey, query: query, checked: make(checked) });
    };
    var needle = query.trim().toLowerCase();
    var shown = needle === "" ? candidates : candidates.filter((id: string) => id.toLowerCase().indexOf(needle) !== -1);
    var addable = shown.filter((id: string) => !savedSet.has(id));
    var allChecked = addable.length > 0 && addable.every((id: string) => checkedSet.has(id));

    var toggle = (id: string, value: boolean) => {
        setChecked((current: string[]) => (value ? current.concat([id]) : current.filter((entry: string) => entry !== id)));
    };

    return jsxs("div", {
        className: STYLES.fetchDialog,
        role: "dialog",
        "aria-modal": "true",
        "aria-label": props.title,
        children: [
            jsxs("div", {
                className: STYLES.dialogContent,
                children: [
                    jsxs("div", {
                        className: STYLES.dialogHeader,
                        children: [
                            jsx("h2", { className: STYLES.dialogTitle, children: props.title }),
                            jsx("button", {
                                type: "button",
                                className: STYLES.dialogClose,
                                "aria-label": t("close"),
                                onClick: () => props.onClose(),
                                children: jsx("svg", {
                                    width: 14,
                                    height: 14,
                                    viewBox: "0 0 16 16",
                                    fill: "none",
                                    xmlns: "http://www.w3.org/2000/svg",
                                    "aria-hidden": "true",
                                    children: CLOSE_PATHS.map((d: string, at: number) => jsx("path", { d: d, fill: "currentColor" }, at))
                                })
                            })
                        ]
                    }),
                    jsx("p", { className: STYLES.dialogDescription, children: props.description }),
                    jsxs("div", {
                        className: STYLES.dialogBody,
                        children: [
                            jsxs("div", {
                                className: STYLES.candidateToolbar,
                                children: [
                                    jsx("input", {
                                        className: STYLES.candidateSearch,
                                        type: "search",
                                        placeholder: props.searchPlaceholder,
                                        "aria-label": props.searchPlaceholder,
                                        value: query,
                                        onChange: (event: any) => {
                                            setQuery(event && event.target ? String(event.target.value ?? "") : "");
                                        }
                                    }),
                                    jsx("button", {
                                        type: "button",
                                        className: STYLES.linkButton,
                                        onClick: () => {
                                            if (allChecked) setChecked(() => []);
                                            else setChecked((current: string[]) => Array.from(new Set(current.concat(addable))));
                                        },
                                        children: t("selectAll")
                                    })
                                ]
                            }),
                            shown.length === 0
                                ? jsx("p", { className: STYLES.empty, children: t("dialogEmpty") })
                                : jsx("ul", {
                                      className: STYLES.candidateList,
                                      children: shown.map((id: string) => {
                                          var isSaved = savedSet.has(id);
                                          return jsx("li", {
                                              className: STYLES.candidate,
                                              children: jsxs("label", {
                                                  className: STYLES.candidateLabel,
                                                  children: [
                                                      jsx("input", {
                                                          type: "checkbox",
                                                          checked: isSaved ? true : checkedSet.has(id),
                                                          disabled: isSaved,
                                                          onChange: (event: any) => {
                                                              toggle(id, !!(event && event.target && event.target.checked));
                                                          }
                                                      }),
                                                      jsx("span", { className: STYLES.candidateId, children: id }),
                                                      isSaved ? jsx("span", { className: STYLES.candidateNote, children: t("candidateSaved") }) : null
                                                  ]
                                              })
                                          }, id);
                                      })
                                  })
                        ]
                    }),
                    jsxs("div", {
                        className: STYLES.dialogFooter,
                        children: [
                            jsx("button", {
                                type: "button",
                                className: STYLES.dialogButton,
                                onClick: () => props.onClose(),
                                children: t("cancel")
                            }),
                            jsx("button", {
                                type: "button",
                                className: STYLES.dialogButton + " " + STYLES.dialogButtonPrimary,
                                onClick: () => props.onAdd(Array.from(checkedSet)),
                                children: t("addSelected")
                            })
                        ]
                    })
                ]
            })
        ]
    });
}
