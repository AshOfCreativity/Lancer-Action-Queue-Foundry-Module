# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A FoundryVTT module (`lancer-action-queue`) for the LANCER system. It adds a planning layer where a GM or player queues several actions on a combatant and fires them as a batch — aimed at high-attack-count turns (Barrage, multi-skirmish) and at GMs running many NPCs.

Currently **v0.2.0, pre-release**. `ROADMAP.md` defines the phase plan (v0.2 targeting/defaults, v0.3 execution, v0.4 player side, v0.5+ polish) and the guiding constraint:

> **Complement, don't replace.** The queue never reimplements LANCER mechanics. Firing a queued action hands off to the same flows, dialogs, and rolls that clicking the action on the actor sheet would. A user who ignores the queue should never notice it is installed.

Follow that rule when adding features: build UI/state around LANCER's flows, do not roll dice or compute LANCER math here.

## Build & test

**There is no build step.** No `package.json`, no bundler, no linter, no test suite, no CI. Files ship exactly as they sit on disk — `.mjs` are native ES modules loaded by the browser, `.hbs` is read at runtime by Foundry. Do not add a build pipeline without being asked; do not "fix" imports to look like they'll be bundled.

Testing is manual, in a running Foundry instance:

1. Link the repo into the Foundry data dir (Foundry is installed here at `%LOCALAPPDATA%\FoundryVTT\Data`, with the `lancer` system at v2.11.1 on Foundry v12):
   ```powershell
   New-Item -ItemType SymbolicLink `
     -Path "$env:LOCALAPPDATA\FoundryVTT\Data\modules\lancer-action-queue" `
     -Target "<repo path>"
   ```
   The directory name **must** be `lancer-action-queue` — it must match `module.json`'s `id`, because the app resolves its template by absolute path `modules/lancer-action-queue/templates/...`.
2. Enable the module in a world running the `lancer` system, start a combat with at least one NPC combatant, and open the queue from either the Token scene-control (list icon) or the per-combatant button injected into the Combat Tracker.
3. After editing, hard-reload the Foundry client (F5). There is no hot reload for `.mjs`; Foundry does watch `.hbs` and `.json` in some configurations, but assume a reload is needed.

Bump `version` in `module.json` when releasing — it is the only place the version lives. Commit subjects follow `v0.2.0: summary` for releases.

## Architecture

### Entry point and hook wiring

`module.json` → `esmodules: ["scripts/main.mjs"]` is the single entry. `main.mjs` registers **all** hooks and holds the app singleton. Note the two registration styles used there:

- `Hooks.once("init", …)` publishes the public API onto `game.modules.get(MODULE_ID).api`.
- The `Hooks.on(…)` calls for `getSceneControlButtons`, `renderCombatTracker`, `updateCombatant`, `createCombatant`/`deleteCombatant`, `updateCombat`/`deleteCombat` sit at **module top level**, outside any lifecycle hook. They run at import time. New hooks should follow whichever of these two is appropriate — anything touching `game.*` state needs `init`/`ready`; plain registration does not.

There is exactly one `ActionQueueApp` instance, a module-scoped `let app` in `main.mjs`, created lazily by `openApp()`. Don't construct the app elsewhere.

### State: combatant flags, no sockets

The queue is an **array stored on a Combatant flag**: `flags.lancer-action-queue.queue`. `scripts/queue-store.mjs` is the only module that reads or writes it; everything else goes through its exported functions.

Synchronization across clients is **entirely Foundry's document replication**, not sockets. A `setFlag` on the server broadcasts an `updateCombatant`, and `onCombatantUpdate` in `main.mjs` re-renders the open app when the changed path includes `flags.lancer-action-queue`.

`module.json` declares `"socket": true` but **nothing in the codebase uses a socket** — it is reserved for the Phase 4 "socket sync" roadmap item. Don't assume socket plumbing exists.

Two consequences worth knowing before editing `queue-store.mjs`:

- Every mutation is a **read-modify-write of the whole array** followed by one `setFlag`. Concurrent edits from two clients will clobber each other, and each item add/remove/reorder is a separate server round-trip. Roadmap Phase 4 calls for batching these; if you touch this file, don't make the per-item write pattern worse.
- `getDoc()` is a passthrough that documents an intended fallback to Actor flags when there's no combat. The store genuinely works with any Foundry document that has `getFlag`/`setFlag`, but the UI's `resolveHolder()` only ever looks up `game.combat.combatants`, so the Actor path is currently unreachable. Both are referred to as the "holder".

### Action ID namespaces

This is the single most load-bearing convention in the codebase. Queue items carry an `actionId` in one of two forms, and **the presence of a `:` is the discriminator** — checked as `actionId.includes(":")` in the app and `actionId.startsWith("weapon:")` etc. in the executor:

- **Standard actions** — bare IDs from `ACTION_CATALOG` in `constants.mjs` (`skirmish`, `barrage`, `overcharge`, `custom`, …). Adding one to the catalog **requires** a matching `ACTIONQUEUE.Actions.<id>` key in `lang/en.json`, or the palette renders the raw ID.
- **Actor actions** — `"<kind>:<itemId>"` where kind is `weapon`, `tech`, `system`, or `reaction`, generated by `getActorActions(actor)` from the actor's own items. These are never localized (they use the item's own name) and bypass the config dialog, getting only a notes editor.

`getActorActions` is where LANCER's data model is interpreted: it branches on `item.type` (`mech_weapon`, `pilot_weapon`, `mech_system`, `npc_feature`) and, for `npc_feature`, on `item.system.type` lowercased (`weapon`/`tech`/`reaction`/`system`/`trait`). If NPC features aren't showing up in the palette, this function is where to look.

### Execution: feature-detected LANCER flows

`scripts/executor.mjs` `fireQueue(holder)` walks the queue in order, skips anything not `pending`, dispatches each item, and marks it `fired`. Dispatch fans out by action-ID namespace, then calls into LANCER's flow methods.

**Every LANCER flow call is guarded by `typeof x === "function"`** — `beginWeaponAttackFlow`, `beginTechAttackFlow`, `beginSystemFlow`, `beginDefaultFlow` on items; `beginBasicAttackFlow`, `beginBasicTechAttackFlow`, `beginStabilizeFlow`, `beginOverchargeFlow` on actors. This is deliberate: the module supports a range of LANCER system versions and must degrade gracefully rather than throw. When a flow is missing, or the action has no flow at all (boost, hide, search, disengage, brace, protocol, custom), `postFallbackCard()` posts a plain chat card instead. **Keep new flow integrations feature-detected the same way.**

**Known gap (Phase 2 work):** the config dialog collects `weaponId`, `targetNames`, `accuracy`, and `difficulty` into `item.payload`, but the executor invokes flows with **no arguments** (the one exception is `beginBasicAttackFlow(title)`). Pre-configured targets and accuracy are therefore display-only today — they render as meta pills but do not reach the roll. Wiring the payload into `WeaponAttackFlow`/`BasicAttackFlow` is the headline Phase 2 item in `ROADMAP.md`.

Returning `false` from an item's execution means "cancelled/aborted" and leaves the item `pending`; any other return marks it `fired`.

### The app class

`ActionQueueApp` extends Foundry's **v1 `Application`**, not `ApplicationV2`, and uses the v1 lifecycle throughout: `defaultOptions` with a `template` path, `getData()` building the render context, `activateListeners(html)` binding jQuery handlers. `html` in listener code is a jQuery object (`html.find(…)`), and dialogs are built with the v1 `Dialog` class. Match that style unless you're deliberately migrating the whole app.

Rendering is coarse: nearly every handler ends in `this.render(false)`, re-running `getData` and rebuilding the DOM. Roadmap Phase 4 wants these debounced.

`getData()` does all the presentation work — grouping combatants into player/NPC/defeated sections, mapping raw queue items to display shape (localized name, icon, status label, meta pills), and building the two palettes (actor actions first, then the standard catalog), both filtered by `this.filterCategory`.

**Permissions** live in two small helpers, and both must be respected by new features:
- `_visibleCombatants()` — GM sees all combatants; a player sees only those whose actor they own.
- `canEditCombatant()` — GM, or the actor's owner. Every mutating handler re-checks this; the template also gates the buttons behind `selectedCombatant.canEdit`. These are UI guards only — Foundry's own document permissions are the real enforcement on `setFlag`.

The config dialog (`_showConfigDialog`) builds its HTML as a template string rather than a `.hbs` file, and manually escapes interpolated values via a local `escHTML()`. `executor.mjs` has its own near-identical copy named `escape()` (which shadows the global `escape`). Any user-supplied string injected into these strings must be escaped.

Drag-to-reorder (`_initQueueDragDrop`) uses native HTML5 drag events bound directly to DOM nodes, not Foundry's `DragDrop` helper, and computes insert-above/below from the pointer's position relative to the row midpoint.

### Templates and styles

There is one template, `templates/action-queue-app.hbs`, referenced by absolute Foundry path in `defaultOptions`. **No partials are registered and `loadTemplates` is never called** — if you split the template up, you must add a `loadTemplates([...])` call in the `init` hook and register the partials yourself.

The template is a three-column CSS grid (combatants / palette / queue) defined in `styles/action-queue.css`. Class names are all `aq-`-prefixed; the window itself gets `classes: ["lancer", "action-queue-app"]`. The stylesheet hardcodes a dark palette rather than using Foundry theme variables (only `--font-primary` is borrowed), so new UI should stay inside that palette rather than inheriting.

Note the template's use of `{{#each}}…{{else}}` for empty states and `{{../selectedCombatant.canEdit}}` to reach the parent scope from inside the item loop.

### Localization

All user-facing strings go through `game.i18n.localize` / `format` under the single `ACTIONQUEUE.*` namespace in `lang/en.json`, sub-grouped as `Combatants`, `Palette`, `Queue`, `Config`, `Actions`, `Notifications`. Two keys are derived dynamically and must exist for every enum value you add:
- `ACTIONQUEUE.Actions.<actionId>` for each `ACTION_CATALOG` entry
- `ACTIONQUEUE.Palette.Categories.<category>` for each `ACTION_CATEGORIES` value
- `ACTIONQUEUE.Queue.Status.<status>` for each `QUEUE_ITEM_STATUS` value

A few strings are still hardcoded in the template and dialogs ("Standard Actions", "Action Name", "Edit Notes — …", "No actions match this filter"); prefer adding keys over adding more of these.

### Extension points for other modules

Two public surfaces exist and should be treated as API — changing them breaks downstream consumers:

- `game.modules.get("lancer-action-queue").api` — exposes `open`, `fireQueue`, and a `queue` object wrapping the store (`get`/`add`/`update`/`remove`/`reorder`/`clear`/`setStatus`).
- `Hooks.callAll("actionQueue.buildMetaPills", pills, item, holder)` — fired from `_buildMetaPills` so another module can push extra `{ label }` pills onto a queue item's display row. This exists specifically for cross-module integration; keep the mutable-array contract.
