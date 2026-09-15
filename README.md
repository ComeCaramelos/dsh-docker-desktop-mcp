# @comecaramelos/dsh-docker-desktop-mcp

DSH plugin that connects the **Docker Desktop MCP gateway**
(`docker mcp gateway run --profile <name>`) as an MCP server, with a **profile
picker in the Web GUI** — instead of hardcoding `--profile` in the config row.

## Install

From npm (recommended):

```sh
dsh plugin --profile web add /path/to/dsh-docker-desktop-mcp
```

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

With `patchReload: live` the host half reloads automatically; refresh the browser for the picker card.

## Why this over the default config

- **Profile picker in Settings** — switch Docker MCP profiles without editing
  `cordis.patch.yml`. Selection persists in `$DSH_HOME/settings.yaml`.
- **Refresh profiles button** — runs `docker mcp profile list --format json`
  and repopulates the select from the host.
- **Hot reconnect** — picking a profile re-applies the gateway with the new
  `--profile` in place; no restart needed.
- **Profile precedence**: UI selection > `DSH_DOCKER_MCP_PROFILE` env var >
  row config > `"default"`. Seed a machine default via env, switch per-run from UI.
