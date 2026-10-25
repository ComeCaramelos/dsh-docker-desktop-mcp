/**
 * Migration — translating a **standalone** row config into a connection (D4).
 *
 * Before this component existed, the row *was* the connection: `profile`,
 * `dockerPath`, `stderrMode` and the rest of the spawn config steered a bridge
 * this plugin started itself. That bridge is gone, so an installed row would
 * quietly stop running anything unless it is said what its configuration means
 * now — which is exactly one `docker-profile` connection.
 *
 * Two rules keep the step honest:
 *
 * - **Nothing lands in `servers` without a click.** The proposal is the offer;
 *   writing is the person's. So detection only *proposes*, and the row's config
 *   is read, never rewritten.
 * - **A dismissal is this row's own state.** `migrationDismissed` is a field of
 *   the row's `Config`, not a hidden marker and not something the connection
 *   carries — because what was turned down is *this row's* configuration, and
 *   another component's entry has no business remembering it.
 *
 * A row that already carries a `docker-profile` connection is not offered
 * anything: the manager filters standing proposals by the kind they would create
 * anyway, so an accepted offer disappears without this module noticing.
 */
import { ENTRY_ID, KIND_FIELDS, KIND_ID, MIGRATION_DISMISSED_FIELD } from "./constants.js";
import { readConfigField } from "./values.js";
import { resolveDockerCommand } from "./docker.js";
import type { McpProposal } from "@comecaramelos/dsh-mcp-manager/api";
import type { Controller } from "./controller/index.js";
import type { DockerMcpConfig } from "./types/index.js";

/**
 * Whether one row config is still what a standalone install steered a bridge
 * with. Anything that differs from the shipped defaults counts: a chosen
 * profile, a picked executable, a non-default command or gateway executable
 * name, a stderr mode, extra arguments, or a bridge passthrough (`env`, `cwd`,
 * a timeout, a reconnect policy) the defaults do not answer with.
 * @param config - the config `apply` validated.
 */
export function carriesStandaloneConfig(config: DockerMcpConfig): boolean {
    const touched = (value: string): boolean => value.trim() !== "";
    if (touched(config.profile) && config.profile.trim() !== "default") return true;
    if (touched(config.dockerPath)) return true;
    if (touched(config.stderrMode)) return true;
    if (config.command.trim() !== "" && config.command.trim() !== "docker") return true;
    if (config.serverName.trim() !== "" && config.serverName.trim() !== "docker") return true;
    if (config.extraArgs.length > 0) return true;
    if (Object.keys(config.env).length > 0) return true;
    if (config.cwd.trim() !== "") return true;
    if (config.toolCallTimeoutMs !== 60000 || config.failOnStartupError) return true;
    const reconnect = config.reconnect;
    if (!reconnect.enabled || reconnect.initialDelayMs !== 500 || reconnect.maxDelayMs !== 30000 || reconnect.maxAttempts !== 10) return true;
    return false;
}

/** Whether this row has already been offered a translation and turned it down. */
export function migrationDismissed(controller: Controller): boolean {
    return readConfigField(controller.config[MIGRATION_DISMISSED_FIELD], false) === true;
}

/**
 * The connection one standalone row config translates into — or `undefined`,
 * when there is nothing to translate or it has already been refused.
 *
 * The identity carries the namespace across: `id` is what
 * `docker mcp gateway run --profile` is reached through and what every tool is
 * named under, so reusing the old `serverName` (default `"docker"`) keeps the
 * tool names exactly what they were. The machine half (the two catalogs) is
 * deliberately *not* translated: it stays in this row and feeds the picker.
 * @param controller - the live state the row config is read through.
 */
export function standaloneProposal(controller: Controller): McpProposal | undefined {
    const config = controller.config;
    if (migrationDismissed(controller)) return void 0;
    if (!carriesStandaloneConfig(config)) return void 0;
    const profile = config.profile.trim() === "" ? "default" : config.profile.trim();
    const dockerPath = config.dockerPath.trim();
    const id = config.serverName.trim() === "" ? "docker" : config.serverName.trim();
    const extra: Record<string, string> = { [KIND_FIELDS.profile]: profile };
    if (dockerPath !== "") extra[KIND_FIELDS.dockerPath] = dockerPath;
    if (config.stderrMode === "log" || config.stderrMode === "console") extra[KIND_FIELDS.stderrMode] = config.stderrMode;
    return {
        id: `${ENTRY_ID}-standalone`,
        title: `Turn this row's configuration into a Docker MCP Toolkit connection (profile "${profile}"${dockerPath === "" ? "" : `, ${dockerPath}`})`,
        entry: {
            id,
            kind: KIND_ID,
            enabled: true,
            label: "Docker MCP Toolkit",
            extra
        },
        /** The person said no: remembered here, in this row, and nowhere else.
         * Nothing is removed from the config, because the config is what the
         * row still says. */
        onDismiss: () => controller.dismissMigration()
    };
}

/** One line naming what the translation runs against — for the log. */
export function describeStandalone(config: DockerMcpConfig): string {
    const profile = config.profile.trim() === "" ? "default" : config.profile.trim();
    const command = config.dockerPath.trim() === "" ? resolveDockerCommand(config.command) : config.dockerPath.trim();
    return `profile "${profile}" via "${command}"`;
}
