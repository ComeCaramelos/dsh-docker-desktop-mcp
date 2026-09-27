/**
 * Docker MCP profile discovery.
 *
 * `docker mcp profile list --format json` is the source of truth for the
 * selector: the ids it reports drive the `--profile` argument, the Web card's
 * options and the `/docker-profile` usage listing. The parser is deliberately
 * tolerant so a CLI-version drift degrades to "no profiles" instead of
 * crashing the host.
 */
import { spawn } from "node:child_process";
import { scrubbedParentEnv } from "@deepseek-ai/dsh-subprocess";
import { DISCOVERY_TIMEOUT_MS } from "./constants.js";

/**
 * Spawn `docker mcp profile list --format json` and return the discovered
 * profile ids. Fails when the CLI lacks the profiles feature; the caller
 * keeps the reason in the in-memory base layer (`lastRefreshError`).
 */
export function listProfiles(command: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, ["mcp", "profile", "list", "--format", "json"], {
            env: scrubbedParentEnv(),
            stdio: ["ignore", "pipe", "pipe"],
            timeout: DISCOVERY_TIMEOUT_MS,
            killSignal: "SIGKILL"
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("error", (error) => {
            reject(new Error(`could not run "${command} mcp profile list": ${error.message}`));
        });
        child.on("close", (code) => {
            if (code === null) {
                reject(new Error(`"${command} mcp profile list" timed out after ${DISCOVERY_TIMEOUT_MS}ms`));
                return;
            }
            if (code !== 0) {
                let detail =
                    (stderr || stdout).trim().split(/\r?\n/u).find((line) => line.trim() !== "") ?? `exit code ${String(code)}`;
                if (/unknown (flag|command)/u.test(detail)) {
                    detail += " — enable the profiles feature first (docker mcp feature enable profiles, or the MCPWorkingSets flag in Docker Desktop)";
                }
                reject(new Error(`"${command} mcp profile list" failed: ${detail.slice(0, 240)}`));
                return;
            }
            try {
                resolve(extractProfileIds(stdout));
            } catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    });
}

/**
 * Tolerant parse of `docker mcp profile list --format json`: accepts a bare
 * array, or an object wrapping the array under a common key (profiles /
 * items / data / results / first array value). Entries are ids when strings,
 * else their id / profileID / profileId / name field.
 */
export function extractProfileIds(stdout: unknown): string[] {
    const text = String(stdout ?? "").trim();
    if (text === "") return [];
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed)
        ? parsed
        : typeof parsed === "object" && parsed !== null
            ? Array.isArray(parsed.profiles)
                ? parsed.profiles
                : Object.values(parsed).find((value) => Array.isArray(value)) ?? []
            : [];
    const ids: string[] = [];
    for (const item of items) {
        if (typeof item === "string" && item !== "") {
            ids.push(item);
            continue;
        }
        if (typeof item === "object" && item !== null) {
            const id = item.id ?? item.profileID ?? item.profileId ?? item.name;
            if (typeof id === "string" && id !== "") ids.push(id);
        }
    }
    return [...new Set(ids)];
}
