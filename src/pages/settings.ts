// Settings, per cluster: which talosconfig is in use and what is in it (its
// contexts, endpoints and nodes -- never its keys), the context, which
// endpoints talosctl connects to, and the address it is given for each
// machine. Kept in the app's storage for this cluster; every other page reads
// it through connect().

import { button, byId, el, replace, type Child } from '@k8sdockside/plugin-sdk/dom';
import {
    DEFAULT_SETTINGS,
    parseConfigInfo,
    pickAddress,
    splitList,
    type AddressChoice,
    type Machine,
    type MachineStatus,
    type TalosSettings,
} from '../model/talos';
import { ADDRESS_FROM, clearError, dot, on, showError } from '../ui/common';
import { loadCluster, loadingLine, pageHead, shortPath, type Cluster } from '../ui/shell';
import {
    addressed,
    chooseConfig,
    contextOf,
    execBare,
    forgetConfig,
    getOne,
    message,
    saveSettings,
    useContext,
} from '../ui/talos';

const state = {
    contextName: '',
    cluster: null as Cluster | null,
    /** `config info` for the context in use: label and value pairs, or why not. */
    info: null as [string, string][] | string | null,
    /** Per machine: '' while asking, 'ok: <stage>', or the error. */
    tests: new Map<string, string>(),
};

async function start(): Promise<void> {
    const ctx = await k8sdockside.ready();
    state.contextName = ctx.contextName;
    await reload();
}

async function reload(): Promise<void> {
    replace(byId('main'), pageHead('settings', state.contextName), loadingLine('Looking for talosctl and your talosconfig…'));
    state.cluster = await loadCluster(state.contextName);
    state.info = null;
    state.tests.clear();
    render();
    void readInfo();
}

/** What `talosctl config info` says about the context in use: roles and when the certificate expires. */
async function readInfo(): Promise<void> {
    const conn = state.cluster?.conn;
    if (!conn?.context) return;
    try {
        const out = await execBare(['config', 'info', '--context', conn.context]);
        const pairs = parseConfigInfo(out.stdout);
        state.info = pairs.length ? pairs : (out.stderr.trim() || `talosctl exited with ${out.code}`);
    } catch (err) {
        state.info = message(err);
    }
    render();
}

async function change(update: (s: TalosSettings) => TalosSettings): Promise<void> {
    const c = state.cluster;
    if (!c) return;
    const next = update(structuredClone(c.conn.settings));
    await saveSettings(next);
    c.conn = { ...c.conn, settings: next };
    c.machines = addressed(c.listed, c.conn);
    state.tests.clear();
    render();
}

// ----- drawing ------------------------------------------------------------------------------

function render(): void {
    clearError();
    const c = state.cluster;
    if (!c) return;
    replace(byId('main'),
        pageHead('settings', `${state.contextName} · how talosctl reaches this cluster`),
        el('div', { class: 'settings' },
            toolCard(c),
            configCard(c),
            endpointsCard(c),
            addressesCard(c),
        ),
    );
}

function section(title: string, intro: Child, ...body: Child[]): HTMLElement {
    return el('section', { class: 'card section' },
        el('h2', {}, title),
        intro ? el('p', { class: 'dim small' }, intro) : null,
        ...body,
    );
}

function kv(rows: [string, Child][]): HTMLElement {
    return el('dl', { class: 'kv' }, ...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v ?? '—')]));
}

function toolCard(c: Cluster): HTMLElement {
    const t = c.conn.status?.tool;
    if (!t) return section('talosctl', null, el('p', { class: 'tone-warn' }, c.conn.reason));
    return section('talosctl', null, kv([
        ['Found', t.found ? el('span', {}, dot('ok'), ' yes') : el('span', { class: 'tone-error' }, t.reason || 'no')],
        ['Path', el('span', { class: 'mono' }, t.path || '—')],
        ['Version', el('span', { class: 'mono' }, t.version || '—')],
    ]));
}

function configCard(c: Cluster): HTMLElement {
    const file = c.conn.status?.files[0];
    const configured = file?.source === 'configured';
    const contexts = c.conn.contexts;
    const parsed = contexts.length > 0;

    let health: Child;
    if (!file) health = el('span', { class: 'faint' }, 'unknown');
    else if (!file.exists) health = el('span', { class: 'tone-error' }, dot('error'), ' no file there');
    else if (!parsed) health = el('span', { class: 'tone-warn' }, dot('warn'), ' read, but no contexts: ', c.conn.reason);
    else health = el('span', {}, dot('ok'), ` read · ${contexts.length} context${contexts.length === 1 ? '' : 's'}`);

    const pick = el('select', { 'aria-label': 'talosconfig context', 'data-k8sdockside-keep': 'off' },
        ...contexts.map((ctx) => {
            const o = el('option', { value: ctx.name }, ctx.name + (ctx.current ? ' (talosconfig’s current)' : ''));
            o.selected = ctx.name === c.conn.context;
            return o;
        }),
    );
    on(pick, 'change', () => void useContext(pick.value).then(reload).catch(showError));

    return section('talosconfig',
        'The file talosctl is given for this cluster. Its keys and certificates stay in it: this page shows only its contexts, and where they point.',
        kv([
            ['File', el('span', { class: 'mono', title: file?.path ?? '' }, file?.path ? shortPath(file.path) : 'none')],
            ['Chosen', configured ? 'for this cluster' : 'talosctl’s default (TALOSCONFIG or ~/.talos/config)'],
            ['State', health],
            ['Context', parsed ? el('span', { class: 'row' }, pick, el('span', { class: 'faint small' }, c.conn.chosen ? 'chosen for this cluster' : 'matched to the cluster’s addresses')) : '—'],
        ]),
        el('div', { class: 'row' },
            button('Choose another file…', () => void chooseConfig().then(reload).catch(showError), { class: 'btn' }),
            configured ? button('Use the default', () => void forgetConfig().then(reload).catch(showError), { class: 'btn ghost' }) : null,
            button('Read again', () => void reload(), { class: 'btn ghost' }),
        ),
        parsed
            ? el('table', { class: 'grid' },
                el('thead', {}, el('tr', {}, el('th', {}, 'Context'), el('th', {}, 'Endpoints'), el('th', {}, 'Nodes'))),
                el('tbody', {}, ...contexts.map((ctx) => el('tr', { class: ctx.name === c.conn.context ? 'on' : '' },
                    el('td', { class: 'mono' }, ctx.name, ctx.name === c.conn.context ? el('span', { class: 'chip ok' }, 'in use') : null),
                    el('td', { class: 'mono small' }, ctx.endpoints.join(', ') || el('span', { class: 'faint' }, 'none')),
                    el('td', { class: 'mono small' }, ctx.nodes.join(', ') || el('span', { class: 'faint' }, 'none')),
                ))),
            )
            : null,
        parsed ? infoBlock() : null,
    );
}

function infoBlock(): HTMLElement {
    const info = state.info;
    if (info === null) return loadingLine('Reading the context…');
    if (typeof info === 'string') return el('p', { class: 'small tone-warn' }, `talosctl config info: ${info}`);
    return el('div', {}, el('h4', {}, 'The context in use'), kv(info.map(([k, v]) => [k, el('span', { class: 'mono small' }, v || '—')])));
}

function endpointsCard(c: Cluster): HTMLElement {
    const s = c.conn.settings.endpoints;
    const fromConfig = contextOf(c.conn)?.endpoints ?? [];
    const choices: [TalosSettings['endpoints']['use'], string][] = [
        ['config', `The talosconfig’s (${fromConfig.join(', ') || 'none set'})`],
        ['custom', 'These…'],
        ['node', 'Each machine itself'],
    ];
    const pick = el('select', { 'aria-label': 'Endpoints', 'data-k8sdockside-keep': 'off' },
        ...choices.map(([v, label]) => {
            const o = el('option', { value: v }, label);
            o.selected = v === s.use;
            return o;
        }),
    );
    const input = el('input', { type: 'text', class: 'mono grow', placeholder: 'e.g. 203.0.113.10, 203.0.113.11', 'aria-label': 'Endpoints', spellcheck: 'false', 'data-k8sdockside-keep': 'off' });
    input.value = s.custom.join(', ');
    input.hidden = pick.value !== 'custom';
    const save = (): void => {
        const use = pick.value as TalosSettings['endpoints']['use'];
        const custom = splitList(input.value);
        if (use === 'custom' && !custom.length) {
            input.hidden = false;
            input.focus();
            return;
        }
        void change((x) => ({ ...x, endpoints: { use, custom } })).catch(showError);
    };
    on(pick, 'change', save);
    on(input, 'change', save);
    return section('Endpoints',
        'talosctl connects to an endpoint and asks it about the machines. Use the machines’ own addresses when the talosconfig has no endpoints, or names ones you cannot reach from here.',
        el('div', { class: 'row' }, pick, input),
        fromConfig.length === 0 && s.use === 'config'
            ? el('p', { class: 'small tone-warn' }, 'The context names no endpoints: talosctl will not know where to connect. Pick “Each machine itself” or give some.')
            : null,
    );
}

const CHOICES: [AddressChoice, string][] = [
    ['auto', 'Default'],
    ['external', 'ExternalIP'],
    ['internal', 'InternalIP'],
    ['custom', 'Other…'],
];

function addressesCard(c: Cluster): HTMLElement {
    const settings = c.conn.settings;
    const rule = el('select', { 'aria-label': 'Default address', 'data-k8sdockside-keep': 'off' },
        ...([
            ['auto', 'One the talosconfig names, else ExternalIP, else InternalIP'],
            ['external', 'ExternalIP, else InternalIP'],
            ['internal', 'InternalIP, else ExternalIP'],
        ] as [TalosSettings['prefer'], string][]).map(([v, label]) => {
            const o = el('option', { value: v }, label);
            o.selected = v === settings.prefer;
            return o;
        }),
    );
    on(rule, 'change', () => void change((x) => ({ ...x, prefer: rule.value as TalosSettings['prefer'] })).catch(showError));
    const own = Object.keys(settings.nodes).length;

    return section('Machine addresses',
        'The address talosctl is given for each machine (--nodes). On clouds such as Hetzner the InternalIP is often not reachable from your computer; the ExternalIP is. Where Kubernetes lists no ExternalIP, the public addresses Talos itself reports are used, marked “from Talos”.',
        el('div', { class: 'row' },
            el('span', { class: 'dim' }, 'Default'), rule,
            el('span', { class: 'grow' }),
            c.conn.ready ? button('Test all', () => void testAll(), { class: 'btn' }) : null,
            own ? button(`Reset ${own} machine${own === 1 ? '' : 's'} to default`, () => void change((x) => ({ ...x, nodes: {} })).catch(showError), { class: 'btn ghost' }) : null,
            JSON.stringify(settings) !== JSON.stringify(DEFAULT_SETTINGS)
                ? button('Reset everything', () => void change(() => structuredClone(DEFAULT_SETTINGS)).catch(showError), { class: 'btn ghost', title: 'Default addresses and the talosconfig’s endpoints' })
                : null,
        ),
        el('div', { class: 'scroll-x' },
            el('table', { class: 'grid' },
                el('thead', {}, el('tr', {},
                    el('th', {}, 'Machine'),
                    el('th', {}, 'InternalIP'),
                    el('th', {}, 'ExternalIP'),
                    el('th', {}, 'Use'),
                    el('th', {}, 'talosctl uses'),
                    el('th', {}, ''),
                )),
                el('tbody', {}, ...c.machines.map((m) => addressRow(c, m))),
            ),
        ),
    );
}

function addressRow(c: Cluster, m: Machine): HTMLElement {
    const own = c.conn.settings.nodes[m.name];
    const use: AddressChoice = own?.use ?? 'auto';
    const auto = pickAddress(m, { ...c.conn.settings, nodes: {} }, contextOf(c.conn));
    const pick = el('select', { 'aria-label': `Address for ${m.name}`, 'data-k8sdockside-keep': 'off' },
        ...CHOICES.map(([v, label]) => {
            const o = el('option', { value: v }, v === 'auto' ? `${label} (${auto.address || 'none'})` : label);
            o.selected = v === use;
            return o;
        }),
    );
    const input = el('input', { type: 'text', class: 'mono', placeholder: 'address', 'aria-label': `Other address for ${m.name}`, spellcheck: 'false', 'data-k8sdockside-keep': 'off' });
    input.value = own?.custom ?? '';
    input.hidden = use !== 'custom';
    const save = (): void => {
        const choice = pick.value as AddressChoice;
        const custom = input.value.trim();
        if (choice === 'custom' && !custom) {
            input.hidden = false;
            input.focus();
            return;
        }
        void change((x) => {
            const nodes = { ...x.nodes };
            if (choice === 'auto') delete nodes[m.name];
            else nodes[m.name] = choice === 'custom' ? { use: choice, custom } : { use: choice };
            return { ...x, nodes };
        }).catch(showError);
    };
    on(pick, 'change', save);
    on(input, 'change', save);

    const test = state.tests.get(m.name);
    return el('tr', {},
        el('td', {}, el('strong', {}, m.name), m.controlPlane ? el('span', { class: 'faint small' }, ' control plane') : null),
        el('td', { class: 'mono small' }, m.internal.join(', ') || el('span', { class: 'faint' }, '—')),
        el('td', { class: 'mono small' },
            m.external.join(', ') || el('span', { class: 'faint' }, '—'),
            m.externalFrom === 'talos'
                ? el('div', { class: 'faint small', title: 'The Node object has no ExternalIP, so these are the public addresses Talos itself reports (talosctl get nodeaddress current-no-k8s).' }, 'from Talos')
                : m.externalFrom === 'internalip'
                    ? el('div', { class: 'faint small', title: 'The Node object has no ExternalIP; this public address is listed as an InternalIP. Test a machine, or read again, to ask Talos for the rest.' }, 'public, listed as InternalIP')
                    : null),
        el('td', {}, el('div', { class: 'row nowrap' }, pick, input)),
        el('td', { class: 'mono small', title: ADDRESS_FROM[m.addressFrom] }, m.address || el('span', { class: 'tone-error' }, 'none'), el('span', { class: 'faint' }, ` · ${m.addressFrom}`)),
        el('td', { class: 'right' },
            test === undefined
                ? (c.conn.ready ? button('Test', () => void testOne(m), { class: 'link' }) : null)
                : test === ''
                    ? el('span', { class: 'faint' }, el('span', { class: 'pulse' }), ' asking…')
                    : test.startsWith('ok')
                        ? el('span', { class: 'tone-ok', title: test }, dot('ok'), ' ', test.slice(4))
                        : el('span', { class: 'tone-error small', title: test }, dot('error'), ' ', test),
        ),
    );
}

/** Asks one machine for its stage, through the endpoints and at the address set here. */
async function testOne(m: Machine): Promise<void> {
    const c = state.cluster;
    if (!c?.conn.ready) return;
    state.tests.set(m.name, '');
    render();
    try {
        const status = await getOne<MachineStatus>(c.conn, 'machinestatus', m.address);
        state.tests.set(m.name, `ok: ${status[0]?.spec.stage ?? 'answered'}`);
    } catch (err) {
        state.tests.set(m.name, message(err));
    }
    render();
}

async function testAll(): Promise<void> {
    await Promise.all(state.cluster?.machines.map(testOne) ?? []);
}

start().catch(showError);
