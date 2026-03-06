import { randomUUID } from "crypto";
import { hitbox } from "../../../shared/constants.js";
import {
  applySpellCastCosts,
  createSpellProjectile,
  getPlayerCastOrigin,
  getSpellById,
  incrementActiveCastCount,
  queuePendingSpellCast,
  validateSpellCast,
} from "../../../shared/spells.js";
import {
  getNpcArchetypeById,
  getNpcDifficultyById,
  getNpcEffectiveStats,
  sanitizeNpcConfig,
} from "../../../shared/npc.js";

const SPELL_RANGE_HINT = Object.freeze({
  magicMissile: "mid",
  fireball: "mid",
  boomerang: "mid",
  icebolt: "long",
  riftMine: "close",
  comet: "long",
  orbitBlades: "close",
  fractureBeam: "mid",
  flamethrower: "close",
  flamePhoenix: "long",
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getPlayerCenter(playerState) {
  return getPlayerCastOrigin(playerState, hitbox);
}

function getAliveTargetIds(session, playerId) {
  const players = session?.gameState?.players || {};
  return Object.entries(players)
    .filter(([id, state]) => {
      if (!state || id === playerId) {
        return false;
      }
      if (state.isGhost) {
        return false;
      }
      if ((state.health ?? 0) <= 0) {
        return false;
      }
      return true;
    })
    .map(([id]) => id);
}

function chooseTargetId(session, playerId, npcState, effectiveStats, difficulty) {
  const targetIds = getAliveTargetIds(session, playerId);
  if (targetIds.length === 0) {
    return null;
  }

  const switchChance = clamp(0.35 - effectiveStats.precision * 0.18, 0.06, 0.35);
  if (npcState.lastTargetId && Math.random() > switchChance) {
    return npcState.lastTargetId;
  }

  const targetRandomness = Number.isFinite(difficulty?.targetRandomness)
    ? clamp(difficulty.targetRandomness, 0, 0.9)
    : 0.25;
  if (Math.random() < targetRandomness) {
    return targetIds[Math.floor(Math.random() * targetIds.length)];
  }

  const selfCenter = getPlayerCenter(session.gameState.players[playerId]);
  if (!selfCenter) {
    return targetIds[0];
  }

  let nearestId = targetIds[0];
  let nearestDist = Infinity;
  for (const targetId of targetIds) {
    const targetState = session.gameState.players[targetId];
    const targetCenter = getPlayerCenter(targetState);
    if (!targetCenter) {
      continue;
    }
    const dist = Math.hypot(
      targetCenter.x - selfCenter.x,
      targetCenter.y - selfCenter.y,
    );
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestId = targetId;
    }
  }
  return nearestId;
}

function computeAimOffset(effectiveStats, map, difficulty) {
  const tileSize = Number(map?.config?.tileSize) || 48;
  const spreadMultiplier = Number.isFinite(difficulty?.aimSpreadMultiplier)
    ? difficulty.aimSpreadMultiplier
    : 1;
  const maxError = clamp(
    (240 - effectiveStats.precision * 160) * spreadMultiplier,
    14,
    260,
  );
  const errorScale = (Math.random() * 0.7 + 0.3) * maxError;
  const angle = Math.random() * Math.PI * 2;
  const offsetX = Math.cos(angle) * errorScale;
  const offsetY = Math.sin(angle) * errorScale;
  return {
    x: offsetX * (tileSize / 48),
    y: offsetY * (tileSize / 48),
  };
}

function getMovementKeysFromVector(dx, dy) {
  const threshold = 6;
  return {
    left: dx < -threshold,
    right: dx > threshold,
    up: dy < -threshold,
    down: dy > threshold,
  };
}

function computeMovementIntent(selfCenter, targetCenter, preferredRange, npcState, effectiveStats) {
  const dx = targetCenter.x - selfCenter.x;
  const dy = targetCenter.y - selfCenter.y;
  const distance = Math.hypot(dx, dy);
  const buffer = 40 + (1 - effectiveStats.mobility) * 30;
  let moveX = 0;
  let moveY = 0;

  if (distance > preferredRange + buffer) {
    moveX = dx;
    moveY = dy;
  } else if (distance < preferredRange - buffer) {
    moveX = -dx;
    moveY = -dy;
  } else {
    const strafeDirection = npcState.strafeDir || 1;
    moveX = -dy * strafeDirection;
    moveY = dx * strafeDirection;
    if (Math.random() < 0.08) {
      npcState.strafeDir = strafeDirection * -1;
    }
  }

  if (Math.random() < 0.18 * (1 - effectiveStats.aggression)) {
    moveX = 0;
    moveY = 0;
  }

  return {
    keys: getMovementKeysFromVector(moveX, moveY),
    distance,
  };
}

function pickSpellForDistance(spellIds, distance, difficulty) {
  const strategyNoise = Number.isFinite(difficulty?.strategyNoise)
    ? clamp(difficulty.strategyNoise, 0, 0.8)
    : 0.18;
  if (Math.random() < strategyNoise) {
    return spellIds[Math.floor(Math.random() * spellIds.length)];
  }

  const weights = [];
  for (const spellId of spellIds) {
    const hint = SPELL_RANGE_HINT[spellId] || "mid";
    let weight = 1;
    if (hint === "close") {
      weight = distance < 220 ? 2.2 : 0.6;
    } else if (hint === "long") {
      weight = distance > 360 ? 2.1 : 0.7;
    } else {
      weight = distance > 220 && distance < 420 ? 2.0 : 0.8;
    }
    weights.push(weight);
  }

  const total = weights.reduce((sum, value) => sum + value, 0);
  let roll = Math.random() * total;
  for (let index = 0; index < spellIds.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) {
      return spellIds[index];
    }
  }
  return spellIds[0];
}

function ensureNpcState(playerState) {
  if (!playerState.npcState || typeof playerState.npcState !== "object") {
    playerState.npcState = {
      lastTargetId: null,
      nextDecisionAtMs: 0,
      nextCastAtMs: 0,
      nextAimUpdateAtMs: 0,
      strafeDir: 1,
      lastAimX: null,
      lastAimY: null,
    };
  }
  return playerState.npcState;
}

function shouldFailAction(effectiveStats, difficultyPreset) {
  const baseFailure = difficultyPreset?.baseFailureRate ?? 0.18;
  const failureChance = clamp(baseFailure + (1 - effectiveStats.precision) * 0.25, 0.04, 0.45);
  return Math.random() < failureChance;
}

export function buildNpcProfile(config) {
  const sanitized = sanitizeNpcConfig(config);
  const archetype = getNpcArchetypeById(sanitized.archetypeId);
  const stats = getNpcEffectiveStats(sanitized);
  const difficulty = getNpcDifficultyById(sanitized.difficulty);

  return {
    name: sanitized.name,
    archetypeId: archetype.id,
    archetypeName: archetype.name,
    preferredRange: archetype.preferredRange,
    loadout: archetype.loadout.slice(),
    difficultyId: difficulty.id,
    difficultyLabel: difficulty.label,
    effectiveStats: stats.effectiveStats,
    difficulty,
    effectivenessScore: stats.effectivenessScore,
    powerMultiplier: clamp(0.55 + stats.effectiveStats.power * 0.85, 0.45, 1.8),
    speedMultiplier: clamp(0.55 + stats.effectiveStats.mobility * 0.7, 0.5, 1.6),
  };
}

export function applyNpcBehavior(session, playerId, nowMs) {
  const playerState = session?.gameState?.players?.[playerId];
  if (!playerState || !playerState.isNpc) {
    return;
  }

  const npcProfile = playerState.npcProfile;
  if (!npcProfile) {
    return;
  }

  const npcState = ensureNpcState(playerState);
  const effectiveStats = npcProfile.effectiveStats;
  const difficulty = npcProfile.difficulty;
  const reactionMs = difficulty?.reactionMs ?? 220;

  if (nowMs < npcState.nextDecisionAtMs) {
    return;
  }

  const selfCenter = getPlayerCenter(playerState);
  if (!selfCenter) {
    return;
  }

  const targetId = chooseTargetId(
    session,
    playerId,
    npcState,
    effectiveStats,
    difficulty,
  );
  npcState.lastTargetId = targetId;
  const targetState = targetId ? session.gameState.players[targetId] : null;
  const targetCenter = targetState ? getPlayerCenter(targetState) : null;

  if (!targetCenter) {
    playerState.lastKeyState = { up: false, down: false, left: false, right: false };
    npcState.nextDecisionAtMs = nowMs + reactionMs;
    return;
  }

  const preferredRange = npcProfile.preferredRange * (1.1 - effectiveStats.aggression * 0.15);
  const movementIntent = computeMovementIntent(
    selfCenter,
    targetCenter,
    preferredRange,
    npcState,
    effectiveStats,
  );

  if (shouldFailAction(effectiveStats, difficulty)) {
    playerState.lastKeyState = { up: false, down: false, left: false, right: false };
  } else {
    playerState.lastKeyState = movementIntent.keys;
  }

  const dashMultiplier = Number.isFinite(difficulty?.dashChanceMultiplier)
    ? difficulty.dashChanceMultiplier
    : 1;
  const dashChance = clamp(
    (0.06 + effectiveStats.mobility * 0.22) * dashMultiplier,
    0.03,
    0.4,
  );
  if (movementIntent.distance > preferredRange * 1.4 && Math.random() < dashChance) {
    playerState.pendingDash = true;
  }

  if (nowMs >= npcState.nextAimUpdateAtMs) {
    const aimOffset = computeAimOffset(
      effectiveStats,
      session.gameState.map,
      difficulty,
    );
    playerState.aimX = targetCenter.x + aimOffset.x;
    playerState.aimY = targetCenter.y + aimOffset.y;
    npcState.lastAimX = playerState.aimX;
    npcState.lastAimY = playerState.aimY;
    npcState.nextAimUpdateAtMs = nowMs + reactionMs * (0.7 + Math.random() * 0.6);
  }

  const selectedSpellIds = Array.isArray(playerState.selectedSpellIds)
    ? playerState.selectedSpellIds
    : npcProfile.loadout;

  if (
    selectedSpellIds.length > 0 &&
    nowMs >= npcState.nextCastAtMs &&
    !shouldFailAction(effectiveStats, difficulty)
  ) {
    const spellId = pickSpellForDistance(
      selectedSpellIds,
      movementIntent.distance,
      difficulty,
    );
    const spell = getSpellById(spellId);
    if (spell) {
      const castTimeMs = Number.isFinite(spell.castTimeMs)
        ? Math.max(0, spell.castTimeMs)
        : 0;
      if (castTimeMs > 0 && spell.castRequiresStillness) {
        playerState.lastKeyState = {
          up: false,
          down: false,
          left: false,
          right: false,
        };
      }

      const castValidation = validateSpellCast(playerState, spell, nowMs);
      if (castValidation.ok) {
        const castOrigin = getPlayerCastOrigin(playerState, hitbox);
        if (castOrigin) {
          const castTargetX = Number.isFinite(playerState.aimX)
            ? playerState.aimX
            : targetCenter.x;
          const castTargetY = Number.isFinite(playerState.aimY)
            ? playerState.aimY
            : targetCenter.y;

          if (castTimeMs > 0) {
            queuePendingSpellCast(playerState, spell, castTargetX, castTargetY, nowMs);
          } else {
            const projectile = createSpellProjectile({
              spell,
              projectileId: randomUUID(),
              ownerId: playerId,
              originX: castOrigin.x,
              originY: castOrigin.y,
              targetX: castTargetX,
              targetY: castTargetY,
              nowMs,
              overrides: {
                damage: spell.damage * npcProfile.powerMultiplier,
              },
            });

            if (projectile) {
              applySpellCastCosts(playerState, spell, nowMs);
              incrementActiveCastCount(playerState, spell.id);
              session.gameState.projectiles.push(projectile);
            }
          }
        }
      }
    }

    const tempoFactor = clamp(effectiveStats.tempo, 0.25, 1.7);
    const cadenceMultiplier = Number.isFinite(difficulty?.castCadenceMultiplier)
      ? difficulty.castCadenceMultiplier
      : 1;
    const baseInterval = (1500 - tempoFactor * 900) / cadenceMultiplier;
    npcState.nextCastAtMs =
      nowMs + Math.max(250, baseInterval * (0.8 + Math.random() * 0.4));
  }

  npcState.nextDecisionAtMs = nowMs + reactionMs * (0.7 + Math.random() * 0.6);
}

export function applyNpcDamageMultiplier(projectile, playerState) {
  const npcProfile = playerState?.npcProfile;
  if (!npcProfile) {
    return;
  }
  if (Number.isFinite(projectile.damage)) {
    projectile.damage = projectile.damage * npcProfile.powerMultiplier;
  }
}
