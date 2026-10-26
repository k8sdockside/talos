// k8sdockside.releases, from K8s Dockside 0.1.33. Copied here until an SDK
// with it is published: delete this file and bump the devDependency then.
// Interfaces merge, so the two can overlap.

declare namespace K8sDockside {
    /** One published release of a GitHub repository. */
    interface GitHubRelease {
        tag: string;
        name: string;
        prerelease: boolean;
        draft: false;
        /** RFC 3339. */
        publishedAt: string;
        url: string;
    }

    /** What `releases` resolves with: the releases, newest first, and where they came from. */
    interface GitHubReleaseList extends Array<GitHubRelease> {
        repo: string;
        /** When GitHub last answered for this list, RFC 3339. */
        fetchedAt: string;
        /** GitHub could not be asked just now, and this is the app's last good list. */
        stale: boolean;
        error: string;
    }

    interface ReleasesOptions {
        refresh?: boolean;
    }

    interface Context {
        releases?: string[];
    }

    interface Bridge {
        /**
         * The releases of a repository the manifest names in `ui.releases`.
         * Rejects when it is switched off or GitHub cannot be reached with
         * nothing cached. Absent on an app older than 0.1.33.
         */
        releases?: (repo: string, opts?: ReleasesOptions) => Promise<GitHubReleaseList>;
    }
}
