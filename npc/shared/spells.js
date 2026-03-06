import { hasMovementInput } from "./movement.js";

export const PROJECTILE_LIFETIME_MS = 3000;
export const PROJECTILE_STEP_MULTIPLIER = 2;

export const PLAYER_MAX_MANA = 100;
export const PLAYER_MANA_REGEN_PER_SECOND = 12;
export const DEFAULT_GLOBAL_COOLDOWN_MS = 250;

export const SPELL_CAST_REJECTION = Object.freeze({
  INVALID_STATE: "invalid-state",
  INVALID_PAYLOAD: "invalid-payload",
  INVALID_TARGET: "invalid-target",
  UNKNOWN_SPELL: "unknown-spell",
  SPELL_NOT_EQUIPPED: "spell-not-equipped",
  PLAYER_NOT_FOUND: "player-not-found",
  PLAYER_DEAD: "player-dead",
  NOT_ENOUGH_MANA: "not-enough-mana",
  SPELL_ON_COOLDOWN: "spell-on-cooldown",
  GLOBAL_COOLDOWN: "global-cooldown",
  ACTIVE_CAST_CAP_REACHED: "active-cast-cap-reached",
  CAST_IN_PROGRESS: "cast-in-progress",
  CAST_REQUIRES_STILLNESS: "cast-requires-stillness",
});

export const REQUIRED_SPELL_LOADOUT_SIZE = 3;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createFallbackProjectileId() {
  return `proj-${Math.random().toString(36).slice(2, 11)}`;
}

function createProjectileId() {
  const cryptoApi = globalThis?.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return createFallbackProjectileId();
}

function ensureProjectileMeta(projectile) {
  if (!projectile.meta || typeof projectile.meta !== "object") {
    projectile.meta = {};
  }
  return projectile.meta;
}

function getSpeed(vx = 0, vy = 0) {
  return Math.hypot(vx, vy);
}

function normalizeVector(vx = 0, vy = 0, fallbackVx = 1, fallbackVy = 0) {
  const speed = Math.hypot(vx, vy);
  if (speed < 1e-6 || !Number.isFinite(speed)) {
    return normalizeVector(fallbackVx, fallbackVy, 1, 0);
  }
  return {
    x: vx / speed,
    y: vy / speed,
  };
}

function rotateVector(vx = 0, vy = 0, angleRad = 0) {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    x: vx * cos - vy * sin,
    y: vx * sin + vy * cos,
  };
}

function defaultOnSpawn(projectile) {
  projectile.canPierce = Boolean(projectile.canPierce);
  projectile.canBounce = Boolean(projectile.canBounce);
  projectile.canHitOwner = Boolean(projectile.canHitOwner);
  ensureProjectileMeta(projectile);
}

function explodeRiftMine(projectile, context, explicitTargetIds = null) {
  const meta = ensureProjectileMeta(projectile);
  if (meta.hasExploded) {
    return;
  }

  meta.hasExploded = true;

  if (typeof context.applyAreaDamage !== "function") {
    return;
  }

  context.applyAreaDamage({
    ownerId: projectile.ownerId,
    x: projectile.x,
    y: projectile.y,
    radius: Number.isFinite(meta.explosionRadius) ? meta.explosionRadius : 130,
    damage: Number.isFinite(meta.explosionDamage)
      ? meta.explosionDamage
      : projectile.damage,
    projectile,
    explicitTargetIds,
  });
}

function updateBoomerang(projectile, context) {
  const meta = ensureProjectileMeta(projectile);
  const maxLifetimeMs = Number.isFinite(meta.maxLifetimeMs)
    ? Math.max(100, meta.maxLifetimeMs)
    : 3000;
  if (context.nowMs - projectile.castAtMs >= maxLifetimeMs) {
    return {
      removed: true,
      reason: "boomerang-expired",
      hitWall: false,
    };
  }

  if (!meta.returning) {
    const returnAfterMs = Number.isFinite(meta.returnAfterMs)
      ? meta.returnAfterMs
      : 520;
    if (context.nowMs - projectile.castAtMs >= returnAfterMs) {
      meta.returning = true;
    }
  }

  if (meta.returning && typeof context.getPlayerCastOrigin === "function") {
    const ownerOrigin = context.getPlayerCastOrigin(projectile.ownerId);
    if (ownerOrigin) {
      const dx = ownerOrigin.x - projectile.x;
      const dy = ownerOrigin.y - projectile.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= Math.max(8, (projectile.size ?? 0) * 0.6)) {
        return {
          removed: true,
          reason: "returned-to-owner",
          hitWall: false,
        };
      }

      const maxSpeed = Number.isFinite(meta.maxReturnSpeed)
        ? meta.maxReturnSpeed
        : Math.max(10, getSpeed(projectile.vx, projectile.vy));
      if (distance > 1e-6) {
        projectile.vx = (dx / distance) * maxSpeed;
        projectile.vy = (dy / distance) * maxSpeed;
      }
    }
  }

  return defaultProjectileUpdate(projectile, context);
}

function updateRiftMine(projectile, context) {
  const meta = ensureProjectileMeta(projectile);
  const isMoving = getSpeed(projectile.vx, projectile.vy) > 0.01;

  if (!meta.stuck && isMoving) {
    const movementResult = defaultProjectileUpdate(projectile, context);
    if (movementResult.removed && movementResult.hitWall) {
      projectile.vx = 0;
      projectile.vy = 0;
      meta.stuck = true;
      return {
        removed: false,
        reason: "mine-embedded",
        hitWall: true,
      };
    }

    if (movementResult.removed) {
      return movementResult;
    }
  }

  const armDelayMs = Number.isFinite(meta.armDelayMs) ? meta.armDelayMs : 700;
  if (!meta.armed && context.nowMs - projectile.castAtMs >= armDelayMs) {
    meta.armed = true;
  }

  if (
    meta.armed &&
    typeof context.getEnemyPlayerIdsInRadius === "function"
  ) {
    const triggerRadius = Number.isFinite(meta.triggerRadius)
      ? meta.triggerRadius
      : 110;
    const targetIds = context.getEnemyPlayerIdsInRadius(
      projectile.x,
      projectile.y,
      triggerRadius,
      projectile.ownerId,
    );

    if (targetIds.length > 0) {
      explodeRiftMine(projectile, context, targetIds);
      return {
        removed: true,
        reason: "rift-mine-detonated",
        hitWall: false,
      };
    }
  }

  return {
    removed: false,
    reason: null,
    hitWall: false,
  };
}

function updateComet(projectile, context) {
  const meta = ensureProjectileMeta(projectile);
  const stepMultiplier = Number.isFinite(context.stepMultiplier)
    ? context.stepMultiplier
    : PROJECTILE_STEP_MULTIPLIER;

  if (Number.isFinite(meta.targetX)) {
    projectile.x = meta.targetX;
    projectile.vx = 0;
  }

  if (!Number.isFinite(meta.targetY)) {
    meta.targetY = projectile.y;
  }

  projectile.y += stepMultiplier * projectile.vy;
  if (isProjectileOutOfBounds(projectile, context.map)) {
    return {
      removed: true,
      reason: "out-of-bounds",
      hitWall: true,
    };
  }

  if (projectile.y >= meta.targetY) {
    if (typeof context.applyAreaDamage === "function") {
      context.applyAreaDamage({
        ownerId: projectile.ownerId,
        x: projectile.x,
        y: meta.targetY,
        radius: Number.isFinite(meta.impactRadius) ? meta.impactRadius : 130,
        damage: Number.isFinite(meta.impactDamage)
          ? meta.impactDamage
          : projectile.damage,
        projectile,
      });
    }

    return {
      removed: true,
      reason: "comet-impact",
      hitWall: false,
    };
  }

  return {
    removed: false,
    reason: null,
    hitWall: false,
  };
}

function updateOrbitBlade(projectile, context) {
  const meta = ensureProjectileMeta(projectile);
  const orbitCount = Number.isFinite(meta.orbitCount)
    ? Math.max(1, Math.floor(meta.orbitCount))
    : 3;
  const orbitIndex = Number.isFinite(meta.orbitIndex)
    ? Math.max(0, Math.floor(meta.orbitIndex))
    : 0;

  if (
    orbitIndex === 0 &&
    !meta.didSpawnOrbitGroup &&
    typeof context.spawnProjectile === "function"
  ) {
    meta.didSpawnOrbitGroup = true;
    for (let index = 1; index < orbitCount; index++) {
      context.spawnProjectile({
        spellId: projectile.spellId,
        ownerId: projectile.ownerId,
        x: projectile.x,
        y: projectile.y,
        vx: projectile.vx,
        vy: projectile.vy,
        castAtMs: projectile.castAtMs,
        size: projectile.size,
        damage: projectile.damage,
        lifetimeMs: projectile.lifetimeMs,
        canPierce: true,
        canBounce: false,
        meta: {
          orbitCount,
          orbitIndex: index,
          orbitRadius: meta.orbitRadius,
          angularSpeed: meta.angularSpeed,
          baseAngle: meta.baseAngle,
          didSpawnOrbitGroup: true,
        },
      });
    }
  }

  const ownerOrigin =
    typeof context.getPlayerCastOrigin === "function"
      ? context.getPlayerCastOrigin(projectile.ownerId)
      : null;
  if (!ownerOrigin) {
    return {
      removed: true,
      reason: "owner-missing",
      hitWall: false,
    };
  }

  const orbitRadius = Number.isFinite(meta.orbitRadius)
    ? Math.max(8, meta.orbitRadius)
    : 72;
  const angularSpeed = Number.isFinite(meta.angularSpeed)
    ? meta.angularSpeed
    : 0.008;
  const elapsedMs = Math.max(0, context.nowMs - projectile.castAtMs);
  const baseAngle = Number.isFinite(meta.baseAngle)
    ? meta.baseAngle
    : Math.atan2(projectile.vy, projectile.vx);
  const angle =
    baseAngle +
    elapsedMs * angularSpeed +
    (Math.PI * 2 * (orbitIndex % orbitCount)) / orbitCount;

  projectile.x = ownerOrigin.x + Math.cos(angle) * orbitRadius;
  projectile.y = ownerOrigin.y + Math.sin(angle) * orbitRadius;
  projectile.vx = -Math.sin(angle) * orbitRadius * angularSpeed;
  projectile.vy = Math.cos(angle) * orbitRadius * angularSpeed;

  return {
    removed: false,
    reason: null,
    hitWall: false,
  };
}

function spawnFractureShards(projectile, context) {
  if (typeof context.spawnProjectile !== "function") {
    return;
  }

  const meta = ensureProjectileMeta(projectile);
  const fractureDepth = Number.isFinite(meta.fractureDepth)
    ? Math.max(0, Math.floor(meta.fractureDepth))
    : 0;
  if (fractureDepth <= 0) {
    return;
  }

  const baseSpeed = Math.max(8, getSpeed(projectile.vx, projectile.vy) * 0.62);
  const shardLifetimeMs = Math.max(300, Math.floor((projectile.lifetimeMs || 1200) * 0.42));
  const shardSize = Math.max(7, Math.round((projectile.size || 12) * 0.68));
  const shardDamage = Math.max(1, Math.round((projectile.damage || 1) * 0.45));
  const tileSize = Number.isFinite(context.map?.config?.tileSize)
    ? context.map.config.tileSize
    : 48;
  const maxTravelDistance = tileSize * 2;

  const shardCount = 12;
  const angleOffset = (projectile.castAtMs % 360) * (Math.PI / 180);
  for (let index = 0; index < shardCount; index++) {
    const angle = angleOffset + (Math.PI * 2 * index) / shardCount;
    const rotated = rotateVector(1, 0, angle);
    const speedScale = 0.78 + ((index % 3) - 1) * 0.11;
    context.spawnProjectile({
      spellId: projectile.spellId,
      ownerId: projectile.ownerId,
      x: projectile.x,
      y: projectile.y,
      vx: rotated.x * baseSpeed * speedScale,
      vy: rotated.y * baseSpeed * speedScale,
      size: shardSize,
      damage: shardDamage,
      lifetimeMs: shardLifetimeMs,
      canPierce: false,
      canBounce: false,
      meta: {
        fractureDepth: fractureDepth - 1,
        isFractureShard: true,
        traveledDistance: 0,
        maxTravelDistance,
      },
    });
  }
}

function updateFractureBeam(projectile, context) {
  const previousX = projectile.x;
  const previousY = projectile.y;
  const movementResult = defaultProjectileUpdate(projectile, context);
  if (movementResult.removed) {
    return movementResult;
  }

  const meta = ensureProjectileMeta(projectile);
  if (!meta.isFractureShard) {
    return movementResult;
  }

  const lastX = Number.isFinite(meta.lastX) ? meta.lastX : previousX;
  const lastY = Number.isFinite(meta.lastY) ? meta.lastY : previousY;
  const deltaDistance = Math.hypot(projectile.x - lastX, projectile.y - lastY);
  const traveledDistance = Number.isFinite(meta.traveledDistance)
    ? meta.traveledDistance + deltaDistance
    : deltaDistance;
  meta.lastX = projectile.x;
  meta.lastY = projectile.y;
  meta.traveledDistance = traveledDistance;

  const maxTravelDistance = Number.isFinite(meta.maxTravelDistance)
    ? Math.max(1, meta.maxTravelDistance)
    : 96;
  if (traveledDistance >= maxTravelDistance) {
    return {
      removed: true,
      reason: "fracture-shard-max-distance",
      hitWall: false,
    };
  }

  return movementResult;
}

function updateFlamethrower(projectile, context) {
  const meta = ensureProjectileMeta(projectile);
  const isFlameBurst = Boolean(meta.isFlameBurst);
  if (isFlameBurst) {
    return defaultProjectileUpdate(projectile, context);
  }

  if (typeof context.getPlayerCastOrigin !== "function") {
    return {
      removed: true,
      reason: "owner-origin-missing",
      hitWall: false,
    };
  }

  if (
    typeof context.hasPlayerMovementInput === "function" &&
    context.hasPlayerMovementInput(projectile.ownerId)
  ) {
    return {
      removed: true,
      reason: "flamethrower-interrupted-by-movement",
      hitWall: false,
    };
  }

  const ownerOrigin = context.getPlayerCastOrigin(projectile.ownerId);
  if (!ownerOrigin) {
    return {
      removed: true,
      reason: "owner-missing",
      hitWall: false,
    };
  }

  const ownerAim =
    typeof context.getPlayerAim === "function"
      ? context.getPlayerAim(projectile.ownerId)
      : null;
  const aimX = Number.isFinite(ownerAim?.x)
    ? ownerAim.x
    : Number.isFinite(meta.castTargetX)
      ? meta.castTargetX
      : ownerOrigin.x + 1;
  const aimY = Number.isFinite(ownerAim?.y)
    ? ownerAim.y
    : Number.isFinite(meta.castTargetY)
      ? meta.castTargetY
      : ownerOrigin.y;

  const direction = normalizeVector(
    aimX - ownerOrigin.x,
    aimY - ownerOrigin.y,
    Number.isFinite(meta.directionX) ? meta.directionX : 1,
    Number.isFinite(meta.directionY) ? meta.directionY : 0,
  );
  meta.directionX = direction.x;
  meta.directionY = direction.y;

  projectile.x = ownerOrigin.x + direction.x * 22;
  projectile.y = ownerOrigin.y + direction.y * 22;
  projectile.vx = 0;
  projectile.vy = 0;

  const spawnIntervalMs = Number.isFinite(meta.flameSpawnIntervalMs)
    ? Math.max(20, meta.flameSpawnIntervalMs)
    : 75;
  const flameSpeed = Number.isFinite(meta.flameSpeed)
    ? Math.max(1, meta.flameSpeed)
    : 9;
  const flameLifetimeMs = Number.isFinite(meta.flameLifetimeMs)
    ? Math.max(120, meta.flameLifetimeMs)
    : 650;
  const flameDamage = Number.isFinite(meta.flameDamage)
    ? Math.max(1, meta.flameDamage)
    : 4;
  const flameSize = Number.isFinite(meta.flameSize)
    ? Math.max(4, meta.flameSize)
    : 18;
  const spreadRad = Number.isFinite(meta.spreadRad)
    ? Math.max(0, meta.spreadRad)
    : 0.11;
  const nowMs = Number.isFinite(context.nowMs) ? context.nowMs : Date.now();
  if (!Number.isFinite(meta.nextFlameSpawnAtMs)) {
    meta.nextFlameSpawnAtMs = nowMs;
  }
  if (!Number.isFinite(meta.spawnCounter)) {
    meta.spawnCounter = 0;
  }

  if (typeof context.spawnProjectile === "function") {
    const maxSpawnPerTick = 5;
    let spawnedThisTick = 0;
    while (meta.nextFlameSpawnAtMs <= nowMs && spawnedThisTick < maxSpawnPerTick) {
      const spreadSeed = Math.sin((projectile.castAtMs + meta.spawnCounter * 47.31) * 0.017);
      const spreadAngle = spreadSeed * spreadRad;
      const spreadDirection = rotateVector(direction.x, direction.y, spreadAngle);

      context.spawnProjectile({
        spellId: projectile.spellId,
        ownerId: projectile.ownerId,
        x: ownerOrigin.x + spreadDirection.x * 24,
        y: ownerOrigin.y + spreadDirection.y * 24,
        vx: spreadDirection.x * flameSpeed,
        vy: spreadDirection.y * flameSpeed,
        size: flameSize,
        damage: flameDamage,
        lifetimeMs: flameLifetimeMs,
        canPierce: false,
        canBounce: false,
        canHitOwner: false,
        meta: {
          isFlameBurst: true,
          directionX: spreadDirection.x,
          directionY: spreadDirection.y,
        },
      });

      meta.spawnCounter += 1;
      meta.nextFlameSpawnAtMs += spawnIntervalMs;
      spawnedThisTick += 1;
    }
  }

  return {
    removed: false,
    reason: null,
    hitWall: false,
  };
}

export const SPELLS = [
  {
    id: "fireball",
    name: "Fireball",
    description: "A ball of fire that explodes on impact",
    damage: 40,
    speed: 12,
    size: 20,
    cssClass: "fireball",
    manaCost: 18,
    cooldownMs: 900,
    globalCooldownMs: 250,
    maxActiveCasts: 3,
    lifetimeMs: 2800,
    onSpawn(projectile) {
      projectile.canPierce = false;
      projectile.canBounce = false;
      defaultOnSpawn(projectile);
    },
    update: defaultProjectileUpdate,
  },
  {
    id: "icebolt",
    name: "Icebolt",
    description: "A heavy bolt that ricochets off walls",
    damage: 35,
    speed: 10,
    size: 24,
    cssClass: "icebolt",
    manaCost: 26,
    cooldownMs: 1200,
    globalCooldownMs: 250,
    maxActiveCasts: 2,
    lifetimeMs: 3200,
    onSpawn(projectile) {
      projectile.canPierce = false;
      projectile.canBounce = true;
      defaultOnSpawn(projectile);
    },
    update: defaultProjectileUpdate,
  },
  {
    id: "magicMissile",
    name: "Magic Missile",
    description: "A fast bolt that pierces enemies",
    damage: 10,
    speed: 14,
    size: 12,
    cssClass: "magic-missile",
    manaCost: 10,
    cooldownMs: 550,
    globalCooldownMs: 170,
    maxActiveCasts: 6,
    lifetimeMs: 2200,
    onSpawn(projectile) {
      projectile.canPierce = true;
      projectile.canBounce = false;
      defaultOnSpawn(projectile);
    },
    update: defaultProjectileUpdate,
  },
  {
    id: "boomerang",
    name: "Boomerang",
    description: "Curves back to the caster and can strike multiple enemies",
    damage: 18,
    speed: 13,
    size: 16,
    cssClass: "boomerang",
    manaCost: 24,
    cooldownMs: 1500,
    globalCooldownMs: 250,
    maxActiveCasts: 3,
    lifetimeMs: 3000,
    onSpawn(projectile, context) {
      projectile.canPierce = true;
      projectile.canBounce = true;
      defaultOnSpawn(projectile);
      projectile.meta.returnAfterMs = 520;
      projectile.meta.returning = false;
      projectile.meta.maxReturnSpeed = Math.max(14, getSpeed(projectile.vx, projectile.vy));
      projectile.meta.maxLifetimeMs = 3000;
      projectile.castAtMs = context.nowMs;
    },
    update: updateBoomerang,
    onHitPlayer() {
      return {
        removeProjectile: false,
      };
    },
  },
  {
    id: "riftMine",
    name: "Rift Mine",
    description: "Arms after landing and detonates when enemies get close",
    damage: 34,
    speed: 7,
    size: 18,
    cssClass: "rift-mine",
    manaCost: 34,
    cooldownMs: 2200,
    globalCooldownMs: 300,
    maxActiveCasts: 3,
    lifetimeMs: 6000,
    onSpawn(projectile, context) {
      projectile.canPierce = false;
      projectile.canBounce = false;
      defaultOnSpawn(projectile);
      projectile.meta.armDelayMs = 700;
      projectile.meta.armed = false;
      projectile.meta.triggerRadius = 110;
      projectile.meta.explosionRadius = 130;
      projectile.meta.explosionDamage = projectile.damage;
      projectile.meta.stuck = false;
      projectile.meta.hasExploded = false;
      projectile.castAtMs = context.nowMs;
    },
    update: updateRiftMine,
    onHitPlayer(projectile, context, hitPlayerId) {
      explodeRiftMine(projectile, context, [hitPlayerId]);
      return {
        removeProjectile: true,
        skipDamage: true,
      };
    },
    onExpire(projectile, context) {
      explodeRiftMine(projectile, context, null);
    },
  },
  {
    id: "comet",
    name: "Comet",
    description: "Calls down a celestial strike that explodes on impact",
    damage: 56,
    speed: 5,
    size: 40,
    cssClass: "comet",
    manaCost: 38,
    cooldownMs: 3000,
    globalCooldownMs: 300,
    maxActiveCasts: 2,
    lifetimeMs: 4600,
    onSpawn(projectile) {
      projectile.canPierce = true;
      projectile.canBounce = false;
      defaultOnSpawn(projectile);

      const meta = ensureProjectileMeta(projectile);
      const targetX = Number.isFinite(meta.castTargetX)
        ? meta.castTargetX
        : projectile.x;
      const targetY = Number.isFinite(meta.castTargetY)
        ? meta.castTargetY
        : projectile.y;
      const dropHeight = Number.isFinite(meta.dropHeight)
        ? Math.max(120, meta.dropHeight)
        : 480;

      projectile.x = targetX;
      projectile.y = Math.max(8, targetY - dropHeight);
      projectile.vx = 0;
      projectile.vy = Number.isFinite(meta.fallSpeed)
        ? Math.max(3, meta.fallSpeed)
        : 5;

      meta.targetX = targetX;
      meta.targetY = targetY;
      meta.impactRadius = Number.isFinite(meta.impactRadius)
        ? Math.max(70, meta.impactRadius)
        : 145;
      meta.impactDamage = Number.isFinite(meta.impactDamage)
        ? Math.max(1, meta.impactDamage)
        : projectile.damage;
    },
    update: updateComet,
    onHitPlayer() {
      return {
        skipDamage: true,
        removeProjectile: false,
      };
    },
  },
  {
    id: "orbitBlades",
    name: "Orbit Blades",
    description: "Summons rotating blades that orbit the caster",
    damage: 15,
    speed: 8,
    size: 22,
    cssClass: "orbit-blade",
    manaCost: 32,
    cooldownMs: 3600,
    globalCooldownMs: 280,
    maxActiveCasts: 12,
    lifetimeMs: 3600,
    onSpawn(projectile, context) {
      projectile.canPierce = true;
      projectile.canBounce = false;
      defaultOnSpawn(projectile);

      const meta = ensureProjectileMeta(projectile);
      const orbitCount = Number.isFinite(meta.orbitCount)
        ? Math.max(1, Math.floor(meta.orbitCount))
        : 3;
      const orbitIndex = Number.isFinite(meta.orbitIndex)
        ? Math.max(0, Math.floor(meta.orbitIndex))
        : 0;

      meta.orbitCount = orbitCount;
      meta.orbitIndex = orbitIndex;
      meta.orbitRadius = Number.isFinite(meta.orbitRadius)
        ? Math.max(24, meta.orbitRadius)
        : 74;
      meta.angularSpeed = Number.isFinite(meta.angularSpeed)
        ? meta.angularSpeed
        : 0.008;
      meta.baseAngle = Number.isFinite(meta.baseAngle)
        ? meta.baseAngle
        : Math.atan2(projectile.vy, projectile.vx);
      meta.didSpawnOrbitGroup = Boolean(meta.didSpawnOrbitGroup);
    },
    update: updateOrbitBlade,
    onHitPlayer() {
      return {
        removeProjectile: false,
      };
    },
  },
  {
    id: "fractureBeam",
    name: "Fracture Beam",
    description: "A beam that splinters into shards after colliding with walls",
    damage: 17,
    speed: 24,
    size: 16,
    cssClass: "fracture-beam",
    manaCost: 28,
    cooldownMs: 1400,
    globalCooldownMs: 230,
    maxActiveCasts: 12,
    lifetimeMs: 1800,
    onSpawn(projectile) {
      const meta = ensureProjectileMeta(projectile);
      const isShard = Boolean(meta.isFractureShard);
      projectile.canPierce = !isShard;
      projectile.canBounce = false;
      defaultOnSpawn(projectile);
      meta.fractureDepth = Number.isFinite(meta.fractureDepth)
        ? Math.max(0, Math.floor(meta.fractureDepth))
        : isShard
          ? 0
          : 1;
    },
    update: updateFractureBeam,
    onHitPlayer(projectile) {
      const meta = ensureProjectileMeta(projectile);
      if (meta.isFractureShard) {
        return {
          removeProjectile: true,
        };
      }
      return {
        removeProjectile: false,
      };
    },
    onHitWall(projectile, context) {
      spawnFractureShards(projectile, context);
      return {
        remove: true,
        reason: "fractured-on-wall",
      };
    },
  },
  {
    id: "flamethrower",
    name: "Flamethrower",
    description:
      "Channels fire for 3s, tracks your aim, and stops instantly if you move",
    damage: 4,
    speed: 9,
    size: 10,
    cssClass: "flame-jet",
    manaCost: 28,
    cooldownMs: 4200,
    globalCooldownMs: 260,
    maxActiveCasts: 1,
    lifetimeMs: 3000,
    onSpawn(projectile) {
      const meta = ensureProjectileMeta(projectile);
      const isFlameBurst = Boolean(meta.isFlameBurst);
      if (isFlameBurst) {
        projectile.canPierce = false;
        projectile.canBounce = false;
        projectile.rotateWithVelocity = true;
        projectile.renderWidth = 26;
        projectile.renderHeight = 14;
        projectile.lifetimeMs = Number.isFinite(projectile.lifetimeMs)
          ? Math.max(120, projectile.lifetimeMs)
          : 650;
        defaultOnSpawn(projectile);
        return;
      }

      const direction = normalizeVector(projectile.vx, projectile.vy, 1, 0);
      projectile.canPierce = true;
      projectile.canBounce = false;
      projectile.damage = 0;
      projectile.size = 2;
      projectile.vx = 0;
      projectile.vy = 0;
      projectile.renderWidth = 1;
      projectile.renderHeight = 1;
      meta.directionX = direction.x;
      meta.directionY = direction.y;
      meta.flameSpawnIntervalMs = 75;
      meta.flameSpeed = 9;
      meta.flameLifetimeMs = 650;
      meta.flameDamage = 4;
      meta.flameSize = 18;
      meta.spreadRad = 0.11;
      meta.spawnCounter = 0;
      defaultOnSpawn(projectile);
    },
    update: updateFlamethrower,
    onHitPlayer(projectile) {
      if (projectile.meta?.isFlameBurst) {
        return {
          removeProjectile: true,
        };
      }
      return {
        skipDamage: true,
        removeProjectile: false,
      };
    },
  },
  {
    id: "flamePhoenix",
    name: "Flame Phoenix",
    description:
      "A colossal phoenix wave. 1s cast, must stand still, pierces walls and enemies",
    damage: 86,
    speed: 11,
    size: 144,
    cssClass: "flame-phoenix",
    manaCost: 72,
    cooldownMs: 9500,
    globalCooldownMs: 750,
    maxActiveCasts: 1,
    lifetimeMs: 2200,
    castTimeMs: 1000,
    castRequiresStillness: true,
    onSpawn(projectile) {
      projectile.canPierce = true;
      projectile.canBounce = false;
      defaultOnSpawn(projectile);

      const direction = normalizeVector(projectile.vx, projectile.vy, 1, 0);
      const meta = ensureProjectileMeta(projectile);
      meta.collisionShape = "capsule";
      meta.collisionLength = 208;
      meta.collisionWidth = 144;
      meta.directionX = direction.x;
      meta.directionY = direction.y;

      projectile.renderWidth = 208;
      projectile.renderHeight = 144;
      projectile.rotateWithVelocity = true;
    },
    update: defaultProjectileUpdate,
    onHitPlayer() {
      return {
        removeProjectile: false,
      };
    },
  },
];

export function getSpellById(spellId) {
  return SPELLS.find((spell) => spell.id === spellId) || null;
}

export function createInitialCombatState(nowMs = Date.now()) {
  return {
    mana: PLAYER_MAX_MANA,
    maxMana: PLAYER_MAX_MANA,
    manaRegenPerSecond: PLAYER_MANA_REGEN_PER_SECOND,
    lastManaRegenAtMs: nowMs,
    globalCooldownUntilMs: 0,
    spellCooldownUntilById: {},
    activeCastCountBySpell: {},
    pendingCast: null,
    rootedUntilMs: 0,
  };
}

export function ensurePlayerCombatState(playerState, nowMs = Date.now()) {
  if (!playerState || typeof playerState !== "object") {
    return null;
  }

  if (!playerState.combat || typeof playerState.combat !== "object") {
    playerState.combat = createInitialCombatState(nowMs);
    return playerState.combat;
  }

  const combat = playerState.combat;
  const maxMana = Number.isFinite(combat.maxMana)
    ? Math.max(1, combat.maxMana)
    : PLAYER_MAX_MANA;

  combat.maxMana = maxMana;
  combat.mana = Number.isFinite(combat.mana)
    ? clamp(combat.mana, 0, maxMana)
    : maxMana;
  combat.manaRegenPerSecond = Number.isFinite(combat.manaRegenPerSecond)
    ? Math.max(0, combat.manaRegenPerSecond)
    : PLAYER_MANA_REGEN_PER_SECOND;
  combat.lastManaRegenAtMs = Number.isFinite(combat.lastManaRegenAtMs)
    ? combat.lastManaRegenAtMs
    : nowMs;
  combat.globalCooldownUntilMs = Number.isFinite(combat.globalCooldownUntilMs)
    ? combat.globalCooldownUntilMs
    : 0;

  if (
    !combat.spellCooldownUntilById ||
    typeof combat.spellCooldownUntilById !== "object"
  ) {
    combat.spellCooldownUntilById = {};
  }

  if (
    !combat.activeCastCountBySpell ||
    typeof combat.activeCastCountBySpell !== "object"
  ) {
    combat.activeCastCountBySpell = {};
  }

  combat.rootedUntilMs = Number.isFinite(combat.rootedUntilMs)
    ? combat.rootedUntilMs
    : 0;

  const pendingCast = combat.pendingCast;
  if (!pendingCast || typeof pendingCast !== "object") {
    combat.pendingCast = null;
  } else {
    const hasValidSpellId = typeof pendingCast.spellId === "string";
    const hasValidTarget =
      Number.isFinite(pendingCast.targetX) && Number.isFinite(pendingCast.targetY);
    const hasValidTimes =
      Number.isFinite(pendingCast.startedAtMs) &&
      Number.isFinite(pendingCast.completeAtMs);

    if (!hasValidSpellId || !hasValidTarget || !hasValidTimes) {
      combat.pendingCast = null;
    } else {
      combat.pendingCast = {
        spellId: pendingCast.spellId,
        targetX: pendingCast.targetX,
        targetY: pendingCast.targetY,
        startedAtMs: pendingCast.startedAtMs,
        completeAtMs: pendingCast.completeAtMs,
        requiresStillness: Boolean(pendingCast.requiresStillness),
      };
    }
  }

  return combat;
}

export function regeneratePlayerMana(playerState, nowMs = Date.now()) {
  const combat = ensurePlayerCombatState(playerState, nowMs);
  if (!combat) {
    return;
  }

  const deltaMs = nowMs - combat.lastManaRegenAtMs;
  if (deltaMs <= 0) {
    return;
  }

  const manaPerMs = combat.manaRegenPerSecond / 1000;
  combat.mana = clamp(combat.mana + deltaMs * manaPerMs, 0, combat.maxMana);
  combat.lastManaRegenAtMs = nowMs;
}

export function getActiveCastCount(playerState, spellId) {
  const combat = ensurePlayerCombatState(playerState);
  if (!combat || !spellId) {
    return 0;
  }

  const count = combat.activeCastCountBySpell[spellId];
  if (!Number.isFinite(count)) {
    return 0;
  }
  return Math.max(0, Math.floor(count));
}

export function incrementActiveCastCount(playerState, spellId, amount = 1) {
  if (!spellId || !Number.isFinite(amount) || amount <= 0) {
    return;
  }

  const combat = ensurePlayerCombatState(playerState);
  if (!combat) {
    return;
  }

  const current = getActiveCastCount(playerState, spellId);
  combat.activeCastCountBySpell[spellId] = current + Math.floor(amount);
}

export function decrementActiveCastCount(playerState, spellId, amount = 1) {
  if (!spellId || !Number.isFinite(amount) || amount <= 0) {
    return;
  }

  const combat = ensurePlayerCombatState(playerState);
  if (!combat) {
    return;
  }

  const current = getActiveCastCount(playerState, spellId);
  const next = Math.max(0, current - Math.floor(amount));
  combat.activeCastCountBySpell[spellId] = next;
}

export function getPlayerCastOrigin(playerState, playerHitbox = null) {
  if (
    !playerState ||
    !Number.isFinite(playerState.x) ||
    !Number.isFinite(playerState.y)
  ) {
    return null;
  }

  const hitbox = playerHitbox ?? {
    offsetX: 0,
    offsetY: 0,
    width: 0,
    height: 0,
  };

  const centerOffsetX = (hitbox.offsetX ?? 0) + (hitbox.width ?? 0) / 2;
  const centerOffsetY = (hitbox.offsetY ?? 0) + (hitbox.height ?? 0) / 2;

  return {
    x: playerState.x + centerOffsetX,
    y: playerState.y + centerOffsetY,
  };
}

export function getRemainingCooldownMs(untilMs, nowMs = Date.now()) {
  if (!Number.isFinite(untilMs)) {
    return 0;
  }
  return Math.max(0, Math.ceil(untilMs - nowMs));
}

export function getSpellCooldownRemainingMs(playerState, spellId, nowMs = Date.now()) {
  const combat = ensurePlayerCombatState(playerState, nowMs);
  if (!combat || !spellId) {
    return 0;
  }

  const untilMs = combat.spellCooldownUntilById[spellId];
  return getRemainingCooldownMs(untilMs, nowMs);
}

export function getGlobalCooldownRemainingMs(playerState, nowMs = Date.now()) {
  const combat = ensurePlayerCombatState(playerState, nowMs);
  if (!combat) {
    return 0;
  }

  return getRemainingCooldownMs(combat.globalCooldownUntilMs, nowMs);
}

export function isPlayerRooted(playerState, nowMs = Date.now()) {
  const combat = ensurePlayerCombatState(playerState, nowMs);
  if (!combat) {
    return false;
  }
  return Number.isFinite(combat.rootedUntilMs) && combat.rootedUntilMs > nowMs;
}

export function queuePendingSpellCast(
  playerState,
  spell,
  targetX,
  targetY,
  nowMs = Date.now(),
) {
  const combat = ensurePlayerCombatState(playerState, nowMs);
  if (
    !combat ||
    !spell ||
    !Number.isFinite(targetX) ||
    !Number.isFinite(targetY)
  ) {
    return null;
  }

  const castTimeMs = Number.isFinite(spell.castTimeMs)
    ? Math.max(0, spell.castTimeMs)
    : 0;
  if (castTimeMs <= 0) {
    return null;
  }

  const completeAtMs = nowMs + castTimeMs;
  const pendingCast = {
    spellId: spell.id,
    targetX,
    targetY,
    startedAtMs: nowMs,
    completeAtMs,
    requiresStillness: castTimeMs > 0 && spell.castRequiresStillness !== false,
  };

  combat.pendingCast = pendingCast;
  if (pendingCast.requiresStillness) {
    combat.rootedUntilMs = Math.max(combat.rootedUntilMs, completeAtMs);
  }
  return pendingCast;
}

export function cancelPendingSpellCast(playerState, nowMs = Date.now()) {
  const combat = ensurePlayerCombatState(playerState, nowMs);
  if (!combat || !combat.pendingCast) {
    return null;
  }

  const canceledCast = combat.pendingCast;
  combat.pendingCast = null;
  combat.rootedUntilMs = 0;
  return canceledCast;
}

export function popReadyPendingSpellCast(playerState, nowMs = Date.now()) {
  const combat = ensurePlayerCombatState(playerState, nowMs);
  if (!combat || !combat.pendingCast) {
    return null;
  }

  const pendingCast = combat.pendingCast;
  if (pendingCast.completeAtMs > nowMs) {
    return null;
  }

  combat.pendingCast = null;
  combat.rootedUntilMs = 0;
  return pendingCast;
}

export function validateSpellCast(
  playerState,
  spell,
  nowMs = Date.now(),
  options = {},
) {
  const ignoreCastInProgress = Boolean(options.ignoreCastInProgress);
  const ignoreStillness = Boolean(options.ignoreStillness);

  if (!playerState) {
    return {
      ok: false,
      reason: SPELL_CAST_REJECTION.PLAYER_NOT_FOUND,
      details: {},
    };
  }

  if ((playerState.health ?? 0) <= 0) {
    return {
      ok: false,
      reason: SPELL_CAST_REJECTION.PLAYER_DEAD,
      details: {},
    };
  }

  const combat = ensurePlayerCombatState(playerState, nowMs);
  if (!combat || !spell) {
    return {
      ok: false,
      reason: SPELL_CAST_REJECTION.UNKNOWN_SPELL,
      details: {},
    };
  }

  if (!ignoreCastInProgress && combat.pendingCast) {
    return {
      ok: false,
      reason: SPELL_CAST_REJECTION.CAST_IN_PROGRESS,
      details: {
        spellId: combat.pendingCast.spellId,
        remainingMs: getRemainingCooldownMs(combat.pendingCast.completeAtMs, nowMs),
      },
    };
  }

  const castTimeMs = Number.isFinite(spell.castTimeMs)
    ? Math.max(0, spell.castTimeMs)
    : 0;
  const castRequiresStillness =
    castTimeMs > 0 && spell.castRequiresStillness !== false;
  if (
    !ignoreStillness &&
    castRequiresStillness &&
    hasMovementInput(playerState.lastKeyState)
  ) {
    return {
      ok: false,
      reason: SPELL_CAST_REJECTION.CAST_REQUIRES_STILLNESS,
      details: {
        castTimeMs,
      },
    };
  }

  const manaCost = Number.isFinite(spell.manaCost) ? Math.max(0, spell.manaCost) : 0;
  if (combat.mana < manaCost) {
    return {
      ok: false,
      reason: SPELL_CAST_REJECTION.NOT_ENOUGH_MANA,
      details: {
        mana: combat.mana,
        manaCost,
      },
    };
  }

  const spellCooldownRemainingMs = getSpellCooldownRemainingMs(
    playerState,
    spell.id,
    nowMs,
  );
  if (spellCooldownRemainingMs > 0) {
    return {
      ok: false,
      reason: SPELL_CAST_REJECTION.SPELL_ON_COOLDOWN,
      details: {
        remainingMs: spellCooldownRemainingMs,
      },
    };
  }

  const globalCooldownRemainingMs = getGlobalCooldownRemainingMs(playerState, nowMs);
  if (globalCooldownRemainingMs > 0) {
    return {
      ok: false,
      reason: SPELL_CAST_REJECTION.GLOBAL_COOLDOWN,
      details: {
        remainingMs: globalCooldownRemainingMs,
      },
    };
  }

  const activeCastCount = getActiveCastCount(playerState, spell.id);
  const maxActiveCasts = Number.isFinite(spell.maxActiveCasts)
    ? Math.max(0, spell.maxActiveCasts)
    : Infinity;

  if (activeCastCount >= maxActiveCasts) {
    return {
      ok: false,
      reason: SPELL_CAST_REJECTION.ACTIVE_CAST_CAP_REACHED,
      details: {
        activeCastCount,
        maxActiveCasts,
      },
    };
  }

  return {
    ok: true,
    reason: null,
    details: {},
  };
}

export function applySpellCastCosts(playerState, spell, nowMs = Date.now()) {
  const combat = ensurePlayerCombatState(playerState, nowMs);
  if (!combat || !spell) {
    return;
  }

  const manaCost = Number.isFinite(spell.manaCost) ? Math.max(0, spell.manaCost) : 0;
  const cooldownMs = Number.isFinite(spell.cooldownMs)
    ? Math.max(0, spell.cooldownMs)
    : 0;
  const globalCooldownMs = Number.isFinite(spell.globalCooldownMs)
    ? Math.max(0, spell.globalCooldownMs)
    : DEFAULT_GLOBAL_COOLDOWN_MS;

  combat.mana = clamp(combat.mana - manaCost, 0, combat.maxMana);
  combat.globalCooldownUntilMs = nowMs + globalCooldownMs;
  combat.spellCooldownUntilById[spell.id] = nowMs + cooldownMs;
}

export function isProjectileOutOfBounds(projectile, map) {
  if (!projectile || !map?.config) {
    return true;
  }

  const mapPixelWidth = map.config.width * map.config.tileSize;
  const mapPixelHeight = map.config.height * map.config.tileSize;

  return (
    projectile.x < 0 ||
    projectile.y < 0 ||
    projectile.x > mapPixelWidth ||
    projectile.y > mapPixelHeight
  );
}

export function advanceProjectile(
  projectile,
  map,
  stepMultiplier = PROJECTILE_STEP_MULTIPLIER,
) {
  const previousX = projectile.x;
  const previousY = projectile.y;

  projectile.x += stepMultiplier * projectile.vx;
  projectile.y += stepMultiplier * projectile.vy;

  if (isProjectileOutOfBounds(projectile, map)) {
    return {
      removed: true,
      reason: "out-of-bounds",
      hitWall: true,
    };
  }

  if (!map.walkable(projectile.x, projectile.y)) {
    if (projectile.canBounce) {
      const hitVerticalSurface = !map.walkable(projectile.x, previousY);
      const hitHorizontalSurface = !map.walkable(previousX, projectile.y);

      if (hitVerticalSurface && !hitHorizontalSurface) {
        projectile.vy *= -1;
      } else if (hitHorizontalSurface && !hitVerticalSurface) {
        projectile.vx *= -1;
      } else {
        projectile.vx *= -1;
        projectile.vy *= -1;
      }

      projectile.x = previousX + stepMultiplier * projectile.vx;
      projectile.y = previousY + stepMultiplier * projectile.vy;

      return {
        removed: false,
        reason: "bounced",
        hitWall: true,
      };
    }

    if (!projectile.canPierce) {
      return {
        removed: true,
        reason: "tile-collision",
        hitWall: true,
      };
    }

    return {
      removed: false,
      reason: "pierced-wall",
      hitWall: true,
    };
  }

  return {
    removed: false,
    reason: null,
    hitWall: false,
  };
}

export function defaultProjectileUpdate(projectile, context) {
  return advanceProjectile(
    projectile,
    context.map,
    Number.isFinite(context.stepMultiplier)
      ? context.stepMultiplier
      : PROJECTILE_STEP_MULTIPLIER,
  );
}

export function createSpellProjectile({
  spell,
  spellId,
  projectileId,
  ownerId,
  originX,
  originY,
  targetX,
  targetY,
  vx,
  vy,
  nowMs = Date.now(),
  overrides = {},
} = {}) {
  const resolvedSpell = spell ?? getSpellById(spellId);
  if (!resolvedSpell) {
    return null;
  }

  if (!Number.isFinite(originX) || !Number.isFinite(originY)) {
    return null;
  }

  let projectileVx = Number(vx);
  let projectileVy = Number(vy);

  if (!Number.isFinite(projectileVx) || !Number.isFinite(projectileVy)) {
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
      return null;
    }

    const directionX = targetX - originX;
    const directionY = targetY - originY;
    const directionDistance = Math.hypot(directionX, directionY);
    if (!Number.isFinite(directionDistance) || directionDistance < 1e-6) {
      return null;
    }

    projectileVx = (directionX / directionDistance) * resolvedSpell.speed;
    projectileVy = (directionY / directionDistance) * resolvedSpell.speed;
  }

  const baseProjectile = {
    id: projectileId || createProjectileId(),
    ownerId,
    spellId: resolvedSpell.id,
    x: originX,
    y: originY,
    vx: projectileVx,
    vy: projectileVy,
    size: resolvedSpell.size,
    damage: resolvedSpell.damage,
    hitPlayerIds: [],
    castAtMs: nowMs,
    lifetimeMs: Number.isFinite(resolvedSpell.lifetimeMs)
      ? Math.max(100, resolvedSpell.lifetimeMs)
      : PROJECTILE_LIFETIME_MS,
    canPierce: false,
    canBounce: false,
    canHitOwner: false,
    meta: {
      castTargetX: Number.isFinite(targetX) ? targetX : null,
      castTargetY: Number.isFinite(targetY) ? targetY : null,
      castOriginX: originX,
      castOriginY: originY,
    },
  };

  const cleanedOverrides = Object.fromEntries(
    Object.entries(overrides || {}).filter(([, value]) => value !== undefined),
  );

  const projectile = {
    ...baseProjectile,
    ...cleanedOverrides,
    hitPlayerIds: Array.isArray(cleanedOverrides.hitPlayerIds)
      ? cleanedOverrides.hitPlayerIds.slice()
      : [],
    meta: {
      ...baseProjectile.meta,
      ...(cleanedOverrides.meta || {}),
    },
  };

  if (typeof resolvedSpell.onSpawn === "function") {
    resolvedSpell.onSpawn(projectile, {
      nowMs,
      spell: resolvedSpell,
    });
  }

  return projectile;
}

function getSpellHookContext(projectile, context) {
  const spell = getSpellById(projectile?.spellId);
  return {
    ...(context || {}),
    spell,
  };
}

export function runSpellProjectileUpdate(projectile, context = {}) {
  if (!projectile || !Number.isFinite(projectile.x) || !Number.isFinite(projectile.y)) {
    return {
      removed: true,
      reason: "invalid-projectile",
      hitWall: false,
      spell: null,
    };
  }

  const spellContext = getSpellHookContext(projectile, context);
  const spell = spellContext.spell;
  if (!spell) {
    return {
      removed: true,
      reason: "unknown-spell",
      hitWall: false,
      spell: null,
    };
  }

  const updateFn =
    typeof spell.update === "function" ? spell.update : defaultProjectileUpdate;

  const movementResult = updateFn(projectile, spellContext) || {};
  let removed = Boolean(movementResult.removed);
  let hitWall = Boolean(movementResult.hitWall);
  let reason = movementResult.reason ?? null;

  if (hitWall && typeof spell.onHitWall === "function") {
    const wallResult = spell.onHitWall(projectile, spellContext, movementResult) || {};

    if (typeof wallResult.remove === "boolean") {
      removed = wallResult.remove;
    }
    if (typeof wallResult.hitWall === "boolean") {
      hitWall = wallResult.hitWall;
    }
    if (typeof wallResult.reason === "string" && wallResult.reason) {
      reason = wallResult.reason;
    }
  }

  return {
    removed,
    reason,
    hitWall,
    spell,
  };
}

export function runSpellExpireHook(projectile, context = {}) {
  const spellContext = getSpellHookContext(projectile, context);
  const spell = spellContext.spell;
  if (!spell || typeof spell.onExpire !== "function") {
    return;
  }

  spell.onExpire(projectile, spellContext);
}

export function runSpellHitPlayerHook(projectile, hitPlayerId, context = {}) {
  const spellContext = getSpellHookContext(projectile, context);
  const spell = spellContext.spell;
  if (!spell || typeof spell.onHitPlayer !== "function") {
    return {};
  }

  return spell.onHitPlayer(projectile, spellContext, hitPlayerId) || {};
}
