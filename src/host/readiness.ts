/**
 * Gateway cold-start readiness.
 *
 * Upstream `pkg/oauth.NotificationMonitor` dials the Docker Desktop backend
 * API socket once and never retries, so a spawn while it is not listening
 * strands the OAuth stream for the whole session. The first gateway spawn
 * therefore waits — bounded, never stalling and never throwing — for the
 * point where spawning is safe.
 */
import { spawn } from "node:child_process";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { scrubbedParentEnv } from "@deepseek-ai/dsh-subprocess";
import { BACKEND_API_CONNECT_TIMEOUT_MS, GATEWAY_READY_POLL_MS, GATEWAY_READY_TIMEOUT_MS } from "./constants.js";
import type { GatewayReadyOptions, GatewayReadyState, SocketProbeState } from "./types/index.js";

/**
 * Platform mirror of the Docker Desktop backend API socket the gateway OAuth
 * notification monitor dials (the upstream
 * `pkg/desktop.Paths().BackendSocket`).
 * @param platform - platform identifier, defaults to `process.platform`.
 * @param homedir - home directory used by the user-level socket variant.
 * @returns candidate socket paths; empty for platforms with no known socket
 * location, which never wait.
 */
export function backendApiSocketPaths(platform = process.platform, homedir = os.homedir()): string[] {
    if (platform === "win32") return ["\\\\.\\pipe\\dockerBackendApiServer"];
    if (platform === "linux") return ["/run/host-services/backend.sock", path.join(homedir, ".docker", "desktop", "backend.sock")];
    return [];
}

/**
 * One `connect(2)` attempt against a single socket path.
 * @param socketPath - unix socket or Windows named pipe path.
 * @returns `"connected"` when accepted, `"absent"` when no socket exists at
 * the path, and `"closed"` for every other failure (including a path that
 * exists but is not accepting connections).
 */
export function probeBackendApiSocket(socketPath: string): Promise<SocketProbeState> {
    return new Promise((resolve) => {
        let settled = false;
        let socket: net.Socket;
        try {
            socket = net.connect({ path: socketPath });
        } catch {
            resolve("closed");
            return;
        }
        const settle = (state: SocketProbeState) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(state);
        };
        socket.setTimeout(BACKEND_API_CONNECT_TIMEOUT_MS, () => settle("closed"));
        socket.once("connect", () => settle("connected"));
        socket.once("error", (error: NodeJS.ErrnoException) => settle(error && error.code === "ENOENT" ? "absent" : "closed"));
    });
}

/**
 * Daemon-reachability fallback: the `docker version` subprocess exit code.
 * @param command - docker executable from row config.
 * @returns whether the daemon answered within the subprocess timeout.
 */
export function dockerDaemonResponds(command: string): Promise<boolean> {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(command, ["version", "--format", "{{.Server.Version}}"], {
                env: scrubbedParentEnv(),
                stdio: ["ignore", "ignore", "ignore"],
                timeout: 5000
            });
        } catch {
            resolve(false);
            return;
        }
        child.once("error", () => resolve(false));
        child.once("close", (code) => resolve(code === 0));
    });
}

/**
 * Bounded wait for the point where starting the gateway is safe: the backend
 * API socket answers (a Desktop that is still booting will listen within
 * the cap), or it is absent everywhere while the daemon still answers
 * (plain Docker CE has no backend API to wait for).
 * @param command - docker executable from row config.
 * @param options - poll/timeout/paths overrides for tests and diagnostics.
 * @returns `"ready"` (safe to spawn), `"no-backend-api"` (nothing to wait
 * for), or `"timed-out"` (spawn anyway, with a warning).
 */
export async function waitForGatewayReady(command: string, options: GatewayReadyOptions = {}): Promise<GatewayReadyState> {
    const startedAt = Date.now();
    for (;;) {
        if (options.shouldStop === void 0 ? void 0 : options.shouldStop()) return "ready";
        const paths = options.paths === void 0 ? backendApiSocketPaths() : options.paths;
        if (paths.length === 0) return "ready";
        const probes = await Promise.all(paths.map(probeBackendApiSocket));
        if (probes.includes("connected")) return "ready";
        if (!probes.includes("closed") && await dockerDaemonResponds(command)) return "no-backend-api";
        if (Date.now() - startedAt >= (options.timeoutMs === void 0 ? GATEWAY_READY_TIMEOUT_MS : options.timeoutMs)) return "timed-out";
        await new Promise((resolve) => setTimeout(resolve, options.pollMs === void 0 ? GATEWAY_READY_POLL_MS : options.pollMs));
    }
}
