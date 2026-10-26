// The dashboard: what `talosctl dashboard` shows for each machine, for all of
// them at once and kept up to date -- stage, services, memory, time, and etcd
// on the control plane -- with the real `talosctl dashboard` and the console
// a click away for the machines picked.

import { button, byId, el, replace, type Child } from '@k8sdockside/plugin-sdk/dom';
import {
    parseMemory,
    serviceHealth,
    serviceOk,
    stageTone,
    type Machine,
    type MachineStatus,
    type Resource,
    type ServiceSpec,
} from '../model/talos';
import { ADDRESS_FROM, clearError, dot, keep, on, recall, showError, versionBadge, when } from '../ui/common';
import { loadCluster, loadingLine, notReady, pageHead, type Cluster } from '../ui/shell';
import { loadReleases } from '../ui/releases';
import { consoleFor, dashboard, dashboardLabel, dashboardTitle, getEach, message, text, type Connection } from '../ui/talos';

/** How often the dashboard reads again. */
const EVERY = 15_000;
const PICKED_KEY = 'dashboard:picked';

interface Row {
    status: Resource<MachineStatus>[] | Error | undefined;
    services: Resource<ServiceSpec>[] | Error | undefined;
    memory: { total: number; used: number; available: number } | null | Error | undefined;
    time: { synced?: boolean }[] | Error | undefined;
}

const state = {
    contextName: '',
    cluster: null as Cluster | null,
    rows: new Map<string, Row>(),
    etcd: '' as string | Error,
    at: null as Date | null,
    /** Machine names picked for the dashboard and the console; none means all. */
    picked: new Set<string>(),
    reading: false,
};

async function start(): Promise<void> {
    const ctx = await k8sdockside.ready();
    state.contextName = ctx.contextName;
    state.picked = new Set(await recall<string[]>(PICKED_KEY, []));
    // The version badges measure against the live release list once it is in.
    void loadReleases().then((changed) => changed && render());
    replace(byId('main'), pageHead('dashboard', state.contextName), loadingLine('Looking for talosctl and your talosconfig…'));
    state.cluster = await loadCluster(state.contextName);
    render();
    await read();
    setInterval(() => void read(), EVERY);
}

async function read(): Promise<void> {
    const c = state.cluster;
    if (!c?.conn.ready || document.hidden || state.reading) return;
    state.reading = true;
    try {
        const machines = c.machines.filter((m) => m.address);
        const nodes = machines.map((m) => m.address);
        const cps = machines.filter((m) => m.controlPlane).map((m) => m.address);
        const [status, services, time, memory, etcd] = await Promise.all([
            getEach<MachineStatus>(c.conn, 'machinestatus', nodes),
            getEach<ServiceSpec>(c.conn, 'services', nodes),
            getEach<{ synced?: boolean }>(c.conn, 'timestatus', nodes),
            memoryOf(c.conn, nodes),
            cps.length ? text(c.conn, ['etcd', 'status'], cps).catch((err: unknown) => new Error(message(err))) : Promise.resolve(''),
        ]);
        state.rows = new Map(machines.map((m) => {
            const t = time.get(m.address);
            return [m.name, {
                status: status.get(m.address),
                services: services.get(m.address),
                memory: memory.get(m.address),
                time: t instanceof Error ? t : t?.map((r) => r.spec),
            }];
        }));
        state.etcd = etcd;
        state.at = new Date();
    } catch (err) {
        showError(err);
    } finally {
        state.reading = false;
    }
    render();
}

/** `talosctl memory`, one machine at a time so one that does not answer does not hide the rest. */
async function memoryOf(conn: Connection, nodes: string[]): Promise<Map<string, ReturnType<typeof parseMemory> | Error>> {
    const answers = await Promise.all(nodes.map(async (n): Promise<[string, ReturnType<typeof parseMemory> | Error]> => {
        try {
            return [n, parseMemory(await text(conn, ['memory'], [n]))];
        } catch (err) {
            return [n, err instanceof Error ? err : new Error(String(err))];
        }
    }));
    return new Map(answers);
}

// ----- drawing ------------------------------------------------------------------------------

function picked(c: Cluster): Machine[] {
    const some = c.machines.filter((m) => state.picked.has(m.name) && m.address);
    return some.length ? some : c.machines.filter((m) => m.address);
}

function render(): void {
    clearError();
    const c = state.cluster;
    if (!c) return;
    const ready = c.conn.ready;
    const aim = picked(c);
    const aimText = state.picked.size && aim.length < c.machines.length ? `${aim.length} picked` : 'all machines';
    replace(byId('main'),
        pageHead('dashboard', `${state.contextName} · ${c.machines.length} machine${c.machines.length === 1 ? '' : 's'}${state.at ? ` · read at ${when(state.at)}` : ''}`,
            ready && aim.length ? button(dashboardLabel(aim.length, aimText !== 'all machines'), () => void dashboard(c.conn, aim.map((m) => m.address)).catch(showError), { class: 'btn primary', title: dashboardTitle(aim.map((m) => m.address)) }) : null,
            ready ? button('Console', () => void consoleFor(c.conn, aim).catch(showError), { class: 'btn', title: `A talosctl console in the dock, aimed at ${aimText}` }) : null,
            ready ? button('Refresh', () => void read(), { class: 'btn ghost' }) : null,
        ),
        ready ? null : notReady(c.conn),
        ready ? stats(c) : null,
        el('section', { class: 'card section' },
            el('div', { class: 'row' },
                el('h2', { class: 'grow' }, 'Machines'),
                state.picked.size ? button('Pick none (all)', () => setPicked(new Set()), { class: 'link small' }) : null,
                el('span', { class: 'faint small' }, `The dashboard and console buttons above use ${aimText}.`),
            ),
            el('div', { class: 'scroll-x' }, table(c)),
        ),
        ready ? attention(c) : null,
        ready && c.machines.some((m) => m.controlPlane) ? etcdCard() : null,
    );
}

function setPicked(next: Set<string>): void {
    state.picked = next;
    keep(PICKED_KEY, [...next]);
    render();
}

function items<T>(v: T[] | Error | undefined): T[] | null {
    return Array.isArray(v) ? v : null;
}

function stats(c: Cluster): HTMLElement {
    const rows = c.machines.map((m) => state.rows.get(m.name));
    const answering = rows.filter((r) => items(r?.status)).length;
    const running = rows.filter((r) => items(r?.status)?.[0]?.spec.stage === 'running').length;
    const services = rows.flatMap((r) => items(r?.services) ?? []);
    const healthy = services.filter((s) => serviceOk(s.spec)).length;
    const mems = rows.map((r) => r?.memory).filter((x): x is { total: number; used: number; available: number } => !!x && !(x instanceof Error));
    const total = mems.reduce((n, x) => n + x.total, 0);
    const used = mems.reduce((n, x) => n + (x.total - x.available), 0);
    const unsynced = rows.filter((r) => items(r?.time)?.[0]?.synced === false).length;
    return el('div', { class: 'stats' },
        stat('Answering', `${answering}/${c.machines.length}`, answering === c.machines.length ? 'ok' : 'error'),
        stat('Running', `${running}/${c.machines.length}`, running === c.machines.length ? 'ok' : 'warn'),
        stat('Services OK', services.length ? `${healthy}/${services.length}` : '—', healthy === services.length ? 'ok' : 'warn'),
        stat('Memory in use', total ? `${pct(used, total)}%` : '—', total && used / total > 0.9 ? 'warn' : 'ok', total ? `${gib(used)} of ${gib(total)}` : ''),
        stat('Clock', unsynced ? `${unsynced} not synced` : 'synced', unsynced ? 'warn' : 'ok'),
    );
}

function stat(label: string, value: string, tone: string, sub = ''): HTMLElement {
    return el('div', { class: 'stat card' },
        el('div', { class: 'faint small' }, label),
        el('div', { class: `stat-value tone-${tone}` }, value),
        sub ? el('div', { class: 'faint small' }, sub) : null,
    );
}

function pct(a: number, b: number): number {
    return b ? Math.round((a / b) * 100) : 0;
}

function gib(mib: number): string {
    return `${(mib / 1024).toFixed(1)} GiB`;
}

function table(c: Cluster): HTMLElement {
    const all = c.machines.length > 0 && c.machines.every((m) => state.picked.has(m.name));
    const head = el('input', { type: 'checkbox', 'aria-label': 'Pick every machine', 'data-k8sdockside-keep': 'off' });
    head.checked = all;
    on(head, 'change', () => setPicked(head.checked ? new Set(c.machines.map((m) => m.name)) : new Set()));
    return el('table', { class: 'grid' },
        el('thead', {}, el('tr', {},
            el('th', {}, head),
            el('th', {}, 'Machine'),
            el('th', {}, 'Talos'),
            el('th', {}, 'Stage'),
            el('th', {}, 'Services'),
            el('th', {}, 'Memory'),
            el('th', {}, 'Clock'),
            el('th', {}, ''),
        )),
        el('tbody', {}, ...c.machines.map((m) => row(c, m))),
    );
}

function row(c: Cluster, m: Machine): HTMLElement {
    const r = state.rows.get(m.name);
    const box = el('input', { type: 'checkbox', 'aria-label': `Pick ${m.name}`, 'data-k8sdockside-keep': 'off' });
    box.checked = state.picked.has(m.name);
    box.disabled = !m.address;
    on(box, 'change', () => {
        const next = new Set(state.picked);
        if (box.checked) next.add(m.name);
        else next.delete(m.name);
        setPicked(next);
    });
    const err = r?.status instanceof Error ? r.status.message : '';
    const stage = items(r?.status)?.[0]?.spec;
    const services = items(r?.services);
    const mem = r?.memory instanceof Error || !r?.memory ? null : r.memory;
    const synced = items(r?.time)?.[0]?.synced;

    let stageCell: Child;
    if (!c.conn.ready) stageCell = el('span', { class: 'faint' }, m.ready ? 'Ready in Kubernetes' : 'NotReady in Kubernetes');
    else if (!m.address) stageCell = el('span', { class: 'tone-error' }, 'no address — set one in Settings');
    else if (err) stageCell = el('span', { class: 'tone-error small' }, dot('error'), ' ', err);
    else if (stage) stageCell = el('span', {}, dot(stageTone(stage.stage)), ' ', stage.stage, stage.status?.ready === false ? el('span', { class: 'tone-warn' }, ' · not ready') : null);
    else stageCell = el('span', { class: 'faint' }, '…');

    return el('tr', {},
        el('td', {}, box),
        el('td', {},
            el('strong', {}, m.name),
            el('div', { class: 'faint small mono', title: ADDRESS_FROM[m.addressFrom] }, m.address || 'no address', m.controlPlane ? ' · control plane' : ''),
        ),
        el('td', {}, versionBadge(m.talos)),
        el('td', {}, stageCell),
        el('td', {}, services
            ? el('div', {},
                el('div', { class: 'svc-bar inline', title: services.map((s) => `${s.metadata.id}: ${serviceHealth(s.spec)}`).join('\n') },
                    ...services.map((s) => el('span', { class: `seg h-${serviceHealth(s.spec)}` }))),
                el('span', { class: 'faint small' }, `${services.filter((s) => serviceOk(s.spec)).length}/${services.length} OK`))
            : el('span', { class: 'faint' }, '—')),
        el('td', {}, mem
            ? el('div', { title: `${mem.used} MiB used, ${mem.available} MiB available of ${mem.total} MiB` },
                meter((mem.total - mem.available) / mem.total),
                el('span', { class: 'faint small' }, `${gib(mem.total - mem.available)} / ${gib(mem.total)}`))
            : el('span', { class: 'faint' }, '—')),
        el('td', {}, synced === undefined ? el('span', { class: 'faint' }, '—') : synced ? el('span', {}, dot('ok'), ' synced') : el('span', { class: 'tone-warn' }, dot('warn'), ' not synced')),
        el('td', { class: 'right' },
            c.conn.ready && m.address
                ? button('Dashboard', () => void dashboard(c.conn, [m.address]).catch(showError), { class: 'link', title: dashboardTitle([m.address]) })
                : null,
        ),
    );
}

function meter(fraction: number): HTMLElement {
    const f = Math.max(0, Math.min(1, fraction));
    const fill = el('span');
    // Set through the DOM rather than a style attribute, which a strict CSP refuses.
    fill.style.width = `${Math.round(f * 100)}%`;
    return el('div', { class: `meter${f > 0.9 ? ' high' : ''}` }, fill);
}

/** Services that are not healthy, and machines that are not ready, across the cluster. */
function attention(c: Cluster): HTMLElement | null {
    const lines: HTMLElement[] = [];
    for (const m of c.machines) {
        const r = state.rows.get(m.name);
        for (const u of items(r?.status)?.[0]?.spec.status?.unmetConditions ?? []) {
            lines.push(el('li', {}, el('strong', {}, m.name), ` not ready: ${u.name} (${u.reason})`));
        }
        for (const s of items(r?.services) ?? []) {
            const h = serviceHealth(s.spec);
            if (!serviceOk(s.spec)) lines.push(el('li', {}, el('strong', {}, m.name), ' ', el('span', { class: 'mono' }, String(s.metadata.id)), ` is ${h}`));
        }
    }
    if (!lines.length) return null;
    return el('section', { class: 'card section' }, el('h2', {}, 'Needs a look ', el('span', { class: 'faint' }, String(lines.length))), el('ul', { class: 'plain-list' }, ...lines));
}

function etcdCard(): HTMLElement {
    const e = state.etcd;
    return el('section', { class: 'card section' },
        el('h2', {}, 'etcd'),
        e instanceof Error ? el('p', { class: 'tone-error' }, e.message) : el('pre', { class: 'out' }, e || '…'),
    );
}

start().catch(showError);
