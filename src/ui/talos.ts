// talosctl, through the app: which talosconfig and context this cluster uses,
// and the reads every page makes. The commands themselves are the manifest's
// to allow (plugin.json, "ui.tools"); the talosconfig is the app's to pass.

import {
    endpointsFor,
    matchContext,
    normaliseSettings,
    parseContexts,
    parseResources,
    isPublicIP,
    publicAddresses,
    shortError,
    withAddresses,
    withTalosAddresses,
    type Machine,
    type Resource,
    type TalosContext,
    type TalosSettings,
} from '../model/talos';

export const TOOL = 'talosctl';
const CONTEXT_KEY = 'talosContext';
/** The cluster's talosctl settings: addresses and endpoints. See TalosSettings. */
const SETTINGS_KEY = 'talosSettings';
/** Public addresses Talos reported for machines whose Node object has none, by machine name. */
const LEARNED_KEY = 'talosAddresses';

/** Where the plugin stands with talosctl on this cluster. */
export interface Connection {
    /** A command can be run. */
    ready: boolean;
    /** Why not, in words that say what to do; '' when ready. */
    reason: string;
    /** What the fix is: install talosctl, choose a talosconfig, or upgrade the app. */
    fix: 'app' | 'install' | 'config' | 'context' | '';
    status: K8sDockside.ToolStatus | null;
    contexts: TalosContext[];
    /** The talosconfig context used for this cluster. */
    context: string;
    /** How it was picked: the user's choice, or matched. */
    chosen: boolean;
    /** The addresses and endpoints the user set for this cluster. */
    settings: TalosSettings;
    /** Public addresses Talos itself reported, by machine name: see learnAddresses. */
    learned: Record<string, string[]>;
}

function tools(): K8sDockside.Tools {
    const t = k8sdockside.tools;
    if (!t) throw new Error('talosctl needs K8s Dockside 0.1.23 or newer');
    return t;
}

/** What the user set for talosctl on this cluster; the defaults when nothing is kept. */
export async function loadSettings(): Promise<TalosSettings> {
    const saved = await k8sdockside.storage?.get<unknown>(SETTINGS_KEY).catch(() => null);
    return normaliseSettings(saved);
}

export async function saveSettings(settings: TalosSettings): Promise<void> {
    const store = k8sdockside.storage;
    if (!store) throw new Error('Keeping settings needs K8s Dockside 0.0.19 or newer');
    await store.set(SETTINGS_KEY, normaliseSettings(settings));
}

/**
 * Works out the connection: talosctl, the talosconfig, the context, and the
 * cluster's settings. `addresses` are every address the machines have, for
 * matching a context. Never rejects.
 */
export async function connect(addresses: string[]): Promise<Connection> {
    const settings = await loadSettings();
    const learned = await k8sdockside.storage?.get<Record<string, string[]>>(LEARNED_KEY).catch(() => null);
    const out: Connection = {
        ready: false, reason: '', fix: '', status: null, contexts: [], context: '', chosen: false, settings,
        learned: learned && typeof learned === 'object' ? learned : {},
    };
    if (!k8sdockside.tools) {
        return { ...out, fix: 'app', reason: 'Talos needs K8s Dockside 0.1.23 or newer, which can run talosctl for a plugin. The board below is what Kubernetes knows.' };
    }
    try {
        out.status = await tools().status(TOOL);
    } catch (err) {
        return { ...out, fix: 'app', reason: message(err) };
    }
    if (!out.status.tool.found) return { ...out, fix: 'install', reason: out.status.tool.reason };
    const file = out.status.files[0];
    if (!file?.exists) {
        return { ...out, fix: 'config', reason: file?.path ? `There is no talosconfig at ${file.path}. Choose the one for this cluster.` : 'Choose the talosconfig for this cluster.' };
    }
    const listed = await tools().exec(TOOL, ['config', 'contexts']).catch((err: unknown) => ({ stdout: '', stderr: message(err), code: 1, truncated: false }));
    out.contexts = parseContexts(listed.stdout);
    if (out.contexts.length === 0) {
        return { ...out, fix: 'config', reason: `${file.path} has no contexts${listed.stderr ? ': ' + listed.stderr.trim() : ''}` };
    }
    const saved = await k8sdockside.storage?.get<string>(CONTEXT_KEY).catch(() => null);
    const picked = out.contexts.find((c) => c.name === saved);
    out.chosen = !!picked;
    out.context = (picked ?? matchContext(out.contexts, [...addresses, ...Object.values(out.learned).flat()]))?.name ?? '';
    out.ready = out.context !== '';
    if (!out.ready) return { ...out, fix: 'context', reason: 'Pick the talosconfig context for this cluster.' };
    return out;
}

export async function useContext(name: string): Promise<void> {
    await k8sdockside.storage?.set(CONTEXT_KEY, name);
}

export async function chooseConfig(): Promise<void> {
    await tools().chooseFile(TOOL, 'config');
    // A new file's contexts are not the old one's.
    await k8sdockside.storage?.remove(CONTEXT_KEY).catch(() => null);
}

export async function forgetConfig(): Promise<void> {
    await tools().forgetFile(TOOL, 'config');
    await k8sdockside.storage?.remove(CONTEXT_KEY).catch(() => null);
}

/** The talosconfig context in use, as `config contexts` listed it. */
export function contextOf(conn: Connection | null): TalosContext | null {
    return conn?.contexts.find((c) => c.name === conn.context) ?? null;
}

/** The machines with the addresses talosctl is to use for them on this connection. */
export function addressed(machines: Machine[], conn: Connection | null): Machine[] {
    return conn ? withAddresses(withTalosAddresses(machines, conn.learned), conn.settings, contextOf(conn)) : machines;
}

/**
 * Asks each machine without an ExternalIP on its Node object for the addresses
 * Talos itself has, and keeps the public ones -- on clouds without a cloud
 * controller manager, such as Hetzner's, that is the only place they are. A
 * machine is asked through the address in use, by way of the talosconfig's
 * endpoints, so one that cannot be reached at all simply stays as it was.
 * Remembered per cluster, so the next page has them at once. Resolves true
 * when anything changed.
 */
export async function learnAddresses(conn: Connection, machines: Machine[]): Promise<boolean> {
    if (!conn.ready) return false;
    const ask = machines.filter((m) => m.externalFrom !== 'kubernetes');
    if (!ask.length) return false;
    const answers = await Promise.all(ask.map(async (m): Promise<[string, string[] | null]> => {
        // Every address the machine might answer on, public ones first: with
        // no endpoints in the talosconfig, the private one is often the one
        // that cannot be reached from here.
        const tries = [...new Set([m.address, ...m.external, ...m.internal].filter(Boolean))]
            .sort((a, b) => Number(isPublicIP(b)) - Number(isPublicIP(a)));
        for (const at of tries) {
            try {
                const out = await tools().exec(TOOL, ['get', 'nodeaddress', 'current-no-k8s', '--output', 'json', ...targetAt(conn, at)]);
                const items = parseResources<{ addresses?: string[] }>(out.stdout);
                if (items.length) return [m.name, publicAddresses(items[0]!.spec.addresses ?? [])];
            } catch {
                // The next address, then.
            }
        }
        return [m.name, null];
    }));
    const next = { ...conn.learned };
    for (const [name, ips] of answers) {
        if (ips === null) continue;
        if (ips.length) next[name] = ips;
        else delete next[name];
    }
    // Machines that are gone are forgotten.
    const names = new Set(machines.map((m) => m.name));
    for (const name of Object.keys(next)) if (!names.has(name)) delete next[name];
    if (JSON.stringify(next) === JSON.stringify(conn.learned)) return false;
    conn.learned = next;
    await k8sdockside.storage?.set(LEARNED_KEY, next).catch(() => null);
    return true;
}

/**
 * The flags to reach one machine at one address, whatever the settings say:
 * with no endpoints from the settings or the talosconfig, the machine is its
 * own endpoint.
 */
function targetAt(conn: Connection, address: string): string[] {
    const out = target(conn, [address]);
    if (!out.includes('--endpoints') && !(contextOf(conn)?.endpoints.length)) out.push('--endpoints', address);
    return out;
}

/** The flags every command is given: the context, the endpoints when the user set them, and the machines. */
export function target(conn: Connection, nodes: string[]): string[] {
    const out = ['--context', conn.context];
    const endpoints = endpointsFor(conn.settings, nodes);
    if (endpoints.length) out.push('--endpoints', endpoints.join(','));
    if (nodes.length) out.push('--nodes', nodes.join(','));
    return out;
}

/** A read command, aimed like every other; a non-zero code is an answer. */
export async function exec(conn: Connection, args: string[], nodes: string[]): Promise<K8sDockside.ToolOutput> {
    return tools().exec(TOOL, [...args, ...target(conn, nodes)]);
}

/** A read command with no context, endpoints or machines: `config contexts`, `config info`. */
export async function execBare(args: string[]): Promise<K8sDockside.ToolOutput> {
    return tools().exec(TOOL, args);
}

/** One resource type from one machine. A machine that does not answer is an error, in short words. */
export async function getOne<S>(conn: Connection, resource: string, node: string): Promise<Resource<S>[]> {
    if (!node) throw new Error('no address for this machine -- pick one in Settings');
    const out = await exec(conn, ['get', resource, '--output', 'json'], [node]);
    const items = parseResources<S>(out.stdout);
    if (out.code !== 0 && items.length === 0) throw new Error(shortError(out.stderr || `talosctl exited with ${out.code}`));
    return items;
}

/** One resource type from several machines, one process each, so one down machine does not hide the rest. */
export async function getEach<S>(conn: Connection, resource: string, nodes: string[]): Promise<Map<string, Resource<S>[] | Error>> {
    const answers = await Promise.all(
        nodes.map((n) => getOne<S>(conn, resource, n).then(
            (items): [string, Resource<S>[] | Error] => [n, items],
            (err: unknown): [string, Resource<S>[] | Error] => [n, err instanceof Error ? err : new Error(String(err))],
        )),
    );
    return new Map(answers);
}

/** The machine config field the upgrade panel needs, and the only one the app reads for the plugin. */
export const INSTALL_IMAGE = 'machine.install.image';

/**
 * The machine config's `machine.install.image` for one machine, read by the
 * app (an extraction in plugin.json): the app parses the config and hands
 * back that one value, never the config. null when it cannot be read -- an
 * app older than 0.1.33, a machine that does not answer, no such field.
 */
export async function installImage(conn: Connection, node: string): Promise<string | null> {
    const extract = k8sdockside.tools?.extract;
    if (!extract || !node) return null;
    const found = await extract(TOOL, ['get', 'machineconfig', ...target(conn, [node])]);
    const value = (found.find((f) => f.node === node) ?? found[0])?.fields[INSTALL_IMAGE];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** A text command's output. Rejects with talosctl's words when it fails outright. */
export async function text(conn: Connection, args: string[], nodes: string[]): Promise<string> {
    const out = await exec(conn, args, nodes);
    if (out.code !== 0 && !out.stdout.trim()) throw new Error(shortError(out.stderr || `talosctl exited with ${out.code}`));
    return out.stdout.replace(/\s+$/, '') + (out.truncated ? '\n… (cut)' : '');
}

/** Asks to run a command that changes something: shown to the user, run in the console. */
export async function run(
    conn: Connection,
    args: string[],
    node: { name: string; address: string } | null,
    opts: { title: string; danger?: boolean; confirm?: string; path?: K8sDockside.ToolRunPath },
): Promise<void> {
    const nodes = node ? [node.address] : [];
    await tools().run({
        path: opts.path,
        tool: TOOL,
        args: [...args, ...target(conn, nodes)],
        defaults: target(conn, nodes),
        label: node?.name ?? conn.context,
        title: opts.title,
        danger: opts.danger,
        confirm: opts.confirm,
    });
}

/** Opens the talosctl console in the dock, aimed at a machine (or none). */
export async function console(conn: Connection, node: { name: string; address: string } | null): Promise<void> {
    await tools().console({ tool: TOOL, defaults: target(conn, node ? [node.address] : []), label: node?.name ?? conn.context });
}

/** Opens the talosctl console in the dock, aimed at several machines at once. */
export async function consoleFor(conn: Connection, nodes: { name: string; address: string }[]): Promise<void> {
    const label = nodes.length === 1 ? nodes[0]!.name : nodes.length ? `${nodes.length} machines` : conn.context;
    await tools().console({ tool: TOOL, defaults: target(conn, nodes.map((n) => n.address).filter(Boolean)), label });
}

/**
 * Opens `talosctl dashboard` for the given machines -- `--nodes a,b,c`, which
 * talosctl shows one machine at a time, switched with ←/→ -- in the dock, or in
 * the user's own terminal when the app's terminal setting says so.
 */
export async function dashboard(conn: Connection, nodes: string[]): Promise<void> {
    await tools().external(TOOL, ['dashboard', ...target(conn, nodes)]);
}

export function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** The words on a dashboard button aimed at several machines. */
export function dashboardLabel(count: number, picked: boolean): string {
    if (count === 1) return 'Dashboard · 1 machine';
    return picked ? `Dashboard · ${count} picked` : `Dashboard · all ${count} machines`;
}

/** The tooltip on a dashboard button: the command it runs, and where. */
export function dashboardTitle(nodes: string[]): string {
    return `talosctl dashboard --nodes ${nodes.join(',')}, in the dock, or in your own terminal if Settings → Terminal says so. Switch machine with ← and →.`;
}
