# LANCER Action Queue — Roadmap

## Problem

GM turns are slow because running NPCs has high cognitive overhead. For each NPC the GM has to: figure out who it should target, remember what actions it has, pick weapons, configure accuracy/difficulty, and repeat for every NPC on the field. The queue should collapse that decision-making into a planning step so execution is one click.

Players benefit too, but GM-side is the priority.

## Principle: complement, don't replace

The queue is a planning layer on top of LANCER's existing action and flow system. Firing a queued action hands off to the same flows, dialogs, and rolls that clicking "attack" on the sheet would. Nothing about the normal LANCER workflow changes — the queue is purely additive. A player or GM who ignores the queue entirely should never notice it's installed.

## Phase 1 — Targeting & Defaults (v0.2)

### Target assignment

Drag a token onto a queue item (or click to pick from a token list) to assign a target. Show the target's name and portrait on the queue item so the GM can see the whole battle plan at a glance — "Grunt 1 attacks Horus, Grunt 2 attacks the Everest, Bombard hits everyone in Blast 2."

Support multi-target for Barrage and area attacks. Auto-suggest targets based on weapon range and the NPC's position on the canvas (nearest hostile within threat/range).

### Smart defaults

When the GM selects an NPC combatant, auto-suggest its most likely turn based on what it has:
- NPC with one weapon? Default to Skirmish with that weapon.
- NPC with two weapons? Default to Barrage with both.
- Has a recharge ability that's charged? Suggest using it.
- Tier-based accuracy is pre-filled from the NPC's tier.

The GM can accept the suggestion with one click or modify it. The goal is "click combatant, click accept, move on" for straightforward NPCs.

### Actor-aware palette

Replace the generic action list with actions pulled from the NPC's actual features — its weapons, systems, tech actions, traits. The GM shouldn't have to cross-reference the NPC sheet to know what it can do.

## Phase 2 — Execution (v0.3)

### Real LANCER flow integration

Wire the executor into `WeaponAttackFlow` / `BasicAttackFlow` with the queued weapon, target, and accuracy/difficulty pre-filled. The GM hits "Fire" and each action resolves through LANCER's normal roll system with the target already set.

### Multi-combatant fire

Queue actions across all NPCs, then fire every queue in initiative order with one button. The GM plans the whole enemy phase and then watches it play out.

### Action economy tracking

Show how many quick/full actions the combatant has used vs. available. Warn if the queue exceeds the action budget. Auto-suggest Overcharge if needed (for mechs).

## Phase 3 — Player Side (v0.4)

### Turn pre-planning

Players queue actions during other turns. When their initiative comes up, the queue is ready. Combat tracker shows a "planned" indicator.

### Target picking from canvas

Click a token on the map to set it as the target for the current queue item. More intuitive than a dropdown for players.

## Phase 4 — Performance & Polish (v0.5+)

- Batch flag writes (one server round-trip per queue mutation batch, not per item)
- Debounce renders for rapid queue changes
- Socket sync for real-time queue visibility across clients
- Queue templates: save an NPC's common turn pattern and reuse it
- Keyboard shortcuts for power users
