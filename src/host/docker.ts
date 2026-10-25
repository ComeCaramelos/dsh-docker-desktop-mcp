/**
 * Docker CLI target resolution — the WSL + Docker Desktop case.
 *
 * Docker Desktop keeps its MCP profiles in the Windows-side store
 * (`%USERPROFILE%\.docker\mcp`) while the Linux `docker` CLI reads the
 * (usually empty) `~/.docker/mcp`, so on WSL the literal `docker` default
 * would discover nothing and spawn a gateway that cannot see any profile. The
 * rewrite applies to the literal default only — a row-config `command` is
 * always honoured verbatim.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { WSL_DOCKER_HOST_COMMAND, WSL_DOCKER_PATH_CANDIDATE } from "./constants.js";
import type { WslDockerOptions } from "./types/index.js";

/**
 * Candidate Windows-side CLI paths, in precedence order: the canonical
 * {@link WSL_DOCKER_HOST_COMMAND} first, then `docker.exe` resolved through
 * `PATH` (from `options.env` when given, else `process.env`).
 * @param options - env override for tests and diagnostics.
 * @returns ordered, de-duplicated candidate paths.
 */
export function wslDockerCommandCandidates(options: WslDockerOptions): string[] {
    const candidates = new Set([WSL_DOCKER_HOST_COMMAND]);
    const env = options.env === void 0 ? process.env : options.env;
    const envPath = typeof env?.PATH === "string" ? env.PATH : "";
    for (const dir of envPath.split(":")) {
        // Linux-side PATH only; skip empty and Windows-style entries so the
        // join below never produces junk paths.
        if (dir === "" || dir.includes("\\")) continue;
        candidates.add(path.posix.join(dir.endsWith("/") ? dir : `${dir}/`, WSL_DOCKER_PATH_CANDIDATE));
    }
    return [...candidates];
}

/**
 * Resolve the gateway executable. A row-config `command` always wins; only
 * the literal default `"docker"` is rewritten — on linux to the first
 * existing Windows-side CLI (the canonical
 * {@link WSL_DOCKER_HOST_COMMAND}, else a `docker.exe` found on `PATH`) —
 * so discovery and the gateway target the Docker Desktop (Windows-side) MCP
 * store instead of the empty Linux-side one. Set `command` explicitly
 * (absolute path) to keep a Linux CLI running inside WSL.
 * @param configured - row-config command.
 * @param options - platform/env/existence overrides for tests and diagnostics.
 * @returns the executable to spawn.
 */
export function resolveDockerCommand(configured: string, options: WslDockerOptions = {}): string {
    if (configured !== "docker") return configured;
    const platform = options.platform === void 0 ? process.platform : options.platform;
    if (platform !== "linux") return configured;
    const exists =
        options.exists === void 0
            ? (candidate: string) => {
                  try {
                      fs.accessSync(candidate, fs.constants.X_OK);
                      return true;
                  } catch {
                      return false;
                  }
              }
            : options.exists;
    for (const candidate of wslDockerCommandCandidates(options)) {
        if (exists(candidate)) return candidate;
    }
    return configured;
}
