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

- **Docker executable picker** — the same shape for the executable the gateway
  and discovery spawn: a dropdown over the saved executable rows plus the one
  actually in use (the auto-detected default when no override is set), and a
  catalog of paths below it — again behind a collapsed "Saved executables"
  disclosure, which also carries its "Fetch executables" action.
  "Fetch executables" runs a filesystem scan of the
  usual install locations (the WSL host-CLI rewrite first) — never a spawn —
  and opens a "Choose executables to add" dialog over the paths it found:
  already-saved paths come back pre-checked and locked, the rest start
  unchecked, and "Add selected" appends exactly the ones you picked (nameless,
  ready for their display names). "Add executable" takes a path by hand. Choosing a row writes the `command`
  field verbatim; clearing it drops back to the auto-detected default. Changing
  it hot-restarts the gateway and re-discovers against the new CLI. In the
  card this block sits above the saved-profiles block.
- **Saved profiles in Settings** — the profile catalog: every saved profile row,
  with the display name you gave it, plus "Fetch profiles" and the manual "Add
  profile". That catalog sits behind a collapsed "Saved profiles" disclosure —
  only the field row stays visible until you open it. This block no longer
  carries the selection dropdown: choosing the running profile is the chat
  composer pill's job (below), so the settings block stays purely about the
  rows the dropdown offers. Selection persists in `$DSH_HOME/settings.yaml`,
  as does the saved catalog.
- **Profile pill in the chat composer** — the profile selector itself, led by
  the Docker mark, as a compact pill on the conversation input's tool row,
  next to the shell's own mode pill, for switching profiles mid-conversation.
  The brand mark lives only on this pill — the dropdown itself, the Settings
  card and every other surface stay icon-free. Its dropdown offers the
  saved rows plus the ids the last discovery reported (and, on a discovery
  error or an empty store, the `default` fallback). It is a second face of the
  card's controller — same store, same option rules, same persisted `profile`
  field, same hot reconnect — so a change made anywhere (pill, Settings rows,
  slash command) reads everywhere without extra polling. The pill stays hidden
  until the namespace is served, is disabled while settings are read-only,
  and writes nothing when the picked row is the running profile.
- **Fetch profiles button** — runs `docker mcp profile list --format json`
  and opens a "Choose profiles to add" dialog over the ids it found: already-
  saved ids come back pre-checked and locked (pruning stays the delete button's
  job), new ids start unchecked, "Search profiles" sifts the list, "Select all"
  checks the visible ones, and "Add selected" merges exactly the checked ids
  into the saved rows — existing rows keep their order and custom names, the
  additions land at the end (nameless), Cancel writes nothing. The discovery
  run itself never adds anything; the selection decides. While the list is
  healthy and non-empty it is authoritative: `default` appears only if Desktop
  reports it; on a discovery error or an empty list it stays selectable as
  fallback.
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
  In the card it is a block of its own — a titled section ("Reduce log
  output") with the switch and its explanation, the same shape the two
  catalogs use. The control's accessible name is `Reduce log output`, and
  hovering it shows the tooltip "Capture the gateway's progress lines into the
  plugin's stderr log".
- **Profile precedence**: the UI picker and `/docker-profile` write the *same*
  `profile` field in the settings user layer — the last write wins — so both
  stay above `DSH_DOCKER_MCP_PROFILE` > row config > `"default"`.
  Seed a machine default via env, switch per-run from UI or TUI.
- **Executable precedence**: the executable picker writes the *same* `command`
  field — the last write wins — so it stays above the row-config `command` and
  its WSL auto-resolution.
- **What persists**: the settings user layer carries the two selections
  (`profile`, `command`), the "Reduce log output" value (`stderrMode`), the two
  saved catalogs (`profileEntries`, `executables`) and the two refresh triggers
  (`refreshNonce`, `refreshExecutablesNonce`). Nothing else: the executable
  actually in use and the discovery state stay in memory on the host side, which
  is why every run ends with the host bumping its own nonce — a host push is
  always negative, a positive one only ever comes from the UI.

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
    Runs `docker mcp profile list`, returns the result, and merges the
    discovered ids into the saved profile rows (the headless counterpart of
    the Web dialog's "Add selected" — no dialog, so the merge is explicit).
    Use after creating or deleting profiles on Docker Desktop to refresh the
    list.
```

## Development

```sh
npm install          # esbuild is a devDependency (browser-half bundler)
npm run build        # tsc (host half) + typecheck & bundle the browser half → lib/
npm run build:client # browser half only: tsc typecheck + esbuild bundle
npm test             # builds, then the test files through `node --test`
```

npm 11 blocks dependency install scripts unless the package is explicitly
allowed, so `package.json` carries `"allowScripts": { "esbuild": true }` —
otherwise a clean `npm ci` warns that esbuild's `install.js` is not covered.
See [`CONTRIBUTING`](CONTRIBUTING.md) for the details.

Sources live in `src/`: the host half is `src/index.ts` re-exporting
`src/host/*`, emitted by `tsc` (`tsconfig.json`) as ESM to `lib/index.js`;
the browser half is ordinary ES modules under `src/client/*`, typechecked with
`noEmit` (`src/client/tsconfig.json`) and bundled by `scripts/build-client.mjs`
into the single factory-shaped `lib/client.js` the loader registers. The
shell-seeded modules (`react`, `react/jsx-runtime`, `react-dom/client`,
`@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-primitives`) stay
external, and a linked source map debugs the bundle back to
`src/client/*.ts`. `react`/`react-dom` and their `@types/*` are devDependencies
so the imports typecheck in the editor; the two `@deepseek-ai/dsh-client-*` ids
exist only in the loader's module table and are described structurally in
`src/client/shell-modules.d.ts`. Card copy lives in one dictionary per locale tag
(`src/client/locales/en-US.ts`, registered from `src/client/locales/index.ts`).
`lib/` is generated — never hand-edit it.

---

[`CONTRIBUTING`](CONTRIBUTING.md) | [`LICENSE`](LICENSE.md)
