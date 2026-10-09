// The Talos board: the cluster's machines on a version runway, a tile for
// each, and a drawer for the one picked -- with what talosctl knows about it
// and the operations it can be asked for.

import { button, byId, el, replace, svg, type Child } from '@k8sdockside/plugin-sdk/dom';
import {
    LATEST_STABLE,
    RELEASES,
    installerImage,
    machineOf,
    minorOf,
    nextUpgrade,
    parseVersion,
    realExtensions,
    schematicOf,
    serviceHealth,
    sortMachines,
    stageTone,
    standing,
    type ExtensionSpec,
    type Machine,
    type MachineStatus,
    type NodeObject,
    type Resource,
    type SecuritySpec,
    type ServiceSpec,
} from '../model/talos';
import { TALOS_LOGO } from '../ui/logo';
import { STANDING_TEXT, clearError, dot, on, showError, takeHandOver, versionBadge, when } from '../ui/common';
import {
    chooseConfig,
    connect,
    console as openConsole,
    dashboard,
    forgetConfig,
    getEach,
    getOne,
    message,
    run,
    text,
    useContext,
    type Connection,
} from '../ui/talos';

/** How often the live parts -- stage and services -- are read again. */
const LIVE_EVERY = 20_000;

type Tab = 'overview' | 'services' | 'logs' | 'kernel' | 'network' | 'storage' | 'etcd';

interface Live {
    status: Map<string, Resource<MachineStatus>[] | Error>;
    services: Map<string, Resource<ServiceSpec>[] | Error>;
    extensions: Map<string, Resource<ExtensionSpec>[] | Error>;
    security: Map<string, Resource<SecuritySpec>[] | Error>;
    at: Date | null;
}

const state = {
    contextName: '',
    machines: [] as Machine[],
    conn: null as Connection | null,
    connecting: false,
    live: { status: new Map(), services: new Map(), extensions: new Map(), security: new Map(), at: null } as Live,
    selected: '' as string,
    tab: 'overview' as Tab,
    /** What a drawer tab read, by machine and tab, so switching back does not read again. */
    drawer: new Map<string, Child | Promise<void>>(),
    logService: 'kubelet',
    k8sTarget: '',
};

// ----- reading ---------------------------------------------------------------------------

async function start(): Promise<void> {
    const ctx = await k8sdockside.ready();
    state.contextName = ctx.contextName;
    const focus = await takeHandOver();
    if (focus) state.selected = focus;

    let first = true;
    k8sdockside.watch<K8sDockside.KubeObject>(
        { kind: 'nodes', interval: 15_000 },
        (items) => {
            state.machines = sortMachines((items as unknown as NodeObject[]).map(machineOf));
            render();
            if (first) {
                first = false;
                void reconnect();
            }
        },
        showError,
    );
    setInterval(() => void readLive(false), LIVE_EVERY);
}

async function reconnect(): Promise<void> {
    state.connecting = true;
    render();
    state.conn = await connect(state.machines.map((m) => m.address).filter(Boolean));
    state.connecting = false;
    state.drawer.clear();
    render();
    if (state.conn.ready) await readLive(true);
}

/** Reads what talosctl knows about every machine. The slow-changing parts only when asked to. */
async function readLive(everything: boolean): Promise<void> {
    const conn = state.conn;
    if (!conn?.ready || document.hidden) return;
    const nodes = state.machines.map((m) => m.address).filter(Boolean);
    if (!nodes.length) return;
    const reads: Promise<void>[] = [
        getEach<MachineStatus>(conn, 'machinestatus', nodes).then((m) => void (state.live.status = m)),
        getEach<ServiceSpec>(conn, 'services', nodes).then((m) => void (state.live.services = m)),
    ];
    if (everything || state.live.extensions.size === 0) {
        reads.push(
            getEach<ExtensionSpec>(conn, 'extensions', nodes).then((m) => void (state.live.extensions = m)),
            getEach<SecuritySpec>(conn, 'securitystate', nodes).then((m) => void (state.live.security = m)),
        );
    }
    await Promise.all(reads).catch(showError);
    state.live.at = new Date();
    render();
}

function itemsOf<S>(map: Map<string, Resource<S>[] | Error>, address: string): Resource<S>[] | null {
    const v = map.get(address);
    return Array.isArray(v) ? v : null;
}

function errorOf(address: string): string {
    const v = state.live.status.get(address);
    return v instanceof Error ? v.message : '';
}

// ----- drawing: the page --------------------------------------------------------------------

function render(): void {
    clearError();
    const selected = state.machines.find((m) => m.name === state.selected) ?? null;
    replace(
        byId('main'),
        header(),
        connectionBar(),
        runway(),
        el('div', { class: selected ? 'layout with-drawer' : 'layout' },
            el('div', { class: 'board' }, ...groups()),
            selected ? drawer(selected) : null,
        ),
    );
}

function header(): HTMLElement {
    const talos = state.machines.filter((m) => m.talos);
    const ready = state.machines.filter((m) => m.ready).length;
    return el('header', { class: 'head' },
        el('div', { class: 'title' },
            el('div', {},
                el('h1', { class: 'brand-title' }, svg(TALOS_LOGO, 'brand'), el('span', { class: 'sr-only' }, 'Talos')),
                el('div', { class: 'dim small' },
                    `${state.contextName} · ${state.machines.length} machine${state.machines.length === 1 ? '' : 's'}, ${ready} ready` +
                        (talos.length < state.machines.length ? ` · ${state.machines.length - talos.length} not on Talos` : ''),
                ),
            ),
        ),
        el('div', { class: 'head-actions' },
            state.conn?.ready ? button('Console', () => void openConsole(state.conn!, null).catch(showError), { class: 'btn' }) : null,
            state.conn?.ready ? button('Health check', () => void healthCheck(), { class: 'btn' }) : null,
            state.conn?.ready ? button('Upgrade Kubernetes…', () => openK8sUpgrade(), { class: 'btn' }) : null,
            button('Refresh', () => void readLive(true), { class: 'btn ghost', title: state.live.at ? `Read at ${when(state.live.at)}` : '' }),
        ),
    );
}

/** Which talosctl, talosconfig and context -- or what to do to get them. */
function connectionBar(): HTMLElement {
    const c = state.conn;
    if (state.connecting || !c) {
        return el('div', { class: 'conn' }, el('span', { class: 'pulse' }), el('span', { class: 'dim' }, 'Looking for talosctl and your talosconfig…'));
    }
    if (!c.ready) {
        return el('div', { class: 'conn setup' },
            dot('warn'),
            el('div', { class: 'grow' },
                el('strong', {}, setupTitle(c)),
                el('div', { class: 'dim small' }, c.reason),
            ),
            c.fix === 'config' || c.fix === 'context'
                ? button('Choose talosconfig…', () => void chooseConfig().then(reconnect).catch(showError), { class: 'btn primary' })
                : null,
            c.fix !== 'app' ? button('Try again', () => void reconnect(), { class: 'btn ghost' }) : null,
        );
    }
    const file = c.status?.files[0];
    const select = el('select', { 'aria-label': 'talosconfig context', 'data-k8sdockside-keep': 'off' },
        ...c.contexts.map((ctx) => {
            const o = el('option', { value: ctx.name }, ctx.name + (ctx.endpoints.length ? `  (${ctx.endpoints.join(', ')})` : ''));
            o.selected = ctx.name === c.context;
            return o;
        }),
    );
    on(select, 'change', () => void useContext(select.value).then(reconnect).catch(showError));
    return el('div', { class: 'conn' },
        dot('ok'),
        el('span', { class: 'mono' }, `talosctl ${c.status?.tool.version ?? ''}`),
        el('span', { class: 'sep' }),
        el('span', { class: 'dim', title: file?.path ?? '' }, 'talosconfig '),
        el('span', { class: 'mono', title: file?.source === 'configured' ? 'Chosen for this cluster' : 'talosctl’s default' }, shortPath(file?.path ?? '')),
        el('span', { class: 'sep' }),
        el('span', { class: 'dim' }, 'context '),
        select,
        el('span', { class: 'grow' }),
        button('Change…', () => void chooseConfig().then(reconnect).catch(showError), { class: 'link' }),
        file?.source === 'configured' ? button('Use default', () => void forgetConfig().then(reconnect).catch(showError), { class: 'link' }) : null,
    );
}

function setupTitle(c: Connection): string {
    switch (c.fix) {
        case 'install':
            return 'talosctl is not installed';
        case 'config':
            return 'No talosconfig for this cluster';
        case 'context':
            return 'Which context?';
        default:
            return 'talosctl is not available here';
    }
}

function shortPath(path: string): string {
    return path.replace(/^\/(home|Users)\/[^/]+/, '~');
}

// ----- the version runway -----------------------------------------------------------------

function runway(): HTMLElement {
    const talos = state.machines.filter((m) => m.talos);
    const byMinor = new Map<string, Machine[]>();
    for (const m of talos) {
        const k = minorOf(m.talos!);
        byMinor.set(k, [...(byMinor.get(k) ?? []), m]);
    }
    const older = talos.filter((m) => !RELEASES.some((r) => r.minor === minorOf(m.talos!)));

    const stops = RELEASES.map((r) => {
        const here = byMinor.get(r.minor) ?? [];
        return el('div', { class: `stop s-${r.status}${here.length ? ' occupied' : ''}` },
            el('div', { class: 'pips' },
                ...here.map((m) => {
                    const pip = el('span', {
                        class: `pip${m.controlPlane ? ' cp' : ''} v-${standing(m.talos)}${m.name === state.selected ? ' on' : ''}`,
                        title: `${m.name} · ${m.talos!.raw}${m.controlPlane ? ' · control plane' : ''}`,
                        role: 'button',
                        tabindex: 0,
                    });
                    return on(pip, 'click', () => select(m.name));
                }),
            ),
            el('div', { class: 'marker' }),
            el('div', { class: 'stop-label' },
                el('strong', {}, r.minor),
                el('span', { class: 'faint small' }, r.status === 'stable' ? `latest · ${r.latest}` : r.status === 'alpha' ? 'alpha' : r.latest),
            ),
        );
    });

    const versions = new Map<string, number>();
    for (const m of state.machines) if (m.kubelet) versions.set(m.kubelet, (versions.get(m.kubelet) ?? 0) + 1);

    return el('section', { class: 'runway card' },
        el('div', { class: 'runway-head' },
            el('h2', {}, 'Version runway'),
            el('span', { class: 'dim' }, verdict(talos)),
        ),
        el('div', { class: 'track' },
            older.length ? el('div', { class: 'stop s-old occupied' }, el('div', { class: 'pips' }, ...older.map((m) => el('span', { class: 'pip v-unsupported', title: `${m.name} · ${m.talos!.raw}` }))), el('div', { class: 'marker' }), el('div', { class: 'stop-label' }, el('strong', {}, 'older'))) : null,
            ...stops,
        ),
        el('div', { class: 'kube-line small' },
            el('span', { class: 'dim' }, 'Kubernetes '),
            ...[...versions.entries()].map(([v, n]) => el('span', { class: 'chip' }, `${v}${versions.size > 1 ? ` × ${n}` : ''}`)),
        ),
    );
}

/** One sentence on where the cluster stands. */
function verdict(talos: Machine[]): string {
    if (!talos.length) return 'No machine reports Talos as its OS.';
    const latest = LATEST_STABLE.latest;
    const behind = talos.filter((m) => ['behind', 'patch', 'unsupported'].includes(standing(m.talos)));
    const ahead = talos.filter((m) => standing(m.talos) === 'ahead');
    if (!behind.length && !ahead.length) return `All ${talos.length} on ${latest}, the latest stable.`;
    const parts: string[] = [];
    if (behind.length) {
        const next = nextUpgrade(behind.map((m) => m.talos!).sort((a, b) => a.minor - b.minor || a.patch - b.patch)[0] ?? null);
        parts.push(`${behind.length} behind ${latest}` + (next ? ` — next step ${next.latest}, one minor at a time` : ''));
    }
    if (ahead.length) parts.push(`${ahead.length} on a pre-release`);
    return parts.join(' · ');
}

// ----- the board ---------------------------------------------------------------------------

function groups(): HTMLElement[] {
    const cp = state.machines.filter((m) => m.controlPlane);
    const workers = state.machines.filter((m) => !m.controlPlane);
    return [
        cp.length ? group('Control plane', cp) : null,
        workers.length ? group('Workers', workers) : null,
    ].filter((g): g is HTMLElement => g !== null);
}

function group(title: string, machines: Machine[]): HTMLElement {
    return el('section', { class: 'group' },
        el('h3', {}, title, el('span', { class: 'faint' }, ` ${machines.length}`)),
        el('div', { class: 'tiles' }, ...machines.map(tile)),
    );
}

function tile(m: Machine): HTMLElement {
    const status = itemsOf(state.live.status, m.address)?.[0]?.spec;
    const services = itemsOf(state.live.services, m.address);
    const ext = itemsOf(state.live.extensions, m.address);
    const sec = itemsOf(state.live.security, m.address)?.[0]?.spec;
    const err = errorOf(m.address);
    const stage = status?.stage ?? '';

    const healthBar = services
        ? el('div', { class: 'svc-bar', title: services.map((s) => `${s.metadata.id}: ${serviceHealth(s.spec)}`).join('\n') },
            ...services.map((s) => el('span', { class: `seg h-${serviceHealth(s.spec)}` })),
        )
        : null;
    const healthy = services?.filter((s) => serviceHealth(s.spec) === 'healthy').length ?? 0;

    const card = el('div', {
        class: `tile${m.name === state.selected ? ' on' : ''}${err ? ' unreachable' : ''}`,
        role: 'button',
        tabindex: 0,
        'aria-pressed': m.name === state.selected ? 'true' : 'false',
    },
        el('div', { class: 'tile-top' },
            dot(err ? 'error' : stage ? stageTone(stage) : m.ready ? 'ok' : 'error', stage || (m.ready ? 'Ready' : 'Not ready')),
            el('strong', { class: 'grow ellipsis' }, m.name),
            versionBadge(m.talos),
        ),
        el('div', { class: 'mono faint small' }, m.address || 'no address', m.cordoned ? el('span', { class: 'chip warn' }, 'cordoned') : null),
        el('div', { class: 'tile-stage small' },
            err ? el('span', { class: 'tone-error' }, err)
            : stage ? el('span', {}, stage, status?.status?.ready === false ? el('span', { class: 'tone-warn' }, ' · not ready') : null)
            : el('span', { class: 'faint' }, state.conn?.ready ? '…' : m.ready ? 'Ready in Kubernetes' : 'NotReady in Kubernetes'),
        ),
        healthBar,
        services ? el('div', { class: 'faint small' }, `${healthy}/${services.length} services healthy`) : null,
        el('div', { class: 'tile-foot small' },
            sec?.secureBoot ? el('span', { class: 'chip ok', title: 'Secure Boot' }, 'secure boot') : null,
            ext ? el('span', { class: 'chip', title: realExtensions(ext).map((e) => e.spec.metadata?.name).join('\n') }, `${realExtensions(ext).length} ext`) : null,
            el('span', { class: 'faint' }, [m.cpu && `${m.cpu} CPU`, m.memory].filter(Boolean).join(' · ')),
        ),
    );
    on(card, 'click', () => select(m.name));
    on(card, 'keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            select(m.name);
        }
    });
    return card;
}

function select(name: string): void {
    state.selected = state.selected === name ? '' : name;
    render();
}

// ----- the drawer --------------------------------------------------------------------------

const TABS: [Tab, string][] = [
    ['overview', 'Overview'],
    ['services', 'Services'],
    ['logs', 'Logs'],
    ['kernel', 'Kernel'],
    ['network', 'Network'],
    ['storage', 'Storage'],
    ['etcd', 'etcd'],
];

function drawer(m: Machine): HTMLElement {
    const ready = !!state.conn?.ready;
    const tabs = TABS.filter(([t]) => t !== 'etcd' || m.controlPlane);
    if (!tabs.some(([t]) => t === state.tab)) state.tab = 'overview';
    return el('aside', { class: 'drawer card' },
        el('div', { class: 'drawer-head' },
            el('div', { class: 'grow' },
                el('h2', {}, m.name, ' ', versionBadge(m.talos)),
                el('div', { class: 'dim small mono' }, `${m.address} · ${m.controlPlane ? 'control plane' : 'worker'} · ${m.kernel}`),
            ),
            button('✕', () => select(m.name), { class: 'icon-btn', title: 'Close', 'aria-label': 'Close' }),
        ),
        el('div', { class: 'drawer-actions' },
            ready ? button('Console', () => void openConsole(state.conn!, m).catch(showError), { class: 'btn' }) : null,
            ready ? button('Dashboard ↗', () => void dashboard(state.conn!, [m.address]).catch(showError), { class: 'btn', title: 'talosctl dashboard, in your own terminal' }) : null,
            button('Kubernetes node', () => void k8sdockside.open({ kind: 'nodes', name: m.name }), { class: 'btn ghost' }),
            el('span', { class: 'grow' }),
            ready ? button('Reboot…', () => void reboot(m), { class: 'btn danger-outline' }) : null,
            ready ? button('Shut down…', () => void shutdown(m), { class: 'btn danger-outline' }) : null,
        ),
        ready
            ? el('nav', { class: 'tabs', role: 'tablist' },
                ...tabs.map(([t, label]) => button(label, () => { state.tab = t; render(); }, { class: t === state.tab ? 'tab on' : 'tab', role: 'tab', 'aria-selected': t === state.tab ? 'true' : 'false' })),
            )
            : null,
        el('div', { class: 'drawer-body' }, ready ? body(m) : notConnected()),
    );
}

function notConnected(): HTMLElement {
    return el('p', { class: 'dim' }, 'Connect talosctl above to see this machine’s services, logs, hardware and storage, and to upgrade or reboot it.');
}

/** A tab's contents, read once per machine and tab, with a way to read again. */
function body(m: Machine): Child {
    const key = `${m.name}/${state.tab}${state.tab === 'logs' ? '/' + state.logService : ''}`;
    const kept = state.drawer.get(key);
    if (kept instanceof Promise) return loading();
    if (kept) return kept;
    const reading = readTab(m, state.tab).then(
        (content) => void state.drawer.set(key, content),
        (err: unknown) => void state.drawer.set(key, el('p', { class: 'tone-error' }, message(err))),
    ).finally(() => {
        if (state.selected === m.name) render();
    });
    state.drawer.set(key, reading);
    return loading();
}

function loading(): HTMLElement {
    return el('div', { class: 'loading' }, el('span', { class: 'pulse' }), ' Asking the machine…');
}

function refreshTab(m: Machine): HTMLElement {
    return button('Read again', () => {
        for (const k of [...state.drawer.keys()]) if (k.startsWith(`${m.name}/${state.tab}`)) state.drawer.delete(k);
        render();
    }, { class: 'link small' });
}

async function readTab(m: Machine, tab: Tab): Promise<Child> {
    const conn = state.conn!;
    switch (tab) {
        case 'overview':
            return overview(m, conn);
        case 'services':
            return servicesTab(m, conn);
        case 'logs':
            return logsTab(m, conn);
        case 'kernel': {
            const out = await text(conn, ['dmesg'], [m.address]);
            return pre(lastLines(stripNode(out, m.address), 400), refreshTab(m));
        }
        case 'network':
            return networkTab(m, conn);
        case 'storage':
            return storageTab(m, conn);
        case 'etcd':
            return etcdTab(m, conn);
    }
}

function pre(content: string, ...extra: Child[]): HTMLElement {
    return el('div', {}, el('div', { class: 'tab-tools' }, ...extra), el('pre', { class: 'out' }, content || '(nothing)'));
}

/** talosctl puts "<node>: " before every line it streams; on one machine it says nothing. */
function stripNode(out: string, node: string): string {
    const prefix = node + ': ';
    return out.split('\n').map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : l)).join('\n');
}

function lastLines(text: string, n: number): string {
    const lines = text.split('\n');
    return lines.length > n ? lines.slice(-n).join('\n') : text;
}

function kv(rows: [string, Child][]): HTMLElement {
    return el('dl', { class: 'kv' }, ...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v ?? '—')]));
}

async function overview(m: Machine, conn: Connection): Promise<Child> {
    const [info, procs, mem, time] = await Promise.all([
        getOne<Record<string, string>>(conn, 'systeminformation', m.address).catch(() => []),
        getOne<Record<string, unknown>>(conn, 'processors', m.address).catch(() => []),
        getOne<{ sizeMiB?: number }>(conn, 'memorymodules', m.address).catch(() => []),
        getOne<{ synced?: boolean }>(conn, 'timestatus', m.address).catch(() => []),
    ]);
    const ext = itemsOf(state.live.extensions, m.address) ?? [];
    const sec = itemsOf(state.live.security, m.address)?.[0]?.spec;
    const status = itemsOf(state.live.status, m.address)?.[0]?.spec;
    const sys = info[0]?.spec ?? {};
    const cores = procs.reduce((n, p) => n + Number(p.spec.threadCount ?? p.spec.coreCount ?? 0), 0);
    const memMiB = mem.reduce((n, d) => n + (d.spec.sizeMiB ?? 0), 0);
    const schematic = schematicOf(ext);

    return el('div', { class: 'stack' },
        upgradePanel(m, schematic),
        status?.status?.unmetConditions?.length
            ? el('div', { class: 'callout warn' }, el('strong', {}, 'Not ready: '), status.status.unmetConditions.map((c) => `${c.name} (${c.reason})`).join(', '))
            : null,
        el('h4', {}, 'Machine'),
        kv([
            ['Stage', status?.stage ?? '—'],
            ['Hardware', [sys.manufacturer, sys.productName].filter(Boolean).join(' ') || '—'],
            ['CPU', cores ? `${cores} threads · ${procs.length} socket${procs.length === 1 ? '' : 's'}` : m.cpu],
            ['Memory', memMiB ? `${(memMiB / 1024).toFixed(1)} GiB` : m.memory],
            ['Time', time[0] ? (time[0].spec.synced ? 'synchronised' : 'not synchronised') : '—'],
            ['Kubelet', m.kubelet],
        ]),
        el('h4', {}, 'Security'),
        kv([
            ['Secure Boot', sec ? (sec.secureBoot ? 'on' : 'off') : '—'],
            ['Module signatures', sec ? (sec.moduleSignatureEnforced ? 'enforced' : 'not enforced') : '—'],
            ['SELinux', sec?.selinuxState ?? '—'],
        ]),
        el('h4', {}, `Extensions `, el('span', { class: 'faint' }, String(realExtensions(ext).length))),
        realExtensions(ext).length
            ? el('ul', { class: 'ext-list' }, ...realExtensions(ext).map((e) =>
                el('li', { title: e.spec.metadata?.description ?? '' }, el('span', {}, e.spec.metadata?.name ?? '?'), el('span', { class: 'faint mono small' }, e.spec.metadata?.version ?? ''))))
            : el('p', { class: 'faint' }, 'None.'),
        schematic ? el('p', { class: 'faint small mono', title: 'Image Factory schematic' }, `schematic ${schematic.slice(0, 16)}…`) : null,
    );
}

/** Where this machine should go next, and the command that takes it there. */
function upgradePanel(m: Machine, schematic: string): HTMLElement {
    const next = nextUpgrade(m.talos);
    const versions = RELEASES.map((r) => r.latest).filter((v) => !m.talos || parseVersion(v)!.raw !== m.talos.raw);
    const pick = el('select', { 'aria-label': 'Talos version', 'data-k8sdockside-keep': 'off' },
        ...versions.map((v) => {
            const o = el('option', { value: v }, v + (v === next?.latest ? ' (next step)' : v === LATEST_STABLE.latest ? ' (latest)' : ''));
            o.selected = v === (next?.latest ?? LATEST_STABLE.latest);
            return o;
        }),
    );
    const image = el('input', { type: 'text', class: 'mono grow', 'aria-label': 'Installer image', spellcheck: 'false', 'data-k8sdockside-keep': 'off' });
    image.value = installerImage(pick.value, schematic);
    on(pick, 'change', () => (image.value = installerImage(pick.value, schematic)));

    const s = standing(m.talos);
    return el('div', { class: `upgrade card-inner v-${s}` },
        el('div', { class: 'upgrade-head' },
            el('strong', {}, next ? `Upgrade available: ${next.latest}` : s === 'current' ? 'On the latest stable' : STANDING_TEXT[s]),
            next && next !== LATEST_STABLE ? el('span', { class: 'faint small' }, ` · then ${LATEST_STABLE.latest}`) : null,
        ),
        el('div', { class: 'row' },
            pick,
            image,
            button('Upgrade…', () => void run(state.conn!, ['upgrade', '--image', image.value.trim()], m, {
                title: `Upgrade ${m.name} to ${pick.value}`,
                danger: true,
                confirm: m.name,
            }).catch(declined), { class: 'btn primary' }),
        ),
        el('p', { class: 'faint small' }, schematic
            ? 'The installer keeps this machine’s Image Factory schematic, and so its extensions. The machine drains, upgrades and reboots; watch it in the console.'
            : 'No Image Factory schematic: the stock installer is used. Change the image if this machine needs extensions.'),
    );
}

async function servicesTab(m: Machine, conn: Connection): Promise<Child> {
    const services = await getOne<ServiceSpec>(conn, 'services', m.address);
    return el('div', {},
        el('div', { class: 'tab-tools' }, refreshTab(m)),
        el('table', { class: 'grid' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Service'), el('th', {}, 'State'), el('th', {}, ''))),
            el('tbody', {}, ...services.map((s) => {
                const id = String(s.metadata.id);
                const h = serviceHealth(s.spec);
                return el('tr', {},
                    el('td', { class: 'mono' }, id),
                    el('td', {}, dot(h === 'healthy' ? 'ok' : h === 'running' ? 'info' : h === 'stopped' ? 'error' : 'warn'), ' ', h),
                    el('td', { class: 'right' },
                        button('Logs', () => { state.logService = id; state.tab = 'logs'; render(); }, { class: 'link' }),
                        button('Restart…', () => void run(conn, ['service', id, 'restart'], m, { title: `Restart ${id} on ${m.name}` }).catch(declined), { class: 'link' }),
                    ),
                );
            })),
        ),
    );
}

async function logsTab(m: Machine, conn: Connection): Promise<Child> {
    const services = itemsOf(state.live.services, m.address)?.map((s) => String(s.metadata.id)) ?? ['kubelet'];
    const pick = el('select', { 'aria-label': 'Service', 'data-k8sdockside-keep': 'off' },
        ...services.map((id) => {
            const o = el('option', { value: id }, id);
            o.selected = id === state.logService;
            return o;
        }),
    );
    on(pick, 'change', () => { state.logService = pick.value; render(); });
    const out = await text(conn, ['logs', state.logService, '--tail', '300'], [m.address]);
    return pre(stripNode(out, m.address), pick, refreshTab(m),
        button('Follow in console', () => void openConsole(conn, m).catch(showError), { class: 'link small', title: `Then type: logs ${state.logService} -f` }));
}

async function networkTab(m: Machine, conn: Connection): Promise<Child> {
    const [addresses, resolvers] = await Promise.all([
        getOne<{ address: string; linkName: string; family: string; scope: string }>(conn, 'addresses', m.address),
        getOne<{ dnsServers?: string[] }>(conn, 'resolvers', m.address).catch(() => []),
    ]);
    const shown = addresses.filter((a) => a.spec.scope === 'global' && !/^(lo|cilium|lxc|flannel|cni|kube-ipvs|vxlan)/.test(a.spec.linkName));
    return el('div', { class: 'stack' },
        el('div', { class: 'tab-tools' }, refreshTab(m)),
        el('h4', {}, 'Addresses'),
        el('table', { class: 'grid' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Link'), el('th', {}, 'Address'), el('th', {}, 'Family'))),
            el('tbody', {}, ...shown.map((a) => el('tr', {}, el('td', { class: 'mono' }, a.spec.linkName), el('td', { class: 'mono' }, a.spec.address), el('td', {}, a.spec.family)))),
        ),
        el('p', { class: 'faint small' }, `${addresses.length - shown.length} more on loopback and CNI links.`),
        el('h4', {}, 'DNS'),
        el('p', { class: 'mono' }, resolvers.flatMap((r) => r.spec.dnsServers ?? []).join(', ') || '—'),
    );
}

async function storageTab(m: Machine, conn: Connection): Promise<Child> {
    const [disks, volumes] = await Promise.all([
        getOne<{ dev_path: string; pretty_size: string; model?: string; transport?: string; readonly?: boolean; cdrom?: boolean }>(conn, 'disks', m.address),
        getOne<{ phase: string; type: string; mountSpec?: { targetPath?: string }; prettySize?: string }>(conn, 'volumestatus', m.address).catch(() => []),
    ]);
    const real = disks.filter((d) => !/\/(loop|ram|zram)\d/.test(d.spec.dev_path) && !d.spec.cdrom);
    const vols = volumes.filter((v) => v.spec.type !== 'overlay');
    return el('div', { class: 'stack' },
        el('div', { class: 'tab-tools' }, refreshTab(m)),
        el('h4', {}, 'Disks'),
        el('table', { class: 'grid' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Device'), el('th', {}, 'Size'), el('th', {}, 'Model'), el('th', {}, 'Bus'))),
            el('tbody', {}, ...real.map((d) => el('tr', {}, el('td', { class: 'mono' }, d.spec.dev_path), el('td', {}, d.spec.pretty_size), el('td', {}, d.spec.model ?? ''), el('td', {}, d.spec.transport ?? '')))),
        ),
        el('h4', {}, 'Volumes'),
        el('table', { class: 'grid' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Volume'), el('th', {}, 'Phase'), el('th', {}, 'Mounted at'))),
            el('tbody', {}, ...vols.map((v) => el('tr', {},
                el('td', { class: 'mono' }, String(v.metadata.id)),
                el('td', {}, dot(v.spec.phase === 'ready' ? 'ok' : 'warn'), ' ', v.spec.phase),
                el('td', { class: 'mono' }, v.spec.mountSpec?.targetPath ?? ''),
            ))),
        ),
    );
}

async function etcdTab(m: Machine, conn: Connection): Promise<Child> {
    const [status, members] = await Promise.all([
        text(conn, ['etcd', 'status'], [m.address]),
        text(conn, ['etcd', 'members'], [m.address]),
    ]);
    return el('div', { class: 'stack' },
        el('div', { class: 'tab-tools' },
            refreshTab(m),
            button('Defragment…', () => void run(conn, ['etcd', 'defrag'], m, { title: `Defragment etcd on ${m.name}` }).catch(declined), { class: 'link small' }),
        ),
        el('h4', {}, 'Status'),
        el('pre', { class: 'out' }, status),
        el('h4', {}, 'Members'),
        el('pre', { class: 'out' }, members),
    );
}

// ----- operations ------------------------------------------------------------------------

/** Saying no to a confirmation is not an error worth a banner. */
function declined(err: unknown): void {
    if (!/declined/.test(message(err))) showError(err);
}

async function reboot(m: Machine): Promise<void> {
    await run(state.conn!, ['reboot'], m, { title: `Reboot ${m.name}`, danger: true, confirm: m.name }).catch(declined);
}

async function shutdown(m: Machine): Promise<void> {
    await run(state.conn!, ['shutdown'], m, { title: `Shut down ${m.name}`, danger: true, confirm: m.name }).catch(declined);
}

function firstControlPlane(): Machine | undefined {
    return state.machines.find((m) => m.controlPlane && m.ready) ?? state.machines.find((m) => m.controlPlane);
}

async function healthCheck(): Promise<void> {
    const cp = firstControlPlane();
    if (!cp || !state.conn) return;
    showModal('Cluster health', el('div', { class: 'loading' }, el('span', { class: 'pulse' }), ` Running talosctl health from ${cp.name}…`));
    try {
        const out = await k8sdockside.tools!.exec('talosctl', ['health', '--wait-timeout', '25s', '--context', state.conn.context, '--nodes', cp.address]);
        showModal('Cluster health', el('div', {},
            el('p', {}, dot(out.code === 0 ? 'ok' : 'error'), out.code === 0 ? ' Every check passed.' : ' Some checks did not pass.'),
            el('pre', { class: 'out' }, (out.stdout + '\n' + out.stderr).trim()),
        ));
    } catch (err) {
        showModal('Cluster health', el('p', { class: 'tone-error' }, message(err)));
    }
}

function openK8sUpgrade(): void {
    const cp = firstControlPlane();
    if (!cp) return;
    const current = state.machines.find((m) => m.kubelet)?.kubelet ?? '';
    const input = el('input', { type: 'text', class: 'mono', placeholder: 'e.g. 1.37.2', 'aria-label': 'Kubernetes version', 'data-k8sdockside-keep': 'off' });
    input.value = state.k8sTarget;
    showModal('Upgrade Kubernetes', el('div', { class: 'stack' },
        el('p', {}, `Now ${current}. talosctl upgrade-k8s upgrades the control plane, then every kubelet, from ${cp.name}. Check the version is supported by the Talos your machines run.`),
        el('div', { class: 'row' },
            input,
            button('Dry run…', () => void go(true), { class: 'btn' }),
            button('Upgrade…', () => void go(false), { class: 'btn primary' }),
        ),
    ));
    async function go(dry: boolean): Promise<void> {
        const to = input.value.trim().replace(/^v/, '');
        state.k8sTarget = to;
        if (!/^\d+\.\d+\.\d+$/.test(to)) return showError('Give a version like 1.37.2');
        closeModal();
        await run(state.conn!, ['upgrade-k8s', '--to', to, ...(dry ? ['--dry-run'] : [])], cp!, {
            title: `${dry ? 'Plan' : 'Run'} the Kubernetes upgrade to ${to}`,
            danger: !dry,
            confirm: dry ? undefined : to,
        }).catch(declined);
    }
}

function showModal(title: string, content: Child): void {
    closeModal();
    const box = el('div', { class: 'modal-scrim', id: 'modal' },
        el('div', { class: 'modal card', role: 'dialog', 'aria-label': title },
            el('div', { class: 'drawer-head' }, el('h2', { class: 'grow' }, title), button('✕', closeModal, { class: 'icon-btn', 'aria-label': 'Close' })),
            content,
        ),
    );
    on(box, 'click', (e) => { if (e.target === box) closeModal(); });
    document.body.append(box);
}

function closeModal(): void {
    document.getElementById('modal')?.remove();
}

start().catch(showError);
