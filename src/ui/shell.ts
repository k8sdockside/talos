// What the dashboard, extensions and settings pages share: the machines with
// the addresses this cluster's settings give them, the connection, a heading
// with the way to the other pages, and a line for a connection that is not
// there yet.

import { button, el, svg, type Child } from '@k8sdockside/plugin-sdk/dom';
import { allAddresses, machineOf, sortMachines, type Machine, type NodeObject } from '../model/talos';
import { TALOS_LOGO } from './logo';
import { dot } from './common';
import { addressed, connect, learnAddresses, type Connection } from './talos';

export interface Cluster {
    contextName: string;
    /** As Kubernetes lists them, before the settings pick their addresses. */
    listed: Machine[];
    /** With the addresses talosctl uses. */
    machines: Machine[];
    conn: Connection;
}

/** The machines, then the connection, then the addresses the settings pick. */
export async function loadCluster(contextName: string): Promise<Cluster> {
    const nodes = await k8sdockside.list<K8sDockside.KubeObject>({ kind: 'nodes' });
    const listed = sortMachines((nodes as unknown as NodeObject[]).map(machineOf));
    const conn = await connect(allAddresses(listed));
    await learnAddresses(conn, addressed(listed, conn));
    return { contextName, listed, machines: addressed(listed, conn), conn };
}

const PAGES: [string, string][] = [
    ['overview', 'Board'],
    ['dashboard', 'Dashboard'],
    ['extensions', 'Extensions'],
    ['settings', 'Settings'],
];

/** The way between the plugin's pages. */
export function pageNav(here: string): HTMLElement {
    return el('nav', { class: 'pages', 'aria-label': 'Talos pages' },
        ...PAGES.map(([id, label]) => id === here
            ? el('span', { class: 'page-link on', 'aria-current': 'page' }, label)
            : button(label, () => void k8sdockside.openView(id), { class: 'page-link' })),
    );
}

/** The page's heading: the Talos mark, what the page is, and the way to the others. */
export function pageHead(here: string, subtitle: string, ...actions: Child[]): HTMLElement {
    return el('header', { class: 'head' },
        el('div', { class: 'title' },
            el('div', {},
                el('h1', { class: 'brand-title' }, svg(TALOS_LOGO, 'brand'), el('span', { class: 'sr-only' }, 'Talos')),
                el('div', { class: 'dim small' }, subtitle),
            ),
        ),
        pageNav(here),
        actions.some(Boolean) ? el('div', { class: 'head-actions' }, ...actions) : null,
    );
}

/** For a page that needs talosctl: why it is not there, and the way to Settings. */
export function notReady(conn: Connection): HTMLElement {
    return el('div', { class: 'conn setup' },
        dot('warn'),
        el('div', { class: 'grow' },
            el('strong', {}, 'talosctl is not connected'),
            el('div', { class: 'dim small' }, conn.reason),
        ),
        conn.fix !== 'app' ? button('Settings', () => void k8sdockside.openView('settings'), { class: 'btn primary' }) : null,
    );
}

export function loadingLine(text: string): HTMLElement {
    return el('div', { class: 'loading' }, el('span', { class: 'pulse' }), ' ', text);
}

/** "/Users/me/.talos/config" -> "~/.talos/config". */
export function shortPath(path: string): string {
    return path.replace(/^\/(home|Users)\/[^/]+/, '~');
}
