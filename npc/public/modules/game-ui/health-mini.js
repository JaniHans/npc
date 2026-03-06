import { createHealthBarAnimator } from "./health-bar.js";

function createNoopHealthMini() {
  return {
    renderMini() {},
    dispose() {},
  };
}

export function createHealthIndicatorMini(playerElement, playerId) {
  if (!playerElement) {
    return createNoopHealthMini();
  }

  const safePlayerId = String(playerId ?? "unknown");
  const healthContainer = document.createElement("div");
  healthContainer.id = `health-min-container-${safePlayerId}`;
  healthContainer.classList.add("health-min-container");

  const health = document.createElement("div");
  health.id = `health-min-${safePlayerId}`;
  health.classList.add("health-min");

  const damage = document.createElement("div");
  damage.id = `damage-mini-${safePlayerId}`;
  damage.classList.add("damage-min");

  healthContainer.append(health);
  healthContainer.append(damage);
  playerElement.append(healthContainer);

  const healthAnimator = createHealthBarAnimator({
    healthElement: health,
    damageElement: damage,
    maxHealth: 100,
    damageDelayMs: 100,
    damageTrailMs: 180,
  });

  function renderMini(playerData) {
    if (!playerData) return;
    if (playerData.isGhost) {
      healthContainer.style.display = "none";
      return;
    }
    healthContainer.style.display = "block";
    healthAnimator.render(playerData.health);
  }

  function dispose() {
    healthAnimator.dispose();
    healthContainer.remove();
  }

  return {
    renderMini,
    dispose,
  };
}
