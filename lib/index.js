/**
 * @comecaramelos/dsh-docker-desktop-mcp — host half.
 *
 * Connects the Docker Desktop MCP gateway (`docker mcp gateway run
 * --profile <name>`) as an MCP server through the stock
 * @deepseek-ai/dsh-mcp-client bridge, and exposes the gateway `--profile`
 * choice as a user setting: the Web GUI's Plugins settings page renders a
 * picker (see ./client.js) backed by the `docker-desktop-mcp` settings
 * namespace. Selecting a profile re-applies the nested mcp-client plugin
 * in place (fiber.update), which restarts the gateway connection with the
 * new `--profile` argument.
 *
 * Persistence boundary: only the user-authored fields land in
 * `$DSH_HOME/settings.yaml` — `profile` (the last UI selection, used to
 * connect on (re)start) and `refreshNonce` (the client→host refresh
 * trigger; a module plugin has no other host channel, `harness.handle` is
 * reserved for code-string halves). Discovery state (`profiles`,
 * `lastRefreshError`, `discoveryRevision`) rides the composition base layer
 * — served to the client inside the resolved value, held in memory, never
 * persisted.
 *
 * One plugin instance per dsh host: the settings namespace is fixed.
 *
 * Config (cordis row):
 *   serverName          tool namespace prefix          (default "docker")
 *   command             gateway executable             (default "docker")
 *   profile             row-config --profile value     (default "default")
 *   extraArgs           extra gateway args after --profile
 *   env / cwd / toolCallTimeoutMs / failOnStartupError / reconnect
 *                       passed through to dsh-mcp-client
 */
import { spawn } from "node:child_process";
import z from "@deepseek-ai/schemastery";
import * as McpClient from "@deepseek-ai/dsh-mcp-client";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { scrubbedParentEnv } from "@deepseek-ai/dsh-subprocess";

/** Cordis plugin name used by loader diagnostics. */
const name = "docker-desktop-mcp";

/** No host services of our own: the nested bridge declares `tools`. */
const inject = [];

/** Fixed settings namespace; also the client card's slot key. */
export const SETTINGS_NAMESPACE = "docker-desktop-mcp";

/** Profile ids are CLI identifiers; keep the charset shell-safe. */
const PROFILE_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** Reconnect policy passthrough; mirrors dsh-mcp-client's schema. */
const Reconnect = z.object({
	enabled: z.boolean().default(true),
	initialDelayMs: z.number().min(1).max(600000).default(500),
	maxDelayMs: z.number().min(1).max(600000).default(30000),
	maxAttempts: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(10)
});

export const Config = z.object({
	serverName: z.string().pattern(/^[A-Za-z0-9_-]{1,32}$/).default("docker"),
	command: z.string().default("docker"),
	profile: z.string().min(1).pattern(PROFILE_PATTERN).default("default"),
	extraArgs: z.array(String).default([]),
	env: z.dict(String).default({}),
	cwd: z.string().default(""),
	toolCallTimeoutMs: z.number().default(60000),
	failOnStartupError: z.boolean().default(false),
	reconnect: Reconnect
});

/**
 * User-settings section served to the Web GUI profile picker.
 *
 * Persisted (user layer in `$DSH_HOME/settings.yaml`): `profile` and
 * `refreshNonce`. Served but never persisted (composition base layer held
 * in memory by the host): `profiles`, `lastRefreshError`,
 * `discoveryRevision` — the client's refresh poll stops when the served
 * `discoveryRevision` advances past its click-time value.
 */
export const SettingsSchema = z.object({
	/** Active gateway --profile value; persisted last UI selection. */
	profile: z.string().min(1).pattern(PROFILE_PATTERN).default("default"),
	/** Written by the UI refresh button; the host reacts to its change. */
	refreshNonce: z.number().default(0),
	/** Profile ids discovered from `docker mcp profile list --format json`. */
	profiles: z.array(String).default([]),
	/** Last discovery failure, human-readable; empty when healthy. */
	lastRefreshError: z.string().default(""),
	/** Discovery run counter (success or failure); completion signal for the client. */
	discoveryRevision: z.number().default(0)
});

/** Timeout for one profile discovery subprocess. */
const DISCOVERY_TIMEOUT_MS = 15000;

/**
 * Spawn `docker mcp profile list --format json` and return the discovered
 * profile ids. Fails when the CLI lacks the profiles feature; the caller
 * keeps the reason in the in-memory base layer (`lastRefreshError`).
 */
export function listProfiles(command) {
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
export function extractProfileIds(stdout) {
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
	const ids = [];
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

/**
 * Build the stdio config for the nested mcp-client bridge for one profile.
 * Args keep the user's original invocation shape:
 * `docker mcp gateway run --profile <profile> [extraArgs]`.
 */
function bridgeConfig(entry, profile) {
	return {
		serverName: entry.serverName,
		transport: "stdio",
		command: entry.command,
		args: ["mcp", "gateway", "run", "--profile", profile, ...entry.extraArgs],
		env: entry.env,
		cwd: entry.cwd,
		toolCallTimeoutMs: entry.toolCallTimeoutMs,
		failOnStartupError: entry.failOnStartupError,
		reconnect: entry.reconnect
	};
}

/** Environment variable that seeds the base profile for one dsh run. */
export const PROFILE_ENV_VAR = "DSH_DOCKER_MCP_PROFILE";

/**
 * Resolve the base (pre-UI) profile for one run.
 * @param configured - the row config `profile` value.
 * @param envValue - `DSH_DOCKER_MCP_PROFILE` as seen in the launch env.
 * @returns the env value when it is a valid profile id, else the configured one.
 */
export function resolveBaseProfile(configured, envValue) {
	if (typeof envValue === "string" && envValue !== "" && PROFILE_PATTERN.test(envValue)) return envValue;
	return configured;
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
export function readPersistedProfile(ctx) {
	try {
		const settings = ctx.get("settings");
		const section = settings?.document?.[SETTINGS_NAMESPACE];
		if (section === null || typeof section !== "object" || Array.isArray(section)) return void 0;
		const value = section.profile;
		if (typeof value === "string" && PROFILE_PATTERN.test(value)) return value;
	} catch {
		// settings service not available yet: env/row resolution still applies.
	}
	return void 0;
}

/**
 * Mount the Docker Desktop MCP gateway and its settings-backed profile picker.
 * Profile precedence: settings user layer (UI selection) > DSH_DOCKER_MCP_PROFILE
 * env var > row config `profile` > schema default.
 * @param ctx - plugin context.
 * @param config - validated {@link Config}.
 */
function apply(ctx, config) {
	const ns = SETTINGS_NAMESPACE;
	const envProfile = launchEnvironmentOf(ctx).get(PROFILE_ENV_VAR)?.value;
	const baseProfile = resolveBaseProfile(config.profile, envProfile);
	if (envProfile !== void 0 && envProfile !== "" && baseProfile !== envProfile) {
		ctx.logger.warn(`docker-desktop-mcp(${config.serverName}): ignoring ${PROFILE_ENV_VAR}="${envProfile}" — not a valid profile id (pattern ${PROFILE_PATTERN}); using "${baseProfile}"`);
	}
	// The persisted UI selection wins over env/row config: seed the first
	// gateway spawn with it. When the settings service is not up yet this
	// yields the base profile, and the installSection initial onChange below
	// switches the bridge to the persisted selection in place right after.
	const initialProfile = readPersistedProfile(ctx) ?? baseProfile;

	// Composition base layer: part of the resolved value served to the client
	// but never persisted. Discovery results live here, in memory.
	const entry = {
		profile: initialProfile,
		profiles: [],
		lastRefreshError: "",
		discoveryRevision: 0
	};
	/** Live resolved settings value; swapped by installSection hooks. */
	let source = () => entry;
	/** Profile the nested bridge currently runs with. */
	let runningProfile = initialProfile;
	/** Last refreshNonce observed; undefined until the first settings commit. */
	let lastNonce = void 0;
	/** Serializes discovery runs so rapid refreshes never interleave. */
	let discovery = Promise.resolve();

	/**
	 * One profile-list discovery; the result lands in the base layer (in
	 * memory) and is picked up by the client on its next settings read — the
	 * refresh button polls the shared describe mirror for exactly that.
	 */
	const runDiscovery = () => {
		discovery = discovery
			.then(async () => {
				try {
					entry.profiles = await listProfiles(config.command);
					entry.lastRefreshError = "";
				} catch (error) {
					entry.profiles = [];
					entry.lastRefreshError = (error instanceof Error ? error.message : String(error)).split(/\r?\n/u)[0];
					ctx.logger.warn(`docker-desktop-mcp(${config.serverName}): profile discovery failed: ${entry.lastRefreshError}`);
				}
				entry.discoveryRevision += 1;
			})
			.catch(() => {});
		return discovery;
	};

	// Initial connection with the resolved profile (persisted UI selection >
	// env var > row config > schema default).
	const bridge = ctx.plugin(McpClient, bridgeConfig(config, initialProfile));

	/** Restart the nested bridge with one profile; failures are logged, never thrown. */
	const switchProfile = (profile) => {
		runningProfile = profile;
		ctx.logger.info(`docker-desktop-mcp(${config.serverName}): switching gateway profile to "${profile}"`);
		Promise.resolve(bridge.update(bridgeConfig(config, profile))).catch((error) =>
			ctx.logger.error(`docker-desktop-mcp(${config.serverName}): profile switch to "${profile}" failed: ${String(error)}`)
		);
	};

	ctx.inject(["settings"], (settingsCtx) => {
		const settings = settingsCtx.settings;
		settings.installSection(ctx, ns, SettingsSchema, entry, {
			setSource: (next) => {
				source = next;
			},
			validate: (value) => {
				if (!PROFILE_PATTERN.test(value.profile)) {
					throw new Error(`settings "${ns}": profile must match ${PROFILE_PATTERN}`);
				}
			},
			onChange: () => {
				try {
					const current = source();
					if (current.profile !== runningProfile) switchProfile(current.profile);
					if (current.refreshNonce !== lastNonce) {
						lastNonce = current.refreshNonce;
						runDiscovery();
					}
				} catch (error) {
					ctx.logger.error(`docker-desktop-mcp(${config.serverName}): ${String(error)}`);
				}
			}
		});
		// One-time migration: earlier versions persisted the discovery state
		// (profiles, lastRefreshError) into the user layer. Unset the legacy
		// keys so settings.yaml carries only the user-authored fields; the
		// raw section change also re-serves the fresh base layer to open clients.
		Promise.resolve()
			.then(() => {
				const section = settings.document?.[ns];
				const ops = [];
				if (section !== null && typeof section === "object" && !Array.isArray(section)) {
					if ("profiles" in section) ops.push({ op: "unset", path: ["profiles"] });
					if ("lastRefreshError" in section) ops.push({ op: "unset", path: ["lastRefreshError"] });
					if ("discoveryRevision" in section) ops.push({ op: "unset", path: ["discoveryRevision"] });
				}
				if (ops.length === 0) return;
				return settings.mutate(ns, ops);
			})
			.catch((error) => {
				ctx.logger.warn(`docker-desktop-mcp(${config.serverName}): legacy settings cleanup failed: ${String(error)}`);
			});
	});
}

export { apply, inject, name };
