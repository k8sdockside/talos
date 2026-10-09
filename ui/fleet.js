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
  function svg(markup, className = "icon") {
    const holder = document.createElement("span");
    holder.innerHTML = markup;
    const node = holder.firstElementChild;
    if (!node) throw new Error("svg() was given no element");
    node.setAttribute("class", className);
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
  function parseVersion(text2) {
    const m = /v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(text2 ?? "");
    if (!m) return null;
    const [, major = "0", minor = "0", patch = "0", pre2 = ""] = m;
    return { major: +major, minor: +minor, patch: +patch, pre: pre2, raw: `v${major}.${minor}.${patch}${pre2 ? "-" + pre2 : ""}` };
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
  function installerImage(version, schematic) {
    const tag = version.startsWith("v") ? version : `v${version}`;
    return schematic ? `factory.talos.dev/metal-installer/${schematic}:${tag}` : `ghcr.io/siderolabs/installer:${tag}`;
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
    const header2 = lines.shift();
    if (!header2) return [];
    const cols = ["CURRENT", "NAME", "ENDPOINTS", "NODES"].map((c) => header2.indexOf(c));
    if (cols.some((c) => c < 0)) return [];
    const cut = (line, i) => line.slice(cols[i], cols[i + 1]).trim();
    const list = (text2) => text2.split(",").map((s) => s.trim()).filter(Boolean);
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
  function sortMachines(machines) {
    return [...machines].sort((a, b) => Number(b.controlPlane) - Number(a.controlPlane) || a.name.localeCompare(b.name, void 0, { numeric: true }));
  }
  function schematicOf(extensions) {
    return extensions.find((e) => e.spec.metadata?.name === "schematic")?.spec.metadata?.version ?? "";
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
  function shortError(text2) {
    if (/no route to host|connection refused|i\/o timeout|deadline exceeded|connection error/i.test(text2)) return "not reachable on the Talos API";
    if (/certificate|x509|tls:/i.test(text2)) return "the talosconfig is not accepted: " + text2.trim().slice(0, 200);
    const descs = [...text2.matchAll(/desc = ([^"\n]+)/g)].map((m) => m[1] ?? "");
    return (descs.at(-1) ?? text2).trim().slice(0, 200);
  }

  // src/ui/logo.ts
  var TALOS_LOGO = '<svg aria-label="Talos by Sidero Labs" role="img" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 3517 1000"><defs><linearGradient id="talos-grad" x1="522.13" y1="-10627.03" x2="522.13" y2="-11761.55" gradientTransform="translate(0 -10761.5486) scale(1 -1)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#e8312c"/><stop offset=".51" stop-color="#e2335a"/><stop offset="1" stop-color="#f77216"/></linearGradient><linearGradient id="talos-grad-2" x1="891.83" y1="-10896.34" x2="891.83" y2="-11550.85" xlink:href="#talos-grad"/><linearGradient id="talos-grad-3" x1="727.26" y1="-10690.22" x2="727.26" y2="-11713.86" xlink:href="#talos-grad"/><linearGradient id="talos-grad-4" x1="316.96" y1="-10690.36" x2="316.96" y2="-11713.46" xlink:href="#talos-grad"/><linearGradient id="talos-grad-5" x1="152.69" y1="-10896.3" x2="152.69" y2="-11550.81" xlink:href="#talos-grad"/></defs><path fill="url(#talos-grad)" d="M522.13,0c-11.48,0-23.43.48-37.59,1.56-4.5.35-8.01,4.11-8.01,8.62v979.65c0,4.55,3.51,8.31,8.01,8.62,14.25,1.08,26.2,1.56,37.67,1.56s23.34-.48,37.5-1.56c4.5-.35,8.01-4.11,8.01-8.62V10.18c0-4.55-3.51-8.31-8.01-8.62-14.16-1.04-26.03-1.56-37.41-1.56h-.17Z"/><path fill="url(#talos-grad-2)" d="M961.37,212.4c-2.25,0-4.46.87-6.06,2.47-4.24,4.16-8.49,8.4-12.77,12.69-111.98,112.71-166.72,201.96-167.37,272.84-.65,70.58,54.39,160.78,168.28,275.79,3.29,3.34,6.54,6.58,9.83,9.79l.82.82c1.65,1.6,3.81,2.51,6.11,2.51h.78c2.55-.22,4.85-1.56,6.32-3.68,14.94-21.43,28.19-43.91,39.36-66.81,1.6-3.29.95-7.23-1.6-9.87-89.77-91.63-139-165.37-138.61-207.67.39-43.39,49.97-117.35,139.57-208.24,2.55-2.6,3.2-6.54,1.64-9.83-11.04-22.86-24.21-45.42-39.1-67.03-1.47-2.12-3.77-3.46-6.32-3.68h-.82l-.04-.09Z"/><path fill="url(#talos-grad-3)" d="M755.77,50.04c-1,0-1.99.17-2.95.52-2.21.78-3.98,2.47-4.98,4.59-74.22,165.11-122.2,340-122.2,445.66,0,110.85,45.99,286.05,117.18,446.39.95,2.12,2.73,3.81,4.89,4.59.95.35,1.99.52,2.99.52,1.26,0,2.55-.3,3.72-.82,23.12-11.04,45.68-24.03,66.99-38.62,3.42-2.34,4.72-6.8,3.03-10.61-65.39-149.52-107.61-307.14-107.61-401.49s43.69-248.64,111.29-400.45c1.69-3.81.43-8.27-2.95-10.61-21-14.64-43.09-27.71-65.65-38.75-1.21-.61-2.51-.87-3.81-.87l.04-.04Z"/><path fill="url(#talos-grad-4)" d="M288.5,50.12c-1.3,0-2.6.3-3.81.91-22.56,11.09-44.65,24.16-65.65,38.8-3.42,2.38-4.63,6.84-2.95,10.61,67.55,151.81,111.2,308.96,111.2,400.36s-42.22,251.88-107.57,401.4c-1.65,3.81-.39,8.27,3.03,10.61,21.13,14.46,43.39,27.32,66.08,38.23,1.17.56,2.47.87,3.77.87,1,0,2.04-.17,2.99-.52,2.21-.82,3.98-2.47,4.94-4.63,71.71-161.9,118.05-336.93,118.05-445.92s-47.94-280.51-122.16-445.57c-.95-2.12-2.77-3.81-4.98-4.59-.95-.35-1.95-.52-2.95-.52v-.04Z"/><path fill="url(#talos-grad-5)" d="M82.29,212.44c-2.55.26-4.85,1.6-6.32,3.68-14.94,21.61-28.1,44.17-39.1,67.03-1.6,3.29-.95,7.23,1.65,9.83,89.59,90.89,139.18,164.85,139.57,208.24.56,61.18-106.01,174.29-138.7,207.5-2.55,2.6-3.2,6.58-1.6,9.87,11.17,22.95,24.42,45.47,39.45,66.99,1.47,2.08,3.77,3.42,6.32,3.68h.78c2.25,0,4.46-.91,6.11-2.51l.56-.56c3.33-3.33,6.71-6.67,10.09-10.04,113.89-115.01,168.93-205.21,168.28-275.79-.65-70.88-55.43-160.13-167.37-272.84-4.24-4.29-8.53-8.49-12.77-12.69-1.65-1.6-3.81-2.47-6.06-2.47h-.82l-.04.09Z"/><g><path fill="currentColor" d="M1572.73,353.63h-138.88v364.48h-89.28v-364.48h-138.88v-83.52h367.04v83.52Z"/><path fill="currentColor" d="M2039.62,718.11h-95.36l-39.04-104.32h-191.04l-39.04,104.32h-93.12l174.4-448h108.8l174.4,448ZM1744.9,531.55h129.6l-64.64-173.12-64.96,173.12Z"/><path fill="currentColor" d="M2455.29,718.11h-326.08v-448h89.28v364.48h236.8v83.52Z"/><path fill="currentColor" d="M2744.25,261.79c34.56,0,66.24,5.81,95.04,17.44,28.8,11.63,53.6,27.79,74.4,48.48,20.8,20.7,37.01,45.23,48.64,73.6,11.62,28.38,17.44,59.31,17.44,92.8s-5.82,64.43-17.44,92.8c-11.63,28.38-27.84,52.91-48.64,73.6-20.8,20.69-45.6,36.85-74.4,48.48-28.8,11.62-60.48,17.44-95.04,17.44s-66.24-5.82-95.04-17.44c-28.8-11.62-53.6-27.79-74.4-48.48-20.8-20.69-36.96-45.23-48.48-73.6-11.52-28.37-17.28-59.3-17.28-92.8s5.76-64.43,17.28-92.8c11.52-28.37,27.68-52.9,48.48-73.6,20.8-20.69,45.6-36.85,74.4-48.48,28.8-11.62,60.48-17.44,95.04-17.44ZM2744.25,347.55c-20.48,0-39.42,3.57-56.8,10.72-17.39,7.15-32.43,17.12-45.12,29.92-12.69,12.8-22.56,28.21-29.6,46.24-7.04,18.03-10.56,37.92-10.56,59.68s3.52,41.65,10.56,59.68c7.04,18.03,16.91,33.44,29.6,46.24,12.69,12.8,27.73,22.78,45.12,29.92,17.38,7.15,36.32,10.72,56.8,10.72s39.73-3.57,57.12-10.72c17.38-7.14,32.37-17.12,44.96-29.92,12.58-12.8,22.4-28.21,29.44-46.24,7.04-18.03,10.56-37.92,10.56-59.68s-3.52-41.65-10.56-59.68c-7.04-18.03-16.86-33.44-29.44-46.24-12.59-12.8-27.58-22.77-44.96-29.92-17.39-7.15-36.43-10.72-57.12-10.72Z"/><path fill="currentColor" d="M3392.9,383.07c-17.71-10.88-37.17-19.95-58.4-27.2-21.23-7.25-44.11-10.88-68.64-10.88-12.59,0-24.11,1.23-34.56,3.68-10.46,2.46-19.47,5.98-27.04,10.56-7.58,4.59-13.5,10.19-17.76,16.8-4.27,6.62-6.4,14.19-6.4,22.72s2.29,15.26,6.88,20.8c4.58,5.55,10.99,10.24,19.2,14.08,8.21,3.84,17.97,7.1,29.28,9.76,11.3,2.67,23.68,5.07,37.12,7.2l25.28,4.16c20.05,3.2,38.77,7.9,56.16,14.08,17.38,6.19,32.48,14.29,45.28,24.32,12.8,10.03,22.88,22.19,30.24,36.48,7.36,14.29,11.04,31.15,11.04,50.56,0,24.75-5.01,46.24-15.04,64.48-10.03,18.24-23.52,33.39-40.48,45.44-16.96,12.05-36.48,21.07-58.56,27.04-22.08,5.97-45.18,8.96-69.28,8.96-17.07,0-34.24-1.23-51.52-3.68-17.28-2.46-34.08-6.13-50.4-11.04-16.32-4.9-31.9-11.04-46.72-18.4-14.83-7.36-28.21-15.84-40.16-25.44l46.4-72c8.11,6.4,17.38,12.54,27.84,18.4,10.45,5.87,21.81,11.04,34.08,15.52,12.27,4.48,25.17,8,38.72,10.56,13.54,2.56,27.57,3.84,42.08,3.84,12.37,0,23.95-1.17,34.72-3.52,10.77-2.35,20.1-5.87,28-10.56,7.89-4.69,14.08-10.35,18.56-16.96,4.48-6.61,6.72-14.29,6.72-23.04,0-7.68-2.03-14.29-6.08-19.84-4.06-5.54-10.08-10.29-18.08-14.24-8-3.95-17.92-7.36-29.76-10.24-11.84-2.88-25.55-5.6-41.12-8.16l-28.48-4.48c-19.84-3.2-38.08-7.84-54.72-13.92-16.64-6.08-31.04-14.24-43.2-24.48-12.16-10.24-21.66-22.72-28.48-37.44-6.83-14.72-10.24-32.21-10.24-52.48,0-23.25,4.85-43.79,14.56-61.6,9.71-17.81,22.72-32.64,39.04-44.48s35.25-20.8,56.8-26.88c21.54-6.08,44.27-9.12,68.16-9.12,15.57,0,30.67.91,45.28,2.72,14.61,1.82,28.85,4.64,42.72,8.48,13.87,3.84,27.68,8.8,41.44,14.88,13.76,6.08,27.68,13.28,41.76,21.6l-42.24,72.96Z"/></g><g><path fill="currentColor" d="M2610.16,867.02c6.67,0,12.88,1.23,18.65,3.7,5.77,2.47,10.78,5.9,15.05,10.3,4.27,4.4,7.63,9.62,10.1,15.65,2.47,6.04,3.7,12.65,3.7,19.85s-1.23,13.82-3.7,19.85c-2.47,6.03-5.83,11.25-10.1,15.65-4.27,4.4-9.28,7.83-15.05,10.3-5.77,2.47-11.98,3.7-18.65,3.7-7.53,0-14.07-1.33-19.6-4-5.53-2.67-10.17-6.23-13.9-10.7v12.7h-16.3v-144h16.3v61.7c3.73-4.47,8.37-8.03,13.9-10.7,5.53-2.67,12.07-4,19.6-4ZM2608.26,882.42c-4.8,0-9.2.87-13.2,2.6-4,1.73-7.43,4.13-10.3,7.2-2.87,3.07-5.1,6.67-6.7,10.8-1.6,4.13-2.4,8.63-2.4,13.5s.8,9.38,2.4,13.55c1.6,4.17,3.83,7.79,6.7,10.85,2.87,3.07,6.3,5.47,10.3,7.2,4,1.73,8.4,2.6,13.2,2.6s9.4-.9,13.4-2.7,7.43-4.25,10.3-7.35c2.87-3.1,5.07-6.71,6.6-10.85,1.53-4.13,2.3-8.57,2.3-13.3s-.78-9.17-2.35-13.3c-1.57-4.13-3.78-7.75-6.65-10.85-2.87-3.1-6.3-5.53-10.3-7.3-4-1.77-8.43-2.65-13.3-2.65Z"/><path fill="currentColor" d="M2693.05,1004.52h-18.1l35.1-60.8-43.3-74.7h18.3l34.2,58.4,32.5-58.4h18l-76.7,135.5Z"/><path fill="currentColor" d="M2931.55,859.32c-5.53-3.4-11.62-6.23-18.25-8.5-6.63-2.27-13.78-3.4-21.45-3.4-3.93,0-7.53.38-10.8,1.15-3.27.77-6.08,1.87-8.45,3.3-2.37,1.43-4.22,3.18-5.55,5.25-1.33,2.07-2,4.43-2,7.1s.72,4.77,2.15,6.5c1.43,1.73,3.43,3.2,6,4.4,2.57,1.2,5.62,2.22,9.15,3.05,3.53.83,7.4,1.58,11.6,2.25l7.9,1.3c6.27,1,12.12,2.47,17.55,4.4,5.43,1.93,10.15,4.47,14.15,7.6,4,3.13,7.15,6.93,9.45,11.4,2.3,4.47,3.45,9.73,3.45,15.8,0,7.73-1.57,14.45-4.7,20.15-3.13,5.7-7.35,10.43-12.65,14.2-5.3,3.77-11.4,6.58-18.3,8.45s-14.12,2.8-21.65,2.8c-5.33,0-10.7-.38-16.1-1.15-5.4-.77-10.65-1.92-15.75-3.45-5.1-1.53-9.97-3.45-14.6-5.75-4.63-2.3-8.82-4.95-12.55-7.95l14.5-22.5c2.53,2,5.43,3.92,8.7,5.75,3.27,1.83,6.82,3.45,10.65,4.85,3.83,1.4,7.87,2.5,12.1,3.3,4.23.8,8.62,1.2,13.15,1.2,3.87,0,7.48-.37,10.85-1.1,3.37-.73,6.28-1.83,8.75-3.3,2.47-1.46,4.4-3.23,5.8-5.3s2.1-4.47,2.1-7.2c0-2.4-.63-4.46-1.9-6.2-1.27-1.73-3.15-3.22-5.65-4.45-2.5-1.23-5.6-2.3-9.3-3.2s-7.98-1.75-12.85-2.55l-8.9-1.4c-6.2-1-11.9-2.45-17.1-4.35-5.2-1.9-9.7-4.45-13.5-7.65-3.8-3.2-6.77-7.1-8.9-11.7-2.13-4.6-3.2-10.06-3.2-16.4,0-7.27,1.52-13.68,4.55-19.25,3.03-5.57,7.1-10.2,12.2-13.9,5.1-3.7,11.02-6.5,17.75-8.4,6.73-1.9,13.83-2.85,21.3-2.85,4.87,0,9.58.28,14.15.85,4.57.57,9.02,1.45,13.35,2.65,4.33,1.2,8.65,2.75,12.95,4.65,4.3,1.9,8.65,4.15,13.05,6.75l-13.2,22.8Z"/><path fill="currentColor" d="M2982.55,818.62c2.33,0,4.52.43,6.55,1.3,2.03.87,3.8,2.05,5.3,3.55s2.68,3.28,3.55,5.35c.87,2.07,1.3,4.27,1.3,6.6s-.43,4.52-1.3,6.55c-.87,2.03-2.05,3.8-3.55,5.3s-3.27,2.67-5.3,3.5c-2.03.83-4.22,1.25-6.55,1.25s-4.52-.42-6.55-1.25c-2.03-.83-3.8-2-5.3-3.5s-2.67-3.27-3.5-5.3c-.83-2.03-1.25-4.22-1.25-6.55s.42-4.53,1.25-6.6c.83-2.07,2-3.85,3.5-5.35s3.27-2.68,5.3-3.55c2.03-.87,4.22-1.3,6.55-1.3ZM2995.75,964.02h-26.1v-96.9h26.1v96.9Z"/><path fill="currentColor" d="M3064.05,864.52c6.53,0,12.12,1.17,16.75,3.5,4.63,2.33,8.55,5.4,11.75,9.2v-57.2h26v144h-25.5v-10.7c-3.2,3.93-7.17,7.12-11.9,9.55-4.73,2.43-10.43,3.65-17.1,3.65s-12.87-1.3-18.6-3.9c-5.73-2.6-10.7-6.17-14.9-10.7-4.2-4.53-7.48-9.92-9.85-16.15-2.37-6.23-3.55-12.98-3.55-20.25s1.18-14.02,3.55-20.25c2.37-6.23,5.65-11.62,9.85-16.15,4.2-4.53,9.17-8.1,14.9-10.7,5.73-2.6,11.93-3.9,18.6-3.9ZM3068.85,888.82c-3.8,0-7.25.7-10.35,2.1-3.1,1.4-5.73,3.3-7.9,5.7-2.17,2.4-3.83,5.23-5,8.5-1.17,3.27-1.75,6.73-1.75,10.4s.58,7.22,1.75,10.45c1.17,3.23,2.83,6.05,5,8.45,2.17,2.4,4.8,4.3,7.9,5.7,3.1,1.4,6.55,2.1,10.35,2.1s7.13-.67,10.2-2c3.07-1.33,5.7-3.2,7.9-5.6,2.2-2.4,3.9-5.23,5.1-8.5,1.2-3.27,1.8-6.8,1.8-10.6s-.6-7.33-1.8-10.6c-1.2-3.27-2.9-6.1-5.1-8.5-2.2-2.4-4.83-4.27-7.9-5.6-3.07-1.33-6.47-2-10.2-2Z"/><path fill="currentColor" d="M3188.95,864.52c7,0,13.38,1.23,19.15,3.7,5.77,2.47,10.72,5.93,14.85,10.4,4.13,4.47,7.35,9.83,9.65,16.1,2.3,6.27,3.45,13.17,3.45,20.7,0,1.54-.05,3.1-.15,4.7-.1,1.6-.22,2.97-.35,4.1h-68.7c.67,3.53,1.77,6.55,3.3,9.05,1.53,2.5,3.38,4.58,5.55,6.25,2.17,1.67,4.62,2.88,7.35,3.65,2.73.77,5.63,1.15,8.7,1.15,4.2,0,8.45-.8,12.75-2.4,4.3-1.6,8.22-3.9,11.75-6.9l15.3,16.8c-5.53,5.07-11.75,8.79-18.65,11.15s-14.45,3.55-22.65,3.55c-7.4,0-14.18-1.22-20.35-3.65-6.17-2.43-11.47-5.87-15.9-10.3-4.43-4.43-7.88-9.77-10.35-16-2.47-6.23-3.7-13.15-3.7-20.75s1.2-14.55,3.6-20.85c2.4-6.3,5.75-11.7,10.05-16.2,4.3-4.5,9.45-8,15.45-10.5s12.63-3.75,19.9-3.75ZM3188.75,887.02c-6.2,0-11.1,1.72-14.7,5.15-3.6,3.44-5.97,8.19-7.1,14.25h42.9c-1.2-6.27-3.6-11.06-7.2-14.4-3.6-3.33-8.23-5-13.9-5Z"/><path fill="currentColor" d="M3309.95,864.52c2.8,0,5.32.18,7.55.55,2.23.37,4.25.88,6.05,1.55l-3.9,25.9c-2.13-.93-4.63-1.68-7.5-2.25-2.87-.57-5.63-.85-8.3-.85-3,0-5.75.47-8.25,1.4-2.5.93-4.65,2.3-6.45,4.1-1.8,1.8-3.2,4.07-4.2,6.8-1,2.73-1.5,5.9-1.5,9.5v52.8h-26.1v-96.9h25.3v10.6c3.07-4.6,6.88-7.95,11.45-10.05,4.57-2.1,9.85-3.15,15.85-3.15Z"/><path fill="currentColor" d="M3384.35,864.52c7.53,0,14.52,1.28,20.95,3.85,6.43,2.57,11.98,6.13,16.65,10.7,4.67,4.57,8.32,9.97,10.95,16.2,2.63,6.23,3.95,12.98,3.95,20.25s-1.32,14.1-3.95,20.3c-2.63,6.2-6.28,11.58-10.95,16.15-4.67,4.57-10.22,8.13-16.65,10.7-6.43,2.57-13.42,3.85-20.95,3.85s-14.5-1.28-20.9-3.85c-6.4-2.56-11.92-6.13-16.55-10.7-4.63-4.57-8.27-9.95-10.9-16.15-2.63-6.2-3.95-12.96-3.95-20.3s1.32-14.02,3.95-20.25c2.63-6.23,6.27-11.63,10.9-16.2,4.63-4.57,10.15-8.13,16.55-10.7s13.37-3.85,20.9-3.85ZM3384.35,888.82c-3.67,0-7.07.65-10.2,1.95-3.13,1.3-5.85,3.13-8.15,5.5-2.3,2.37-4.1,5.18-5.4,8.45-1.3,3.27-1.95,6.87-1.95,10.8s.65,7.53,1.95,10.8c1.3,3.27,3.1,6.08,5.4,8.45,2.3,2.37,5.02,4.2,8.15,5.5,3.13,1.3,6.53,1.95,10.2,1.95s7.08-.65,10.25-1.95c3.17-1.3,5.9-3.13,8.2-5.5,2.3-2.37,4.1-5.18,5.4-8.45,1.3-3.27,1.95-6.87,1.95-10.8s-.65-7.53-1.95-10.8c-1.3-3.27-3.1-6.08-5.4-8.45-2.3-2.37-5.03-4.2-8.2-5.5-3.17-1.3-6.58-1.95-10.25-1.95Z"/></g></svg>';

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
  async function useContext(name) {
    await k8sdockside.storage?.set(CONTEXT_KEY, name);
  }
  async function chooseConfig() {
    await tools().chooseFile(TOOL, "config");
    await k8sdockside.storage?.remove(CONTEXT_KEY).catch(() => null);
  }
  async function forgetConfig() {
    await tools().forgetFile(TOOL, "config");
    await k8sdockside.storage?.remove(CONTEXT_KEY).catch(() => null);
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
  async function getEach(conn, resource, nodes) {
    const answers = await Promise.all(
      nodes.map((n) => getOne(conn, resource, n).then(
        (items) => [n, items],
        (err) => [n, err instanceof Error ? err : new Error(String(err))]
      ))
    );
    return new Map(answers);
  }
  async function text(conn, args, nodes) {
    const out = await tools().exec(TOOL, [...args, ...target(conn, nodes)]);
    if (out.code !== 0 && !out.stdout.trim()) throw new Error(shortError(out.stderr || `talosctl exited with ${out.code}`));
    return out.stdout.replace(/\s+$/, "") + (out.truncated ? "\n… (cut)" : "");
  }
  async function run(conn, args, node, opts) {
    const nodes = node ? [node.address] : [];
    await tools().run({
      tool: TOOL,
      args: [...args, ...target(conn, nodes)],
      defaults: target(conn, nodes),
      label: node?.name ?? conn.context,
      title: opts.title,
      danger: opts.danger,
      confirm: opts.confirm
    });
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
  function clearError() {
    const node = document.getElementById("error");
    if (node) node.hidden = true;
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
  function on(node, event, handler) {
    node.addEventListener(event, handler);
    return node;
  }
  var FOCUS_KEY = "focusNode";
  async function takeHandOver() {
    const store = k8sdockside.storage;
    if (!store) return null;
    try {
      const node = await store.get(FOCUS_KEY);
      if (node) await store.remove(FOCUS_KEY);
      return typeof node === "string" ? node : null;
    } catch {
      return null;
    }
  }
  function when(date = /* @__PURE__ */ new Date()) {
    return k8sdockside.format?.time(date) ?? date.toLocaleTimeString();
  }

  // src/pages/fleet.ts
  var LIVE_EVERY = 2e4;
  var state = {
    contextName: "",
    machines: [],
    conn: null,
    connecting: false,
    live: { status: /* @__PURE__ */ new Map(), services: /* @__PURE__ */ new Map(), extensions: /* @__PURE__ */ new Map(), security: /* @__PURE__ */ new Map(), at: null },
    selected: "",
    tab: "overview",
    /** What a drawer tab read, by machine and tab, so switching back does not read again. */
    drawer: /* @__PURE__ */ new Map(),
    logService: "kubelet",
    k8sTarget: ""
  };
  async function start() {
    const ctx = await k8sdockside.ready();
    state.contextName = ctx.contextName;
    const focus = await takeHandOver();
    if (focus) state.selected = focus;
    let first = true;
    k8sdockside.watch(
      { kind: "nodes", interval: 15e3 },
      (items) => {
        state.machines = sortMachines(items.map(machineOf));
        render();
        if (first) {
          first = false;
          void reconnect();
        }
      },
      showError
    );
    setInterval(() => void readLive(false), LIVE_EVERY);
  }
  async function reconnect() {
    state.connecting = true;
    render();
    state.conn = await connect(state.machines.map((m) => m.address).filter(Boolean));
    state.connecting = false;
    state.drawer.clear();
    render();
    if (state.conn.ready) await readLive(true);
  }
  async function readLive(everything) {
    const conn = state.conn;
    if (!conn?.ready || document.hidden) return;
    const nodes = state.machines.map((m) => m.address).filter(Boolean);
    if (!nodes.length) return;
    const reads = [
      getEach(conn, "machinestatus", nodes).then((m) => void (state.live.status = m)),
      getEach(conn, "services", nodes).then((m) => void (state.live.services = m))
    ];
    if (everything || state.live.extensions.size === 0) {
      reads.push(
        getEach(conn, "extensions", nodes).then((m) => void (state.live.extensions = m)),
        getEach(conn, "securitystate", nodes).then((m) => void (state.live.security = m))
      );
    }
    await Promise.all(reads).catch(showError);
    state.live.at = /* @__PURE__ */ new Date();
    render();
  }
  function itemsOf(map, address) {
    const v = map.get(address);
    return Array.isArray(v) ? v : null;
  }
  function errorOf(address) {
    const v = state.live.status.get(address);
    return v instanceof Error ? v.message : "";
  }
  function render() {
    clearError();
    const selected = state.machines.find((m) => m.name === state.selected) ?? null;
    replace(
      byId("main"),
      header(),
      connectionBar(),
      runway(),
      el(
        "div",
        { class: selected ? "layout with-drawer" : "layout" },
        el("div", { class: "board" }, ...groups()),
        selected ? drawer(selected) : null
      )
    );
  }
  function header() {
    const talos = state.machines.filter((m) => m.talos);
    const ready = state.machines.filter((m) => m.ready).length;
    return el(
      "header",
      { class: "head" },
      el(
        "div",
        { class: "title" },
        el(
          "div",
          {},
          el("h1", { class: "brand-title" }, svg(TALOS_LOGO, "brand"), el("span", { class: "sr-only" }, "Talos")),
          el(
            "div",
            { class: "dim small" },
            `${state.contextName} · ${state.machines.length} machine${state.machines.length === 1 ? "" : "s"}, ${ready} ready` + (talos.length < state.machines.length ? ` · ${state.machines.length - talos.length} not on Talos` : "")
          )
        )
      ),
      el(
        "div",
        { class: "head-actions" },
        state.conn?.ready ? button("Console", () => void console(state.conn, null).catch(showError), { class: "btn" }) : null,
        state.conn?.ready ? button("Health check", () => void healthCheck(), { class: "btn" }) : null,
        state.conn?.ready ? button("Upgrade Kubernetes…", () => openK8sUpgrade(), { class: "btn" }) : null,
        button("Refresh", () => void readLive(true), { class: "btn ghost", title: state.live.at ? `Read at ${when(state.live.at)}` : "" })
      )
    );
  }
  function connectionBar() {
    const c = state.conn;
    if (state.connecting || !c) {
      return el("div", { class: "conn" }, el("span", { class: "pulse" }), el("span", { class: "dim" }, "Looking for talosctl and your talosconfig…"));
    }
    if (!c.ready) {
      return el(
        "div",
        { class: "conn setup" },
        dot("warn"),
        el(
          "div",
          { class: "grow" },
          el("strong", {}, setupTitle(c)),
          el("div", { class: "dim small" }, c.reason)
        ),
        c.fix === "config" || c.fix === "context" ? button("Choose talosconfig…", () => void chooseConfig().then(reconnect).catch(showError), { class: "btn primary" }) : null,
        c.fix !== "app" ? button("Try again", () => void reconnect(), { class: "btn ghost" }) : null
      );
    }
    const file = c.status?.files[0];
    const select2 = el(
      "select",
      { "aria-label": "talosconfig context", "data-k8sdockside-keep": "off" },
      ...c.contexts.map((ctx) => {
        const o = el("option", { value: ctx.name }, ctx.name + (ctx.endpoints.length ? `  (${ctx.endpoints.join(", ")})` : ""));
        o.selected = ctx.name === c.context;
        return o;
      })
    );
    on(select2, "change", () => void useContext(select2.value).then(reconnect).catch(showError));
    return el(
      "div",
      { class: "conn" },
      dot("ok"),
      el("span", { class: "mono" }, `talosctl ${c.status?.tool.version ?? ""}`),
      el("span", { class: "sep" }),
      el("span", { class: "dim", title: file?.path ?? "" }, "talosconfig "),
      el("span", { class: "mono", title: file?.source === "configured" ? "Chosen for this cluster" : "talosctl’s default" }, shortPath(file?.path ?? "")),
      el("span", { class: "sep" }),
      el("span", { class: "dim" }, "context "),
      select2,
      el("span", { class: "grow" }),
      button("Change…", () => void chooseConfig().then(reconnect).catch(showError), { class: "link" }),
      file?.source === "configured" ? button("Use default", () => void forgetConfig().then(reconnect).catch(showError), { class: "link" }) : null
    );
  }
  function setupTitle(c) {
    switch (c.fix) {
      case "install":
        return "talosctl is not installed";
      case "config":
        return "No talosconfig for this cluster";
      case "context":
        return "Which context?";
      default:
        return "talosctl is not available here";
    }
  }
  function shortPath(path) {
    return path.replace(/^\/(home|Users)\/[^/]+/, "~");
  }
  function runway() {
    const talos = state.machines.filter((m) => m.talos);
    const byMinor = /* @__PURE__ */ new Map();
    for (const m of talos) {
      const k = minorOf(m.talos);
      byMinor.set(k, [...byMinor.get(k) ?? [], m]);
    }
    const older = talos.filter((m) => !RELEASES.some((r) => r.minor === minorOf(m.talos)));
    const stops = RELEASES.map((r) => {
      const here = byMinor.get(r.minor) ?? [];
      return el(
        "div",
        { class: `stop s-${r.status}${here.length ? " occupied" : ""}` },
        el(
          "div",
          { class: "pips" },
          ...here.map((m) => {
            const pip = el("span", {
              class: `pip${m.controlPlane ? " cp" : ""} v-${standing(m.talos)}${m.name === state.selected ? " on" : ""}`,
              title: `${m.name} · ${m.talos.raw}${m.controlPlane ? " · control plane" : ""}`,
              role: "button",
              tabindex: 0
            });
            return on(pip, "click", () => select(m.name));
          })
        ),
        el("div", { class: "marker" }),
        el(
          "div",
          { class: "stop-label" },
          el("strong", {}, r.minor),
          el("span", { class: "faint small" }, r.status === "stable" ? `latest · ${r.latest}` : r.status === "alpha" ? "alpha" : r.latest)
        )
      );
    });
    const versions = /* @__PURE__ */ new Map();
    for (const m of state.machines) if (m.kubelet) versions.set(m.kubelet, (versions.get(m.kubelet) ?? 0) + 1);
    return el(
      "section",
      { class: "runway card" },
      el(
        "div",
        { class: "runway-head" },
        el("h2", {}, "Version runway"),
        el("span", { class: "dim" }, verdict(talos))
      ),
      el(
        "div",
        { class: "track" },
        older.length ? el("div", { class: "stop s-old occupied" }, el("div", { class: "pips" }, ...older.map((m) => el("span", { class: "pip v-unsupported", title: `${m.name} · ${m.talos.raw}` }))), el("div", { class: "marker" }), el("div", { class: "stop-label" }, el("strong", {}, "older"))) : null,
        ...stops
      ),
      el(
        "div",
        { class: "kube-line small" },
        el("span", { class: "dim" }, "Kubernetes "),
        ...[...versions.entries()].map(([v, n]) => el("span", { class: "chip" }, `${v}${versions.size > 1 ? ` × ${n}` : ""}`))
      )
    );
  }
  function verdict(talos) {
    if (!talos.length) return "No machine reports Talos as its OS.";
    const latest = LATEST_STABLE.latest;
    const behind = talos.filter((m) => ["behind", "patch", "unsupported"].includes(standing(m.talos)));
    const ahead = talos.filter((m) => standing(m.talos) === "ahead");
    if (!behind.length && !ahead.length) return `All ${talos.length} on ${latest}, the latest stable.`;
    const parts = [];
    if (behind.length) {
      const next = nextUpgrade(behind.map((m) => m.talos).sort((a, b) => a.minor - b.minor || a.patch - b.patch)[0] ?? null);
      parts.push(`${behind.length} behind ${latest}` + (next ? ` — next step ${next.latest}, one minor at a time` : ""));
    }
    if (ahead.length) parts.push(`${ahead.length} on a pre-release`);
    return parts.join(" · ");
  }
  function groups() {
    const cp = state.machines.filter((m) => m.controlPlane);
    const workers = state.machines.filter((m) => !m.controlPlane);
    return [
      cp.length ? group("Control plane", cp) : null,
      workers.length ? group("Workers", workers) : null
    ].filter((g) => g !== null);
  }
  function group(title, machines) {
    return el(
      "section",
      { class: "group" },
      el("h3", {}, title, el("span", { class: "faint" }, ` ${machines.length}`)),
      el("div", { class: "tiles" }, ...machines.map(tile))
    );
  }
  function tile(m) {
    const status = itemsOf(state.live.status, m.address)?.[0]?.spec;
    const services = itemsOf(state.live.services, m.address);
    const ext = itemsOf(state.live.extensions, m.address);
    const sec = itemsOf(state.live.security, m.address)?.[0]?.spec;
    const err = errorOf(m.address);
    const stage = status?.stage ?? "";
    const healthBar = services ? el(
      "div",
      { class: "svc-bar", title: services.map((s) => `${s.metadata.id}: ${serviceHealth(s.spec)}`).join("\n") },
      ...services.map((s) => el("span", { class: `seg h-${serviceHealth(s.spec)}` }))
    ) : null;
    const healthy = services?.filter((s) => serviceHealth(s.spec) === "healthy").length ?? 0;
    const card = el(
      "div",
      {
        class: `tile${m.name === state.selected ? " on" : ""}${err ? " unreachable" : ""}`,
        role: "button",
        tabindex: 0,
        "aria-pressed": m.name === state.selected ? "true" : "false"
      },
      el(
        "div",
        { class: "tile-top" },
        dot(err ? "error" : stage ? stageTone(stage) : m.ready ? "ok" : "error", stage || (m.ready ? "Ready" : "Not ready")),
        el("strong", { class: "grow ellipsis" }, m.name),
        versionBadge(m.talos)
      ),
      el("div", { class: "mono faint small" }, m.address || "no address", m.cordoned ? el("span", { class: "chip warn" }, "cordoned") : null),
      el(
        "div",
        { class: "tile-stage small" },
        err ? el("span", { class: "tone-error" }, err) : stage ? el("span", {}, stage, status?.status?.ready === false ? el("span", { class: "tone-warn" }, " · not ready") : null) : el("span", { class: "faint" }, state.conn?.ready ? "…" : m.ready ? "Ready in Kubernetes" : "NotReady in Kubernetes")
      ),
      healthBar,
      services ? el("div", { class: "faint small" }, `${healthy}/${services.length} services healthy`) : null,
      el(
        "div",
        { class: "tile-foot small" },
        sec?.secureBoot ? el("span", { class: "chip ok", title: "Secure Boot" }, "secure boot") : null,
        ext ? el("span", { class: "chip", title: realExtensions(ext).map((e) => e.spec.metadata?.name).join("\n") }, `${realExtensions(ext).length} ext`) : null,
        el("span", { class: "faint" }, [m.cpu && `${m.cpu} CPU`, m.memory].filter(Boolean).join(" · "))
      )
    );
    on(card, "click", () => select(m.name));
    on(card, "keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select(m.name);
      }
    });
    return card;
  }
  function select(name) {
    state.selected = state.selected === name ? "" : name;
    render();
  }
  var TABS = [
    ["overview", "Overview"],
    ["services", "Services"],
    ["logs", "Logs"],
    ["kernel", "Kernel"],
    ["network", "Network"],
    ["storage", "Storage"],
    ["etcd", "etcd"]
  ];
  function drawer(m) {
    const ready = !!state.conn?.ready;
    const tabs = TABS.filter(([t]) => t !== "etcd" || m.controlPlane);
    if (!tabs.some(([t]) => t === state.tab)) state.tab = "overview";
    return el(
      "aside",
      { class: "drawer card" },
      el(
        "div",
        { class: "drawer-head" },
        el(
          "div",
          { class: "grow" },
          el("h2", {}, m.name, " ", versionBadge(m.talos)),
          el("div", { class: "dim small mono" }, `${m.address} · ${m.controlPlane ? "control plane" : "worker"} · ${m.kernel}`)
        ),
        button("✕", () => select(m.name), { class: "icon-btn", title: "Close", "aria-label": "Close" })
      ),
      el(
        "div",
        { class: "drawer-actions" },
        ready ? button("Console", () => void console(state.conn, m).catch(showError), { class: "btn" }) : null,
        ready ? button("Dashboard ↗", () => void dashboard(state.conn, [m.address]).catch(showError), { class: "btn", title: "talosctl dashboard, in your own terminal" }) : null,
        button("Kubernetes node", () => void k8sdockside.open({ kind: "nodes", name: m.name }), { class: "btn ghost" }),
        el("span", { class: "grow" }),
        ready ? button("Reboot…", () => void reboot(m), { class: "btn danger-outline" }) : null,
        ready ? button("Shut down…", () => void shutdown(m), { class: "btn danger-outline" }) : null
      ),
      ready ? el(
        "nav",
        { class: "tabs", role: "tablist" },
        ...tabs.map(([t, label]) => button(label, () => {
          state.tab = t;
          render();
        }, { class: t === state.tab ? "tab on" : "tab", role: "tab", "aria-selected": t === state.tab ? "true" : "false" }))
      ) : null,
      el("div", { class: "drawer-body" }, ready ? body(m) : notConnected())
    );
  }
  function notConnected() {
    return el("p", { class: "dim" }, "Connect talosctl above to see this machine’s services, logs, hardware and storage, and to upgrade or reboot it.");
  }
  function body(m) {
    const key = `${m.name}/${state.tab}${state.tab === "logs" ? "/" + state.logService : ""}`;
    const kept = state.drawer.get(key);
    if (kept instanceof Promise) return loading();
    if (kept) return kept;
    const reading = readTab(m, state.tab).then(
      (content) => void state.drawer.set(key, content),
      (err) => void state.drawer.set(key, el("p", { class: "tone-error" }, message(err)))
    ).finally(() => {
      if (state.selected === m.name) render();
    });
    state.drawer.set(key, reading);
    return loading();
  }
  function loading() {
    return el("div", { class: "loading" }, el("span", { class: "pulse" }), " Asking the machine…");
  }
  function refreshTab(m) {
    return button("Read again", () => {
      for (const k of [...state.drawer.keys()]) if (k.startsWith(`${m.name}/${state.tab}`)) state.drawer.delete(k);
      render();
    }, { class: "link small" });
  }
  async function readTab(m, tab) {
    const conn = state.conn;
    switch (tab) {
      case "overview":
        return overview(m, conn);
      case "services":
        return servicesTab(m, conn);
      case "logs":
        return logsTab(m, conn);
      case "kernel": {
        const out = await text(conn, ["dmesg"], [m.address]);
        return pre(lastLines(stripNode(out, m.address), 400), refreshTab(m));
      }
      case "network":
        return networkTab(m, conn);
      case "storage":
        return storageTab(m, conn);
      case "etcd":
        return etcdTab(m, conn);
    }
  }
  function pre(content, ...extra) {
    return el("div", {}, el("div", { class: "tab-tools" }, ...extra), el("pre", { class: "out" }, content || "(nothing)"));
  }
  function stripNode(out, node) {
    const prefix = node + ": ";
    return out.split("\n").map((l) => l.startsWith(prefix) ? l.slice(prefix.length) : l).join("\n");
  }
  function lastLines(text2, n) {
    const lines = text2.split("\n");
    return lines.length > n ? lines.slice(-n).join("\n") : text2;
  }
  function kv(rows) {
    return el("dl", { class: "kv" }, ...rows.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v ?? "—")]));
  }
  async function overview(m, conn) {
    const [info, procs, mem, time] = await Promise.all([
      getOne(conn, "systeminformation", m.address).catch(() => []),
      getOne(conn, "processors", m.address).catch(() => []),
      getOne(conn, "memorymodules", m.address).catch(() => []),
      getOne(conn, "timestatus", m.address).catch(() => [])
    ]);
    const ext = itemsOf(state.live.extensions, m.address) ?? [];
    const sec = itemsOf(state.live.security, m.address)?.[0]?.spec;
    const status = itemsOf(state.live.status, m.address)?.[0]?.spec;
    const sys = info[0]?.spec ?? {};
    const cores = procs.reduce((n, p) => n + Number(p.spec.threadCount ?? p.spec.coreCount ?? 0), 0);
    const memMiB = mem.reduce((n, d) => n + (d.spec.sizeMiB ?? 0), 0);
    const schematic = schematicOf(ext);
    return el(
      "div",
      { class: "stack" },
      upgradePanel(m, schematic),
      status?.status?.unmetConditions?.length ? el("div", { class: "callout warn" }, el("strong", {}, "Not ready: "), status.status.unmetConditions.map((c) => `${c.name} (${c.reason})`).join(", ")) : null,
      el("h4", {}, "Machine"),
      kv([
        ["Stage", status?.stage ?? "—"],
        ["Hardware", [sys.manufacturer, sys.productName].filter(Boolean).join(" ") || "—"],
        ["CPU", cores ? `${cores} threads · ${procs.length} socket${procs.length === 1 ? "" : "s"}` : m.cpu],
        ["Memory", memMiB ? `${(memMiB / 1024).toFixed(1)} GiB` : m.memory],
        ["Time", time[0] ? time[0].spec.synced ? "synchronised" : "not synchronised" : "—"],
        ["Kubelet", m.kubelet]
      ]),
      el("h4", {}, "Security"),
      kv([
        ["Secure Boot", sec ? sec.secureBoot ? "on" : "off" : "—"],
        ["Module signatures", sec ? sec.moduleSignatureEnforced ? "enforced" : "not enforced" : "—"],
        ["SELinux", sec?.selinuxState ?? "—"]
      ]),
      el("h4", {}, `Extensions `, el("span", { class: "faint" }, String(realExtensions(ext).length))),
      realExtensions(ext).length ? el("ul", { class: "ext-list" }, ...realExtensions(ext).map((e) => el("li", { title: e.spec.metadata?.description ?? "" }, el("span", {}, e.spec.metadata?.name ?? "?"), el("span", { class: "faint mono small" }, e.spec.metadata?.version ?? "")))) : el("p", { class: "faint" }, "None."),
      schematic ? el("p", { class: "faint small mono", title: "Image Factory schematic" }, `schematic ${schematic.slice(0, 16)}…`) : null
    );
  }
  function upgradePanel(m, schematic) {
    const next = nextUpgrade(m.talos);
    const versions = RELEASES.map((r) => r.latest).filter((v) => !m.talos || parseVersion(v).raw !== m.talos.raw);
    const pick = el(
      "select",
      { "aria-label": "Talos version", "data-k8sdockside-keep": "off" },
      ...versions.map((v) => {
        const o = el("option", { value: v }, v + (v === next?.latest ? " (next step)" : v === LATEST_STABLE.latest ? " (latest)" : ""));
        o.selected = v === (next?.latest ?? LATEST_STABLE.latest);
        return o;
      })
    );
    const image = el("input", { type: "text", class: "mono grow", "aria-label": "Installer image", spellcheck: "false", "data-k8sdockside-keep": "off" });
    image.value = installerImage(pick.value, schematic);
    on(pick, "change", () => image.value = installerImage(pick.value, schematic));
    const s = standing(m.talos);
    return el(
      "div",
      { class: `upgrade card-inner v-${s}` },
      el(
        "div",
        { class: "upgrade-head" },
        el("strong", {}, next ? `Upgrade available: ${next.latest}` : s === "current" ? "On the latest stable" : STANDING_TEXT[s]),
        next && next !== LATEST_STABLE ? el("span", { class: "faint small" }, ` · then ${LATEST_STABLE.latest}`) : null
      ),
      el(
        "div",
        { class: "row" },
        pick,
        image,
        button("Upgrade…", () => void run(state.conn, ["upgrade", "--image", image.value.trim()], m, {
          title: `Upgrade ${m.name} to ${pick.value}`,
          danger: true,
          confirm: m.name
        }).catch(declined), { class: "btn primary" })
      ),
      el("p", { class: "faint small" }, schematic ? "The installer keeps this machine’s Image Factory schematic, and so its extensions. The machine drains, upgrades and reboots; watch it in the console." : "No Image Factory schematic: the stock installer is used. Change the image if this machine needs extensions.")
    );
  }
  async function servicesTab(m, conn) {
    const services = await getOne(conn, "services", m.address);
    return el(
      "div",
      {},
      el("div", { class: "tab-tools" }, refreshTab(m)),
      el(
        "table",
        { class: "grid" },
        el("thead", {}, el("tr", {}, el("th", {}, "Service"), el("th", {}, "State"), el("th", {}, ""))),
        el("tbody", {}, ...services.map((s) => {
          const id = String(s.metadata.id);
          const h = serviceHealth(s.spec);
          return el(
            "tr",
            {},
            el("td", { class: "mono" }, id),
            el("td", {}, dot(h === "healthy" ? "ok" : h === "running" ? "info" : h === "stopped" ? "error" : "warn"), " ", h),
            el(
              "td",
              { class: "right" },
              button("Logs", () => {
                state.logService = id;
                state.tab = "logs";
                render();
              }, { class: "link" }),
              button("Restart…", () => void run(conn, ["service", id, "restart"], m, { title: `Restart ${id} on ${m.name}` }).catch(declined), { class: "link" })
            )
          );
        }))
      )
    );
  }
  async function logsTab(m, conn) {
    const services = itemsOf(state.live.services, m.address)?.map((s) => String(s.metadata.id)) ?? ["kubelet"];
    const pick = el(
      "select",
      { "aria-label": "Service", "data-k8sdockside-keep": "off" },
      ...services.map((id) => {
        const o = el("option", { value: id }, id);
        o.selected = id === state.logService;
        return o;
      })
    );
    on(pick, "change", () => {
      state.logService = pick.value;
      render();
    });
    const out = await text(conn, ["logs", state.logService, "--tail", "300"], [m.address]);
    return pre(
      stripNode(out, m.address),
      pick,
      refreshTab(m),
      button("Follow in console", () => void console(conn, m).catch(showError), { class: "link small", title: `Then type: logs ${state.logService} -f` })
    );
  }
  async function networkTab(m, conn) {
    const [addresses, resolvers] = await Promise.all([
      getOne(conn, "addresses", m.address),
      getOne(conn, "resolvers", m.address).catch(() => [])
    ]);
    const shown = addresses.filter((a) => a.spec.scope === "global" && !/^(lo|cilium|lxc|flannel|cni|kube-ipvs|vxlan)/.test(a.spec.linkName));
    return el(
      "div",
      { class: "stack" },
      el("div", { class: "tab-tools" }, refreshTab(m)),
      el("h4", {}, "Addresses"),
      el(
        "table",
        { class: "grid" },
        el("thead", {}, el("tr", {}, el("th", {}, "Link"), el("th", {}, "Address"), el("th", {}, "Family"))),
        el("tbody", {}, ...shown.map((a) => el("tr", {}, el("td", { class: "mono" }, a.spec.linkName), el("td", { class: "mono" }, a.spec.address), el("td", {}, a.spec.family))))
      ),
      el("p", { class: "faint small" }, `${addresses.length - shown.length} more on loopback and CNI links.`),
      el("h4", {}, "DNS"),
      el("p", { class: "mono" }, resolvers.flatMap((r) => r.spec.dnsServers ?? []).join(", ") || "—")
    );
  }
  async function storageTab(m, conn) {
    const [disks, volumes] = await Promise.all([
      getOne(conn, "disks", m.address),
      getOne(conn, "volumestatus", m.address).catch(() => [])
    ]);
    const real = disks.filter((d) => !/\/(loop|ram|zram)\d/.test(d.spec.dev_path) && !d.spec.cdrom);
    const vols = volumes.filter((v) => v.spec.type !== "overlay");
    return el(
      "div",
      { class: "stack" },
      el("div", { class: "tab-tools" }, refreshTab(m)),
      el("h4", {}, "Disks"),
      el(
        "table",
        { class: "grid" },
        el("thead", {}, el("tr", {}, el("th", {}, "Device"), el("th", {}, "Size"), el("th", {}, "Model"), el("th", {}, "Bus"))),
        el("tbody", {}, ...real.map((d) => el("tr", {}, el("td", { class: "mono" }, d.spec.dev_path), el("td", {}, d.spec.pretty_size), el("td", {}, d.spec.model ?? ""), el("td", {}, d.spec.transport ?? ""))))
      ),
      el("h4", {}, "Volumes"),
      el(
        "table",
        { class: "grid" },
        el("thead", {}, el("tr", {}, el("th", {}, "Volume"), el("th", {}, "Phase"), el("th", {}, "Mounted at"))),
        el("tbody", {}, ...vols.map((v) => el(
          "tr",
          {},
          el("td", { class: "mono" }, String(v.metadata.id)),
          el("td", {}, dot(v.spec.phase === "ready" ? "ok" : "warn"), " ", v.spec.phase),
          el("td", { class: "mono" }, v.spec.mountSpec?.targetPath ?? "")
        )))
      )
    );
  }
  async function etcdTab(m, conn) {
    const [status, members] = await Promise.all([
      text(conn, ["etcd", "status"], [m.address]),
      text(conn, ["etcd", "members"], [m.address])
    ]);
    return el(
      "div",
      { class: "stack" },
      el(
        "div",
        { class: "tab-tools" },
        refreshTab(m),
        button("Defragment…", () => void run(conn, ["etcd", "defrag"], m, { title: `Defragment etcd on ${m.name}` }).catch(declined), { class: "link small" })
      ),
      el("h4", {}, "Status"),
      el("pre", { class: "out" }, status),
      el("h4", {}, "Members"),
      el("pre", { class: "out" }, members)
    );
  }
  function declined(err) {
    if (!/declined/.test(message(err))) showError(err);
  }
  async function reboot(m) {
    await run(state.conn, ["reboot"], m, { title: `Reboot ${m.name}`, danger: true, confirm: m.name }).catch(declined);
  }
  async function shutdown(m) {
    await run(state.conn, ["shutdown"], m, { title: `Shut down ${m.name}`, danger: true, confirm: m.name }).catch(declined);
  }
  function firstControlPlane() {
    return state.machines.find((m) => m.controlPlane && m.ready) ?? state.machines.find((m) => m.controlPlane);
  }
  async function healthCheck() {
    const cp = firstControlPlane();
    if (!cp || !state.conn) return;
    showModal("Cluster health", el("div", { class: "loading" }, el("span", { class: "pulse" }), ` Running talosctl health from ${cp.name}…`));
    try {
      const out = await k8sdockside.tools.exec("talosctl", ["health", "--wait-timeout", "25s", "--context", state.conn.context, "--nodes", cp.address]);
      showModal("Cluster health", el(
        "div",
        {},
        el("p", {}, dot(out.code === 0 ? "ok" : "error"), out.code === 0 ? " Every check passed." : " Some checks did not pass."),
        el("pre", { class: "out" }, (out.stdout + "\n" + out.stderr).trim())
      ));
    } catch (err) {
      showModal("Cluster health", el("p", { class: "tone-error" }, message(err)));
    }
  }
  function openK8sUpgrade() {
    const cp = firstControlPlane();
    if (!cp) return;
    const current = state.machines.find((m) => m.kubelet)?.kubelet ?? "";
    const input = el("input", { type: "text", class: "mono", placeholder: "e.g. 1.37.2", "aria-label": "Kubernetes version", "data-k8sdockside-keep": "off" });
    input.value = state.k8sTarget;
    showModal("Upgrade Kubernetes", el(
      "div",
      { class: "stack" },
      el("p", {}, `Now ${current}. talosctl upgrade-k8s upgrades the control plane, then every kubelet, from ${cp.name}. Check the version is supported by the Talos your machines run.`),
      el(
        "div",
        { class: "row" },
        input,
        button("Dry run…", () => void go(true), { class: "btn" }),
        button("Upgrade…", () => void go(false), { class: "btn primary" })
      )
    ));
    async function go(dry) {
      const to = input.value.trim().replace(/^v/, "");
      state.k8sTarget = to;
      if (!/^\d+\.\d+\.\d+$/.test(to)) return showError("Give a version like 1.37.2");
      closeModal();
      await run(state.conn, ["upgrade-k8s", "--to", to, ...dry ? ["--dry-run"] : []], cp, {
        title: `${dry ? "Plan" : "Run"} the Kubernetes upgrade to ${to}`,
        danger: !dry,
        confirm: dry ? void 0 : to
      }).catch(declined);
    }
  }
  function showModal(title, content) {
    closeModal();
    const box = el(
      "div",
      { class: "modal-scrim", id: "modal" },
      el(
        "div",
        { class: "modal card", role: "dialog", "aria-label": title },
        el("div", { class: "drawer-head" }, el("h2", { class: "grow" }, title), button("✕", closeModal, { class: "icon-btn", "aria-label": "Close" })),
        content
      )
    );
    on(box, "click", (e) => {
      if (e.target === box) closeModal();
    });
    document.body.append(box);
  }
  function closeModal() {
    document.getElementById("modal")?.remove();
  }
  start().catch(showError);
})();
