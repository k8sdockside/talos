// What the pages share: errors, small drawing helpers, and the hand-over from
// a node's panel to the board.

import { el } from '@k8sdockside/plugin-sdk/dom';
import { standing, type AddressSource, type Standing, type Version } from '../model/talos';
import { message } from './talos';

export function showError(err: unknown): void {
    const node = document.getElementById('error');
    if (!node) return;
    node.textContent = message(err);
    node.hidden = false;
}

export function clearError(): void {
    const node = document.getElementById('error');
    if (node) node.hidden = true;
}

export const STANDING_TEXT: Record<Standing, string> = {
    current: 'latest',
    patch: 'patch behind',
    behind: 'upgrade due',
    ahead: 'pre-release',
    unsupported: 'out of support',
    unknown: 'unknown',
};

/** A version badge, coloured by how far it is from the latest stable. */
export function versionBadge(v: Version | null): HTMLElement {
    const s = standing(v);
    return el('span', { class: `badge v-${s}`, title: STANDING_TEXT[s] }, v ? v.raw : 'not Talos');
}

/** Where the address talosctl uses for a machine came from, for a tooltip. */
export const ADDRESS_FROM: Record<AddressSource, string> = {
    talosconfig: 'The address the talosconfig names for this machine',
    external: 'The machine’s ExternalIP',
    internal: 'The machine’s InternalIP',
    custom: 'The address you set in Settings',
    none: 'Kubernetes lists no address for this machine: set one in Settings',
};

/** Something a page remembers for this cluster, or `fallback` when nothing is kept. */
export async function recall<T>(key: string, fallback: T): Promise<T> {
    try {
        const v = await k8sdockside.storage?.get<T>(key);
        return v === null || v === undefined ? fallback : v;
    } catch {
        return fallback;
    }
}

export function keep(key: string, value: unknown): void {
    void k8sdockside.storage?.set(key, value).catch(() => null);
}

export function dot(tone: string, title = ''): HTMLElement {
    return el('span', { class: `dot tone-${tone}`, title, 'aria-hidden': 'true' });
}

/** A click handler for something that is not a <button>. */
export function on<K extends keyof HTMLElementEventMap>(node: HTMLElement, event: K, handler: (e: HTMLElementEventMap[K]) => void): HTMLElement {
    node.addEventListener(event, handler);
    return node;
}

export const FOCUS_KEY = 'focusNode';

/** From a node's panel: opens the board on that node. */
export async function handOver(node: string): Promise<void> {
    await k8sdockside.storage?.set(FOCUS_KEY, node).catch(() => null);
    await k8sdockside.openView('overview');
}

export async function takeHandOver(): Promise<string | null> {
    const store = k8sdockside.storage;
    if (!store) return null;
    try {
        const node = await store.get<string>(FOCUS_KEY);
        if (node) await store.remove(FOCUS_KEY);
        return typeof node === 'string' ? node : null;
    } catch {
        return null;
    }
}

export function when(date: Date = new Date()): string {
    return k8sdockside.format?.time(date) ?? date.toLocaleTimeString();
}
