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
- `test/parse.test.mjs`, `test/client.test.mjs`,
  `test/gateway-ready.test.mjs` — plain `node:assert` scripts
  (run via `npm test`), not a test framework.
- `.smoke/` — manual end-to-end fixtures (fake-docker shim + `--patch`
  overlays); `args.log` is the shim's invocation log (gitignored).

## Hard constraints (do not break)

- **One settings namespace per host**: `docker-desktop-mcp` is fixed, not
  derived from `serverName`. A second instance must fail loud, not alias.
- **Profile precedence** (highest first): the settings USER LAYER (the Web UI
  picker AND the `/docker-profile` slash command write the same `profile`
  field — last write wins) in `$DSH_HOME/settings.yaml` →
  `DSH_DOCKER_MCP_PROFILE` env var (resolved via
  `launchEnvironmentOf(ctx)`, never raw `process.env`) → row config
  `profile` → `"default"`. Env values not matching
  `/^[A-Za-z0-9._-]{1,128}$/` are ignored with a warning, never thrown.
- **Slash commands** `/docker-profile` / `/docker-refresh` register through
  `ctx.inject(["commands"], …)` — silently absent when the bundle provides no
  `commands` service. Registration goes through a helper that retains the
  `register()` disposers in `commandDisposers`, released by a plugin-ctx
  `ctx.effect` cleanup: the registry owns its registrations on the COMMANDS
  provider ctx, NOT this plugin, so without that cleanup a hot re-apply would
  collide (duplicate name throws inside `register` — it is caught and warned,
  keeping the earlier definitions live). Handlers must not rely on
  `invocation.signal` (nothing is cancellable).
- **Gateway argv shape is fixed**: `mcp gateway run --profile <id>` plus
  `extraArgs`. Discovery uses `mcp profile list --format json` with a tolerant
  parser (bare array or wrapped; ids from `id ?? profileID ?? profileId ??
  name`). Discovery errors: first non-empty stderr line, capped, plus the
  "enable the profiles feature" hint when the CLI reports an unknown
  flag/command.
- **Gateway console noise** is handled WITHOUT touching the argv shape: the
  MCP stdio transport spawns the gateway with `stderr: "inherit"` (SDK
  default; the `dsh-mcp-client` bridge config exposes no stderr knob), so
  every gateway progress line lands on the dsh console. Row config
  `gatewayStderr` (default `"log"`) wraps the gateway spawn in `sh -c` whose
  script `exec`s the gateway with the argv VERBATIM (positional pass-through
  — no re-quoting, no joining), so the gateway process never sees the
  wrapper and the constraint above holds as written. stdout stays the
  protocol stream; stderr goes to `gatewayStderrLog` (default
  `$TMPDIR/dsh-docker-mcp-<serverName>-gateway-<pid>.log`, truncated on every
  spawn). `"console"` disables the wrapper (raw inherited stderr). The script
  exits 127 with an exec-failure message on the sh's own inherited stderr
  when the executable is missing, and falls back to plain inheritance
  (`fallback` = `"platform"` / `"shell"`) where no POSIX shell exists — the
  notice/warning is emitted once per apply (`noteGatewayStderr`, keyed on
  redirect/fallback). Discovery spawns stay unwrapped (their stdio is already
  piped/ignored). The wrapper is strictly PER-SPAWN: it rewrites only the
  `command`/`args` of this bridge's config — no monkey-patching of the
  shared `StdioClientTransport`, no global flags — so other plugins spawning
  stdio servers through the same hoisted `@deepseek-ai/dsh-mcp-client`/SDK
  keep their inherited stderr untouched (verified live: a second plain
  `mcp-client` row's server stderr still reaches the console, and this
  gateway's goes to the log, with zero cross-capture).
  The bridge config object carries ONLY `dsh-mcp-client`
  fields; `redirect`/`fallback` ride a sibling object from `bridgeConfig`,
  never the config passed to `ctx.plugin`/`fiber.update`.
- **UI stderr-mode toggle** ("Reduce log output" in the Web card). The
  effective mode resolves strictly as the USER layer `stderrMode`
  (`"log"`/`"console"`) when set, else the row config `gatewayStderr`
  (`""` = auto) — `resolveStderrMode`, never a third state. The switch
  writes the user layer (so it persists, like the picker/executable do);
  its `onChange` branch is independent of the profile/command branches and
  restarts the gateway connection via `bridge.update` (`applyStderrMode`)
  because the spawn shape can only change by respawn — a `fiber` that is
  still `void 0` (readiness gate) just records the mode for the first
  start. The row default is served to clients as a STATIC base field
  `rowStderr` (never persisted) so the switch shows the truth before any
  write — `dsh-settings` serves base fields with the registration value,
  so unlike the discovery fields it needs no nonce bump. `validate` MUST
  accept `""` alongside `"log"`/`"console"`: registration resolves to
  `""` in a fresh settings.yaml, and a strict non-empty check throws
  inside `installSection` — a caught, console-invisible error that leaves
  the settings gate unresolved and the plugin never discovering (this
  bit us live: empty-home boots failed while seeded ones worked).
- Profile **ids**, not display names, drive `--profile` and the UI selector.
- **Selector options**: a healthy, non-empty discovery list is AUTHORITATIVE
  in the Web card — `default` appears as an option only when Desktop actually
  reports it (no phantom option). On a discovery error or an empty list the
  store is not trustworthy, so `default` stays selectable as the fallback
  option (the current profile stays appended too, so a picked id never
  disappears). The same rule feeds `missing`-dot logic and the
  `/docker-profile` usage listing.
- **Profile switch = `fiber.update()`** on the nested mcp-client bridge
  (re-validates + restarts the connection in place). Never recreate the
  plugin row; never throw out of the settings `onChange` callback.
- **Settings persistence boundary**: only `profile` (last UI selection),
  `command` (last UI executable override), `stderrMode` (last "Reduce log
  output" toggle write — `"log"`/`"console"`, only present once the switch
  was actually flipped) and `refreshNonce` may land in
  `$DSH_HOME/settings.yaml`. The executable actually in use
  (`effectiveCommand`) plus the discovery state (`profiles`,
  `lastRefreshError`, `discoveryRevision`) live in the composition **base
  layer** — the `entry` object handed to `installSection` — held in memory,
  never persisted (`effectiveCommand` is unset in the user layer on
  registration, so an accidentally-persisted one is cleaned). But note:
  `dsh-settings` recomputes the `describe()` **resolved value** only on
  writes (at registration and in user-section `write`), never when the base
  entry mutates in memory — and the resolved value (NOT the `base`
  descriptor) is what client scopes decode. A discovery run mutating only
  the entry therefore leaves every served value stale forever (the bug
  behind "Profile not found until Refresh"). So every run ends with the
  host bumping its OWN `refreshNonce` (`settings.mutate`, value-bearing —
  never a no-op patch): recomputed served value + `settings/document-updated`.
  **Sign convention** (loop safety, not cosmetics): a POSITIVE
  `refreshNonce` is written only by the browser as a refresh request; the
  host's own pushes are always `-(Date.now())`. Guards in `onChange`:
  `current.refreshNonce === pushedNonce` → skip (this instance's own write);
  a NEGATIVE marker this instance did NOT write came from a SIBLING dsh
  instance sharing `settings.yaml` → answer with an ECHO run (write the SAME
  negative value back: the raw section is unchanged, so `bumpRevision` fires
  no document event and the discovery re-run never re-broadcasts — two live
  instances must not discovery-ping-pong). A positive change is a user
  refresh; the first commit is not (see below).
  Discovery is promise-chained (no overlapping runs) and the FIRST run
  waits for BOTH gates: the settings section installed (pushes need a
  writable section) AND `waitForGatewayReady` resolved (discovery against
  a still-booting Desktop is the useless early attempt that produced the
  empty list); the initial `onChange` commit is NOT a discovery trigger
  (`firstCommit` guard — the readiness continuation schedules it instead).
  A FAILED run arms ONE bounded auto-retry (`DISCOVERY_RETRY_DELAY_MS`
  15000, up to `DISCOVERY_RETRY_MAX` = 4 consecutive retries, counter reset
  on success, timer cleared on dispose) — the Desktop profile store can
  out-reach the daemon by seconds at boot; nothing retries forever. Retry
  pushes broadcast EXCEPT retry-of-echo runs, which keep the echo value.
- **Never host-write the section to "push" base-layer state with a no-op
  patch**: empty `update({})` patches are banned (they create `ns: {}` junk
  in a fresh settings.yaml and, with no raw-section change, fire no wire
  event). The sanctioned channel is the value-bearing host nonce bump above
  — the ONLY exception is the echo run, which writes an already-present
  negative marker value back unchanged precisely so it does NOT propagate.
- **Push channel for module plugins**: `harness.handle`/`host.call` is
  reserved for code-string halves; the only host→client channel is the
  `settings/document-updated` wire event, which fires only on raw
  user-section changes — hence the host's post-run nonce bump is what
  reaches open clients (and clients opened later, because the recomputed
  resolved value is host-wide state). The client's mirror re-read
  (`settingsScope.describe().load()`) survives as a **backstop** for missed
  wire events: every 15 s until the served `discoveryRevision` advances
  past the baseline, bounded by BOTH the wall-clock budget
  (`DISCOVERY_POLL_TIMEOUT_MS` = 75 s) AND an attempt cap
  (`DISCOVERY_POLL_MAX_TICKS` = 5 re-reads), whichever hits first; the next
  tick is armed *before* touching the mirror so a never-settling `load()`
  cannot stall the budget check. Both budgets are exported on the bundle
  for tests/diagnostics. A backstop poll also runs **silently at mount**
  (controller constructor, served revision still 0) to cover pushes that
  landed before this controller subscribed.
- **Cold-start gate before the first gateway spawn**: `apply()` starts the
  nested mcp-client row only after `waitForGatewayReady` (host) reports
  ready. Upstream `pkg/oauth.NotificationMonitor` (in the gateway binary)
  dials `pkg/desktop.Paths().BackendSocket` **once** and never retries — a
  spawn while it is not yet listening strands the stream and prints the
  `Failed to connect to OAuth notifications` cold-start error line. The wait
  is bounded (`GATEWAY_READY_POLL_MS` 1500 / `GATEWAY_READY_TIMEOUT_MS`
  15000); on `timed-out` the gateway starts anyway with a warning. Ready
  semantics: socket `connect(2)` succeeds → ready; socket absent everywhere
  + `docker version` answers → ready (plain CE has no backend API); never a
  stall, never an error throw out of the readiness continuation. Platform
  socket paths must mirror upstream (`\\\\.\\pipe\\dockerBackendApiServer`
  win32 / `/run/host-services/backend.sock` + `~/.docker/desktop/backend.sock`
  linux; other platforms never wait). The initial `ctx.plugin(McpClient, …)`
  now runs in the readiness continuation, not synchronously in `apply` —
  `switchProfile` must tolerate `bridge === void 0` and only record the
  profile (the first start uses the latest `runningProfile`).
- **Persisted profile seeds the connection**: `readPersistedProfile(ctx)`
  reads the user layer (pattern-validated only) before the first gateway
  spawn when the settings service is already up, so the initial connection
  — and every in-process reconnect, which reuses the bridge config — starts
  on the last selected profile. When the settings service is not up yet,
  the `installSection` initial `onChange` switches the bridge to the
  persisted selection in place right after registration.
- **Legacy migration**: earlier versions persisted `profiles`/
  `lastRefreshError` into the user layer, and `effectiveCommand` (an in-memory
  base-layer field) plus `rowStderr` (a static base mirror of `gatewayStderr`
  meant only for serving) must never be persisted; on registration the host
  unsets `profiles`, `lastRefreshError`, `discoveryRevision`,
  `effectiveCommand` and `rowStderr` via
  `settings.mutate` (one-time cleanup; the raw-section change also re-serves
  the fresh base layer to open clients).

## Client-bundle gotchas (cost real debugging time)

- React children must go in `props.children` (3rd `jsx()` arg is the `key`
  slot). This bit us once with `<select>` options and a `<button>`.
- Card renders only when its slot `key` matches a served settings namespace
  (`docker-desktop-mcp`) — registration is unconditional, rendering is
  keyed.
- CSS is injected as a `<style>` tag from a const; no CSS modules at runtime.
- Snapshot-store hook name is derived: `hooks.dockerMcpCard` →
  `useDockerMcpCard` prop.
- A discovery wait that ends without connecting (attempts exhausted / deadline
  with the revision never advancing, or a host-published `lastRefreshError`)
  stages a one-shot `notice` on the card store (`{ seq, kind, text }`, kind
  `stall` or `error`, sticky across `publish()`). It is announced by a
  body-mounted toast host (`DockerMcpToastHost`, mounted from `apply()` via
  `react-dom/client` `createRoot` — NOT by the settings card, because the
  `settings.plugin.item` slot only lives while Settings is open), rendering
  the shell's shared `primitives.Toast` (with `IconWarningOutline16`). The
  card must never render the toast (one toast per notice); the Toast
  primitive portals itself, so it shows regardless of the card being
  collapsed. The toast dismisses via its `onDone` → `clearNotice(seq)`; a
  `clearNotice` with a stale `seq` is ignored. Nothing re-runs the poll — the
  controller stays idle until the user clicks Refresh or reloads.
- `react-dom/client` (`createRoot`) is a seed module of the shell's module
  table — a module plugin may require it and mount its own React root outside
  any slot. Use the `createElement` (not `jsx`) element form when a test needs
  the raw unrendered element; the host re-render in tests re-invokes the
  component with the current store snapshot.
- The refresh poll owns a controller `pollTimer`: `dispose()` must clear it.
  The next tick is armed **before** touching the mirror (not in the
  `load().then`) so a load that never settles cannot stall the budget check;
  every `mirror.load().then` re-checks `disposed`/`satisfied()` and finishes
  the wait when done (a load can resolve after dispose).

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
  `$DSH_HOME/settings.yaml` (post-migration it must be exactly
  `refreshNonce` + `profile` + (when a UI override was set) `command` +
  (when the Reduce-log-output switch was ever flipped) `stderrMode`; a
  host-pushed `refreshNonce` is NEGATIVE — positive values come only from the
  UI).
- **CRLF trap (cost hours once)**: a Windows-side git checkout (SourceTree /
  `core.autocrlf=true`) rewrites every dirty file to CRLF and can clear exec
  bits or append `\r` to the `.smoke/*` shims (`#!/bin/sh\r` → `exec: …:
  not found` — a fixture failure that masquerades as a plugin failure).
  Symptoms: `git diff --stat` inflated to whole files while `git diff -w`
  comes back empty; `file <path>` says `with CRLF line terminators`.
  Diagnose with `git ls-files | xargs file | grep CRLF`. Fix with
  `sed -i 's/\r$//' <files>` (and re-chmod the shims 755); files whose
  content already matches HEAD can simply go through `git checkout --
  <paths>`, which additionally repairs the stale index stat those files
  strand in (`update-index --really-refresh` alone does NOT clear it). When
  a live smoke run suddenly fails inside the wrapper's `exec` with
  "Permission denied" / "not found", suspect this before the wrapper.
- Headless source check without touching `~/.dsh`: `DSH_HOME=$(mktemp -d)
  <npx>/node_modules/.bin/dsh web --patch .smoke/overlay-fake-boot.yml
  --port <unused> --no-open` — inserts the row from `../lib/index.js` against
  the fake-docker shim in an isolated home. Expect: ONE `mcp profile list`
  spawn (success → no retries), `gateway run` repeats are just mcp-client
  backoff against the shim's forced exit 1, and settings.yaml carries a
  negative host-pushed `refreshNonce` within ~1 s of boot.
- **Empty-home regression check**: the fake-boot boot MUST produce that
  settings.yaml. A validation that throws at registration leaves the
  settings gate unresolved, so the file NEVER appears and discovery never
  runs — that was the empty-`stderrMode` `validate` regression: seeded
  (explicit-value) boots passed while empty-home boots silently stalled.
  If the file is missing, suspect registration (check `validate`/the
  base-entry shape), not the discovery path.
- **Stderr-mode live check** with the noise shim:
  `--patch .smoke/overlay-noise.yml` boots the row against
  `.smoke/noise-docker`, a shim that prints the marker line `NOISE-GW-LINE`
  to stderr on every gateway spawn. Default (capture ON): the marker is
  ABSENT from the dsh console and lands only in
  `/tmp/dsh-docker-mcp-<serverName>-gateway-<pid>.log`. With the user layer
  `stderrMode: console` (seed `$DSH_HOME/settings.yaml` before boot, or
  flip the section's `stderrMode` mid-run to emulate the toggle), the
  marker echoes on the console instead — flipping mid-run restarts the
  gateway connection (a second log file appears). This is the UI toggle's
  end-to-end proof.

## Install / dev notes

- On WSL with Windows-side pnpm, `dsh plugin add` fails (EISDIR — Windows
  pnpm cannot symlink WSL dirs). Manual install: symlink the package into
  `~/.dsh/profiles/web/node_modules/@comecaramelos/` and record
  `"file:/abs/path"` in the profile `package.json` dependencies (see README).
- Live-reload caveat: `patchReload: live` re-applies **patch config**; it does
  **not** re-import changed plugin JS. JS changes need a `dsh web` restart.
- WSL + Docker Desktop (Windows side): two separate MCP stores exist — the
  Linux CLI's `~/.docker/mcp` (usually empty) and Desktop's
  `C:\Users\<you>\.docker\mcp` (where UI-created profiles live). The default
  row `command: docker` is auto-resolved by `resolveDockerCommand()` to
  `/Docker/host/bin/docker.exe` when that path is executable on linux, else
  to the first `docker.exe` found on the launch `PATH` (WSL interop exposes it
  there when the host-bin mount is absent) (only the literal default is
  rewritten; a non-`docker` command always wins), so discovery + gateway use
  the Desktop store with no row config. Don't try
  `DOCKER_CONFIG=/mnt/c/…` with the Linux CLI: it rejects the Windows store
  ("Failed to initialize: protocol not available"). A row-config `command`
  change hot-applies under `patchReload: live` (discovery + gateway restart
  in place).
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
   resolved = schema defaults < base < user layer, but `describe()` serves
   `registration.resolved`, which `dsh-settings` recomputes **only in
   `register()` and `write()`** — a base-entry mutation is NEVER served
   (client scopes decode `view.value`, not `view.base`; this is the gotcha
   behind "Profile not found until Refresh" and why the host bumps its own
   `refreshNonce` after every discovery run); `commit` →
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
