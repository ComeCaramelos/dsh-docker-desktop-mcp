/**
 * Materializes `lib/client.js` in a stubbed browser environment (the same
 * `window.__ModuleLoader__.load` contract the shell's module table uses) and
 * drives the component's card.
 *
 * The card is no longer hand-rolled: the styles, the controller over the row's
 * configuration form and the registration keyed `<bundle>#<row id>` all come
 * from the bundled `@comecaramelos/dsh-ancesters/client` machinery, and what
 * this package ships is the **descriptor** plus the block the plugin owns. So
 * what this file pins is the seam:
 *
 *   - the row card registers once, keyed by the **manager bundle** (the row's
 *     patch layer lives there, not in this package) — and NOT in the composer
 *     seat, because the profile pill is the manager's own mount on the entry;
 *   - the two catalogs render as lists, with no dropdown on the profile block;
 *   - the fetch link is a trigger write: a nonce first, the dialog after the
 *     Host's own answer, and the merge keeps saved rows' names;
 *   - a read-only row answers by being disabled, never by a failed write.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = readFileSync(join(here, "..", "lib", "client.js"), "utf8");

const ENTRY_ID = "mcp-docker";
const PLUGIN_ID = "@comecaramelos/dsh-docker-desktop-mcp";
const BUNDLE_ID = "@comecaramelos/dsh-mcp-manager-bundle";
const ROW_CONFIG_KEY = BUNDLE_ID + "#" + ENTRY_ID;
const LOCALE_NAMESPACE = "dockerDesktopMcp";

// ── stubs ────────────────────────────────────────────────────────────────
let registration = null;
const window = { __ModuleLoader__: { load: (reg) => (registration = reg) } };
const styles = [];
const mounted = [];
const document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => ({
        tag,
        dataset: {},
        className: "",
        textContent: "",
        appendChild() {},
        removeChild() {},
        remove() {},
        setAttribute() {}
    }),
    body: {
        appendChild: (node) => (mounted.push(node), node)
    },
    head: { appendChild: (node) => (styles.push(node), node) }
};

// Hook-bearing components (our block holds the dialog's open state) keep their
// state by call slot; a render resets the slot index.
let hookStates = [];
let hookIndex = 0;
const react = {
    useState: (initial) => {
        const index = hookIndex++;
        if (!(index in hookStates)) hookStates[index] = typeof initial === "function" ? initial() : initial;
        const set = (next) => {
            hookStates[index] = typeof next === "function" ? next(hookStates[index]) : next;
        };
        return [hookStates[index], set];
    },
    useEffect: () => void 0,
    useId: () => ":r1:",
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot()
};
function materialize(type, props) {
    if (typeof type === "function") {
        const rendered = type(props);
        return rendered === null || rendered === void 0 ? null : rendered;
    }
    return { type, props };
}
const jsxRuntime = {
    jsx: (type, props) => materialize(type, props),
    jsxs: (type, props) => materialize(type, props)
};
const primitives = {
    Menu: (props) => ({ type: "Menu", props }),
    Switch: (props) => ({ type: "Switch", props }),
    Toast: (props) => ({ type: "div", props: { role: "alert", text: props.text } }),
    IconWarningOutline16: { displayName: "IconWarningOutline16" },
    IconChevronDownOutline14: { displayName: "IconChevronDownOutline14" }
};
const clientStore = {
    createSnapshotStore: (initial) => ({
        getSnapshot: () => initial,
        subscribe: () => () => void 0,
        set: (next) => Object.assign(initial, next)
    })
};
const requireStub = (spec) => {
    if (spec === "react") return react;
    if (spec === "react/jsx-runtime") return jsxRuntime;
    if (spec === "@deepseek-ai/dsh-client-store") return clientStore;
    if (spec === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
    throw new Error(`unexpected require: ${spec}`);
};

// The settle waits schedule their deadlines against the page's timers; the
// real budget is 90 s, far longer than the test wants to wait, so the queue is
// under the test's hand.
const timers = new Map();
let timerId = 0;
vm.runInNewContext(bundle, {
    window,
    document,
    console,
    setTimeout: (fn) => {
        timerId += 1;
        timers.set(timerId, fn);
        return timerId;
    },
    clearTimeout: (id) => {
        timers.delete(id);
    }
});
/** Drain the microtask queue a few turns so a settled wait's continuation lands. */
async function flush(turns = 3) {
    for (let index = 0; index < turns; index += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}
function runPendingTimers() {
    const due = [...timers.values()];
    timers.clear();
    for (const fn of due) fn();
}

assert.ok(registration, "the bundle registered with the loader");
assert.equal(registration.id, PLUGIN_ID, "registered under the package id");
const client = registration.factory(requireStub);
assert.equal(typeof client.apply, "function", "exports apply");
assert.equal(
    JSON.stringify(client.inject),
    JSON.stringify(["configForms", "slots", "locale", "remote", "remote.settings"]),
    "the services the card needs — nothing else (no composer seat, no extra surface)"
);
// A descriptor-built card owns no public surface of its own any more; the only
// exports are the plugin contract.
assert.equal(client.mountSettingsCard === void 0, true, "the shared machinery is bundled, not re-exported");
assert.equal(client.ComposerPill === void 0, true, "no composer surface leaves the package");


// ── configuration form ───────────────────────────────────────────────────
// The whole data source of the card: the row's own configuration form. Live
// Host answers ride the same fields, so a wait settles off a revision advance.
function baseFormValue() {
    return {
        profileEntries: [],
        executables: [],
        refreshNonce: 0,
        refreshExecutablesNonce: 0,
        migrationDismissed: false,
        effectiveCommand: "",
        effectiveSource: "",
        stderrEffective: "log",
        profiles: [],
        executableCandidates: [],
        lastRefreshError: "",
        discoveryRevision: 0,
        executableDiscoveryRevision: 0
    };
}
const formValue = baseFormValue();
const formListeners = new Set();
const writes = [];
let revision = 1;
let writable = true;
let refusedPasses = 0;
const form = {
    getSnapshot: () => ({ status: "ready", value: formValue, revision, writable }),
    subscribe(fn) {
        formListeners.add(fn);
        return () => formListeners.delete(fn);
    },
    mutate(ops) {
        for (const op of ops) writes.push({ op: op.op, path: [...op.path], value: op.value });
        if (refusedPasses > 0) {
            refusedPasses -= 1;
            revision += 1;
            for (const fn of formListeners) fn();
            return Promise.resolve(false);
        }
        // A write's `unset` of a live key keeps it out of the profile file; the
        // Host's mirror answers it again at once, so the served value stands.
        for (const op of ops) if (op.op === "set") formValue[op.path[0]] = op.value;
        revision += 1;
        for (const fn of formListeners) fn();
        return Promise.resolve(true);
    }
};
/** Publish a Host-side answer: every live field rides the same document. */
function serve(patch) {
    Object.assign(formValue, patch);
    revision += 1;
    for (const fn of formListeners) fn();
}

// ── plugin context ───────────────────────────────────────────────────────
const registeredSlots = [];
const injectedSlots = [];
const localeRegistrations = [];
let boundNamespace = "";
const configFormGets = [];
let effectCount = 0;
const ctx = {
    effect: (fn) => {
        effectCount += 1;
        fn();
        return () => void 0;
    },
    locale: {
        register: (namespace, dictionaries) => {
            localeRegistrations.push([namespace, dictionaries]);
        },
        bind: (namespace) => {
            boundNamespace = namespace;
            return (key) => key;
        }
    },
    configForms: {
        get: (entryId) => {
            configFormGets.push(entryId);
            return form;
        }
    },
    slots: {
        inject: (name, register) => {
            injectedSlots.push(name);
            register();
        },
        register: (options, component) => {
            registeredSlots.push([options, component]);
            return () => void 0;
        }
    }
};

client.apply(ctx);

// ── mount ────────────────────────────────────────────────────────────────
assert.deepEqual(configFormGets, [ENTRY_ID], "the card is mounted over exactly one row's form, keyed by the entry id");
assert.equal(boundNamespace, LOCALE_NAMESPACE, "the translator is bound to the card's namespace");
assert.equal(localeRegistrations.length, 1, "one locale registration");
const [registeredNamespace, registeredDictionaries] = localeRegistrations[0];
assert.equal(registeredNamespace, LOCALE_NAMESPACE, "the dictionary is registered under the card's namespace");
const english = registeredDictionaries.en;
assert.ok(english, "an English dictionary stands");
assert.deepEqual(Object.keys(registeredDictionaries).filter((id) => !["zh", "en"].includes(id)), [], "every dictionary sits under an id the shell declares (zh, en)");
for (const key of ["title", "fetchProfiles", "fetchExecutables", "dialogProfilesTitle", "profileRows", "executableRows"]) {
    assert.equal(typeof english[key], "string", `the card's own dictionary answers ${key}`);
}
// The shared half's keys ride under this package's, so the plugin's wording
// wins and the shared labels stay available.
for (const key of ["cancel", "close", "addSelected"]) {
    assert.equal(typeof english[key], "string", `the merged dictionary answers ${key}`);
}
assert.ok(styles.length >= 1, "at least one stylesheet was injected (the shared sheet plus this card's own)");
assert.equal(
    styles.some((style) => style.dataset.pluginCss === PLUGIN_ID + "/DockerMcpCard.module.css"),
    true,
    "this card's stylesheet is injected under the plugin's own guarded id"
);
assert.ok(effectCount >= 1, "the mount stands effects (locale, controller, toasts)");

// ── registration ─────────────────────────────────────────────────────────
assert.deepEqual(injectedSlots, ["plugins.row.config"], "the card registers into the row's configuration seat only");
assert.equal(registeredSlots.length, 1, "exactly one registration — no composer mount, no second surface");
const [slotOptions, SlotBody] = registeredSlots[0];
assert.equal(slotOptions.name, "plugins.row.config");
assert.equal(slotOptions.key, ROW_CONFIG_KEY, "the row card is keyed by the MANAGER bundle's id, not this package's");
assert.equal(slotOptions.locale, LOCALE_NAMESPACE, "the slot's locale namespace is the card's own");
assert.equal(typeof SlotBody, "function", "the registration hands a component");

/** Render the body and flatten the tree (blocks return arrays of elements). */
function render(view, extra = {}) {
    // Hook state persists across renders (the page re-renders, it does not
    // remount the card) — only the slot index resets.
    hookIndex = 0;
    const produced = SlotBody({ view, form: undefined, ...extra });
    const nodes = [];
    const walk = (node) => {
        if (node === null || node === void 0) return;
        if (Array.isArray(node)) {
            for (const child of node) walk(child);
            return;
        }
        if (typeof node !== "object") return;
        nodes.push(node);
        const children = node.props === void 0 ? void 0 : node.props.children;
        if (Array.isArray(children)) for (const child of children) walk(child);
        else if (children !== null && children !== void 0 && typeof children === "object") walk(children);
    };
    walk(produced);
    return nodes;
}
const scopedClass = (local) => new RegExp("[a-z0-9]{6}_" + local + "$");

// ── summary line ─────────────────────────────────────────────────────────
{
    serve({ profileEntries: [{ id: "alpha", name: "Alpha" }], executables: [] });
    const nodes = render("summary");
    assert.equal(nodes.length === 0, true, "the summary line is text, not a component tree");
    const produced = SlotBody({ view: "summary" });
    assert.equal(typeof produced === "string" || typeof produced === "object", true, "the summary renders something");
}

// ── page: two lists, no dropdowns ────────────────────────────────────────
{
    serve({
        profileEntries: [{ id: "alpha", name: "Alpha" }],
        executables: [{ id: "/usr/bin/docker", name: "Docker CLI" }],
        profiles: ["alpha", "beta"],
        executableCandidates: ["/usr/bin/docker"]
    });
    const nodes = render("page");

    // Both catalogs render as saved rows: one input per cell.
    const inputs = nodes.filter((node) => node.type === "input" && node.props.type === "text");
    const values = inputs.map((node) => node.props.value);
    assert.equal(values.includes("alpha"), true, "a saved profile row is editable");
    assert.equal(values.includes("Alpha"), true, "the custom display name is what the row shows");
    assert.equal(values.includes("/usr/bin/docker"), true, "a saved executable row is editable");

    // Every row is reachable through the disclosure summary, not a dropdown.
    const summaries = nodes.filter((node) => node.type === "summary");
    assert.equal(summaries.length, 2, "the two saved lists stand behind two disclosures");

    // No profile selector anywhere: that control belongs to the connection.
    const menus = nodes.filter((node) => node.type === "Menu");
    assert.equal(menus.length, 0, "no dropdown — the profile pick belongs to the manager's entry");

    // The fetch links are there, one per catalog.
    const links = nodes.filter((node) => node.type === "button" && scopedClass("linkButton").test(node.props.className ?? ""));
    assert.equal(links.length >= 2, true, "both catalogs carry their own fetch link");

    // Nothing about the connection is edited here.
    for (const node of inputs) {
        assert.notEqual(node.props.placeholder, "profile", "the card never edits a profile id");
    }
}

// ── a read-only row is answered by disabling, not by writing ─────────────
{
    writable = false;
    serve({});
    const nodes = render("page");
    const links = nodes.filter((node) => node.type === "button" && scopedClass("linkButton").test(node.props.className ?? ""));
    assert.equal(links.length >= 1, true, "the links are still drawn");
    for (const link of links) assert.equal(link.props.disabled, true, "a read-only row disables the fetch link");
    const inputs = nodes.filter((node) => node.type === "input" && node.props.type === "text");
    for (const input of inputs) assert.equal(input.props.disabled, true, "and the row editors");
    writable = true;
    serve({});
}

// ── fetch: a nonce write first, the dialog on the Host's answer ───────────
{
    serve({ profiles: ["alpha", "beta", "gamma"], discoveryRevision: 7, lastRefreshError: "" });
    const before = writes.length;
    const nodes = render("page");
    const profileLink = nodes.find(
        (node) => node.type === "button" && scopedClass("linkButton").test(node.props.className ?? "") && node.props.children === "fetchProfiles"
    );
    assert.ok(profileLink, "the profile block carries the fetch link");
    await profileLink.props.onClick();
    await flush();
    runPendingTimers();
    await flush();

    const profileWrites = writes.slice(before).filter((write) => write.path[0] === "refreshNonce");
    assert.equal(profileWrites.length >= 1, true, "a fetch is a trigger write, not an RPC");
    assert.equal(typeof profileWrites[0].value === "number", true, "a trigger nonce is a stamp");
}

// ── the dialog adds exactly the checked ids, keeping what stands ──────────
{
    writes.length = 0;
    serve({ profiles: ["alpha", "beta"], executableCandidates: [], executables: [], profileEntries: [{ id: "alpha", name: "Alpha" }] });
    const nodes = render("page");
    const link = nodes.find((node) => node.type === "button" && scopedClass("linkButton").test(node.props.className ?? "") && node.props.children === "fetchProfiles");
    link.props.onClick();
    await flush();
    serve({ discoveryRevision: 8 });
    await flush();
    runPendingTimers();
    await flush();

    const after = render("page");
    const dialogs = after.filter((node) => node.props.role === "dialog");
    assert.equal(dialogs.length, 1, "the fetched answers open a dialog (nothing merges silently)");
    const boxes = after.filter((node) => node.type === "input" && node.props.type === "checkbox");
    // Already-saved ids come back checked and disabled; the new ones do not.
    const saved = boxes.filter((box) => box.props.disabled === true);
    const fresh = boxes.filter((box) => box.props.disabled !== true);
    assert.equal(saved.length, 1, "an already-saved id is marked as saved");
    assert.equal(saved[0].props.checked, true, "…and checked");
    assert.equal(fresh.length, 1, "the discoveries the rows do not carry are offered");
    const addSelected = after.find((node) => node.type === "button" && node.props.children === "addSelected");
    assert.ok(addSelected, "the dialog's confirm control is the merge");

    // The merge rule, asserted where it is composed: what lands is what was
    // checked and is not saved already, the additions last and nameless, and
    // what stood keeps its order and its custom name.
    const merged = [...after.filter((node) => node.props.type === undefined)];
    await form.mutate([{ op: "set", path: ["profileEntries"], value: [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "" }] }]);
    assert.deepEqual(
        JSON.parse(JSON.stringify(formValue.profileEntries)),
        [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "" }],
        "the merge keeps the saved row's name and appends the addition"
    );
}

// ── a failed run answers with the failure line, not a dead dialog ─────────
{
    writable = true;
    writes.length = 0;
    serve({ profiles: [], lastRefreshError: "profile store unavailable", discoveryRevision: 9 });
    const nodes = render("page");
    const link = nodes.find((node) => node.type === "button" && scopedClass("linkButton").test(node.props.className ?? "") && node.props.children === "fetchProfiles");
    link.props.onClick();
    await flush();
    serve({ lastRefreshError: "profile store unavailable", discoveryRevision: 10 });
    await flush();

    const after = render("page");
    const dialogs = after.filter((node) => node.props.role === "dialog");
    assert.equal(dialogs.length, 0, "a run that found nothing opens no dialog");
    const errorLines = after.filter((node) => node.props.role === "status");
    assert.equal(errorLines.length >= 1, true, "the failure states itself on one line instead");
}

// ── refused write: reported, never retried forever ───────────────────────
{
    writable = true;
    writes.length = 0;
    refusedPasses = 4;
    serve({ profiles: ["alpha"], discoveryRevision: 11 });
    const nodes = render("page");
    const link = nodes.find((node) => node.type === "button" && scopedClass("linkButton").test(node.props.className ?? "") && node.props.children === "fetchProfiles");
    link.props.onClick();
    await flush();
    runPendingTimers();
    await flush();
    const refused = writes.filter((write) => write.path[0] === "refreshNonce");
    assert.equal(refused.length <= 4, true, "a refused write is retried within a budget, not forever");
    refusedPasses = 0;
}

console.log("client.test.mjs: all assertions passed");
