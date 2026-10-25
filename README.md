# @comecaramelos/dsh-docker-desktop-mcp

Connects DeepSeek Harness to the **MCP Toolkit in Docker Desktop**: each connection runs
one `docker mcp gateway run --profile <id>` gateway, and you pick the profile from the
connection editor or straight from the chat composer.

It is a **component** of the MCP connections bundle: it adds the `docker-profile`
connection type to `@comecaramelos/dsh-mcp-manager`, which owns the connection list, the
on/off switch and the live status.

## Requirements

- dsh `^0.2.0` (0.2.0 and 0.2.1), on Linux, WSL or Windows.
- Docker Desktop with the MCP profiles feature turned on (Docker CE: `docker mcp feature
  enable profiles`). Without it the profile pickers only offer the profiles you saved.

## Install

Install the bundle; this component comes with it:

```sh
dsh plugin --profile web add @comecaramelos/dsh-mcp-manager-bundle
```

Coming from the standalone 0.0.x bundle (dsh 0.1)? Remove it first — both insert the
`mcp-docker` row. Your old settings are kept: the connections card offers to create the
matching connection.

**WSL:** Docker Desktop keeps its MCP profiles on the Windows side, so when the Windows
`docker.exe` is reachable from WSL (`/Docker/host/bin/docker.exe`, or on your `PATH`) it
is used for discovery and for the gateway. Set the connection's executable to another
path to opt out.

## Use it

1. Plugins → MCP connections → **MCP connections** → *Add connection*, kind
   **Docker MCP Toolkit**.
2. Pick a **Profile** and the **Docker executable** to run it with. *Reduce
   gateway log output* (on by default) keeps the gateway's progress lines out of the dsh
   console and in a log file; the path shows under the connection.
3. Turn it on. Its line shows `connected` and how many tools the gateway publishes.

While the connection is on, a pill with the Docker mark under the chat box switches the
profile without opening settings. Only one Docker connection is allowed.

The component's own page (Plugins → MCP connections → **Docker MCP Toolkit**) keeps what
this machine knows: your saved profiles and saved executables, each with a **Fetch**
button that asks Docker what it can see and lets you pick what to add. Details in
[docs/knowledge/card.md](docs/knowledge/card.md).

### Slash commands

- `/docker-profile <profile-id>` — switches the running connection to that profile.
  With no argument it lists the profiles it knows.
- `/docker-refresh` — asks Docker again for its profiles and adds new ones to the saved
  list.

## More

- [docs/knowledge/card.md](docs/knowledge/card.md) — the component page, Fetch, and
  where the gateway log goes.
- [docs/knowledge/development.md](docs/knowledge/development.md) — building and testing
  from a checkout.
- [CONTRIBUTING](CONTRIBUTING.md) · [AGENTS.md](AGENTS.md) (for coding agents)

---

> # Legal notice
>
> This is an independent plugin that connects DeepSeek Harness to the MCP
> Toolkit in Docker Desktop. It is not affiliated with, endorsed by, or
> sponsored by Docker, Inc.
>
> Docker is a trademark or registered trademark of Docker, Inc. in the United
> States and/or other countries.

[`CONTRIBUTING`](CONTRIBUTING.md) | [`LICENSE`](LICENSE.md)
