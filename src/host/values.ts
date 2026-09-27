/**
 * Settings reads and value resolution.
 *
 * The precedence rules that decide what the gateway actually connects with —
 * user layer over env var over row config — live here, together with the
 * helpers that pull the persisted user layer back out of the settings service
 * before the first spawn (a cold start reconnect must come up on the last UI
 * selection, not on the row default).
 */
import type { GatewayStderrMode, PluginContext } from "./types/index.js";
import { PROFILE_PATTERN, SETTINGS_NAMESPACE } from "./constants.js";
import { resolveDockerCommand } from "./docker.js";

/**
 * Resolve the base (pre-UI) profile for one run.
 * @param configured - the row config `profile` value.
 * @param envValue - `DSH_DOCKER_MCP_PROFILE` as seen in the launch env.
 * @returns the env value when it is a valid profile id, else the configured one.
 */
export function resolveBaseProfile(configured: string, envValue?: unknown): string {
    if (typeof envValue === "string" && envValue !== "" && PROFILE_PATTERN.test(envValue)) return envValue;
    return configured;
}

/**
 * Resolve the executable actually in use for one (UI override, row config)
 * pair. An explicit override wins verbatim (paths are not rewritten); an
 * empty override falls back to {@link resolveDockerCommand} of the row-config
 * command, so the WSL host-path rewrite applies only to the literal default.
 * @param override - the persisted `command` user field, or "" when unset.
 * @param configuredCommand - the row-config `command`.
 */
export function resolveEffectiveCommand(override: unknown, configuredCommand: string): string {
    const o = typeof override === "string" ? override.trim() : "";
    return resolveDockerCommand(o !== "" ? o : configuredCommand);
}

/**
 * Resolve the effective gateway-stderr mode: the persisted UI toggle
 * (`stderrMode`) wins when set; otherwise the row-config `gatewayStderr`. An
 * invalid/empty override falls back to the row config.
 * @param override - persisted `stderrMode` value, or "".
 * @param rowDefault - the validated row-config `gatewayStderr` ("log"/"console").
 * @returns "log" | "console".
 */
export function resolveStderrMode(override: unknown, rowDefault: unknown): GatewayStderrMode {
    if (override === "log" || override === "console") return override;
    return rowDefault === "console" ? "console" : "log";
}

/** The section object this plugin authored in the settings document, or
 * `undefined` when the service is not up/section absent. */
function userSection(ctx: PluginContext): Record<string, any> | undefined {
    try {
        const settings = ctx.get("settings");
        const section = settings?.document?.[SETTINGS_NAMESPACE];
        if (section === null || typeof section !== "object" || Array.isArray(section)) return void 0;
        return section;
    } catch {
        // settings service not available yet — every caller falls back to its
        // row-config/env resolution, and the installSection initial onChange
        // applies the persisted selection in place.
        return void 0;
    }
}

/**
 * Read the last UI-selected profile from the persisted user layer when the
 * settings service is already up and the stored value is a valid profile id.
 * The host consults this before spawning the gateway so the very first
 * connection runs with the persisted selection — and every in-process
 * reconnect, which reuses the bridge config, comes back on it as well.
 * @param ctx - plugin context.
 * @returns the persisted profile id, or undefined when absent, invalid, or the settings service is not available yet (the installSection initial onChange then applies the persisted selection in place).
 */
export function readPersistedProfile(ctx: PluginContext): string | undefined {
    const section = userSection(ctx);
    if (section === void 0) return void 0;
    const value = section.profile;
    if (typeof value === "string" && PROFILE_PATTERN.test(value)) return value;
    return void 0;
}

/**
 * Read the last UI-selected executable override from the persisted user layer
 * when the settings service is already up. Empty/absent means "auto-resolve".
 * @param ctx - plugin context.
 * @returns the persisted command string, or "" when unset/invalid/not ready.
 */
export function readPersistedCommand(ctx: PluginContext): string {
    const section = userSection(ctx);
    if (section === void 0) return "";
    const value = section.command;
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    return "";
}

/**
 * Read the last UI "Reduce log output" selection from the persisted user
 * layer when the settings service is already up. Empty/absent/invalid means
 * "follow the row config".
 * @param ctx - plugin context.
 * @returns "log" | "console" when explicitly set, "" otherwise.
 */
export function readPersistedStderrMode(ctx: PluginContext): "" | GatewayStderrMode {
    const section = userSection(ctx);
    if (section === void 0) return "";
    const value = section.stderrMode;
    if (value === "log" || value === "console") return value;
    return "";
}
