function toFiniteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function setEntityAppearance(entityState, skinClass, facing, skinIndex) {
  if (typeof skinClass !== "string" || skinClass.length === 0) {
    return;
  }

  const safeFacing = facing === "left" ? "left" : "right";
  entityState.skinClass = skinClass;
  entityState.facing = safeFacing;
  const ghostClass = entityState.isGhost ? " is-ghost" : "";
  entityState.element.className = `player ${skinClass}-${safeFacing}${ghostClass}`;
  if (skinIndex || skinIndex === 0) {
      entityState.element.id = String(skinIndex)
  }
}

export function createEntityRenderStateStore(viewport, createEntityElement) {
  const entityRenderStateByPlayerId = new Map();

  function createEntityState(playerId, worldX, worldY, skinClass, skinIndex) {
    const element = createEntityElement();
    element.dataset.playerId = playerId;
    viewport.appendChild(element);

    const safeX = toFiniteNumber(worldX);
    const safeY = toFiniteNumber(worldY);
    const entityState = {
      element,
      renderX: safeX,
      renderY: safeY,
      targetX: safeX,
      targetY: safeY,
      skinClass: "",
      facing: "right",
      isGhost: false,
    };
    setEntityAppearance(entityState, skinClass, entityState.facing, skinIndex);
    entityRenderStateByPlayerId.set(playerId, entityState);
    return entityState;
  }

  function getOrCreateEntityState(playerId, worldX, worldY, skinClass, skinIndex) {
    return (
      entityRenderStateByPlayerId.get(playerId) ||
      createEntityState(playerId, worldX, worldY, skinClass, skinIndex)
    );
  }

    function setTarget(playerId, worldX, worldY) {
    const entityState = entityRenderStateByPlayerId.get(playerId);
    if (!entityState) return;

    entityState.targetX = toFiniteNumber(worldX, entityState.targetX);
    entityState.targetY = toFiniteNumber(worldY, entityState.targetY);
  }

  function snapToTarget(playerId) {
    const entityState = entityRenderStateByPlayerId.get(playerId);
    if (!entityState) return;
    entityState.renderX = entityState.targetX;
    entityState.renderY = entityState.targetY;
  }

  function setFacing(playerId, facing) {
    const entityState = entityRenderStateByPlayerId.get(playerId);
    if (!entityState || !entityState.skinClass) return;
    setEntityAppearance(entityState, entityState.skinClass, facing);
  }

  function setSkin(playerId, skinClass) {
    const entityState = entityRenderStateByPlayerId.get(playerId);
    if (!entityState) return;
    setEntityAppearance(entityState, skinClass, entityState.facing);
  }

  function setGhost(playerId, isGhost) {
    const entityState = entityRenderStateByPlayerId.get(playerId);
    if (!entityState) return;
    entityState.isGhost = Boolean(isGhost);
    if (!entityState.skinClass) {
      entityState.element.classList.toggle("is-ghost", entityState.isGhost);
      return;
    }
    setEntityAppearance(entityState, entityState.skinClass, entityState.facing);
  }

  function smooth(alpha) {
    for (const entityState of entityRenderStateByPlayerId.values()) {
      entityState.renderX += (entityState.targetX - entityState.renderX) * alpha;
      entityState.renderY += (entityState.targetY - entityState.renderY) * alpha;
    }
  }

  function removeMissing(seenPlayerIds) {
    for (const [playerId, entityState] of entityRenderStateByPlayerId.entries()) {
      if (seenPlayerIds.has(playerId)) continue;
      entityState.element.remove();
      entityRenderStateByPlayerId.delete(playerId);
    }
  }

  function forEach(callback) {
    for (const [playerId, entityState] of entityRenderStateByPlayerId.entries()) {
      callback(playerId, entityState);
    }
  }

  function get(playerId) {
    return entityRenderStateByPlayerId.get(playerId);
  }

  function dispose() {
    for (const entityState of entityRenderStateByPlayerId.values()) {
      entityState.element.remove();
    }
    entityRenderStateByPlayerId.clear();
  }

  return {
    getOrCreateEntityState,
    setTarget,
    snapToTarget,
    setFacing,
    setSkin,
    setGhost,
    smooth,
    removeMissing,
    forEach,
    get,
    dispose,
  };
}
