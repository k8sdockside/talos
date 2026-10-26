import { afterEach, describe, expect, it } from 'vitest';
import {
    DEFAULT_SETTINGS,
    allAddresses,
    compareVersions,
    endpointsFor,
    extensionRows,
    hostOf,
    installerImage,
    machineOf,
    matchContext,
    memoryText,
    nextUpgrade,
    normaliseSettings,
    parseConfigInfo,
    parseContexts,
    parseMemory,
    parseResources,
    parseVersion,
    pickAddress,
    realExtensions,
    schematicGroups,
    schematicOf,
    serviceHealth,
    serviceOk,
    shortError,
    sortMachines,
    standing,
    withAddresses,
    type ExtensionSpec,
    type NodeObject,
    type Resource,
    type TalosContext,
    type TalosSettings,
    BUILTIN_RELEASES,
    BUILTIN_RELEASES_AS_OF,
    latestStable,
    releaseSource,
    releases,
    releasesFrom,
    releasesNote,
    resetReleases,
    useReleases,
    type GitHubReleaseLike,
    imageVersion,
    installSource,
    parseImageRef,
    parseInstallerImage,
    upgradeOptions,
    type Release,
    isPublicIP,
    publicAddresses,
    withTalosAddresses,
    heldBackPrereleases,
} from './talos';

const v = (s: string) => parseVersion(s)!;

describe('versions', () => {
    it('reads the forms Talos and Kubernetes write', () => {
        expect(parseVersion('Talos (v1.14.2)')?.raw).toBe('v1.14.2');
        expect(parseVersion('1.12.3')?.raw).toBe('v1.12.3');
        expect(parseVersion('v1.15.0-alpha.1')).toMatchObject({ minor: 15, pre: 'alpha.1' });
        expect(parseVersion('Ubuntu 24.04 LTS')).toBeNull();
    });

    it('puts a pre-release before its release', () => {
        expect(compareVersions(v('v1.15.0-alpha.1'), v('v1.15.0'))).toBeLessThan(0);
        expect(compareVersions(v('v1.14.2'), v('v1.14.10'))).toBeLessThan(0);
    });

    // Read from the table rather than written in, so updating the built-in
    // table for a new patch does not mean rewriting these.
    const stable = v(latestStable().latest);
    const olderPatch = `v${stable.major}.${stable.minor}.${stable.patch - 1}`;

    it('says where a machine stands against the latest stable', () => {
        expect(standing(stable)).toBe('current');
        expect(standing(v(olderPatch))).toBe('patch');
        expect(standing(v('v1.12.4'))).toBe('behind');
        expect(standing(v('v1.15.0-alpha.0'))).toBe('ahead');
        expect(standing(v('v1.9.5'))).toBe('unsupported');
        expect(standing(null)).toBe('unknown');
    });

    it('upgrades one minor at a time', () => {
        // The newest patch of a line first, then the next minor.
        const newest = (minor: string) => v(releases().find((r) => r.minor === minor)!.latest);
        expect(nextUpgrade(v('v1.12.0'))?.minor).toBe('1.12');
        expect(nextUpgrade(newest('1.12'))?.minor).toBe('1.13');
        expect(nextUpgrade(newest('1.13'))?.minor).toBe('1.14');
        expect(nextUpgrade(v(olderPatch))?.latest).toBe(latestStable().latest);
        expect(nextUpgrade(stable)).toBeNull();
    });

    it('knows the releases as of a date, newest stable included', () => {
        expect(BUILTIN_RELEASES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(releaseSource()).toEqual({ kind: 'builtin', asOf: BUILTIN_RELEASES_AS_OF, stale: false });
        expect(stable.patch).toBeGreaterThan(0);
    });

});

describe('installer image', () => {
    it('keeps the machine’s own factory, platform, Secure Boot and schematic, and changes only the version', () => {
        const hetzner = installSource({ schematicId: 'abc', apiUrl: 'https://factory.talos.dev/' }, { platform: 'hcloud' }, false, '');
        expect(installerImage('v1.14.5', hetzner)).toBe('factory.talos.dev/hcloud-installer/abc:v1.14.5');

        const onPrem = installSource({ schematicId: 'abc', apiUrl: 'https://factory.example.internal:8443/' }, { platform: 'nocloud' }, true, '');
        expect(installerImage('1.14.5', onPrem)).toBe('factory.example.internal:8443/nocloud-installer-secureboot/abc:v1.14.5');
        expect(onPrem.known).toBe(true);

        const metal = installSource({ schematicId: 'abc', apiUrl: 'https://factory.talos.dev/' }, { platform: 'metal' }, false, '');
        expect(installerImage('v1.14.5', metal)).toBe('factory.talos.dev/metal-installer/abc:v1.14.5');
    });

    it('uses the stock installer for a machine without a schematic', () => {
        expect(installerImage('v1.14.5', installSource(undefined, { platform: 'metal' }, false, ''))).toBe('ghcr.io/siderolabs/installer:v1.14.5');
    });

    it('falls back to the schematic extension, and says when it had to assume', () => {
        const guessed = installSource(undefined, undefined, false, 'fromext');
        expect(installerImage('v1.14.5', guessed)).toBe('factory.talos.dev/metal-installer/fromext:v1.14.5');
        expect(guessed.known).toBe(false);
    });

    it('builds the user’s kvc1 image: host and variant from the config, schematic from the machine, version picked', () => {
        // The machine config's install image is the one kvc1 was first
        // installed from; Talos does not update it on upgrade.
        const config = 'factory.talos.dev/nocloud-installer/88d1f7a5c4f2e3d1b0a9876543210fedcba9876543210fedcba9876543210fe:v1.13.0';
        const running = 'ce4c980550dd2ab1b17bbf2b08801c7eb59418eafe8f279833297925d67c7515';
        const src = installSource({ schematicId: running, apiUrl: 'https://factory.talos.dev/' }, { platform: 'metal' }, false, '', config);
        expect(installerImage('v1.14.5', src)).toBe(
            'factory.talos.dev/nocloud-installer/ce4c980550dd2ab1b17bbf2b08801c7eb59418eafe8f279833297925d67c7515:v1.14.5',
        );
        expect(src).toMatchObject({ from: 'config', variant: 'nocloud-installer', schematicFrom: 'machine', known: true, note: '' });
    });

    it('keeps a Secure Boot variant and an on-prem factory’s host and port from the config', () => {
        const sb = installSource({ schematicId: 'abc123' }, { platform: 'metal' }, false, '', 'factory.talos.dev/metal-installer-secureboot/f00d:v1.12.0');
        expect(installerImage('1.14.5', sb)).toBe('factory.talos.dev/metal-installer-secureboot/abc123:v1.14.5');
        expect(sb.secureBoot).toBe(true);

        const onPrem = installSource({ schematicId: 'abc123', apiUrl: 'https://factory.talos.dev/' }, { platform: 'metal' }, false, '', 'factory.example.internal:8443/nocloud-installer/f00d:v1.13.0');
        expect(installerImage('v1.14.5', onPrem)).toBe('factory.example.internal:8443/nocloud-installer/abc123:v1.14.5');

        // A mirror of the factory under a path keeps the path.
        const mirror = installSource({ schematicId: 'abc123' }, undefined, false, '', 'registry.corp:5000/factory/aws-installer/f00d:v1.13.0');
        expect(installerImage('v1.14.5', mirror)).toBe('registry.corp:5000/factory/aws-installer/abc123:v1.14.5');

        // The old factory form, plain installer.
        const plain = installSource({ schematicId: 'abc123' }, undefined, false, '', 'factory.talos.dev/installer/f00d:v1.7.0');
        expect(installerImage('v1.14.5', plain)).toBe('factory.talos.dev/installer/abc123:v1.14.5');
    });

    it('uses the config’s schematic, and says so, when the machine does not say which it runs', () => {
        const src = installSource(undefined, undefined, false, '', 'factory.talos.dev/nocloud-installer/f00d:v1.13.0');
        expect(installerImage('v1.14.5', src)).toBe('factory.talos.dev/nocloud-installer/f00d:v1.14.5');
        expect(src.schematicFrom).toBe('config');
        expect(src.known).toBe(false);
        expect(src.note).toMatch(/first installed/);
    });

    it('keeps a non-factory installer’s repository and changes only the tag', () => {
        const ghcr = installSource(undefined, { platform: 'metal' }, false, '', 'ghcr.io/siderolabs/installer:v1.12.0');
        expect(installerImage('v1.14.5', ghcr)).toBe('ghcr.io/siderolabs/installer:v1.14.5');
        expect(ghcr).toMatchObject({ from: 'config', known: true, note: '' });

        const custom = installSource(undefined, undefined, false, '', 'registry.corp:5000/platform/talos-installer@sha256:deadbeef');
        expect(installerImage('v1.14.5', custom)).toBe('registry.corp:5000/platform/talos-installer:v1.14.5');

        const hub = installSource(undefined, undefined, false, '', 'acme/talos-installer:v1.13.0');
        expect(installerImage('v1.14.5', hub)).toBe('acme/talos-installer:v1.14.5');

        // A machine that runs a factory schematic all the same: kept, and flagged.
        const drifted = installSource({ schematicId: 'abc123' }, undefined, false, '', 'ghcr.io/siderolabs/installer:v1.12.0');
        expect(installerImage('v1.14.5', drifted)).toBe('ghcr.io/siderolabs/installer:v1.14.5');
        expect(drifted.note).toMatch(/abc123/);
    });

    it('falls back to the machine’s platform, assumed, when the config field cannot be read', () => {
        for (const missing of [undefined, null, '', '   ', 'not an image ref']) {
            const src = installSource({ schematicId: 'abc', apiUrl: 'https://factory.talos.dev/' }, { platform: 'metal' }, false, '', missing);
            expect(installerImage('v1.14.5', src)).toBe('factory.talos.dev/metal-installer/abc:v1.14.5');
            expect(src.from).toBe('machine');
        }
        const guessed = installSource(undefined, undefined, true, 'fromext', null);
        expect(installerImage('v1.14.5', guessed)).toBe('factory.talos.dev/metal-installer-secureboot/fromext:v1.14.5');
        expect(guessed.known).toBe(false);
    });

    it('takes installer images apart', () => {
        expect(parseImageRef('ghcr.io/siderolabs/installer:v1.12.0')).toEqual({ registry: 'ghcr.io', path: 'siderolabs/installer', tag: 'v1.12.0', digest: '' });
        expect(parseImageRef('localhost:5000/installer@sha256:ab')).toEqual({ registry: 'localhost:5000', path: 'installer', tag: '', digest: 'sha256:ab' });
        expect(parseImageRef('installer')).toEqual({ registry: '', path: 'installer', tag: '', digest: '' });
        for (const bad of ['', 'a b', 'ghcr.io//x', 'ghcr.io/']) expect(parseImageRef(bad)).toBeNull();
        expect(parseInstallerImage('factory.talos.dev/nocloud-installer/abc:v1.13.0')).toMatchObject({ factory: true, host: 'factory.talos.dev', variant: 'nocloud-installer', schematic: 'abc', tag: 'v1.13.0' });
        expect(parseInstallerImage('ghcr.io/siderolabs/installer:v1.13.0')).toMatchObject({ factory: false, variant: 'siderolabs/installer', schematic: '' });
        // A schematic is hex; a variant names an installer.
        expect(parseInstallerImage('factory.talos.dev/nocloud-installer/Not-Hex:v1')?.factory).toBe(false);
        expect(parseInstallerImage('factory.talos.dev/something/abc:v1')?.factory).toBe(false);
    });

    it('reads the version an image is tagged with', () => {
        expect(imageVersion('factory.example:8443/metal-installer/abc:v1.14.5')?.raw).toBe('v1.14.5');
        expect(imageVersion('factory.example:8443/metal-installer/abc')).toBeNull();
        expect(imageVersion('ghcr.io/siderolabs/installer:latest')).toBeNull();
    });
});

describe('upgrade options', () => {
    const lines: Release[] = [
        { minor: '1.13', latest: 'v1.13.12', status: 'previous' },
        { minor: '1.14', latest: 'v1.14.5', status: 'stable' },
        { minor: '1.15', latest: 'v1.15.0-alpha.1', status: 'alpha' },
    ];
    const live = { kind: 'live' as const, asOf: '2026-10-26T10:00:00Z', stale: false };
    afterEach(() => resetReleases());

    it('never offers a downgrade, or the version already running', () => {
        useReleases(lines, live);
        expect(upgradeOptions(v('v1.14.5'), false)).toEqual([]);
        expect(upgradeOptions(v('v1.14.6'), true).map((o) => o.version)).toEqual(['v1.15.0-alpha.1']);
    });

    it('takes the newest patch of this line before the next minor', () => {
        useReleases(lines, live);
        expect(upgradeOptions(v('v1.13.4'), false)).toEqual([{ version: 'v1.13.12', kind: 'patch', next: true }]);
        expect(upgradeOptions(v('v1.13.12'), false)).toEqual([{ version: 'v1.14.5', kind: 'minor', next: true }]);
    });

    it('offers pre-releases only when asked for, and marks them', () => {
        useReleases(lines, live);
        expect(upgradeOptions(v('v1.14.5'), false)).toEqual([]);
        expect(upgradeOptions(v('v1.14.5'), true)).toEqual([{ version: 'v1.15.0-alpha.1', kind: 'prerelease', next: true }]);
        // Not before this line's newest patch, either.
        expect(upgradeOptions(v('v1.14.4'), true).map((o) => o.version)).toEqual(['v1.14.5']);
    });

    it('moves one minor at a time', () => {
        useReleases(lines, live);
        expect(upgradeOptions(v('v1.12.12'), true).map((o) => o.version)).toEqual(['v1.13.12']);
    });

    it('takes a pre-release line to its release', () => {
        useReleases([...lines.slice(0, 2), { minor: '1.15', latest: 'v1.15.0', status: 'stable' }], live);
        expect(upgradeOptions(v('v1.15.0-alpha.1'), false)).toEqual([{ version: 'v1.15.0', kind: 'patch', next: true }]);
    });
});

describe('releases from GitHub', () => {
    afterEach(() => resetReleases());

    const gh = (tag: string, prerelease = false, draft = false): GitHubReleaseLike => ({ tag, prerelease, draft });

    // What siderolabs/talos lists, newest first: patches on three lines, the
    // run-up to 1.14 (alphas, betas, an rc), the first 1.15 alpha, a draft,
    // and tags that are not Talos versions.
    const LIST: GitHubReleaseLike[] = [
        gh('v1.15.0-alpha.2', true, true),
        gh('v1.15.0-alpha.1', true),
        gh('v1.15.0-alpha.0', true),
        gh('v1.14.5'),
        gh('v1.13.12'),
        gh('v1.12.12'),
        gh('v1.14.4'),
        gh('v1.14.6-rc.0', true),
        gh('v1.13.11'),
        gh('v1.14.0'),
        gh('v1.14.0-rc.1', true),
        gh('v1.14.0-beta.0', true),
        gh('v1.14.0-alpha.3', true),
        gh('v1.12.11'),
        gh('v1.11.9'),
        gh('pkgs-v1.14.0'),
        gh('v1.14'),
        gh('nightly'),
        gh('v1.16.0', false, true),
    ];

    it('keeps the stable line, the two before it and a newer pre-release line', () => {
        expect(releasesFrom(LIST)).toEqual([
            { minor: '1.12', latest: 'v1.12.12', status: 'previous' },
            { minor: '1.13', latest: 'v1.13.12', status: 'previous' },
            { minor: '1.14', latest: 'v1.14.5', status: 'stable' },
            { minor: '1.15', latest: 'v1.15.0-alpha.1', status: 'alpha' },
        ]);
    });

    it('moves on when a new minor goes stable', () => {
        const got = releasesFrom([gh('v1.15.0'), gh('v1.15.0-rc.0', true), gh('v1.16.0-alpha.0', true), ...LIST]);
        expect(got).toEqual([
            { minor: '1.13', latest: 'v1.13.12', status: 'previous' },
            { minor: '1.14', latest: 'v1.14.5', status: 'previous' },
            { minor: '1.15', latest: 'v1.15.0', status: 'stable' },
            { minor: '1.16', latest: 'v1.16.0-alpha.0', status: 'alpha' },
        ]);
    });

    it('has no alpha line when nothing newer than the stable one is out', () => {
        const got = releasesFrom(LIST.filter((r) => !r.tag.startsWith('v1.15')));
        expect(got.map((r) => r.status)).toEqual(['previous', 'previous', 'stable']);
        expect(got.at(-1)?.latest).toBe('v1.14.5');
    });

    it('counts a tag with a pre-release suffix as a pre-release, whatever the flag says', () => {
        const got = releasesFrom([gh('v1.15.0-beta.0'), gh('v1.14.5')]);
        expect(got.find((r) => r.minor === '1.15')).toEqual({ minor: '1.15', latest: 'v1.15.0-beta.0', status: 'alpha' });
        expect(latestOf(got)).toBe('v1.14.5');
    });

    it('takes previous lines the list is too short to reach from the fallback', () => {
        const got = releasesFrom([gh('v1.14.5'), gh('v1.14.4')]);
        expect(got).toEqual([
            { minor: '1.12', latest: 'v1.12.12', status: 'previous' },
            { minor: '1.13', latest: 'v1.13.12', status: 'previous' },
            { minor: '1.14', latest: 'v1.14.5', status: 'stable' },
        ]);
        expect(releasesFrom([gh('v1.14.5')], [])).toEqual([{ minor: '1.14', latest: 'v1.14.5', status: 'stable' }]);
    });

    it('makes nothing of a list with no stable release', () => {
        expect(releasesFrom([])).toEqual([]);
        expect(releasesFrom([gh('v1.15.0-alpha.1', true), gh('v1.14.5', false, true), gh('junk')])).toEqual([]);
    });

    it('is what standing and nextUpgrade measure against once in use', () => {
        expect(standing(v('v1.14.5'))).toBe('current');
        const live = releasesFrom([gh('v1.15.1'), gh('v1.15.0'), gh('v1.16.0-alpha.0', true), ...LIST]);
        expect(useReleases(live, { kind: 'live', asOf: '2027-01-10T09:30:00Z', stale: false })).toBe(true);

        expect(latestStable().latest).toBe('v1.15.1');
        expect(releases().map((r) => r.minor)).toEqual(['1.13', '1.14', '1.15', '1.16']);
        expect(standing(v('v1.15.1'))).toBe('current');
        expect(standing(v('v1.15.0'))).toBe('patch');
        expect(standing(v('v1.14.5'))).toBe('behind');
        // 1.12 has fallen out of the window.
        expect(standing(v('v1.12.12'))).toBe('unsupported');
        expect(standing(v('v1.16.0-alpha.0'))).toBe('ahead');
        expect(nextUpgrade(v('v1.14.5'))?.latest).toBe('v1.15.1');
        expect(nextUpgrade(v('v1.13.11'))?.latest).toBe('v1.13.12');
        expect(nextUpgrade(v('v1.15.1'))).toBeNull();

        resetReleases();
        expect(latestStable().latest).toBe(BUILTIN_RELEASES.find((r) => r.status === 'stable')!.latest);
        expect(standing(v('v1.14.5'))).toBe('current');
    });

    it('keeps the list in use when handed one without a stable line', () => {
        expect(useReleases([], { kind: 'live', asOf: '2027-01-10T09:30:00Z', stale: false })).toBe(false);
        expect(releaseSource().kind).toBe('builtin');
    });

    it('says where the releases came from', () => {
        const fmt = (iso: string) => `<${iso}>`;
        expect(releasesNote({ kind: 'builtin', asOf: '2026-10-26', stale: false }, fmt)).toBe('built in, as of 2026-10-26');
        expect(releasesNote({ kind: 'live', asOf: '2027-01-10T09:30:00Z', stale: false }, fmt)).toBe('live from GitHub, read <2027-01-10T09:30:00Z>');
        expect(releasesNote({ kind: 'live', asOf: '2027-01-10T09:30:00Z', stale: true }, fmt)).toBe(
            'live from GitHub, read <2027-01-10T09:30:00Z> (cached, GitHub unreachable)',
        );
    });
});

function latestOf(list: { status: string; latest: string }[]): string | undefined {
    return list.find((r) => r.status === 'stable')?.latest;
}

describe("talosctl's output", () => {
    it('reads one object after another, braces in strings and all', () => {
        const out = `{
    "metadata": {"id": "apid", "type": "Services.v1alpha1.talos.dev"},
    "node": "192.168.1.100",
    "spec": {"healthy": true, "running": true, "unknown": false}
}
{
    "metadata": {"id": 0},
    "node": "192.168.1.100",
    "spec": {"metadata": {"name": "schematic", "version": "a7ab57", "extraInfo": "x: {\\"y\\"}"}}
}
`;
        const items = parseResources(out);
        expect(items).toHaveLength(2);
        expect(items[0]!.metadata.id).toBe('apid');
        expect(schematicOf(items as never)).toBe('a7ab57');
        expect(parseResources('')).toEqual([]);
    });

    it('reads the contexts table, empty columns included', () => {
        const table = 'CURRENT   NAME      ENDPOINTS      NODES\n          talos                    \n*         talos-1   192.168.1.98   \n';
        const contexts = parseContexts(table);
        expect(contexts).toEqual([
            { current: false, name: 'talos', endpoints: [], nodes: [] },
            { current: true, name: 'talos-1', endpoints: ['192.168.1.98'], nodes: [] },
        ]);
        expect(matchContext(contexts, ['192.168.1.100'])?.name).toBe('talos-1');
        const two = [...contexts, { current: false, name: 'lab', endpoints: ['https://10.0.0.5:50000'], nodes: [] }];
        expect(matchContext(two, ['10.0.0.5'])?.name).toBe('lab');
    });

    it('cuts a dial error to its reason', () => {
        expect(shortError('error getting server version: rpc error: code = Unavailable desc = connection error: desc = "transport: Error while dialing: dial tcp 192.168.1.199:50000: connect: no route to host"')).toBe('not reachable on the Talos API');
    });

    it('tells real extensions from the schematic marker', () => {
        const ext = [{ spec: { metadata: { name: 'schematic' } } }, { spec: { metadata: { name: 'iscsi-tools' } } }] as { spec: ExtensionSpec }[];
        expect(realExtensions(ext as never).map((e) => e.spec.metadata?.name)).toEqual(['iscsi-tools']);
    });

    it('rates a service', () => {
        expect(serviceHealth({ running: true, healthy: true, unknown: false })).toBe('healthy');
        expect(serviceHealth({ running: true, healthy: false, unknown: false })).toBe('unhealthy');
        expect(serviceHealth({ running: false, healthy: false, unknown: false })).toBe('stopped');
        // No health check (dashboard, ext-iscsid, ...): running is all there is to know.
        expect(serviceHealth({ running: true, healthy: false, unknown: true })).toBe('running');
        expect(serviceHealth({ running: false, healthy: false, unknown: true })).toBe('stopped');
        expect(serviceOk({ running: true, healthy: false, unknown: true })).toBe(true);
        expect(serviceOk({ running: true, healthy: true, unknown: false })).toBe(true);
        expect(serviceOk({ running: true, healthy: false, unknown: false })).toBe(false);
        expect(serviceOk({ running: false, healthy: false, unknown: true })).toBe(false);
    });
});

describe('machines', () => {
    const node = (name: string, cp: boolean, os = 'Talos (v1.14.2)'): NodeObject => ({
        metadata: { name, labels: cp ? { 'node-role.kubernetes.io/control-plane': '' } : {} },
        status: {
            addresses: [{ type: 'Hostname', address: name }, { type: 'InternalIP', address: `10.0.0.${name.length}` }],
            nodeInfo: { osImage: os, kubeletVersion: 'v1.37.1', kernelVersion: '6.18.54-talos' },
            conditions: [{ type: 'Ready', status: 'True' }],
            capacity: { cpu: '4', memory: '8148036Ki' },
        },
    });

    it('reads a node', () => {
        const m = machineOf(node('tc1', true));
        expect(m).toMatchObject({ name: 'tc1', controlPlane: true, ready: true, address: '10.0.0.3', cpu: '4', memory: '7.8 GiB' });
        expect(m.talos?.raw).toBe('v1.14.2');
        expect(machineOf(node('x', false, 'Ubuntu 24.04')).talos).toBeNull();
    });

    it('puts the control plane first, then sorts by name naturally', () => {
        const sorted = sortMachines([node('tw10', false), node('tw2', false), node('tc1', true)].map(machineOf));
        expect(sorted.map((m) => m.name)).toEqual(['tc1', 'tw2', 'tw10']);
    });

    it('writes memory in GiB', () => {
        expect(memoryText('16Gi')).toBe('16 GiB');
        expect(memoryText('weird')).toBe('weird');
    });
});

describe('the address talosctl is given', () => {
    // A Hetzner machine: a private network address and a public one.
    const hetzner: NodeObject = {
        metadata: { name: 'cp1', labels: { 'node-role.kubernetes.io/control-plane': '' } },
        status: {
            addresses: [
                { type: 'Hostname', address: 'cp1' },
                { type: 'InternalIP', address: '10.0.1.2' },
                { type: 'ExternalIP', address: '203.0.113.10' },
            ],
        },
    };
    const settings = (over: Partial<TalosSettings> = {}): TalosSettings => ({ ...structuredClone(DEFAULT_SETTINGS), ...over });
    const ctx = (endpoints: string[], nodes: string[] = []): TalosContext => ({ name: 'c', current: true, endpoints, nodes });

    it('prefers the ExternalIP over the InternalIP by default', () => {
        const m = machineOf(hetzner);
        expect(m).toMatchObject({ address: '203.0.113.10', addressFrom: 'external', internal: ['10.0.1.2'], external: ['203.0.113.10'] });
    });

    it('falls back to the InternalIP when there is no ExternalIP', () => {
        const m = { name: 'x', internal: ['10.0.0.9'], external: [] };
        expect(pickAddress(m, settings(), null)).toEqual({ address: '10.0.0.9', source: 'internal' });
        expect(pickAddress({ name: 'x', internal: [], external: [] }, settings(), null)).toEqual({ address: '', source: 'none' });
    });

    it('takes the address the talosconfig names first', () => {
        const m = machineOf(hetzner);
        expect(pickAddress(m, settings(), ctx(['https://10.0.1.2:50000']))).toEqual({ address: '10.0.1.2', source: 'talosconfig' });
        expect(pickAddress(m, settings(), ctx(['192.0.2.1'], ['10.0.1.2']))).toEqual({ address: '10.0.1.2', source: 'talosconfig' });
        expect(pickAddress(m, settings(), ctx(['192.0.2.1']))).toEqual({ address: '203.0.113.10', source: 'external' });
    });

    it('follows the cluster’s rule, then the machine’s own choice', () => {
        const m = machineOf(hetzner);
        expect(pickAddress(m, settings({ prefer: 'internal' }), ctx(['203.0.113.10'])).address).toBe('10.0.1.2');
        expect(pickAddress(m, settings({ prefer: 'external' }), ctx(['10.0.1.2'])).address).toBe('203.0.113.10');
        expect(pickAddress(m, settings({ nodes: { cp1: { use: 'internal' } } }), null)).toEqual({ address: '10.0.1.2', source: 'internal' });
        expect(pickAddress(m, settings({ prefer: 'internal', nodes: { cp1: { use: 'external' } } }), null).address).toBe('203.0.113.10');
        expect(pickAddress(m, settings({ nodes: { cp1: { use: 'custom', custom: 'cp1.example.com' } } }), null)).toEqual({ address: 'cp1.example.com', source: 'custom' });
        // Another machine's choice is not this one's.
        expect(pickAddress(m, settings({ nodes: { cp2: { use: 'internal' } } }), null).address).toBe('203.0.113.10');
    });

    it('falls back to the other kind when the chosen one is not there', () => {
        const m = { name: 'w', internal: ['10.0.0.4'], external: [] };
        expect(pickAddress(m, settings({ nodes: { w: { use: 'external' } } }), null)).toEqual({ address: '10.0.0.4', source: 'internal' });
    });

    it('gives every machine its address, and lists them all for matching a context', () => {
        const listed = [machineOf(hetzner)];
        expect(withAddresses(listed, settings({ prefer: 'internal' }), null)[0]).toMatchObject({ address: '10.0.1.2', addressFrom: 'internal' });
        expect(allAddresses(listed)).toEqual(['203.0.113.10', '10.0.1.2']);
        expect(matchContext([ctx(['203.0.113.10:50000'])], allAddresses(listed))?.name).toBe('c');
    });

    it('reads endpoints as talosconfigs write them', () => {
        expect(hostOf('https://10.0.0.5:50000')).toBe('10.0.0.5');
        expect(hostOf('10.0.0.5:50000')).toBe('10.0.0.5');
        expect(hostOf('cp.example.com')).toBe('cp.example.com');
        expect(hostOf('[2001:db8::1]:50000')).toBe('2001:db8::1');
        expect(hostOf('2001:db8::1')).toBe('2001:db8::1');
    });

    it('passes endpoints only when the user set them', () => {
        expect(endpointsFor(settings(), ['a'])).toEqual([]);
        expect(endpointsFor(settings({ endpoints: { use: 'custom', custom: ['e1', 'e2'] } }), ['a'])).toEqual(['e1', 'e2']);
        expect(endpointsFor(settings({ endpoints: { use: 'node', custom: [] } }), ['a', 'b'])).toEqual(['a', 'b']);
    });

    it('makes stored settings whole, whatever came back', () => {
        expect(normaliseSettings(null)).toEqual(DEFAULT_SETTINGS);
        expect(normaliseSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
        expect(normaliseSettings({
            prefer: 'external',
            nodes: { a: { use: 'internal' }, b: { use: 'custom', custom: ' 1.2.3.4 ' }, c: { use: 'custom', custom: '' }, d: { use: 'bogus' } },
            endpoints: { use: 'custom', custom: [' e1 ', '', 3] },
        })).toEqual({
            prefer: 'external',
            nodes: { a: { use: 'internal' }, b: { use: 'custom', custom: '1.2.3.4' } },
            endpoints: { use: 'custom', custom: ['e1'] },
        });
        // Custom endpoints with none given are the talosconfig's.
        expect(normaliseSettings({ endpoints: { use: 'custom', custom: [] } }).endpoints.use).toBe('config');
    });
});

describe('more of talosctl’s output', () => {
    it('reads config info without anything secret in it', () => {
        const out = 'Current context:     prod\nNodes:               10.0.1.2\nEndpoints:           203.0.113.10, 203.0.113.11\nRoles:               os:admin\nCertificate expires: 11 months from now (2027-09-01)\n';
        expect(parseConfigInfo(out)).toEqual([
            ['Current context', 'prod'],
            ['Nodes', '10.0.1.2'],
            ['Endpoints', '203.0.113.10, 203.0.113.11'],
            ['Roles', 'os:admin'],
            ['Certificate expires', '11 months from now (2027-09-01)'],
        ]);
    });

    it('reads talosctl memory', () => {
        const out = 'NODE         TOTAL   USED   FREE   SHARED   BUFFERS   CACHE   AVAILABLE\n10.0.1.2     7957    2148   3221   12       101       2486    5512\n';
        expect(parseMemory(out)).toEqual({ total: 7957, used: 2148, available: 5512 });
        expect(parseMemory('')).toBeNull();
    });
});

describe('extensions across the cluster', () => {
    const ext = (name: string, version: string): Resource<ExtensionSpec> => ({ node: '', metadata: { id: name }, spec: { metadata: { name, version } } });
    const byMachine = new Map<string, Resource<ExtensionSpec>[]>([
        ['cp1', [ext('schematic', 'aaa'), ext('iscsi-tools', 'v0.2.0'), ext('qemu-guest-agent', 'v10.0.2')]],
        ['w1', [ext('schematic', 'aaa'), ext('iscsi-tools', 'v0.2.0'), ext('qemu-guest-agent', 'v10.1.0')]],
        ['w2', [ext('schematic', 'bbb'), ext('qemu-guest-agent', 'v10.1.0')]],
    ]);

    it('puts each extension on one row, with its versions and where it is missing', () => {
        const rows = extensionRows(byMachine);
        expect(rows.map((r) => r.name)).toEqual(['iscsi-tools', 'qemu-guest-agent']);
        expect(rows[0]).toMatchObject({ on: ['cp1', 'w1'], missing: ['w2'], versionMismatch: false });
        expect(rows[1]).toMatchObject({ on: ['cp1', 'w1', 'w2'], missing: [], versionMismatch: true });
        expect([...rows[1]!.versions]).toEqual([['v10.0.2', ['cp1']], ['v10.1.0', ['w1', 'w2']]]);
    });

    it('groups the machines by schematic', () => {
        expect([...schematicGroups(byMachine)]).toEqual([['aaa', ['cp1', 'w1']], ['bbb', ['w2']]]);
    });
});

describe('addresses Kubernetes does not know', () => {
    it('tells public addresses from private, shared, loopback and link-local ones', () => {
        for (const ip of ['46.62.218.251', '65.108.90.7/32', '2a01:4f9:c014:5101::1/64', '2001:4645:401a:0:be24:11ff:fe95:e2f0'])
            expect(isPublicIP(ip), ip).toBe(true);
        for (const ip of ['10.0.0.6/32', '172.31.1.1', '192.168.1.130/22', '100.124.0.1/24', '127.0.0.1', '169.254.1.1', 'fd35:b23a::1', 'fe80::1', '2001:db8::1', '300.1.1.1', 'nonsense'])
            expect(isPublicIP(ip), ip).toBe(false);
    });

    it('keeps the public ones from what Talos lists, IPv4 first', () => {
        // ht1 on Hetzner, as its dashboard shows it.
        expect(publicAddresses(['10.0.0.6/32', '2a01:4f9:c014:5101::1/64', '46.62.218.251/32'])).toEqual(['46.62.218.251', '2a01:4f9:c014:5101::1']);
        expect(publicAddresses(['192.168.1.130/22', 'fd35:b23a:fbcf:4009::1/64'])).toEqual([]);
    });

    it('fills in ExternalIP only where the Node object has none', () => {
        const hetzner = machineOf({ metadata: { name: 'ht1' }, status: { addresses: [{ type: 'InternalIP', address: '10.0.0.6' }] } });
        const cloud = machineOf({ metadata: { name: 'c1' }, status: { addresses: [{ type: 'InternalIP', address: '10.0.0.7' }, { type: 'ExternalIP', address: '203.0.113.7' }] } });
        const [h, c] = withTalosAddresses([hetzner, cloud], { ht1: ['46.62.218.251'], c1: ['198.51.100.1'] });
        expect(h).toMatchObject({ external: ['46.62.218.251'], externalFrom: 'talos' });
        expect(c).toMatchObject({ external: ['203.0.113.7'], externalFrom: 'kubernetes' });
        // And the default rule then takes the public one.
        expect(pickAddress(h!, normaliseSettings(null), null)).toEqual({ address: '46.62.218.251', source: 'external' });
    });
});

describe('hcloud without a cloud controller manager', () => {
    // ht1 as its Node object has it: the private IPv4 and the public IPv6, both as InternalIP.
    const ht1 = () => machineOf({ metadata: { name: 'ht1' }, status: { addresses: [{ type: 'InternalIP', address: '10.0.0.6' }, { type: 'InternalIP', address: '2a01:4f9:c014:5101::1' }] } });

    it('takes a public address listed as InternalIP as the external one', () => {
        expect(ht1()).toMatchObject({ internal: ['10.0.0.6', '2a01:4f9:c014:5101::1'], external: ['2a01:4f9:c014:5101::1'], externalFrom: 'internalip' });
        expect(pickAddress(ht1(), normaliseSettings(null), null)).toEqual({ address: '2a01:4f9:c014:5101::1', source: 'external' });
    });

    it('puts the public IPv4 Talos reports first once learned', () => {
        const [m] = withTalosAddresses([ht1()], { ht1: ['46.62.218.251', '2a01:4f9:c014:5101::1'] });
        expect(m).toMatchObject({ external: ['46.62.218.251', '2a01:4f9:c014:5101::1'], externalFrom: 'talos' });
        expect(pickAddress(m!, normaliseSettings(null), null)).toEqual({ address: '46.62.218.251', source: 'external' });
    });
});

describe('pre-releases held back', () => {
    const lines: Release[] = [
        { minor: '1.14', latest: 'v1.14.5', status: 'stable' },
        { minor: '1.15', latest: 'v1.15.0-alpha.1', status: 'alpha' },
    ];
    afterEach(() => resetReleases());

    it('says why a pre-release is not offered', () => {
        useReleases(lines, { kind: 'live', asOf: '2026-10-26T10:00:00Z', stale: false });
        expect(heldBackPrereleases(v('v1.14.4'))).toEqual([
            { version: 'v1.15.0-alpha.1', reason: 'upgrade to v1.14.5 first -- the next minor is taken from the newest patch of this one' },
        ]);
        expect(heldBackPrereleases(v('v1.14.5'))).toEqual([]);
        expect(heldBackPrereleases(v('v1.13.12'))[0]?.reason).toBe('one minor at a time -- 1.14 first');
    });
});
