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
 * The release lines the plugin covers, oldest first, from
 * github.com/siderolabs/talos/releases, as they stood on BUILTIN_RELEASES_AS_OF.
 * The pages ask the app for the live list (`k8sdockside.releases`, K8s Dockside
 * 0.1.33 and newer) and use this only until it arrives, or when it cannot:
 * an older app, release lists switched off, GitHub unreachable with nothing
 * cached. Edit it, and the date, when a release ships, so that fallback stays
 * close.
 */
export const BUILTIN_RELEASES: readonly Release[] = [
    { minor: '1.12', latest: 'v1.12.12', status: 'previous' },
    { minor: '1.13', latest: 'v1.13.12', status: 'previous' },
    { minor: '1.14', latest: 'v1.14.5', status: 'stable' },
    { minor: '1.15', latest: 'v1.15.0-alpha.1', status: 'alpha' },
];

/** When BUILTIN_RELEASES was last checked against the Talos releases, `YYYY-MM-DD`. */
export const BUILTIN_RELEASES_AS_OF = '2026-10-26';

/** The repository the live list is asked for. Declared in plugin.json's `ui.releases`. */
export const TALOS_REPO = 'siderolabs/talos';

/** Where the releases in use came from. */
export interface ReleaseSource {
    /** `live`: from GitHub through the app. `builtin`: BUILTIN_RELEASES. */
    kind: 'live' | 'builtin';
    /** For `live`, when GitHub last answered (RFC 3339); for `builtin`, BUILTIN_RELEASES_AS_OF. */
    asOf: string;
    /** For `live`: GitHub could not be asked just now, and this is the app's cached copy. */
    stale: boolean;
}

/** One release as `k8sdockside.releases` hands it over; only these fields are read. */
export interface GitHubReleaseLike {
    tag: string;
    prerelease?: boolean;
    draft?: boolean;
}

interface Known {
    releases: Release[];
    stable: Release;
    source: ReleaseSource;
}

function knownFrom(list: readonly Release[], source: ReleaseSource): Known | null {
    const stable = list.filter((r) => r.status === 'stable').at(-1);
    return stable ? { releases: [...list], stable, source } : null;
}

const BUILTIN: Known = knownFrom(BUILTIN_RELEASES, { kind: 'builtin', asOf: BUILTIN_RELEASES_AS_OF, stale: false })!;

/**
 * The releases in use: the built-in table until live data replaces it. Read
 * through releases(), latestStable() and releaseSource() every time -- never
 * keep what they return across a render, or the page goes on drawing the
 * table it started with.
 */
let known: Known = BUILTIN;

/** The release lines in use, oldest first. */
export function releases(): readonly Release[] {
    return known.releases;
}

/** The newest stable line in use. */
export function latestStable(): Release {
    return known.stable;
}

/** Where the releases in use came from. */
export function releaseSource(): ReleaseSource {
    return known.source;
}

/**
 * Puts a list of release lines in use, from GitHub say. A list without a
 * stable line is refused and the one in use kept; answers whether it was
 * taken.
 */
export function useReleases(list: readonly Release[], source: ReleaseSource): boolean {
    const next = knownFrom(list, source);
    if (!next) return false;
    known = next;
    return true;
}

/** Back to the built-in table. */
export function resetReleases(): void {
    known = BUILTIN;
}

/** A tag as Talos writes one: v1.14.5, v1.15.0-alpha.1, v1.14.0-rc.0. */
const TAG = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** How many minor lines before the stable one are kept: the plugin covers the stable line and the two before it. */
const PREVIOUS_LINES = 2;

/**
 * Turns GitHub's releases of siderolabs/talos into the plugin's release lines,
 * oldest first: the newest stable minor (the highest that has a release that
 * is not a pre-release), the PREVIOUS_LINES minors before it, each at its
 * newest patch, and a newer minor that so far has only pre-releases, at its
 * newest pre-release, as `alpha`. Drafts and tags that are not versions are
 * ignored. A previous line GitHub's list is too short to reach is taken from
 * `fallback`. Empty when the list has no stable release at all.
 */
export function releasesFrom(list: readonly GitHubReleaseLike[], fallback: readonly Release[] = BUILTIN_RELEASES): Release[] {
    const lines = new Map<string, { at: Version; final: Version | null; pre: Version | null }>();
    for (const r of list) {
        if (!r || r.draft || typeof r.tag !== 'string' || !TAG.test(r.tag.trim())) continue;
        const v = parseVersion(r.tag.trim());
        if (!v) continue;
        const key = minorOf(v);
        const line = lines.get(key) ?? { at: v, final: null, pre: null };
        if (r.prerelease || v.pre) {
            if (!line.pre || compareVersions(v, line.pre) > 0) line.pre = v;
        } else if (!line.final || compareVersions(v, line.final) > 0) {
            line.final = v;
        }
        lines.set(key, line);
    }
    const order = [...lines.values()].sort((a, b) => compareVersions(lineStart(a.at), lineStart(b.at)));
    const finals = order.filter((l) => l.final);
    const stable = finals.at(-1);
    if (!stable) return [];

    const out: Release[] = [];
    for (const l of finals.slice(-1 - PREVIOUS_LINES, -1)) {
        out.push({ minor: minorOf(l.at), latest: l.final!.raw, status: 'previous' });
    }
    // Too few previous lines in GitHub's list (it is the latest hundred
    // releases): the fallback's, if it has older lines than those found.
    const stableV = lineStart(stable.at);
    const older = fallback
        .filter((r) => r.status !== 'alpha' && compareVersions(lineStart(parseVersion(r.latest)!), stableV) < 0)
        .filter((r) => !out.some((o) => o.minor === r.minor))
        .map((r) => ({ ...r, status: 'previous' as const }));
    while (out.length < PREVIOUS_LINES && older.length) out.unshift(older.pop()!);
    out.sort((a, b) => compareVersions(parseVersion(a.latest)!, parseVersion(b.latest)!));

    out.push({ minor: minorOf(stable.at), latest: stable.final!.raw, status: 'stable' });
    const ahead = order.filter((l) => !l.final && l.pre && compareVersions(lineStart(l.at), stableV) > 0).at(-1);
    if (ahead) out.push({ minor: minorOf(ahead.at), latest: ahead.pre!.raw, status: 'alpha' });
    return out;
}

/** The first version of v's minor line, to order lines by. */
function lineStart(v: Version): Version {
    return { major: v.major, minor: v.minor, patch: 0, pre: '', raw: `v${v.major}.${v.minor}.0` };
}

/**
 * Where the releases in use came from, in a few words: "live from GitHub,
 * read 14:02", "… (cached, GitHub unreachable)", or "built in, as of
 * 2026-10-26". `format` writes an RFC 3339 time the way the user wants.
 */
export function releasesNote(source: ReleaseSource, format: (iso: string) => string): string {
    if (source.kind === 'builtin') return `built in, as of ${source.asOf}`;
    const read = `live from GitHub, read ${format(source.asOf)}`;
    return source.stale ? `${read} (cached, GitHub unreachable)` : read;
}

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
    return releases().find((r) => r.minor === minorOf(v));
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
    const latest = parseVersion(latestStable().latest)!;
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
    const stable = latestStable();
    const latest = parseVersion(stable.latest)!;
    if (compareVersions(v, latest) >= 0) return null;
    const next = releases().find((r) => {
        const rv = parseVersion(r.latest)!;
        return r.status !== 'alpha' && (rv.major > v.major || (rv.major === v.major && rv.minor === v.minor + 1));
    });
    return next ?? stable;
}

/** `talosctl get imagefactoryschematic`: the factory a machine was built by, and the schematic. */
export interface FactorySpec {
    schematicId?: string;
    flavor?: string;
    apiUrl?: string;
}

/** `talosctl get platformmetadata`: metal, nocloud, aws, hcloud, ... */
export interface PlatformSpec {
    platform?: string;
}

/** An image reference, taken apart: `registry/path:tag@digest`. */
export interface ImageRef {
    /** `host[:port]`; '' when the reference names none (Docker Hub). */
    registry: string;
    /** The repository path under the registry, e.g. `siderolabs/installer`. */
    path: string;
    tag: string;
    digest: string;
}

/** Takes an image reference apart; null for one that is not. */
export function parseImageRef(image: string): ImageRef | null {
    let rest = image.trim();
    if (!rest || /\s/.test(rest)) return null;
    let digest = '';
    const at = rest.indexOf('@');
    if (at >= 0) {
        digest = rest.slice(at + 1);
        rest = rest.slice(0, at);
    }
    let tag = '';
    const colon = rest.lastIndexOf(':');
    if (colon > rest.lastIndexOf('/')) {
        tag = rest.slice(colon + 1);
        rest = rest.slice(0, colon);
    }
    const parts = rest.split('/');
    let registry = '';
    if (parts.length > 1 && (parts[0]!.includes('.') || parts[0]!.includes(':') || parts[0] === 'localhost')) registry = parts.shift()!;
    if (!parts.length || parts.some((p) => !p)) return null;
    return { registry, path: parts.join('/'), tag, digest };
}

/**
 * An installer image taken apart. An Image Factory one -- on
 * factory.talos.dev or a factory of your own -- is
 * `<host>/<variant>/<schematic>:<tag>`, the variant being the platform's
 * installer (`nocloud-installer`, `metal-installer-secureboot`, or plain
 * `installer`). Anything else -- `ghcr.io/siderolabs/installer`, an installer
 * of your own -- has no schematic, and its whole path is the variant.
 */
export interface InstallerRef extends ImageRef {
    factory: boolean;
    /** Where the variant sits: the registry, and any path before the variant (a mirror's `registry/factory`). */
    host: string;
    variant: string;
    schematic: string;
}

export function parseInstallerImage(image: string): InstallerRef | null {
    const ref = parseImageRef(image);
    if (!ref) return null;
    const segs = ref.path.split('/');
    const n = segs.length;
    const factory = !!ref.registry && n >= 2 && /(^|-)installer(-secureboot)?$/.test(segs[n - 2]!) && /^[0-9a-f]+$/.test(segs[n - 1]!);
    if (!factory) return { ...ref, factory, host: ref.registry, variant: ref.path, schematic: '' };
    return { ...ref, factory, host: [ref.registry, ...segs.slice(0, n - 2)].join('/'), variant: segs[n - 2]!, schematic: segs[n - 1]! };
}

/**
 * Where a machine's next installer comes from. An upgrade keeps everything
 * but the version: the same registry, the same platform's installer, Secure
 * Boot or not, and the schematic the machine runs, so it keeps its extensions.
 *
 * The platform's installer is known for certain only from the machine
 * config's `machine.install.image` -- `platformmetadata` says what Talos
 * detected at boot, `metal` on a KubeVirt machine installed with the nocloud
 * installer. The app reads that one field for the plugin (an extraction in
 * plugin.json) and the plugin never sees the rest of the config, which holds
 * secrets. But Talos does not rewrite install.image on `talosctl upgrade
 * --image`: it is the image the machine was first installed from, so its
 * schematic and version are stale. Hence the parts: host and variant from the
 * config, the schematic from the running machine (`imagefactoryschematic`),
 * the version the user picks.
 */
export interface InstallSource {
    /** Where the host and variant came from: the machine config's install image, or the machine alone (assumed). */
    from: 'config' | 'machine';
    /** The registry, `host[:port]`: the factory's, or the installer's; '' for the stock installer. */
    factory: string;
    /** The installer's path: `nocloud-installer`, `metal-installer-secureboot`; for a non-factory image its repository path. */
    variant: string;
    schematic: string;
    /** Where the schematic came from: the running machine, or (stale) the config's image. */
    schematicFrom: 'machine' | 'config' | '';
    /** The platform Talos detected at boot; only a guess at the installer. */
    platform: string;
    secureBoot: boolean;
    /** Whether the image's parts were read rather than assumed. */
    known: boolean;
    /** For an installer that is not from an Image Factory: its repository, kept as it is. */
    repository: string;
    /** The machine config's install image, as read; '' when it could not be. */
    configImage: string;
    /** Something to check, in words; '' when there is nothing. */
    note: string;
}

/** The host and port of a factory URL, which is its registry too; empty for anything that is not a URL. */
function registryHost(url: string | undefined): string {
    if (!url) return '';
    try {
        return new URL(url).host;
    } catch {
        return '';
    }
}

/**
 * Works out the installer source. `configImage` is the machine config's
 * `machine.install.image`, when the app could read it for the plugin;
 * without it, the factory and platform the machine reports are assumed.
 */
export function installSource(
    factory: FactorySpec | undefined,
    platform: PlatformSpec | undefined,
    secureBoot: boolean | undefined,
    schematicFromExtensions: string,
    configImage?: string | null,
): InstallSource {
    const running = factory?.schematicId || schematicFromExtensions;
    const host = registryHost(factory?.apiUrl);
    const base = {
        platform: platform?.platform || 'metal',
        secureBoot: !!secureBoot,
        configImage: configImage?.trim() ?? '',
        note: '',
        repository: '',
    };
    const ref = configImage ? parseInstallerImage(configImage) : null;
    if (ref?.factory) {
        return {
            ...base,
            from: 'config',
            factory: ref.host,
            variant: ref.variant,
            schematic: running || ref.schematic,
            schematicFrom: running ? 'machine' : 'config',
            secureBoot: ref.variant.endsWith('-secureboot'),
            known: !!running,
            note: running ? '' : 'The schematic is the one the machine was first installed with -- the machine did not say which it runs now. Check the image.',
        };
    }
    if (ref) {
        // Not a factory's: kept as it is, only the tag changed. A machine that
        // runs a factory schematic all the same was upgraded to one since, and
        // this image would not have its extensions.
        const repository = ref.registry ? `${ref.registry}/${ref.path}` : ref.path;
        return {
            ...base,
            from: 'config',
            factory: ref.registry,
            variant: ref.variant,
            schematic: '',
            schematicFrom: '',
            repository,
            known: true,
            note: running
                ? `The machine runs Image Factory schematic ${running.slice(0, 12)}…, but its machine config installs from ${repository}, which is not a factory image and may not have that schematic's extensions. Check the image.`
                : '',
        };
    }
    return {
        ...base,
        from: 'machine',
        factory: running ? host || 'factory.talos.dev' : '',
        variant: running ? `${base.platform}-installer${base.secureBoot ? '-secureboot' : ''}` : 'siderolabs/installer',
        schematic: running,
        schematicFrom: running ? 'machine' : '',
        known: !!(platform?.platform && (!running || host)),
    };
}

/**
 * The installer image for a version: the machine's own, with the version
 * changed. A factory-built machine gets `<host>/<variant>/<schematic>:<version>`;
 * one installed from an installer that is not a factory's gets that
 * installer's repository; one with neither the stock `ghcr.io/siderolabs/installer`.
 */
export function installerImage(version: string, src: InstallSource): string {
    const tag = version.startsWith('v') ? version : `v${version}`;
    if (src.repository) return `${src.repository}:${tag}`;
    if (!src.schematic) return `ghcr.io/siderolabs/installer:${tag}`;
    return `${src.factory}/${src.variant}/${src.schematic}:${tag}`;
}

/** The version an installer image is tagged with; null when the tag is not one. */
export function imageVersion(image: string): Version | null {
    const at = image.lastIndexOf(':');
    if (at < 0 || image.slice(at).includes('/')) return null;
    return parseVersion(image.slice(at + 1));
}

/**
 * What kind of step an upgrade is. Each asks for more care than the last: a
 * patch is the same release line; a minor can change a great deal -- the
 * machine config's format, multi-document configs, options removed -- and an
 * alpha, beta or rc is experimental.
 */
export type UpgradeKind = 'patch' | 'minor' | 'prerelease';

export interface UpgradeOption {
    version: string;
    kind: UpgradeKind;
    /** The one to take next: the newest patch of this line, else the next line. */
    next: boolean;
}

/**
 * The versions a machine may be upgraded to. Never one older than or equal to
 * what it runs: downgrades are not offered, even where Talos would allow them.
 * One minor at a time, as Talos requires, and the next minor only from the
 * newest patch of this one. Pre-releases only when asked for.
 */
export function upgradeOptions(v: Version | null, withPrereleases: boolean): UpgradeOption[] {
    if (!v) return [];
    const out: UpgradeOption[] = [];
    const kindOf = (to: Version, sameLine: boolean): UpgradeKind => (to.pre ? 'prerelease' : sameLine ? 'patch' : 'minor');
    let onNewestPatch = true;
    for (const r of releases()) {
        const to = parseVersion(r.latest);
        if (!to || compareVersions(to, v) <= 0) continue;
        const sameLine = to.major === v.major && to.minor === v.minor;
        const nextLine = to.major === v.major && to.minor === v.minor + 1;
        if (!sameLine && !nextLine) continue;
        if (to.pre && !withPrereleases) continue;
        if (sameLine && !to.pre) onNewestPatch = false;
        out.push({ version: r.latest, kind: kindOf(to, sameLine), next: false });
    }
    // The next minor waits until this line's newest patch is on.
    const allowed = onNewestPatch ? out : out.filter((o) => o.kind !== 'minor' && !(o.kind === 'prerelease' && !sameMinor(o.version, v)));
    const first = allowed.find((o) => o.kind !== 'prerelease') ?? allowed[0];
    if (first) first.next = true;
    return allowed;
}

/**
 * The pre-releases newer than a machine that upgradeOptions does not offer,
 * each with why: so asking for pre-releases never looks like it did nothing.
 */
export function heldBackPrereleases(v: Version | null): { version: string; reason: string }[] {
    if (!v) return [];
    const offered = new Set(upgradeOptions(v, true).map((o) => o.version));
    const newestPatch = releases().find((r) => r.minor === `${v.major}.${v.minor}`)?.latest;
    const out: { version: string; reason: string }[] = [];
    for (const r of releases()) {
        const to = parseVersion(r.latest);
        if (!to?.pre || compareVersions(to, v) <= 0 || offered.has(r.latest)) continue;
        const nextLine = to.major === v.major && to.minor === v.minor + 1;
        out.push({
            version: r.latest,
            reason: nextLine && newestPatch
                ? `upgrade to ${newestPatch} first -- the next minor is taken from the newest patch of this one`
                : `one minor at a time -- ${v.major}.${v.minor + 1} first`,
        });
    }
    return out;
}

function sameMinor(version: string, v: Version): boolean {
    const to = parseVersion(version);
    return !!to && to.major === v.major && to.minor === v.minor;
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

/** An endpoint or node as a talosconfig writes it -> the bare host: no scheme, port or brackets. */
export function hostOf(endpoint: string): string {
    return endpoint.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\[([^\]]+)\](:\d+)?$/, '$1').replace(/^([^:]+):\d+$/, '$1');
}

/**
 * The context that belongs to a cluster: one whose endpoints or nodes are
 * among the cluster's node addresses, else the talosconfig's current one.
 */
export function matchContext(contexts: TalosContext[], addresses: string[]): TalosContext | null {
    const known = new Set(addresses);
    return (
        contexts.find((c) => [...c.endpoints, ...c.nodes].some((e) => known.has(hostOf(e)))) ??
        contexts.find((c) => c.current) ??
        contexts[0] ??
        null
    );
}

/**
 * What `talosctl config info` prints -- "Current context:", "Nodes:",
 * "Endpoints:", "Roles:", "Certificate expires:" -- as label and value pairs,
 * in order. It names no keys or certificates, only where they lead.
 */
export function parseConfigInfo(stdout: string): [string, string][] {
    const out: [string, string][] = [];
    for (const line of stdout.split('\n')) {
        const cut = line.indexOf(':');
        if (cut <= 0) continue;
        const label = line.slice(0, cut).trim();
        if (!label || /\s{2,}/.test(label)) continue;
        out.push([label, line.slice(cut + 1).trim()]);
    }
    return out;
}

/**
 * A table talosctl prints with columns split by runs of spaces and no empty
 * cells -- `talosctl memory`, say -- as one record per row, keyed by header.
 */
export function parseTable(stdout: string): Record<string, string>[] {
    const lines = stdout.split('\n').filter((l) => l.trim() !== '');
    const header = lines.shift()?.trim().split(/\s+/);
    if (!header) return [];
    return lines.map((line) => {
        const cells = line.trim().split(/\s+/);
        return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
    });
}

/** One machine's memory from `talosctl memory`, in MiB; null when it did not say. */
export function parseMemory(stdout: string): { total: number; used: number; available: number } | null {
    const row = parseTable(stdout)[0];
    if (!row) return null;
    const n = (k: string) => Number(row[k] ?? NaN);
    const total = n('TOTAL');
    if (!Number.isFinite(total) || total <= 0) return null;
    const available = Number.isFinite(n('AVAILABLE')) ? n('AVAILABLE') : total - n('USED');
    return { total, used: Number.isFinite(n('USED')) ? n('USED') : total - available, available };
}

// ----- which address talosctl is given -------------------------------------------------------

/** How one machine's address is chosen: worked out, or the user's pick. */
export type AddressChoice = 'auto' | 'external' | 'internal' | 'custom';
/** Where the address in use came from. */
export type AddressSource = 'talosconfig' | 'external' | 'internal' | 'custom' | 'none';

export interface NodeAddressSetting {
    use: AddressChoice;
    /** The address for `custom`. */
    custom?: string;
}

/** What the user set for talosctl on one cluster, kept in the app's storage. */
export interface TalosSettings {
    /**
     * The rule for machines without a choice of their own: `auto` takes an
     * address the talosconfig names, then the ExternalIP, then the
     * InternalIP; `external` and `internal` put that one first.
     */
    prefer: 'auto' | 'external' | 'internal';
    /** Per machine, by Kubernetes node name. Only machines with a choice of their own are kept. */
    nodes: Record<string, NodeAddressSetting>;
    /**
     * Which endpoints talosctl connects to: the talosconfig's own, these, or
     * each machine itself (for a talosconfig without endpoints, or machines
     * the endpoint cannot reach).
     */
    endpoints: { use: 'config' | 'custom' | 'node'; custom: string[] };
}

export const DEFAULT_SETTINGS: TalosSettings = { prefer: 'auto', nodes: {}, endpoints: { use: 'config', custom: [] } };

/** Settings as they came back from storage -- or anything else -- made whole. */
export function normaliseSettings(raw: unknown): TalosSettings {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof TalosSettings, unknown>>;
    const prefer = r.prefer === 'external' || r.prefer === 'internal' ? r.prefer : 'auto';
    const nodes: Record<string, NodeAddressSetting> = {};
    if (r.nodes && typeof r.nodes === 'object') {
        for (const [name, v] of Object.entries(r.nodes as Record<string, unknown>)) {
            const n = (v && typeof v === 'object' ? v : {}) as { use?: unknown; custom?: unknown };
            const use = (['external', 'internal', 'custom'] as const).find((u) => u === n.use);
            if (!use) continue;
            const custom = typeof n.custom === 'string' ? n.custom.trim() : '';
            if (use === 'custom' && !custom) continue;
            nodes[name] = use === 'custom' ? { use, custom } : { use };
        }
    }
    const e = (r.endpoints && typeof r.endpoints === 'object' ? r.endpoints : {}) as { use?: unknown; custom?: unknown };
    const custom = Array.isArray(e.custom) ? e.custom.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : [];
    const use = e.use === 'node' ? 'node' : e.use === 'custom' && custom.length ? 'custom' : 'config';
    return { prefer, nodes, endpoints: { use, custom } };
}

/** "a, b  c" -> ["a", "b", "c"]. */
export function splitList(text: string): string[] {
    return text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

/** A machine's addresses, as Kubernetes lists them. */
export interface Addressed {
    name: string;
    internal: string[];
    external: string[];
}

/**
 * The address talosctl is given for a machine (`--nodes`), and where it came
 * from. The machine's own choice first; then the cluster's rule. Under
 * `auto`, an address the talosconfig's context names wins -- that is the one
 * the person who wrote it reaches the machine on -- then the ExternalIP, which
 * on clouds such as Hetzner is the one reachable from outside, then the
 * InternalIP.
 */
export function pickAddress(m: Addressed, settings: TalosSettings, context: TalosContext | null): { address: string; source: AddressSource } {
    const own = settings.nodes[m.name];
    if (own?.use === 'custom' && own.custom) return { address: own.custom, source: 'custom' };
    const ext = m.external[0];
    const int = m.internal[0];
    const first = (order: ('external' | 'internal')[]): { address: string; source: AddressSource } => {
        for (const kind of order) {
            const a = kind === 'external' ? ext : int;
            if (a) return { address: a, source: kind };
        }
        return { address: '', source: 'none' };
    };
    if (own?.use === 'external') return first(['external', 'internal']);
    if (own?.use === 'internal') return first(['internal', 'external']);
    if (settings.prefer === 'internal') return first(['internal', 'external']);
    if (settings.prefer === 'external') return first(['external', 'internal']);
    if (context) {
        const named = new Set([...context.nodes, ...context.endpoints].map(hostOf));
        const hit = [...m.external, ...m.internal].find((a) => named.has(a));
        if (hit) return { address: hit, source: 'talosconfig' };
    }
    return first(['external', 'internal']);
}

/** The `--endpoints` talosctl is given for a command to these machines; [] for the talosconfig's own. */
export function endpointsFor(settings: TalosSettings, nodes: string[]): string[] {
    if (settings.endpoints.use === 'custom') return settings.endpoints.custom;
    if (settings.endpoints.use === 'node') return nodes;
    return [];
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
    /** The address talosctl is given for this machine: see pickAddress. */
    address: string;
    /** Where that address came from. */
    addressFrom: AddressSource;
    internal: string[];
    external: string[];
    /**
     * Where `external` came from: the Node object's ExternalIP; public addresses
     * the Node object lists as InternalIP (Hetzner lists a node's public IPv6
     * that way); or Talos itself, asked by learnAddresses.
     */
    externalFrom: 'kubernetes' | 'internalip' | 'talos' | '';
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
    const of = (type: string) => addresses.filter((a) => a.type === type && a.address).map((a) => a.address);
    const internal = of('InternalIP');
    const listedExternal = of('ExternalIP');
    // With no ExternalIP, a public address listed as InternalIP is the one
    // reachable from outside.
    const external = listedExternal.length ? listedExternal : internal.filter(isPublicIP);
    const picked = pickAddress({ name: node.metadata.name, internal, external }, DEFAULT_SETTINGS, null);
    return {
        name: node.metadata.name,
        address: picked.address,
        addressFrom: picked.source,
        internal,
        external,
        externalFrom: listedExternal.length ? 'kubernetes' : external.length ? 'internalip' : '',
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

/** The machines with the addresses this cluster's settings and talosconfig context pick for them. */
export function withAddresses(machines: Machine[], settings: TalosSettings, context: TalosContext | null): Machine[] {
    return machines.map((m) => {
        const picked = pickAddress(m, settings, context);
        return { ...m, address: picked.address, addressFrom: picked.source };
    });
}

// ----- addresses Kubernetes does not know --------------------------------------------------

/**
 * Whether an address is one the internet can reach: IPv4 outside the private,
 * shared (CGNAT), loopback and link-local ranges; IPv6 in global unicast
 * (2000::/3) but not documentation (2001:db8::/32).
 */
export function isPublicIP(address: string): boolean {
    const ip = address.split('/')[0]!.trim();
    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
    if (v4) {
        const [a, b] = [Number(v4[1]), Number(v4[2])];
        if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return false;
        if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
        if (a === 100 && b >= 64 && b <= 127) return false;
        if (a === 169 && b === 254) return false;
        if (a === 172 && b >= 16 && b <= 31) return false;
        if (a === 192 && b === 168) return false;
        return true;
    }
    if (!ip.includes(':')) return false;
    const head = parseInt(ip.split(':')[0] || '0', 16);
    if (!(head >= 0x2000 && head <= 0x3fff)) return false;
    return !/^2001:0?db8:/i.test(ip);
}

/**
 * The public addresses among those Talos lists for a machine
 * (`talosctl get nodeaddress current-no-k8s`, which leaves out what Kubernetes
 * adds), without prefixes, IPv4 first. On a cloud without a cloud controller
 * manager -- Hetzner's hcloud is the usual one -- the Node object has only the
 * private InternalIP, and this is the only place the public one is written.
 */
export function publicAddresses(cidrs: readonly string[]): string[] {
    const ips = [...new Set(cidrs.map((c) => c.split('/')[0]!.trim()).filter(isPublicIP))];
    return [...ips.filter((ip) => !ip.includes(':')), ...ips.filter((ip) => ip.includes(':'))];
}

/** The machines, with the public addresses Talos reported for those whose Node object has no ExternalIP. */
export function withTalosAddresses(machines: Machine[], learned: Record<string, string[]>): Machine[] {
    return machines.map((m) => {
        const extra = learned[m.name] ?? [];
        if (m.externalFrom === 'kubernetes' || !extra.length) return m;
        return { ...m, external: [...new Set([...extra, ...m.external])], externalFrom: 'talos' };
    });
}

/** Every address Kubernetes knows for the machines, for matching a talosconfig context. */
export function allAddresses(machines: Addressed[]): string[] {
    return [...new Set(machines.flatMap((m) => [...m.external, ...m.internal]))];
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

/** One extension across the cluster: which machines run it, at which versions. */
export interface ExtensionRow {
    name: string;
    /** Version -> the machines on it. */
    versions: Map<string, string[]>;
    /** The machines that run it, at any version. */
    on: string[];
    /** The machines that answered and do not run it. */
    missing: string[];
    description: string;
    author: string;
    /** More than one version across the machines that run it. */
    versionMismatch: boolean;
}

/**
 * The cluster's extensions, from each machine's `get extensions`: one row per
 * extension, by name. Machines that did not answer are left out of both `on`
 * and `missing` -- not knowing is not the same as not having.
 */
export function extensionRows(byMachine: Map<string, Resource<ExtensionSpec>[]>): ExtensionRow[] {
    const rows = new Map<string, ExtensionRow>();
    const machines = [...byMachine.keys()];
    for (const [machine, exts] of byMachine) {
        for (const e of realExtensions(exts)) {
            const name = e.spec.metadata?.name ?? '';
            if (!name) continue;
            const row: ExtensionRow = rows.get(name) ?? { name, versions: new Map<string, string[]>(), on: [], missing: [], description: '', author: '', versionMismatch: false };
            const version = e.spec.metadata?.version ?? '';
            row.versions.set(version, [...(row.versions.get(version) ?? []), machine]);
            if (!row.on.includes(machine)) row.on.push(machine);
            row.description ||= e.spec.metadata?.description ?? '';
            row.author ||= e.spec.metadata?.author ?? '';
            rows.set(name, row);
        }
    }
    for (const row of rows.values()) {
        row.missing = machines.filter((m) => !row.on.includes(m));
        row.versionMismatch = row.versions.size > 1;
    }
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The machines by the Image Factory schematic they were built from; '' for none. */
export function schematicGroups(byMachine: Map<string, Resource<ExtensionSpec>[]>): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const [machine, exts] of byMachine) {
        const id = schematicOf(exts);
        out.set(id, [...(out.get(id) ?? []), machine]);
    }
    return out;
}

/**
 * How a service is doing. Talos marks a service `unknown` when it has no health
 * check -- dashboard and most system extensions have none -- so a running one
 * of those is simply running, not a problem. Only a failing check, or a
 * service that is not running, is worth anyone's attention.
 */
export type Health = 'healthy' | 'running' | 'unhealthy' | 'stopped';

export function serviceHealth(s: ServiceSpec): Health {
    if (!s.running) return 'stopped';
    if (s.unknown) return 'running';
    return s.healthy ? 'healthy' : 'unhealthy';
}

/** Whether a service is fine: healthy, or running with no check to fail. */
export function serviceOk(s: ServiceSpec): boolean {
    const h = serviceHealth(s);
    return h === 'healthy' || h === 'running';
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
