const EPS = 1e-4; // small inset to avoid boundary-flip on exact tile edges

function walkableHitbox(map, x, y, hitbox) {
  const x0 = x + EPS + hitbox.offsetX;
  const y0 = y + EPS + hitbox.offsetY;
  const x1 = x + hitbox.width - EPS + hitbox.offsetX;
  const y1 = y + hitbox.height - EPS + hitbox.offsetY;

  return (
    map.walkable(x0, y0) &&
    map.walkable(x1, y0) &&
    map.walkable(x0, y1) &&
    map.walkable(x1, y1)
  );
}

export function move(x, y, inputState, map, speed, hitbox) {
  const dx = (inputState.right ? 1 : 0) - (inputState.left ? 1 : 0);
  const dy = (inputState.down ? 1 : 0) - (inputState.up ? 1 : 0);
  if (dx === 0 && dy === 0) return { x, y };

  const invLen = 1 / Math.hypot(dx, dy);
  const vx = dx * invLen * speed;
  const vy = dy * invLen * speed;

  let nx = x + vx;
  if (!walkableHitbox(map, nx, y, hitbox)) nx = x;

  let ny = y + vy;
  if (!walkableHitbox(map, nx, ny, hitbox)) ny = y;

  return { x: nx, y: ny };
}

export function hasMovementInput(inputState = {}) {
  const dx = (inputState.right ? 1 : 0) - (inputState.left ? 1 : 0);
  const dy = (inputState.down ? 1 : 0) - (inputState.up ? 1 : 0);
  return dx !== 0 || dy !== 0;
}

export function moveByDistance(
  x,
  y,
  inputState,
  map,
  distance,
  hitbox,
  maxStep = 8,
) {
  if (!hasMovementInput(inputState)) {
    return { x, y };
  }

  const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  if (safeDistance <= 0) {
    return { x, y };
  }

  const safeStep = Number.isFinite(maxStep) ? Math.max(1, maxStep) : 1;
  const stepCount = Math.max(1, Math.ceil(safeDistance / safeStep));
  const stepDistance = safeDistance / stepCount;

  let nextX = x;
  let nextY = y;
  for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
    const beforeX = nextX;
    const beforeY = nextY;
    const stepped = move(nextX, nextY, inputState, map, stepDistance, hitbox);
    nextX = stepped.x;
    nextY = stepped.y;
    if (beforeX === nextX && beforeY === nextY) {
      break;
    }
  }

  return { x: nextX, y: nextY };
}
