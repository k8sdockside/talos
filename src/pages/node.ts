// The Talos panel in a node's detail view: what Talos says about this one
// machine, and the way into the board, the console and the dashboard.

import { button, byId, el, replace } from '@k8sdockside/plugin-sdk/dom';
import {
    machineOf,
    nextUpgrade,
    realExtensions,
    serviceHealth,
    stageTone,
    type ExtensionSpec,
    type MachineStatus,
    type NodeObject,
    type ServiceSpec,
} from '../model/talos';
import { dot, handOver, showError, versionBadge } from '../ui/common';
import { connect, console as openConsole, dashboard, getOne, message } from '../ui/talos';

async function start(): Promise<void> {
    await k8sdockside.ready();
    const m = machineOf(await k8sdockside.object<K8sDockside.KubeObject>() as unknown as NodeObject);
    const next = nextUpgrade(m.talos);
    const head = el('div', { class: 'panel-head' },
        versionBadge(m.talos),
        next ? el('span', { class: 'small dim' }, `upgrade to ${next.latest} available`) : null,
        el('span', { class: 'grow' }),
        button('Open board', () => void handOver(m.name).catch(showError), { class: 'btn' }),
    );
    if (!m.talos) {
        replace(byId('main'), head, el('p', { class: 'dim' }, 'This node does not run Talos Linux.'));
        return;
    }
    replace(byId('main'), head, el('div', { class: 'loading' }, el('span', { class: 'pulse' }), ' Asking the machine…'));

    const conn = await connect([m.address]);
    if (!conn.ready) {
        replace(byId('main'), head, el('p', { class: 'dim small' }, conn.reason));
        return;
    }
    const [status, services, ext] = await Promise.all([
        getOne<MachineStatus>(conn, 'machinestatus', m.address),
        getOne<ServiceSpec>(conn, 'services', m.address),
        getOne<ExtensionSpec>(conn, 'extensions', m.address).catch(() => []),
    ]).catch((err: unknown) => {
        replace(byId('main'), head, el('p', { class: 'tone-error small' }, message(err)));
        throw null;
    });
    const stage = status[0]?.spec.stage ?? '?';
    const bad = services.filter((s) => serviceHealth(s.spec) !== 'healthy');
    replace(byId('main'),
        head,
        el('div', { class: 'panel-row' },
            dot(stageTone(stage)), el('strong', {}, stage),
            el('span', { class: 'svc-bar inline', title: services.map((s) => `${s.metadata.id}: ${serviceHealth(s.spec)}`).join('\n') },
                ...services.map((s) => el('span', { class: `seg h-${serviceHealth(s.spec)}` }))),
            el('span', { class: 'small dim' }, `${services.length - bad.length}/${services.length} services healthy`),
        ),
        bad.length ? el('p', { class: 'small tone-warn' }, 'Not healthy: ' + bad.map((s) => `${s.metadata.id} (${serviceHealth(s.spec)})`).join(', ')) : null,
        el('p', { class: 'small faint' }, `${realExtensions(ext).length} extensions · ${m.kernel}`),
        el('div', { class: 'row' },
            button('Console', () => void openConsole(conn, m).catch(showError), { class: 'btn' }),
            button('Dashboard ↗', () => void dashboard(conn, [m.address]).catch(showError), { class: 'btn' }),
        ),
    );
}

start().catch((err: unknown) => { if (err !== null) showError(err); });
