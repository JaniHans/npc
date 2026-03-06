import { hitbox } from "../../shared/constants.js";
import { SPELLS } from "../../shared/spells.js";

const PLAYER_CAST_ORIGIN_OFFSET_X = hitbox.offsetX + hitbox.width / 2;
const PLAYER_CAST_ORIGIN_OFFSET_Y = hitbox.offsetY + hitbox.height / 2;
const DEFAULT_SERVER_SMOOTHING_ALPHA = 0.55;
const SNAP_DISTANCE_PX = 180;

function getPlayerCastOrigin(player) {
  return {
    x: player.x + PLAYER_CAST_ORIGIN_OFFSET_X,
    y: player.y + PLAYER_CAST_ORIGIN_OFFSET_Y,
  };
}

function getSpellById(spellId) {
  return SPELLS.find((spell) => spell.id === spellId) || null;
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function resolveRenderDimensions(serverProjectile, spell) {
  const fallbackSize = isFiniteNumber(serverProjectile?.size)
    ? serverProjectile.size
    : spell?.size ?? 16;
  const renderWidth = isFiniteNumber(serverProjectile?.renderWidth)
    ? serverProjectile.renderWidth
    : fallbackSize;
  const renderHeight = isFiniteNumber(serverProjectile?.renderHeight)
    ? serverProjectile.renderHeight
    : fallbackSize;

  return {
    width: Math.max(2, renderWidth),
    height: Math.max(2, renderHeight),
  };
}

function resolveProjectileAngleDeg(serverProjectile, spell) {
  const rotateWithVelocity =
    Boolean(serverProjectile?.rotateWithVelocity) || spell?.id === "flamePhoenix";
  if (!rotateWithVelocity) {
    return 0;
  }

  const directionX = isFiniteNumber(serverProjectile?.meta?.directionX)
    ? serverProjectile.meta.directionX
    : serverProjectile?.vx;
  const directionY = isFiniteNumber(serverProjectile?.meta?.directionY)
    ? serverProjectile.meta.directionY
    : serverProjectile?.vy;
  if (!isFiniteNumber(directionX) || !isFiniteNumber(directionY)) {
    return 0;
  }

  const directionLength = Math.hypot(directionX, directionY);
  if (directionLength < 1e-6) {
    return 0;
  }

  return (Math.atan2(directionY, directionX) * 180) / Math.PI;
}

function placeElementAtCenter(
  element,
  worldX,
  worldY,
  cameraX,
  cameraY,
  width,
  height,
) {
  element.style.left = `${worldX - cameraX - width / 2}px`;
  element.style.top = `${worldY - cameraY - height / 2}px`;
}

function placeCometMarker(markerElement, worldX, worldY, cameraX, cameraY) {
  markerElement.style.left = `${worldX - cameraX}px`;
  markerElement.style.top = `${worldY - cameraY}px`;
}

export function createSpellController({ viewport, map, player, availableSpellIds = null }) {
  if (!viewport || !map || !player) {
    throw new Error("Spell controller requires viewport, map, and player");
  }

  const availableSpells =
    Array.isArray(availableSpellIds) && availableSpellIds.length > 0
      ? SPELLS.filter((spell) => availableSpellIds.includes(spell.id))
      : SPELLS;
  let selectedSpellIndex = 0;
  const serverProjectileElements = new Map();

  function getSelectedSpell() {
    return availableSpells[selectedSpellIndex] || null;
  }

  function cast(targetX, targetY) {
    if (!isFiniteNumber(targetX) || !isFiniteNumber(targetY)) {
      return false;
    }

    const { x: originX, y: originY } = getPlayerCastOrigin(player);
    const directionX = targetX - originX;
    const directionY = targetY - originY;
    const distance = Math.hypot(directionX, directionY);
    if (!isFiniteNumber(distance) || distance < 1e-6) {
      return false;
    }

    const selectedSpell = getSelectedSpell();
    if (!selectedSpell) {
      return false;
    }

    return {
      spellId: selectedSpell.id,
      targetX,
      targetY,
    };
  }

  function syncProjectiles(serverProjectiles) {
    if (!Array.isArray(serverProjectiles)) {
      return;
    }

    const seenIds = new Set();

    for (const serverProjectile of serverProjectiles) {
      if (!serverProjectile || !serverProjectile.id) {
        continue;
      }

      const spell = getSpellById(serverProjectile.spellId);
      if (!spell) {
        continue;
      }

      seenIds.add(serverProjectile.id);
      let renderState = serverProjectileElements.get(serverProjectile.id);

      if (!renderState) {
        const element = document.createElement("div");
        element.style.position = "absolute";
        element.classList.add(spell.cssClass);
        viewport.appendChild(element);

        let cometTargetElement = null;
        if (spell.id === "comet") {
          cometTargetElement = document.createElement("div");
          cometTargetElement.className = "comet-impact-marker";
          viewport.appendChild(cometTargetElement);
        }

        const dimensions = resolveRenderDimensions(serverProjectile, spell);
        renderState = {
          element,
          cometTargetElement,
          renderX: serverProjectile.x,
          renderY: serverProjectile.y,
          targetX: serverProjectile.x,
          targetY: serverProjectile.y,
          renderWidth: dimensions.width,
          renderHeight: dimensions.height,
          angleDeg: resolveProjectileAngleDeg(serverProjectile, spell),
          targetAngleDeg: resolveProjectileAngleDeg(serverProjectile, spell),
          cometTargetX: serverProjectile.meta?.targetX ?? serverProjectile.x,
          cometTargetY: serverProjectile.meta?.targetY ?? serverProjectile.y,
        };
        serverProjectileElements.set(serverProjectile.id, renderState);
      }

      const dimensions = resolveRenderDimensions(serverProjectile, spell);
      renderState.renderWidth = dimensions.width;
      renderState.renderHeight = dimensions.height;
      renderState.targetX = serverProjectile.x;
      renderState.targetY = serverProjectile.y;
      renderState.targetAngleDeg = resolveProjectileAngleDeg(serverProjectile, spell);
      renderState.cometTargetX = isFiniteNumber(serverProjectile.meta?.targetX)
        ? serverProjectile.meta.targetX
        : serverProjectile.x;
      renderState.cometTargetY = isFiniteNumber(serverProjectile.meta?.targetY)
        ? serverProjectile.meta.targetY
        : serverProjectile.y;

      renderState.element.style.width = `${renderState.renderWidth}px`;
      renderState.element.style.height = `${renderState.renderHeight}px`;
    }

    for (const [projectileId, renderState] of serverProjectileElements.entries()) {
      if (seenIds.has(projectileId)) {
        continue;
      }
      renderState.element.remove();
      if (renderState.cometTargetElement) {
        renderState.cometTargetElement.remove();
      }
      serverProjectileElements.delete(projectileId);
    }
  }

  function update(cameraX, cameraY) {
    for (const renderState of serverProjectileElements.values()) {
      const dx = renderState.targetX - renderState.renderX;
      const dy = renderState.targetY - renderState.renderY;
      const distance = Math.hypot(dx, dy);
      if (distance > SNAP_DISTANCE_PX) {
        renderState.renderX = renderState.targetX;
        renderState.renderY = renderState.targetY;
      } else {
        renderState.renderX += dx * DEFAULT_SERVER_SMOOTHING_ALPHA;
        renderState.renderY += dy * DEFAULT_SERVER_SMOOTHING_ALPHA;
      }

      renderState.angleDeg += (renderState.targetAngleDeg - renderState.angleDeg) * 0.5;

      placeElementAtCenter(
        renderState.element,
        renderState.renderX,
        renderState.renderY,
        cameraX,
        cameraY,
        renderState.renderWidth,
        renderState.renderHeight,
      );
      renderState.element.style.setProperty(
        "--projectile-angle",
        `${renderState.angleDeg.toFixed(2)}deg`,
      );

      if (renderState.cometTargetElement) {
        placeCometMarker(
          renderState.cometTargetElement,
          renderState.cometTargetX,
          renderState.cometTargetY,
          cameraX,
          cameraY,
        );
      }
    }
  }

  function cycleSpell(direction) {
    if (direction !== 1 && direction !== -1) {
      throw new Error("Invalid spell cycle direction");
    }
    if (availableSpells.length === 0) {
      return null;
    }
    selectedSpellIndex += direction;
    if (selectedSpellIndex >= availableSpells.length) {
      selectedSpellIndex = 0;
    } else if (selectedSpellIndex < 0) {
      selectedSpellIndex = availableSpells.length - 1;
    }
    return getSelectedSpell();
  }

  function dispose() {
    for (const renderState of serverProjectileElements.values()) {
      renderState.element.remove();
      if (renderState.cometTargetElement) {
        renderState.cometTargetElement.remove();
      }
    }
    serverProjectileElements.clear();
  }

  return {
    cast,
    update,
    syncProjectiles,
    cycleSpell,
    getSelectedSpell,
    dispose,
  };
}
