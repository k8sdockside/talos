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
  var BUILTIN_RELEASES = [
    { minor: "1.12", latest: "v1.12.12", status: "previous" },
    { minor: "1.13", latest: "v1.13.12", status: "previous" },
    { minor: "1.14", latest: "v1.14.5", status: "stable" },
    { minor: "1.15", latest: "v1.15.0-alpha.1", status: "alpha" }
  ];
  var BUILTIN_RELEASES_AS_OF = "2026-10-26";
  var TALOS_REPO = "siderolabs/talos";
  function knownFrom(list, source) {
    const stable = list.filter((r) => r.status === "stable").at(-1);
    return stable ? { releases: [...list], stable, source } : null;
  }
  var BUILTIN = knownFrom(BUILTIN_RELEASES, { kind: "builtin", asOf: BUILTIN_RELEASES_AS_OF, stale: false });
  var known = BUILTIN;
  function releases() {
    return known.releases;
  }
  function latestStable() {
    return known.stable;
  }
  function useReleases(list, source) {
    const next = knownFrom(list, source);
    if (!next) return false;
    known = next;
    return true;
  }
  var TAG = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
  var PREVIOUS_LINES = 2;
  function releasesFrom(list, fallback = BUILTIN_RELEASES) {
    const lines = /* @__PURE__ */ new Map();
    for (const r of list) {
      if (!r || r.draft || typeof r.tag !== "string" || !TAG.test(r.tag.trim())) continue;
      const v = parseVersion(r.tag.trim());
      if (!v) continue;
      const key = minorOf(v);
      const line = lines.get(key) ?? { at: v, final: null, pre: null };
      if (r.prerelease || v.pre) {
        if (!line.pre || compareVersions(v, line.pre) > 0) line.pre = v;
      } else if (!line.final || compareVersions(v, line.final) > 0) {
        line.final = v;
      }
      lines.set(key, line);
    }
    const order = [...lines.values()].sort((a, b) => compareVersions(lineStart(a.at), lineStart(b.at)));
    const finals = order.filter((l) => l.final);
    const stable = finals.at(-1);
    if (!stable) return [];
    const out = [];
    for (const l of finals.slice(-1 - PREVIOUS_LINES, -1)) {
      out.push({ minor: minorOf(l.at), latest: l.final.raw, status: "previous" });
    }
    const stableV = lineStart(stable.at);
    const older = fallback.filter((r) => r.status !== "alpha" && compareVersions(lineStart(parseVersion(r.latest)), stableV) < 0).filter((r) => !out.some((o) => o.minor === r.minor)).map((r) => ({ ...r, status: "previous" }));
    while (out.length < PREVIOUS_LINES && older.length) out.unshift(older.pop());
    out.sort((a, b) => compareVersions(parseVersion(a.latest), parseVersion(b.latest)));
    out.push({ minor: minorOf(stable.at), latest: stable.final.raw, status: "stable" });
    const ahead = order.filter((l) => !l.final && l.pre && compareVersions(lineStart(l.at), stableV) > 0).at(-1);
    if (ahead) out.push({ minor: minorOf(ahead.at), latest: ahead.pre.raw, status: "alpha" });
    return out;
  }
  function lineStart(v) {
    return { major: v.major, minor: v.minor, patch: 0, pre: "", raw: `v${v.major}.${v.minor}.0` };
  }
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
    return releases().find((r) => r.minor === minorOf(v));
  }
  function standing(v) {
    if (!v) return "unknown";
    const latest = parseVersion(latestStable().latest);
    if (v.major === latest.major && v.minor === latest.minor) return compareVersions(v, latest) >= 0 ? "current" : "patch";
    if (compareVersions(v, latest) > 0) return "ahead";
    return releaseOf(v) ? "behind" : "unsupported";
  }
  function nextUpgrade(v) {
    if (!v) return null;
    const current = releaseOf(v);
    if (current && compareVersions(v, parseVersion(current.latest)) < 0) return current;
    const stable = latestStable();
    const latest = parseVersion(stable.latest);
    if (compareVersions(v, latest) >= 0) return null;
    const next = releases().find((r) => {
      const rv = parseVersion(r.latest);
      return r.status !== "alpha" && (rv.major > v.major || rv.major === v.major && rv.minor === v.minor + 1);
    });
    return next ?? stable;
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
  function hostOf(endpoint) {
    return endpoint.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^\[([^\]]+)\](:\d+)?$/, "$1").replace(/^([^:]+):\d+$/, "$1");
  }
  function matchContext(contexts, addresses) {
    const known2 = new Set(addresses);
    return contexts.find((c) => [...c.endpoints, ...c.nodes].some((e) => known2.has(hostOf(e)))) ?? contexts.find((c) => c.current) ?? contexts[0] ?? null;
  }
  var DEFAULT_SETTINGS = { prefer: "auto", nodes: {}, endpoints: { use: "config", custom: [] } };
  function normaliseSettings(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const prefer = r.prefer === "external" || r.prefer === "internal" ? r.prefer : "auto";
    const nodes = {};
    if (r.nodes && typeof r.nodes === "object") {
      for (const [name, v] of Object.entries(r.nodes)) {
        const n = v && typeof v === "object" ? v : {};
        const use2 = ["external", "internal", "custom"].find((u) => u === n.use);
        if (!use2) continue;
        const custom2 = typeof n.custom === "string" ? n.custom.trim() : "";
        if (use2 === "custom" && !custom2) continue;
        nodes[name] = use2 === "custom" ? { use: use2, custom: custom2 } : { use: use2 };
      }
    }
    const e = r.endpoints && typeof r.endpoints === "object" ? r.endpoints : {};
    const custom = Array.isArray(e.custom) ? e.custom.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];
    const use = e.use === "node" ? "node" : e.use === "custom" && custom.length ? "custom" : "config";
    return { prefer, nodes, endpoints: { use, custom } };
  }
  function pickAddress(m, settings, context) {
    const own = settings.nodes[m.name];
    if (own?.use === "custom" && own.custom) return { address: own.custom, source: "custom" };
    const ext = m.external[0];
    const int = m.internal[0];
    const first = (order) => {
      for (const kind of order) {
        const a = kind === "external" ? ext : int;
        if (a) return { address: a, source: kind };
      }
      return { address: "", source: "none" };
    };
    if (own?.use === "external") return first(["external", "internal"]);
    if (own?.use === "internal") return first(["internal", "external"]);
    if (settings.prefer === "internal") return first(["internal", "external"]);
    if (settings.prefer === "external") return first(["external", "internal"]);
    if (context) {
      const named = new Set([...context.nodes, ...context.endpoints].map(hostOf));
      const hit = [...m.external, ...m.internal].find((a) => named.has(a));
      if (hit) return { address: hit, source: "talosconfig" };
    }
    return first(["external", "internal"]);
  }
  function endpointsFor(settings, nodes) {
    if (settings.endpoints.use === "custom") return settings.endpoints.custom;
    if (settings.endpoints.use === "node") return nodes;
    return [];
  }
  function machineOf(node) {
    const labels = node.metadata.labels ?? {};
    const addresses = node.status?.addresses ?? [];
    const info = node.status?.nodeInfo ?? {};
    const os = info.osImage ?? "";
    const of = (type) => addresses.filter((a) => a.type === type && a.address).map((a) => a.address);
    const internal = of("InternalIP");
    const listedExternal = of("ExternalIP");
    const external = listedExternal.length ? listedExternal : internal.filter(isPublicIP);
    const picked = pickAddress({ name: node.metadata.name, internal, external }, DEFAULT_SETTINGS, null);
    return {
      name: node.metadata.name,
      address: picked.address,
      addressFrom: picked.source,
      internal,
      external,
      externalFrom: listedExternal.length ? "kubernetes" : external.length ? "internalip" : "",
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
  function withAddresses(machines, settings, context) {
    return machines.map((m) => {
      const picked = pickAddress(m, settings, context);
      return { ...m, address: picked.address, addressFrom: picked.source };
    });
  }
  function isPublicIP(address) {
    const ip = address.split("/")[0].trim();
    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
    if (v4) {
      const [a, b] = [Number(v4[1]), Number(v4[2])];
      if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return false;
      if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
      if (a === 100 && b >= 64 && b <= 127) return false;
      if (a === 169 && b === 254) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      return true;
    }
    if (!ip.includes(":")) return false;
    const head = parseInt(ip.split(":")[0] || "0", 16);
    if (!(head >= 8192 && head <= 16383)) return false;
    return !/^2001:0?db8:/i.test(ip);
  }
  function publicAddresses(cidrs) {
    const ips = [...new Set(cidrs.map((c) => c.split("/")[0].trim()).filter(isPublicIP))];
    return [...ips.filter((ip) => !ip.includes(":")), ...ips.filter((ip) => ip.includes(":"))];
  }
  function withTalosAddresses(machines, learned) {
    return machines.map((m) => {
      const extra = learned[m.name] ?? [];
      if (m.externalFrom === "kubernetes" || !extra.length) return m;
      return { ...m, external: [.../* @__PURE__ */ new Set([...extra, ...m.external])], externalFrom: "talos" };
    });
  }
  function allAddresses(machines) {
    return [...new Set(machines.flatMap((m) => [...m.external, ...m.internal]))];
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
    if (!s.running) return "stopped";
    if (s.unknown) return "running";
    return s.healthy ? "healthy" : "unhealthy";
  }
  function serviceOk(s) {
    const h = serviceHealth(s);
    return h === "healthy" || h === "running";
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
  var SETTINGS_KEY = "talosSettings";
  var LEARNED_KEY = "talosAddresses";
  function tools() {
    const t = k8sdockside.tools;
    if (!t) throw new Error("talosctl needs K8s Dockside 0.1.23 or newer");
    return t;
  }
  async function loadSettings() {
    const saved = await k8sdockside.storage?.get(SETTINGS_KEY).catch(() => null);
    return normaliseSettings(saved);
  }
  async function connect(addresses) {
    const settings = await loadSettings();
    const learned = await k8sdockside.storage?.get(LEARNED_KEY).catch(() => null);
    const out = {
      ready: false,
      reason: "",
      fix: "",
      status: null,
      contexts: [],
      context: "",
      chosen: false,
      settings,
      learned: learned && typeof learned === "object" ? learned : {}
    };
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
    out.context = (picked ?? matchContext(out.contexts, [...addresses, ...Object.values(out.learned).flat()]))?.name ?? "";
    out.ready = out.context !== "";
    if (!out.ready) return { ...out, fix: "context", reason: "Pick the talosconfig context for this cluster." };
    return out;
  }
  function contextOf(conn) {
    return conn?.contexts.find((c) => c.name === conn.context) ?? null;
  }
  function addressed(machines, conn) {
    return conn ? withAddresses(withTalosAddresses(machines, conn.learned), conn.settings, contextOf(conn)) : machines;
  }
  async function learnAddresses(conn, machines) {
    if (!conn.ready) return false;
    const ask = machines.filter((m) => m.externalFrom !== "kubernetes");
    if (!ask.length) return false;
    const answers = await Promise.all(ask.map(async (m) => {
      const tries = [...new Set([m.address, ...m.external, ...m.internal].filter(Boolean))].sort((a, b) => Number(isPublicIP(b)) - Number(isPublicIP(a)));
      for (const at of tries) {
        try {
          const out = await tools().exec(TOOL, ["get", "nodeaddress", "current-no-k8s", "--output", "json", ...targetAt(conn, at)]);
          const items = parseResources(out.stdout);
          if (items.length) return [m.name, publicAddresses(items[0].spec.addresses ?? [])];
        } catch {
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
    const names = new Set(machines.map((m) => m.name));
    for (const name of Object.keys(next)) if (!names.has(name)) delete next[name];
    if (JSON.stringify(next) === JSON.stringify(conn.learned)) return false;
    conn.learned = next;
    await k8sdockside.storage?.set(LEARNED_KEY, next).catch(() => null);
    return true;
  }
  function targetAt(conn, address) {
    const out = target(conn, [address]);
    if (!out.includes("--endpoints") && !contextOf(conn)?.endpoints.length) out.push("--endpoints", address);
    return out;
  }
  function target(conn, nodes) {
    const out = ["--context", conn.context];
    const endpoints = endpointsFor(conn.settings, nodes);
    if (endpoints.length) out.push("--endpoints", endpoints.join(","));
    if (nodes.length) out.push("--nodes", nodes.join(","));
    return out;
  }
  async function exec(conn, args, nodes) {
    return tools().exec(TOOL, [...args, ...target(conn, nodes)]);
  }
  async function getOne(conn, resource, node) {
    if (!node) throw new Error("no address for this machine -- pick one in Settings");
    const out = await exec(conn, ["get", resource, "--output", "json"], [node]);
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
  function dashboardTitle(nodes) {
    return `talosctl dashboard --nodes ${nodes.join(",")}, in the dock, or in your own terminal if Settings → Terminal says so. Switch machine with ← and →.`;
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

  // src/ui/releases.ts
  var loading = null;
  function loadReleases() {
    loading ??= (async () => {
      const ask = k8sdockside.releases;
      if (typeof ask !== "function") return false;
      try {
        const list = await ask.call(k8sdockside, TALOS_REPO);
        const lines = releasesFrom(list);
        return useReleases(lines, { kind: "live", asOf: list.fetchedAt || (/* @__PURE__ */ new Date()).toISOString(), stale: !!list.stale });
      } catch {
        return false;
      }
    })();
    return loading;
  }

  // src/pages/node.ts
  async function start() {
    await k8sdockside.ready();
    const listed = machineOf(await k8sdockside.object());
    let m = listed;
    const head = el("div", { class: "panel-head" });
    const drawHead = () => {
      const next = nextUpgrade(m.talos);
      replace(
        head,
        versionBadge(m.talos),
        next ? el("span", { class: "small dim" }, `upgrade to ${next.latest} available`) : null,
        el("span", { class: "grow" }),
        button("Open board", () => void handOver(m.name).catch(showError), { class: "btn" })
      );
    };
    drawHead();
    void loadReleases().then((changed) => changed && drawHead());
    if (!m.talos) {
      replace(byId("main"), head, el("p", { class: "dim" }, "This node does not run Talos Linux."));
      return;
    }
    replace(byId("main"), head, el("div", { class: "loading" }, el("span", { class: "pulse" }), " Asking the machine…"));
    const conn = await connect(allAddresses([listed]));
    await learnAddresses(conn, addressed([listed], conn));
    m = addressed([listed], conn)[0] ?? listed;
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
    const bad = services.filter((s) => !serviceOk(s.spec));
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
      el("p", { class: "small faint" }, `${realExtensions(ext).length} extensions · ${m.kernel} · talosctl uses ${m.address}`),
      el(
        "div",
        { class: "row" },
        button("Console", () => void console(conn, m).catch(showError), { class: "btn" }),
        button("Dashboard", () => void dashboard(conn, [m.address]).catch(showError), { class: "btn", title: dashboardTitle([m.address]) })
      )
    );
  }
  start().catch((err) => {
    if (err !== null) showError(err);
  });
})();
