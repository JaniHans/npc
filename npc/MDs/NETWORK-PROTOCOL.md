# Network Protocol (Authoritative Multiplayer)

## Core Terms
| Term | Type | Meaning |
|---|---|---|
| `roomId` | string | Stable room identifier used by client payloads and Socket.IO room routing. |
| `playerId` | string | Stable per-player id inside a room, independent of `socket.id`. |
| `inputSeq` | number | Monotonic client input sequence for reconciliation (`input:update`). |
| `snapshotId` | number | Monotonic server snapshot sequence per room. |
| `serverTick` | number | Authoritative simulation tick counter. |
| `mapId` | string | Selected authoritative map id for lobby + running game state. |

## State Ownership
| State | Authority | Notes |
|---|---|---|
| Lobby state (`players`, `host`, `selectedMapId`, `selectedSpellsByPlayerId`) | Server | Clients render this state and submit update intents. |
| Movement, combat, lives/ghost state, tile effects | Server | Clients predict/render; server remains source of truth. |
| Local input and HUD visuals | Client | Presentation/local intent only; not authoritative. |

## Event Contracts

### Lobby and Room Events
| Event | Direction | Payload | Server validation | Response |
|---|---|---|---|---|
| `join-room` | Client -> Server | `{ roomId, nickname }` | Room id + nickname format, room capacity, unique nickname, room not already running. | Ack callback with success/error flags; on success emits `player-joined`. |
| `player-joined` | Server -> Room clients | `LobbyPayload` | Emitted from authoritative room state after successful join. | No ack. |
| `player-left` | Server -> Room clients | `LobbyPayload` | Emitted after disconnect/removal and host reassignment. | No ack. |
| `lobby-updated` | Server -> Room clients | `LobbyPayload` | Emitted when map or spell loadout changes are accepted. | No ack. |
| `lobby:set-map` | Client (host) -> Server | `{ roomId, mapId }` | Room exists, sender in room, room status is `waiting`, `mapId` provided, host-only, `mapId` exists in shared map registry. | Ack: `{ ok, selectedMapId }` or error flags (`roomDoesNotExist`, `notInRoom`, `invalidState`, `invalidMapId`, `mapSelectionRejected`). |
| `lobby:set-spells` | Client -> Server | `{ roomId, spellIds }` | Room exists, sender in room, room status is `waiting`, `spellIds` must be exactly 3 unique valid spell ids. | Ack: `{ ok, spellIds }` or error flags (`roomDoesNotExist`, `notInRoom`, `invalidState`, `invalidSpellSelection`, `spellSelectionRejected`). |
| `start-game` | Host client -> Server | `roomId` | Sender is host, room exists, room not already running, minimum players met, every player has valid 3-spell loadout. | Ack on validation error; on success emits `game-started` and periodic `snapshot`. |
| `game-started` | Server -> Room clients | `{ players, phase, mapId, selectedSpellsByPlayerId }` | Emitted after server initializes authoritative game state. | No ack. |
| `chat-message` | Client -> Server -> Room clients | Client sends `{ roomId, message }`; server rebroadcast includes `senderName`. | Sender belongs to room and message is non-empty. | No ack. |

`LobbyPayload` shape:
- `players`: object keyed by `playerId`
- `host`: `playerId`
- `skinMap`: object keyed by `playerId` to numeric skin index
- `selectedMapId`: string
- `selectedSpellsByPlayerId`: object keyed by `playerId` to `string[]`

### Authoritative Gameplay Events
| Event | Direction | Payload | Server validation | Response |
|---|---|---|---|---|
| `input:update` | Client -> Server | `{ roomId, inputSeq, keys: { up, down, left, right }, actions?, clientTimeMs }` where `actions.dashRequestId` is optional. | Sender in running room, `roomId` match, monotonic `inputSeq`, boolean key fields, valid `actions` shape. | No direct ack; processed state appears in next `snapshot`. |
| `spell:cast` | Client -> Server | `{ spellId, targetX, targetY }` | Running session, player exists, player not ghost, spell exists and is equipped, cast validation passes (mana/cooldowns/rules), target payload is finite numbers. | Callback optional. Success: `{ accepted: true, ... }`; rejection: `{ accepted: false, reason, details? }`. If no callback was provided, server emits `spell:cast:rejected`. |
| `snapshot` | Server -> Room clients | `{ roomId, snapshotId, serverTick, serverTimeMs, players, projectiles, phase, skin, mapId }` | Server-generated authoritative state only. | No ack. |

`snapshot.players[playerId]` includes:
- `x`, `y`
- `health`, `livesRemaining`, `isGhost`, `respawnAtMs`
- `lastKeyState`, `lastProcessedInputSeq`
- `skin`, `selectedSpellIds`, `spawnPointId`, `spawnPointIndex`
- `combat` (mana/cooldown/active cast runtime state)
- `tileEffectState` (`activeSlowMultiplier` and server effect cooldown trackers)

## Validation Rules

### Map Selection
- Only the current room host can change map.
- Map can be changed only while room status is `waiting`.
- `mapId` must exist in `shared/map.js` registry.

### Spell Loadouts
- Each player must submit exactly `3` spells.
- Spell ids must be unique within one loadout.
- Every spell id must exist in the shared spell list (`shared/spells.js`).
- Host cannot start game until all players have valid loadouts.
