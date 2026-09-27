/**
 * Browser half — the profile card widget.
 *
 * Registers one card into the shared `settings.plugin.item` slot (Settings →
 * Plugins → Plugin configuration), keyed by the `docker-desktop-mcp` settings
 * namespace the host half serves. The card carries the two named selectors the
 * gateway actually runs with — the profile and the docker executable — each one
 * a Menu pill plus an editable catalog underneath, the same shape the stock
 * provider-models card uses: a row per entry (id + the custom name the user
 * chose for the UI), a delete button, an "add" button and a fetch link button.
 * Nothing here has an advanced-options disclosure: an entry is id + name, and
 * that is all the host needs. Collapsible like the stock plugin cards: closed
 * by default, with the header as its disclosure button.
 *
 * Sections it assembles:
 *
 *   ./view.ts      what one served snapshot means (options, labels, the dot)
 *   ./picker.ts    one named picker: pill + saved-row catalog
 *   ./toggle.ts    the "Reduce log output" catalog block
 *   ./dialog.ts    the choose-to-add modal a fetch opens
 *   ./icons.ts     the icon paths the shell primitives do not carry
 */

/// <reference path="../shell-modules.d.ts" />
import * as react from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import type { CatalogEntry, CatalogKind } from "../catalog.js";
import STYLES from "../styles/DockerMcpCard.module.css";
import { CandidateDialog } from "./dialog.js";
import { CHEVRON_PATH } from "./icons.js";
import { CatalogPicker } from "./picker.js";
import { LogOutputToggle } from "./toggle.js";
import { describeCard, executableLabel } from "./view.js";

/**
 * Render the profile card.
 * @param props - locale copy (`t`), the snapshot hook (`useDockerMcpCard`), and
 *   the controller's actions.
 * @returns the card, or nothing until the namespace is served.
 */
export function DockerMcpCard(props: any): any {
    var t = props.t;
    var state = props.useDockerMcpCard((snapshot: any) => snapshot);
    var executableMenuState = react.useState(false);
    var executableMenuOpen = executableMenuState[0];
    var setExecutableMenuOpen = executableMenuState[1];
    var openState = react.useState(false);
    var open = openState[0];
    var setOpen = openState[1];
    var refreshingState = react.useState(false);
    var isRefreshing = refreshingState[0];
    var setRefreshing = refreshingState[1];
    var dialogRef = react.useState<{ kind: CatalogKind; ids: string[] } | null>(null);
    var dialog = dialogRef[0];
    var setDialog = dialogRef[1];
    var bodyId = react.useId();
    if (!state.available) return null;

    var view = describeCard(state);
    var error = view.error;
    var profileEntries = view.profileEntries;
    var executableEntries = view.executableEntries;
    var executableOptions = view.executableOptionIds;
    var missing = view.missing;
    var dotLabel = view.dotIsError ? error : t("statusMissing");
    var dotAria = view.dotIsError ? t("statusError") : t("statusMissing");

    // The two fetch actions share one busy flag and hand their resolved
    // candidate ids to the dialog. A run that found nothing leaves the card
    // exactly as it was — a failed discovery announces itself through the
    // toast host, and an empty list has nothing to select — so the dialog
    // opens only when there are candidates.
    var runFetch = (kind: CatalogKind, fetch: () => Promise<string[]>) => {
        setRefreshing(true);
        var promise;
        try {
            promise = fetch();
        } catch (caught) {
            promise = Promise.reject(caught);
        }
        Promise.resolve(promise).then(
            (ids) => {
                setRefreshing(false);
                if (Array.isArray(ids) && ids.length > 0) setDialog({ kind: kind, ids: ids });
            },
            () => {
                setRefreshing(false);
            }
        );
    };

    var closeDialog = () => {
        setDialog(null);
    };

    /** "Add selected": merge the dialog's checked ids into the rows, then
     * close. The controller owns the merge rules (and skips a no-op write). */
    var addFromDialog = (ids: string[]) => {
        if (dialog === null) return;
        var kind = dialog.kind;
        setDialog(null);
        if (typeof props.addDetected === "function") {
            Promise.resolve(props.addDetected(kind, ids)).catch(() => {});
        }
    };

    return jsx("li", {
        className: STYLES.card + (open ? " " + STYLES.cardOpen : ""),
        children: [
            jsxs("button", {
                type: "button",
                className: STYLES.header,
                "aria-expanded": open,
                "aria-label": t(open ? "collapse" : "expand") + ": " + t("title"),
                "aria-controls": bodyId,
                onClick: () => {
                    setOpen(!open);
                },
                children: [
                    jsxs("span", {
                        className: STYLES.headText,
                        children: [
                            jsxs("div", {
                                className: STYLES.nameRow,
                                children: [
                                    jsx("span", { className: STYLES.name, children: t("title") }),
                                    error !== "" || missing
                                        ? jsx("span", {
                                              className: STYLES.dot + " " + STYLES.dotError,
                                              role: "img",
                                              "aria-label": dotAria,
                                              title: dotLabel
                                          })
                                        : null
                                ]
                            }),
                            jsx("span", { className: STYLES.desc, children: t("description") })
                        ]
                    }),
                    jsx("svg", {
                        width: 14,
                        height: 14,
                        className: STYLES.chevron + (open ? " " + STYLES.chevronOpen : ""),
                        viewBox: "0 0 14 14",
                        fill: "none",
                        xmlns: "http://www.w3.org/2000/svg",
                        children: jsx("path", { d: CHEVRON_PATH, fill: "currentColor" })
                    })
                ]
            }),
            open
                ? jsxs("div", {
                      id: bodyId,
                      className: STYLES.body,
                      children: [
                          !state.writable
                              ? jsx("p", { className: STYLES.readOnly, role: "status", children: t("readOnly") })
                              : null,
                          jsx(CatalogPicker, {
                              t: t,
                              kind: "executables",
                              rowsLabel: t("executableRows"),
                              emptyText: t("executableEmpty"),
                              selectorLabel: t("executableLabel"),
                              hint: t("executableHint"),
                              idLabel: t("executableIdLabel"),
                              nameLabel: t("executableNameLabel"),
                              removeLabel: t("removeExecutable"),
                              addLabel: t("addExecutable"),
                              refreshLabel: isRefreshing ? t("fetching") : t("fetchExecutables"),
                              busyLabel: t("fetching"),
                              busy: isRefreshing,
                              entries: executableEntries,
                              options: executableOptions.map((id: string) => ({ id: id, label: executableLabel(view, id) })),
                              selectedId: state.effectiveCommand,
                              selectedLabel: executableLabel(view, state.effectiveCommand),
                              writable: state.writable,
                              menuOpen: executableMenuOpen,
                              setMenuOpen: setExecutableMenuOpen,
                              select: (id: string) => {
                                  if (id === state.command) return;
                                  props.selectExecutable(id);
                              },
                              saveEntries: props.saveExecutables,
                              refresh: () => {
                                  runFetch("executables", props.refreshExecutables);
                              }
                          }),
                          jsx(CatalogPicker, {
                              t: t,
                              kind: "profiles",
                              // No selector pill here: selecting the running
                              // profile is the composer pill's job (it is the
                              // one surface reachable without opening
                              // Settings). This block only manages the saved
                              // rows the composer's dropdown offers.
                              showSelector: false,
                              rowsLabel: t("profileRows"),
                              emptyText: t("empty"),
                              selectorLabel: t("profileLabel"),
                              hint: t("hint"),
                              idLabel: t("profileIdPlaceholder"),
                              nameLabel: t("profileNamePlaceholder"),
                              removeLabel: t("removeProfile"),
                              addLabel: t("addProfile"),
                              refreshLabel: isRefreshing ? t("fetching") : t("fetchProfiles"),
                              busyLabel: t("fetching"),
                              busy: isRefreshing,
                              entries: profileEntries,
                              writable: state.writable,
                              saveEntries: props.saveProfileEntries,
                              refresh: () => {
                                  runFetch("profiles", props.refreshProfiles);
                              }
                          }),
                          jsx(LogOutputToggle, {
                              t: t,
                              checked: view.reduceChecked,
                              disabled: !state.writable,
                              onToggle: props.toggleStderr
                          }),
                          state.lastRefreshError
                              ? jsx("p", { className: STYLES.error, role: "status", children: state.lastRefreshError })
                              : null,
                          state.actionError
                              ? jsx("p", { className: STYLES.error, role: "status", children: state.actionError })
                              : null,
                          dialog !== null
                              ? jsx(CandidateDialog, {
                                    t: t,
                                    kind: dialog.kind,
                                    candidates: dialog.ids,
                                    savedIds:
                                        dialog.kind === "profiles"
                                            ? profileEntries.map((entry: CatalogEntry) => entry.id)
                                            : executableEntries.map((entry: CatalogEntry) => entry.id),
                                    title: t(dialog.kind === "profiles" ? "dialogProfilesTitle" : "dialogExecutablesTitle"),
                                    description: t(
                                        dialog.kind === "profiles" ? "dialogProfilesDescription" : "dialogExecutablesDescription"
                                    ),
                                    searchPlaceholder: t(dialog.kind === "profiles" ? "searchProfiles" : "searchExecutables"),
                                    onAdd: addFromDialog,
                                    onClose: closeDialog
                                })
                              : null
                      ]
                  })
                : null
        ]
    });
}
