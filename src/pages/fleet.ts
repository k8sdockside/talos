// The Talos board: the cluster's machines on a version runway, a tile for
// each, and a drawer for the one picked -- with what talosctl knows about it
// and the operations it can be asked for.

import { button, byId, el, replace, svg, type Child } from '@k8sdockside/plugin-sdk/dom';
import {
    allAddresses,
    installerImage,
    latestStable,
    machineOf,
    minorOf,
    nextUpgrade,
    parseVersion,
    realExtensions,
    releases,
    schematicOf,
    serviceHealth,
    serviceOk,
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
    imageVersion,
    installSource,
    upgradeOptions,
    type FactorySpec,
    type PlatformSpec,
    type InstallSource,
    type UpgradeOption,
    compareVersions,
    heldBackPrereleases,
} from '../model/talos';
import { TALOS_LOGO } from '../ui/logo';
import { loadReleases, releasesText, releasesTitle } from '../ui/releases';
import { pageNav, shortPath } from '../ui/shell';
import { ADDRESS_FROM, STANDING_TEXT, clearError, dot, on, showError, takeHandOver, versionBadge, when } from '../ui/common';
import {
    addressed,
    chooseConfig,
    connect,
    console as openConsole,
    dashboard,
    dashboardLabel,
    dashboardTitle,
    exec,
    forgetConfig,
    getEach,
    getOne,
    installImage,
    message,
    run,
    text,
    useContext,
    type Connection,
    learnAddresses,
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
    /** The machines as Kubernetes lists them, before the settings pick their addresses. */
    listed: [] as Machine[],
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
    /** What the machine list beside an open machine is filtered by. */
    railQuery: '',
    /** Whether long lines in a tab's output wrap, rather than scroll sideways. */
    wrap: false,
};

// ----- reading ---------------------------------------------------------------------------

async function start(): Promise<void> {
    const ctx = await k8sdockside.ready();
    state.contextName = ctx.contextName;
    const focus = await takeHandOver();
    if (focus) state.selected = focus;
    // The live release list, when the app can get it: drawn again once it is in.
    void loadReleases().then((changed) => {
        if (!changed || !state.listed.length) return;
        // A machine's overview tab holds its upgrade panel, which names versions.
        for (const [k, v] of [...state.drawer]) if (k.endsWith('/overview') && !(v instanceof Promise)) state.drawer.delete(k);
        render();
    });

    let first = true;
    k8sdockside.watch<K8sDockside.KubeObject>(
        { kind: 'nodes', interval: 15_000 },
        (items) => {
            state.listed = sortMachines((items as unknown as NodeObject[]).map(machineOf));
            state.machines = addressed(state.listed, state.conn);
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
    state.conn = await connect(allAddresses(state.listed));
    state.machines = addressed(state.listed, state.conn);
    // Public addresses Kubernetes does not know (Hetzner and other clouds
    // without a cloud controller manager), asked of the machines themselves.
    await learnAddresses(state.conn, state.machines);
    state.machines = addressed(state.listed, state.conn);
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
    // Everything is drawn again on each reading, and the machine list's search
    // box with it: put the focus and the caret back where they were.
    const typing = document.activeElement instanceof HTMLInputElement && document.activeElement.id === RAIL_SEARCH
        ? { start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
        : null;
    replace(
        byId('main'),
        header(),
        connectionBar(),
        // One machine open is the machine at full width, with every machine
        // in a list beside it -- a board of tiles next to a drawer leaves
        // neither enough room once there are more than a handful.
        selected
            ? el('div', { class: 'layout focus' }, rail(selected), drawer(selected))
            : el('div', {}, runway(), el('div', { class: 'layout' }, el('div', { class: 'board' }, ...groups()))),
    );
    if (typing) {
        const input = document.getElementById(RAIL_SEARCH) as HTMLInputElement | null;
        input?.focus();
        input?.setSelectionRange(typing.start, typing.end);
    }
    document.querySelector('.rail-item.on')?.scrollIntoView({ block: 'nearest' });
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
        pageNav('overview'),
        el('div', { class: 'head-actions' },
            state.conn?.ready ? button('Console', () => void openConsole(state.conn!, null).catch(showError), { class: 'btn' }) : null,
            state.conn?.ready ? button('Health check', () => void healthCheck(), { class: 'btn' }) : null,
            state.conn?.ready ? button('Upgrade Kubernetes…', () => openK8sUpgrade(), { class: 'btn' }) : null,
            button('Refresh', () => void readLive(true), { class: 'btn ghost', title: state.live.at ? `Read at ${when(state.live.at)}` : '' }),
        ),
    );
}

/** Which talosctl, talosconfig and context -- or what to do to get them. */
/** talosctl dashboard for every machine that has an address, one button. */
function allDashboard(): HTMLElement | null {
    const nodes = state.machines.map((m) => m.address).filter(Boolean);
    if (!state.conn || !nodes.length) return null;
    return button(dashboardLabel(nodes.length, false), () => void dashboard(state.conn!, nodes).catch(showError), { class: 'btn primary', title: dashboardTitle(nodes) });
}

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
            c.fix !== 'app' ? button('Settings', () => void k8sdockside.openView('settings'), { class: 'btn ghost' }) : null,
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
        c.settings.endpoints.use !== 'config' ? el('span', { class: 'sep' }) : null,
        c.settings.endpoints.use === 'node'
            ? el('span', { class: 'dim', title: 'Set in Settings' }, 'endpoints: each machine')
            : c.settings.endpoints.use === 'custom'
                ? el('span', { class: 'dim', title: 'Set in Settings' }, 'endpoints ', el('span', { class: 'mono' }, c.settings.endpoints.custom.join(', ')))
                : null,
        el('span', { class: 'grow' }),
        allDashboard(),
        button('Settings', () => void k8sdockside.openView('settings'), { class: 'link', title: 'talosconfig, endpoints and the address talosctl uses for each machine' }),
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

// ----- the version runway -----------------------------------------------------------------

function runway(): HTMLElement {
    const talos = state.machines.filter((m) => m.talos);
    const byMinor = new Map<string, Machine[]>();
    for (const m of talos) {
        const k = minorOf(m.talos!);
        byMinor.set(k, [...(byMinor.get(k) ?? []), m]);
    }
    const lines = releases();
    const older = talos.filter((m) => !lines.some((r) => r.minor === minorOf(m.talos!)));

    const stops = lines.map((r) => {
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
            el('span', { class: 'faint small', title: releasesTitle() }, `Releases ${releasesText()}`),
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
    const latest = latestStable().latest;
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
    const healthy = services?.filter((s) => serviceOk(s.spec)).length ?? 0;

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
        el('div', { class: 'mono faint small', title: ADDRESS_FROM[m.addressFrom] }, m.address || 'no address', m.cordoned ? el('span', { class: 'chip warn' }, 'cordoned') : null),
        el('div', { class: 'tile-stage small' },
            err ? el('span', { class: 'tone-error' }, err)
            : stage ? el('span', {}, stage, status?.status?.ready === false ? el('span', { class: 'tone-warn' }, ' · not ready') : null)
            : el('span', { class: 'faint' }, state.conn?.ready ? '…' : m.ready ? 'Ready in Kubernetes' : 'NotReady in Kubernetes'),
        ),
        healthBar,
        services ? el('div', { class: 'faint small' }, `${healthy}/${services.length} services OK`) : null,
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

// ----- the machine list beside an open machine ----------------------------------------------

const RAIL_SEARCH = 'rail-search';

/** The machines the list shows: all of them, or those whose name or address has the query in it. */
function railMachines(): Machine[] {
    const q = state.railQuery.trim().toLowerCase();
    return q ? state.machines.filter((m) => m.name.toLowerCase().includes(q) || m.address.includes(q)) : state.machines;
}

/** Opens the machine `step` places from the open one in the list, wrapping round. */
function step(by: number): void {
    const list = railMachines();
    if (!list.length) return;
    const at = list.findIndex((m) => m.name === state.selected);
    const next = list[(at + by + list.length) % list.length]!;
    state.selected = next.name;
    render();
}

function rail(selected: Machine): HTMLElement {
    const list = railMachines();
    const search = el('input', {
        id: RAIL_SEARCH,
        type: 'search',
        class: 'rail-search',
        placeholder: `Find among ${state.machines.length}…`,
        'aria-label': 'Find a machine by name or address',
        spellcheck: 'false',
        'data-k8sdockside-keep': 'off',
    });
    search.value = state.railQuery;
    on(search, 'input', () => { state.railQuery = search.value; render(); });
    on(search, 'keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            step(e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'Enter' && list.length && !list.some((m) => m.name === selected.name)) {
            state.selected = list[0]!.name;
            render();
        } else if (e.key === 'Escape') {
            if (state.railQuery) state.railQuery = '';
            else state.selected = '';
            render();
        }
    });

    const cp = list.filter((m) => m.controlPlane);
    const workers = list.filter((m) => !m.controlPlane);
    const section = (title: string, ms: Machine[]) => ms.length
        ? [el('div', { class: 'rail-group' }, title, el('span', { class: 'faint' }, ` ${ms.length}`)), ...ms.map((m) => railItem(m, selected))]
        : [];
    return el('nav', { class: 'rail card', 'aria-label': 'Machines' },
        el('div', { class: 'rail-head' },
            button('← Board', () => { state.selected = ''; render(); }, { class: 'link small', title: 'Back to every machine as tiles (Esc)' }),
            el('span', { class: 'grow' }),
            el('span', { class: 'faint small' }, list.length === state.machines.length ? `${list.length}` : `${list.length} of ${state.machines.length}`),
        ),
        search,
        el('div', { class: 'rail-list', role: 'listbox' },
            ...section('Control plane', cp),
            ...section('Workers', workers),
            list.length ? null : el('p', { class: 'faint small rail-empty' }, 'No machine matches.'),
        ),
        el('div', { class: 'faint small rail-hint' }, '↑ ↓ in the search box move between machines'),
    );
}

function railItem(m: Machine, selected: Machine): HTMLElement {
    const status = itemsOf(state.live.status, m.address)?.[0]?.spec;
    const services = itemsOf(state.live.services, m.address);
    const err = errorOf(m.address);
    const stage = status?.stage ?? '';
    const bad = services?.filter((s) => !serviceOk(s.spec)).length ?? 0;
    const on_ = m.name === selected.name;
    const item = el('button', {
        type: 'button',
        class: `rail-item${on_ ? ' on' : ''}`,
        role: 'option',
        'aria-selected': on_ ? 'true' : 'false',
        title: [m.address || 'no address', err || stage || (m.ready ? 'Ready' : 'Not ready'), bad ? `${bad} service${bad === 1 ? '' : 's'} not OK` : ''].filter(Boolean).join(' · '),
    },
        dot(err ? 'error' : stage ? stageTone(stage) : m.ready ? 'ok' : 'error'),
        el('span', { class: 'grow ellipsis' }, m.name),
        bad ? el('span', { class: 'chip warn' }, String(bad)) : null,
        el('span', { class: `rail-ver v-${standing(m.talos)}` }, m.talos?.raw ?? ''),
    );
    on(item, 'click', () => { state.selected = m.name; render(); });
    return item;
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
                el('div', { class: 'dim small mono', title: ADDRESS_FROM[m.addressFrom] }, `${m.address || 'no address'} · ${m.controlPlane ? 'control plane' : 'worker'} · ${m.kernel}`),
            ),
            railMachines().length > 1 ? button('‹', () => step(-1), { class: 'icon-btn', title: 'Previous machine', 'aria-label': 'Previous machine' }) : null,
            railMachines().length > 1 ? button('›', () => step(1), { class: 'icon-btn', title: 'Next machine', 'aria-label': 'Next machine' }) : null,
            button('✕', () => select(m.name), { class: 'icon-btn', title: 'Back to the board', 'aria-label': 'Close' }),
        ),
        el('div', { class: 'drawer-actions' },
            ready ? button('Console', () => void openConsole(state.conn!, m).catch(showError), { class: 'btn' }) : null,
            ready ? button('Dashboard', () => void dashboard(state.conn!, [m.address]).catch(showError), { class: 'btn', title: dashboardTitle([m.address]) }) : null,
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
    const wrap = el('label', { class: 'small check' }, el('input', { type: 'checkbox', 'data-k8sdockside-keep': 'off' }), ' Wrap lines');
    const box = wrap.querySelector('input')!;
    box.checked = state.wrap;
    const out = el('pre', { class: `out${state.wrap ? ' wrap' : ''}` }, content || '(nothing)');
    on(box, 'change', () => { state.wrap = box.checked; out.classList.toggle('wrap', state.wrap); });
    return el('div', {}, el('div', { class: 'tab-tools' }, wrap, el('span', { class: 'grow' }), ...extra), out);
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
    const [info, procs, mem, time, factory, platform, configImage] = await Promise.all([
        getOne<Record<string, string>>(conn, 'systeminformation', m.address).catch(() => []),
        getOne<Record<string, unknown>>(conn, 'processors', m.address).catch(() => []),
        getOne<{ sizeMiB?: number }>(conn, 'memorymodules', m.address).catch(() => []),
        getOne<{ synced?: boolean }>(conn, 'timestatus', m.address).catch(() => []),
        getOne<FactorySpec>(conn, 'imagefactoryschematic', m.address).catch(() => []),
        getOne<PlatformSpec>(conn, 'platformmetadata', m.address).catch(() => []),
        // machine.install.image, read by the app out of the machine config;
        // the rest of the config never reaches this page.
        installImage(conn, m.address).catch(() => null),
    ]);
    const ext = itemsOf(state.live.extensions, m.address) ?? [];
    const sec = itemsOf(state.live.security, m.address)?.[0]?.spec;
    const status = itemsOf(state.live.status, m.address)?.[0]?.spec;
    const sys = info[0]?.spec ?? {};
    const cores = procs.reduce((n, p) => n + Number(p.spec.threadCount ?? p.spec.coreCount ?? 0), 0);
    const memMiB = mem.reduce((n, d) => n + (d.spec.sizeMiB ?? 0), 0);
    const schematic = schematicOf(ext);
    const source = installSource(factory[0]?.spec, platform[0]?.spec, sec?.secureBoot, schematic, configImage);

    return el('div', { class: 'stack' },
        upgradePanel(m, source),
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

/** Whether the upgrade panel offers alpha, beta and rc releases. Off until asked for. */
let withPrereleases = false;

const KIND_TEXT: Record<UpgradeOption['kind'], string> = { patch: 'patch', minor: 'next minor', prerelease: 'pre-release' };

/** Where this machine should go next, and the command that takes it there. */
function upgradePanel(m: Machine, src: InstallSource): HTMLElement {
    const next = nextUpgrade(m.talos);
    const stable = latestStable();
    const s = standing(m.talos);
    const head = el('div', { class: 'upgrade-head' },
        el('strong', {}, next ? `Upgrade available: ${next.latest}` : s === 'current' ? `On the latest stable, ${stable.latest}` : STANDING_TEXT[s]),
        next && next.latest !== stable.latest ? el('span', { class: 'faint small' }, ` · then ${stable.latest}`) : null,
        el('span', { class: 'faint small', title: releasesTitle() }, ` · releases ${releasesText()}`),
    );
    const pre = el('label', { class: 'small check' }, el('input', { type: 'checkbox', 'data-k8sdockside-keep': 'off' }), ' Show pre-releases (alpha, beta, rc)');
    const preBox = pre.querySelector('input')!;
    preBox.checked = withPrereleases;
    // The overview tab this panel sits in is kept rather than read again, so
    // the panel draws itself again in place.
    on(preBox, 'change', () => {
        withPrereleases = preBox.checked;
        preBox.closest('.upgrade')?.replaceWith(upgradePanel(m, src));
    });

    const sourceLine = el('p', { class: 'faint small', title: sourceTitle(src) },
        sourceText(src),
        src.note ? el('span', { class: 'tone-warn' }, ' ' + src.note) : null,
        src.known ? null : src.from === 'machine'
            ? el('span', { class: 'tone-warn' }, ' Factory or platform could not be read from the machine and is assumed; check the image.')
            : null,
    );

    const options = upgradeOptions(m.talos, withPrereleases);
    // Asking for pre-releases must never look like it did nothing: say which
    // exist and why they are not offered yet.
    const held = withPrereleases ? heldBackPrereleases(m.talos) : [];
    const heldLine = held.length
        ? el('p', { class: 'small tone-warn' }, held.map((h) => `${h.version} is not offered: ${h.reason}.`).join(' '))
        : withPrereleases && !options.some((o) => o.kind === 'prerelease')
            ? el('p', { class: 'faint small' }, 'No pre-release newer than this machine.')
            : null;
    if (!options.length) {
        return el('div', { class: `upgrade card-inner v-${s}` }, head,
            el('p', { class: 'dim small' }, m.talos ? `Nothing newer to upgrade ${m.talos.raw} to${withPrereleases ? '' : ' among stable releases'}. Downgrades are not offered.` : 'The Talos version is not known.'),
            el('div', { class: 'row' }, pre),
            heldLine,
            sourceLine,
        );
    }

    const pick = el('select', { 'aria-label': 'Talos version', 'data-k8sdockside-keep': 'off' },
        ...options.map((o) => {
            const opt = el('option', { value: o.version }, `${o.version} · ${KIND_TEXT[o.kind]}${o.next ? ' (next step)' : ''}`);
            opt.selected = o.next;
            return opt;
        }),
    );
    const image = el('input', { type: 'text', class: 'mono grow', 'aria-label': 'Installer image', spellcheck: 'false', 'data-k8sdockside-keep': 'off' });
    const go = button('Upgrade…', () => void upgrade(), { class: 'btn primary' });
    const care = el('div', {});
    const problem = el('p', { class: 'small tone-error', hidden: true });
    let ack: HTMLInputElement | null = null;

    const chosen = () => options.find((o) => o.version === pick.value)!;
    const check = () => {
        // The image can be edited, for an installer built some other way; its
        // tag must still be newer than what runs.
        const tagged = imageVersion(image.value.trim());
        const wrong = !tagged ? 'The image needs a version tag, like :v1.14.5.'
            : m.talos && compareVersions(tagged, m.talos) <= 0 ? `${tagged.raw} is not newer than ${m.talos.raw}: downgrades are not offered.`
            : '';
        problem.textContent = wrong;
        problem.hidden = !wrong;
        go.disabled = !!wrong || (ack !== null && !ack.checked);
    };
    const choose = () => {
        const o = chosen();
        image.value = installerImage(o.version, src);
        ack = null;
        if (o.kind === 'patch') {
            replace(care);
        } else {
            const to = parseVersion(o.version)!;
            const line = `${to.major}.${to.minor}`;
            const notes = `https://github.com/siderolabs/talos/releases/tag/${o.version}`;
            const guide = `https://www.talos.dev/v${line}/talos-guides/upgrading-talos/`;
            const box = el('input', { type: 'checkbox', 'data-k8sdockside-keep': 'off' }) as HTMLInputElement;
            on(box, 'change', check);
            ack = box;
            replace(care, el('div', { class: `callout ${o.kind === 'prerelease' ? 'error' : 'warn'}` },
                o.kind === 'prerelease'
                    ? el('p', {}, el('strong', {}, `${o.version} is a pre-release. `), 'Alpha, beta and rc releases are experimental: they can break the machine, and are not for clusters anyone depends on.')
                    : el('p', {}, el('strong', {}, `A new minor release, ${m.talos ? `${m.talos.major}.${m.talos.minor}` : ''} → ${line}. `),
                        'A minor can change a great deal: the machine config’s format and multi-document configs, options removed or renamed, new defaults. Read its upgrade notes before upgrading, and upgrade one machine first.'),
                el('p', { class: 'small' },
                    button('Release notes ↗', () => void k8sdockside.openUrl(notes), { class: 'link' }), ' · ',
                    button(`Upgrading Talos ${line} ↗`, () => void k8sdockside.openUrl(guide), { class: 'link' })),
                el('label', { class: 'small check' }, box,
                    o.kind === 'prerelease' ? ` I understand ${o.version} is experimental, and want it on ${m.name}` : ` I have read the ${line} upgrade notes`),
            ));
        }
        check();
    };
    const upgrade = async () => {
        const o = chosen();
        await run(state.conn!, ['upgrade', '--image', image.value.trim()], m, {
            title: `Upgrade ${m.name} to ${o.version}${o.kind === 'patch' ? '' : o.kind === 'minor' ? ' (new minor release)' : ' (pre-release)'}`,
            danger: true,
            confirm: m.name,
        }).catch(declined);
    };
    on(pick, 'change', choose);
    on(image, 'input', check);
    choose();

    return el('div', { class: `upgrade card-inner v-${s}` }, head,
        el('div', { class: 'row' }, pick, image, go),
        problem,
        care,
        el('div', { class: 'row' }, pre),
        heldLine,
        sourceLine,
        el('p', { class: 'faint small' }, src.schematic
            ? 'The installer keeps this machine’s factory, installer and schematic -- and so its extensions -- and changes only the version. The machine drains, upgrades and reboots; watch it in the console.'
            : src.repository
                ? 'The installer is the one the machine config names, with only the version changed. Change the image if this machine needs extensions.'
                : 'Change the image if this machine needs extensions or was installed from an installer of your own.'),
    );
}

/** Where each part of the installer image came from, in a line. */
function sourceText(src: InstallSource): string {
    const schematic = src.schematic
        ? ` · schematic ${src.schematic.slice(0, 12)}… ${src.schematicFrom === 'machine' ? 'from the running machine' : 'from the install image (as first installed)'}`
        : '';
    if (src.from === 'config') {
        return src.repository
            ? `Installer ${src.repository} from the machine config’s install image · version changed only`
            : `Installer ${src.factory}/${src.variant} from the machine config’s install image${schematic}`;
    }
    return src.schematic
        ? `Installer from ${src.factory} · ${src.variant}${schematic}`
        : 'No Image Factory schematic: the stock installer.';
}

function sourceTitle(src: InstallSource): string {
    const reads = 'imagefactoryschematic for the schematic it runs';
    return src.from === 'config'
        ? `Host and installer from machine.install.image, which the app reads out of the machine config for this plugin -- the plugin never sees the rest of the config. That image is the one the machine was first installed from (${src.configImage}); Talos does not update it on upgrade, so the schematic is read from the machine (${reads}) and the version is the one you pick.`
        : `Read from the machine (${reads}, platformmetadata, securitystate). The machine config's install image could not be read -- this needs K8s Dockside 0.1.33 or newer -- so the platform's installer is assumed from the platform Talos detected at boot.`;
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
                    el('td', {}, dot(h === 'healthy' || h === 'running' ? 'ok' : h === 'stopped' ? 'error' : 'warn'), ' ', h === 'running' ? 'running (no health check)' : h),
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
        const out = await exec(state.conn, ['health', '--wait-timeout', '25s'], [cp.address]);
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
