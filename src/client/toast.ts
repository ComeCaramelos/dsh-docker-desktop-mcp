/**
 * Browser half — the failure-toast host.
 *
 * Subscribes directly to the controller store and mounts through
 * `react-dom/client` in its own body-level root, because the card slot only
 * renders while Settings is open — a discovery failure at boot must be visible
 * without the user navigating there. The Toast primitive portals itself to the
 * document body, and it dismisses on its own timer.
 */

/// <reference path="./shell-modules.d.ts" />
import * as react from "react";
import { jsx } from "react/jsx-runtime";
import { IconWarningOutline16, Toast } from "@deepseek-ai/dsh-client-ui-primitives";

/**
 * Render one pending notice, or nothing.
 * @param props - the controller store, the locale translator, and `clearNotice`.
 * @returns the toast element, or null while no notice is staged.
 */
export function DockerMcpToastHost(props: any): any {
    var snapshot: any = react.useSyncExternalStore(props.store.subscribe, props.store.getSnapshot);
    var notice = snapshot.notice === null || snapshot.notice === void 0 ? null : snapshot.notice;
    if (notice === null) return null;
    return jsx(
        Toast,
        {
            text: notice.kind === "error" ? notice.text : props.t("statusUnreachable"),
            icon: jsx(IconWarningOutline16, {}),
            onDone: () => {
                props.clearNotice(notice.seq);
            }
        },
        notice.seq
    );
}
