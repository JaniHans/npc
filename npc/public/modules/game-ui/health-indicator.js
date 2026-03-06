import {
  createHealthBarAnimator,
  normalizeHealth,
} from "./health-bar.js";

export function createHealthIndicator() {
  const healthContainer = document.getElementById("health-container");
  const playerName = document.getElementById("player-name");
  const health = document.getElementById("health");
  const damage = document.getElementById("damage");

  if (!healthContainer || !playerName || !health || !damage) {
    return {
      render() {},
      dispose() {},
    };
  }

  const healthAnimator = createHealthBarAnimator({
    healthElement: health,
    damageElement: damage,
    maxHealth: 100,
    damageDelayMs: 120,
    damageTrailMs: 220,
  });

  function render(playerData) {
    if (!playerData) return;

    const healthValue = normalizeHealth(playerData.health, 100);

    healthContainer.style.display = "block";
    playerName.textContent =
      typeof playerData.name === "string" && playerData.name.trim()
        ? playerData.name.trim()
        : "Unknown";
    health.textContent = `${healthValue}/100`;
    healthAnimator.render(healthValue);
  }

  function dispose() {
    healthAnimator.dispose();
  }

  return {
    render,
    dispose,
  };
}
