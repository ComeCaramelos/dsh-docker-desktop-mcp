# Contributing

Thanks for your interest in improving this plugin! For the technical map of the
codebase, see [`AGENTS.md`](AGENTS.md).

## Local development

```sh
npm install
npm test
```

- Tests are plain `node:assert` scripts, discovered by `npm test` (`npm run build && node --test`). A single file can also be run on its own: `node test/<name>.test.mjs`.
- npm 11 skips dependency install scripts unless the package is allowed, and `esbuild` has one (`install.js`). The root `package.json` therefore carries `"allowScripts": { "esbuild": true }`; without it a clean `npm ci` prints `npm warn install-scripts … esbuild … not yet covered by allowScripts` and esbuild only works because its optional platform package happens to land in `node_modules/@esbuild/`. The entry is name-only rather than `esbuild@<version>`-pinned so an esbuild bump does not need re-approving; to see what is waiting, `npm approve-scripts --allow-scripts-pending`.
- The editor must typecheck with **this checkout's** TypeScript, not the one VS Code ships: `.vscode/settings.json` sets `js/ts.tsdk.path` to `node_modules/typescript/lib` (the current key — VS Code unified the old `javascript.*` / `typescript.*` pairs under `js/ts.*`, so the old `typescript.tsdk` still works but shows a deprecation squiggle on the settings file), and `tsconfig.json` pins `"types": ["node"]`. If you still see `TS2591: Cannot find name 'process'` (or `node:fs`/`node:path` reported as names) right after `npm ci`, it is the language service running against `@types/node` it cannot parse, or holding a program built before the install — run **TypeScript: Restart TS Server** and pick **Use Workspace Version** via the version picker in the status bar. . `npx tsc -p tsconfig.json --noEmit` staying clean is the proof that the source and config are fine. On a VS Code that predates the `js/ts.*` unification the keys have their old names (`typescript.tsdk`, `typescript.enablePromptUseWorkspaceTsdk`) — nothing else about the setup changes.
- End-to-end host behavior is exercised by the `.smoke/` overlays — see *Testing conventions* in [`AGENTS.md`](AGENTS.md).

## Releases (git-flow)

Setup git hook:

```sh
chmod +x .githooks/*
git config core.hooksPath .githooks
```

[Tag](https://semver.org/) and branch conventions:

| Item | Value |
| --- | --- |
| Development branch | `develop` |
| Master branch | `main` |
| Release branch | `release/X.Y.Z` |
| Version tag | `vX.Y.Z` |

### One-time setup per clone

The version in `package.json` is stamped automatically by a git hook when a `release/X.Y.Z` branch is created (see `.githooks/post-checkout`):

```bash
git config core.hooksPath .githooks
```

The hook derives `X.Y.Z` from the branch name, writes it to `package.json` and commits it, so the version is set before any release work starts. It is a no-op on all other branches and idempotent when re-checking out an existing release branch. If the hook is not active, do the bump manually on the release branch:

```bash
npm version X.Y.Z --no-git-tag-version
git commit -am "chore(release): version X.Y.Z"
```

### Release flow (Sourcetree or CLI)

1. **Start release** — `git flow release start X.Y.Z` (Sourcetree: *Git Flow → Start Release*). The version bump commit is created automatically by the `post-checkout` hook.
2. **Finish release** — `git flow release finish vX.Y.Z` (Sourcetree: *Git Flow → Finish Release*, tag name `vX.Y.Z`). Merges `release/X.Y.Z` into `main` and `develop` and tags the `main` merge commit.

    The tag name **must include the `v` prefix**: git-flow's default tag name is the bare `X.Y.Z`, which does not match the `v*` tag convention.
3. **Push** the tag (and the updated branches) to GitHub.
4. **Publish** — on a checkout of the `vX.Y.Z` tag: `npm publish`. The published package carries the version stamped by the hook in step 1 (`npm pkg get version`).
