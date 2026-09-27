/**
 * Discovery-run shapes — the options the two discovery paths accept and the
 * `echo` marker that carries a sibling instance's sync value.
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

/** Discovery-run options (the echo value mirrors a sibling-host sync marker). */
export type DiscoveryOptions = { echo?: number };
