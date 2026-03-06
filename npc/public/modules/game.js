import {
  dashCooldownMs,
  dashDistance,
  hitbox,
  movementSpeed,
  tick,
} from "../../shared/constants.js";
import {
  hasMovementInput,
  move,
  moveByDistance,
} from "../../shared/movement.js";

import renderMap from "../map-renderer.js";
import { getDefaultMap, getMapById } from "/shared/map.js";
import {
  player,
  initInput,
  createPlayerElement,
  loadSprite,
} from "../player.js";
import { reconcileLocalPlayer } from "./reconciliation.js";
import { createSpellController } from "./spells.js";
import { createEntityRenderStateStore } from "./game-ui/entity-render-state.js";
import { createPerformanceOverlay } from "./game-ui/performance-overlay.js";
import { startGameTransition } from "./game-ui/transitions.js";
import { createHealthIndicatorMini } from "./game-ui/health-mini.js";
import { createPauseController } from "./game-ui/pause.js";
import { sounds } from "../sounds/sounds.js";

function worldToScreen(worldX, worldY, cameraX, cameraY) {
  return {
    x: worldX - cameraX,
    y: worldY - cameraY,
  };
}

function getFacingFromInput(lastKeyState = {}, fallbackFacing = "right") {
  if (lastKeyState.left) return "left";
  if (lastKeyState.right) return "right";
  return fallbackFacing;
}

function isInputTarget(eventTarget) {
  const tagName = eventTarget?.tagName;
  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    eventTarget?.isContentEditable
  );
}

function getCastRejectionMessage(reason, details = {}) {
  switch (reason) {
    case "player-dead":
      return details?.isGhost ? "Ghosts cannot cast" : "Cannot cast while dead";
    case "not-enough-mana":
      return `No mana (${Math.ceil(details.mana ?? 0)}/${details.manaCost ?? "?"})`;
    case "spell-on-cooldown":
      return `Spell CD ${Math.ceil((details.remainingMs ?? 0) / 100) / 10}s`;
    case "global-cooldown":
      return `Global CD ${Math.ceil((details.remainingMs ?? 0) / 100) / 10}s`;
    case "active-cast-cap-reached":
      return "Too many active casts";
    case "cast-in-progress":
      return `Casting ${Math.ceil((details.remainingMs ?? 0) / 100) / 10}s`;
    case "cast-requires-stillness":
      return "Stand still to cast";
    case "spell-not-equipped":
      return "Spell not equipped";
    case "invalid-target":
      return "Invalid target";
    default:
      return "Cast rejected";
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getActivePhoenixCastState(combatState, nowMs) {
  const pendingCast = combatState?.pendingCast;
  if (!pendingCast || pendingCast.spellId !== "flamePhoenix") {
    return null;
  }
  if (
    !Number.isFinite(pendingCast.startedAtMs) ||
    !Number.isFinite(pendingCast.completeAtMs)
  ) {
    return null;
  }
  if (pendingCast.completeAtMs <= nowMs) {
    return null;
  }
  return {
    startedAtMs: pendingCast.startedAtMs,
    completeAtMs: pendingCast.completeAtMs,
  };
}

export function initGame(data, selfPlayerId, socket, roomId) {
  const map = getMapById(data?.mapId) || getDefaultMap();
  const selectedSpellIds = Array.isArray(
    data?.selectedSpellsByPlayerId?.[selfPlayerId],
  )
    ? data.selectedSpellsByPlayerId[selfPlayerId]
    : [];
  let rafId = null;
  console.log("Selected spells", selectedSpellIds);
  let cameraX = 0;
  let cameraY = 0;
  startGameTransition(document.getElementById("room"));

  const gameViewport = document.createElement("div");
  gameViewport.className = "game-viewport fake-3d-enabled";
  document.body.classList.add("game-fake-3d");

  const mapDiv = document.createElement("div");
  mapDiv.className = "map-container";
  mapDiv.style.width = `${map.config.width * map.config.tileSize}px`;
  mapDiv.style.height = `${map.config.height * map.config.tileSize}px`;
  renderMap(mapDiv, map);
  gameViewport.appendChild(mapDiv);

  const performanceOverlay = createPerformanceOverlay(50);
  gameViewport.appendChild(performanceOverlay.element);

  const spellIndicator = document.createElement("div");
  spellIndicator.className = "spell-indicator";

  const manaHud = document.createElement("div");
  manaHud.className = "mana-hud";
  manaHud.innerHTML = `
    <div class="mana-hud-row">
      <span class="mana-hud-label">Mana</span>
      <span class="mana-hud-value">100/100</span>
    </div>
    <div class="mana-hud-bar">
      <div class="mana-hud-fill"></div>
    </div>
  `;
  const manaHudValue = manaHud.querySelector(".mana-hud-value");
  const manaHudFill = manaHud.querySelector(".mana-hud-fill");
  const statusHud = document.createElement("div");
  statusHud.className = "status-hud";
  statusHud.innerHTML = `
    <div class="status-hud-row">
      <span class="status-hud-label">Lives</span>
      <span class="status-hud-value status-hud-lives">3</span>
    </div>
    <div class="status-hud-row">
      <span class="status-hud-label">State</span>
      <span class="status-hud-value status-hud-state">Alive</span>
    </div>
    <div class="status-hud-row">
      <span class="status-hud-label">Time</span>
      <span class="status-hud-value status-hud-timer">--:--</span>
    </div>
    <div class="status-hud-divider"></div>
    <div class="status-hud-others-title">Others</div>
    <div class="status-hud-others"></div>
  `;
  const statusHudLivesValue = statusHud.querySelector(".status-hud-lives");
  const statusHudStateValue = statusHud.querySelector(".status-hud-state");
  const statusHudTimerValue = statusHud.querySelector(".status-hud-timer");
  const statusHudOthers = statusHud.querySelector(".status-hud-others");
  const statusHudOtherRowsByPlayerId = new Map();
  const initialPlayersById =
    data?.players && typeof data.players === "object" ? data.players : {};
  const phoenixCastOverlayByPlayerId = new Map();
  const phoenixCastStateByPlayerId = new Map();

  document.body.appendChild(gameViewport);
  document.body.appendChild(spellIndicator);
  document.body.appendChild(manaHud);
  document.body.appendChild(statusHud);

  const inputController = initInput(socket, roomId);
  let pauseController = null;
  const spellController = createSpellController({
    viewport: gameViewport,
    map,
    player,
    availableSpellIds: selectedSpellIds,
  });
  const entityRenderStates = createEntityRenderStateStore(
    gameViewport,
    createPlayerElement,
  );
  const healthMiniBars = new Map();

  spellIndicator.textContent =
    spellController.getSelectedSpell()?.name || "No spell selected";
  let castRejectionTimeoutId = null;
  let lastMana = 100;
  let lastMaxMana = 100;
  let selfMoveSpeedMultiplier = 1;
  let selfDashDisabled = false;
  let selfIsGhost = false;
  let lastAimSentAtMs = 0;
  let lastAimX = null;
  let lastAimY = null;

  pauseController = createPauseController({
    socket,
    roomId,
    onPauseStateChange: (paused) => {
      inputController.setPaused(paused);
      if (paused) {
        inputController.replacePendingInputs([]);
      }
    },
    onQuit: () => {
      window.location.reload();
    },
  });

  function ensurePhoenixCastOverlay(playerId) {
    let castOverlay = phoenixCastOverlayByPlayerId.get(playerId);
    if (!castOverlay) {
      castOverlay = document.createElement("div");
      castOverlay.className = "phoenix-cast-overlay";
      gameViewport.appendChild(castOverlay);
      phoenixCastOverlayByPlayerId.set(playerId, castOverlay);
    }
    return castOverlay;
  }

  function removePhoenixCastOverlay(playerId) {
    const castOverlay = phoenixCastOverlayByPlayerId.get(playerId);
    if (!castOverlay) {
      return;
    }
    castOverlay.remove();
    phoenixCastOverlayByPlayerId.delete(playerId);
  }

  function renderManaHud(mana, maxMana) {
    const safeMaxMana = Number.isFinite(maxMana) ? Math.max(1, maxMana) : 100;
    const safeMana = Number.isFinite(mana)
      ? clamp(mana, 0, safeMaxMana)
      : safeMaxMana;
    const manaPercent = (safeMana / safeMaxMana) * 100;

    lastMana = safeMana;
    lastMaxMana = safeMaxMana;

    if (manaHudValue) {
      manaHudValue.textContent = `${Math.round(safeMana)}/${Math.round(safeMaxMana)}`;
    }
    if (manaHudFill) {
      manaHudFill.style.width = `${manaPercent}%`;
    }
  }

  function renderSelectedSpellLabel() {
    spellIndicator.classList.remove("spell-rejected");
    spellIndicator.textContent =
      spellController.getSelectedSpell()?.name || "No spell selected";
  }

  function showGhostRestrictionMessage() {
    spellIndicator.classList.add("spell-rejected");
    spellIndicator.textContent = "Ghosts cannot cast spells";
    if (castRejectionTimeoutId) {
      clearTimeout(castRejectionTimeoutId);
    }
    castRejectionTimeoutId = setTimeout(() => {
      castRejectionTimeoutId = null;
      renderSelectedSpellLabel();
    }, 950);
  }

  function getHudState(snapshotState, nowMs = Date.now()) {
    const livesRemaining = Number.isFinite(snapshotState?.livesRemaining)
      ? Math.max(0, Math.floor(snapshotState.livesRemaining))
      : 0;
    const isGhost = Boolean(snapshotState?.isGhost);
    const respawnAtMs = Number(snapshotState?.respawnAtMs);
    const isRespawning =
      !isGhost && Number.isFinite(respawnAtMs) && respawnAtMs > nowMs;
    let stateLabel = "Alive";
    if (isGhost) {
      stateLabel = "Ghost";
    } else if (isRespawning) {
      const secondsRemaining = Math.max(
        0.1,
        Math.ceil((respawnAtMs - nowMs) / 100) / 10,
      );
      stateLabel = `Respawning ${secondsRemaining}s`;
    }

    return { livesRemaining, isGhost, stateLabel };
  }

  function getPlayerDisplayName(playerId) {
    const rawName = initialPlayersById?.[playerId]?.name;
    if (typeof rawName === "string" && rawName.trim()) {
      return rawName.trim();
    }
    return `Player ${String(playerId).slice(0, 4)}`;
  }

  function ensureOtherStatusRow(playerId) {
    let rowEntry = statusHudOtherRowsByPlayerId.get(playerId);
    if (rowEntry || !statusHudOthers) {
      return rowEntry || null;
    }

    const row = document.createElement("div");
    row.className = "status-hud-player-row";

    const nameElement = document.createElement("span");
    nameElement.className = "status-hud-player-name";

    const stateElement = document.createElement("span");
    stateElement.className = "status-hud-player-status";

    row.append(nameElement, stateElement);
    statusHudOthers.appendChild(row);
    rowEntry = { row, nameElement, stateElement };
    statusHudOtherRowsByPlayerId.set(playerId, rowEntry);
    return rowEntry;
  }

  function renderStatusHud(selfSnapshotState, playersSnapshotById) {
    const nowMs = Date.now();
    const selfHudState = getHudState(selfSnapshotState, nowMs);

    selfIsGhost = selfHudState.isGhost;
    statusHud.classList.toggle("is-ghost", selfHudState.isGhost);
    if (statusHudLivesValue) {
      statusHudLivesValue.textContent = `${selfHudState.livesRemaining}`;
    }
    if (statusHudStateValue) {
      statusHudStateValue.textContent = selfHudState.stateLabel;
    }

    if (!statusHudOthers || !playersSnapshotById) {
      return;
    }

    const seenOtherPlayerIds = new Set();
    for (const [playerId, snapshotPlayerState] of Object.entries(
      playersSnapshotById,
    )) {
      if (!snapshotPlayerState || playerId === selfPlayerId) {
        continue;
      }
      const rowEntry = ensureOtherStatusRow(playerId);
      if (!rowEntry) {
        continue;
      }

      const hudState = getHudState(snapshotPlayerState, nowMs);
      rowEntry.nameElement.textContent = getPlayerDisplayName(playerId);
      rowEntry.stateElement.textContent = `${hudState.livesRemaining} • ${hudState.stateLabel}`;
      rowEntry.row.classList.toggle("is-ghost", hudState.isGhost);
      seenOtherPlayerIds.add(playerId);
    }

    for (const [playerId, rowEntry] of statusHudOtherRowsByPlayerId.entries()) {
      if (seenOtherPlayerIds.has(playerId)) {
        continue;
      }
      rowEntry.row.remove();
      statusHudOtherRowsByPlayerId.delete(playerId);
    }

    statusHud.classList.toggle("no-others", seenOtherPlayerIds.size === 0);
  }

  function formatMatchTimer(remainingMs) {
    if (!Number.isFinite(remainingMs)) {
      return "--:--";
    }
    const clampedMs = Math.max(0, Math.floor(remainingMs));
    const totalSeconds = Math.max(0, Math.ceil(clampedMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function renderMatchTimer(snapshot) {
    if (!statusHudTimerValue) {
      return;
    }
    const remainingMs = snapshot?.matchTimeRemainingMs;
    statusHudTimerValue.textContent = formatMatchTimer(remainingMs);
  }

  renderManaHud(lastMana, lastMaxMana);
  renderStatusHud(
    {
      livesRemaining: 3,
      isGhost: false,
      respawnAtMs: null,
    },
    {},
  );

  function showCastRejection(result) {
    const rejectionMessage = getCastRejectionMessage(
      result?.reason,
      result?.details || {},
    );
    const selectedSpellName =
      spellController.getSelectedSpell()?.name || "Spell";
    spellIndicator.classList.add("spell-rejected");
    spellIndicator.textContent = `${selectedSpellName} • ${rejectionMessage}`;

    if (castRejectionTimeoutId) {
      clearTimeout(castRejectionTimeoutId);
    }
    castRejectionTimeoutId = setTimeout(() => {
      castRejectionTimeoutId = null;
      renderSelectedSpellLabel();
    }, 950);
  }

  let fpsThisFrame = 0;
  let fps = 0;
  let tps = 0;
  let ticksThisWindow = 0;
  let framesThisWindow = 0;
  const recentFpsValues = [];
  let frameTimeMs = 0;
  let statsWindowStart = performance.now();
  let lastUiUpdate = statsWindowStart;
  const uiUpdateIntervalMs = 100;
  const statsWindowMs = 1000;
  let performanceOverlayVisible = false;

  performanceOverlay.setVisible(performanceOverlayVisible);

  let lastSnapshotId = 0;
  let hasInitialSnapshot = false;
  let hasStartedLoop = false;
  const smoothingRate = 16;

  const mapPixelWidth = map.config.width * map.config.tileSize;
  const mapPixelHeight = map.config.height * map.config.tileSize;

  let lastTime = performance.now();
  let elapsedTime = 0;
  let accumulator = 0;
  let accumulatorAtStatsStart = accumulator;

  function applyPredictedInput(state, pendingInput) {
    if (!pendingInput?.keys) {
      return state;
    }

    const effectiveMoveSpeed = movementSpeed * selfMoveSpeedMultiplier;
    const nextPosition = move(
      state.x,
      state.y,
      pendingInput.keys,
      map,
      effectiveMoveSpeed,
      hitbox,
    );
    const nextState = {
      x: nextPosition.x,
      y: nextPosition.y,
      lastDashClientTimeMs: Number.isFinite(state?.lastDashClientTimeMs)
        ? state.lastDashClientTimeMs
        : -Infinity,
      lastDashRequestId: Number.isFinite(state?.lastDashRequestId)
        ? state.lastDashRequestId
        : 0,
    };

    const dashRequestId = Number(pendingInput.actions?.dashRequestId);
    const clientTimeMs = Number.isFinite(pendingInput.clientTimeMs)
      ? pendingInput.clientTimeMs
      : 0;
    if (
      Number.isFinite(dashRequestId) &&
      dashRequestId > nextState.lastDashRequestId
    ) {
      const canDash =
        !selfDashDisabled &&
        clientTimeMs - nextState.lastDashClientTimeMs >= dashCooldownMs;
      if (canDash && hasMovementInput(pendingInput.keys)) {
        const dashedPosition = moveByDistance(
          nextState.x,
          nextState.y,
          pendingInput.keys,
          map,
          dashDistance,
          hitbox,
          effectiveMoveSpeed,
        );
        nextState.x = dashedPosition.x;
        nextState.y = dashedPosition.y;
        nextState.lastDashClientTimeMs = clientTimeMs;
      }
      nextState.lastDashRequestId = dashRequestId;
    }

    return nextState;
  }

  function handleSnapshot(snapshot) {
    if (!snapshot || snapshot.roomId !== roomId) return;
    if (snapshot.snapshotId <= lastSnapshotId) return;
    if (!snapshot.players || typeof snapshot.players !== "object") return;

    const nowMs = Date.now();
    const selfSnapshotState = snapshot.players[selfPlayerId];
    renderStatusHud(selfSnapshotState, snapshot.players);
    renderMatchTimer(snapshot);
    const selfCombatState = selfSnapshotState?.combat;
    const snapshotSlowMultiplier = Number(
      selfSnapshotState?.tileEffectState?.activeSlowMultiplier,
    );
    const resolvedSlowMultiplier = Number.isFinite(snapshotSlowMultiplier)
      ? clamp(snapshotSlowMultiplier, 0.1, 1)
      : 1;
    if (selfCombatState && typeof selfCombatState === "object") {
      renderManaHud(selfCombatState.mana, selfCombatState.maxMana);
      const orbitBladeCount = Number(
        selfCombatState.activeCastCountBySpell?.orbitBlades || 0,
      );
      if (orbitBladeCount > 0) {
        selfMoveSpeedMultiplier = 0.8 * resolvedSlowMultiplier;
        selfDashDisabled = true;
      } else {
        selfMoveSpeedMultiplier = resolvedSlowMultiplier;
        selfDashDisabled = false;
      }
    } else {
      renderManaHud(lastMana, lastMaxMana);
      selfMoveSpeedMultiplier = resolvedSlowMultiplier;
      selfDashDisabled = false;
    }

    const seenPlayerIds = new Set();
    for (const [playerId, snapshotPlayerState] of Object.entries(
      snapshot.players,
    )) {
      if (!snapshotPlayerState) continue;

      const snapshotX = Number(snapshotPlayerState.x);
      const snapshotY = Number(snapshotPlayerState.y);
      if (!Number.isFinite(snapshotX) || !Number.isFinite(snapshotY)) continue;

      const activePhoenixCast = getActivePhoenixCastState(
        snapshotPlayerState.combat,
        nowMs,
      );
      if (activePhoenixCast) {
        phoenixCastStateByPlayerId.set(playerId, activePhoenixCast);
      } else {
        phoenixCastStateByPlayerId.delete(playerId);
        removePhoenixCastOverlay(playerId);
      }

      const skinIndex =
        snapshot.skin?.[playerId] ?? snapshotPlayerState.skin ?? 0;
      const skinClass = loadSprite(skinIndex);
      const entityState = entityRenderStates.getOrCreateEntityState(
        playerId,
        snapshotX,
        snapshotY,
        skinClass,
        skinIndex,
      );
      entityRenderStates.setSkin(playerId, skinClass);
      entityRenderStates.setGhost(
        playerId,
        Boolean(snapshotPlayerState.isGhost),
      );
      if (!healthMiniBars.has(playerId)) {
        healthMiniBars.set(
          playerId,
          createHealthIndicatorMini(entityState.element, playerId),
        );
      }
      const healthMini = healthMiniBars.get(playerId);
      healthMini.renderMini(snapshotPlayerState);

      const facing = getFacingFromInput(
        snapshotPlayerState.lastKeyState,
        entityState.facing,
      );
      entityRenderStates.setFacing(playerId, facing);

      if (playerId === selfPlayerId) {
        const lastProcessedInputSeq = Number.isFinite(
          snapshotPlayerState.lastProcessedInputSeq,
        )
          ? snapshotPlayerState.lastProcessedInputSeq
          : 0;
        const reconciliationResult = reconcileLocalPlayer(
          { x: snapshotX, y: snapshotY },
          inputController.getPendingInputs(),
          lastProcessedInputSeq,
          applyPredictedInput,
        );
        inputController.replacePendingInputs(
          reconciliationResult.pendingInputs,
        );
        entityRenderStates.setTarget(
          playerId,
          reconciliationResult.state.x,
          reconciliationResult.state.y,
        );
      } else {
        entityRenderStates.setTarget(playerId, snapshotX, snapshotY);
      }

      if (!hasInitialSnapshot) {
        entityRenderStates.snapToTarget(playerId);
      }
      seenPlayerIds.add(playerId);
    }

    entityRenderStates.removeMissing(seenPlayerIds);
    for (const [playerId, healthMini] of healthMiniBars.entries()) {
      if (seenPlayerIds.has(playerId)) continue;
      healthMini.dispose();
      healthMiniBars.delete(playerId);
    }
    for (const playerId of Array.from(phoenixCastStateByPlayerId.keys())) {
      if (seenPlayerIds.has(playerId)) continue;
      phoenixCastStateByPlayerId.delete(playerId);
    }
    for (const playerId of Array.from(phoenixCastOverlayByPlayerId.keys())) {
      if (seenPlayerIds.has(playerId)) continue;
      removePhoenixCastOverlay(playerId);
    }

    // Sync projectiles from server
    if (snapshot.projectiles) {
      spellController.syncProjectiles(snapshot.projectiles);
    }

    const selfRenderState = entityRenderStates.get(selfPlayerId);
    if (!selfRenderState) {
      lastSnapshotId = snapshot.snapshotId;
      return;
    }

    if (!hasInitialSnapshot) {
      player.x = selfRenderState.renderX;
      player.y = selfRenderState.renderY;
      hasInitialSnapshot = true;

      if (!hasStartedLoop) {
        rafId = requestAnimationFrame(gameLoop);
        hasStartedLoop = true;
      }
    }

    lastSnapshotId = snapshot.snapshotId;
  }

  function handleClick(event) {
    if (selfIsGhost) {
      showGhostRestrictionMessage();
      return;
    }

    const worldX = event.clientX + cameraX;
    const worldY = event.clientY + cameraY;
    const castData = spellController.cast(worldX, worldY);
    if (!castData) {
      return;
    }

    const id = castData.spellId;
    const soundSrc = sounds[id];
    if (typeof soundSrc === "string" && soundSrc.length > 0) {
      const audio = new Audio(soundSrc);
      audio
        .play()
        .catch((err) => console.error("play failed:", err, "src:", audio.src));
    }

    // Send spell cast to server for synchronization
    socket.emit("spell:cast", castData, (result) => {
      if (result?.accepted === false) {
        showCastRejection(result);
      }
    });
  }

  function handleContextMenu(event) {
    event.preventDefault();
  }

  function handleGlobalContextMenu(event) {
    event.preventDefault();
    inputController.forceReleaseKeys();
  }

  function handleGlobalPointerDown(event) {
    if (event.button !== 2) {
      return;
    }
    inputController.forceReleaseKeys();
  }

  function handlePointerMove(event) {
    const worldX = event.clientX + cameraX;
    const worldY = event.clientY + cameraY;
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) {
      return;
    }

    const nowMs = Date.now();
    const elapsedMs = nowMs - lastAimSentAtMs;
    const movedDistance = Math.hypot(
      worldX - (lastAimX ?? worldX),
      worldY - (lastAimY ?? worldY),
    );
    if (elapsedMs < 28 && movedDistance < 12) {
      return;
    }

    lastAimSentAtMs = nowMs;
    lastAimX = worldX;
    lastAimY = worldY;
    socket.emit("aim:update", {
      roomId,
      aimX: worldX,
      aimY: worldY,
    });
  }

  function handleKeydown(event) {
    const key = event.key.toLowerCase();
    if ((key === "q" || key === "e") && selfIsGhost) {
      showGhostRestrictionMessage();
      return;
    }
    if (key === "q") {
      spellController.cycleSpell(-1);
      renderSelectedSpellLabel();
      return;
    }
    if (key === "e") {
      spellController.cycleSpell(1);
      renderSelectedSpellLabel();
      return;
    }
    if (key === "f" && !isInputTarget(event.target)) {
      performanceOverlayVisible = !performanceOverlayVisible;
      performanceOverlay.setVisible(performanceOverlayVisible);
    }
  }

  function simulateTick() {
    if (!hasInitialSnapshot) return;
    ticksThisWindow++;
  }

  function renderLoop() {
    accumulator += elapsedTime;
    while (accumulator >= tick) {
      simulateTick();
      accumulator -= tick;
    }

    const deltaSeconds = elapsedTime / 1000;
    const smoothingAlpha = 1 - Math.exp(-smoothingRate * deltaSeconds);
    entityRenderStates.smooth(smoothingAlpha);

    const selfRenderState = entityRenderStates.get(selfPlayerId);
    if (!selfRenderState) return;

    player.x = selfRenderState.renderX;
    player.y = selfRenderState.renderY;
    cameraX = selfRenderState.renderX - window.innerWidth / 2;
    cameraY = selfRenderState.renderY - window.innerHeight / 2;

    const maxCameraX = mapPixelWidth - window.innerWidth;
    const maxCameraY = mapPixelHeight - window.innerHeight;
    cameraX = Math.max(0, Math.min(cameraX, maxCameraX));
    cameraY = Math.max(0, Math.min(cameraY, maxCameraY));

    entityRenderStates.forEach((_, entityState) => {
      const screenPosition = worldToScreen(
        entityState.renderX,
        entityState.renderY,
        cameraX,
        cameraY,
      );
      entityState.element.style.left = `${screenPosition.x}px`;
      entityState.element.style.top = `${screenPosition.y}px`;
    });

    const nowMs = Date.now();
    const expiredPhoenixCastPlayerIds = [];
    for (const [
      playerId,
      phoenixCastState,
    ] of phoenixCastStateByPlayerId.entries()) {
      const entityState = entityRenderStates.get(playerId);
      if (!entityState) {
        expiredPhoenixCastPlayerIds.push(playerId);
        continue;
      }

      const castDurationMs = Math.max(
        1,
        phoenixCastState.completeAtMs - phoenixCastState.startedAtMs,
      );
      const castProgress = clamp(
        (nowMs - phoenixCastState.startedAtMs) / castDurationMs,
        0,
        1,
      );
      if (castProgress >= 1) {
        expiredPhoenixCastPlayerIds.push(playerId);
        continue;
      }

      const castOverlay = ensurePhoenixCastOverlay(playerId);
      castOverlay.classList.toggle("remote", playerId !== selfPlayerId);
      const castCenter = worldToScreen(
        entityState.renderX + hitbox.offsetX + hitbox.width / 2,
        entityState.renderY + hitbox.offsetY + hitbox.height / 2,
        cameraX,
        cameraY,
      );
      castOverlay.style.left = `${castCenter.x}px`;
      castOverlay.style.top = `${castCenter.y}px`;
      castOverlay.style.setProperty("--cast-progress", `${castProgress}`);
    }
    for (const playerId of expiredPhoenixCastPlayerIds) {
      phoenixCastStateByPlayerId.delete(playerId);
      removePhoenixCastOverlay(playerId);
    }

    mapDiv.style.transform = `translate(${-cameraX}px, ${-cameraY}px)`;
    spellController.update(cameraX, cameraY);
  }

  function gameLoop() {
    const now = performance.now();
    elapsedTime = now - lastTime;
    frameTimeMs = elapsedTime;
    renderLoop();

    fpsThisFrame = elapsedTime > 0.5 ? 1000 / elapsedTime : 0;
    framesThisWindow++;
    recentFpsValues.push(fpsThisFrame);
    if (recentFpsValues.length > 300) {
      recentFpsValues.shift();
    }

    const statsWindowElapsed = now - statsWindowStart;
    if (statsWindowElapsed >= statsWindowMs) {
      fps = (framesThisWindow * 1000) / statsWindowElapsed;
      const simulatedTicks =
        ticksThisWindow + (accumulator - accumulatorAtStatsStart) / tick;
      tps = (simulatedTicks * 1000) / statsWindowElapsed;
      framesThisWindow = 0;
      ticksThisWindow = 0;
      accumulatorAtStatsStart = accumulator;
      statsWindowStart = now;
    }

    if (now - lastUiUpdate >= uiUpdateIntervalMs) {
      const sortedFps = recentFpsValues
        .filter((value) => value > 0)
        .sort((a, b) => a - b);
      const onePercentIndex = Math.max(
        0,
        Math.floor(sortedFps.length * 0.01) - 1,
      );
      const onePercentLow = sortedFps.length ? sortedFps[onePercentIndex] : 0;
      const avgFrameTime = fps > 0 ? 1000 / fps : frameTimeMs;
      performanceOverlay.update({
        fps,
        tps,
        onePercentLow,
        frameTimeMs: avgFrameTime,
        fpsThisFrame,
      });
      lastUiUpdate = now;
    }

    lastTime = now;
    rafId = requestAnimationFrame(gameLoop);
  }

  function handleSpellCastRejected(result) {
    showCastRejection(result);
  }

  const handleGamePaused = (payload) => {
    pauseController?.handlePaused(payload || {});
  };
  const handleGameResumed = (payload) => {
    pauseController?.handleResumed(payload || {});
  };
  const handleGameQuit = (payload) => {
    pauseController?.handleQuit(payload || {});
  };
  const handlePauseRejected = (payload) => {
    pauseController?.handlePauseRejected(payload || {});
  };

  socket.on("snapshot", handleSnapshot);
  socket.on("spell:cast:rejected", handleSpellCastRejected);
  socket.on("game-paused", handleGamePaused);
  socket.on("game-resumed", handleGameResumed);
  socket.on("game-quit", handleGameQuit);
  socket.on("game-pause-rejected", handlePauseRejected);
  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("contextmenu", handleGlobalContextMenu, true);
  document.addEventListener("pointerdown", handleGlobalPointerDown, true);
  gameViewport.addEventListener("click", handleClick);
  gameViewport.addEventListener("contextmenu", handleContextMenu);
  gameViewport.addEventListener("pointermove", handlePointerMove);

  return {
    dispose() {
      socket.off("snapshot", handleSnapshot);
      socket.off("spell:cast:rejected", handleSpellCastRejected);
      socket.off("game-paused", handleGamePaused);
      socket.off("game-resumed", handleGameResumed);
      socket.off("game-quit", handleGameQuit);
      socket.off("game-pause-rejected", handlePauseRejected);
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener(
        "contextmenu",
        handleGlobalContextMenu,
        true,
      );
      document.removeEventListener(
        "pointerdown",
        handleGlobalPointerDown,
        true,
      );
      gameViewport.removeEventListener("click", handleClick);
      gameViewport.removeEventListener("contextmenu", handleContextMenu);
      gameViewport.removeEventListener("pointermove", handlePointerMove);
      inputController.dispose();
      pauseController?.dispose();
      for (const healthMini of healthMiniBars.values()) {
        healthMini.dispose();
      }
      healthMiniBars.clear();

      spellController.dispose();
      performanceOverlay.dispose();
      entityRenderStates.dispose();
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      if (castRejectionTimeoutId) {
        clearTimeout(castRejectionTimeoutId);
      }
      for (const castOverlay of phoenixCastOverlayByPlayerId.values()) {
        castOverlay.remove();
      }
      phoenixCastOverlayByPlayerId.clear();
      phoenixCastStateByPlayerId.clear();
      document.body.classList.remove("game-fake-3d");
      gameViewport.remove();
      spellIndicator.remove();
      manaHud.remove();
      statusHud.remove();
    },
  };
}
