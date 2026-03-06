# Prediction + Reconciliation Algorithm

Goal: instant local controls + server truth.

---

## 1) Data You Keep (Client)

| Name | Type | Example | Purpose |
|---|---|---|---|
| `inputSeq` | number | `57` | Unique id for each local input packet. |
| `pendingInputs` | array | `[{seq:56, keys...}, {seq:57, keys...}]` | Inputs sent but not yet confirmed by server. |
| `predictedState` | object | `{x, y, vx, vy}` | Local immediate movement result. |
| `snapshotBuffer` | array | `[{snapshotId, serverTick, players...}]` | Used for remote interpolation. |

---

## 2) Packet Flow (Visual)

```text
CLIENT (local player)                       SERVER (authoritative)
---------------------                       ----------------------
press W
  -> inputSeq = 41
  -> predict move now
  -> queue pending[41]
  -> send input:update(41, keys)
                                             recv input 41
                                             queue by player
                                             on tick:
                                               process 41
                                               simulate movement
                                             send snapshot(
                                               snapshotId=120,
                                               serverTick=500,
                                               lastProcessedInputSeq=41,
                                               player.x/y authoritative
                                             )
recv snapshot 120
  -> set local to authoritative x/y
  -> drop pending seq <= 41
  -> replay remaining pending inputs
  -> render
```

---

## 3) Client Algorithm (Local Player)

```text
On input change:
  1) inputSeq += 1
  2) packet = { roomId, inputSeq, keys, clientTimeMs }
  3) applyInput(predictedState, packet)   // immediate response
  4) pendingInputs.push(packet)
  5) socket.emit("input:update", packet)
```

```text
On snapshot:
  1) read my authoritative state from snapshot.players[socket.id]
  2) predictedState = authoritativeState
  3) ack = myState.lastProcessedInputSeq
  4) pendingInputs = pendingInputs.filter(p => p.inputSeq > ack)
  5) for each p in pendingInputs (in order):
       applyInput(predictedState, p)
```

---

## 4) Server Algorithm (Per Tick)

```text
Fixed tick loop (e.g. 30Hz):
  for each player:
    - process queued inputs in inputSeq order
    - reject stale/out-of-order as needed
    - simulate movement + collision
    - update lastProcessedInputSeq for that player

Every snapshot interval (e.g. 12Hz):
  snapshotId += 1
  emit "snapshot" with:
    { snapshotId, serverTick, players, projectiles, phase }
```

---

## 5) Remote Players (No Prediction)

```text
Do NOT predict remote players.

Use interpolation:
  - keep last N snapshots in snapshotBuffer
  - render at (now - interpolationDelayMs), e.g. 100ms
  - find snapshots A and B around renderTime
  - lerp(A.pos -> B.pos)
```

---

## 6) Sanity Checks

| Check | Expected |
|---|---|
| Local key press response | Immediate (no visible input lag). |
| Corrections after snapshot | Small, occasional, not constant snapping. |
| `pendingInputs` growth | Bounded; old inputs get removed as acks arrive. |
| Snapshot order | Ignore too-old `snapshotId`. |

---

## 7) Common Mistakes

- Not replaying unacked inputs after applying authoritative state.
- Processing input packets out of order.
- Mixing frame delta movement and tick movement inconsistently.
- Predicting remote players instead of interpolating them.
