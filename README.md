# Talos

A [K8s Dockside](https://github.com/k8sdockside/k8sdockside) plugin for
clusters running [Talos Linux](https://www.talos.dev/) 1.12 to 1.15.

- **Version runway**: every machine placed on the Talos release lines, with
  the latest stable marked and the next upgrade step named. Talos upgrades go
  one minor at a time.
- **Machine board**: control plane and workers as tiles, with stage, service
  health, extensions, Secure Boot, CPU and memory. Machines that do not answer
  on the Talos API are shown as unreachable rather than hidden.
- **Machine drawer**: overview (hardware, security, extensions, Image Factory
  schematic), services with logs and restart, logs, kernel messages, network,
  disks and volumes, and etcd on the control plane.
- **Operations**: upgrade Talos (the installer keeps the machine's schematic),
  reboot, shut down, restart a service, defragment etcd, upgrade Kubernetes,
  and run a health check. Each is written out as the exact `talosctl` command,
  confirmed by you, and run in a **talosctl console** in the dock, where you
  can watch it.
- **Console**: a talosctl console in the dock, already pointed at the cluster's
  talosconfig, context and the machine you picked. `talosctl dashboard` opens
  in your own terminal.
- **Node panel**: a Talos panel in every node's detail view.

## Needs

- K8s Dockside **0.1.23** or newer (desktop app). It gives plugins
  `"ui": { "tools": [...] }`.
- `talosctl` on your machine. Its version should be within one minor of your
  machines'.
- A talosconfig. `~/.talos/config` is used unless you choose another for the
  cluster (**Change…** on the board). The context is matched to the cluster by
  its endpoints, and you can pick another.

Without talosctl or a talosconfig, the board still shows what Kubernetes knows:
versions, readiness and capacity.

## What it can run

Only the commands listed in `plugin.json` under `ui.tools`. The app checks
every command against those patterns and passes the talosconfig itself. The
plugin cannot pass `--talosconfig`, and never reads the machine config,
because it holds secrets. Commands that change anything are `run` patterns,
and the app asks you before each one.

## Releases

The release lines and their latest patches are in `RELEASES` in
[`src/model/talos.ts`](src/model/talos.ts). When Talos ships a release, update
that list. Nothing else names a version.

## Develop

```sh
npm install
npm run build      # src/ -> ui/ (commit ui/)
npm run check      # typecheck, tests, and ui/ matches a fresh build
```

Until `@k8sdockside/plugin-sdk` 1.1.0 is published, the types for
`k8sdockside.tools` are in `src/types/tools.d.ts`. Delete that file when the
devDependency moves to `^1.1.0`.

To try it, add this folder in K8s Dockside under **Settings → Plugins → Add
folder**, then open the **Talos** plugin on a Talos cluster.
