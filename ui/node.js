// Built by k8sdockside-plugin from src/ -- edit the TypeScript there, not this file.
"use strict";
(() => {
  // node_modules/@k8sdockside/plugin-sdk/dom.js
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (value === void 0 || value === false) continue;
      if (name === "class") node.className = String(value);
      else if (name === "text") node.textContent = String(value);
      else node.setAttribute(name, String(value));
    }
    append(node, children);
    return node;
  }
  function button(label, onClick, attrs = {}) {
    const node = el("button", { type: "button", ...attrs }, label);
    node.addEventListener("click", onClick);
    return node;
  }
  function replace(parent, ...children) {
    parent.replaceChildren();
    append(parent, children);
  }
  function byId(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`the page has no #${id}`);
    return node;
  }
  function append(parent, children) {
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      parent.append(child);
    }
  }

  // src/model/talos.ts
  var RELEASES = [
    { minor: "1.12", latest: "v1.12.0", status: "previous" },
    { minor: "1.13", latest: "v1.13.0", status: "previous" },
    { minor: "1.14", latest: "v1.14.2", status: "stable" },
    { minor: "1.15", latest: "v1.15.0-alpha.0", status: "alpha" }
  ];
  var LATEST_STABLE = RELEASES.filter((r) => r.status === "stable").at(-1);
  function parseVersion(text) {
    const m = /v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(text ?? "");
    if (!m) return null;
    const [, major = "0", minor = "0", patch = "0", pre = ""] = m;
    return { major: +major, minor: +minor, patch: +patch, pre, raw: `v${major}.${minor}.${patch}${pre ? "-" + pre : ""}` };
  }
  function compareVersions(a, b) {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    if (a.patch !== b.patch) return a.patch - b.patch;
    if (a.pre === b.pre) return 0;
    if (!a.pre) return 1;
    if (!b.pre) return -1;
    return a.pre < b.pre ? -1 : 1;
  }
  function minorOf(v) {
    return `${v.major}.${v.minor}`;
  }
  function releaseOf(v) {
    return RELEASES.find((r) => r.minor === minorOf(v));
  }
  function standing(v) {
    if (!v) return "unknown";
    const latest = parseVersion(LATEST_STABLE.latest);
    if (v.major === latest.major && v.minor === latest.minor) return compareVersions(v, latest) >= 0 ? "current" : "patch";
    if (compareVersions(v, latest) > 0) return "ahead";
    return releaseOf(v) ? "behind" : "unsupported";
  }
  function nextUpgrade(v) {
    if (!v) return null;
    const current = releaseOf(v);
    if (current && compareVersions(v, parseVersion(current.latest)) < 0) return current;
    const latest = parseVersion(LATEST_STABLE.latest);
    if (compareVersions(v, latest) >= 0) return null;
    const next = RELEASES.find((r) => {
      const rv = parseVersion(r.latest);
      return r.status !== "alpha" && (rv.major > v.major || rv.major === v.major && rv.minor === v.minor + 1);
    });
    return next ?? LATEST_STABLE;
  }
  function parseResources(stdout) {
    const out = [];
    let depth = 0;
    let start2 = -1;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < stdout.length; i++) {
      const ch = stdout[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") {
        if (depth === 0) start2 = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && start2 >= 0) {
          out.push(JSON.parse(stdout.slice(start2, i + 1)));
          start2 = -1;
        }
      }
    }
    return out;
  }
  function parseContexts(stdout) {
    const lines = stdout.split("\n").filter((l) => l.trim() !== "");
    const header = lines.shift();
    if (!header) return [];
    const cols = ["CURRENT", "NAME", "ENDPOINTS", "NODES"].map((c) => header.indexOf(c));
    if (cols.some((c) => c < 0)) return [];
    const cut = (line, i) => line.slice(cols[i], cols[i + 1]).trim();
    const list = (text) => text.split(",").map((s) => s.trim()).filter(Boolean);
    return lines.map((line) => ({
      current: cut(line, 0) === "*",
      name: cut(line, 1),
      endpoints: list(cut(line, 2)),
      nodes: list(cut(line, 3))
    })).filter((c) => c.name !== "");
  }
  function matchContext(contexts, addresses) {
    const host = (e) => e.replace(/^https?:\/\//, "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
    const known = new Set(addresses);
    return contexts.find((c) => [...c.endpoints, ...c.nodes].some((e) => known.has(host(e)))) ?? contexts.find((c) => c.current) ?? contexts[0] ?? null;
  }
  function machineOf(node) {
    const labels = node.metadata.labels ?? {};
    const addresses = node.status?.addresses ?? [];
    const info = node.status?.nodeInfo ?? {};
    const os = info.osImage ?? "";
    return {
      name: node.metadata.name,
      address: addresses.find((a) => a.type === "InternalIP")?.address ?? addresses.find((a) => a.type === "ExternalIP")?.address ?? "",
      controlPlane: "node-role.kubernetes.io/control-plane" in labels || "node-role.kubernetes.io/master" in labels,
      talos: /talos/i.test(os) ? parseVersion(os) : null,
      kubelet: info.kubeletVersion ?? "",
      kernel: info.kernelVersion ?? "",
      arch: info.architecture ?? "",
      ready: (node.status?.conditions ?? []).some((c) => c.type === "Ready" && c.status === "True"),
      cordoned: !!node.spec?.unschedulable,
      cpu: node.status?.capacity?.cpu ?? "",
      memory: memoryText(node.status?.capacity?.memory ?? "")
    };
  }
  function memoryText(quantity) {
    const m = /^(\d+)(Ki|Mi|Gi)?$/.exec(quantity);
    if (!m) return quantity;
    const unit = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3 };
    const bytes = Number(m[1]) * (unit[m[2] ?? ""] ?? 1);
    const gib = bytes / 1024 ** 3;
    return gib >= 10 ? `${Math.round(gib)} GiB` : `${gib.toFixed(1)} GiB`;
  }
  function realExtensions(extensions) {
    return extensions.filter((e) => !["schematic", "modules.dep"].includes(e.spec.metadata?.name ?? ""));
  }
  function serviceHealth(s) {
    if (s.unknown) return "unknown";
    if (!s.running) return "stopped";
    return s.healthy ? "healthy" : "running";
  }
  function stageTone(stage) {
    switch (stage) {
      case "running":
        return "ok";
      case "booting":
      case "installing":
      case "upgrading":
      case "rebooting":
      case "resetting":
      case "shutting down":
        return "warn";
      case "maintenance":
        return "info";
      default:
        return "error";
    }
  }
  function shortError(text) {
    if (/no route to host|connection refused|i\/o timeout|deadline exceeded|connection error/i.test(text)) return "not reachable on the Talos API";
    if (/certificate|x509|tls:/i.test(text)) return "the talosconfig is not accepted: " + text.trim().slice(0, 200);
    const descs = [...text.matchAll(/desc = ([^"\n]+)/g)].map((m) => m[1] ?? "");
    return (descs.at(-1) ?? text).trim().slice(0, 200);
  }

  // src/ui/talos.ts
  var TOOL = "talosctl";
  var CONTEXT_KEY = "talosContext";
  function tools() {
    const t = k8sdockside.tools;
    if (!t) throw new Error("talosctl needs K8s Dockside 0.1.23 or newer");
    return t;
  }
  async function connect(addresses) {
    const out = { ready: false, reason: "", fix: "", status: null, contexts: [], context: "", chosen: false };
    if (!k8sdockside.tools) {
      return { ...out, fix: "app", reason: "Talos needs K8s Dockside 0.1.23 or newer, which can run talosctl for a plugin. The board below is what Kubernetes knows." };
    }
    try {
      out.status = await tools().status(TOOL);
    } catch (err) {
      return { ...out, fix: "app", reason: message(err) };
    }
    if (!out.status.tool.found) return { ...out, fix: "install", reason: out.status.tool.reason };
    const file = out.status.files[0];
    if (!file?.exists) {
      return { ...out, fix: "config", reason: file?.path ? `There is no talosconfig at ${file.path}. Choose the one for this cluster.` : "Choose the talosconfig for this cluster." };
    }
    const listed = await tools().exec(TOOL, ["config", "contexts"]).catch((err) => ({ stdout: "", stderr: message(err), code: 1, truncated: false }));
    out.contexts = parseContexts(listed.stdout);
    if (out.contexts.length === 0) {
      return { ...out, fix: "config", reason: `${file.path} has no contexts${listed.stderr ? ": " + listed.stderr.trim() : ""}` };
    }
    const saved = await k8sdockside.storage?.get(CONTEXT_KEY).catch(() => null);
    const picked = out.contexts.find((c) => c.name === saved);
    out.chosen = !!picked;
    out.context = (picked ?? matchContext(out.contexts, addresses))?.name ?? "";
    out.ready = out.context !== "";
    if (!out.ready) return { ...out, fix: "context", reason: "Pick the talosconfig context for this cluster." };
    return out;
  }
  function target(conn, nodes) {
    const out = ["--context", conn.context];
    if (nodes.length) out.push("--nodes", nodes.join(","));
    return out;
  }
  async function getOne(conn, resource, node) {
    const out = await tools().exec(TOOL, ["get", resource, "--output", "json", ...target(conn, [node])]);
    const items = parseResources(out.stdout);
    if (out.code !== 0 && items.length === 0) throw new Error(shortError(out.stderr || `talosctl exited with ${out.code}`));
    return items;
  }
  async function console(conn, node) {
    await tools().console({ tool: TOOL, defaults: target(conn, node ? [node.address] : []), label: node?.name ?? conn.context });
  }
  async function dashboard(conn, nodes) {
    await tools().external(TOOL, ["dashboard", ...target(conn, nodes)]);
  }
  function message(err) {
    return err instanceof Error ? err.message : String(err);
  }

  // src/ui/common.ts
  function showError(err) {
    const node = document.getElementById("error");
    if (!node) return;
    node.textContent = message(err);
    node.hidden = false;
  }
  var STANDING_TEXT = {
    current: "latest",
    patch: "patch behind",
    behind: "upgrade due",
    ahead: "pre-release",
    unsupported: "out of support",
    unknown: "unknown"
  };
  function versionBadge(v) {
    const s = standing(v);
    return el("span", { class: `badge v-${s}`, title: STANDING_TEXT[s] }, v ? v.raw : "not Talos");
  }
  function dot(tone, title = "") {
    return el("span", { class: `dot tone-${tone}`, title, "aria-hidden": "true" });
  }
  var FOCUS_KEY = "focusNode";
  async function handOver(node) {
    await k8sdockside.storage?.set(FOCUS_KEY, node).catch(() => null);
    await k8sdockside.openView("overview");
  }

  // src/pages/node.ts
  async function start() {
    await k8sdockside.ready();
    const m = machineOf(await k8sdockside.object());
    const next = nextUpgrade(m.talos);
    const head = el(
      "div",
      { class: "panel-head" },
      versionBadge(m.talos),
      next ? el("span", { class: "small dim" }, `upgrade to ${next.latest} available`) : null,
      el("span", { class: "grow" }),
      button("Open board", () => void handOver(m.name).catch(showError), { class: "btn" })
    );
    if (!m.talos) {
      replace(byId("main"), head, el("p", { class: "dim" }, "This node does not run Talos Linux."));
      return;
    }
    replace(byId("main"), head, el("div", { class: "loading" }, el("span", { class: "pulse" }), " Asking the machine…"));
    const conn = await connect([m.address]);
    if (!conn.ready) {
      replace(byId("main"), head, el("p", { class: "dim small" }, conn.reason));
      return;
    }
    const [status, services, ext] = await Promise.all([
      getOne(conn, "machinestatus", m.address),
      getOne(conn, "services", m.address),
      getOne(conn, "extensions", m.address).catch(() => [])
    ]).catch((err) => {
      replace(byId("main"), head, el("p", { class: "tone-error small" }, message(err)));
      throw null;
    });
    const stage = status[0]?.spec.stage ?? "?";
    const bad = services.filter((s) => serviceHealth(s.spec) !== "healthy");
    replace(
      byId("main"),
      head,
      el(
        "div",
        { class: "panel-row" },
        dot(stageTone(stage)),
        el("strong", {}, stage),
        el(
          "span",
          { class: "svc-bar inline", title: services.map((s) => `${s.metadata.id}: ${serviceHealth(s.spec)}`).join("\n") },
          ...services.map((s) => el("span", { class: `seg h-${serviceHealth(s.spec)}` }))
        ),
        el("span", { class: "small dim" }, `${services.length - bad.length}/${services.length} services healthy`)
      ),
      bad.length ? el("p", { class: "small tone-warn" }, "Not healthy: " + bad.map((s) => `${s.metadata.id} (${serviceHealth(s.spec)})`).join(", ")) : null,
      el("p", { class: "small faint" }, `${realExtensions(ext).length} extensions · ${m.kernel}`),
      el(
        "div",
        { class: "row" },
        button("Console", () => void console(conn, m).catch(showError), { class: "btn" }),
        button("Dashboard ↗", () => void dashboard(conn, [m.address]).catch(showError), { class: "btn" })
      )
    );
  }
  start().catch((err) => {
    if (err !== null) showError(err);
  });
})();
