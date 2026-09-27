/**
 * Cold-start readiness shapes — the bounded wait the controller runs before the
 * first gateway spawn (see ./readiness.ts).
 */

/** Backend-API socket probe result of one `connect(2)` attempt. */
export type SocketProbeState = "connected" | "absent" | "closed";

/** Outcome of the bounded gateway-readiness wait. */
export type GatewayReadyState = "ready" | "no-backend-api" | "timed-out";

/** Options for {@link waitForGatewayReady}. */
export type GatewayReadyOptions = {
    paths?: readonly string[];
    pollMs?: number;
    timeoutMs?: number;
    shouldStop?: () => boolean;
};
