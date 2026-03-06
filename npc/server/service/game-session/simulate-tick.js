import {
  movementSpeed,
  hitbox,
  dashDistance,
  dashCooldownMs,
} from "../../../shared/constants.js";
import { hasMovementInput, move, moveByDistance } from "../../../shared/movement.js";
import {
  applySpellCastCosts,
  cancelPendingSpellCast,
  getActiveCastCount,
  PROJECTILE_LIFETIME_MS,
  PROJECTILE_STEP_MULTIPLIER,
  createSpellProjectile,
  decrementActiveCastCount,
  getPlayerCastOrigin,
  getSpellById,
  incrementActiveCastCount,
  isPlayerRooted,
  popReadyPendingSpellCast,
  regeneratePlayerMana,
  runSpellExpireHook,
  runSpellHitPlayerHook,
  runSpellProjectileUpdate,
  validateSpellCast,
} from "../../../shared/spells.js";
import { getCollidingPlayerIds } from "../../../shared/player-collision.js";
import { randomUUID } from "crypto";
import { DEFAULT_MAP_ID, getDefaultMap, getMapById } from "../../../shared/map.js";
import { applyNpcBehavior, applyNpcDamageMultiplier } from "./npc.js";

const ORBIT_BLADE_MOVE_MULTIPLIER = 0.8;
const PLAYER_MAX_HEALTH = 100;
const PLAYER_INITIAL_LIVES = 3;
const PLAYER_RESPAWN_DELAY_MS = 1000;
const DEFAULT_TILE_EFFECT_STATE = Object.freeze({
  activeSlowMultiplier: 1,
  lastDamageAtMsByEffectId: {},
  teleportCooldownUntilMsByEffectId: {},
  teleportGlobalCooldownUntilMs: 0,
});
const TILE_LOOKUP_EPSILON = 1e-4;

function getMatchTimerSnapshot(session, nowMs) {
  const matchStartTimeMs = Number.isFinite(session?.gameStartTimeMs)
    ? session.gameStartTimeMs
    : null;
  const matchDurationMs = Number.isFinite(session?.gameDurationMs)
    ? Math.max(0, session.gameDurationMs)
    : null;
  const pauseTotalMs = Number.isFinite(session?.gameState?.pauseTotalMs)
    ? Math.max(0, session.gameState.pauseTotalMs)
    : 0;
  const pausedAtMs = Number.isFinite(session?.gameState?.pausedAtMs)
    ? session.gameState.pausedAtMs
    : null;
  const isPaused = Boolean(session?.gameState?.paused);

  if (matchStartTimeMs == null || matchDurationMs == null) {
    return {
      matchStartTimeMs,
      matchDurationMs,
      matchTimeRemainingMs: null,
    };
  }

  const activePauseMs = isPaused && pausedAtMs != null ? Math.max(0, nowMs - pausedAtMs) : 0;
  const elapsedMs = Math.max(0, nowMs - matchStartTimeMs - pauseTotalMs - activePauseMs);
  const matchTimeRemainingMs = Math.max(0, matchDurationMs - elapsedMs);

  return {
    matchStartTimeMs,
    matchDurationMs,
    matchTimeRemainingMs,
  };
}

function getPlayerScoreSnapshot(playerState) {
  const livesRemaining = Number.isFinite(playerState?.livesRemaining)
    ? Math.max(0, Math.floor(playerState.livesRemaining))
    : 0;
  const health = Number.isFinite(playerState?.health)
    ? Math.max(0, Math.min(PLAYER_MAX_HEALTH, playerState.health))
    : 0;
  const isGhost = Boolean(playerState?.isGhost);
  const score = isGhost || livesRemaining <= 0 ? 0 : livesRemaining * PLAYER_MAX_HEALTH + health;

  return {
    livesRemaining,
    health,
    isGhost,
    score,
  };
}

function getAllPlayerScores(session) {
  const entries = Object.entries(session?.gameState?.players || {});
  return entries.map(([playerId, playerState]) => ({
    playerId,
    ...getPlayerScoreSnapshot(playerState),
  }));
}

function resolveEliminationResult(session) {
  const scores = getAllPlayerScores(session);
  const alivePlayers = scores.filter((score) => !score.isGhost && score.livesRemaining > 0);
  if (alivePlayers.length > 1) {
    return null;
  }

  if (alivePlayers.length === 1) {
    return {
      isDraw: false,
      winnerId: alivePlayers[0].playerId,
      scores,
    };
  }

  return {
    isDraw: true,
    winnerId: null,
    scores,
  };
}

function resolveScoreResult(session) {
  const scores = getAllPlayerScores(session);
  if (scores.length === 0) {
    return {
      isDraw: true,
      winnerId: null,
      scores,
    };
  }

  let maxScore = -Infinity;
  for (const score of scores) {
    if (score.score > maxScore) {
      maxScore = score.score;
    }
  }

  const topPlayers = scores.filter((score) => score.score === maxScore);
  if (topPlayers.length === 1 && maxScore > 0) {
    return {
      isDraw: false,
      winnerId: topPlayers[0].playerId,
      scores,
    };
  }

  return {
    isDraw: true,
    winnerId: null,
    scores,
  };
}

function getPlayerCenter(playerState) {
  if (!playerState) {
    return null;
  }
  return getPlayerCastOrigin(playerState, hitbox);
}

function getSpawnOriginFromPoint(spawnPoint) {
  const centerOffsetX = hitbox.offsetX + hitbox.width / 2;
  const centerOffsetY = hitbox.offsetY + hitbox.height / 2;

  return {
    x: spawnPoint.x - centerOffsetX,
    y: spawnPoint.y - centerOffsetY,
  };
}

function cloneDefaultTileEffectState() {
  return {
    activeSlowMultiplier: DEFAULT_TILE_EFFECT_STATE.activeSlowMultiplier,
    lastDamageAtMsByEffectId: {},
    teleportCooldownUntilMsByEffectId: {},
    teleportGlobalCooldownUntilMs: DEFAULT_TILE_EFFECT_STATE.teleportGlobalCooldownUntilMs,
  };
}

function ensureTileEffectState(playerState) {
  if (!playerState || typeof playerState !== "object") {
    return cloneDefaultTileEffectState();
  }

  if (!playerState.tileEffectState || typeof playerState.tileEffectState !== "object") {
    playerState.tileEffectState = cloneDefaultTileEffectState();
    return playerState.tileEffectState;
  }

  const tileEffectState = playerState.tileEffectState;
  if (!Number.isFinite(tileEffectState.activeSlowMultiplier)) {
    tileEffectState.activeSlowMultiplier = 1;
  }
  if (
    !tileEffectState.lastDamageAtMsByEffectId ||
    typeof tileEffectState.lastDamageAtMsByEffectId !== "object"
  ) {
    tileEffectState.lastDamageAtMsByEffectId = {};
  }
  if (
    !tileEffectState.teleportCooldownUntilMsByEffectId ||
    typeof tileEffectState.teleportCooldownUntilMsByEffectId !== "object"
  ) {
    tileEffectState.teleportCooldownUntilMsByEffectId = {};
  }
  if (!Number.isFinite(tileEffectState.teleportGlobalCooldownUntilMs)) {
    tileEffectState.teleportGlobalCooldownUntilMs = 0;
  }

  return tileEffectState;
}

function getTileCoordinatesFromWorldPosition(map, worldX, worldY) {
  if (
    !map ||
    !map.config ||
    !Number.isFinite(worldX) ||
    !Number.isFinite(worldY)
  ) {
    return null;
  }

  const tileSize = Number(map.config.tileSize);
  const mapWidth = Number(map.config.width);
  const mapHeight = Number(map.config.height);
  if (!Number.isFinite(tileSize) || tileSize <= 0) {
    return null;
  }

  const clampedX = Math.max(0, Math.min(worldX, mapWidth * tileSize - TILE_LOOKUP_EPSILON));
  const clampedY = Math.max(0, Math.min(worldY, mapHeight * tileSize - TILE_LOOKUP_EPSILON));
  const tileX = Math.floor(clampedX / tileSize);
  const tileY = Math.floor(clampedY / tileSize);

  if (tileX < 0 || tileY < 0 || tileX >= mapWidth || tileY >= mapHeight) {
    return null;
  }

  return { tileX, tileY };
}

function getPlayerTileSnapshot(playerState, map) {
  const center = getPlayerCenter(playerState);
  if (!center) {
    return null;
  }

  const tileCoords = getTileCoordinatesFromWorldPosition(map, center.x, center.y);
  if (!tileCoords) {
    return null;
  }

  return {
    ...tileCoords,
    tileId: map.layout?.[tileCoords.tileY]?.[tileCoords.tileX],
  };
}

function tileMatchesTileEffect(effect, playerTileSnapshot) {
  if (!effect || !playerTileSnapshot) {
    return false;
  }

  const hasTileIds = Array.isArray(effect.tileIds) && effect.tileIds.length > 0;
  if (
    hasTileIds &&
    effect.tileIds.some((tileId) => Number(tileId) === Number(playerTileSnapshot.tileId))
  ) {
    return true;
  }

  if (!Array.isArray(effect.triggerTiles) || effect.triggerTiles.length === 0) {
    return false;
  }

  return effect.triggerTiles.some((triggerTile) => {
    if (!triggerTile || typeof triggerTile !== "object") {
      return false;
    }
    return (
      Number(triggerTile.x) === playerTileSnapshot.tileX &&
      Number(triggerTile.y) === playerTileSnapshot.tileY
    );
  });
}

function worldCenterToPlayerOrigin(worldX, worldY) {
  return {
    x: worldX - (hitbox.offsetX + hitbox.width / 2),
    y: worldY - (hitbox.offsetY + hitbox.height / 2),
  };
}

function canOccupyPlayerOrigin(map, originX, originY) {
  if (
    !map ||
    typeof map.walkable !== "function" ||
    !Number.isFinite(originX) ||
    !Number.isFinite(originY)
  ) {
    return false;
  }

  const x0 = originX + hitbox.offsetX + TILE_LOOKUP_EPSILON;
  const y0 = originY + hitbox.offsetY + TILE_LOOKUP_EPSILON;
  const x1 = originX + hitbox.offsetX + hitbox.width - TILE_LOOKUP_EPSILON;
  const y1 = originY + hitbox.offsetY + hitbox.height - TILE_LOOKUP_EPSILON;

  return map.walkable(x0, y0) && map.walkable(x1, y0) && map.walkable(x0, y1) && map.walkable(x1, y1);
}

function getTeleportDestinationOrigin(effect, map) {
  if (!effect || !map) {
    return null;
  }

  if (effect.destinationTile && typeof effect.destinationTile === "object") {
    const tileX = Number(effect.destinationTile.x);
    const tileY = Number(effect.destinationTile.y);
    const tileSize = Number(map.config?.tileSize);
    if (Number.isFinite(tileX) && Number.isFinite(tileY) && Number.isFinite(tileSize)) {
      return worldCenterToPlayerOrigin(
        tileX * tileSize + tileSize / 2,
        tileY * tileSize + tileSize / 2,
      );
    }
  }

  if (typeof effect.destinationSpawnId === "string") {
    const spawnPoint = (map.spawnPoints || []).find(
      (spawn) => spawn?.id === effect.destinationSpawnId,
    );
    if (spawnPoint && Number.isFinite(spawnPoint.x) && Number.isFinite(spawnPoint.y)) {
      return worldCenterToPlayerOrigin(spawnPoint.x, spawnPoint.y);
    }
  }

  if (effect.destinationPosition && typeof effect.destinationPosition === "object") {
    const worldX = Number(effect.destinationPosition.x);
    const worldY = Number(effect.destinationPosition.y);
    if (Number.isFinite(worldX) && Number.isFinite(worldY)) {
      return worldCenterToPlayerOrigin(worldX, worldY);
    }
  }

  return null;
}

function resolvePlayerRespawnOrigin(map, playerState, fallbackPlayerIndex = 0) {
  const spawnPoints = Array.isArray(map?.spawnPoints) ? map.spawnPoints : [];
  if (spawnPoints.length === 0) {
    return null;
  }

  const spawnPointId = playerState?.spawnPointId;
  if (typeof spawnPointId === "string" && spawnPointId.length > 0) {
    const spawnPoint = spawnPoints.find((spawn) => spawn?.id === spawnPointId);
    if (spawnPoint) {
      return getSpawnOriginFromPoint(spawnPoint);
    }
  }

  const spawnPointIndex = Number.isFinite(playerState?.spawnPointIndex)
    ? Math.max(0, Math.floor(playerState.spawnPointIndex))
    : Math.max(0, Math.floor(fallbackPlayerIndex));
  const fallbackSpawnPoint = spawnPoints[spawnPointIndex % spawnPoints.length];
  if (!fallbackSpawnPoint) {
    return null;
  }

  return getSpawnOriginFromPoint(fallbackSpawnPoint);
}

function handlePlayerDefeat(session, playerId, playerState, nowMs) {
  if (!playerState || playerState.isGhost) {
    return;
  }

  const currentLives = Number.isFinite(playerState.livesRemaining)
    ? Math.max(0, Math.floor(playerState.livesRemaining))
    : PLAYER_INITIAL_LIVES;
  const nextLives = Math.max(0, currentLives - 1);

  playerState.livesRemaining = nextLives;
  playerState.pendingDash = false;
  cancelPendingSpellCast(playerState, nowMs);

  if (nextLives <= 0) {
    playerState.isGhost = true;
    playerState.health = PLAYER_MAX_HEALTH;
    playerState.respawnAtMs = null;
    return;
  }

  playerState.health = 0;
  playerState.respawnAtMs = nowMs + PLAYER_RESPAWN_DELAY_MS;
}

function getRespawnAtMs(playerState) {
  const value = playerState?.respawnAtMs;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function applyTileEffects(session, playerId, playerState, map, nowMs) {
  if (!playerState || !map) {
    return;
  }

  const tileEffects = Array.isArray(map.tileEffects) ? map.tileEffects : [];
  if (tileEffects.length === 0) {
    const tileEffectState = ensureTileEffectState(playerState);
    tileEffectState.activeSlowMultiplier = 1;
    return;
  }

  const tileEffectState = ensureTileEffectState(playerState);
  let playerTileSnapshot = getPlayerTileSnapshot(playerState, map);
  let activeSlowMultiplier = 1;
  let teleportedThisTick = false;

  for (const effect of tileEffects) {
    const effectId = typeof effect?.id === "string" ? effect.id : null;
    if (!effectId || !playerTileSnapshot) {
      continue;
    }
    if (!tileMatchesTileEffect(effect, playerTileSnapshot)) {
      continue;
    }

    if (effect.type === "slow") {
      const configuredMultiplier = Number(effect.moveSpeedMultiplier);
      const resolvedMultiplier = Number.isFinite(configuredMultiplier)
        ? Math.max(0.1, Math.min(1, configuredMultiplier))
        : 1;
      activeSlowMultiplier = Math.min(activeSlowMultiplier, resolvedMultiplier);
      continue;
    }

    if (effect.type === "damage") {
      const damagePerTick = Number(effect.damagePerTick);
      if (!Number.isFinite(damagePerTick) || damagePerTick <= 0) {
        continue;
      }

      const intervalMs = Number.isFinite(effect.intervalMs)
        ? Math.max(100, effect.intervalMs)
        : 1000;
      const lastDamageAtMs = Number(
        tileEffectState.lastDamageAtMsByEffectId[effectId] ?? -Infinity,
      );
      if (nowMs - lastDamageAtMs >= intervalMs) {
        applyPlayerDamage(session, playerId, damagePerTick);
        tileEffectState.lastDamageAtMsByEffectId[effectId] = nowMs;
      }
      continue;
    }

    if (effect.type === "teleport") {
      if (teleportedThisTick) {
        continue;
      }

      const globalTeleportCooldownUntilMs = Number(
        tileEffectState.teleportGlobalCooldownUntilMs || 0,
      );
      if (nowMs < globalTeleportCooldownUntilMs) {
        continue;
      }

      const effectCooldownUntilMs = Number(
        tileEffectState.teleportCooldownUntilMsByEffectId[effectId] || 0,
      );
      if (nowMs < effectCooldownUntilMs) {
        continue;
      }

      const destinationOrigin = getTeleportDestinationOrigin(effect, map);
      if (
        !destinationOrigin ||
        !canOccupyPlayerOrigin(map, destinationOrigin.x, destinationOrigin.y)
      ) {
        continue;
      }

      playerState.x = destinationOrigin.x;
      playerState.y = destinationOrigin.y;
      teleportedThisTick = true;

      const cooldownMs = Number.isFinite(effect.cooldownMs)
        ? Math.max(0, effect.cooldownMs)
        : 1000;
      tileEffectState.teleportCooldownUntilMsByEffectId[effectId] = nowMs + cooldownMs;
      tileEffectState.teleportGlobalCooldownUntilMs = nowMs + cooldownMs;

      playerTileSnapshot = getPlayerTileSnapshot(playerState, map);
    }
  }

  tileEffectState.activeSlowMultiplier = activeSlowMultiplier;
}

function isPointInsideCapsule(
  pointX,
  pointY,
  centerX,
  centerY,
  axisX,
  axisY,
  halfLength,
  radius,
) {
  const relativeX = pointX - centerX;
  const relativeY = pointY - centerY;
  const projection = relativeX * axisX + relativeY * axisY;
  const clampedProjection = Math.max(-halfLength, Math.min(halfLength, projection));
  const nearestX = centerX + axisX * clampedProjection;
  const nearestY = centerY + axisY * clampedProjection;
  const deltaX = pointX - nearestX;
  const deltaY = pointY - nearestY;
  return deltaX * deltaX + deltaY * deltaY <= radius * radius;
}

function getProjectileCollidingPlayerIds(playersById, projectile) {
  const shape = projectile?.meta?.collisionShape;
  if (shape !== "capsule") {
    const projectileRadius = (projectile.size || 0) / 2;
    const ignoredPlayerId = projectile.canHitOwner ? null : projectile.ownerId;
    return getCollidingPlayerIds(
      playersById,
      projectile.x,
      projectile.y,
      projectileRadius,
      ignoredPlayerId,
      hitbox,
    );
  }

  const directionX = Number.isFinite(projectile.meta?.directionX)
    ? projectile.meta.directionX
    : projectile.vx;
  const directionY = Number.isFinite(projectile.meta?.directionY)
    ? projectile.meta.directionY
    : projectile.vy;
  const directionLength = Math.hypot(directionX, directionY);
  const axisX = directionLength > 1e-6 ? directionX / directionLength : 1;
  const axisY = directionLength > 1e-6 ? directionY / directionLength : 0;

  const collisionLength = Number.isFinite(projectile.meta?.collisionLength)
    ? Math.max(1, projectile.meta.collisionLength)
    : 208;
  const collisionWidth = Number.isFinite(projectile.meta?.collisionWidth)
    ? Math.max(1, projectile.meta.collisionWidth)
    : 144;

  const halfLength = collisionLength / 2;
  const projectileRadius = collisionWidth / 2;
  const playerRadius = Math.max(hitbox.width, hitbox.height) / 2;
  const effectiveRadius = projectileRadius + playerRadius;
  const ignoredPlayerId = projectile.canHitOwner ? null : projectile.ownerId;

  const collidingPlayerIds = [];
  const nowMs = Date.now();
  for (const [playerId, playerState] of Object.entries(playersById || {})) {
    if (!playerState || playerId === ignoredPlayerId || playerState.isGhost) {
      continue;
    }
    if ((playerState.health ?? 0) <= 0) {
      continue;
    }
    const respawnAtMs = getRespawnAtMs(playerState);
    if (respawnAtMs !== null && nowMs < respawnAtMs) {
      continue;
    }
    const playerCenter = getPlayerCenter(playerState);
    if (!playerCenter) {
      continue;
    }
    if (
      isPointInsideCapsule(
        playerCenter.x,
        playerCenter.y,
        projectile.x,
        projectile.y,
        axisX,
        axisY,
        halfLength,
        effectiveRadius,
      )
    ) {
      collidingPlayerIds.push(playerId);
    }
  }

  return collidingPlayerIds;
}

function buildSnapshot(session, nowMs, matchTimer) {
  const nextSnapshotId = (session.gameState.snapshotId ?? 0) + 1;
  session.gameState.snapshotId = nextSnapshotId;
  const activeMap = getSessionMap(session);
  const resolvedNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const resolvedMatchTimer =
    matchTimer && typeof matchTimer === "object"
      ? matchTimer
      : getMatchTimerSnapshot(session, resolvedNowMs);

  return {
    roomId: session.roomId,
    snapshotId: nextSnapshotId,
    serverTick: session.gameState.tickCounter,
    serverTimeMs: resolvedNowMs,
    ...resolvedMatchTimer,
    players: session.gameState.players,
    projectiles: session.gameState.projectiles || [],
    phase: session.status,
    skin: session.getSkinMap(),
    mapId: activeMap?.id || DEFAULT_MAP_ID,
  };
}

function getSessionMap(session) {
  const stateMap = session?.gameState?.map;
  if (stateMap) {
    return stateMap;
  }

  const selectedMapId = session?.selectedMapId || DEFAULT_MAP_ID;
  const fallbackMap =
    getMapById(selectedMapId) || getMapById(DEFAULT_MAP_ID) || getDefaultMap();

  if (!session.gameState) {
    session.gameState = {};
  }
  session.gameState.map = fallbackMap;
  session.gameState.mapId = fallbackMap?.id || DEFAULT_MAP_ID;

  return fallbackMap;
}

function applyPlayerDamage(session, playerId, damage) {
  if (!Number.isFinite(damage) || damage <= 0) {
    return;
  }

  const targetGameState = session.gameState.players[playerId];
  if (!targetGameState) {
    return;
  }
  if (targetGameState.isGhost) {
    return;
  }
  if ((targetGameState.health ?? 0) <= 0) {
    return;
  }

  const nowMs = Date.now();
  const respawnAtMs = getRespawnAtMs(targetGameState);
  if (respawnAtMs !== null && nowMs < respawnAtMs) {
    return;
  }

  const currentHealth = Number.isFinite(targetGameState.health)
    ? targetGameState.health
    : PLAYER_MAX_HEALTH;
  const newHealth = Math.max(0, currentHealth - damage);

  targetGameState.health = newHealth;
  if (newHealth <= 0) {
    handlePlayerDefeat(session, playerId, targetGameState, nowMs);
  }
  if (session.players[playerId]) {
    session.players[playerId].health = targetGameState.health;
  }
}

function createSpellHookContext(session, nowMs, spawnQueue, map) {
  function spawnProjectile(spawnConfig = {}) {
    const ownerId = spawnConfig.ownerId;
    const ownerState = ownerId ? session.gameState.players[ownerId] : null;
    if (ownerId && !ownerState) {
      return null;
    }

    const spawnedProjectile = createSpellProjectile({
      spellId: spawnConfig.spellId,
      projectileId: randomUUID(),
      ownerId,
      originX: spawnConfig.x,
      originY: spawnConfig.y,
      targetX: spawnConfig.targetX,
      targetY: spawnConfig.targetY,
      vx: spawnConfig.vx,
      vy: spawnConfig.vy,
      nowMs,
      overrides: {
        size: spawnConfig.size,
        damage: spawnConfig.damage,
        lifetimeMs: spawnConfig.lifetimeMs,
        castAtMs: spawnConfig.castAtMs,
        hitPlayerIds: spawnConfig.hitPlayerIds,
        canPierce: spawnConfig.canPierce,
        canBounce: spawnConfig.canBounce,
        canHitOwner: spawnConfig.canHitOwner,
        meta: spawnConfig.meta,
      },
    });

    if (!spawnedProjectile) {
      return null;
    }

    spawnQueue.push(spawnedProjectile);
    if (ownerState) {
      incrementActiveCastCount(ownerState, spawnedProjectile.spellId);
    }

    return spawnedProjectile;
  }

  function getEnemyPlayerIdsInRadius(x, y, radius, ownerId) {
    return getCollidingPlayerIds(
      session.gameState.players,
      x,
      y,
      radius,
      ownerId,
      hitbox,
    ).filter((playerId) => !session.gameState.players[playerId]?.isGhost);
  }

  function applyAreaDamage({ ownerId, x, y, radius, damage, explicitTargetIds }) {
    const targetIds = Array.isArray(explicitTargetIds)
      ? explicitTargetIds
      : getEnemyPlayerIdsInRadius(x, y, radius, ownerId);

    const uniqueTargetIds = new Set(targetIds);
    for (const targetId of uniqueTargetIds) {
      applyPlayerDamage(session, targetId, damage);
    }
  }

  return {
    nowMs,
    map,
    stepMultiplier: PROJECTILE_STEP_MULTIPLIER,
    spawnProjectile,
    getPlayerCastOrigin(playerId) {
      const ownerState = session.gameState.players[playerId];
      return getPlayerCastOrigin(ownerState, hitbox);
    },
    getPlayerPosition(playerId) {
      const playerState = session.gameState.players[playerId];
      if (!playerState) {
        return null;
      }
      return getPlayerCastOrigin(playerState, hitbox);
    },
    getPlayerAim(playerId) {
      const playerState = session.gameState.players[playerId];
      if (!playerState) {
        return null;
      }

      if (Number.isFinite(playerState.aimX) && Number.isFinite(playerState.aimY)) {
        return {
          x: playerState.aimX,
          y: playerState.aimY,
        };
      }

      const fallbackOrigin = getPlayerCastOrigin(playerState, hitbox);
      if (!fallbackOrigin) {
        return null;
      }
      return {
        x: fallbackOrigin.x + 1,
        y: fallbackOrigin.y,
      };
    },
    hasPlayerMovementInput(playerId) {
      const playerState = session.gameState.players[playerId];
      if (!playerState) {
        return false;
      }
      return hasMovementInput(playerState.lastKeyState) || Boolean(playerState.pendingDash);
    },
    getEnemyPlayerIdsInRadius,
    applyAreaDamage,
  };
}

function finalizePendingSpellCast(session, playerId, playerState, nowMs) {
  if (playerState.isGhost) {
    cancelPendingSpellCast(playerState, nowMs);
    return;
  }

  const pendingCast = popReadyPendingSpellCast(playerState, nowMs);
  if (!pendingCast) {
    return;
  }

  const spell = getSpellById(pendingCast.spellId);
  if (!spell) {
    return;
  }
  const selectedSpellIds = Array.isArray(playerState.selectedSpellIds)
    ? playerState.selectedSpellIds
    : [];
  if (!selectedSpellIds.includes(spell.id)) {
    cancelPendingSpellCast(playerState);
    return;
  }

  const castValidation = validateSpellCast(playerState, spell, nowMs, {
    ignoreCastInProgress: true,
    ignoreStillness: true,
  });
  if (!castValidation.ok) {
    return;
  }

  const castOrigin = getPlayerCastOrigin(playerState, hitbox);
  if (!castOrigin) {
    return;
  }

  const projectile = createSpellProjectile({
    spell,
    projectileId: randomUUID(),
    ownerId: playerId,
    originX: castOrigin.x,
    originY: castOrigin.y,
    targetX: pendingCast.targetX,
    targetY: pendingCast.targetY,
    nowMs,
  });
  if (!projectile) {
    return;
  }

  applyNpcDamageMultiplier(projectile, playerState);
  applySpellCastCosts(playerState, spell, nowMs);
  incrementActiveCastCount(playerState, spell.id);
  session.gameState.projectiles.push(projectile);
}

function removeProjectile(projectiles, index, projectile, ownerState) {
  projectiles.splice(index, 1);
  if (ownerState) {
    decrementActiveCastCount(ownerState, projectile.spellId);
  }
}

function simulateProjectiles(session, map) {
  const projectiles = session.gameState.projectiles;
  const nowMs = Date.now();
  const spawnQueue = [];

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const projectile = projectiles[i];
    const ownerState = session.gameState.players[projectile.ownerId] || null;
    if (ownerState?.isGhost) {
      removeProjectile(projectiles, i, projectile, ownerState);
      continue;
    }

    if (!Number.isFinite(projectile.castAtMs)) {
      projectile.castAtMs = nowMs;
    }

    const lifetimeMs = Number.isFinite(projectile.lifetimeMs)
      ? Math.max(100, projectile.lifetimeMs)
      : PROJECTILE_LIFETIME_MS;

    const spellHookContext = createSpellHookContext(session, nowMs, spawnQueue, map);

    if (nowMs - projectile.castAtMs > lifetimeMs) {
      runSpellExpireHook(projectile, spellHookContext);
      removeProjectile(projectiles, i, projectile, ownerState);
      continue;
    }

    const movementResult = runSpellProjectileUpdate(projectile, spellHookContext);
    if (movementResult.removed) {
      removeProjectile(projectiles, i, projectile, ownerState);
      continue;
    }

    const collidingPlayerIds = getProjectileCollidingPlayerIds(
      session.gameState.players,
      projectile,
    );

    if (collidingPlayerIds.length === 0) {
      continue;
    }

    const canPierce = Boolean(projectile.canPierce);
    const hitPlayerIds = Array.isArray(projectile.hitPlayerIds)
      ? projectile.hitPlayerIds
      : [];

    let shouldRemoveProjectile = false;

    for (const hitPlayerId of collidingPlayerIds) {
      if (canPierce && hitPlayerIds.includes(hitPlayerId)) {
        continue;
      }

      const hitHookResult = runSpellHitPlayerHook(
        projectile,
        hitPlayerId,
        spellHookContext,
      );

      const skipDamage = Boolean(hitHookResult.skipDamage);
      let damage = Number.isFinite(projectile.damage)
        ? Math.max(0, projectile.damage)
        : 0;

      if (Number.isFinite(hitHookResult.damageOverride)) {
        damage = Math.max(0, hitHookResult.damageOverride);
      } else if (Number.isFinite(hitHookResult.damageMultiplier)) {
        damage *= Math.max(0, hitHookResult.damageMultiplier);
      }

      if (!skipDamage && damage > 0) {
        applyPlayerDamage(session, hitPlayerId, damage);
      }

      if (canPierce && hitHookResult.markAsHit !== false) {
        hitPlayerIds.push(hitPlayerId);
      }

      if (typeof hitHookResult.removeProjectile === "boolean") {
        shouldRemoveProjectile = hitHookResult.removeProjectile;
      } else if (!canPierce) {
        shouldRemoveProjectile = true;
      }

      if (shouldRemoveProjectile) {
        break;
      }
    }

    projectile.hitPlayerIds = hitPlayerIds;

    if (shouldRemoveProjectile) {
      removeProjectile(projectiles, i, projectile, ownerState);
    }
  }

  if (spawnQueue.length > 0) {
    projectiles.push(...spawnQueue);
  }
}

export function onTick(session, emitSnapshot = () => {}, endGame = () => {}) {
  const nowMs = Date.now();
  const map = getSessionMap(session);
  session.gameState.tickCounter++;

  if (session.gameState.matchEnded) {
    return;
  }
  const isPaused = Boolean(session.gameState.paused);

  if (!isPaused) {
    let playerIndex = 0;
    for (const [playerId, p] of Object.entries(session.gameState.players)) {
      if (!Number.isFinite(p.livesRemaining)) {
        p.livesRemaining = PLAYER_INITIAL_LIVES;
      }
      p.livesRemaining = Math.max(0, Math.floor(p.livesRemaining));
      p.isGhost = Boolean(p.isGhost);

      const respawnAtMs = getRespawnAtMs(p);
      if (!p.isGhost && respawnAtMs !== null) {
      if (nowMs >= respawnAtMs) {
        const respawnOrigin = resolvePlayerRespawnOrigin(map, p, playerIndex);
        if (respawnOrigin) {
          p.x = respawnOrigin.x;
          p.y = respawnOrigin.y;
          }
          p.health = PLAYER_MAX_HEALTH;
          p.respawnAtMs = null;
        } else {
          p.pendingDash = false;
          cancelPendingSpellCast(p, nowMs);
          playerIndex++;
          continue;
        }
      }

      if (p.isNpc) {
        applyNpcBehavior(session, playerId, nowMs);
      }

      regeneratePlayerMana(p, nowMs);

      const q = p.inputQueue;
      let hasPendingDashRequest = false;

      if (q && q.length > 0) {
        // Key-state netcode: accept newest input state, then move once per tick.
        let latestAcceptedInput = null;
        let latestDashRequestId = Number(p.lastDashRequestId) || 0;
        for (const i of q) {
          if (!i || typeof i.inputSeq !== "number") {
            continue;
          }
          if (i.inputSeq <= p.lastInputSeqReceived) {
            continue;
          }
          if (!latestAcceptedInput || i.inputSeq > latestAcceptedInput.inputSeq) {
            latestAcceptedInput = i;
          }

          const dashRequestId = Number(i.actions?.dashRequestId);
          if (
            Number.isFinite(dashRequestId) &&
            dashRequestId > latestDashRequestId
          ) {
            latestDashRequestId = dashRequestId;
            hasPendingDashRequest = true;
          }
        }

        if (latestAcceptedInput) {
          p.lastInputSeqReceived = latestAcceptedInput.inputSeq;
          p.lastProcessedInputSeq = latestAcceptedInput.inputSeq;
          p.lastKeyState = latestAcceptedInput.keys;
        }
        p.lastDashRequestId = latestDashRequestId;
        if (hasPendingDashRequest) {
          p.pendingDash = true;
        }

        q.length = 0;
      }

      const pendingCast = p.combat?.pendingCast;
      const castInProgress =
        pendingCast && Number.isFinite(pendingCast.completeAtMs)
          ? pendingCast.completeAtMs > nowMs
          : false;
      const hasMoveIntent =
        hasMovementInput(p.lastKeyState) || Boolean(p.pendingDash);
      if (castInProgress && pendingCast.requiresStillness && hasMoveIntent) {
        cancelPendingSpellCast(p, nowMs);
      }

      const rooted = isPlayerRooted(p, nowMs);
      const orbitBladesActive = getActiveCastCount(p, "orbitBlades") > 0;
      const tileEffectState = ensureTileEffectState(p);
      const slowMoveMultiplier = Number.isFinite(tileEffectState.activeSlowMultiplier)
        ? Math.max(0.1, Math.min(1, tileEffectState.activeSlowMultiplier))
        : 1;
      const npcSpeedMultiplier = Number.isFinite(p.npcProfile?.speedMultiplier)
        ? Math.max(0.4, Math.min(1.6, p.npcProfile.speedMultiplier))
        : 1;
      const effectiveMoveSpeed = orbitBladesActive
        ? movementSpeed * ORBIT_BLADE_MOVE_MULTIPLIER * slowMoveMultiplier * npcSpeedMultiplier
        : movementSpeed * slowMoveMultiplier * npcSpeedMultiplier;
      if (!rooted) {
        if (p.lastKeyState) {
          // no new input -> reuse last known key state
          ({ x: p.x, y: p.y } = move(
            p.x,
            p.y,
            p.lastKeyState,
            map,
            effectiveMoveSpeed,
            hitbox,
          ));
        }

        if (p.pendingDash) {
          if (orbitBladesActive) {
            p.pendingDash = false;
          } else {
            const lastDashAtMs = Number.isFinite(p.lastDashAtMs)
              ? p.lastDashAtMs
              : -Infinity;
            const canDash = nowMs - lastDashAtMs >= dashCooldownMs;
            if (canDash && hasMovementInput(p.lastKeyState)) {
              ({ x: p.x, y: p.y } = moveByDistance(
                p.x,
                p.y,
                p.lastKeyState,
                map,
                dashDistance,
                hitbox,
                effectiveMoveSpeed,
              ));
              p.lastDashAtMs = nowMs;
            }
          }
          p.pendingDash = false;
        }
      } else {
        p.pendingDash = false;
      }

      applyTileEffects(session, playerId, p, map, nowMs);
      finalizePendingSpellCast(session, playerId, p, nowMs);
      playerIndex++;
    }

    // Simulate projectiles
    simulateProjectiles(session, map);
  }

  const matchTimer = getMatchTimerSnapshot(session, nowMs);
  const eliminationResult = isPaused ? null : resolveEliminationResult(session);
  const isTimerExpired = !isPaused && matchTimer.matchTimeRemainingMs === 0;

  let matchResult = null;
  let endReason = null;
  if (eliminationResult) {
    matchResult = eliminationResult;
    endReason = "elimination";
  } else if (isTimerExpired) {
    matchResult = resolveScoreResult(session);
    endReason = "time";
  }

  const snapshot = buildSnapshot(session, nowMs, matchTimer);
  emitSnapshot(snapshot);

  if (matchResult && endReason) {
    session.gameState.matchEnded = true;
    const winnerId = matchResult.winnerId;
    const winnerName = winnerId ? session.players[winnerId]?.name || null : null;
    endGame({
      roomId: session.roomId,
      reason: endReason,
      winnerId,
      winnerName,
      isDraw: Boolean(matchResult.isDraw),
      scores: matchResult.scores,
    });
  }
}
