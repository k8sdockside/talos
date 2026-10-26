// Extensions: the system extensions every machine runs, side by side -- each
// one's versions and the machines it is on, where machines differ, and the
// Image Factory schematics they were built from.

import { button, byId, el, replace, type Child } from '@k8sdockside/plugin-sdk/dom';
import {
    extensionRows,
    schematicGroups,
    type ExtensionRow,
    type ExtensionSpec,
    type Machine,
    type Resource,
} from '../model/talos';
import { clearError, dot, keep, on, recall, showError, when } from '../ui/common';
import { loadCluster, loadingLine, notReady, pageHead, type Cluster } from '../ui/shell';
import { getEach } from '../ui/talos';

const SHOW_KEY = 'extensions:show';

type Show = 'all' | 'differences';

const state = {
    contextName: '',
    cluster: null as Cluster | null,
    /** By machine name: what it runs, or why it did not say. */
    byMachine: new Map<string, Resource<ExtensionSpec>[] | Error>(),
    at: null as Date | null,
    reading: false,
    show: 'all' as Show,
    search: '',
};

async function start(): Promise<void> {
    const ctx = await k8sdockside.ready();
    state.contextName = ctx.contextName;
    state.show = (await recall<Show>(SHOW_KEY, 'all')) === 'differences' ? 'differences' : 'all';
    replace(byId('main'), pageHead('extensions', state.contextName), loadingLine('Looking for talosctl and your talosconfig…'));
    state.cluster = await loadCluster(state.contextName);
    render();
    await read();
}

async function read(): Promise<void> {
    const c = state.cluster;
    if (!c?.conn.ready || state.reading) return;
    state.reading = true;
    render();
    try {
        const talos = c.machines.filter((m) => m.talos && m.address);
        const answers = await getEach<ExtensionSpec>(c.conn, 'extensions', talos.map((m) => m.address));
        state.byMachine = new Map(talos.map((m) => [m.name, answers.get(m.address) ?? new Error('no answer')]));
        state.at = new Date();
    } catch (err) {
        showError(err);
    } finally {
        state.reading = false;
    }
    render();
}

function answered(): Map<string, Resource<ExtensionSpec>[]> {
    return new Map([...state.byMachine].filter((e): e is [string, Resource<ExtensionSpec>[]] => Array.isArray(e[1])));
}

// ----- drawing ------------------------------------------------------------------------------

function render(): void {
    clearError();
    const c = state.cluster;
    if (!c) return;
    const ready = c.conn.ready;
    const known = answered();
    const rows = extensionRows(known);
    const differing = rows.filter((r) => r.versionMismatch || r.missing.length > 0);
    const schematics = schematicGroups(known);

    replace(byId('main'),
        pageHead('extensions',
            `${state.contextName} · ${rows.length} extension${rows.length === 1 ? '' : 's'} on ${known.size} machine${known.size === 1 ? '' : 's'}${state.at ? ` · read at ${when(state.at)}` : ''}`,
            ready ? button(state.reading ? 'Reading…' : 'Refresh', () => void read(), { class: 'btn ghost' }) : null,
        ),
        ready ? null : notReady(c.conn),
        ready && state.reading && !state.at ? loadingLine('Asking every machine…') : null,
        ready && state.at ? summary(rows, differing, schematics) : null,
        ready && state.at ? unreachable(c) : null,
        ready && state.at ? listCard(rows, differing, known.size) : null,
        ready && state.at && rows.length ? matrixCard(c, rows) : null,
        ready && state.at ? schematicCard(schematics) : null,
    );
}

function summary(rows: ExtensionRow[], differing: ExtensionRow[], schematics: Map<string, string[]>): HTMLElement {
    const versions = rows.filter((r) => r.versionMismatch).length;
    const partial = rows.filter((r) => r.missing.length > 0).length;
    return el('div', { class: 'stats' },
        stat('Extensions', String(rows.length), 'ok'),
        stat('On every machine', String(rows.length - partial), 'ok'),
        stat('Not on every machine', String(partial), partial ? 'warn' : 'ok'),
        stat('Versions differ', String(versions), versions ? 'warn' : 'ok'),
        stat('Schematics', String(schematics.size), schematics.size > 1 ? 'warn' : 'ok'),
        differing.length === 0 && rows.length ? el('div', { class: 'stat card' }, el('div', { class: 'stat-value tone-ok' }, dot('ok'), ' All alike')) : null,
    );
}

function stat(label: string, value: string, tone: string): HTMLElement {
    return el('div', { class: 'stat card' }, el('div', { class: 'faint small' }, label), el('div', { class: `stat-value tone-${tone}` }, value));
}

function unreachable(c: Cluster): HTMLElement | null {
    const errors = [...state.byMachine].filter((e): e is [string, Error] => e[1] instanceof Error);
    const noAddress = c.machines.filter((m) => m.talos && !m.address);
    if (!errors.length && !noAddress.length) return null;
    return el('div', { class: 'callout warn' },
        el('strong', {}, 'Not counted: '),
        [...errors.map(([name, err]) => `${name} (${err.message})`), ...noAddress.map((m) => `${m.name} (no address)`)].join(', '),
        '. ',
        button('Settings', () => void k8sdockside.openView('settings'), { class: 'link' }),
    );
}

function listCard(rows: ExtensionRow[], differing: ExtensionRow[], machines: number): HTMLElement {
    const pick = el('select', { 'aria-label': 'Show', 'data-k8sdockside-keep': 'off' },
        ...([['all', 'Every extension'], ['differences', 'Only where machines differ']] as [Show, string][]).map(([v, label]) => {
            const o = el('option', { value: v }, label);
            o.selected = v === state.show;
            return o;
        }),
    );
    on(pick, 'change', () => {
        state.show = pick.value as Show;
        keep(SHOW_KEY, state.show);
        render();
    });
    const search = el('input', { type: 'text', placeholder: 'Filter by name', 'aria-label': 'Filter extensions', 'data-k8sdockside-keep': 'off', 'data-focus': 'search' });
    search.value = state.search;
    on(search, 'input', () => {
        state.search = search.value;
        const at = search.selectionStart;
        render();
        const again = document.querySelector<HTMLInputElement>('[data-focus="search"]');
        again?.focus();
        if (at !== null) again?.setSelectionRange(at, at);
    });
    const words = state.search.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = (state.show === 'differences' ? differing : rows).filter((r) => words.every((w) => r.name.toLowerCase().includes(w)));

    return el('section', { class: 'card section' },
        el('div', { class: 'row' }, el('h2', { class: 'grow' }, 'Extensions'), search, pick),
        shown.length
            ? el('div', { class: 'scroll-x' }, el('table', { class: 'grid' },
                el('thead', {}, el('tr', {},
                    el('th', {}, 'Extension'),
                    el('th', {}, 'Version'),
                    el('th', {}, 'Machines'),
                    el('th', {}, 'Missing on'),
                    el('th', {}, 'Author'),
                )),
                el('tbody', {}, ...shown.map((r) => el('tr', {},
                    el('td', { title: r.description }, el('strong', { class: 'mono' }, r.name), r.description ? el('div', { class: 'faint small' }, r.description) : null),
                    el('td', {}, ...[...r.versions].map(([v, on]) => el('span', {
                        class: `chip mono${r.versionMismatch ? ' warn' : ''}`,
                        title: on.join('\n'),
                    }, `${v || '?'}${r.versionMismatch ? ` × ${on.length}` : ''}`))),
                    el('td', {}, el('span', { class: r.on.length === machines ? 'tone-ok' : 'tone-warn' }, `${r.on.length}/${machines}`)),
                    el('td', { class: 'small' }, r.missing.length ? r.missing.join(', ') : el('span', { class: 'faint' }, '—')),
                    el('td', { class: 'faint small' }, r.author || '—'),
                ))),
            ))
            : el('p', { class: 'faint' }, rows.length ? 'Nothing here: every extension is on every machine, at one version.' : 'No machine runs a system extension.'),
    );
}

/** Extensions down the side, machines across, each cell the version a machine runs. */
function matrixCard(c: Cluster, rows: ExtensionRow[]): HTMLElement {
    const machines = c.machines.filter((m) => Array.isArray(state.byMachine.get(m.name)));
    const versionOn = (r: ExtensionRow, m: Machine): string | null => {
        for (const [v, on] of r.versions) if (on.includes(m.name)) return v;
        return null;
    };
    return el('section', { class: 'card section' },
        el('h2', {}, 'By machine'),
        el('div', { class: 'scroll-x' }, el('table', { class: 'grid matrix' },
            el('thead', {}, el('tr', {},
                el('th', {}, ''),
                ...machines.map((m) => el('th', { title: `${m.name}${m.controlPlane ? ' · control plane' : ''}` }, m.name)),
            )),
            el('tbody', {}, ...rows.map((r) => {
                const common = [...r.versions].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
                return el('tr', {},
                    el('th', { class: 'mono' }, r.name),
                    ...machines.map((m): Child => {
                        const v = versionOn(r, m);
                        if (v === null) return el('td', { class: 'cell missing', title: `${r.name} is not on ${m.name}` }, '—');
                        return el('td', { class: `cell mono${r.versionMismatch && v !== common ? ' differs' : ''}`, title: `${r.name} ${v} on ${m.name}` }, v || '?');
                    }),
                );
            })),
        )),
    );
}

function schematicCard(groups: Map<string, string[]>): HTMLElement {
    const list = [...groups].sort((a, b) => b[1].length - a[1].length);
    return el('section', { class: 'card section' },
        el('h2', {}, 'Image Factory schematics'),
        el('p', { class: 'dim small' }, groups.size > 1
            ? 'The machines were built from different schematics, so they carry different extensions. An upgrade from the board keeps each machine’s own schematic.'
            : 'A schematic is the Image Factory recipe a machine was built from, extensions included. An upgrade from the board keeps it.'),
        el('table', { class: 'grid' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Schematic'), el('th', {}, 'Machines'))),
            el('tbody', {}, ...list.map(([id, machines]) => el('tr', {},
                el('td', { class: 'mono small', title: id }, id ? `${id.slice(0, 16)}…` : el('span', { class: 'faint' }, 'none (stock installer)')),
                el('td', {}, machines.join(', ')),
            ))),
        ),
    );
}

start().catch(showError);
