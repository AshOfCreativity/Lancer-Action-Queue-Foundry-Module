# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A FoundryVTT module (`lancer-action-queue`) for the LANCER system. It adds a planning layer where a GM or player queues several actions on a combatant and fires them as a batch — aimed at high-attack-count turns (Barrage, multi-skirmish) and at GMs running many NPCs.

`ROADMAP.md` defines the phase plan and the guiding constraint:

> **Complement, don't replace.** The queue never reimplements LANCER mechanics. Firing a queued action hands off to the same flows, dialogs, and rolls that clicking the action on the actor sheet would. A user who ignores the queue should never notice it is installed.

Follow that rule when adding features: build UI/state around LANCER's flows, do not roll dice or compute LANCER math here.

The whole module is 11 files / ~2900 lines: `module.json`, five `.mjs`, one `.hbs`, one `.css`, `lang/en.json`, `ROADMAP.md`, this file. There is no README.

## Build & test

**There is no build step.** No `package.json`, no bundler, no linter, no test suite, no CI, no `.github/`. Files ship exactly as they sit on disk — `.mjs` are native ES modules loaded by the browser, `.hbs` is read at runtime by Foundry. Do not add a build pipeline without being asked; do not "fix" imports to look like they'll be bundled.

Testing is manual, in a running Foundry instance:

1. Link the repo into the Foundry data dir (Foundry is installed on this machine at `%LOCALAPPDATA%\FoundryVTT\Data`, with the `lancer` system at **v2.11.1**, itself pinned to Foundry **v12** only — `compatibility: {minimum: 12, verified: 12, maximum: 12}`). The dev link is *not* present by default; create it with `New-Item -ItemType SymbolicLink -Path "$env:LOCALAPPDATA\FoundryVTT\Data\modules\lancer-action-queue" -Target "<repo path>"`.
   The directory name **must** be `lancer-action-queue` — it must match `module.json`'s `id`, because the app resolves its template by absolute path `modules/lancer-action-queue/templates/...`.
2. Enable the module in a world running the `lancer` system, start a combat with at least one NPC combatant, and open the queue from either the Token scene-control (list icon) or the per-combatant button injected into the Combat Tracker.
3. After editing, hard-reload the Foundry client (F5). There is no hot reload for `.mjs`; Foundry does watch `.hbs` and `.json` in some configurations, but assume a reload is needed.

There is no console logging beyond two `console.log` lines on `init`/`ready`, so debugging is done from browser devtools against the live app instance.

### Releasing

Bump `version` in `module.json` — it is the only place the version lives. `manifest`/`download` both point at `main`, so **pushing `main` *is* publishing a release**; an unbumped `version` means existing installs see no update. Commit subjects follow `v0.4.2: summary`.

**Heads up — the manifest version is currently behind the history.** `module.json` says `0.4.2` while the newest commit is `v0.4.3: Drag-and-drop palette and multi-action target painting`; that commit never touched `module.json`. Bump it before relying on the version field, and compare `git log --oneline -1 -- module.json` against `git log --oneline -1` whenever a version matters.

## Architecture

### Entry point and hook wiring

`module.json` → `esmodules: ["scripts/main.mjs"]` is the single entry. `main.mjs` registers **all** hooks and holds the app singleton. Note the two registration styles used there:

- `Hooks.once("init", …)` publishes the public API onto `game.modules.get(MODULE_ID).api`.
- The `Hooks.on(…)` calls for `getSceneControlButtons`, `renderCombatTracker`, `updateCombatant`, `createCombatant`/`deleteCombatant`, `updateCombat`/`deleteCombat` sit at **module top level**, outside any lifecycle hook. They run at import time. New hooks should follow whichever of these two is appropriate — anything touching `game.*` state needs `init`/`ready`; plain registration does not.

There is exactly one `ActionQueueApp` instance, a module-scoped `let app` in `main.mjs`, created lazily by `openApp()`. Don't construct the app elsewhere.

`main.mjs` registers **no settings** — there is no `game.settings.register` anywhere in the codebase, so nothing is user-configurable yet.

### Foundry v12 API surface (breaks on v13)

`module.json` declares `compatibility: {minimum: "11", verified: "12"}` and the code commits to v12 shapes in five places. If you ever target v13, this is the migration list:

- `getSceneControlButtons` receives an **array** — `controls.find(c => c.name === "token")`, then `tokenControl.tools.push({...})`. v13 passes an object keyed by control name.
- The `renderCombatTracker` handler takes a **jQuery** `html` (`html.find(".combatant")`).
- `ActionQueueApp extends Application` — the **v1** Application, with `defaultOptions`/`getData()`/`activateListeners(html)` and jQuery in listeners.
- Dialogs use the **v1 `Dialog`** class and `Dialog.confirm()`.
- `game.user.updateTokenTargets([...ids])` in the executor.

Match the v1/v12 style unless you are deliberately migrating the whole app.

### State: combatant flags, no sockets

The queue is an **array stored on a Combatant flag**: `flags.lancer-action-queue.queue`. `scripts/queue-store.mjs` is the only module that reads or writes it; everything else goes through its exported functions.

Synchronization across clients is **entirely Foundry's document replication**, not sockets. A `setFlag` on the server broadcasts an `updateCombatant`, and `onCombatantUpdate` in `main.mjs` re-renders the open app when the changed path includes `flags.lancer-action-queue`.

`module.json` declares `"socket": true` but **nothing in the codebase uses a socket** — it is reserved for the Phase 4 "socket sync" roadmap item. Don't assume socket plumbing exists.

Three things to know before editing `queue-store.mjs`:

- Every mutation is a **read-modify-write of the whole array** followed by one `setFlag`. Concurrent edits from two clients will clobber each other, and each item add/remove/reorder is a separate server round-trip. Roadmap Phase 4 calls for batching these; if you touch this file, don't make the per-item write pattern worse.
- **`updateItem` is a shallow merge** (`{...queue[idx], ...updates}`). Passing `{payload: {targetIds}}` therefore *replaces* the whole payload — every caller spreads it first (`payload: {...item.payload, targetIds, targetNames}`). Keep doing that.
- `getDoc()` is a passthrough that documents an intended fallback to Actor flags when there's no combat. The store genuinely works with any Foundry document that has `getFlag`/`setFlag`, but the UI's `resolveHolder()` only ever looks up `game.combat.combatants`, so the Actor path is currently unreachable. Both are referred to as the "holder".

### Action ID namespaces

This is the single most load-bearing convention in the codebase. Queue items carry an `actionId` in one of four forms, and **the presence of a `:` is the discriminator** — checked as `actionId.includes(":")` in the app and `actionId.startsWith("weapon:")` etc. in the executor:

- **Standard actions** — bare IDs from `ACTION_CATALOG` in `constants.mjs` (17 of them: `skirmish`, `barrage`, `overcharge`, `custom`, …). Adding one to the catalog **requires** a matching `ACTIONQUEUE.Actions.<id>` key in `lang/en.json`, or the palette renders the raw ID.
- **Item actions** — `"<kind>:<itemId>"` where kind is `weapon`, `tech`, `system`, or `reaction`, generated by `getActorActions(actor)` from the actor's own items. These are never localized (they use the item's own name).
- **Mount actions** — `"mount:<mountIndex>"` for mech weapon mounts. Each mount fires all its slotted weapons sequentially via `getMountWeapons()`. Mount index is positional into `actor.system.loadout.weapon_mounts`. Superheavy mounts cost a full action; others cost quick. For mechs, individual `mech_weapon` items are skipped in the palette in favor of this mount-level grouping.
- **Deployable actions** — `"deployable:<actionIndex>"` for actions defined on `deployable`-type actors via `actor.system.actions`. Index is positional into that array.

`getActorActions` is where LANCER's data model is interpreted, and it is the first place to look when something doesn't appear in the palette. It branches on `item.type` (`mech_weapon`, `pilot_weapon`, `mech_system`, `pilot_gear`, `npc_feature`) and, for `npc_feature`, on `item.system.type` lowercased (`weapon`/`tech`/`reaction`/`system`/`trait`). Two filtering rules matter:

- `npc_feature` traits are surfaced as **free** actions under id `system:<itemId>` — the same namespace as systems, with a different cost and icon.
- `mech_system` and `pilot_gear` appear only when they look activatable: `system.actions.length > 0`, or (mech systems only) `system.deployables.length > 0`, or a cost tag from `TAG_COST_MAP` (`tg_full_action`, `tg_quick_action`, `tg_free_action`, `tg_protocol`, `tg_reaction`). Passive gear is deliberately hidden.

Cost resolution has two separate helpers: `resolveNpcFeatureCost` (tags → `system.type` → default quick) and `resolveMechActionCost` (`ACTIVATION_MAP[actions[0].activation]` → default quick). `getItemCost(item)` is what the economy actually reads: catalog cost for standard actions, else `payload.cost` baked in at queue time, else a namespace fallback.

### Action economy

`computeActionEconomy(queue, actor)` in `constants.mjs` tracks the budget against *pending* items only. 1 quick = 1 point, 1 full = 2 points, base budget 2, and each queued `overcharge` **adds** 1 point of budget. Reactions and protocols are counted and returned but never charged against the budget. The app renders `pointsUsed / totalBudget AP` and warns when `overBudget`.

Note `const baseBudget = isNpc ? 2 : 2;` — a no-op ternary left as a seam for diverging NPC/PC budgets. If you implement the real PC rule, that's the line.

### Smart defaults

`suggestDefaultQueue(actor)` builds a pre-filled queue from the actor's loadout. Mechs are handled first and **return early**: superheavy mount → one full-action `mount:` item; exactly one loaded mount → two quick `mount:` items; two or more → a single `barrage` carrying `mountIndices: [first, second]`.

Non-mechs collect `pilot_weapon` plus weapon-type `npc_feature` items, then one weapon → two `weapon:<id>` items, two or more → one `barrage`. Two rough edges to know before trusting this function:

- The non-mech `barrage` payload sets only `weaponId: w1.id` while `itemName` advertises `"w1 + w2"`. At fire time `executeWeaponAction` takes the `weaponId` branch and fires **just the first weapon** — the second never rolls. (The mech path, which uses `mountIndices`, does fire both.)
- The `actor.type === "deployable"` branch sits *after* `if (weapons.length === 0) return suggestions;`, so a deployable with no weapon items never reaches it and gets no suggestions at all. Deployable `system.actions` suggestions only appear for deployables that also happen to carry weapons.

### Execution and target pre-filling

`scripts/executor.mjs` `fireQueue(holder)` walks the queue in order, skips anything not `pending`, dispatches each item, and marks it `fired`. It fires **one holder's queue only** — the Phase 2 "fire every combatant in initiative order" item is not implemented. Dispatch fans out by action-ID namespace, then calls into LANCER's flow methods.

**Every LANCER flow call is guarded by `typeof x === "function"`** — `beginWeaponAttackFlow`, `beginTechAttackFlow`, `beginSystemFlow`, `beginDefaultFlow` on items; `beginBasicAttackFlow`, `beginBasicTechAttackFlow`, `beginStabilizeFlow`, `beginOverchargeFlow` on actors. This is deliberate: the module supports a range of LANCER system versions and must degrade gracefully rather than throw. When a flow is missing, or the action has no flow at all (boost, hide, search, disengage, brace, protocol, custom), `postFallbackCard()` posts a plain chat card instead. **Keep new flow integrations feature-detected the same way.**

Returning `false` from an item's execution means "cancelled/aborted" and leaves the item `pending`; any other return marks it `fired`. The multi-weapon paths (`mount:`, mech `barrage`) `await` each weapon flow but always return `true`, so a cancelled sub-roll still marks the item fired.

**Target pre-filling works off `payload.targetIds`, not `targetNames`.** `withQueueTargets(payload, fn)` resolves each id through `canvas.tokens.get(id)`, calls `game.user.updateTokenTargets(...)`, invokes the flow, and restores the original targets in a `finally` block. That feeds LANCER's AccDiffHUD so the chosen targets are pre-selected in the attack dialog (which still opens for confirmation).

The consequence worth remembering: **`targetIds` are canvas token ids, and only the target picker and paint mode write them.** The config dialog's free-text "Target(s)" field writes `targetNames` alone, so names typed there render as a meta pill and *never* reach the roll. `accuracy` and `difficulty` are likewise collected into the payload, shown as pills, and never passed to any flow.

### The app class

`ActionQueueApp` (`scripts/ActionQueueApp.mjs`, ~1000 lines) is the bulk of the module. Rendering is coarse: nearly every handler ends in `this.render(false)`, re-running `getData` and rebuilding the DOM. Roadmap Phase 4 wants these debounced.

`getData()` does all the presentation work — grouping combatants into player/NPC/defeated sections, mapping raw queue items to display shape (localized name, icon, status label, meta pills), and building the two palettes (actor actions first, then the standard catalog), both filtered by `this.filterCategory`. It also stashes `this._actorActionsCache`, which **both** add paths (click and drop) read back to build an actor-action payload — so those handlers depend on `getData` having run for the currently selected combatant.

**Permissions** live in two small helpers, and both must be respected by new features:
- `_visibleCombatants()` — GM sees all combatants; a player sees only those whose actor they own.
- `canEditCombatant()` — GM, or the actor's owner. Every mutating handler re-checks this; the template also gates the buttons behind `selectedCombatant.canEdit`. These are UI guards only — Foundry's own document permissions are the real enforcement on `setFlag`.

#### Adding actions: click and drag are not equivalent

Two entry points add palette actions, and they intentionally differ:

- **Click** (`_onAddAction`) — actor actions are added straight from `_actorActionsCache`; every *standard* action opens `_showConfigDialog` first, even non-attacks that have nothing to configure but notes.
- **Drag** (`_initPaletteDragDrop`) — palette cards get `draggable` set in JS and serialize `{type: "palette-action", actionId, actorAction, icon, cost}` into `dataTransfer` as `application/json`; the drop zone is `[data-drop-zone="queue"]`. Standard non-attack actions (anything but `custom`) **skip the config dialog entirely** and are added with an empty payload. Attacks and `custom` still get the dialog.

The two drag systems are separate and use different `dataTransfer` types: palette→queue is `application/json`, queue reordering (`_initQueueDragDrop`) is `text/plain` carrying the item id, with insert-above/below computed from the pointer's position relative to the row midpoint. Both are native HTML5 drag events bound directly to DOM nodes, not Foundry's `DragDrop` helper.

#### Target painting is DOM state, and a render destroys it

`_onPaintTargets` is a two-phase toggle on one button. The first click enters paint mode: it adds `.painting` to the button, **rewrites the button's innerHTML to "Apply"**, and binds a namespaced `click.paint` handler on `.aq-queue-item` rows that toggles `.aq-paint-selected`. The second click gathers the selected rows plus the user's canvas targets (falling back to controlled tokens) and writes `targetIds`/`targetNames` onto every selected item.

All of that state lives in the DOM, not in a field that survives `getData`. `activateListeners` resets `this._paintMode = false` and the template re-renders the button fresh, so **any `render()` silently drops paint mode mid-interaction** — including a `render` triggered by another client's `updateCombatant`. If you extend painting, promote the mode and the selection into instance state and have the template render them.

#### Hand-built dialog HTML

`_showConfigDialog`, `_showNotesDialog`, and `_showTargetPicker` all build their HTML as template strings rather than `.hbs` files, each wrapped in a `Promise` that resolves from the button callbacks and from `close`. Interpolated values go through a local `escHTML()`; `executor.mjs` carries its own near-identical copy named `escape()` (which shadows the global `escape`). **Any user-supplied string injected into these strings must be escaped.** The one intentional exception is `executeDeployableAction`, which escapes `action.name` but passes `action.trigger`/`action.detail` through raw because LANCER stores HTML in those fields.

`_showConfigDialog` is where the mech/non-mech split surfaces in the UI: for a mech queuing `skirmish`/`barrage` it renders **mount** selects (one for skirmish, two for barrage, collapsed to a single locked select when a Superheavy mount exists); for everything else it renders a flat weapon select built by `_collectWeapons`, which only returns `pilot_weapon` and weapon-type `npc_feature` items.

### Templates and styles

There is one template, `templates/action-queue-app.hbs`, referenced by absolute Foundry path in `defaultOptions`. **No partials are registered and `loadTemplates` is never called** — if you split the template up, you must add a `loadTemplates([...])` call in the `init` hook and register the partials yourself.

The template is a three-column CSS grid (combatants 220px / palette `1fr` / queue 320px) defined in `styles/action-queue.css`. Class names are all `aq-`-prefixed; the window itself gets `classes: ["lancer", "action-queue-app"]`. The stylesheet hardcodes a dark palette — ~90 literal hex colors, with `var(--font-primary, sans-serif)` as the *only* Foundry theme variable borrowed — so new UI should stay inside that palette rather than inheriting.

Note the template's use of `{{#each}}…{{else}}` for empty states and `{{../selectedCombatant.canEdit}}` to reach the parent scope from inside the item loop. Queue rows carry `draggable="true"` in markup while palette cards get it set from JS.

### Localization

All user-facing strings go through `game.i18n.localize` / `format` under the single `ACTIONQUEUE.*` namespace in `lang/en.json`, sub-grouped as `Combatants`, `Palette`, `Queue`, `Config`, `Economy`, `Suggest`, `Actions`, `Notifications`. English is the only language shipped. Three key families are derived dynamically and must exist for every enum value you add:
- `ACTIONQUEUE.Actions.<actionId>` for each `ACTION_CATALOG` entry
- `ACTIONQUEUE.Palette.Categories.<category>` for each `ACTION_CATEGORIES` value (plus `all`)
- `ACTIONQUEUE.Queue.Status.<status>` for each `QUEUE_ITEM_STATUS` value

All three are currently complete — keep them that way.

A number of strings are still hardcoded in the template and dialogs ("Standard Actions", "Drag actions here", "No actions match this filter", "Action Name", "Mount 1"/"Mount 2" and their hints, "Edit Notes — …", "Use selected tokens", and every paint-mode notification). Prefer adding keys over adding more of these.

### Extension points for other modules

Two public surfaces exist and should be treated as API — changing them breaks downstream consumers:

- `game.modules.get("lancer-action-queue").api` — exposes `open`, `fireQueue`, `suggestDefaultQueue`, `computeActionEconomy`, and a `queue` object wrapping the store (`get`/`add`/`update`/`remove`/`reorder`/`clear`/`setStatus`).
- `Hooks.callAll("actionQueue.buildMetaPills", pills, item, holder)` — fired at the end of `_buildMetaPills` so another module can push extra `{ label, type? }` pills onto a queue item's display row. `type` becomes a `pill-<type>` CSS class (`pill-target` and `pill-cost` exist). This exists specifically for cross-module integration; keep the mutable-array contract.

## Roadmap status

Implemented: actor-aware palette, mounts, deployables, smart defaults, action economy, target picker, AccDiffHUD target pre-fill, palette drag-and-drop, multi-action target painting.

Still open from `ROADMAP.md`: range/position-based target auto-suggestion, tier-based accuracy pre-fill, accuracy/difficulty actually reaching the roll, multi-combatant fire in initiative order, a "planned" indicator in the Combat Tracker, click-a-token-on-canvas targeting, batched flag writes, debounced renders, socket sync, saved queue templates, and keyboard shortcuts.
