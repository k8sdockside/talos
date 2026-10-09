import { describe, expect, it } from 'vitest';
import {
    compareVersions,
    installerImage,
    machineOf,
    matchContext,
    memoryText,
    nextUpgrade,
    parseContexts,
    parseResources,
    parseVersion,
    realExtensions,
    schematicOf,
    serviceHealth,
    shortError,
    sortMachines,
    standing,
    type ExtensionSpec,
    type NodeObject,
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

    it('says where a machine stands against the latest stable', () => {
        expect(standing(v('v1.14.2'))).toBe('current');
        expect(standing(v('v1.14.1'))).toBe('patch');
        expect(standing(v('v1.12.4'))).toBe('behind');
        expect(standing(v('v1.15.0-alpha.0'))).toBe('ahead');
        expect(standing(v('v1.9.5'))).toBe('unsupported');
        expect(standing(null)).toBe('unknown');
    });

    it('upgrades one minor at a time', () => {
        expect(nextUpgrade(v('v1.12.0'))?.minor).toBe('1.13');
        expect(nextUpgrade(v('v1.13.0'))?.minor).toBe('1.14');
        expect(nextUpgrade(v('v1.14.1'))?.latest).toBe('v1.14.2');
        expect(nextUpgrade(v('v1.14.2'))).toBeNull();
    });

    it('keeps an Image Factory schematic in the installer', () => {
        expect(installerImage('v1.14.2', 'abc')).toBe('factory.talos.dev/metal-installer/abc:v1.14.2');
        expect(installerImage('1.14.2', '')).toBe('ghcr.io/siderolabs/installer:v1.14.2');
    });
});

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
        expect(serviceHealth({ running: true, healthy: false, unknown: false })).toBe('running');
        expect(serviceHealth({ running: false, healthy: false, unknown: false })).toBe('stopped');
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
