# Project Brief – DOM-Only Multiplayer Web Game

## Context
- **Setting**: Outdoor youth camp, bad weather → extended indoor time.
- **Hardware**: Each camper has a laptop + Wi-Fi hotspot.
- **Browser restriction**: Canvas element disabled → must use DOM elements only.

## Core Mandate
Create a **real-time, 2-4 player competitive web game** that runs at 60 FPS without canvas.

## Mandatory Features

### 1. Gameplay
- Genre: Any (non-word/number), e.g. resource race, arena brawl, collect-&-escape.
- Characters: Identical stats; simultaneous movement; all players visible to everyone.
- No turns; action is live.

### 2. Session Flow
- **Join screen**: unique nickname entry.
- **Host**: starts server, invites others via public URL (not LAN).
- **Start control**: host presses “Start” when 2-4 players ready.

### 3. Performance
- 60 FPS minimum; jank-free; RAF-driven DOM animation.
- Profiling with browser Performance tool required.

### 4. Controls & Feedback
- Keyboard input per player (no lag).
- Real-time scoreboard visible to all.
- Timer (count-up or count-down) always shown.

### 5. Menu System
- In-game menu: Pause / Resume / Quit.
- Global message broadcast for every state change (who did it).

### 6. Scoring & Endgame
- Clear win condition (highest score, last survivor, etc.).
- Winner banner at game over.

### 7. Audio
- Sound effects for at least: game start, key action, score event, game end.

## Optional Bonuses (flag-gated)
- Power-ups / special abilities.
- In-game chat.
- Accessibility tweaks (color-blind palette, remappable keys, screen-reader labels).

## Deliverables
- Single public URL deployable to any Node/static host.
- No canvas; pure DOM + CSS + WebSockets (or WebRTC) for multiplayer sync.
