# The component page, Fetch and the gateway log

## Who owns what

| this component | the manager |
| --- | --- |
| the `docker-profile` connection type: its fields and the command it runs | the connection list, on/off, and starting/stopping the gateway |
| what the Profile and Executable pickers offer (saved rows + what discovery found) | the connection editor and the composer pill those pickers appear in |
| its own page: saved profiles, saved executables, the two Fetch runs | every other settings screen |
| `/docker-profile`, `/docker-refresh` | — |

Without the manager the component does nothing: dsh lists it as *pending (waiting for
service: `mcpConnections`)*. That is expected — install or turn on the manager.

## The connection editor

- **Profile** — your saved profiles plus what the last discovery reported. When
  discovery works and finds profiles, that list is authoritative (`default` only shows
  if Docker reports it); when it fails or finds none, `default` stays as a fallback.
- **Docker executable** — your saved executables, then every path the scan found, then
  what the running connection actually uses.
- **Reduce gateway log output** — *Log file* (default) or *Print to console*.

These are stored on the connection itself (`extra.profile`, `extra.dockerPath`,
`extra.stderrMode`).

## The component page

It holds what the **machine** knows, not what a connection runs with: two lists, saved
executables first (a path changes less often than a profile), then saved profiles.

- Each list is collapsed behind "Saved executables" / "Saved profiles", with an
  "Add …" line for typing one in.
- **Fetch** asks the Host what it can see and opens "Choose … to add": one checkbox per
  answer, a search box and "Select all". What you already saved comes back checked and
  locked (remove it with the row's delete button). *Add selected* appends only the new
  ones; *Cancel* writes nothing.
- If a Fetch finds nothing, the dialog doesn't open and a line under the list says why.

Nothing Fetch finds is ever saved without you choosing it.

## Where the gateway log goes

With *Log file*, the gateway's stderr (catalog loads, image pulls, tool counts) goes to
`<tmp>/dsh-ancesters-bridge-XXXX/<name>-bridge.log` in a private directory (mode `0700`),
and the connection's line shows `gateway stderr → <path>`. stdout stays the MCP protocol
stream. *Print to console* sends it to the dsh console instead. Profile discovery is not
wrapped: its output is already captured.

## Settings from the standalone 0.0.x bundle

A row configured before the component existed (`profile`, `dockerPath`, `stderrMode`,
`command`, `extraArgs`…) no longer runs anything by itself. When it differs from the
defaults, the connections card offers one `docker-profile` connection carrying those
settings across. Nothing is written until you click *Create connection*; *Dismiss*
records the refusal on the row so it is not offered again.
