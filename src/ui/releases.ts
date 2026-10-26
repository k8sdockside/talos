// The Talos releases the pages measure against: the built-in table at first,
// then the live list from GitHub, asked of the app once per page.

import { TALOS_REPO, releaseSource, releasesFrom, releasesNote, useReleases } from '../model/talos';

let loading: Promise<boolean> | null = null;

/**
 * Asks the app for siderolabs/talos's releases and, when they make a usable
 * list, puts them in use. Resolves true when the releases in use changed, so
 * the page draws again. An app without `releases`, release lists switched
 * off, or GitHub unreachable with nothing cached all leave the built-in table
 * in use.
 */
export function loadReleases(): Promise<boolean> {
    loading ??= (async () => {
        const ask = k8sdockside.releases;
        if (typeof ask !== 'function') return false;
        try {
            const list = await ask.call(k8sdockside, TALOS_REPO);
            const lines = releasesFrom(list);
            return useReleases(lines, { kind: 'live', asOf: list.fetchedAt || new Date().toISOString(), stale: !!list.stale });
        } catch {
            return false;
        }
    })();
    return loading;
}

/** Where the releases in use came from, in a few words, times written the user's way. */
export function releasesText(): string {
    return releasesNote(releaseSource(), (iso) => {
        const at = new Date(iso);
        if (Number.isNaN(at.getTime())) return iso;
        return k8sdockside.format?.dateTime(at) ?? at.toLocaleString();
    });
}

/** A tooltip for releasesText. */
export function releasesTitle(): string {
    const s = releaseSource();
    if (s.kind === 'builtin') {
        return 'The release table this plugin ships with. With K8s Dockside 0.1.33 or newer and Settings → Notifications → Release lists for plugins on, the app reads the latest from GitHub instead.';
    }
    return s.stale
        ? 'GitHub could not be asked just now (unreachable or rate-limited), so this is the list the app read last.'
        : 'Read from github.com/siderolabs/talos/releases by the app; it asks again after six hours.';
}
