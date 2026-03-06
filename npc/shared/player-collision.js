import { hitbox as defaultHitbox } from "./constants.js";

function checkCircleAABBCollision(
  circleX,
  circleY,
  circleRadius,
  rectX,
  rectY,
  rectWidth,
  rectHeight,
) {
  const closestX = Math.max(rectX, Math.min(circleX, rectX + rectWidth));
  const closestY = Math.max(rectY, Math.min(circleY, rectY + rectHeight));
  const distanceX = circleX - closestX;
  const distanceY = circleY - closestY;
  const distanceSquared = distanceX * distanceX + distanceY * distanceY;
  return distanceSquared < circleRadius * circleRadius;
}

function getPlayerHitboxRect(playerState, playerHitbox = defaultHitbox) {
  if (
    !playerState ||
    !Number.isFinite(playerState.x) ||
    !Number.isFinite(playerState.y)
  ) {
    return null;
  }

  return {
    x: playerState.x + playerHitbox.offsetX,
    y: playerState.y + playerHitbox.offsetY,
    width: playerHitbox.width,
    height: playerHitbox.height,
  };
}

export function getCollidingPlayerId(
  playersById,
  circleX,
  circleY,
  circleRadius = 0,
  ignoredPlayerId = null,
  playerHitbox = defaultHitbox,
) {
  const collisions = getCollidingPlayerIds(
    playersById,
    circleX,
    circleY,
    circleRadius,
    ignoredPlayerId,
    playerHitbox,
  );
  return collisions[0] ?? null;
}

export function getCollidingPlayerIds(
  playersById,
  circleX,
  circleY,
  circleRadius = 0,
  ignoredPlayerId = null,
  playerHitbox = defaultHitbox,
) {
  if (
    !playersById ||
    typeof playersById !== "object" ||
    !Number.isFinite(circleX) ||
    !Number.isFinite(circleY)
  ) {
    return [];
  }

  const radius = Number.isFinite(circleRadius) ? Math.max(0, circleRadius) : 0;
  const collidingPlayerIds = [];

  for (const [playerId, playerState] of Object.entries(playersById)) {
    if (playerId === ignoredPlayerId) {
      continue;
    }

    const rect = getPlayerHitboxRect(playerState, playerHitbox);
    if (!rect) {
      continue;
    }

    if (
      checkCircleAABBCollision(
        circleX,
        circleY,
        radius,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
      )
    ) {
      collidingPlayerIds.push(playerId);
    }
  }

  return collidingPlayerIds;
}

export function playerWalkable(
  playersById,
  circleX,
  circleY,
  circleRadius = 0,
  ignoredPlayerId = null,
  playerHitbox = defaultHitbox,
) {
  return (
    getCollidingPlayerId(
      playersById,
      circleX,
      circleY,
      circleRadius,
      ignoredPlayerId,
      playerHitbox,
    ) === null
  );
}
