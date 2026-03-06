# web-game (Arcane Duel)

DOM-only browser arena game with multiplayer and single-player NPC battles, built with Express and Socket.IO.

## Play online

[By clicking the link here](https://web-game-h6rt.onrender.com)

## Features
- Room-based lobby with host role and host-only game start.
- Host-selectable map before match start.
- Per-player 3-spell loadout selection in lobby (required before game start).
- Room chat.
- 2-4 player sessions.
- Single-player mode with customizable virtual opponents.
- Server-authoritative movement simulation at `30` ticks/sec (`input:update` -> server tick -> `snapshot`).
- Server-authoritative combat and spell casting (`spell:cast` + snapshot-synced projectiles).
- Server-authoritative tile effects (damage, slow, teleport).
- Lives/respawn/ghost lifecycle (`3` lives, `1s` respawn delay, ghost movement after elimination).
- Client interpolation/smoothing for received snapshots.
- Shared map registry with multiple arenas and deterministic spawn assignment.
- In-memory session storage (no database/persistence).

## Tech Stack
- Node.js + Express (static hosting and HTTP server).
- Socket.IO (real-time multiplayer events).
- Vanilla JavaScript ES modules (client/server/shared).

## Requirements
- Node.js `18+` recommended.
- npm.

## Quick Start
1. Install dependencies:
```bash
npm install
```
2. Start the dev server:
```bash
npm start
```
3. Open:
```text
http://localhost:3000
```

Use a custom port with:

```bash
PORT=4000 npm start
```

## Available Scripts
- `npm start`: runs `node server/server.js`.
- `npm test`: placeholder script (currently exits with failure).

## Controls
- Move: `W/A/S/D` or arrow keys.
- Dash: `Shift` while moving.
- Cast spell: left click.
- Cycle selected spell: `Q` / `E`.
- Toggle performance overlay: `F`.

## Single-Player Mode
Single-player is designed to mirror multiplayer gameplay while filling the room with AI-controlled opponents.

- Toggle to `Single Player` in the lobby match mode section.
- Pick `1`, `2`, or `3` virtual opponents (room total still requires 2-4 players).
- Customize each opponent: name, archetype, and difficulty (Easy/Medium/Hard).
- Customize each opponent: sliders for aggression, precision, mobility, and power.
- Difficulty is a multiplier: higher difficulty scales the selected stats, reaction speed, and consistency.
- When single-player mode is active, incoming connections from other players are refused.

## Aiming And Spell Cycling
- Choose exactly 3 spells in the lobby before starting a match.
- Aim spells with the mouse cursor. Spells fire toward the cursor position at the moment you click.
- You can move and aim at the same time; movement does not block aiming.
- Cycle spells with `Q` (previous) and `E` (next) while moving. The HUD shows the current spell.
- Left click to cast the currently selected spell toward the cursor.
- Some spells need different timing:
  - `Flamethrower` tracks your aim while active but ends if you move.
  - `Flame Phoenix` has a short cast time and works best if you stop moving first.

## Spell Gallery (Player Loadout)
Each player selects exactly 3 spells before starting. These are the available spells in the current build.

### Fireball
<img src="public/images/spells/fireball.svg" alt="Fireball" width="96" />

- Description: A ball of fire that explodes on impact.
- Damage: `40`
- Pro tip: Use it as a reliable midrange burst option when the enemy path is clear.

### Icebolt
<img src="public/images/spells/icebolt.svg" alt="Icebolt" width="96" />

- Description: A heavy bolt that ricochets off walls.
- Damage: `35`
- Pro tip: Bounce it into corridors and corners instead of firing only in straight lines.

### Magic Missile
<img src="public/images/spells/magic-missile.svg" alt="Magic Missile" width="96" />

- Description: A fast bolt that pierces enemies.
- Damage: `10`
- Pro tip: Great for constant pressure and picking at opponents from safer positions.

### Boomerang
<img src="public/images/spells/boomerang.svg" alt="Boomerang" width="96" />

- Description: Curves back to the caster and can strike multiple enemies.
- Damage: `18`
- Pro tip: Throw it across moving targets so the return path becomes a second attack lane.

### Rift Mine
<img src="public/images/spells/rift-mine.svg" alt="Rift Mine" width="96" />

- Description: Arms after landing and detonates when enemies get close.
- Damage: `34`
- Pro tip: Drop it near choke points or retreat paths to punish aggressive pushes.

### Comet
<img src="public/images/spells/comet.svg" alt="Comet" width="96" />

- Description: Calls down a celestial strike that explodes on impact.
- Damage: `56`
- Pro tip: Lead the cast slightly ahead of enemy movement because the strike is delayed.

### Orbit Blades
<img src="public/images/spells/orbit-blades.svg" alt="Orbit Blades" width="96" />

- Description: Summons rotating blades that orbit the caster.
- Damage: `15`
- Pro tip: Best used when you want to play up close and control space around your character.

### Fracture Beam
<img src="public/images/spells/fracture-beam.svg" alt="Fracture Beam" width="96" />

- Description: A beam that splinters into shards after colliding with walls.
- Damage: `17`
- Pro tip: Fire it toward walls intentionally so the shards spread into harder-to-dodge angles.

### Flamethrower
<img src="public/images/spells/flamethrower.svg" alt="Flamethrower" width="96" />

- Description: Channels fire for 3 seconds, tracks your aim, and stops instantly if you move.
- Damage: `4` per flame burst
- Pro tip: Commit to your position before casting so you can keep the stream active on target.

### Flame Phoenix
<img src="public/images/spells/flame-phoenix.svg" alt="Flame Phoenix" width="96" />

- Description: A colossal phoenix wave with a short cast time that pierces walls and enemies.
- Damage: `86`
- Pro tip: Stop moving just before the cast, then launch it through packed lanes for maximum value.

## Room and Nickname Rules
- `roomId`: `3-20` characters, letters/numbers only (`^[a-zA-Z0-9]{3,20}$`).
- `nickname`: `2-15` characters, letters/numbers/spaces only (`^[a-zA-Z0-9 ]{2,15}$`).
- Max players per room: `4`.
- Minimum players to start game: `2`.

## Networking Overview
Main Socket.IO events:

- `join-room` (client -> server, callback ack).
- `player-joined` (server -> room).
- `player-left` (server -> room).
- `lobby-updated` (server -> room lobby sync).
- `lobby:set-map` (host -> server map selection).
- `lobby:set-spells` (player -> server 3-spell loadout selection).
- `start-game` (host -> server, callback ack on validation errors).
- `game-started` (server -> room, includes `mapId` and lobby spell selections).
- `chat-message` (client <-> server -> room).
- `input:update` (client -> server authoritative input).
- `snapshot` (server -> room authoritative state).
- `spell:cast` (client -> server authoritative cast request).
- `spell:cast:rejected` (server -> client fallback rejection event when no callback is supplied).

See `MDs/NETWORK-PROTOCOL.md` for the full protocol notes.

