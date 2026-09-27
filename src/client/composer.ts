/**
 * Browser half — the composer's profile pill.
 *
 * A compact Menu pill in the conversation input's tool row (the
 * `conversation.input.left` seat, the only one nobody else registers), the
 * same shape the shell's own mode/model pills use: trigger + dropdown over the
 * saved rows. It is the card's profile selector read through the SAME store —
 * same snapshot, same writes, same option rules — not a second subscription,
 * so a Refresh performed anywhere is visible here instantly.
 *
 * The pill renders only while the namespace is served (the card stays quiet
 * for the same reason) and only writes through `controller.selectProfile`, so
 * the host's precedence, validation and fiber update stay untouched. It is
 * led by the Docker mark — the mark lives ONLY here: every other surface
 * (Settings card, dropdown) stays icon-free. The trigger's tooltip is the
 * plugin's own name (`composerTitle`), never the running profile — the label
 * inside the pill is what tracks the selection.
 */

/// <reference path="./shell-modules.d.ts" />
import * as react from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import STYLES from "./styles/DockerMcpCard.module.css";
import { CHEVRON_PATH, DOCKER_PATHS } from "./card/icons.js";
import { describeCard, profileLabel } from "./card/view.js";

/**
 * Render the composer profile pill.
 * @param props - locale copy (`t`), the shared snapshot hook
 *   (`useDockerMcpCard`) and the controller's profile writer (`selectProfile`).
 * @returns the pill, or nothing while the namespace is not served.
 */
export function DockerMcpProfilePill(props: any): any {
    var t = props.t;
    var state = props.useDockerMcpCard((snapshot: any) => snapshot);
    var menuState = react.useState(false);
    var menuOpen = menuState[0];
    var setMenuOpen = menuState[1];
    if (!state.available) return null;

    var view = describeCard(state);
    var options = view.profileOptionIds.map((id: string) => ({ id: id, label: profileLabel(view, id) }));

    return jsx("span", {
        className: STYLES.composerPillRoot,
        children: jsx(Menu, {
            open: menuOpen,
            onClose: () => {
                setMenuOpen(false);
            },
            items: options,
            selectedId: state.profile,
            onSelect: (id: string) => {
                setMenuOpen(false);
                if (id === state.profile) return;
                if (typeof props.selectProfile !== "function") return;
                Promise.resolve(props.selectProfile(id)).catch(() => {});
            },
            align: "start",
            side: "top",
            portal: true,
            anchor: jsxs("button", {
                type: "button",
                className: STYLES.composerPill,
                "aria-label": t("composerAria", { name: profileLabel(view, state.profile) }),
                title: t("composerTitle"),
                "aria-haspopup": "menu",
                "aria-expanded": menuOpen,
                disabled: !state.writable,
                onClick: () => {
                    setMenuOpen(!menuOpen);
                },
                children: [
                    jsx("span", {
                        className: STYLES.composerPillIcon,
                        "aria-hidden": true,
                        children: jsx("svg", {
                            width: 14,
                            height: 14,
                            viewBox: "0 0 24 24",
                            fill: "none",
                            xmlns: "http://www.w3.org/2000/svg",
                            children: DOCKER_PATHS.map((d, at) => jsx("path", { d: d, stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, at))
                        })
                    }),
                    jsx("span", { className: STYLES.composerPillLabel, children: profileLabel(view, state.profile) }),
                    jsx("span", {
                        className: STYLES.composerPillChevron + (menuOpen ? " " + STYLES.composerPillChevronOpen : ""),
                        "aria-hidden": true,
                        children: jsx("svg", {
                            width: 14,
                            height: 14,
                            viewBox: "0 0 14 14",
                            fill: "none",
                            xmlns: "http://www.w3.org/2000/svg",
                            children: jsx("path", { d: CHEVRON_PATH, fill: "currentColor" })
                        })
                    })
                ]
            })
        })
    });
}
