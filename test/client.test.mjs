// Materializes lib/client.js in a stubbed browser environment (the same
// window.__ModuleLoader__.load contract the shell's module system uses) and
// exercises the card: registration, snapshot projection, and render tree.
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
const document = {
	querySelector: () => null,
	createElement: (tag) => ({
		tag,
		dataset: {},
		textContent: "",
		setAttribute() {},
	}),
	head: { appendChild: (el) => styles.push(el) }
};
// Stateful useState: the card keeps `open` across re-renders, so the stub
// must persist hook values by call slot. Renders reset the slot index.
let hookStates = [];
let hookIndex = 0;
let lastHookCount = null;
const react = {
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
		node.type = rendered.type;
		node.props = rendered.props;
		node.children = rendered.children;
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
	})
};

const storeState = {
	available: false,
	writable: false,
	profile: "",
	profiles: [],
	lastRefreshError: "",
	discoveryRevision: 0,
	actionError: ""
};
const listeners = new Set();
const clientStore = {
	createSnapshotStore: (initial) => ({
		getSnapshot: () => storeState,
		subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
		set: (next) => Object.assign(storeState, next)
	})
};
const requireStub = (spec) => {
	if (spec === "react") return react;
	if (spec === "react/jsx-runtime") return jsxRuntime;
	if (spec === "@deepseek-ai/dsh-client-store") return clientStore;
	if (spec === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
	throw new Error(`unexpected require: ${spec}`);
};

// ── materialize ──────────────────────────────────────────────────────────
// setTimeout/clearTimeout stand in for the browser globals the refresh poll
// schedules against (the real bundle runs in a page).
vm.runInNewContext(bundle, {
	window,
	document,
	require: undefined,
	console,
	setTimeout,
	clearTimeout
});
assert.ok(registration, "bundle registered with __ModuleLoader__");
assert.equal(registration.id, "@comecaramelos/dsh-docker-desktop-mcp");
const factoryResult = registration.factory(requireStub);
assert.equal(typeof factoryResult.apply, "function", "exports.apply");
assert.equal(JSON.stringify(factoryResult.inject), JSON.stringify(["slots", "locale", "settingsScope"]), "exports.inject");
assert.equal(styles.length, 1, "one style tag injected");
assert.ok(styles[0].dataset.pluginCss === "@comecaramelos/dsh-docker-desktop-mcp/DockerMcpCard.module.css");

// ── settings scope stub ──────────────────────────────────────────────────
const scopeSnapshot = {
	status: "ready",
	value: {
		profile: "default",
		profiles: ["alpha", "beta"],
		refreshNonce: 0,
		lastRefreshError: "",
		discoveryRevision: 0
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
// Shared describe-mirror stub: the refresh action re-reads it while the
// host's in-memory discovery state is en route. Bump the served
// discoveryRevision to let a poll settle.
const mirror = {
	loadCalls: 0,
	load: () => {
		mirror.loadCalls += 1;
		return Promise.resolve();
	}
};

// ── cordis client ctx stub ───────────────────────────────────────────────
const registeredSlotEntries = [];
const ctx = {
	effect: (fn) => {
		const disposer = fn();
		return { dispose: () => disposer?.dispose?.() ?? disposer?.() }
	},
	locale: {
		register: (ns, dicts) => {
			assert.equal(ns, "dockerDesktopMcp");
			assert.ok(dicts.en && dicts.zh);
			var enKeys = Object.keys(dicts.en).sort();
			var zhKeys = Object.keys(dicts.zh).sort();
			assert.equal(JSON.stringify(enKeys), JSON.stringify(zhKeys), "en and zh have same key set");
			var required = ["title", "description", "profileLabel", "hint", "refresh", "refreshing", "readOnly", "empty", "statusMissing", "statusError", "expand", "collapse"];
			for (var i = 0; i < required.length; i++) {
				assert.ok(required[i] in dicts.en, "en has key: " + required[i]);
				assert.ok(required[i] in dicts.zh, "zh has key: " + required[i]);
			}
		},
		bind: () => (key) => key
	},
	settingsScope: {
		bind: (spec) => (assert.equal(spec.namespace, "docker-desktop-mcp"), scope),
		describe: () => mirror
	},
	slots: {
		inject: (slot, registerFn) => {
			assert.equal(slot, "settings.plugin.item");
			registerFn(); // factory calls ctx.slots.register below
		},
		register: (options, Component) => {
			registeredSlotEntries.push([options, Component]);
			return () => {}; // disposer
		}
	}
};

factoryResult.apply(ctx);
assert.equal(registeredSlotEntries.length, 1, "one settings.plugin.item entry");
const [options, Component] = registeredSlotEntries[0];
assert.equal(options.name, "settings.plugin.item");
assert.equal(options.key, "docker-desktop-mcp");
assert.equal(options.locale, "dockerDesktopMcp");
assert.equal(typeof Component, "function");

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
		refreshProfiles: () => scope.set("refreshNonce", 123)
	});
	react.useState = _useState;
	react.useEffect = _useEffect;
	react.useId = _useId;
	if (lastHookCount !== null) assert.equal(hookCount, lastHookCount, "hook count stable across renders");
	lastHookCount = hookCount;
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
const isNode = (type, className) => (n) => n.type === type && n.props?.className === className;

// ── render helpers ────────────────────────────────────────────────────────
function findDot(t) {
	return walk(t).find((n) => n.type === "span" && String(n.props?.className ?? "").startsWith("dshdmc_dot "));
}
function dotState(dot) {
	return dot.props.className.includes("dshdmc_dotError") ? "error" : "none";
}

// ── render 1: unavailable ────────────────────────────────────────────────
Object.assign(storeState, { available: false });
let tree = render(storeState);
assert.equal(tree, null, "renders nothing while namespace is unavailable");

// ── render 2: available, collapsed by default ─────────────────────────────
Object.assign(storeState, {
	available: true,
	writable: true,
	profile: "default",
	profiles: ["alpha", "beta"],
	lastRefreshError: "",
	actionError: ""
});
tree = render(storeState);
assert.ok(tree && tree.type === "li", "card root is an li");
assert.equal(
	tree.props.className,
	"dshdmc_card",
	"no cardOpen class while collapsed"
);
const header = walk(tree).find(isNode("button", "dshdmc_header"));
assert.ok(header, "header disclosure button rendered");
assert.equal(header.props["aria-expanded"], false, "card collapsed by default");
assert.equal(header.props["aria-label"], "expand: title", "header aria-label names the action and card");
assert.ok(header.props["aria-controls"], "header has aria-controls");
assert.equal(walk(tree).find(isNode("button", "dshdmc_selector")), undefined, "body hidden while collapsed");
assert.equal(walk(tree).find(isNode("div", "dshdmc_body")), undefined, "body div absent while collapsed");
const closedChevron = walk(tree).find(isNode("svg", "dshdmc_chevron"));
assert.ok(closedChevron, "chevron rendered while closed");
// collapsed-state dot + body-absence assertions (B.2)
let dot = findDot(tree);
assert.ok(dot, "status dot always rendered in the card header");
assert.equal(dot.props.role, "img");
assert.equal(dotState(dot), "error", "red dot while the active profile is undiscovered");
assert.equal(dot.props["aria-label"], "statusMissing");
assert.equal(dot.props.title, "statusMissing");

// ── expand via the header button ──────────────────────────────────────────
header.props.onClick();
tree = render(storeState);
assert.ok(String(tree.props.className).includes("dshdmc_cardOpen"), "cardOpen class while expanded");
assert.equal(
	walk(tree).find(isNode("button", "dshdmc_header")).props["aria-expanded"],
	true,
	"aria-expanded flips open"
);
assert.ok(
	walk(tree).find(isNode("svg", "dshdmc_chevron dshdmc_chevronOpen")),
	"chevron gains the open class while expanded"
);
const nodes = walk(tree);
const menu = nodes.find((n) => n.type === "Menu");
assert.ok(menu, "Menu rendered once expanded");
assert.equal(menu.props.open, false, "menu closed by default");
assert.equal(JSON.stringify(menu.props.items), JSON.stringify([{ id: "alpha", label: "alpha" }, { id: "beta", label: "beta" }, { id: "default", label: "default" }]), "current profile appended when not discovered");
assert.equal(menu.props.selectedId, "default");
assert.equal(menu.props.align, "end");
assert.equal(menu.props.portal, true);
let selector = nodes.find(isNode("button", "dshdmc_selector"));
assert.ok(selector, "pill selector rendered once expanded");
assert.equal(selector.props["aria-haspopup"], "menu");
assert.equal(selector.props["aria-expanded"], false);
assert.equal(selector.props.disabled, false);
const selectorWrap = nodes.find(isNode("span", "dshdmc_selectorWrap"));
assert.ok(selectorWrap, "selector wrapper rendered");
assert.ok(walk(selectorWrap).some((x) => x.type === "Menu"), "Menu root sits inside the wrapper span");
const refresh = nodes.find(isNode("button", "dshdmc_button"));
assert.ok(refresh, "refresh button rendered");

// ── collapse-back test (B.3) ─────────────────────────────────────────────
// Use the header from the expanded tree so the onClick closure captures open=true
const expandedHeader = walk(tree).find(isNode("button", "dshdmc_header"));
expandedHeader.props.onClick();
tree = render(storeState);
assert.equal(walk(tree).find(isNode("button", "dshdmc_header")).props["aria-expanded"], false, "card collapses back (aria-expanded false)");
assert.ok(!String(tree.props.className).includes("dshdmc_cardOpen"), "cardOpen class removed on collapse");
assert.equal(walk(tree).find(isNode("div", "dshdmc_body")), undefined, "body div absent after collapse");
assert.equal(walk(tree).find(isNode("button", "dshdmc_selector")), undefined, "selector absent after collapse");
// re-expand for rest of the suite
const collapsedHeader2 = walk(tree).find(isNode("button", "dshdmc_header"));
collapsedHeader2.props.onClick();
tree = render(storeState);
assert.ok(String(tree.props.className).includes("dshdmc_cardOpen"), "card re-expanded");

// ── menu selection writes profile ───────────────────
selector = walk(tree).find(isNode("button", "dshdmc_selector"));
selector.props.onClick();
tree = render(storeState);
selector = walk(tree).find(isNode("button", "dshdmc_selector"));
assert.equal(selector.props["aria-expanded"], true, "menu opens");
const menuOpenNode = walk(tree).find((n) => n.type === "Menu");
assert.equal(menuOpenNode.props.open, true, "menu open state propagated");
const menuItemAlpha = walk(tree).find((n) => n.type === "button" && n.props["data-menu-item"] === "alpha");
assert.ok(menuItemAlpha, "menu items rendered while open");
menuItemAlpha.props.onClick();
assert.ok(writes.some(([f, v]) => f === "profile" && v === "alpha"), "menu selection writes profile");
tree = render(storeState);
selector = walk(tree).find(isNode("button", "dshdmc_selector"));
assert.equal(selector.props["aria-expanded"], false, "menu closed after selection");

// ── refreshing lifecycle (B.4) ───────────────────────
// Re-find selector and refresh from current tree (stale after collapse-back)
let refreshBtn = walk(tree).find(isNode("button", "dshdmc_button"));
refreshBtn.props.onClick();
assert.ok(writes.some(([f, v]) => f === "refreshNonce" && v === 123), "refresh writes refreshNonce");
tree = render(storeState);
refreshBtn = walk(tree).find(isNode("button", "dshdmc_button"));
assert.equal(refreshBtn.props.children, "refreshing", "refresh button shows refreshing");
selector = walk(tree).find(isNode("button", "dshdmc_selector"));
assert.equal(selector.props.disabled, true, "selector disabled while refreshing");
await Promise.resolve();
tree = render(storeState);
refreshBtn = walk(tree).find(isNode("button", "dshdmc_button"));
assert.equal(refreshBtn.props.children, "refresh", "refresh button back to refresh after flush");
selector = walk(tree).find(isNode("button", "dshdmc_selector"));
assert.equal(selector.props.disabled, false, "selector re-enabled after flush");

// ── controller write path test (B.5) ─────────────────────────────────────
const face = options.inject();
assert.equal(JSON.stringify(face.hooks.dockerMcpCard.getSnapshot()), JSON.stringify(storeState),
	"controller inject returns same snapshot store");
rejectNextProfileWrite = true;
await face.selectProfile("gamma");
tree = render(storeState);
dot = findDot(tree);
assert.equal(dot.props["aria-label"], "statusError", "dot aria-label short on action error");
assert.equal(dot.props.title, "write rejected by host", "dot title shows full error detail");
let errorP = walk(tree).find(isNode("p", "dshdmc_error"));
assert.ok(errorP, "error paragraph rendered after rejected write");
assert.equal(errorP.props.children, "write rejected by host", "error paragraph has rejection message");
// restore: one normal successful emit clears actionError → healthy → dot hidden
await face.selectProfile("alpha");
tree = render(storeState);
assert.equal(findDot(tree), undefined, "dot hidden again after successful emit (healthy)");
assert.ok(!walk(tree).find(isNode("p", "dshdmc_error")), "error paragraph gone after successful emit");

// ── controller refresh path (B.6) ─────────────────────────────────────────
// refreshProfiles writes a numeric refreshNonce, then polls the shared
// describe mirror until the host advances the served discoveryRevision
// (the host keeps the discovery state in its in-memory base layer and has
// no push channel, so the client owns the freshness).
const refreshLoadCallsBefore = mirror.loadCalls;
const refreshPromise = face.refreshProfiles();
assert.ok(
	writes.some(([f, v]) => f === "refreshNonce" && typeof v === "number"),
	"refresh writes a numeric refreshNonce"
);
assert.equal(mirror.loadCalls, refreshLoadCallsBefore, "no mirror re-read before the first poll tick");
// first poll tick (700ms) fires, then the host advances the served revision
await new Promise((resolve) => setTimeout(resolve, 900));
assert.ok(mirror.loadCalls >= refreshLoadCallsBefore + 1, "poll re-reads the settings mirror while the discovery runs");
scopeSnapshot.value = { ...scopeSnapshot.value, discoveryRevision: scopeSnapshot.value.discoveryRevision + 1 };
listeners.forEach((fn) => fn());
await refreshPromise;
assert.equal(storeState.discoveryRevision, 1, "card store picked up the advanced discovery revision");

// ── options dedup (B.7) ───────────────────────────
// healthy state: profile "alpha" is in profiles ["alpha", "beta"]
tree = render(storeState);
const menuDedup = walk(tree).find((n) => n.type === "Menu");
assert.equal(JSON.stringify(menuDedup.props.items),
	JSON.stringify([{ id: "alpha", label: "alpha" }, { id: "beta", label: "beta" }]), "items deduped when profile among discovered ids");

// ── field label ──────────────────────────────────
const fieldTitle = walk(tree).find(isNode("div", "dshdmc_fieldTitle"));
assert.ok(fieldTitle, "profile field title rendered");
assert.equal(fieldTitle.props.children, "profileLabel");
assert.ok(walk(tree).find(isNode("div", "dshdmc_fieldDesc")), "profile field description rendered");

// ── status dot (credentialDot pattern) ───────────────────────────────────
// a discovery error takes the dot's aria-label + title
Object.assign(storeState, { lastRefreshError: "docker mcp profile list failed" });
dot = findDot(render(storeState));
assert.equal(dotState(dot), "error");
assert.equal(dot.props["aria-label"], "statusError");
assert.equal(dot.props.title, "docker mcp profile list failed");

// healthy: active profile discovered, no errors → dot hidden
Object.assign(storeState, { lastRefreshError: "", actionError: "" });
assert.equal(findDot(render(storeState)), undefined, "no dot while healthy");

console.log("client.test.mjs: all assertions passed");
