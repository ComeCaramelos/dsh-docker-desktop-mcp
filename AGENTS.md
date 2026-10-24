# AGENTS.md

`@comecaramelos/dsh-docker-desktop-mcp` is a **component** of the
`@comecaramelos/dsh-mcp-manager` bundle. It does not own a connection and no
longer runs a gateway of its own: it teaches the manager what a Docker Desktop
profile *is* — the `docker-profile` connection kind — and answers, for every
live `docker mcp gateway run --profile <id>` connection the manager starts, what
to run it with and why it cannot. Its own surface is the row's card (the two
named catalogs and the two fetch runs) plus the two slash commands.

## Layout

Two planes, each one entry file stating its surface with the behavior behind it
in dedicated modules — the same shape as the sibling plugin `dsh-ask-before-compact`.

- `src/index.ts` — host half **public surface** (TS, `tsconfig.json`, `module:
  NodeNext`). `npm run build` emits `lib/index.js` (ESM, `main`, plus
  `.d.ts`/maps): identity (`name`, `inject`), the row's one zod `Config` (which
  doubles as the configuration form — there is no second schema any more),
  `apply(ctx, config)`, the fixed `ENTRY_ID`, the kind constants
  (`KIND_ID`, `KIND_LABEL`, `KIND_MAX_ENTRIES`, `KIND_FIELDS`,
  `MANAGER_BUNDLE_ID`, `MIGRATION_DISMISSED_FIELD`), the spawn helpers
  (`GATEWAY_STDERR_MODES`, `GATEWAY_READY_TIMEOUT_MS`,
  `DISCOVERY_RETRY_DELAY_MS`, `DISCOVERY_RETRY_MAX`, `PROFILE_ENV_VAR`,
  `WSL_DOCKER_HOST_COMMAND`, `WSL_DOCKER_PATH_CANDIDATE`) and the
  diagnostics/test-facing helpers re-exported from `src/host/*` — including the
  kind's own resolvers (`createDockerKind`, `entryProfile`, `entryCommand`,
  `entryStderrMode`, `entryExtraArgs`, `executableChoices`, `profileChoices`)
  and the migration pair (`carriesStandaloneConfig`, `standaloneProposal`).
- `src/host/*` — host behavior: `apply.ts` (wiring: controller + manager
  attachment + commands + form attach), `manager.ts` (the `mcpConnections`
  seam: registers the kind, re-resolves entries that were standing when the
  kind landed, offers the standalone translation), `kind.ts` (the
  `docker-profile` `McpKind` — its fields, what each `select` offers, and the
  async `resolve()` that turns one entry into the fixed argv), `migration.ts`
  (the D4 standalone-config translation: detect, propose, never write),
  `controller/` (the machine half: live mirror, the two runs, the bounded retry
  — `index.ts` assembles the face, `state.ts` the mutable state + the initial
  resolution, `start.ts` the opening runs, `discovery.ts` the two chained runs
  + the readiness gate + the bounded retry, `publish.ts` the coalesced live
  publish, `commits.ts` what a form commit means, `persist.ts` the Host's own
  writes, `types.ts` the `Controller` face), `settings.ts` (the form's attach —
  the shared adapter owns the entry-id rule, the auto page and the commit
  filtering), `commands/` (`index.ts` registration + disposer retention,
  `profile.ts` and `refresh.ts` the two handlers), `discovery.ts` (`mcp profile
  list` + tolerant parser), `executables.ts` (the filesystem scan behind the
  executable catalog — probes only, never a spawn), `catalog.ts` (the named
  rows' validation + merge rules), `gateway.ts` (the spawn argv + where its
  stderr goes), `readiness.ts` (the bounded cold-start wait), `docker.ts` (the
  WSL host-CLI resolution), `values.ts` (reference/layer reads + precedence
  resolution + the live mirror's opening answers), `schema.ts`,
  `constants.ts`, `plugin-meta.ts`.
- `src/host/types/` — the shared type sections, `index.ts` re-exporting them:
  `config.ts` (row config + reconnect + stderr mode + the `ConfigField` reference
  a volatile field arrives as), `settings.ts` (the form's layers, the catalog
  rows, the `settings.mutate` ops, the `SettingsForms` service view and the
  form's own attach shape), `services.ts` (the command shapes and the plugin
  context), `gateway.ts` (spawn-target + connection shapes), `readiness.ts` (the
  cold-start probe shapes) and `discovery.ts` (the option records).
- `src/client/*` — browser half **source** (TS, ordinary ESM modules; built by
  `scripts/build-client.mjs`, which bundles `src/client/index.ts` with esbuild
  into the single CJS-shaped **factory bundle** `lib/client.js` (the `./client`
  export) after typechecking `src/client/tsconfig.json` (`noEmit`)). The loader
  contract is preserved through esbuild's `banner`/`footer`, so the emit stays
  `window.__ModuleLoader__.load({ id, factory: (require) => … })`; the five
  shell-seeded modules stay external (react, react/jsx-runtime,
  react-dom/client, `@deepseek-ai/dsh-client-store`,
  `@deepseek-ai/dsh-client-ui-primitives`). Their types come from two places:
  `react`/`react-dom` + their `@types/*` are devDependencies, while the two
  `@deepseek-ai/dsh-client-*` ids exist only in the loader's module table and
  are typed structurally in `src/client/shell-modules.d.ts`. The shared card
  machinery is NOT external: `scripts/build-client.mjs` aliases
  `@comecaramelos/dsh-ancesters/client` to `client/source` (the ESM surface) so
  it is bundled **into** this bundle. Modules: `index.ts` (the card descriptor
  — `mountSettingsCard` over the row's configuration form: the two blocks, the
  immediate/triggers/live field split, the summary line, the settle field, the
  toast root; `apply` = inject the stylesheet, then mount), `blocks.ts`
  (`CatalogBlock` — one section per catalog, composing the shared `RowsBlock`,
  `LinkButtonRow`, `DialogBlock` and `ErrorLine`, and owning the dialog's open
  state), `locales/` (one dictionary per tag under the plugin's namespace; the
  first tag listed is the fallback), `styles/index.ts` (the one-shot `style`-tag
  injection, called from `apply`) + `styles/DockerMcpCard.module.css` (a CSS
  Module compiled by the `dsh-css-modules` esbuild plugin: postcss check +
  minify + `<hash>_<local>` scoping, typed by `styles/css-modules.d.ts`),
  `plugin-meta.ts` (identity — `ENTRY_ID`, `PLUGIN_ID`, `BUNDLE_ID`,
  `LOCALE_NAMESPACE`, `inject`).

  There is deliberately **no** `composer.ts` and no dropdown: the profile pick
  belongs to the connection, so the manager renders the field and its composer
  pill. This half draws what the row remembers.
- `tsconfig.json` / `src/client/tsconfig.json` — host emit / client typecheck.
  `npm run build` runs both halves (`npm run build:client` is the browser half
  alone); `npm test` builds first, so the emitted `lib/*.js` are always what the
  tests load (`main`/`./client` point at `lib/`, never `src/`).
- `test/*.test.mjs` — plain `node:assert` scripts, one file per concern, run by
  the built-in runner (`npm test` → `npm run build && node --test`). They are
  scripts, not `node:test` cases: no `test()` wrappers, no assertions library.
  The browser half is exercised through `test/client.test.mjs`, which
  materializes `lib/client.js` in a `node:vm` context; the catalog rules are
  pinned on both halves against the same fixtures by `test/catalog.test.mjs`.
- `.smoke/` — manual end-to-end fixtures (fake-docker / noise-docker shims +
  `--patch` overlays). `overlay-manager.yml` boots the component next to a live
  manager row with a seeded `docker-profile` entry, which is what proves the
  kind's `resolve()` is what spawns; the others drive the shim paths.
  `args.log` is the shim's invocation log (gitignored).

## Hard constraints (do not break)

- **A component is inert without the manager.** `src/host/plugin-meta.ts` says
  `inject: ["mcpConnections"]`, and cordis does not apply a plugin whose
  injected service never answers: mounted on a profile with no manager, the row
  stays `pending (waiting for service: mcpConnections)` and `apply` never runs —
  no mirror, no runs, no card, no commands. (`dsh web` says it: `warning: 1
  entry did not activate`. That is the component model, not a misconfiguration:
  what this row has to say is only ever read through the manager's own card.)
  Once mounted, every registration the attach makes is withdrawn with the
  injection's effect, so a hot re-apply never leaves a kind standing behind a
  dead manager.
- **Kind registration is the only way a `docker-profile` connection exists.**
  The kind lands inside `ctx.inject(["mcpConnections"], …)` through a named
  `ctx.effect`; nothing else registers it, and the effect's disposer
  unregisters. Because the manager reconciles its pool the moment its own row
  applies — and that apply is what hands this component the service it stands
  on — an entry that was already standing under `docker-profile` comes back as
  "kind nobody registered". `notifyKindsChanged` moves the *picker*, it does
  not ask the kinds again, so each such entry is deliberately handed back with
  `invalidate` unless it is already `connected`/`starting`.
- **`maxEntries: 1`.** The composer pill always points at *the* connection of
  this kind, so a second one is answered `conflict` by the manager ("kind
  `docker-profile` allows at most N connection(s) — this one starts nothing"),
  never silently dropped. Nothing here may assume two live connections.
- **The connection's own fields are `extra.profile`, `extra.dockerPath`,
  `extra.stderrMode`** (plus the entry's own `args`, which stand in for the row
  config's `extraArgs` when non-empty). They win over the row config — last
  write wins — and each read falls back through the row config in this order:
  entry → `DSH_DOCKER_MCP_PROFILE` (for the profile only, via
  `launchEnvironmentOf(ctx)`, never raw `process.env`) → row config →
  `"default"`. A value the pattern `/^[A-Za-z0-9._-]{1,128}$/` refuses is never
  picked and never thrown — it is a mis-set value, not a broken row, and a
  connection answers it as a line the card shows.
- **The row's own form edits exactly five fields** — `profileEntries`,
  `executables`, `refreshNonce`, `refreshExecutablesNonce` and
  `migrationDismissed`. The row-config `profile`/`dockerPath`/`stderrMode`/
  `command` are read-only composition now: they still drive the D4 translation
  and the opening discovery run, never a live connection. A commit touching
  nothing user-authored changes no behavior, which is what keeps a live publish
  out of the commit router.
- **Every live publish ends with `notifyKindsChanged()`.** The manager re-reads
  what each `select` would answer when it is told the kinds changed, so a
  discovery run shows up in a picker without the browser half knowing a run
  happened. The call swallows a throw — the next publish says it again — and
  the manager's own `Proposals` view is never cached.
- **The row never spawns a gateway itself.** No bridge fiber, no cold-start
  `ctx.plugin(McpClient, …)`, no in-place profile switch. A connection's
  `resolve()` builds the config and the pool starts it; the only spawn-shaped
  work here is the readiness wait inside `prepare()` and the unwrapped
  discovery subprocess.
- **A migration proposal is offered never earlier than the kind registration**,
  and a dismissal is stored on this row (`migrationDismissed`), not on the
  connection and not in a hidden marker — what was turned down is *this row's*
  configuration. Nothing lands in `servers` without the person's click;
  detection only proposes and the config is read, never rewritten.
- **Gateway argv shape is fixed**: `mcp gateway run --profile <id>` plus
  `extraArgs`. Discovery uses `mcp profile list --format json` with a tolerant
  parser (bare array or wrapped under `profiles`/`items`/`data`/`results`/the
  first array value; ids from `id ?? profileID ?? profileId ?? name`). A failed
  discovery reports the first non-empty stderr line (capped), plus the "enable
  the profiles feature" hint when the CLI reports an unknown flag/command.
- **Gateway console noise is handled without touching the argv.** The stdio
  transport inherits stderr, so `"log"` (the default) launches the gateway
  through `@comecaramelos/dsh-ancesters`' `buildSpawn` — Node
  (`process.execPath`) plus the shipped `stderr-wrapper.js` — with the argv
  VERBATIM after the wrapper, so the gateway never sees a shell and the shape
  above holds as written. There is no `sh -c` script, no shell probe and no
  `fallback` answer: every platform has Node, and the log lands in ancestros'
  private per-host directory (`<tmpdir>/dsh-ancesters-bridge-XXXX/<name>-bridge.log`,
  created by `mkdtemp` and mode `0700`; the flat
  `<tmpdir>/dsh-ancesters-bridge-<name>-bridge-<pid>.log` form only when
  `tmpdir`/`pid` are pinned) instead of the `sh -c` era's
  `dsh-docker-mcp-<serverName>-gateway-<pid>.log`. `serverName` is sanitized to
  `[A-Za-z0-9_-]`, and the whole thing is strictly per-spawn: nothing is
  patched onto a shared transport. `"console"` leaves the raw command in place,
  and `gatewayStderrLog` overrides the destination. The bridge `config` carries
  ONLY `dsh-mcp-client` fields; `redirect` rides the result and becomes the
  kind's `note`, never a config key.
- **Effective stderr mode** resolves to the connection's own pick, else the row
  config `stderrMode` (`"log"`/`"console"`), else the row config `gatewayStderr`
  — `resolveStderrMode`, never a third state. Both `gatewayStderr` and
  `stderrMode` MUST keep accepting the empty string: a row that never flipped
  the switch answers `""`, and a strict non-empty check throws inside the
  commit (this bit us live: empty-home boots failed while seeded ones worked).
- **Profile ids, not display names, drive `--profile`.** `name` in a catalog row
  is UI-only: it never reaches `--profile`, the argv, or the slash command.
- **Named catalogs (both blocks)**: `profileEntries` and `executables`, each a
  list of `{ id, name }` rows. The executable block renders FIRST (a path is
  the more specific, less-changing choice). Rules that must hold:
  - **No selector anywhere in this card.** The profile and the executable a
    live connection runs with belong to the connection, which the manager
    renders on the entry it owns (with the composer pill) — a second dropdown
    here would be the same control twice, writing what is not this row's.
    `test/client.test.mjs` asserts no `Menu` is rendered.
  - Each block's rows sit behind a collapsed `<details>` disclosure ("Saved
    executables" / "Saved profiles", uncontrolled so the browser owns the open
    state), with the **fetch link as the first child of that body** — it acts
    on those rows only, and it is the dialog's only opener. The block starts
    with the stock field row; no block heading, and `.disclosure` carries no
    border (only the seam between blocks may draw one).
  - **A fetch never merges silently.** A discovery run records what it found
    only into the live volatile fields (`profiles`, `executableCandidates`) —
    it writes nothing into the saved rows, and a retry never writes them
    either. The link opens the dialog: one checkbox per answer, already-saved
    ids pre-checked and DISABLED (pruning is the row's delete button, never a
    dialog side effect), new ids unchecked, a search field, "Select all" over
    what is visible, "Add selected" merging EXACTLY the checked additions
    through `mergeEntries` (stored rows keep order and names, additions land
    last and nameless). Cancel/X write nothing. A run that found nothing opens
    no dialog — the error line states it instead. The headless mirror has no
    dialog to answer, so `/docker-refresh` performs the merge itself.
  - Row edits validate before they persist: `normalizeEntries` drops an id the
    catalog cannot use, so a blank or invalid row is never written.
  - Executable discovery (`discoverExecutables`) is **fs-only** — `X_OK` probes
    of the WSL host CLI first, then the platform install paths, then the first
    hit per `PATH` name (never the cross product). It never spawns and never
    waits on readiness, and it bumps `executableDiscoveryRevision` (its own
    counter, so the two runs never settle on each other's answer).
  - **Smoke fixtures are never catalog material**: a path carrying a `.smoke/`
    segment is rejected by `isValidEntryId` for the executables kind (host +
    client mirror, `isSmokeFixturePath`), so it is never a saved row, never a
    merged discovery, never a dialog candidate, and never appended as the
    running executable's option (`SMOKE_PATH_PATTERN`). The row-config
    `command` is NOT validated this way — the overlays keep spawning their
    shims.
- **A healthy, non-empty discovery list is authoritative.** `default` appears
  among the profile choices only when the store actually reported it; on a
  failed or empty run it stays offered as the fallback, because a failed run
  says nothing about the store. A saved row's id is kept offered either way, so
  a picked id never disappears. The same rule decides what `/docker-profile`
  refuses (`lastRefreshError === "" && profiles.length > 0`).
- **Live publication is the only Host→client channel**, and it is a shared
  mechanism now: `createLiveMirror` (from `@comecaramelos/dsh-ancesters/host`)
  owns the coalescing and the `describe()` that turns a revision into
  `settings/document-updated`; `publish.ts` owns only the answers and the
  `notifyKindsChanged()` that follows. Nothing here hand-rolls `entry.update`
  or a describe-poll loop.
- **Persistence boundary**: what persists is only the row's own user-authored
  surface — the two catalogs, the two triggers and `migrationDismissed`.
  Everything the Host answers is a **live volatile field of the same `Config`**
  (`effectiveCommand`, `effectiveSource`, `stderrEffective`, `profiles`,
  `executableCandidates`, `lastRefreshError`, `discoveryRevision`,
  `executableDiscoveryRevision`) committed without a remount and **never**
  persisted. Consequently every persisted write carries, after its own `set`,
  one `unset` for every live key (`liveMirrorKeys()`), because the write's own
  document re-answers those fields — without the clear a live answer would ride
  a save back into the patch layer and stand there as if the user had authored
  it. The mirror is re-asserted on both sides of the write (landed or refused)
  so a run's answers never go quiet because a save failed.
- **Readiness semantics**: a connection's `prepare` waits, bounded
  (`GATEWAY_READY_POLL_MS` 1500 / `GATEWAY_READY_TIMEOUT_MS` 15000), for the
  point where spawning is safe: backend-API socket connects → ready; the socket
  paths are absent everywhere while `docker version` still answers →
  `"no-backend-api"` (plain CE has no backend API to wait for); a platform with
  no known socket path answers ready immediately and never waits.
  `"timed-out"` logs one warning and runs the gateway anyway. It never stalls
  and never throws out of the readiness continuation. The wait is armed **once
  per executable path** (`state.gateCommand`), never per tick, because every
  profile id is read off the store that executable owns.
- **Discovery stays promise-chained** (no overlapping runs) and the profile run
  stands behind the readiness gate. A FAILED run arms ONE bounded retry
  (`DISCOVERY_RETRY_DELAY_MS` 15000, up to `DISCOVERY_RETRY_MAX` = 4
  consecutive, counter reset on success, timer cleared on dispose) — the
  Desktop profile store can out-reach the daemon by seconds at boot; nothing
  retries forever and no retry writes the row.
- **Slash commands** `/docker-profile` and `/docker-refresh` register through
  `ctx.inject(["commands"], …)`, so they are silently absent when no `commands`
  service answers. Registration retains every `register()` disposer in a
  plugin-ctx `ctx.effect` cleanup — the registry owns its registrations on the
  COMMANDS provider ctx, NOT this plugin, so without that cleanup a hot
  re-apply collides on the duplicate name (caught and warned, keeping the
  earlier definitions live). `/docker-profile` never invents a key: it writes
  `extra.profile` on the entry whose `kind === KIND_ID` through
  `service.update(entry.id, …)`, refuses a second word and an unknown id,
  reports "already what this connection runs with" instead of a needless
  respawn, and must not rely on `invocation.signal` (nothing is cancellable).
  A refused write says the row may be read-only (a command-line or home patch
  layer wins over an edit).
- **One profile entry per instance**, keyed by its profile entry id — the key
  every form read and write goes through (`ENTRY_ID` = `mcp-docker`). A bare
  plugin mount with no entry id has no form and must fail loud rather than
  invent a key; nothing here is derived from `serverName`, which stays only the
  tool-namespace prefix.
- **No older-model leftovers may stand in the row.** The keys the previous model
  wrote into the row are gone outright — no `fallback`, no `SH_PATH_CANDIDATES`,
  no `noteGatewayStderr`, no bridge fiber, and the row's own
  `profile`/`dockerPath`/`stderrMode` are read-only composition, not the keys a
  live connection reads. What stays is only what the row's own half still acts
  on: the catalogs, the two triggers, `command` (the executable the opening runs
  probe, and the target a seeded smoke overlay still swaps) and the composition
  defaults (`extraArgs`, `env`, `cwd`, `reconnect`, `toolCallTimeoutMs`,
  `failOnStartupError`).

## Client-bundle gotchas (cost real debugging time)

- Editor resolution: each plane has its own config, and each config's `include`
  must name its plane's sources, not just the entry. If it does not, tsserver
  falls back to an inferred project — with neither `moduleResolution: NodeNext`
  + `@types/node` (host half: `node:fs`, `node:path`, `process` show up as
  `TS2591`) nor the DOM lib (browser half: `document`/`window` unresolved, plus
  `TS2307` on every shell-seeded id). So `tsconfig.json` includes
  `src/host/**/*.ts` and `src/client/tsconfig.json` includes `**/*.ts`. The
  browser half additionally needs `react`/`react-dom` + their `@types/*` as
  devDependencies and `/// <reference path="./shell-modules.d.ts" />` in every
  module importing the two `@deepseek-ai/dsh-client-*` ids — they exist only in
  the loader's module table.
  A nested config also hits the bundle: esbuild auto-discovers the tsconfig
  next to the entry, and its `strict: false` silently drops the CJS bundle's
  `"use strict"` directive — `scripts/build-client.mjs` therefore pins
  `tsconfigRaw` instead of leaving it to discovery.
- The shared machinery is **bundled in**, not external. `@comecaramelos/dsh-ancesters/client`'
  export-map `default` is a loader *registration*, not a module surface, so
  bundling it finds nothing to import; the build aliases the specifier to
  `client/source`. Missing machinery fails the build with a message rather than
  emitting a bundle whose card renders nothing.
- React children must go in `props.children` (the 3rd `jsx()` arg is the `key`
  slot). This bit us once with `<select>` options and a `<button>`.
- The card is registered into `plugins.row.config`, keyed by
  `` `${BUNDLE_ID}#${ENTRY_ID}` `` — a component is not its own bundle: the row
  arrives through the manager bundle's patch, so the page this card registers
  into is keyed by that id, not by this package. `test/client.test.mjs` pins
  the key, the registration id, and that the only injected slot is this one
  (no `conversation.input.left` registration any more).
- **Stylesheet = CSS Module, not an inline const.** The card's rules live in
  `src/client/styles/DockerMcpCard.module.css`; the build's `dsh-css-modules`
  esbuild plugin parses it with postcss (a syntax error fails `build:client` at
  the source line), minifies it, scopes every class name to `<hash>_<local>`
  (stable FNV of the repo-relative source path) and inlines it as one module
  exporting `cssText` plus a default class-name map. `styles/index.ts` injects
  it as one `<style>` tag from `apply`, guarded by
  `data-plugin-css = "<PLUGIN_ID>/DockerMcpCard.module.css"`; importing the map
  must never inject (DOM side effects belong to `apply`). Source local names
  never reach the DOM, so the client test must never assert a literal class
  name — it matches scoped names through the `scopedClass(local)` helper
  (`[a-z0-9]{6}_<local>`).
- Locale dictionaries merge **per tag**: the tag has to match what the shared
  card machinery answers under (`en-US`), so a copy registered as `en` would be
  invisible to the dialog's own controls. The shared wording is merged under
  the plugin's own, so a collision resolves to this plugin's copy.
- A discovery wait that ends without an answer (a Host that never advances its
  counter, or a run that reported a failure) stages a one-shot notice that rides
  the page-wide toast root rather than the card — the row's page is usually
  closed while a fetch is happening, and the card must not render the toast.
  Nothing re-runs a poll: the controller stays idle until the person fetches
  again.
- `react-dom/client` (`createRoot`) is a shell seed module; a module plugin may
  require it and mount a root outside any slot. Use `createElement` (not `jsx`)
  in tests that need the raw unrendered element.

## Testing conventions

- Cross-realm values (vm-materialized bundles): compare with `JSON.stringify`,
  not `deepEqual` (prototype mismatches).
- The client test materializes `lib/client.js` in a `node:vm` context with
  stubbed `window.__ModuleLoader__`, `document`, `react`, `react/jsx-runtime`,
  and a stub configuration form answering `getSnapshot`/`subscribe`/`mutate`/
  `revision`. It asserts registration (id, slot, key), what a served snapshot
  renders (two disclosures, no `Menu`, one fetch link per catalog), that a
  fetch is a nonce write settled on the Host's answer, that the dialog's merge
  keeps a saved row's name and appends the addition, that a read-only row
  disables the links and editors instead of writing, that a failed run answers
  with the error line and no dialog, and that a refused write is retried within
  a budget rather than forever. The vm sandbox needs `setTimeout`/`clearTimeout`.
- Host behavior verified by `.smoke/` overlays booted with `dsh web --patch
  <overlay> --port N --no-open` (the `--patch` flag belongs to the `web`
  subcommand and must precede app args) — watch `.smoke/args.log` for the
  shim's argv.
- **Smoke overlays must not `insert` a row id the profile patch already
  defines** — duplicate ids fail boot. Use id-targeted `config` replacement
  (e.g. swap `command` for the shim) instead.
- **A `--patch` overlay marks the row read-only.** An entry whose config comes
  from a command-line overlay (or a home patch) answers every `settings.mutate`
  with `Configuration for "mcp-docker" is overridden by a home patch or
  command-line overlay`, so a WRITE-driven live check (the card's dialogs, the
  picker, `/docker-profile`) must carry the row in the booting profile's OWN
  patch document: that layer is writable and lands user edits exactly where a
  real install does.
### Smoke gotchas (learned the hard way)

- Boot from the repo root with `dsh` from PATH (the CLI installed with the
  running dsh; this checkout has no `node_modules/.bin/dsh`). The CLI rewrites
  `~/.dsh` at boot (`prepareProfile` regenerates `profiles/web/cordis.yml`) — a
  sandboxed agent session hits EACCES; run with wider file permissions.
- The `web` profile may already define `mcp-docker` — an overlay that inserts
  that id then fails boot on the duplicate id, so prefer id-targeted `config`
  swaps (`overlay-fake-env.yml`). Note that any row standing on its own is inert
  now (see the component-model constraint): the standalone overlays answer only
  the inert path, and argv/gateway checks need `overlay-manager.yml`.
- `.smoke/fake-docker` must keep the exec bit (git tracks mode 100755). It
  always exits 1 on `gateway run` — repeated `gateway run` lines in
  `.smoke/args.log` are the manager's pool reconnect backoff, not a loop bug.
- `DSH_HOME=<dir>` is honored (dsh-home-paths): boot against an isolated home
  when the real settings must not be touched.
- **Shared-entry hazard**: a second instance edits the **same profile entry**
  (`mcp-docker`) and both re-apply the configuration layer it writes — a test
  write hot-switches what the live connection runs with, and a profile absent
  from the real Desktop store leaves its tools broken until the value is
  restored. Restore immediately after the check, and prefer an isolated
  `DSH_HOME`.
- Expected argv: `gateway run --profile <id> …` for the profile the entry
  resolves to, exactly ONE `mcp profile list --format json` per profile
  discovery run, and one `version --format {{.Server.Version}}` probe when the
  backend socket is not there. The spawn that lands must be Node plus the
  wrapper plus the log path — never `sh -c`.
- Observables: `.smoke/args.log`, and the row's own configuration layer in the
  booting profile's patch document. After a boot with no user write the row
  must carry nothing beyond what it shipped with: a live publish persists
  nothing, so `profiles`, `lastRefreshError`, `effectiveCommand` or any
  `…Revision` appearing in that document means a live answer rode a write back
  into the layer — check the `unset` ops in `src/host/controller/persist.ts`.
- **The kind's `resolve()` is what spawns.** Boot `overlay-manager.yml` to see
  the whole chain live: the manager row, the seeded `docker-profile` entry, and
  the argv that lands. If the row config says something different from the
  entry's `extra`, the entry wins — that is the point of the overlay.
- **CRLF trap (cost hours once)**: a Windows-side git checkout
  (`core.autocrlf=true`) rewrites every dirty file to CRLF and can clear exec
  bits or append `\r` to the `.smoke/*` shims (`#!/bin/sh\r` → `exec: …: not
  found` — a fixture failure that masquerades as a plugin failure). Symptoms:
  `git diff --stat` inflated to whole files while `git diff -w` comes back
  empty; `file <path>` says `with CRLF line terminators`. Diagnose with
  `git ls-files | xargs file | grep CRLF`. Fix with `sed -i 's/\r$//' <files>`
  (and re-chmod the shims 755); files whose content already matches HEAD can
  simply go through `git checkout -- <paths>`.
- **Stderr-mode live check** with the noise shim: `overlay-manager-noise.yml`
  stands a `docker-profile` entry on `.smoke/noise-docker`, which prints
  `NOISE-GW-LINE` to stderr on every gateway run (a row standing alone can never
  print it — nothing spawns). With `extra.stderrMode: log` (the default) the
  marker is ABSENT from the dsh console and lands only in the ancestry bridge log
  under the private tmp directory; flip that extra to `console` and it echoes on
  the console instead. Live proof that the mode, not the argv, decides the noise.

## Install / dev notes

- **Editor language service = the checkout's TypeScript**: `.vscode/settings.json`
  sets `js/ts.tsdk.path` to `node_modules/typescript/lib` (a VS Code old enough
  to lack the `js/ts.*` keys needs the old `typescript.tsdk` instead).
  `@types/node` is written against the language service in that package, so
  VS Code's bundled TS can fail to read it — the symptom is host-half globals
  showing `TS2591: Cannot find name …` while `npx tsc -p tsconfig.json --noEmit`
  is clean. `tsconfig.json` also pins `"types": ["node"]`. After `npm ci` the
  running language service needs **TypeScript: Restart TS Server**.
- **npm 11 install-script allowlist**: dependency install scripts are skipped
  unless the package appears in `allowScripts`, so `package.json` carries
  `"allowScripts": { "esbuild": true }`. Without it `npm ci` warns that esbuild
  is not covered — and esbuild still appears to work, so the warning is easy to
  ignore. Check the pending list with `npm approve-scripts --allow-scripts-pending`.
- **The two checkouts this builds against must be linked**: `npm run link:local`
  symlinks `../dsh-ancesters` and `../dsh-mcp-manager` (overridable with
  `DSH_ANCESTORS_DIR` / `DSH_MCP_MANAGER_DIR`) into
  `node_modules/@comecaramelos/` so `tsc` can read their export maps. A real
  installed directory is kept, not replaced; a link that could not be created
  is warned about and shows up later as a build failure.
- The component's row arrives through the **manager** bundle's patch; installing
  this package alone installs nothing. Manual install on a WSL host where
  Windows pnpm cannot symlink: symlink the package into
  `~/.dsh/profiles/web/node_modules/@comecaramelos/` and record `"file:/abs/path"`
  in the profile `package.json` dependencies (see README).
- Live-reload caveat: `patchReload: live` re-applies **patch config**; it does
  **not** re-import changed plugin JS. JS changes need a `dsh web` restart.
- WSL + Docker Desktop (Windows side): two separate MCP stores — the Linux
  CLI's `~/.docker/mcp` (usually empty) and Desktop's
  `C:\Users\<you>\.docker\mcp`. The default `command: docker` is rewritten by
  `resolveDockerCommand()` to `/Docker/host/bin/docker.exe` when that path is
  executable on linux, else to the first `docker.exe` on the launch `PATH`
  (only the literal default is rewritten; any other `command` wins), so
  discovery and the gateway use the Desktop store with no row config. Don't try
  `DOCKER_CONFIG=/mnt/c/…` with the Linux CLI — it rejects the Windows store.
- Test writes land in the booting profile's own configuration layer (the row's
  user layer) — remove test data when done and check that nothing live-only was
  left behind.

## References

- Shared machinery this component is built on: `@comecaramelos/dsh-ancesters`
  (`attachSettingsForm`, `createLiveMirror`, `createPersister`, `buildSpawn`,
  `stderrLogPath`, `mountSettingsCard`, and the client block set). Never
  hand-roll what it already provides.
- Manager contracts, re-verified against the linked checkout: the `McpKind`
  surface (`id`/`label`/`summary`/`transport: "none"`/`maxEntries`/`fields`/
  `resolve`), the `mcpConnections` view (`registerKind`,
  `notifyKindsChanged`, `propose`, `entries`, `line`, `invalidate`, `update`)
  and what an entry over `maxEntries` answers (`state: "conflict"`). The full
  contract is the manager's `docs/knowledge/kinds.md`.
- Docs: `README.md` is for people and short; longer topics live in
  `docs/knowledge/*.md`, linked from it; agent-only rules live here.
  `docs/spec/`, `docs/plans/` and `docs/security-audit/` are local (ignored) —
  nothing versioned links to them.
- dsh contracts re-verified on upgrade: a form is the **row's own** entry config
  keyed by its profile entry `id`; only fields declared `.volatile()` on the
  `Config` may be written while the fiber is live, and writing one neither
  persists nor restarts the fiber; volatile fields are served to every client,
  so nothing sensitive may ride this channel. The user layer is the profile's
  own patch document — there is no `settings.yaml` for this plugin.
- Config defaults worth knowing: `extraArgs=[]` (appended after `--profile`),
  `toolCallTimeoutMs=60000`, `failOnStartupError=false`, `reconnect.*`
  (true/500/30000/10). `env`/`cwd` are stdio passthroughs the connection
  inherits.
- Limitations: the discovery parser is tolerant of CLI-version drift (bare
  array, wrapped, `id`/`profileID`/`profileId`/`name`) and degrades to "no
  profiles" rather than crashing. The card lists rows by their saved `name`
  (falling back to the id); recovered profiles land nameless and nothing about
  a display name reaches the gateway.
- Docker CLI: `docker mcp gateway run --profile <id>`; profile discovery
  requires the `profiles` MCP feature (`docker mcp feature enable profiles` on
  CE / the `MCPWorkingSets` flag in Docker Desktop).
