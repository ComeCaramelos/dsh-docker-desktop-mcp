# Development

## Build and test

```sh
npm install
npm run link:local   # link ../dsh-ancesters and ../dsh-mcp-manager into node_modules
npm run build        # tsc (host half) + typecheck & bundle the browser half → lib/
npm test             # builds, then test/*.test.mjs through node --test
```

`link:local` symlinks the two sibling checkouts this component builds against into
`node_modules/@comecaramelos/` so `tsc` can read their export maps. Override the paths
with `DSH_ANCESTORS_DIR` / `DSH_MCP_MANAGER_DIR`. A real installed directory is kept, and
a link it could not create is reported.

npm 11 blocks dependency install scripts unless allowed, so `package.json` carries
`"allowScripts": { "esbuild": true }`.

## Running it in dsh

The easiest way is the manager's `node scripts/link-profile.mjs [profile]`, which links
the manager, the bundle and this checkout (when it sits next to the manager) into a
profile. Start dsh with `--no-open` so it doesn't open a browser tab on its own.

To boot against a fake Docker, `.smoke/overlay-manager.yml` shows the shape: an
`mcp-manager` row pointing at the manager checkout and an `mcp-docker` row pointing at
`lib/index.js`.

## How the code is laid out

- **Host half:** `src/index.ts` re-exports `src/host/*`; `tsc` emits ESM to
  `lib/index.js`.
- **Browser half:** ES modules under `src/client/*`, typechecked with `noEmit`
  (`src/client/tsconfig.json`) and bundled by `scripts/build-client.mjs` into
  `lib/client.js`. The modules the dsh shell provides (`react`, `react-dom/client`,
  `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-primitives`…) stay
  external; the shared card machinery from `@comecaramelos/dsh-ancesters/client` is
  bundled in.
- **Copy:** `src/client/locales/en-US.ts`, registered under `en` — dsh only reads the
  ids `en` and `zh`, so a dictionary under `en-US` would never be used.
- `lib/` is generated — never edit it by hand.
