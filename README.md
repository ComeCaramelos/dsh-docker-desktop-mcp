# @comecaramelos/dsh-docker-desktop-mcp

DSH plugin that connects the **Docker Desktop MCP Toolkit** gateway
(`docker mcp gateway run --profile <name>`) as an MCP server, with a **profile
picker in the Web GUI** — instead of hardcoding `--profile` in the config row.

## Install

From npm (recommended):

```sh
dsh plugin --profile web add @comecaramelos/dsh-docker-desktop-mcp
```

The plugin inserts a `mcp-docker` row (id: `mcp-docker`, profile: `default`)
into the Cordis bundle layer. If you already have a `mcp-docker` row in your
profile's `cordis.patch.yml`, the bundle layer's insert is superseded by your
row (later patches win by `id`).

Manual install (WSL + Windows pnpm, where symlinks fail):

```sh
mkdir -p ~/.dsh/profiles/web/node_modules/@comecaramelos
ln -s /path/to/dsh-docker-desktop-mcp ~/.dsh/profiles/web/node_modules/@comecaramelos/dsh-docker-desktop-mcp
# Add to ~/.dsh/profiles/web/package.json dependencies:
#   "@comecaramelos/dsh-docker-desktop-mcp": "file:/path/to/dsh-docker-desktop-mcp"
```

Then replace (or create) your `dsh-mcp-client` row in
`$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
# before
- id: mcp-docker
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: docker
    transport: stdio
    command: docker
    args: ['mcp', 'gateway', 'run', '--profile', 'default']

# after
- id: mcp-docker
  name: '@comecaramelos/dsh-docker-desktop-mcp'
  config:
    serverName: docker
    profile: default
```

### WSL + Docker Desktop (Windows)

Docker Desktop keeps its MCP profiles in the Windows store
(`C:\Users\<you>\.docker\mcp`), while the Linux CLI inside the distro reads the
(usually empty) `~/.docker/mcp`. When `docker.exe` is executable on linux —
either at `/Docker/host/bin/docker.exe` or anywhere the WSL `PATH` resolves it
— discovery and the gateway spawn use it (the host path wins over PATH). Set
`command` to an explicit path to opt out.

## Why this over the default config

- **Profile picker in Settings** — switch Docker MCP profiles without editing
  `cordis.patch.yml`. Selection persists in `$DSH_HOME/settings.yaml`.
- **Refresh profiles button** — runs `docker mcp profile list --format json`
  and repopulates the select from the host. While the list is healthy and
  non-empty it is authoritative: `default` appears only if Desktop reports
  it; on a discovery error or an empty list it stays selectable as fallback.
- **Docker executable field** — the card shows the `docker` CLI actually in use
  (the auto-detected default when no override is set) and lets you point the
  gateway + discovery at a different executable. A non-empty path wins
  verbatim; clearing it drops back to the auto-detected default (the same WSL
  host-path rewrite as the row-config `command`). Changing it hot-restarts the
  gateway and re-discovers against the new CLI.
- **Hot reconnect** — picking a profile re-applies the gateway with the new
  `--profile` in place; no restart needed.
- **Quiet console** — the MCP stdio transport spawns the gateway with
  inherited stderr, so every gateway progress line (catalog loads, image
  pulls, `Running …`, tool counts, the initialize dump) echoes straight onto
  the dsh terminal. By default the plugin redirects it instead: gateway
  stderr goes to a log file (`$TMPDIR/dsh-docker-mcp-<serverName>-gateway-
  <pid>.log`), and the host logs a single one-line notice
  (`gateway stderr → <path>`). The log is truncated on every gateway spawn.
  Set the row config `gatewayStderr: console` to skip the redirect and get
  the raw echo back, or `gatewayStderrLog: /path/to/file.log` to choose the
  destination. The protocol stream (stdout) is untouched — only stderr moves.
- **Reduce log output toggle** — the same behavior is exposed in Settings on
  the Docker Desktop card: a `Reduce log output` switch, ON by default
  (capture into the log file). Switching it OFF mirrors `gatewayStderr:
  console` — the gateway's stderr echoes to the dsh console again, useful to
  debug the raw gateway output. The switch restarts the gateway connection
  (the redirect is fixed at spawn) and persists to `settings.yaml`. When a
  value was never chosen the switch falls back to the row config
  (`gatewayStderr`, default `log`).
- **Profile precedence**: the UI picker and `/docker-profile` write the *same*
  `profile` field in the settings user layer — the last write wins — so both
  stay above `DSH_DOCKER_MCP_PROFILE` > row config > `"default"`.
  Seed a machine default via env, switch per-run from UI or TUI.
- **Executable precedence**: the UI field writes the *same* `command` field —
  the last write wins — so it stays above the row-config `command` and its
  WSL auto-resolution.

## Slash commands

Requires a profile that provides the `commands` service (TUI).

```
/docker-profile <profile-id>
    Switches the Docker MCP gateway profile. Persists the selection so it
    survives restarts and syncs across instances sharing `settings.yaml`.
    Shows discovered profiles in the error message when no argument is given.
    Re-selecting the profile the gateway already runs with reports
    "already active" and performs no reconnect.

/docker-refresh
    Runs `docker mcp profile list` and returns the result. Use after
    creating or deleting profiles on Docker Desktop to refresh the list.
```

---

[`CONTRIBUTING`](CONTRIBUTING.md) | [`LICENSE`](LICENSE.md)
