# Talos

A [K8s Dockside](https://github.com/k8sdockside/k8sdockside) plugin for
clusters running [Talos Linux](https://www.talos.dev/) 1.12 to 1.15.

- **Version runway**: every machine placed on the Talos release lines, with
  the latest stable marked and the next upgrade step named. Talos upgrades go
  one minor at a time.
- **Machine board**: control plane and workers as tiles, with stage, service
  health, extensions, Secure Boot, CPU and memory. Machines that do not answer
  on the Talos API are shown as unreachable rather than hidden.
- **Machine view**: pick a machine and it takes the page's width, with every
  machine in a list beside it -- searchable by name or address, grouped into
  control plane and workers, ↑/↓ or ‹/› to move between them, Esc back to the
  board -- so it works the same for 3 machines or 100. Overview (hardware,
  security, extensions, Image Factory schematic), services with logs and
  restart, logs (with line wrapping), kernel messages, network, disks and
  volumes, and etcd on the control plane.
- **Operations**: upgrade Talos -- the installer image is the machine's own,
  with only the version changed: the registry and installer variant (e.g.
  `factory.talos.dev` + `nocloud-installer`, a Secure Boot one, your own
  factory, or a non-factory installer such as `ghcr.io/siderolabs/installer`)
  from the machine config's `machine.install.image`, and the Image Factory
  schematic the machine runs now (`imagefactoryschematic`) -- the config's
  image is the one it was first installed from, and Talos does not update it
  on upgrade. On an app older than 0.1.33, which cannot read that field, the
  installer is assumed from the platform Talos detected (`platformmetadata`)
  and the panel says to check it. Never a downgrade;
  one minor at a time, and only from the newest patch; a new minor asks you to
  confirm you have read its upgrade notes, and alpha, beta and rc releases are
  hidden until asked for and need an extra confirmation. Also reboot, shut
  down, restart a service, defragment etcd, upgrade Kubernetes,
  and run a health check. Each is written out as the exact `talosctl` command,
  confirmed by you, and run in a **talosctl console** in the dock, where you
  can watch it.
- **Console**: a talosctl console in the dock, already pointed at the cluster's
  talosconfig, context and the machine you picked. **Dashboard · all N
  machines** on the board runs `talosctl dashboard --nodes` for every machine
  at once (switch machine with ← and →); each machine has its own button too.
  Both open in the dock, or in your own terminal if the app's Settings →
  Terminal says so.
- **Dashboard**: every machine at once, read again every 15 seconds: stage,
  service health, memory, clock sync, what needs a look, and `etcd status`
  across the control plane. Pick machines and open `talosctl dashboard` or the
  console aimed at them -- all of them when none are picked.
- **Extensions**: the system extensions across the cluster: each one's
  versions, how many machines run it and which do not, a machine-by-extension
  grid that marks differences, and the Image Factory schematics the machines
  were built from.
- **Settings**: the talosconfig in use for this cluster (where it is, whether
  it is there and readable, its contexts with their endpoints and nodes, and
  `talosctl config info` for the one in use -- never its keys), choosing
  another file or context, the endpoints talosctl connects to, and the address
  it uses for each machine, with a test for each.
- **Node panel**: a Talos panel in every node's detail view.

## Needs

- K8s Dockside **0.1.23** or newer (desktop app). It gives plugins
  `"ui": { "tools": [...] }`.
- `talosctl` on your machine. Its version should be within one minor of your
  machines'.
- A talosconfig. `~/.talos/config` is used unless you choose another for the
  cluster (**Settings**, or **Change…** on the board). The context is matched
  to the cluster by its endpoints, and you can pick another.

## Which address talosctl uses

Every command is given the machine's address with `--nodes`. Unless you say
otherwise, it is an address the talosconfig's context names for the machine,
else its **ExternalIP**, else its **InternalIP** -- on clouds such as Hetzner
the internal address is often not reachable from your computer. In
**Settings** you can change the rule for the cluster (ExternalIP first or
InternalIP first), set ExternalIP, InternalIP or an address of your own for
any machine, and choose the endpoints talosctl connects to: the
talosconfig's, ones you give, or each machine itself. Every page, the console
and the commands it runs use these. They are kept by the app for this
cluster, never in the cluster.

Without talosctl or a talosconfig, the board still shows what Kubernetes knows:
versions, readiness and capacity.

## What it can run

Only the commands listed in `plugin.json` under `ui.tools`. The app checks
every command against those patterns and passes the talosconfig itself. The
plugin cannot pass `--talosconfig`. Commands that change anything are `run`
patterns, and the app asks you before each one.

The machine config holds secrets -- certificates, tokens -- and the plugin
never sees it. The one thing the upgrade panel needs from it, the installer
image in `machine.install.image`, is declared as an *extraction*
(`{ "command": "get machineconfig **", "extract": { ... } }` among the read
patterns, K8s Dockside 0.1.33 and newer): the app runs
`talosctl get machineconfig -o yaml`, parses the output itself, and hands the
plugin only that field's value. No other pattern may run that command, and the
plugin's card in Settings says what is read.

## Releases

The pages ask K8s Dockside for the live release list of
[siderolabs/talos](https://github.com/siderolabs/talos/releases)
(`"ui": { "releases": [{ "github": "siderolabs/talos" }] }` in `plugin.json`,
K8s Dockside 0.1.33 and newer). The app asks GitHub anonymously, keeps the
answer for six hours, and can be told not to in **Settings → Notifications →
Release lists for plugins**. From that list the plugin takes the newest stable
minor, the two minors before it at their latest patch, and a newer minor that
only has pre-releases so far (`releasesFrom` in
[`src/model/talos.ts`](src/model/talos.ts)). The runway and the upgrade panel
say where the list came from: live from GitHub, the app's cached copy when
GitHub is unreachable, or the built-in table.

The built-in table, `BUILTIN_RELEASES` in the same file, is used until the live
list arrives, and instead of it on an older app, with release lists switched
off, or with GitHub unreachable and nothing cached. Update it, and
`BUILTIN_RELEASES_AS_OF`, when Talos ships a release.

## Develop

```sh
npm install
npm run build      # src/ -> ui/ (commit ui/)
npm run check      # typecheck, tests, and ui/ matches a fresh build
```

Until `@k8sdockside/plugin-sdk` 1.1.0 is published, the types for
`k8sdockside.tools` are in `src/types/tools.d.ts`, and those for
`k8sdockside.releases` in `src/types/releases.d.ts`. Delete them when the
devDependency moves to an SDK that has them.

To try it, add this folder in K8s Dockside under **Settings → Plugins → Add
folder**, then open the **Talos** plugin on a Talos cluster.
