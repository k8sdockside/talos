// k8sdockside.tools, from K8s Dockside 0.1.23 and @k8sdockside/plugin-sdk
// 1.1.0. Copied here until that SDK is published: delete this file and bump
// the devDependency to ^1.1.0 then. Interfaces merge, so the two can overlap.

declare namespace K8sDockside {
    // ----- command line tools ----------------------------------------------------

    /** One of the tools the manifest declares in `"ui": { "tools": [...] }`. */
    interface DeclaredTool {
        id: string;
        label: string;
        command: string;
    }

    /** One of a tool's files, as the app passes it for this cluster. */
    interface ToolFile {
        id: string;
        label: string;
        /** The file in use: the one the user chose, else the manifest's default. `''` for neither. */
        path: string;
        /** `configured` (the user chose it) or `default`. */
        source: string;
        exists: boolean;
    }

    /** What `tools.status` resolves with. */
    interface ToolStatus {
        id: string;
        label: string;
        tool: {
            found: boolean;
            path: string;
            /** The first vX.Y.Z the manifest's `version` arguments printed; `''` when unknown. */
            version: string;
            /** Why there is no usable tool, in words that name the fix. */
            reason: string;
        };
        files: ToolFile[];
    }

    /** What a command wrote. A non-zero `code` is an answer, not a failure. */
    interface ToolOutput {
        stdout: string;
        stderr: string;
        code: number;
        truncated: boolean;
    }

    interface ToolRunRequest {
        tool: string;
        /** Must match one of the tool's `run` patterns. Never the files' flags: the app adds them. */
        args: string[];
        /** Flag and value pairs every command typed into the console gets unless it gives the flag. */
        defaults?: string[];
        /** What the console's dock tab is called after the tool, e.g. a node's name. */
        label?: string;
        /** The confirmation's heading. */
        title?: string;
        /** Colours the confirmation as one that takes something down. */
        danger?: boolean;
        /** Text the user must type to say yes, e.g. the node's name. */
        confirm?: string;
    }

    interface ToolConsoleRequest {
        tool: string;
        defaults?: string[];
        label?: string;
    }

    interface Tools {
        status(tool: string): Promise<ToolStatus>;
        /** Asks the user for one of the tool's files for this cluster, in a file dialog. */
        chooseFile(tool: string, file: string): Promise<ToolStatus>;
        forgetFile(tool: string, file: string): Promise<ToolStatus>;
        /** Runs a `read` command. Rejects for one the manifest does not allow, and after 30 seconds. */
        exec(tool: string, args: string[]): Promise<ToolOutput>;
        /** `exec`, then stdout as JSON. Rejects with stderr on a non-zero code. */
        json<T = unknown>(tool: string, args: string[]): Promise<T>;
        /** Asks to run a `run` command, confirmed by the user, in the tool's console in the dock. */
        run(request: ToolRunRequest): Promise<{ command: string }>;
        /** Opens the tool's console in the dock. */
        console(request: ToolConsoleRequest): Promise<null>;
        /** Opens an `interactive` command in the user's own terminal. */
        external(tool: string, args: string[]): Promise<null>;
    }

    interface Context {
        tools?: DeclaredTool[];
    }

    interface Bridge {
        tools?: Tools;
    }
}
