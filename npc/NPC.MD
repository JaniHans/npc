# NPC System Summary

## In a nutshell
NPCs are server-side players used only in single-player mode. They are added to the room as normal game participants, but instead of receiving movement and cast input from a real socket connection, the server generates those decisions for them every tick.

The important idea is this:
- Human players send inputs over Socket.IO.
- NPCs write the same gameplay fields directly on the server.
- After that, both go through the same movement, collision, spell, damage, respawn, and ghost systems.

That is why single-player feels close to multiplayer: the game simulation is still authoritative and shared, only the source of the input is different.

## Where the NPCs are created
NPC setup starts in `server/service/game-session/session-manager.js`.

- A room has a `mode` field: `multi` or `single`.
- In single-player mode, the session stores:
  - `npcConfigs`
  - `npcPlayerIds`
- The host chooses how many NPCs to create: `1`, `2`, or `3`.
- Each NPC is inserted into the room as a real player entry with:
  - `isNpc: true`
  - a generated player id
  - a skin
  - a selected loadout based on its archetype

When the match starts, each NPC gets a runtime `npcProfile` in game state. That profile is what the tick simulation uses during combat.

## Main variables that control NPC behavior
The core NPC configuration lives in `shared/npc.js`.

### 1. Custom sliders
Each NPC has these user-facing variables:
- `aggression`
- `precision`
- `tempo`
- `mobility`
- `power`

These are stored as percentages and then normalized into effective stats.

### 2. Archetype defaults
Each archetype provides:
- `loadout`
- `preferredRange`
- base values for aggression, precision, tempo, mobility, and power

Examples:
- `duelist`
- `warden`
- `inferno`
- `rift`

This gives each NPC a starting play style before difficulty is applied.

### 3. Difficulty presets
Each difficulty adds its own behavior modifiers:
- `multiplier`
- `reactionMs`
- `baseFailureRate`
- `aimSpreadMultiplier`
- `castCadenceMultiplier`
- `dashChanceMultiplier`
- `strategyNoise`
- `targetRandomness`

Current behavior difference:
- `Easy`: slower reactions, more aim error, more bad choices, more failed actions.
- `Medium`: balanced baseline.
- `Hard`: faster reactions, tighter aim, faster cast cadence, better target selection, fewer mistakes.

### 4. Effective stats
The system calculates:
- `effectiveStats.aggression`
- `effectiveStats.precision`
- `effectiveStats.tempo`
- `effectiveStats.mobility`
- `effectiveStats.power`

From those, it also derives:
- `effectivenessScore`
- `powerMultiplier`
- `speedMultiplier`

So difficulty does not only rename the NPC. It changes how strong, accurate, active, and consistent the NPC actually is.

## How the NPC decides what to do
The decision code lives in `server/service/game-session/npc.js`.

Every time the server tick runs, the simulation checks:
- is this player an NPC?
- if yes, call `applyNpcBehavior(...)`

Inside that function the NPC does this:

### 1. Pick a target
The NPC scans all alive non-self players.

That means it can target:
- the human player
- other NPCs

It does not only focus the real player. This is what allows NPC vs NPC combat and avoids matches feeling fake.

Targeting uses:
- current target memory
- target switching chance
- nearest enemy search
- difficulty-based randomness

Easy NPCs choose random targets more often. Hard NPCs hold targets more reliably and switch with more intention.

### 2. Decide movement
The NPC compares its current distance to the target with its `preferredRange`.

It then chooses one of these behaviors:
- move closer if too far
- back away if too close
- strafe around the target if in a good range band

That movement is converted into the same boolean input structure used by human players:
- `left`
- `right`
- `up`
- `down`

Those values are written into `lastKeyState`.

So the NPC is not teleporting or using a separate movement engine. It is feeding the regular movement simulation.

### 3. Decide whether to dash
If the target is far enough away, the NPC can request a dash by setting:
- `pendingDash = true`

Dash chance depends mostly on:
- `mobility`
- difficulty `dashChanceMultiplier`

Hard NPCs dash more confidently. Easy NPCs do it less often.

### 4. Aim at the target
The NPC writes:
- `aimX`
- `aimY`

But it does not aim perfectly every time. An aim offset is added based on:
- `precision`
- difficulty `aimSpreadMultiplier`

Easy NPCs have larger error cones. Hard NPCs have much smaller spread.

### 5. Choose a spell
The NPC chooses from its equipped `selectedSpellIds`.

The spell decision uses:
- target distance
- a simple range hint per spell
- difficulty `strategyNoise`

Examples:
- close-range spells are favored when enemies are close
- long-range spells are favored at distance
- easy difficulty is more likely to choose a less optimal spell
- hard difficulty follows the range logic more consistently

### 6. Cast through the same spell system
NPCs do not bypass spell rules.

Before casting, the server still checks:
- mana
- cooldowns
- equipped loadout
- cast timing
- stillness requirements for charged casts

If valid:
- instant spells spawn projectiles immediately
- cast-time spells are queued with `queuePendingSpellCast(...)`

When the cast finishes, the normal server projectile flow takes over.

## What NPC state is stored at runtime
Each NPC gets temporary runtime fields like:
- `npcState.lastTargetId`
- `npcState.nextDecisionAtMs`
- `npcState.nextCastAtMs`
- `npcState.nextAimUpdateAtMs`
- `npcState.strafeDir`
- `npcState.lastAimX`
- `npcState.lastAimY`

These values are important because they stop the AI from feeling robotic.

Examples:
- `nextDecisionAtMs` creates reaction timing instead of frame-perfect behavior.
- `nextCastAtMs` spaces out spell use.
- `strafeDir` prevents jittery direction switching.

## How movement actually happens after the AI decides
The real movement is still performed in `server/service/game-session/simulate-tick.js`.

After `applyNpcBehavior(...)` sets the NPC intent:
- the tick loop applies movement using `move(...)`
- dash uses `moveByDistance(...)`
- tile effects still apply
- roots, slows, and ghost restrictions still apply
- spells still go through the normal combat system

Important runtime fields used here:
- `lastKeyState`
- `pendingDash`
- `lastDashAtMs`
- `combat`
- `tileEffectState`
- `respawnAtMs`
- `isGhost`
- `livesRemaining`
- `npcProfile.speedMultiplier`
