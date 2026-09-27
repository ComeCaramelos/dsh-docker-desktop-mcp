// Materializes lib/client.js in a stubbed browser environment (the same
// window.__ModuleLoader__.load contract the shell's module system uses) and
// exercises the card: registration, snapshot projection, the two named
// pickers, their catalogs, and the render tree.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = readFileSync(join(here, "..", "lib", "client.js"), "utf8");

// ── stubs ────────────────────────────────────────────────────────────────
let registration = null;
const window = { __ModuleLoader__: { load: (reg) => (registration = reg) } };
const styles = [];
const mountedContainers = [];
const document = {
    querySelector: () => null,
    createElement: (tag) => ({
        tag,
        dataset: {},
        textContent: "",
        hidden: false,
        remove() {},
        setAttribute() {}
    }),
    body: {
        children: [],
        appendChild: (el) => (document.body.children.push(el), mountedContainers.push(el))
    },
    head: { appendChild: (el) => styles.push(el) }
};
// Stateful useState: the card keeps `open` across re-renders, so the stub
// must persist hook values by call slot. Renders reset the slot index.
let hookStates = [];
let hookIndex = 0;
let lastHookCount = null;
let lastHookShape = null;
// Tracks whether the card is expanded: the hook list changes shape between the
// collapsed and expanded trees, so hook-count stability is only checked
// within one shape.
let openStateRef = false;
const react = {
    // The toast host subscribes to the store through the standard hook — in
    // this harness the render is manual, so reading the snapshot is enough.
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
    createElement: (type, props) => ({ type, props }),
    useId: () => ":r1:",
    useState: (init) => {
        const i = hookIndex++;
        if (!(i in hookStates)) hookStates[i] = typeof init === "function" ? init() : init;
        const set = (next) => {
            hookStates[i] = typeof next === "function" ? next(hookStates[i]) : next;
        };
        return [hookStates[i], set];
    },
    useEffect: () => {}
};
function materialize(type, props, key, kind) {
    const node = { kind, type, props, key, children: props?.children };
    // React calls function components; the stub must too, or the
    // primitives.Menu subtree (anchor + items) would never materialize.
    if (typeof type === "function") {
        const rendered = type(props);
        if (rendered === null || rendered === void 0) {
            node.type = undefined;
            node.props = undefined;
            node.children = undefined;
        } else {
            node.type = rendered.type;
            node.props = rendered.props;
            node.children = rendered.children;
        }
    }
    return node;
}
const jsxRuntime = {
    jsx: (type, props, key) => materialize(type, props, key, "jsx"),
    jsxs: (type, props, key) => materialize(type, props, key, "jsxs")
};
// Menu primitive stub: renders the anchor, and while open the items as
// menuitem buttons (the real primitive portals a positioned role=menu list).
const primitives = {
    // Minimal toast stand-in: no hooks/portals, but keeps the element findable
    // by its role and text so the failure-toast render path is assertable.
    Toast: (props) => ({
        kind: "jsx",
        type: "div",
        props: {
            role: "alert",
            "data-toast-text": props.text,
            onDone: props.onDone
        },
        children: undefined
    }),
    IconWarningOutline16: { displayName: "IconWarningOutline16" },
    IconChevronDownOutline14: { displayName: "IconChevronDownOutline14" },
    Menu: (props) => ({
        kind: "jsx",
        type: "Menu",
        props,
        children: [
            props.anchor,
            ...(props.open
                ? [props.items.map((item) => ({
                        kind: "jsx",
                        type: "button",
                        props: {
                            "data-menu-item": item.id,
                            "aria-current": item.id === props.selectedId ? "true" : undefined,
                            onClick: () => props.onSelect(item.id)
                        }
                    }))]
                : [])
        ]
    }),
    // Switch primitive stub: a findable typed node carrying its raw props so
    // the toggle state and the onChange wiring are assertable.
    Switch: (props) => ({
        kind: "jsx",
        type: "Switch",
        props,
        children: undefined
    })
};

const emptySnapshot = () => ({
    available: false,
    writable: false,
    profile: "",
    command: "",
    effectiveCommand: "",
    stderrMode: "",
    rowStderr: "log",
    profileEntries: [],
    executables: [],
    profiles: [],
    executableCandidates: [],
    lastRefreshError: "",
    discoveryRevision: 0,
    executableDiscoveryRevision: 0,
    actionError: "",
    notice: null
});
const storeState = Object.assign({}, emptySnapshot());
const listeners = new Set();
const clientStore = {
    createSnapshotStore: (initial) => ({
        getSnapshot: () => storeState,
        subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
        set: (next) => Object.assign(storeState, next)
    })
};
const toastRoots = [];
const reactDomClient = {
    createRoot: (container) => {
        const root = {
            container,
            element: null,
            renderCount: 0,
            unmountCount: 0,
            render(element) {
                root.element = element;
                root.renderCount += 1;
            },
            unmount() {
                root.unmountCount += 1;
            }
        };
        toastRoots.push(root);
        return root;
    }
};
const requireStub = (spec) => {
    if (spec === "react") return react;
    if (spec === "react/jsx-runtime") return jsxRuntime;
    if (spec === "@deepseek-ai/dsh-client-store") return clientStore;
    if (spec === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
    if (spec === "react-dom/client") return reactDomClient;
    throw new Error(`unexpected require: ${spec}`);
};

// ── materialize ──────────────────────────────────────────────────────────
// setTimeout/clearTimeout stand in for the browser globals the refresh poll
// schedules against (the real bundle runs in a page). The poll's 15 s cadence
// makes real waiting impractical in a unit test, so these route through a
// controllable queue the test flushes on demand.
const sandboxTimers = new Map();
let sandboxTimerId = 0;
const sandboxSetTimeout = (fn, _delay) => {
    sandboxTimerId += 1;
    sandboxTimers.set(sandboxTimerId, fn);
    return sandboxTimerId;
};
const sandboxClearTimeout = (id) => {
    sandboxTimers.delete(id);
};
/** Run every currently-armed timer callback exactly once (drains the queue). */
function runPendingTimers() {
    const due = [...sandboxTimers.values()];
    sandboxTimers.clear();
    for (const fn of due) fn();
}
vm.runInNewContext(bundle, {
    window,
    document,
    require: undefined,
    console,
    setTimeout: sandboxSetTimeout,
    clearTimeout: sandboxClearTimeout
});
assert.ok(registration, "bundle registered with __ModuleLoader__");
assert.equal(registration.id, "@comecaramelos/dsh-docker-desktop-mcp");
const factoryResult = registration.factory(requireStub);
assert.equal(typeof factoryResult.apply, "function", "exports.apply");
assert.equal(JSON.stringify(factoryResult.inject), JSON.stringify(["slots", "locale", "settingsScope"]), "exports.inject");
assert.equal(factoryResult.DISCOVERY_POLL_MAX_TICKS, 5, "discovery poll attempt cap (no infinite retry loop)");
assert.equal(factoryResult.DISCOVERY_POLL_TICK_MS, 15000, "poll tick cadence exported");
assert.ok(factoryResult.DISCOVERY_POLL_MAX_TICKS * factoryResult.DISCOVERY_POLL_TICK_MS >= factoryResult.DISCOVERY_POLL_TIMEOUT_MS, "attempt cap covers the wall-clock budget");
// (the guarded `<style>` tag is injected by apply() — asserted after the
// mount call below, where a re-materialized bundle is a no-op)

// ── settings scope stub ──────────────────────────────────────────────────
const scopeSnapshot = {
    status: "ready",
    value: {
        profile: "alpha",
        command: "",
        effectiveCommand: "/usr/bin/docker",
        stderrMode: "",
        rowStderr: "log",
        profileEntries: [
            { id: "alpha", name: "Alpha" },
            { id: "beta", name: "" }
        ],
        executables: [{ id: "/usr/bin/docker", name: "Local docker" }],
        profiles: ["alpha", "beta"],
        executableCandidates: ["/usr/bin/docker", "/usr/local/bin/docker"],
        refreshNonce: 0,
        refreshExecutablesNonce: 0,
        lastRefreshError: "",
        discoveryRevision: 0,
        executableDiscoveryRevision: 0
    },
    writable: true,
    revision: 1
};
const writes = [];
let rejectNextProfileWrite = false;
const scope = {
    getSnapshot: () => scopeSnapshot,
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    set: (field, value) => {
        if (field === "profile" && rejectNextProfileWrite) {
            rejectNextProfileWrite = false;
            return Promise.reject(new Error("write rejected by host"));
        }
        writes.push([field, value]);
        scopeSnapshot.value = { ...scopeSnapshot.value, [field]: value };
        listeners.forEach((fn) => fn());
        return Promise.resolve();
    }
};
// Shared describe-mirror stub: the refresh actions re-read it while the
// host's in-memory discovery state is en route. Bumping the served revision
// settles a poll.
const mirror = {
    loadCalls: 0,
    load: () => {
        mirror.loadCalls += 1;
        return Promise.resolve();
    }
};

// ── cordis client ctx stub ───────────────────────────────────────────────
const registeredSlotEntries = [];
const requiredLocaleKeys = [
    "addExecutable",
    "addProfile",
    "collapse",
    "description",
    "empty",
    "executableEmpty",
    "executableHint",
    "executableIdLabel",
    "executableIdPlaceholder",
    "executableLabel",
    "executableNameLabel",
    "executableRows",
    "expand",
    "addSelected",
    "cancel",
    "composerAria",
    "composerTitle",
    "candidateSaved",
    "close",
    "dialogEmpty",
    "dialogExecutablesDescription",
    "dialogExecutablesTitle",
    "dialogProfilesDescription",
    "dialogProfilesTitle",
    "fetchExecutables",
    "fetchProfiles",
    "fetching",
    "hint",
    "namePlaceholder",
    "profileIdLabel",
    "profileIdPlaceholder",
    "profileLabel",
    "profileNamePlaceholder",
    "profileRows",
    "readOnly",
    "reduceHint",
    "reduceTitle",
    "reduceLabel",
    "removeExecutable",
    "removeProfile",
    "searchExecutables",
    "searchProfiles",
    "selectAll",
    "statusError",
    "statusMissing",
    "statusUnreachable",
    "title"
];
const ctx = {
    effect: (fn) => {
        const disposer = fn();
        return { dispose: () => disposer?.dispose?.() ?? disposer?.() };
    },
    locale: {
        register: (ns, dicts) => {
            assert.equal(ns, "dockerDesktopMcp");
            assert.ok(dicts.en);
            const enKeys = Object.keys(dicts.en).sort();
            assert.equal(JSON.stringify(enKeys), JSON.stringify(requiredLocaleKeys.slice().sort()), "en key set");
            for (const key of requiredLocaleKeys) assert.ok(key in dicts.en, "en has key: " + key);
        },
        bind: () => (key) => key
    },
    settingsScope: {
        bind: (spec) => (assert.equal(spec.namespace, "docker-desktop-mcp"), scope),
        describe: () => mirror
    },
    slots: {
        inject: (slot, registerFn) => {
            assert.ok(slot === "settings.plugin.item" || slot === "conversation.input.left", "unexpected slot: " + slot);
            registerFn(); // factory calls ctx.slots.register below
        },
        register: (options, Component) => {
            registeredSlotEntries.push([options, Component]);
            return () => {}; // disposer
        }
    }
};

factoryResult.apply(ctx);
assert.equal(styles.length, 1, "one style tag injected by apply()");
assert.ok(styles[0].dataset.pluginCss === "@comecaramelos/dsh-docker-desktop-mcp/DockerMcpCard.module.css", "stylesheet injected under its guarded id");
assert.equal(registeredSlotEntries.length, 2, "the settings card plus the composer pill");
const settingsEntry = registeredSlotEntries.find(([entryOptions]) => entryOptions.name === "settings.plugin.item");
const composerEntry = registeredSlotEntries.find(([entryOptions]) => entryOptions.name === "conversation.input.left");
assert.ok(settingsEntry, "a settings.plugin.item entry");
assert.ok(composerEntry, "a conversation.input.left entry");
const [options, Component] = settingsEntry;
assert.equal(options.name, "settings.plugin.item");
assert.equal(options.key, "docker-desktop-mcp");
assert.equal(options.locale, "dockerDesktopMcp");
assert.equal(typeof Component, "function");
const face = options.inject();
assert.equal(typeof face.selectProfile, "function", "exposes the profile picker");
assert.equal(typeof face.selectExecutable, "function", "exposes the executable picker");
assert.equal(typeof face.saveProfileEntries, "function", "exposes the profile catalog writer");
assert.equal(typeof face.saveExecutables, "function", "exposes the executable catalog writer");
assert.equal(typeof face.refreshProfiles, "function", "exposes the profile refresh");
assert.equal(typeof face.refreshExecutables, "function", "exposes the executable refresh");
assert.equal(typeof face.addDetected, "function", "exposes the fetch dialog's Add-selected action");

// ── B.0: boot mirror poll (regression) ─────────────────────────────────
// The host runs profile discovery when it registers the settings section,
// usually while this card is still mounting, and that base-layer bump never
// travels on the wire. A freshly mounted card must therefore re-read the
// shared describe mirror on its own — without it the card reads "Profile not
// found" until the user clicks Refresh.
{
    const bootLoads = mirror.loadCalls;
    runPendingTimers();
    await Promise.resolve();
    assert.ok(mirror.loadCalls > bootLoads, "mount schedules a silent mirror poll (no refresh click)");
    // The store is still unavailable, so the boot poll runs to its attempt
    // cap and stages a stall notice. Drain both.
    for (let i = 0; i < 10; i++) runPendingTimers();
    await Promise.resolve();
    Object.assign(storeState, emptySnapshot(), { notice: null });
    sandboxTimers.clear();
}

// ── render helpers ────────────────────────────────────────────────────────
function render(state) {
    hookIndex = 0;
    var hookCount = 0;
    var _useState = react.useState;
    var _useEffect = react.useEffect;
    var _useId = react.useId;
    react.useState = function (init) { ++hookCount; return _useState.call(this, init); };
    react.useEffect = function () { ++hookCount; return _useEffect.call(this); };
    react.useId = function () { ++hookCount; return _useId.call(this); };
    var result = Component({
        t: (k) => k,
        useDockerMcpCard: (sel) => sel(state),
        selectProfile: (v) => scope.set("profile", v),
        selectExecutable: (v) => scope.set("command", v),
        saveProfileEntries: (entries) => scope.set("profileEntries", entries),
        saveExecutables: (entries) => scope.set("executables", entries),
        toggleStderr: () => face.toggleStderr(),
        refreshProfiles: () => face.refreshProfiles(),
        refreshExecutables: () => face.refreshExecutables(),
        addDetected: (kind, ids) => face.addDetected(kind, ids),
        clearNotice: (seq) => face.clearNotice(seq)
    });
    react.useState = _useState;
    react.useEffect = _useEffect;
    react.useId = _useId;
    // A dialog mounted over the expanded tree adds its own filter/selection
    // hooks, so the shape is "expanded+dialog" then — the stability check is
    // armed only for renders with the same subtree present.
    var hookShape =
        state.available !== true ? "collapsed"
            : openStateRef === true && walk(result).some((n) => n.props && n.props.role === "dialog")
              ? "expanded+dialog"
              : openStateRef === true ? "expanded"
              : "collapsed";
    // Hook count is stable WITHIN a given open/closed shape: the collapsed
    // card runs its own hooks only, while the expanded one also mounts the
    // two CatalogPickers. A jump between the two shapes is expected, so the
    // stability check is armed only for same-shape re-renders.
    if (lastHookShape === hookShape) assert.equal(hookCount, lastHookCount, "hook count stable across like-for-like renders");
    lastHookCount = hookCount;
    lastHookShape = hookShape;
    return result;
}
function walk(node, found = []) {
    if (node === null || node === undefined || typeof node !== "object") return found;
    if (Array.isArray(node)) {
        node.forEach((child) => walk(child, found));
        return found;
    }
    if (node.type !== undefined) {
        found.push(node);
        const children = node.children ?? (node.props ? node.props.children : undefined);
        if (children !== undefined) walk(children, found);
    }
    return found;
}
// Class names are scoped by the CSS-modules build step (`<hash>_<local>`),
// so every literal below names the source local and matches its scoped form,
// never the bare literal. The per-name boundary avoids prefix collisions (a
// `dot` matcher never fires on `dotError`).
const scopedClass = (local) => new RegExp("(?:^|\\s)[a-z0-9]{6}_" + local + "(?:\\s|$)");
const isNode = (type, classNames) => (n) => {
    if (n.type !== type) return false;
    const className = String(n.props?.className ?? "");
    return String(classNames).split(" ").every((local) => scopedClass(local).test(className));
};
function findDot(t) {
    return walk(t).find((n) => n.type === "span" && scopedClass("dot").test(String(n.props?.className ?? "")));
}
// Presence + the dot's own semantics: the dot is always red when it shows, the
// aria-label says whether it reports an error or a profile that is not there.
function dotState(dot) {
    if (!dot) return "hidden";
    return String(dot.props["aria-label"]);
}
/** Menu nodes in card order — only the executable picker renders one. */
function menus(t) {
    return walk(t).filter((n) => n.type === "Menu");
}
/** The last write of `field` in `writes`. */
const lastWrite = (field) => writes.filter(([f]) => f === field).pop();
/** Keep the stub scope and the served store aligned: every write re-publishes
 * the scope value, so anything the test wants served has to live on the value
 * too (a bare storeState write is what an already-published host push looks
 * like; this mirrors a fresh host push in both places). */
function sync(patch) {
    scopeSnapshot.value = { ...scopeSnapshot.value, ...patch };
    Object.assign(storeState, patch);
}
/** Drain the microtask chain a fetch wait runs through. */
async function flushPoll() {
    for (let i = 0; i < 12; i++) await Promise.resolve();
}

// ── render 1: unavailable ────────────────────────────────────────────────
Object.assign(storeState, emptySnapshot());
let tree = render(storeState);
assert.equal(tree, null, "renders nothing while namespace is unavailable");

// ── render 2: available, collapsed by default ─────────────────────────────
Object.assign(storeState, emptySnapshot(), {
    available: true,
    writable: true,
    profile: "alpha",
    profileEntries: [
        { id: "alpha", name: "Alpha" },
        { id: "beta", name: "" }
    ],
    executables: [{ id: "/usr/bin/docker", name: "Local docker" }],
    effectiveCommand: "/usr/bin/docker",
    profiles: ["alpha", "beta"]
});
tree = render(storeState);
assert.ok(tree && tree.type === "li", "card root is an li");
assert.match(tree.props.className, /^[a-z0-9]{6}_card$/, "only the scoped card class while collapsed");
const header = walk(tree).find(isNode("button", "header"));
assert.ok(header, "header disclosure button rendered");
assert.equal(header.props["aria-expanded"], false, "card collapsed by default");
assert.equal(walk(tree).find(isNode("div", "body")), undefined, "body div absent while collapsed");
assert.equal(findDot(tree), undefined, "no status dot while healthy");

// ── expand via the header button ──────────────────────────────────────────
openStateRef = true;
header.props.onClick();
tree = render(storeState);
assert.ok(scopedClass("cardOpen").test(String(tree.props.className)), "cardOpen class while expanded");
assert.equal(walk(tree).find(isNode("button", "header")).props["aria-expanded"], true, "aria-expanded flips open");
const bodyNodes = walk(tree);
const menuNodes = menus(tree);
assert.equal(
    menuNodes.length,
    1,
    "one Menu anchor: only the executable picker — the profile selector now lives in the composer"
);
// The executable dropdown is fed by the saved rows: custom name when set, id
// otherwise; the running executable is always an option.
assert.equal(
    JSON.stringify(menuNodes[0].props.items),
    JSON.stringify([{ id: "/usr/bin/docker", label: "Local docker" }]),
    "the executable dropdown labels rows by their custom name"
);
assert.equal(menuNodes[0].props.selectedId, "/usr/bin/docker", "the effective executable is the selection");
const selectors = bodyNodes.filter(isNode("button", "selector"));
assert.equal(selectors.length, 1, "one pill selector rendered once expanded");
assert.equal(selectors[0].props.children[0], "Local docker", "the executable pill shows the custom name");
// No block heading anywhere: the head wrapper AND its title/meta children are
// gone, because the row's own title + description (and the disclosure summary)
// already name what each picker edits — a heading duplicated both.
for (const gone of ["catalogHead", "catalogHeading", "catalogTitle", "catalogMeta"]) {
    assert.equal(walk(tree).filter((n) => scopedClass(gone).test(String(n.props?.className ?? ""))).length, 0, gone + " is not rendered");
}
// One title + one description per picker row, and the executable block leads.
const rowTitles = bodyNodes.filter(isNode("span", "fieldTitle")).map((n) => n.children);
assert.equal(
    JSON.stringify(rowTitles),
    JSON.stringify(["executableLabel", "profileLabel", "reduceLabel"]),
    "each block carries exactly one title, executables first"
);
const linkButtons = bodyNodes.filter(isNode("button", "linkButton"));
assert.equal(linkButtons.length, 2, "one fetch link button per catalog");
assert.equal(linkButtons[0].props.children, "fetchExecutables", "the executable refresh label resolves through locale");
// (The per-disclosure checks below assert each refresh action lives INSIDE its
// own disclosure — a catalog head is not left behind to carry one.)
const buttons = bodyNodes.filter(isNode("button", "addButton"));
assert.equal(buttons.length, 2, "one add button per catalog");
const rowInputs = bodyNodes.filter(isNode("input", "catalogInput"));
assert.equal(rowInputs.length, 6, "two saved profile rows (id + name) plus one executable row");
const profileIdInputs = rowInputs.filter((n) => String(n.props.placeholder) === "profileIdPlaceholder");
const executableIdInputs = rowInputs.filter((n) => String(n.props.placeholder) === "executableIdPlaceholder");
assert.equal(profileIdInputs.length, 2, "profile rows carry the profile-id placeholder");
assert.equal(executableIdInputs.length, 1, "executable rows carry the path placeholder");
const deleteButtons = bodyNodes.filter(isNode("button", "iconButton iconButtonDanger"));
assert.equal(deleteButtons.length, 3, "one delete button per saved row");
assert.match(String(deleteButtons[0].props["aria-label"]), /^removeExecutable \d+$/, "executable deletes are numbered");
assert.match(String(deleteButtons[2].props["aria-label"]), /^removeProfile \d+$/, "profile deletes are numbered");

// ── the row boxes hide behind a collapsed disclosure ──────────────────────
// Only the head and the dropdown are visible initially; the editable rows live
// inside a native <details> that starts closed (the reference card's shape).
function subtreeNodes(node, found = []) {
    if (node === null || node === undefined || typeof node !== "object") return found;
    if (Array.isArray(node)) {
        node.forEach((child) => subtreeNodes(child, found));
        return found;
    }
    if (node.type !== undefined) {
        found.push(node);
        subtreeNodes(node.children ?? node.props?.children ?? undefined, found);
    }
    return found;
}
const disclosures = bodyNodes.filter(isNode("details", "disclosure"));
assert.equal(disclosures.length, 2, "one collapsed disclosure per catalog");
for (const details of disclosures) {
    assert.equal(details.props.open, undefined, "the disclosure starts collapsed");
    const inside = subtreeNodes(details);
    const rowsInside = inside.filter((n) => n.type === "input" && scopedClass("catalogInput").test(String(n.props.className ?? "")));
    const addInside = inside.filter(isNode("button", "addButton"));
    const refreshInside = inside.filter(isNode("button", "linkButton"));
    assert.equal(refreshInside.length, 1, "the refresh action lives inside its disclosure");
    const summary = inside.find((n) => n.type === "summary");
    assert.ok(summary, "the disclosure carries a summary");
    assert.ok(rowsInside.length >= 1, "the editable rows live inside the disclosure");
    assert.equal(addInside.length, 1, "the add button lives inside the disclosure");
    assert.equal(
        subtreeNodes(details).filter((n) => n.type === "p" && scopedClass("empty").test(String(n.props.className ?? ""))).length,
        0,
        "the empty-state notice never hides behind the disclosure"
    );
}
// The head and the dropdown stay OUTSIDE every disclosure so the card's first
// screen keeps the title and the selection pill; only the rows, the add button
// and the per-catalog refresh action hide behind the collapsed block.
for (const [index, selector] of selectors.entries()) {
    assert.ok(
        !disclosures.some((details) => subtreeNodes(details).includes(selector)),
        "selector " + index + " stays visible outside the disclosure"
    );
}
{
    const summaries = disclosures.map((details) => {
        const inside = subtreeNodes(details).filter((n) => n.type === "summary");
        const spans = inside.flatMap((summary) => subtreeNodes(summary)).filter((n) => n.type === "span");
        return spans.map((span) => span.children);
    });
    assert.equal(
        JSON.stringify(summaries),
        JSON.stringify([["executableRows", "1"], ["profileRows", "2"]]),
        "each summary names its catalog and shows the row count"
    );
}

// ── profile selection left the card ──────────────────────────────────────
// The card's profile block keeps only what the composer pill cannot carry:
// the saved rows, their field row and the fetch link. Selecting the running
// profile is the composer pill's job (its dropdown rules are asserted in the
// composer section), so the card must render NO profile dropdown.
{
    tree = render(storeState);
    assert.equal(menus(tree).length, 1, "the card renders no profile dropdown anymore");
    const selectorButtons = walk(tree).filter(isNode("button", "selector"));
    assert.equal(selectorButtons.length, 1, "the executable selector is the card's only pill");
    // The brand mark lives ONLY on the composer pill — nothing here renders
    // the 24-unit whale canvas.
    assert.equal(
        walk(tree).filter((n) => n.type === "svg" && n.props.viewBox === "0 0 24 24").length,
        0,
        "no Docker mark renders anywhere in the card"
    );
    assert.ok(
        !writes.some(([f]) => f === "profile"),
        "rendering the profile block writes no profile"
    );
}

// ── the executable dropdown selects executables ──────────────────────────
{
    const selector = walk(render(storeState)).filter(isNode("button", "selector"))[0];
    selector.props.onClick();
    tree = render(storeState);
    const item = walk(tree).find((n) => n.type === "button" && n.props["data-menu-item"] === "/usr/bin/docker");
    assert.ok(item, "saved executables appear as menu items");
    item.props.onClick();
    assert.ok(
        writes.some(([f, v]) => f === "command" && v === "/usr/bin/docker"),
        "picking an executable row writes the command"
    );
    Object.assign(storeState, { command: "" });
}

// ── row editing commits on blur only ─────────────────────────────────────
{
    // Rows are addressed by the placeholder their catalog's ID field carries,
    // so nothing depends on which catalog rendered first.
    function catalogRows(t, placeholder) {
        return walk(t)
            .filter(isNode("div", "catalogRow"))
            .map((row) => subtreeNodes(row).filter((n) => n.type === "input"))
            .filter((inputs) => inputs.some((n) => String(n.props.placeholder) === placeholder));
    }
    const profileRows = catalogRows(tree, "profileIdPlaceholder");
    const profileId = profileRows[0][0];
    assert.equal(profileId.props.value, "alpha", "the row id mirrors the saved row");
    const profileName = profileRows[0][1];
    assert.equal(profileName.props.value, "Alpha", "the row name mirrors the saved row");
    assert.equal(profileName.props.placeholder, "namePlaceholder", "the name placeholder resolves through locale");

    profileName.props.onChange({ target: { value: "Local Alpha" } });
    const typed = catalogRows(render(storeState), "profileIdPlaceholder")[0][1];
    assert.equal(typed.props.value, "Local Alpha", "typing updates the row locally");
    assert.equal(lastWrite("profileEntries"), undefined, "typing alone does not persist the catalog");
    typed.props.onBlur();
    await Promise.resolve();
    const saved = lastWrite("profileEntries");
    assert.ok(saved !== undefined, "blur commits the whole row list");
    assert.equal(
        JSON.stringify(saved[1]),
        JSON.stringify([
            { id: "alpha", name: "Local Alpha" },
            { id: "beta", name: "" }
        ]),
        "the committed rows keep every other row untouched"
    );
    Object.assign(storeState, { profileEntries: saved[1] });
}

// ── delete removes one row, immediately ──────────────────────────────────
{
    tree = render(storeState);
    const profileDeletes = walk(tree)
        .filter(isNode("button", "iconButton iconButtonDanger"))
        .filter((n) => String(n.props["aria-label"]).startsWith("removeProfile"));
    profileDeletes[1].props.onClick();
    await Promise.resolve();
    const removed = lastWrite("profileEntries");
    assert.equal(JSON.stringify(removed[1]), JSON.stringify([{ id: "alpha", name: "Local Alpha" }]), "delete writes the list without that row");
    Object.assign(storeState, { profileEntries: removed[1] });
}

// ── add appends a blank row ──────────────────────────────────────────────
{
    tree = render(storeState);
    const addButton = walk(tree).filter(isNode("button", "addButton"))[1];
    addButton.props.onClick();
    tree = render(storeState);
    const rows = walk(tree).filter((n) => n.type === "input" && String(n.props.placeholder) === "profileIdPlaceholder");
    assert.equal(rows.length, 2, "the added blank row renders, ready to type into");
    assert.equal(rows[1].props.value, "", "the new row starts empty");
    assert.equal(lastWrite("profileEntries").length >= 1, true, "the add is not written until the row has a real id");

    // Typing a valid id and blurring persists it.
    rows[1].props.onChange({ target: { value: "gamma" } });
    const typed = walk(render(storeState)).filter((n) => n.type === "input" && String(n.props.placeholder) === "profileIdPlaceholder");
    typed[1].props.onBlur();
    await Promise.resolve();
    const added = lastWrite("profileEntries");
    assert.equal(
        JSON.stringify(added[1]),
        JSON.stringify([{ id: "alpha", name: "Local Alpha" }, { id: "gamma", name: "" }]),
        "a typed row lands in the saved rows"
    );
    Object.assign(storeState, { profileEntries: added[1] });
}

// ── invalid rows never reach the card ─────────────────────────────────────
// A row whose id the gateway could not carry is dropped by normalizeEntries
// — it is not rendered as a row box in the card, and the composer dropdown
// never offers it either (asserted in the composer section).
// ── invalid rows never reach the dropdown ─────────────────────────────────
// A row whose id the gateway could not carry is dropped by normalizeEntries
// before the composer pill offers it — asserted in the composer section
// below, and pinned for the shared row rules by test/catalog.test.mjs. The
// card offers no selector anymore, so there is nothing to drop here: the
// check that used to live in the card now lives with the pill.
{
    Object.assign(storeState, {
        profileEntries: [
            { id: "alpha", name: "Local Alpha" },
            { id: "beta", name: "" }
        ],
        profile: "alpha",
        profiles: ["alpha", "beta"]
    });
}

// ── the effective executable stays an option ──────────────────────────────
{
    Object.assign(storeState, {
        executables: [{ id: "/usr/bin/docker", name: "Local docker" }],
        effectiveCommand: "/Docker/host/bin/docker.exe",
        command: ""
    });
    tree = render(storeState);
    assert.equal(
        JSON.stringify(menus(tree)[0].props.items),
        JSON.stringify([
            { id: "/usr/bin/docker", label: "Local docker" },
            { id: "/Docker/host/bin/docker.exe", label: "/Docker/host/bin/docker.exe" }
        ]),
        "the executable in use is appended when no saved row carries it"
    );
    // Smoke fixtures stay out of the picker: neither the saved row nor the
    // currently-running shim command may be offered.
    Object.assign(storeState, {
        executables: [{ id: ".smoke/fake-docker", name: "Fake" }, { id: "/usr/bin/docker", name: "Local docker" }],
        effectiveCommand: ".smoke/fake-docker",
        command: ".smoke/fake-docker"
    });
    tree = render(storeState);
    assert.equal(
        JSON.stringify(menus(tree)[0].props.items),
        JSON.stringify([{ id: "/usr/bin/docker", label: "Local docker" }]),
        "a running smoke fixture is neither a saved row nor an appended option"
    );
    Object.assign(storeState, { executables: [{ id: "/usr/bin/docker", name: "Local docker" }], effectiveCommand: "/usr/bin/docker", command: "" });
}

// ── profile refresh lifecycle ────────────────────────────────────────────
// A profile fetch writes the profile trigger (never the executable one),
// settles on the served revision advancing — and opens the candidate dialog
// on top. Canceling it leaves nothing persisted.
{
    sync({
        profile: "alpha",
        profileEntries: [{ id: "alpha", name: "" }],
        profiles: ["alpha"],
        discoveryRevision: 0,
        executableDiscoveryRevision: 0
    });
    tree = render(storeState);
    walk(tree)
        .filter(isNode("button", "linkButton"))[1]
        .props.onClick();
    assert.equal(
        writes.filter(([f]) => f === "refreshNonce").length,
        1,
        "the profile refresh writes a numeric refreshNonce"
    );
    assert.equal(writes.filter(([f]) => f === "refreshExecutablesNonce").length, 0, "a profile refresh leaves the executable trigger alone");
    await flushPoll();
    runPendingTimers();
    await flushPoll();
    sync({ discoveryRevision: 1 });
    runPendingTimers();
    await flushPoll();
    let dialogOpen = walk(render(storeState)).filter((n) => n.props && n.props.role === "dialog").length;
    assert.equal(dialogOpen, 1, "the settled fetch opens the candidate dialog over the ids it found");
    const cancel = walk(render(storeState)).find((n) => n.type === "button" && n.props.children === "cancel");
    assert.ok(cancel, "the dialog carries a Cancel button");
    cancel.props.onClick();
    await flushPoll();
    assert.equal(
        walk(render(storeState)).filter((n) => n.props && n.props.role === "dialog").length,
        0,
        "Cancel closes the dialog without touching anything"
    );
    sync({ discoveryRevision: 2 });
}

// ── fetch dialog lifecycle ───────────────────────────────────────────────
// A fetch now opens a "Choose profiles to add" dialog over the ids the run
// reported instead of silently merging them: already-saved ids come back
// pre-checked (and locked — pruning stays the row list's delete button), a
// search field sifts long lists, "Select all" checks the visible ones, and
// "Add selected" merges exactly the checked ids through the same merge rule
// the host rows follow. Cancel writes nothing.
{
    const dialogNodes = (t) => walk(t).filter((n) => n.props && n.props.role === "dialog");
    const dialogCandidates = (t) => {
        const dialog = dialogNodes(t)[0];
        return dialog === void 0 ? [] : walk(dialog).filter((n) => n.type === "li" && scopedClass("candidate").test(String(n.props?.className ?? "")));
    };
    const candidateBoxes = (t) => {
        const dialog = dialogNodes(t)[0];
        return dialog === void 0 ? [] : walk(dialog).filter((n) => n.type === "input" && n.props.type === "checkbox");
    };
    const cancelOrCancel = (t) => {
        const dialog = dialogNodes(t)[0];
        if (dialog === void 0) return [];
        return walk(dialog).filter((n) => n.type === "button" && scopedClass("dialogButton").test(String(n.props?.className ?? "")) && !scopedClass("dialogButtonPrimary").test(String(n.props?.className ?? "")));
    };
    const addButtons = (t) => {
        const dialog = dialogNodes(t)[0];
        if (dialog === void 0) return [];
        return walk(dialog).filter((n) => n.type === "button" && scopedClass("dialogButtonPrimary").test(String(n.props?.className ?? "")));
    };
    const searchInputs = (t) => {
        const dialog = dialogNodes(t)[0];
        if (dialog === void 0) return [];
        return walk(dialog).filter((n) => n.type === "input" && n.props.type === "search");
    };
    const selectAllButtons = (t) => {
        const dialog = dialogNodes(t)[0];
        if (dialog === void 0) return [];
        return walk(dialog).filter((n) => n.type === "button" && scopedClass("linkButton").test(String(n.props?.className ?? "")));
    };
    const savedNotes = (t) => {
        const dialog = dialogNodes(t)[0];
        if (dialog === void 0) return [];
        return walk(dialog).filter((n) => n.type === "span" && scopedClass("candidateNote").test(String(n.props?.className ?? "")));
    };
    const flush = async () => {
        for (let i = 0; i < 12; i++) await Promise.resolve();
    };
    const openState = () => {
        // The card stays expanded across this whole section; a fresh render
        // after every store change is how the dialog subtree materializes.
        openStateRef = true;
    };
    openState();

    // (a) a profile fetch with nothing saved yet: every candidate starts
    // unchecked, the dialog labels and describes itself for profiles.
    sync({
        profile: "default",
        profileEntries: [],
        executables: [{ id: "/usr/bin/docker", name: "Local docker" }],
        effectiveCommand: "/usr/bin/docker",
        profiles: ["alpha", "beta"],
        executableCandidates: ["/usr/bin/docker", "/usr/local/bin/docker"],
        lastRefreshError: "",
        discoveryRevision: 0,
        executableDiscoveryRevision: 0
    });
    tree = render(storeState);
    walk(tree)
        .filter(isNode("button", "linkButton"))[1]
        .props.onClick();
    await Promise.resolve();
    runPendingTimers();
    await flush();
    sync({ discoveryRevision: 1 });
    runPendingTimers();
    await flush();
    tree = render(storeState);
    assert.equal(dialogNodes(tree).length, 1, "the profile fetch opens one dialog");
    assert.equal(dialogNodes(tree)[0].props["aria-modal"], "true", "the dialog is modal");
    assert.equal(dialogNodes(tree)[0].props["aria-label"], "dialogProfilesTitle", "the dialog is labeled for profiles");
    assert.equal(dialogCandidates(tree).length, 2, "one candidate row per detected id");
    assert.equal(candidateBoxes(tree).every((n) => n.props.checked === false && n.props.disabled === false), true, "unsaved candidates start unchecked");
    assert.equal(savedNotes(tree).length, 0, "only saved candidates carry the saved note");

    // (b) search narrows the list; "Select all" checks the visible ones.
    searchInputs(tree)[0].props.onChange({ target: { value: "beta" } });
    tree = render(storeState);
    assert.equal(dialogCandidates(tree).length, 1, "the search filters the candidate list");
    selectAllButtons(tree)[0].props.onClick();
    tree = render(storeState);
    assert.equal(candidateBoxes(tree)[0].props.checked, true, "Select all checks the matched candidate");

    // (c) "Add selected" persists exactly the checked ids, closes, and never
    // touches anything else.
    const profileWritesBefore = writes.filter(([f]) => f === "profileEntries").length;
    addButtons(tree)[0].props.onClick();
    await flush();
    tree = render(storeState);
    assert.equal(dialogNodes(tree).length, 0, "the dialog closes after Add selected");
    assert.equal(writes.filter(([f]) => f === "profileEntries").length, profileWritesBefore + 1, "Add selected writes the rows once");
    assert.equal(
        JSON.stringify(lastWrite("profileEntries")[1]),
        JSON.stringify([{ id: "beta", name: "" }]),
        "only the checked id lands as a saved row, nameless"
    );
    sync({ profileEntries: [{ id: "beta", name: "Beta" }], discoveryRevision: 2 });

    // (d) a second fetch: the already-saved id comes back checked and locked.
    tree = render(storeState);
    walk(tree)
        .filter(isNode("button", "linkButton"))[1]
        .props.onClick();
    await Promise.resolve();
    runPendingTimers();
    await flush();
    sync({ discoveryRevision: 3 });
    runPendingTimers();
    await flush();
    tree = render(storeState);
    assert.equal(dialogNodes(tree).length, 1, "the second fetch opens the dialog again");
    assert.equal(dialogCandidates(tree).length, 2, "both detected ids are listed again");
    const checkedBox = candidateBoxes(tree).find((n) => n.props.checked === true);
    assert.ok(checkedBox, "the already-saved candidate comes back pre-checked");
    assert.equal(checkedBox.props.disabled, true, "the pre-checked candidate is locked — pruning stays with the delete button");
    assert.equal(savedNotes(tree).length, 1, "the saved candidate carries its note");

    // (e) Cancel writes nothing.
    cancelOrCancel(tree)[0].props.onClick();
    await flush();
    tree = render(storeState);
    assert.equal(dialogNodes(tree).length, 0, "Cancel closes the dialog");
    assert.equal(writes.filter(([f]) => f === "profileEntries").length, profileWritesBefore + 1, "Cancel persisted nothing else");

    // (f) the executable fetch dialog lists paths the same way and merges
    // only the checked ones into the executable rows.
    sync({ discoveryRevision: 4, executableDiscoveryRevision: 0 });
    tree = render(storeState);
    walk(tree)
        .filter(isNode("button", "linkButton"))[0]
        .props.onClick();
    await Promise.resolve();
    runPendingTimers();
    await flush();
    sync({ executableDiscoveryRevision: 1 });
    runPendingTimers();
    await flush();
    tree = render(storeState);
    assert.equal(dialogNodes(tree).length, 1, "the executable fetch opens the dialog");
    assert.equal(dialogNodes(tree)[0].props["aria-label"], "dialogExecutablesTitle", "the dialog is labeled for executables");
    assert.equal(dialogCandidates(tree).length, 2, "one candidate per found path");
    assert.equal(savedNotes(tree).length, 1, "the already-saved path carries its note");
    const newPathBox = candidateBoxes(tree).find((n) => n.props.disabled === false);
    newPathBox.props.onChange({ target: { checked: true } });
    tree = render(storeState);
    const execWritesBefore = writes.filter(([f]) => f === "executables").length;
    addButtons(tree)[0].props.onClick();
    await flush();
    assert.equal(writes.filter(([f]) => f === "executables").length, execWritesBefore + 1, "the selection persists once");
    assert.equal(
        JSON.stringify(lastWrite("executables")[1]),
        JSON.stringify([{ id: "/usr/bin/docker", name: "Local docker" }, { id: "/usr/local/bin/docker", name: "" }]),
        "the new path appends, the saved row keeps its custom name"
    );

    // (g) a `.smoke/` candidate — the kind a reachable smoke fixture would
    // produce — is never offered: the dialog filters through the same rule
    // the rows and the dropdown options follow.
    sync({ executableCandidates: ["/usr/bin/docker", ".smoke/fake-docker", "/usr/local/bin/docker"], executableDiscoveryRevision: 2 });
    tree = render(storeState);
    walk(tree)
        .filter(isNode("button", "linkButton"))[0]
        .props.onClick();
    await Promise.resolve();
    runPendingTimers();
    await flush();
    sync({ executableDiscoveryRevision: 3 });
    runPendingTimers();
    await flush();
    tree = render(storeState);
    assert.equal(dialogNodes(tree).length, 1, "the executable fetch opens the dialog over what it found");
    assert.equal(dialogCandidates(tree).length, 2, "the smoke fixture is filtered out of the candidate list");
    const offeredIds = walk(tree)
        .filter((n) => scopedClass("candidateId").test(String(n.props?.className ?? "")))
        .map((n) => String(n.props.children));
    assert.equal(offeredIds.some((id) => id.includes(".smoke/")), false, "no offered candidate is a smoke fixture");
    cancelOrCancel(tree)[0].props.onClick();
    await flush();

    // (h) an empty discovery result never opens a dialog — there is nothing
    // to select.
    sync({ profiles: [], discoveryRevision: 5 });
    tree = render(storeState);
    walk(tree)
        .filter(isNode("button", "linkButton"))[1]
        .props.onClick();
    await Promise.resolve();
    runPendingTimers();
    await flush();
    sync({ discoveryRevision: 6 });
    runPendingTimers();
    await flush();
    tree = render(storeState);
    assert.equal(dialogNodes(tree).length, 0, "an empty discovery result leaves the card alone");
    sync({ profiles: ["beta"], profile: "beta", profileEntries: [{ id: "beta", name: "Beta" }], executableCandidates: [], executableDiscoveryRevision: 0, discoveryRevision: 0 });
}

// ── executable refresh lifecycle ─────────────────────────────────────────
{
    tree = render(storeState);
    sync({ profile: "alpha", profileEntries: [{ id: "alpha", name: "" }], profiles: ["alpha"], discoveryRevision: 0, executableDiscoveryRevision: 0 });
    const execBefore = writes.filter(([f]) => f === "refreshExecutablesNonce").length;
    walk(tree)
        .filter(isNode("button", "linkButton"))[0]
        .props.onClick();
    assert.equal(
        writes.filter(([f]) => f === "refreshExecutablesNonce").length,
        execBefore + 1,
        "the executable fetch writes its own trigger"
    );
    const execWrite = writes.filter(([f]) => f === "refreshExecutablesNonce").pop();
    assert.equal(typeof execWrite[1], "number", "the trigger is numeric");
    sync({ executableDiscoveryRevision: 1 });
    runPendingTimers();
    await flushPoll();
    // An executable fetch with no new candidates leaves the dialog closed.
    assert.equal(
        walk(render(storeState)).filter((n) => n.props && n.props.role === "dialog").length,
        0,
        "the empty executable fetch does not open a dialog"
    );
}

// ── reduce-log-output toggle ──────────────────────────────────────────────
{
    tree = render(storeState);
    let toggle = walk(tree).find((n) => n.type === "Switch");
    assert.ok(toggle, "Switch primitive rendered once expanded");
    // The toggle is a catalog block that reuses the stock two-row field layout:
    // title + control inline in a `.fieldRow`, description full-width below.
    const toggleLabelNode = walk(tree).find(
        (n) => n.type === "span" && scopedClass("toggleLabel").test(String(n.props?.className ?? ""))
    );
    assert.ok(toggleLabelNode, "the toggle is wrapped in the element carrying the title");
    const toggleCatalogs = walk(tree)
        .filter(isNode("div", "catalog"))
        .filter((c) => subtreeNodes(c).some((n) => n === toggleLabelNode));
    assert.equal(toggleCatalogs.length, 1, "the toggle block is a catalog");
    const toggleRow = subtreeNodes(toggleCatalogs[0]).find((n) => scopedClass("fieldRow").test(String(n.props?.className ?? "")));
    assert.ok(toggleRow, "the toggle uses the shared fieldRow layout");
    const toggleTitle = subtreeNodes(toggleCatalogs[0]).find((n) => scopedClass("fieldTitle").test(String(n.props?.className ?? "")));
    assert.ok(toggleTitle, "the toggle block has its own field title");
    assert.equal(toggleTitle.children, "reduceLabel", "the title text resolves through locale");
    // The primitive only names the control (aria-label); the tooltip lives on
    // the wrapper the card renders around it.
    assert.equal(toggleLabelNode.props.title, "reduceTitle", "the tooltip text resolves through locale");
    assert.equal(toggle.props.checked, true, "capture is on by default (unset override, row config log)");
    toggle.props.onChange();
    assert.ok(writes.some(([f, v]) => f === "stderrMode" && v === "console"), "toggling off persists console mode");
    Object.assign(storeState, { stderrMode: "console" });
    tree = render(storeState);
    toggle = walk(tree).find((n) => n.type === "Switch");
    assert.equal(toggle.props.checked, false, "the switch reflects the persisted mode");
    Object.assign(storeState, { stderrMode: "" });
}

// ── read-only disables the whole card ────────────────────────────────────
{
    Object.assign(storeState, { writable: false });
    tree = render(storeState);
    assert.ok(walk(tree).find(isNode("p", "readOnly")), "read-only notice rendered");
    const toggle = walk(tree).find((n) => n.type === "Switch");
    assert.equal(toggle.props.disabled, true, "switch disabled while settings are read-only");
    for (const input of walk(tree).filter(isNode("input", "catalogInput"))) {
        assert.equal(input.props.disabled, true, "catalog inputs disabled while read-only");
    }
    for (const button of walk(tree).filter(isNode("button", "linkButton"))) {
        assert.equal(button.props.disabled, true, "refresh disabled while read-only");
    }
    Object.assign(storeState, { writable: true });
}

// ── status dot states ─────────────────────────────────────────────────────
Object.assign(storeState, { profile: "gone", profileEntries: [], profiles: ["alpha"], lastRefreshError: "", actionError: "" });
let dot = findDot(render(storeState));
assert.ok(dot, "the dot shows while the active profile is absent from the discovered ids");
assert.equal(dotState(dot), "statusMissing", "the missing state reads as missing, not as an error");

Object.assign(storeState, { lastRefreshError: "docker mcp profile list failed" });
dot = findDot(render(storeState));
assert.equal(dotState(dot), "statusError", "a discovery error shows the red dot");
assert.equal(dot.props["aria-label"], "statusError");
assert.equal(dot.props.title, "docker mcp profile list failed");
let errorP = walk(render(storeState)).find(isNode("p", "error"));
assert.ok(errorP, "error paragraph rendered");
assert.equal(errorP.props.children, "docker mcp profile list failed");

// healthy: active profile discovered, no errors → no dot
Object.assign(storeState, { profile: "alpha", profileEntries: [{ id: "alpha", name: "Alpha" }], profiles: ["alpha"], lastRefreshError: "", actionError: "" });
tree = render(storeState);
dot = findDot(tree);
assert.equal(dot, undefined, "no dot while healthy");
assert.equal(walk(tree).find(isNode("p", "error")), undefined, "no error paragraph while healthy");

// ── controller write path ─────────────────────────────────────────────────
assert.equal(JSON.stringify(face.hooks.dockerMcpCard.getSnapshot()), JSON.stringify(storeState), "controller inject returns the same snapshot store");
rejectNextProfileWrite = true;
await face.selectProfile("gamma");
tree = render(storeState);
dot = findDot(tree);
assert.equal(dotState(dot), "statusError", "a rejected write surfaces the error state");
assert.equal(walk(tree).find(isNode("p", "error")).props.children, "write rejected by host");
await face.selectProfile("alpha");
tree = render(storeState);
assert.equal(findDot(tree), undefined, "no dot after a successful emit");

// ── controller refresh path ───────────────────────────────────────────────
// refreshProfiles writes a numeric refreshNonce, then polls the shared
// describe mirror until the host advances the served discoveryRevision (the
// host keeps discovery state in its in-memory base layer and pushes it with a
// nonce bump, so the client owns the freshness wait).
{
    const refreshLoadCallsBefore = mirror.loadCalls;
    const refreshPromise = face.refreshProfiles();
    await Promise.resolve();
    assert.ok(writes.some(([f, v]) => f === "refreshNonce" && typeof v === "number"), "refresh writes a numeric refreshNonce");
    assert.equal(mirror.loadCalls, refreshLoadCallsBefore, "no mirror re-read before the first poll tick");
    runPendingTimers();
    await Promise.resolve();
    assert.ok(mirror.loadCalls >= refreshLoadCallsBefore + 1, "poll re-reads the settings mirror while the discovery runs");
    Object.assign(storeState, { discoveryRevision: storeState.discoveryRevision + 1 });
    runPendingTimers();
    await refreshPromise;

    const execPromise = face.refreshExecutables();
    await Promise.resolve();
    assert.ok(writes.some(([f, v]) => f === "refreshExecutablesNonce" && typeof v === "number"), "the executable fetch bumps its own trigger");
    Object.assign(storeState, { executableDiscoveryRevision: storeState.executableDiscoveryRevision + 1 });
    runPendingTimers();
    await execPromise;
}

// ── global failure toast ─────────────────────────────────────────────────
// A discovery wait that ends without connecting stages a one-shot notice. It
// is announced by a body-mounted toast host (react-dom/client createRoot from
// apply), NOT by the settings card — the settings slot only lives while the
// user has Settings open, and a boot failure must be visible from anywhere.
{
    function hostTree() {
        const root = toastRoots[0];
        return materialize(root.element.type, root.element.props, null, "jsx");
    }
    assert.equal(toastRoots.length, 1, "apply() mounts exactly one toast host root");

    Object.assign(storeState, { notice: null });
    assert.equal(walk(hostTree()).find((n) => n.props && n.props["data-toast-text"] !== undefined), undefined, "the idle host shows no toast");

    Object.assign(storeState, { notice: { seq: 1, kind: "stall", text: "" } });
    let toast = walk(hostTree()).find((n) => n.props && n.props["data-toast-text"] !== undefined);
    assert.ok(toast, "the host surfaces a toast without the settings card rendering");
    assert.equal(toast.props["data-toast-text"], "statusUnreachable", "stall text resolves through locale");

    Object.assign(storeState, { notice: { seq: 2, kind: "error", text: "Cannot connect to the Docker daemon" } });
    toast = walk(hostTree()).find((n) => n.props && n.props["data-toast-text"] !== undefined);
    assert.equal(toast.props["data-toast-text"], "Cannot connect to the Docker daemon", "error notice surfaces the host message");

    toast.props.onDone();
    assert.equal(storeState.notice, null, "the toast's onDone clears the notice through the controller");

    Object.assign(storeState, { notice: { seq: 5, kind: "stall", text: "" } });
    face.clearNotice(1);
    assert.ok(storeState.notice !== null, "clearNotice with a stale seq leaves the current notice alone");
    face.clearNotice(5);
    assert.equal(storeState.notice, null, "clearNotice with the live seq clears");

    Object.assign(storeState, { notice: { seq: 9, kind: "error", text: "dup" } });
    tree = render(storeState);
    assert.equal(
        walk(tree).find((n) => n.props && n.props["data-toast-text"] !== undefined),
        undefined,
        "the card never renders the toast — only the global host does"
    );
    Object.assign(storeState, { notice: null, lastRefreshError: "", actionError: "" });
}

// ── composer profile pill ────────────────────────────────────────────────
// The same store, projected into the conversation input's tool row through the
// shell's own slot machinery (the `conversation.input.left` seat). The test
// passes the props the renderer would: the locale `t`, the store hook, and the
// controller's profile writer.
{
    const [composerOptions, ComposerPill] = composerEntry;
    assert.equal(composerOptions.name, "conversation.input.left");
    assert.equal(composerOptions.id, "docker-desktop-mcp-profile", "the list-kind seat registers under a stable entry id");
    assert.equal(composerOptions.locale, "dockerDesktopMcp");
    const composerFace = composerOptions.inject();
    assert.equal(typeof composerFace.selectProfile, "function", "the pill carries the profile writer");
    assert.equal(
        JSON.stringify(composerFace.hooks.dockerMcpCard.getSnapshot()),
        JSON.stringify(storeState),
        "the pill shares the card's snapshot store — no second subscription"
    );

    function renderPill(state) {
        hookIndex = 0;
        return ComposerPill({
            t: (key) => key,
            useDockerMcpCard: (sel) => sel(state),
            selectProfile: (value) => scope.set("profile", value)
        });
    }

    // Start from a clean hook row: the pill owns a single open/close slot.
    hookStates = [];

    // Nothing served → no pill (the composer stays clean until the host does).
    Object.assign(storeState, emptySnapshot());
    assert.equal(renderPill(storeState), null, "the composer pill renders nothing while the namespace is not served");

    // Namespace served → a Menu pill listing the saved rows.
    Object.assign(storeState, emptySnapshot(), {
        available: true,
        writable: true,
        profile: "alpha",
        profileEntries: [
            { id: "alpha", name: "Alpha" },
            { id: "beta", name: "" }
        ],
        profiles: ["alpha", "beta"]
    });
    let pill = renderPill(storeState);
    let pillMenu = walk(pill).find((n) => n.type === "Menu");
    assert.ok(pillMenu, "the pill renders a Menu dropdown");
    assert.equal(pillMenu.props.open, false, "the dropdown starts closed");
    assert.equal(pillMenu.props.selectedId, "alpha", "the pill selection is the running profile");
    assert.equal(
        JSON.stringify(pillMenu.props.items),
        JSON.stringify([
            { id: "alpha", label: "Alpha" },
            { id: "beta", label: "beta" }
        ]),
        "the pill lists the saved rows under their UI labels, same rules as the card"
    );
    let trigger = walk(pill).find(isNode("button", "composerPill"));
    assert.ok(trigger, "the pill trigger renders");
    assert.equal(trigger.props["aria-label"], "composerAria", "the trigger is labeled through the locale");
    assert.equal(trigger.props.title, "composerTitle", "the tooltip names the plugin, NOT the running profile — it is locale copy, never profileLabel");
    assert.equal(trigger.props.disabled, false, "the trigger is enabled while writable");

    // The pill is led by the Docker mark — the only surface that carries it.
    // The mark is the whale path on its own 24-unit canvas; no other rendered
    // svg uses that viewBox, so counting them pins "only here" structurally.
    const dockerMarks = walk(pill).filter((n) => n.type === "svg" && n.props.viewBox === "0 0 24 24");
    assert.equal(dockerMarks.length, 1, "the trigger carries the Docker mark once");
    const markWrapper = trigger.props.children[0];
    assert.ok(scopedClass("composerPillIcon").test(String(markWrapper.props.className ?? "")), "the mark wrapper carries the pill-icon class");
    assert.equal(markWrapper.props["aria-hidden"], true, "the mark is decorative — the label already names the profile");
    // Open, pick → the same user-layer write the card performs.
    trigger.props.onClick();
    pill = renderPill(storeState);
    pillMenu = walk(pill).find((n) => n.type === "Menu");
    assert.equal(pillMenu.props.open, true, "the pill menu opens");
    const pillItem = walk(pill).find((n) => n.type === "button" && n.props["data-menu-item"] === "beta");
    assert.ok(pillItem, "saved rows appear as pill menu items");
    pillItem.props.onClick();
    assert.ok(writes.some(([f, v]) => f === "profile" && v === "beta"), "the composer pick writes the profile field");
    Object.assign(storeState, { profile: "beta" });
    writes.length = 0;

    // A no-op pick (the current id) writes nothing.
    trigger = walk(renderPill(storeState)).find(isNode("button", "composerPill"));
    trigger.props.onClick();
    pill = renderPill(storeState);
    walk(pill)
        .find((n) => n.type === "button" && n.props["data-menu-item"] === "beta")
        .props.onClick();
    assert.equal(writes.length, 0, "picking the running profile writes nothing");
    Object.assign(storeState, { profile: "alpha" });

    // A failed discovery makes the store untrustworthy → `default` comes back.
    Object.assign(storeState, { profileEntries: [], lastRefreshError: "docker mcp profile list failed" });
    pill = renderPill(storeState);
    pillMenu = walk(pill).find((n) => n.type === "Menu");
    assert.equal(
        JSON.stringify(pillMenu.props.items),
        JSON.stringify([
            { id: "default", label: "default" },
            { id: "alpha", label: "alpha" }
        ]),
        "the fallback option returns when the last discovery run failed"
    );
    Object.assign(storeState, { lastRefreshError: "" });

    // Rows whose id the gateway could not carry drop out of the dropdown —
    // the pill never offers what `--profile` would reject.
    Object.assign(storeState, {
        profileEntries: [
            { id: "ok", name: "OK" },
            { id: "bad id", name: "Dropped" },
            { id: "", name: "Blank" }
        ]
    });
    pill = renderPill(storeState);
    pillMenu = walk(pill).find((n) => n.type === "Menu");
    assert.equal(
        JSON.stringify(pillMenu.props.items),
        JSON.stringify([
            { id: "ok", label: "OK" },
            { id: "alpha", label: "alpha" }
        ]),
        "invalid rows drop out of the dropdown while the running profile stays offered"
    );
    Object.assign(storeState, { profileEntries: [] });

    // Read-only: disabled, but still rendered (the user can see the running id).
    Object.assign(storeState, { writable: false });
    pill = renderPill(storeState);
    trigger = walk(pill).find(isNode("button", "composerPill"));
    assert.equal(trigger.props.disabled, true, "the pill disables while settings are read-only");
    Object.assign(storeState, { writable: true, profileEntries: [], profile: "alpha", profiles: ["alpha"] });
}

console.log("client.test.mjs: all assertions passed");
