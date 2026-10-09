// talosctl, through the app: which talosconfig and context this cluster uses,
// and the reads every page makes. The commands themselves are the manifest's
// to allow (plugin.json, "ui.tools"); the talosconfig is the app's to pass.

import {
    matchContext,
    parseContexts,
    parseResources,
    shortError,
    type Resource,
    type TalosContext,
} from '../model/talos';

export const TOOL = 'talosctl';
const CONTEXT_KEY = 'talosContext';

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
}

function tools(): K8sDockside.Tools {
    const t = k8sdockside.tools;
    if (!t) throw new Error('talosctl needs K8s Dockside 0.1.23 or newer');
    return t;
}

/** Works out the connection: talosctl, the talosconfig, the context. Never rejects. */
export async function connect(addresses: string[]): Promise<Connection> {
    const out: Connection = { ready: false, reason: '', fix: '', status: null, contexts: [], context: '', chosen: false };
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
    out.context = (picked ?? matchContext(out.contexts, addresses))?.name ?? '';
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

/** The flags every command is given: the context, and the machine. */
export function target(conn: Connection, nodes: string[]): string[] {
    const out = ['--context', conn.context];
    if (nodes.length) out.push('--nodes', nodes.join(','));
    return out;
}

/** One resource type from one machine. A machine that does not answer is an error, in short words. */
export async function getOne<S>(conn: Connection, resource: string, node: string): Promise<Resource<S>[]> {
    const out = await tools().exec(TOOL, ['get', resource, '--output', 'json', ...target(conn, [node])]);
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

/** A text command's output. Rejects with talosctl's words when it fails outright. */
export async function text(conn: Connection, args: string[], nodes: string[]): Promise<string> {
    const out = await tools().exec(TOOL, [...args, ...target(conn, nodes)]);
    if (out.code !== 0 && !out.stdout.trim()) throw new Error(shortError(out.stderr || `talosctl exited with ${out.code}`));
    return out.stdout.replace(/\s+$/, '') + (out.truncated ? '\n… (cut)' : '');
}

/** Asks to run a command that changes something: shown to the user, run in the console. */
export async function run(
    conn: Connection,
    args: string[],
    node: { name: string; address: string } | null,
    opts: { title: string; danger?: boolean; confirm?: string },
): Promise<void> {
    const nodes = node ? [node.address] : [];
    await tools().run({
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

/** Opens `talosctl dashboard` in the user's own terminal. */
export async function dashboard(conn: Connection, nodes: string[]): Promise<void> {
    await tools().external(TOOL, ['dashboard', ...target(conn, nodes)]);
}

export function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
