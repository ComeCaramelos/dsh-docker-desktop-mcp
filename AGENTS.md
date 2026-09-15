# AGENTS.md

Docker Desktop MCP gateway plugin for DeepSeek Harness (DSH). Adds a UI profile
picker (`--profile`) on top of the stdio `docker mcp gateway run` bridge.

## Layout

- `lib/index.js` — host half (ESM, `main`). Exports `name`, `inject`, `Config`
  (schemastery/zod schema), `apply(ctx, config)`. Spawns the gateway via a
  nested `@deepseek-ai/dsh-mcp-client` plugin and registers the
  `docker-desktop-mcp` settings namespace.
- `lib/client.js` — browser half (CJS **factory bundle**, `./client` export).
  Hand-written, not built: it registers through
  `window.__ModuleLoader__.load({ id, factory: (require) => … })` and seeds
  `react`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-store`,
  `@deepseek-ai/dsh-client-ui-primitives` (Menu pill selector),
  `@deepseek-ai/dsh-client-ui-slots` via the whitelisted `require`. No bundler
  step — keep it self-contained.
- `test/parse.test.mjs`, `test/client.test.mjs` — plain `node:assert` scripts
  (run via `npm test`), not a test framework.
- `.smoke/` — manual end-to-end fixtures (fake-docker shim + `--patch`
  overlays); `args.log` is the shim's invocation log (gitignored).

## Hard constraints (do not break)

- **One settings namespace per host**: `docker-desktop-mcp` is fixed, not
  derived from `serverName`. A second instance must fail loud, not alias.
- **Profile precedence** (highest first): UI selection (settings user layer in
  `$DSH_HOME/settings.yaml`) → `DSH_DOCKER_MCP_PROFILE` env var (resolved via
  `launchEnvironmentOf(ctx)`, never raw `process.env`) → row config
  `profile` → `"default"`. Env values not matching
  `/^[A-Za-z0-9._-]{1,128}$/` are ignored with a warning, never thrown.
- **Gateway argv shape is fixed**: `mcp gateway run --profile <id>` plus
  `extraArgs`. Discovery uses `mcp profile list --format json` with a tolerant
  parser (bare array or wrapped; ids from `id ?? profileID ?? profileId ??
  name`). Discovery errors: first non-empty stderr line, capped, plus the
  "enable the profiles feature" hint when the CLI reports an unknown
  flag/command.
- Profile **ids**, not display names, drive `--profile` and the UI selector.
- **Profile switch = `fiber.update()`** on the nested mcp-client bridge
  (re-validates + restarts the connection in place). Never recreate the
  plugin row; never throw out of the settings `onChange` callback.
- **Settings persistence boundary**: only `profile` (last UI selection) and
  `refreshNonce` (refresh trigger) may land in `$DSH_HOME/settings.yaml`.
  Discovery state (`profiles`, `lastRefreshError`, `discoveryRevision`)
  lives in the composition **base layer** — the `entry` object handed to
  `installSection` — served to the client inside the resolved value, held
  in memory, never persisted. Discovery is promise-chained (no overlapping
  runs), runs at registration and on every `refreshNonce` change; success
  and failure update the base layer and bump `discoveryRevision`.
  "Runs at registration" is the nonce diff itself (`lastNonce` starts
  `undefined`, so the initial `onChange` always triggers a run) — don't add
  a separate registration-time call.
- **Never host-write the section to "push" base-layer state**: a host
  `update`/`mutate`/`replace` persists the entire raw user section (a no-op
  patch on a namespace with no user section *creates* an empty section in
  the file), and `settings/document-updated` only fires on a raw-section
  change — a no-op write neither avoids the junk nor reaches open clients.
  Base-layer changes reach clients only via client-initiated re-describes
  (the refresh poll) or a natural user write.
- **No host→client push for module plugins**: `harness.handle`/`host.call`
  is reserved for code-string halves, and the wire pushes
  `settings/document-updated` only on raw user-section changes — a
  base-layer change is invisible to open clients. So the client's refresh
  action re-reads the shared describe mirror
  (`settingsScope.describe().load()`) every 700 ms until the served
  `discoveryRevision` advances past its click-time value (20 s budget).
- **Persisted profile seeds the connection**: `readPersistedProfile(ctx)`
  reads the user layer (pattern-validated only) before the first gateway
  spawn when the settings service is already up, so the initial connection
  — and every in-process reconnect, which reuses the bridge config — starts
  on the last selected profile. When the settings service is not up yet,
  the `installSection` initial `onChange` switches the bridge to the
  persisted selection in place right after registration.
- **Legacy migration**: earlier versions persisted `profiles`/
  `lastRefreshError` into the user layer; on registration the host unsets
  those keys via `settings.mutate` (one-time cleanup; the raw-section
  change also re-serves the fresh base layer to open clients).

## Client-bundle gotchas (cost real debugging time)

- React children must go in `props.children` (3rd `jsx()` arg is the `key`
  slot). This bit us once with `<select>` options and a `<button>`.
- Card renders only when its slot `key` matches a served settings namespace
  (`docker-desktop-mcp`) — registration is unconditional, rendering is
  keyed.
- CSS is injected as a `<style>` tag from a const; no CSS modules at runtime.
- Snapshot-store hook name is derived: `hooks.dockerMcpCard` →
  `useDockerMcpCard` prop.
- The refresh poll owns a controller `pollTimer`: `dispose()` must clear it,
  and every `mirror.load().then` must re-check `disposed` before arming the
  next tick (a load can resolve after dispose).

## Testing conventions

- Cross-realm values (vm-materialized bundles): compare with
  `JSON.stringify`, not `deepEqual` (prototype mismatches).
- Client test materializes `lib/client.js` in a `node:vm` context with stubbed
  `window.__ModuleLoader__`, `document`, `react`, `react/jsx-runtime`, and a
  stub settings scope — assert registration, exports, rendered menu items,
  and that selector/refresh clicks write the right settings fields.
- Host behavior verified by `.smoke/` overlays booted with
  `dsh web --patch <overlay> --port N --no-open` (the `--patch` flag belongs
  to the `web` subcommand and must precede app args) — watch
  `.smoke/args.log` for the shim's argv.
- **Smoke overlays must not `insert` a row id the profile patch already
  defines** — duplicate ids fail boot. Use id-targeted `config` replacement
  (e.g. swap `command` for the shim) instead.
- Client test's vm sandbox needs `setTimeout`/`clearTimeout` (the refresh
  poll schedules against the browser globals).

### Smoke gotchas (learned the hard way)

- Boot from the repo root with the active npx checkout's
  `node_modules/.bin/dsh`. The CLI rewrites `~/.dsh` at boot
  (`prepareProfile` regenerates `profiles/web/cordis.yml`) — a sandboxed
  agent session hits EACCES; run with wider file permissions.
- The `web` profile already defines `mcp-docker` (symlink install) →
  `overlay-fake.yml` (insert) fails boot on the duplicate id; use
  `overlay-fake-env.yml` (id-targeted `command` swap). `overlay.yml` /
  `overlay-fake.yml` are only for profiles without the row.
- `.smoke/fake-docker` must keep the exec bit (git tracks mode 100755). It
  always exits 1 on `gateway run` — repeating gateway lines in
  `.smoke/args.log` are the mcp-client reconnect backoff, not a loop bug.
- `DSH_HOME=<dir>` is honored (dsh-home-paths): boot against an isolated
  home when the real settings must not be touched.
- **Shared-file hazard**: a second instance shares `~/.dsh/settings.yaml`
  with the live GUI and both watch it — a test `profile` write hot-switches
  the *live* instance's real gateway (a profile absent from the real Desktop
  store leaves its tools broken until the value is restored). Restore
  immediately after the check.
- Expected argv with a persisted profile: first spawn on the row-config
  profile → `mcp profile list` → re-spawn on the persisted profile. At
  `apply()` time the settings document is usually not loaded yet, so
  `readPersistedProfile` misses and the initial `onChange` applies it — the
  two-phase spawn is normal, not a bug.
- Observables: `.smoke/args.log` and the `docker-desktop-mcp` section of
  `~/.dsh/settings.yaml` (post-migration it must be exactly
  `refreshNonce` + `profile`).

## Install / dev notes

- On WSL with Windows-side pnpm, `dsh plugin add` fails (EISDIR — Windows
  pnpm cannot symlink WSL dirs). Manual install: symlink the package into
  `~/.dsh/profiles/web/node_modules/@comecaramelos/` and record
  `"file:/abs/path"` in the profile `package.json` dependencies (see README).
- Live-reload caveat: `patchReload: live` re-applies **patch config**; it does
  **not** re-import changed plugin JS. JS changes need a `dsh web` restart.
- WSL + Docker Desktop (Windows side): two separate MCP stores exist — the
  Linux CLI's `~/.docker/mcp` (usually empty) and Desktop's
  `C:\Users\<you>\.docker\mcp` (where UI-created profiles live). Set row
  config `command: /Docker/host/bin/docker.exe` so discovery + gateway use
  the Desktop store. Don't try `DOCKER_CONFIG=/mnt/c/…` with the Linux CLI:
  it rejects the Windows store ("Failed to initialize: protocol not
  available"). A row-config `command` change hot-applies under
  `patchReload: live` (discovery + gateway restart in place).
- Test writes land in the shared `~/.dsh/settings.yaml`
  (`docker-desktop-mcp` section) — remove test data (fake profile ids, etc.)
  when done.

## References

- Upstream configs: `@deepseek-ai/dsh-mcp-client` (bridge config schema),
  `@deepseek-ai/dsh-settings` (installSection contract),
  `@deepseek-ai/dsh-client-ui-settings-plugins` (slot `settings.plugin.item`),
  `@deepseek-ai/dsh-launch-environment` (layered env),
  `@deepseek-ai/dsh-subprocess` (`scrubbedParentEnv` for the discovery spawn).
  Read them from the active dsh installation's `node_modules`.
- Contracts verified against the active checkout (0.1.5-rc.x) — re-verify on
  dsh upgrades:
  - `dsh-settings`: `installSection` calls `hooks.onChange()` **synchronously
    at registration** (that is how the persisted profile applies at boot);
    resolved = schema defaults < base < user layer; `commit` →
    `settings/updated` (host-internal, invariants only); `bumpRevision` →
    `settings/document-updated` **only on raw user-section change** — the
    only settings event on the wire (`dsh-api-remotes` whitelist).
  - `dsh-settings-file`: every persist rewrites the whole document
    (comment-preserving leaf diff); a write for a namespace with no user
    section *creates* `ns: {}` in the file; self-writes are suppressed by
    text comparison.
  - `dsh-client-ui-settings` (browser): the bound scope's public face is
    `getSnapshot`/`subscribe`/`set`/`unset`/`mutate` — no reload; the shared
    describe mirror is `settingsScope.describe()`, whose `load()` is the
    only client-side freshness lever; the mirror invalidates on
    `settings/document-updated` and `connection/reset`.
  - `dsh-cordis-host-runner`: module plugins get a guarded ctx (tools / get /
    injected services / lifecycle verbs); `harness.handle` exists only in the
    code-string sandbox path — module plugins cannot register host RPCs.
  - `dsh-mcp-client`: the reconnect loop reuses the `config` captured by the
    last `apply`, so in-process reconnects come back on the last
    `fiber.update`-d profile.
- Config defaults: `extraArgs=[]` (appended after `--profile`), `toolCallTimeoutMs=60000`,
  `failOnStartupError=false`, `reconnect.*` (true/500/30000/10). `env`/`cwd` are
  stdio-bridge passthroughs.
- Limitations: parser is tolerant of discovery JSON shapes (bare array, wrapped,
  `id`/`profileID`/`profileId`/`name` fields); degrades to "no profiles" not crash.
  UI shows profile **ids** only, not display names.
- Docker CLI: `docker mcp gateway run --profile <id>`; profile discovery
  requires the `profiles` MCP feature (`docker mcp feature enable profiles`
  on CE / `MCPWorkingSets` flag in Docker Desktop).
