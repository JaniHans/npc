function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value, fallback = 0) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function toWidthPercent(healthValue, maxHealth) {
  if (!Number.isFinite(maxHealth) || maxHealth <= 0) {
    return "0%";
  }
  return `${(healthValue / maxHealth) * 100}%`;
}

export function normalizeHealth(rawHealth, maxHealth = 100) {
  const safeMaxHealth = Math.max(1, toFiniteNumber(maxHealth, 100));
  const parsedHealth = toFiniteNumber(rawHealth, safeMaxHealth);
  return Math.round(clamp(parsedHealth, 0, safeMaxHealth));
}

export function createHealthBarAnimator({
  healthElement,
  damageElement,
  maxHealth = 100,
  damageDelayMs = 120,
  damageTrailMs = 220,
} = {}) {
  let lastHealth = null;
  let damageDelayTimeoutId = null;
  let damageHideTimeoutId = null;

  const safeMaxHealth = Math.max(1, toFiniteNumber(maxHealth, 100));

  function clearTimers() {
    if (damageDelayTimeoutId) {
      clearTimeout(damageDelayTimeoutId);
      damageDelayTimeoutId = null;
    }
    if (damageHideTimeoutId) {
      clearTimeout(damageHideTimeoutId);
      damageHideTimeoutId = null;
    }
  }

  function setHealthWidth(healthValue) {
    if (!healthElement) return;
    healthElement.style.width = toWidthPercent(healthValue, safeMaxHealth);
  }

  function setDamageWidth(healthValue) {
    if (!damageElement) return;
    damageElement.style.width = toWidthPercent(healthValue, safeMaxHealth);
  }

  function hideDamage() {
    if (!damageElement) return;
    damageElement.style.display = "none";
  }

  function showDamage() {
    if (!damageElement) return;
    damageElement.style.display = "block";
  }

  if (damageElement) {
    damageElement.style.transition = `width ${damageTrailMs}ms ease`;
  }

  function render(rawHealth) {
    const healthValue = normalizeHealth(rawHealth, safeMaxHealth);

    if (lastHealth === null) {
      setHealthWidth(healthValue);
      setDamageWidth(healthValue);
      hideDamage();
      lastHealth = healthValue;
      return healthValue;
    }

    if (healthValue === lastHealth) {
      return healthValue;
    }

    clearTimers();

    if (healthValue > lastHealth) {
      setHealthWidth(healthValue);
      setDamageWidth(healthValue);
      hideDamage();
      lastHealth = healthValue;
      return healthValue;
    }

    setHealthWidth(healthValue);
    setDamageWidth(lastHealth);
    showDamage();

    damageDelayTimeoutId = setTimeout(() => {
      setDamageWidth(healthValue);
      damageHideTimeoutId = setTimeout(() => {
        if (lastHealth === healthValue) {
          hideDamage();
        }
      }, damageTrailMs);
    }, damageDelayMs);

    lastHealth = healthValue;
    return healthValue;
  }

  function dispose() {
    clearTimers();
  }

  return {
    render,
    dispose,
  };
}
