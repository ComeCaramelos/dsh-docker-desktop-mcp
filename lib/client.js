window.__ModuleLoader__.load({
	id: "@comecaramelos/dsh-docker-desktop-mcp",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var react = require("react");
		var reactJsx = require("react/jsx-runtime");
		var clientStore = require("@deepseek-ai/dsh-client-store");
		// Shell-provided UI primitives (Menu popup) — the same module the
		// stock settings packages require through the whitelisted loader.
		var primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		/**
		 * Docker Desktop MCP profile picker, browser half.
		 *
		 * Registers one card into the shared `settings.plugin.item` slot
		 * (Settings → Plugins → Plugin configuration), keyed by the
		 * `docker-desktop-mcp` settings namespace the host half serves.
		 * The card shows the active gateway `--profile` as a select over
		 * the profile ids discovered from `docker mcp profile list` via the
		 * stock pill selector (primitives.Menu), plus a refresh button. Selecting a profile writes the persisted `profile`
		 * field immediately; the host half restarts the gateway with it, and
		 * the same value is what the next (re)connect starts with. The host
		 * keeps the discovery results in its in-memory base layer (never
		 * persisted) and has no push channel of its own — module plugins
		 * cannot register `harness.handle` — so a refresh re-reads the shared
		 * settings mirror until the served `discoveryRevision` advances. A
		 * status dot (credentialDot pattern) sits next to the title while a
		 * discovery or action error is present, or the active profile is
		 * missing from the discovered ids (the gateway then runs with an empty
		 * configuration); while healthy it is hidden. The
		 * card is collapsible like the stock plugin cards: closed by
		 * default, with the header as its disclosure button.
		 */
		/** Settings namespace served by the host half; also the slot key. */
		var NS = "docker-desktop-mcp";
		/** Locale dictionary namespace. */
		var LOCALE_NS = "dockerDesktopMcp";
		/** Required services (cordis fiber inject). */
		var inject = ["slots", "locale", "settingsScope"];

		// ── card styles ────────────────────────────────────────────────────
		var CSS = {
			card: "dshdmc_card",
			cardOpen: "dshdmc_cardOpen",
			header: "dshdmc_header",
			headText: "dshdmc_headText",
			nameRow: "dshdmc_nameRow",
			name: "dshdmc_name",
			desc: "dshdmc_desc",
			chevron: "dshdmc_chevron",
			chevronOpen: "dshdmc_chevronOpen",
			body: "dshdmc_body",
			field: "dshdmc_field",
			rowText: "dshdmc_rowText",
			fieldTitle: "dshdmc_fieldTitle",
			selector: "dshdmc_selector",
			selectorWrap: "dshdmc_selectorWrap",
			pillChevron: "dshdmc_pillChevron",
			fieldDesc: "dshdmc_fieldDesc",
			row: "dshdmc_row",
			button: "dshdmc_button",
			readOnly: "dshdmc_readOnly",
			error: "dshdmc_error",
			dot: "dshdmc_dot",
			dotError: "dshdmc_dotError",
			empty: "dshdmc_empty"
		};
		var css =
			"." + CSS.card + "{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none;transition:border-color .16s,background .16s}" +
			"." + CSS.card + ":hover{border-color:var(--dsw-alias-label-dimmed)}" +
			"." + CSS.cardOpen + "{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}" +
			"." + CSS.header + "{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}" +
			"." + CSS.header + ":focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}" +
			"." + CSS.headText + "{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}" +
			"." + CSS.nameRow + "{align-items:center;gap:8px;min-width:0;display:flex}" +
			"." + CSS.name + "{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}" +
			"." + CSS.desc + "{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}" +
			"." + CSS.chevron + "{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}" +
			"." + CSS.chevronOpen + "{transform:rotate(180deg)}" +
			"." + CSS.body + "{border-top:.5px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:10px;margin:0 16px;padding:12px 0}" +
			// Stock permission-row layout (oY77xG): text column left, pill
			// right, vertically centered. Border/padding of the stock row are
			// dropped — our body already provides the card's row rhythm.
			"." + CSS.field + "{align-items:center;gap:8px;display:flex}" +
			"." + CSS.rowText + "{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}" +
			"." + CSS.fieldTitle + "{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}" +
			"." + CSS.selector +
			"{background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);" +
			"cursor:pointer;border:none;border-radius:18px;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}" +
			"." + CSS.selector + ":hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}" +
			"." + CSS.selector + ":disabled{cursor:default}" +
			// The Menu primitive wraps its anchor in its own inline-flex root
			// span (_root); as a grid item that span blockifies and stretches
			// to the column width, so the portal list would anchor to the
			// stretched box instead of the pill. The flex wrapper keeps the
			// root span at the pill's natural size.
			"." + CSS.selectorWrap + "{display:flex}" +
			"." + CSS.pillChevron + "{flex:none}" +
			"." + CSS.fieldDesc + "{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}" +
			"." + CSS.row + "{display:flex;gap:10px;align-items:center}" +
			// Stock Button primitive, outline + sm variants (cfgyt module),
			// byte-for-byte: display/align/gap/base color from _button,
			// border+bg from _outline, size overrides from _sm.
			"." + CSS.button +
			"{display:inline-flex;align-items:center;justify-content:center;gap:4px;border:.5px solid var(--dsw-alias-border-l3);" +
			"border-radius:14px;cursor:pointer;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);" +
			"background:transparent;padding:0 10px;height:28px}" +
			"." + CSS.button + ":hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}" +
			"." + CSS.button + ":disabled{cursor:not-allowed;opacity:.4}" +
			"." + CSS.button + ":focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}" +
			"." + CSS.readOnly + "{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}" +
			"." + CSS.error + "{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:1.5}" +
			"." + CSS.dot + "{box-sizing:border-box;corner-shape:round;border-radius:50%;flex:none;width:8px;height:8px;display:inline-block}" +
			"." + CSS.dotError + "{background:var(--dsw-alias-state-error-primary)}" +
			"." + CSS.empty + "{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}";
		var TAG_ID = "@comecaramelos/dsh-docker-desktop-mcp/DockerMcpCard.module.css";
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + TAG_ID + '"]') === null) {
			var tag = document.createElement("style");
			tag.dataset.plugin = "@comecaramelos/dsh-docker-desktop-mcp";
			tag.dataset.pluginCss = TAG_ID;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		// ── locale dictionaries ────────────────────────────────────────────
		var en = {
			title: "Docker Desktop MCP",
			description: "Profile for the docker mcp gateway connection",
			profileLabel: "Profile",
			hint: "Selecting a profile reconnects the Docker MCP gateway.",
			refresh: "Refresh profiles",
			refreshing: "Refreshing…",
			readOnly: "Settings are read-only in this deployment.",
			empty: "No profiles discovered yet. Use “Refresh profiles” once `docker mcp profile` is available.",
			statusMissing: "Profile not found",
			statusError: "Error",
			expand: "Expand",
			collapse: "Collapse"
		};
		var zh = {
			title: "Docker Desktop MCP",
			description: "docker mcp 网关连接使用的配置文件",
			profileLabel: "配置文件",
			hint: "选择配置文件后会重新连接 Docker MCP 网关。",
			refresh: "刷新配置文件",
			refreshing: "刷新中…",
			readOnly: "本部署的设置为只读。",
			empty: "尚未发现配置文件。`docker mcp profile` 可用后点击“刷新配置文件”。",
			statusMissing: "配置文件未找到",
			statusError: "错误",
			expand: "展开",
			collapse: "收起"
		};

		// ── card controller ────────────────────────────────────────────────
		/** Re-describe cadence (ms) while waiting for the host's discovery run. */
		var DISCOVERY_POLL_TICK_MS = 700;
		/** Give up waiting for the discovery revision to advance after this (ms). The host discovery subprocess times out at 15s. */
		var DISCOVERY_POLL_TIMEOUT_MS = 20000;
		/**
		 * Projects the bound `docker-desktop-mcp` settings scope onto a
		 * snapshot store the card reads through its `useDockerMcpCard` hook,
		 * and owns the two write actions (select profile, refresh list).
		 * `mirror` is the shared settings describe mirror
		 * (`settingsScope.describe()`) the refresh action re-reads while the
		 * host's in-memory discovery state is still en route.
		 */
		var DockerMcpCardController = class {
			constructor(scope, mirror) {
				this.scope = scope;
				this.mirror = mirror;
				this.disposed = false;
				this.pollTimer = null;
				this.store = clientStore.createSnapshotStore({
					available: false,
					writable: false,
					profile: "",
					profiles: [],
					lastRefreshError: "",
					discoveryRevision: 0,
					actionError: ""
				});
				this.unsubscribe = scope.subscribe(() => this.publish());
				this.publish();
			}
			/** Republish the latest scope snapshot into the card store. */
			publish() {
				if (this.disposed) return;
				var previous = this.store.getSnapshot();
				var snapshot = this.scope.getSnapshot();
				if (snapshot.status !== "ready" || snapshot.value === void 0) {
					this.store.set({
						available: false,
						writable: false,
						profile: "",
						profiles: [],
						lastRefreshError: "",
						discoveryRevision: 0,
						actionError: previous.actionError
					});
					return;
				}
				var value = snapshot.value;
				this.store.set({
					available: true,
					writable: snapshot.writable === true,
					profile: typeof value.profile === "string" ? value.profile : "",
					profiles: Array.isArray(value.profiles) ? value.profiles : [],
					lastRefreshError: value.lastRefreshError ?? "",
					discoveryRevision: typeof value.discoveryRevision === "number" ? value.discoveryRevision : 0,
					actionError: ""
				});
			}
			/** Stage-less immediate write of the selected profile (persisted; the next connect starts with it). */
			selectProfile(profile) {
				return this.scope.set("profile", profile).catch((error) => this.noteError(error));
			}
			/**
			 * Ask the host to re-run `docker mcp profile list`, then wait
			 * for the result. The host keeps the discovery state in its
			 * in-memory base layer (never persisted) and module plugins have
			 * no client→host push channel, so the only freshness lever the
			 * client owns is re-reading the shared settings mirror until the
			 * served `discoveryRevision` advances past the click-time value
			 * — or the discovery timeout budget elapses.
			 */
			refreshProfiles() {
				if (this.disposed) return Promise.resolve();
				var baseline = this.store.getSnapshot().discoveryRevision;
				var wait = this.waitForDiscovery(baseline, Date.now() + DISCOVERY_POLL_TIMEOUT_MS);
				return this.scope
					.set("refreshNonce", Date.now())
					.catch((error) => this.noteError(error))
					.then(() => wait);
			}
			/** Re-describe the settings mirror every tick until the discovery revision advances or the deadline passes. */
			waitForDiscovery(baseline, deadline) {
				var controller = this;
				return new Promise((resolve) => {
					var timer;
					var settled = false;
					var arm = (delay) => {
						timer = setTimeout(tick, delay);
						controller.pollTimer = timer;
					};
					var finish = () => {
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						if (controller.pollTimer === timer) controller.pollTimer = null;
						resolve();
					};
					var satisfied = () =>
						controller.store.getSnapshot().discoveryRevision > baseline || Date.now() >= deadline;
					var tick = () => {
						if (controller.disposed || satisfied()) {
							finish();
							return;
						}
						var loaded;
						try {
							loaded = controller.mirror.load();
						} catch (error) {
							loaded = void 0; // mirror read failure: the next tick retries
						}
						Promise.resolve(loaded)
							.catch(() => {})
							.then(() => {
								if (controller.disposed || satisfied()) {
									finish();
									return;
								}
								arm(DISCOVERY_POLL_TICK_MS);
							});
					};
					arm(DISCOVERY_POLL_TICK_MS);
				});
			}
			noteError(error) {
				if (this.disposed) return;
				var previous = this.store.getSnapshot();
				this.store.set({
					...previous,
					actionError: error != null && typeof error.message === "string" ? error.message : String(error)
				});
			}
			/** The face the card's slot registration injects. */
			inject() {
				return {
					hooks: { dockerMcpCard: this.store },
					selectProfile: (profile) => this.selectProfile(profile),
					refreshProfiles: () => this.refreshProfiles()
				};
			}
			dispose() {
				this.disposed = true;
				if (this.pollTimer !== null) {
					clearTimeout(this.pollTimer);
					this.pollTimer = null;
				}
				this.unsubscribe();
			}
		};

		// ── card component ─────────────────────────────────────────────────
		/** Chevron matching the shell's IconChevronDownOutline14 primitive. */
		var CHEVRON_PATH =
			"M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z";

		/**
		 * Render the Docker Desktop MCP profile card. Collapsible like the
		 * stock plugin cards: the header is a disclosure button (closed by
		 * default) and the profile controls live in the body.
		 * @param props - locale copy, the card snapshot hook, and its actions.
		 * @returns the card, or nothing until the namespace is served.
		 */
		function DockerMcpCard(props) {
			var t = props.t;
			var state = props.useDockerMcpCard((snapshot) => snapshot);
			var menuOpenState = react.useState(false);
			var menuOpen = menuOpenState[0];
			var setMenuOpen = menuOpenState[1];
			var openState = react.useState(false);
			var open = openState[0];
			var setOpen = openState[1];
			var refreshing = react.useState(false);
			var isRefreshing = refreshing[0];
			var setRefreshing = refreshing[1];
			var bodyId = react.useId();
			if (!state.available) return null;
			// Current profile always stays selectable, discovered ids first.
			var options = [...state.profiles, state.profile].filter(
				(id, index, all) => typeof id === "string" && id !== "" && all.indexOf(id) === index
			);
			var disabled = !state.writable || isRefreshing;
			// Header status dot (credentialDot pattern): red while a
			// discovery/action error is present, or the active profile is
			// absent from the discovered ids (gateway runs with an empty
			// configuration); hidden while healthy.
			var error = state.lastRefreshError || state.actionError || "";
			var missing = error === "" && state.profiles.indexOf(state.profile) === -1;
			var dotLabel = error !== "" ? error : t("statusMissing");
			var dotAria = error !== "" ? t("statusError") : t("statusMissing");
			return (0, reactJsx.jsx)("li", {
				className: CSS.card + (open ? " " + CSS.cardOpen : ""),
				children: [
					(0, reactJsx.jsxs)("button", {
						type: "button",
						className: CSS.header,
						"aria-expanded": open,
						"aria-label": t(open ? "collapse" : "expand") + ": " + t("title"),
						"aria-controls": bodyId,
						onClick: () => {
							setOpen(!open);
						},
						children: [
							(0, reactJsx.jsxs)("span", {
								className: CSS.headText,
								children: [
									(0, reactJsx.jsxs)("div", {
										className: CSS.nameRow,
										children: [
											(0, reactJsx.jsx)("span", { className: CSS.name, children: t("title") }),
											error !== "" || missing
												? (0, reactJsx.jsx)("span", {
													className: CSS.dot + " " + CSS.dotError,
													role: "img",
													"aria-label": dotAria,
													title: dotLabel
												})
												: null
										]
									}),
									(0, reactJsx.jsx)("span", { className: CSS.desc, children: t("description") })
								]
							}),
							(0, reactJsx.jsx)("svg", {
								width: 14,
								height: 14,
								className: CSS.chevron + (open ? " " + CSS.chevronOpen : ""),
								viewBox: "0 0 14 14",
								fill: "none",
								xmlns: "http://www.w3.org/2000/svg",
								children: (0, reactJsx.jsx)("path", { d: CHEVRON_PATH, fill: "currentColor" })
							})
						]
					}),
					open
						? (0, reactJsx.jsxs)("div", {
								id: bodyId,
								className: CSS.body,
								children: [
									!state.writable
										? (0, reactJsx.jsx)("p", { className: CSS.readOnly, role: "status", children: t("readOnly") })
										: null,
									(0, reactJsx.jsxs)("div", {
										className: CSS.field,
										children: [
											(0, reactJsx.jsxs)("div", {
												className: CSS.rowText,
												children: [
													(0, reactJsx.jsx)("div", { className: CSS.fieldTitle, children: t("profileLabel") }),
													(0, reactJsx.jsx)("div", { className: CSS.fieldDesc, children: t("hint") })
												]
											}),
											(0, reactJsx.jsx)("span", { className: CSS.selectorWrap, children: (0, reactJsx.jsx)(primitives.Menu, {
												open: menuOpen,
												onClose: () => {
													setMenuOpen(false);
												},
												items: options.map((id) => ({ id: id, label: id })),
												selectedId: state.profile,
												onSelect: (id) => {
													setMenuOpen(false);
													if (id === state.profile) return;
													props.selectProfile(id);
												},
												align: "end",
												portal: true,
												anchor: (0, reactJsx.jsxs)("button", {
													type: "button",
													className: CSS.selector,
													"aria-haspopup": "menu",
													"aria-expanded": menuOpen,
													disabled: disabled,
													onClick: () => {
														setMenuOpen(!menuOpen);
													},
													children: [
														state.profile,
														(0, reactJsx.jsx)("svg", {
															width: 14,
															height: 14,
															className: CSS.pillChevron,
															viewBox: "0 0 14 14",
															fill: "none",
															xmlns: "http://www.w3.org/2000/svg",
															children: (0, reactJsx.jsx)("path", { d: CHEVRON_PATH, fill: "currentColor" })
														})
													]
												})
											})
											}),
										]
									}),
									state.profiles.length === 0
										? (0, reactJsx.jsx)("p", { className: CSS.empty, children: t("empty") })
										: null,
									(0, reactJsx.jsxs)("div", {
										className: CSS.row,
										children: [
											(0, reactJsx.jsx)("button", {
												type: "button",
												className: CSS.button,
												disabled: !state.writable || isRefreshing,
												onClick: () => {
													setRefreshing(true);
													var refreshPromise;
													try {
														refreshPromise = props.refreshProfiles();
													} catch (error) {
														refreshPromise = Promise.reject(error);
													}
													if (refreshPromise == null || typeof refreshPromise.finally !== "function") {
														refreshPromise = Promise.resolve(refreshPromise);
													}
													refreshPromise.finally(() => setRefreshing(false));
												},
												children: isRefreshing ? t("refreshing") : t("refresh")
											})
										]
									}),
									state.lastRefreshError
										? (0, reactJsx.jsx)("p", { className: CSS.error, role: "status", children: state.lastRefreshError })
										: null,
									state.actionError
										? (0, reactJsx.jsx)("p", { className: CSS.error, role: "status", children: state.actionError })
										: null
								]
							})
						: null
				]
			});
		}

		// ── plugin body ────────────────────────────────────────────────────
		/**
		 * Mount the profile card.
		 * @param ctx - the browser plugin context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(LOCALE_NS, { en, zh }), "docker-desktop-mcp: dictionaries");
			var binder = ctx.settingsScope;
			var scope = binder.bind({ namespace: NS });
			// The shared describe mirror: the refresh action re-reads it while
			// the host's in-memory discovery state is en route.
			var controller = new DockerMcpCardController(scope, binder.describe());
			ctx.effect(
				() => () => controller.dispose(),
				"docker-desktop-mcp: card controller"
			);
			ctx.slots.inject("settings.plugin.item", () =>
				ctx.slots.register(
					{
						name: "settings.plugin.item",
						key: NS,
						locale: LOCALE_NS,
						inject: () => controller.inject()
					},
					DockerMcpCard
				)
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
