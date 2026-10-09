// What the plugin knows about Talos: how talosctl writes things, which
// releases there are, and how a cluster's machines are read from Kubernetes.
// No DOM and no bridge here, so all of it is tested.

// ----- releases ----------------------------------------------------------------------------

/** A Talos minor release line, as the plugin knows it. */
export interface Release {
    minor: string; // "1.14"
    /** The newest patch the plugin knows of. */
    latest: string; // "v1.14.2"
    status: 'stable' | 'previous' | 'alpha';
}

/**
 * The release lines the plugin covers, oldest first. Edit here when a release
 * ships: nothing else in the plugin names a version.
 */
export const RELEASES: Release[] = [
    { minor: '1.12', latest: 'v1.12.0', status: 'previous' },
    { minor: '1.13', latest: 'v1.13.0', status: 'previous' },
    { minor: '1.14', latest: 'v1.14.2', status: 'stable' },
    { minor: '1.15', latest: 'v1.15.0-alpha.0', status: 'alpha' },
];

export const LATEST_STABLE = RELEASES.filter((r) => r.status === 'stable').at(-1)!;

export interface Version {
    major: number;
    minor: number;
    patch: number;
    pre: string;
    raw: string;
}

/** "v1.14.2", "1.14.2", "Talos (v1.14.2)", "v1.15.0-alpha.1" -> a version; null for anything else. */
export function parseVersion(text: string | undefined | null): Version | null {
    const m = /v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(text ?? '');
    if (!m) return null;
    const [, major = '0', minor = '0', patch = '0', pre = ''] = m;
    return { major: +major, minor: +minor, patch: +patch, pre, raw: `v${major}.${minor}.${patch}${pre ? '-' + pre : ''}` };
}

export function compareVersions(a: Version, b: Version): number {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    if (a.patch !== b.patch) return a.patch - b.patch;
    // A pre-release comes before its release.
    if (a.pre === b.pre) return 0;
    if (!a.pre) return 1;
    if (!b.pre) return -1;
    return a.pre < b.pre ? -1 : 1;
}

export function minorOf(v: Version): string {
    return `${v.major}.${v.minor}`;
}

export function releaseOf(v: Version): Release | undefined {
    return RELEASES.find((r) => r.minor === minorOf(v));
}

/** Where a machine's version stands. */
export type Standing = 'current' | 'patch' | 'behind' | 'ahead' | 'unsupported' | 'unknown';

/**
 * How a version compares with the newest stable release: current, a patch
 * behind, a minor or more behind, on a newer (alpha) line, or older than the
 * plugin covers.
 */
export function standing(v: Version | null): Standing {
    if (!v) return 'unknown';
    const latest = parseVersion(LATEST_STABLE.latest)!;
    if (v.major === latest.major && v.minor === latest.minor) return compareVersions(v, latest) >= 0 ? 'current' : 'patch';
    if (compareVersions(v, latest) > 0) return 'ahead';
    return releaseOf(v) ? 'behind' : 'unsupported';
}

/**
 * The next upgrade for a machine. Talos upgrades go one minor at a time, to
 * the newest patch of each: 1.12 -> 1.13 -> 1.14. A machine on the latest
 * stable has none; one on an alpha line moves to that line's latest.
 */
export function nextUpgrade(v: Version | null): Release | null {
    if (!v) return null;
    const current = releaseOf(v);
    if (current && compareVersions(v, parseVersion(current.latest)!) < 0) return current;
    const latest = parseVersion(LATEST_STABLE.latest)!;
    if (compareVersions(v, latest) >= 0) return null;
    const next = RELEASES.find((r) => {
        const rv = parseVersion(r.latest)!;
        return r.status !== 'alpha' && (rv.major > v.major || (rv.major === v.major && rv.minor === v.minor + 1));
    });
    return next ?? LATEST_STABLE;
}

/**
 * The installer image for a version. A machine built by the Image Factory
 * carries its schematic id as the "schematic" extension, and must be upgraded
 * to an installer of the same schematic, or it loses its extensions.
 */
export function installerImage(version: string, schematic: string): string {
    const tag = version.startsWith('v') ? version : `v${version}`;
    return schematic ? `factory.talos.dev/metal-installer/${schematic}:${tag}` : `ghcr.io/siderolabs/installer:${tag}`;
}

// ----- talosctl's output -----------------------------------------------------------------

/** One resource as `talosctl get -o json` writes it. */
export interface Resource<S = Record<string, unknown>> {
    node: string;
    metadata: { id: string | number; namespace?: string; type?: string; phase?: string; updated?: string; version?: number };
    spec: S;
}

/** `talosctl get -o json` writes one pretty-printed object after another, not an array. */
export function parseResources<S = Record<string, unknown>>(stdout: string): Resource<S>[] {
    const out: Resource<S>[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < stdout.length; i++) {
        const ch = stdout[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0 && start >= 0) {
                out.push(JSON.parse(stdout.slice(start, i + 1)) as Resource<S>);
                start = -1;
            }
        }
    }
    return out;
}

/** One context in a talosconfig, from `talosctl config contexts`. */
export interface TalosContext {
    name: string;
    current: boolean;
    endpoints: string[];
    nodes: string[];
}

/**
 * Reads the table `talosctl config contexts` prints. Columns can be empty, so
 * they are cut where the header's columns start rather than on whitespace.
 */
export function parseContexts(stdout: string): TalosContext[] {
    const lines = stdout.split('\n').filter((l) => l.trim() !== '');
    const header = lines.shift();
    if (!header) return [];
    const cols = ['CURRENT', 'NAME', 'ENDPOINTS', 'NODES'].map((c) => header.indexOf(c));
    if (cols.some((c) => c < 0)) return [];
    const cut = (line: string, i: number) => line.slice(cols[i], cols[i + 1]).trim();
    const list = (text: string) => text.split(',').map((s) => s.trim()).filter(Boolean);
    return lines.map((line) => ({
        current: cut(line, 0) === '*',
        name: cut(line, 1),
        endpoints: list(cut(line, 2)),
        nodes: list(cut(line, 3)),
    })).filter((c) => c.name !== '');
}

/**
 * The context that belongs to a cluster: one whose endpoints or nodes are
 * among the cluster's node addresses, else the talosconfig's current one.
 */
export function matchContext(contexts: TalosContext[], addresses: string[]): TalosContext | null {
    const host = (e: string) => e.replace(/^https?:\/\//, '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    const known = new Set(addresses);
    return (
        contexts.find((c) => [...c.endpoints, ...c.nodes].some((e) => known.has(host(e)))) ??
        contexts.find((c) => c.current) ??
        contexts[0] ??
        null
    );
}

// ----- machines, as Kubernetes knows them ----------------------------------------------------

export interface NodeObject {
    metadata: { name: string; labels?: Record<string, string>; creationTimestamp?: string };
    spec?: { unschedulable?: boolean };
    status?: {
        addresses?: { type: string; address: string }[];
        nodeInfo?: { osImage?: string; kernelVersion?: string; kubeletVersion?: string; architecture?: string; containerRuntimeVersion?: string };
        conditions?: { type: string; status: string }[];
        capacity?: Record<string, string>;
    };
}

/** One machine on the board. */
export interface Machine {
    name: string;
    address: string;
    controlPlane: boolean;
    /** Talos's version, from the node's OS image; null when it is not Talos. */
    talos: Version | null;
    kubelet: string;
    kernel: string;
    arch: string;
    ready: boolean;
    cordoned: boolean;
    cpu: string;
    memory: string;
}

export function machineOf(node: NodeObject): Machine {
    const labels = node.metadata.labels ?? {};
    const addresses = node.status?.addresses ?? [];
    const info = node.status?.nodeInfo ?? {};
    const os = info.osImage ?? '';
    return {
        name: node.metadata.name,
        address: addresses.find((a) => a.type === 'InternalIP')?.address ?? addresses.find((a) => a.type === 'ExternalIP')?.address ?? '',
        controlPlane: 'node-role.kubernetes.io/control-plane' in labels || 'node-role.kubernetes.io/master' in labels,
        talos: /talos/i.test(os) ? parseVersion(os) : null,
        kubelet: info.kubeletVersion ?? '',
        kernel: info.kernelVersion ?? '',
        arch: info.architecture ?? '',
        ready: (node.status?.conditions ?? []).some((c) => c.type === 'Ready' && c.status === 'True'),
        cordoned: !!node.spec?.unschedulable,
        cpu: node.status?.capacity?.cpu ?? '',
        memory: memoryText(node.status?.capacity?.memory ?? ''),
    };
}

/** "16384Ki" -> "16 GiB". */
export function memoryText(quantity: string): string {
    const m = /^(\d+)(Ki|Mi|Gi)?$/.exec(quantity);
    if (!m) return quantity;
    const unit: Record<string, number> = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3 };
    const bytes = Number(m[1]) * (unit[m[2] ?? ''] ?? 1);
    const gib = bytes / 1024 ** 3;
    return gib >= 10 ? `${Math.round(gib)} GiB` : `${gib.toFixed(1)} GiB`;
}

/** Control plane first, then by name. */
export function sortMachines(machines: Machine[]): Machine[] {
    return [...machines].sort((a, b) => Number(b.controlPlane) - Number(a.controlPlane) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// ----- what talosctl says about a machine -----------------------------------------------------

export interface MachineStatus {
    stage: string;
    status?: { ready?: boolean; unmetConditions?: { name: string; reason: string }[] };
}

export interface ServiceSpec {
    running: boolean;
    healthy: boolean;
    unknown: boolean;
}

export interface ExtensionSpec {
    image?: string;
    metadata?: { name?: string; version?: string; author?: string; description?: string };
}

export interface SecuritySpec {
    secureBoot?: boolean;
    moduleSignatureEnforced?: boolean;
    selinuxState?: string;
}

/** The schematic id a machine was built from, from its "schematic" extension; '' when none. */
export function schematicOf(extensions: Resource<ExtensionSpec>[]): string {
    return extensions.find((e) => e.spec.metadata?.name === 'schematic')?.spec.metadata?.version ?? '';
}

/** Extensions a person installed: the schematic and modules marker are not extensions to them. */
export function realExtensions(extensions: Resource<ExtensionSpec>[]): Resource<ExtensionSpec>[] {
    return extensions.filter((e) => !['schematic', 'modules.dep'].includes(e.spec.metadata?.name ?? ''));
}

export type Health = 'healthy' | 'running' | 'stopped' | 'unknown';

export function serviceHealth(s: ServiceSpec): Health {
    if (s.unknown) return 'unknown';
    if (!s.running) return 'stopped';
    return s.healthy ? 'healthy' : 'running';
}

/** How a stage reads, and how worried to be about it. */
export function stageTone(stage: string): 'ok' | 'warn' | 'error' | 'info' {
    switch (stage) {
        case 'running':
            return 'ok';
        case 'booting':
        case 'installing':
        case 'upgrading':
        case 'rebooting':
        case 'resetting':
        case 'shutting down':
            return 'warn';
        case 'maintenance':
            return 'info';
        default:
            return 'error';
    }
}

/** talosctl's own words for a machine that did not answer, cut to the reason. */
export function shortError(text: string): string {
    if (/no route to host|connection refused|i\/o timeout|deadline exceeded|connection error/i.test(text)) return 'not reachable on the Talos API';
    if (/certificate|x509|tls:/i.test(text)) return 'the talosconfig is not accepted: ' + text.trim().slice(0, 200);
    const descs = [...text.matchAll(/desc = ([^"\n]+)/g)].map((m) => m[1] ?? '');
    return (descs.at(-1) ?? text).trim().slice(0, 200);
}
