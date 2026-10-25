/**
 * Executable-candidate discovery — the source behind the Web card's executable
 * catalog refresh (the counterpart of `docker mcp profile list` for profiles).
 *
 * Nothing spawns: every candidate is a filesystem probe (`X_OK`), so a refresh
 * costs a handful of `fs.accessSync` calls and never touches the gateway. The
 * precedence mirrors {@link resolveDockerCommand}'s WSL rewrite (the
 * Windows-side CLI the Desktop store actually needs comes first), then the
 * canonical install locations per platform, then the bare `PATH` names.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
    EXECUTABLE_PATH_CANDIDATES_DARWIN,
    EXECUTABLE_PATH_CANDIDATES_LINUX,
    EXECUTABLE_PATH_CANDIDATES_WIN32,
    EXECUTABLE_PATH_NAMES
} from "./constants.js";
import { wslDockerCommandCandidates } from "./docker.js";
import { isSmokeFixturePath } from "./catalog.js";
import type { ExecutableDiscoveryOptions } from "./types/index.js";

/** Absolute candidate paths for one platform (never a PATH-relative name). */
function absoluteCandidates(platform: NodeJS.Platform): string[] {
    if (platform === "win32") return [...EXECUTABLE_PATH_CANDIDATES_WIN32];
    if (platform === "darwin") return [...EXECUTABLE_PATH_CANDIDATES_DARWIN];
    return [...EXECUTABLE_PATH_CANDIDATES_LINUX];
}

/**
 * The first PATH hit for every bare candidate name — never the whole `PATH`
 * cross product: the executable catalog is a persisted list, so a refresh must
 * stay bounded to a handful of rows, not one per directory × name.
 */
function nameCandidates(
    names: readonly string[],
    platform: NodeJS.Platform,
    env: Record<string, string | undefined>
): string[] {
    const dirs: string[] = [];
    if (platform === "win32") {
        const envPath = typeof env?.Path === "string" ? env.Path : typeof env?.PATH === "string" ? env.PATH : "";
        const sep = typeof env?.Path === "string" ? ";" : envPath.includes(";") ? ";" : ":";
        for (const dir of envPath.split(sep)) {
            if (dir !== "") dirs.push(dir);
        }
    } else {
        const envPath = typeof env?.PATH === "string" ? env.PATH : "";
        for (const dir of envPath.split(":")) {
            // Linux-side PATH only; skip empty and Windows-style entries.
            if (dir === "" || dir.includes("\\")) continue;
            dirs.push(dir);
        }
    }
    const hits: string[] = [];
    for (const name of names) {
        for (const dir of dirs) {
            const joined =
                platform === "win32"
                    ? path.win32.join(dir.replace(/[\\/]$/, "") + path.win32.sep, name)
                    : path.posix.join(dir.endsWith("/") ? dir : `${dir}/`, name);
            hits.push(joined);
            break;
        }
    }
    return hits;
}

/**
 * List the docker executables present on this machine, in precedence order.
 *
 * @param options - platform/env/existence overrides for tests and diagnostics.
 * @returns existing candidate paths, de-duplicated, most-likely-correct first.
 */
export function discoverExecutables(options: ExecutableDiscoveryOptions = {}): string[] {
    const platform = options.platform === void 0 ? process.platform : options.platform;
    const env = options.env === void 0 ? process.env : options.env;
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
    const ordered = [
        // The WSL host-CLI rewrite first: on WSL that is the binary the
        // Desktop profile store actually needs.
        ...wslDockerCommandCandidates({ platform, env }),
        ...absoluteCandidates(platform),
        ...nameCandidates(EXECUTABLE_PATH_NAMES, platform, env)
    ];
    const found = new Set<string>();
    for (const candidate of ordered) {
        // Smoke fixtures are test harness, never docker installs: a `.smoke/`
        // path (even a reachable PATH directory) is skipped without probing.
        if (candidate === "" || isSmokeFixturePath(candidate) || !exists(candidate)) continue;
        found.add(candidate);
    }
    return [...found];
}
