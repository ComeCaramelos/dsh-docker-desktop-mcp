/**
 * Discovery-run shapes — the options the executable scan accepts.
 */

/** Options for the WSL docker-CLI path rewrite, shared by the discovery of
 * executable candidates. */
export type WslDockerOptions = {
    platform?: NodeJS.Platform;
    env?: Record<string, string | undefined>;
    exists?: (candidate: string) => boolean;
};

/** Options for {@link discoverExecutables}. */
export type ExecutableDiscoveryOptions = WslDockerOptions;
