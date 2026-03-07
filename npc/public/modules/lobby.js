// Lobby functionality module

import { getCookie, setCookie } from "./cookies.js";
import { showError, hideError } from "./errors.js";
import { validateRoomId, validateNickname } from "/shared/validation.js";
import { getMapMetadataList } from "/shared/map.js";
import { SPELLS, REQUIRED_SPELL_LOADOUT_SIZE } from "/shared/spells.js";
import {
  NPC_ARCHETYPES,
  NPC_DIFFICULTY_PRESETS,
  NPC_COUNT_LIMITS,
  createDefaultNpcConfigs,
  getNpcArchetypeById,
  getNpcDifficultyById,
  getNpcEffectiveStats,
  sanitizeNpcConfig,
} from "/shared/npc.js";

const bgLayerContainers = document.querySelectorAll(".bg-layer");
const runes = document.querySelector(".floating-runes");
const mainContainer = document.querySelector(".card");

function getRoomIdErrorMessage(validationResult) {
  switch (validationResult.reason) {
    case "required":
      return "The chamber requires a name, wizard.";
    case "length":
      return "Chamber name must be 3-20 characters.";
    case "format":
      return "Chamber name can only contain letters and numbers.";
    default:
      return "Invalid chamber name.";
  }
}

function getNicknameErrorMessage(validationResult) {
  switch (validationResult.reason) {
    case "required":
      return "A wizard must have a name!";
    case "length":
      return "Wizard name must be 2-15 characters.";
    case "format":
      return "Wizard name can only contain letters, numbers, and spaces.";
    default:
      return "Invalid wizard name.";
  }
}

export function initLobby(
  socket,
  lobby,
  room,
  joinBtn,
  startBtn,
  playersList,
  currentRoomIdLabel,
  errorDiv,
  errorText,
  errorRoomDiv,
  errorRoomText,
  onRoomJoined,
  onGameStarted,
) {
  const mapSelectionSection = document.getElementById("map-selection-section");
  const mapSelect = document.getElementById("mapSelect");
  const mapSummary = document.getElementById("map-selection-summary");
  const spellLoadoutSection = document.getElementById("spell-loadout-section");
  const spellOptions = document.getElementById("spell-options");
  const spellSelectionSummary = document.getElementById("spell-selection-summary");
  const modeSection = document.getElementById("mode-section");
  const modeToggle = document.getElementById("mode-toggle");
  const modeSummary = document.getElementById("mode-summary");
  const npcConfigSection = document.getElementById("npc-config-section");
  const npcCountSelect = document.getElementById("npcCountSelect");
  const npcConfigList = document.getElementById("npc-config-list");
  const mapMetadataList = getMapMetadataList();
  const mapMetadataById = new Map(mapMetadataList.map((map) => [map.id, map]));

  let activeRoomId = null;
  let players = {};
  let hostId = null;
  let selectedMapId = mapMetadataList[0]?.id || null;
  let selectedSpellsByPlayerId = {};
  let selfSelectedSpellIds = [];
  let mode = "multi";
  let npcConfigs = createDefaultNpcConfigs(NPC_COUNT_LIMITS.min);
  const npcNameDrafts = new Map();
  let suppressNpcNameBlurCommit = false;
  let npcSyncTimeoutId = null;
  let suppressSpellOptionEvents = false;

  let selfPlayerId = null;

  // Load saved data
  const savedRoomId = getCookie("roomId");
  const savedNickname = getCookie("nickname");

  if (savedRoomId) {
    document.getElementById("roomId").value = savedRoomId;
  }
  if (savedNickname) {
    document.getElementById("nickname").value = savedNickname;
  }

  if (mapSelect) {
    mapSelect.innerHTML = "";
    mapMetadataList.forEach((map) => {
      const option = document.createElement("option");
      option.value = map.id;
      option.textContent = map.name;
      mapSelect.appendChild(option);
    });
    if (selectedMapId) {
      mapSelect.value = selectedMapId;
    }
  }

  if (spellOptions) {
    spellOptions.innerHTML = "";
    SPELLS.forEach((spell) => {
      const optionLabel = document.createElement("label");
      optionLabel.className = "spell-option";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = spell.id;

      const labelText = document.createElement("span");
      labelText.textContent = spell.name;

      optionLabel.appendChild(checkbox);
      optionLabel.appendChild(labelText);
      spellOptions.appendChild(optionLabel);
    });
  }

  function getMapName(mapId) {
    return mapMetadataById.get(mapId)?.name || "Unknown map";
  }

  function renderMapSelection() {
    const isHost = hostId === selfPlayerId;
    if (mapSelectionSection) {
      mapSelectionSection.style.display = isHost ? "block" : "none";
    }
    if (mapSelect) {
      if (selectedMapId && mapMetadataById.has(selectedMapId)) {
        mapSelect.value = selectedMapId;
      }
      mapSelect.disabled = !isHost;
    }
    if (mapSummary) {
      mapSummary.textContent = `Selected map: ${getMapName(selectedMapId)}`;
    }
  }

  function getSelectedSpellNames(spellIds) {
    return spellIds
      .map((spellId) => SPELLS.find((spell) => spell.id === spellId)?.name || spellId)
      .join(", ");
  }

  function hasValidLoadout(spellIds) {
    if (!Array.isArray(spellIds) || spellIds.length !== REQUIRED_SPELL_LOADOUT_SIZE) {
      return false;
    }
    return new Set(spellIds).size === REQUIRED_SPELL_LOADOUT_SIZE;
  }

  function areAllPlayersLoadoutReady() {
    const playerIds = Object.keys(players);
    if (playerIds.length === 0) {
      return false;
    }
    return playerIds.every((playerId) =>
      hasValidLoadout(selectedSpellsByPlayerId[playerId]),
    );
  }

  function renderSpellSelection() {
    if (spellLoadoutSection) {
      spellLoadoutSection.style.display = activeRoomId ? "block" : "none";
    }
    if (!spellSelectionSummary) {
      return;
    }

    const currentLoadout = selfSelectedSpellIds;
    const selectedCount = currentLoadout.length;
    const spellNames = getSelectedSpellNames(currentLoadout);
    const spellSuffix = spellNames ? `: ${spellNames}` : "";
    spellSelectionSummary.textContent = `Selected ${selectedCount}/${REQUIRED_SPELL_LOADOUT_SIZE} spells${spellSuffix}`;
  }

  function syncSpellOptionSelection() {
    if (!spellOptions) {
      return;
    }

    const currentLoadout = selectedSpellsByPlayerId[selfPlayerId] || [];
    suppressSpellOptionEvents = true;
    const checkboxElements = spellOptions.querySelectorAll("input[type='checkbox']");
    checkboxElements.forEach((checkboxElement) => {
      checkboxElement.checked = currentLoadout.includes(checkboxElement.value);
    });
    suppressSpellOptionEvents = false;
  }

  function renderStartButtonState() {
    const isHost = hostId === selfPlayerId;
    startBtn.style.display = isHost ? "flex" : "none";
    if (!isHost) {
      return;
    }

    const allReady = areAllPlayersLoadoutReady();
    const hasEnoughPlayers = Object.keys(players).length >= 2;
    startBtn.disabled = !allReady || !hasEnoughPlayers;
    startBtn.title = allReady
      ? ""
      : `Every player must pick ${REQUIRED_SPELL_LOADOUT_SIZE} spells`;
    if (!hasEnoughPlayers) {
      startBtn.title = "You can only start the game with 2 or more players";
    }
  }

  function renderModeControls() {
    if (!modeSection || !modeToggle) {
      return;
    }
    const isHost = hostId === selfPlayerId;
    const buttons = modeToggle.querySelectorAll(".mode-btn");
    buttons.forEach((button) => {
      const buttonMode = button.getAttribute("data-mode");
      const isActive = buttonMode === mode;
      button.classList.toggle("is-active", isActive);
      button.disabled = !isHost;
    });
    if (modeSummary) {
      modeSummary.textContent =
        mode === "single"
          ? "Single-player locks the room and spawns virtual opponents."
          : "Multiplayer allows up to 4 human wizards.";
    }
    if (npcConfigSection) {
      npcConfigSection.style.display = mode === "single" ? "block" : "none";
    }
  }

  function getNpcConfigByIndex(index) {
    return npcConfigs[index] || sanitizeNpcConfig({}, index);
  }

  function pruneNpcNameDrafts() {
    for (const draftIndex of Array.from(npcNameDrafts.keys())) {
      if (draftIndex < 0 || draftIndex >= npcConfigs.length) {
        npcNameDrafts.delete(draftIndex);
      }
    }
  }

  function getNpcDisplayName(config, index) {
    if (npcNameDrafts.has(index)) {
      return npcNameDrafts.get(index);
    }
    return config.name || `NPC ${index + 1}`;
  }

  function commitNpcName(index, rawName) {
    const currentConfig = getNpcConfigByIndex(index);
    const nextConfig = sanitizeNpcConfig(
      { ...currentConfig, name: rawName },
      index,
    );

    npcNameDrafts.delete(index);
    if (currentConfig.name === nextConfig.name) {
      return nextConfig.name;
    }

    npcConfigs[index] = nextConfig;
    scheduleNpcSync();
    return nextConfig.name;
  }

  function captureNpcControlState() {
    if (!npcConfigList) {
      return null;
    }

    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement) || !npcConfigList.contains(activeElement)) {
      return null;
    }

    const npcIndex = activeElement.getAttribute("data-npc-index");
    const npcField = activeElement.getAttribute("data-npc-field");
    if (!npcIndex || !npcField) {
      return null;
    }

    const controlState = { npcIndex, npcField };
    if (
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement
    ) {
      controlState.selectionStart = activeElement.selectionStart;
      controlState.selectionEnd = activeElement.selectionEnd;
    }

    return controlState;
  }

  function restoreNpcControlState(controlState) {
    if (!npcConfigList || !controlState) {
      return;
    }

    const nextActiveElement = npcConfigList.querySelector(
      `[data-npc-index="${controlState.npcIndex}"][data-npc-field="${controlState.npcField}"]`,
    );
    if (!(nextActiveElement instanceof HTMLElement)) {
      return;
    }
    if (
      (nextActiveElement instanceof HTMLInputElement ||
        nextActiveElement instanceof HTMLSelectElement ||
        nextActiveElement instanceof HTMLTextAreaElement) &&
      nextActiveElement.disabled
    ) {
      return;
    }

    nextActiveElement.focus();
    if (
      nextActiveElement instanceof HTMLInputElement &&
      typeof controlState.selectionStart === "number" &&
      typeof controlState.selectionEnd === "number"
    ) {
      const valueLength = nextActiveElement.value.length;
      nextActiveElement.setSelectionRange(
        Math.min(controlState.selectionStart, valueLength),
        Math.min(controlState.selectionEnd, valueLength),
      );
    }
  }

  function scheduleNpcSync() {
    if (!activeRoomId) {
      return;
    }
    if (npcSyncTimeoutId) {
      clearTimeout(npcSyncTimeoutId);
    }
    npcSyncTimeoutId = setTimeout(() => {
      npcSyncTimeoutId = null;
      socket.emit(
        "lobby:set-npcs",
        { roomId: activeRoomId, npcConfigs },
        (response) => {
          if (!response?.ok) {
            showError(
              errorRoomDiv,
              errorRoomText,
              response?.message || "Failed to update NPC settings",
            );
            return;
          }
          hideError(errorRoomDiv);
        },
      );
    }, 220);
  }

  function renderNpcConfigs() {
    if (!npcConfigList || !npcCountSelect) {
      return;
    }
    pruneNpcNameDrafts();
    const focusedControlState = captureNpcControlState();
    const isHost = hostId === selfPlayerId;
    npcCountSelect.disabled = !isHost;
    npcCountSelect.value = String(npcConfigs.length);
    suppressNpcNameBlurCommit = true;
    try {
      npcConfigList.innerHTML = "";

      npcConfigs.forEach((config, index) => {
        const archetype = getNpcArchetypeById(config.archetypeId);
        const difficulty = getNpcDifficultyById(config.difficulty);
        const stats = getNpcEffectiveStats(config);
        const card = document.createElement("div");
        card.className = `npc-card ${isHost ? "" : "is-disabled"}`.trim();

        const header = document.createElement("div");
        header.className = "npc-card-header";
        const title = document.createElement("div");
        title.className = "npc-card-title";
        title.textContent = `Opponent ${index + 1}`;
        const effectiveness = document.createElement("div");
        effectiveness.className = "npc-effectiveness";
        effectiveness.textContent = `Effectiveness ${stats.effectivenessScore}`;
        header.append(title, effectiveness);

        const fields = document.createElement("div");
        fields.className = "npc-fields";

        const nameField = document.createElement("label");
        nameField.className = "npc-field";
        nameField.textContent = "Name";
        const nameInput = document.createElement("input");
        nameInput.value = getNpcDisplayName(config, index);
        nameInput.disabled = !isHost;
        nameInput.dataset.npcIndex = String(index);
        nameInput.dataset.npcField = "name";
        nameInput.addEventListener("input", () => {
          npcNameDrafts.set(index, nameInput.value);
        });
        nameInput.addEventListener("blur", () => {
          if (suppressNpcNameBlurCommit) {
            return;
          }
          const nextName = commitNpcName(index, nameInput.value);
          nameInput.value = nextName;
        });
        nameInput.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") {
            return;
          }
          event.preventDefault();
          nameInput.blur();
        });
        nameField.appendChild(nameInput);

        const archetypeField = document.createElement("label");
        archetypeField.className = "npc-field";
        archetypeField.textContent = "Archetype";
        const archetypeSelect = document.createElement("select");
        archetypeSelect.disabled = !isHost;
        archetypeSelect.dataset.npcIndex = String(index);
        archetypeSelect.dataset.npcField = "archetype";
        NPC_ARCHETYPES.forEach((entry) => {
          const option = document.createElement("option");
          option.value = entry.id;
          option.textContent = entry.name;
          archetypeSelect.appendChild(option);
        });
        archetypeSelect.value = config.archetypeId;
        archetypeSelect.addEventListener("change", () => {
          npcConfigs[index] = sanitizeNpcConfig(
            { ...getNpcConfigByIndex(index), archetypeId: archetypeSelect.value },
            index,
          );
          scheduleNpcSync();
          renderNpcConfigs();
        });
        archetypeField.appendChild(archetypeSelect);

        const difficultyField = document.createElement("label");
        difficultyField.className = "npc-field";
        difficultyField.textContent = "Difficulty";
        const difficultySelect = document.createElement("select");
        difficultySelect.disabled = !isHost;
        difficultySelect.dataset.npcIndex = String(index);
        difficultySelect.dataset.npcField = "difficulty";
        NPC_DIFFICULTY_PRESETS.forEach((entry) => {
          const option = document.createElement("option");
          option.value = entry.id;
          option.textContent = entry.label;
          difficultySelect.appendChild(option);
        });
        difficultySelect.value = config.difficulty;
        difficultySelect.addEventListener("change", () => {
          npcConfigs[index] = sanitizeNpcConfig(
            { ...getNpcConfigByIndex(index), difficulty: difficultySelect.value },
            index,
          );
          scheduleNpcSync();
          renderNpcConfigs();
        });
        difficultyField.appendChild(difficultySelect);

        const aggressionField = document.createElement("label");
        aggressionField.className = "npc-field";
        aggressionField.textContent = "Aggression";
        const aggressionInput = document.createElement("input");
        aggressionInput.type = "range";
        aggressionInput.min = "0";
        aggressionInput.max = "100";
        aggressionInput.value = String(config.aggression ?? 50);
        aggressionInput.disabled = !isHost;
        aggressionInput.dataset.npcIndex = String(index);
        aggressionInput.dataset.npcField = "aggression";
        const aggressionValue = document.createElement("div");
        aggressionValue.className = "npc-slider-value";
        aggressionValue.textContent = `${Math.round(config.aggression ?? 50)}`;
        aggressionInput.addEventListener("input", () => {
          aggressionValue.textContent = aggressionInput.value;
          npcConfigs[index] = sanitizeNpcConfig(
            { ...getNpcConfigByIndex(index), aggression: Number(aggressionInput.value) },
            index,
          );
          scheduleNpcSync();
        });
        aggressionField.appendChild(aggressionInput);
        aggressionField.appendChild(aggressionValue);

        const precisionField = document.createElement("label");
        precisionField.className = "npc-field";
        precisionField.textContent = "Precision";
        const precisionInput = document.createElement("input");
        precisionInput.type = "range";
        precisionInput.min = "0";
        precisionInput.max = "100";
        precisionInput.value = String(config.precision ?? 50);
        precisionInput.disabled = !isHost;
        precisionInput.dataset.npcIndex = String(index);
        precisionInput.dataset.npcField = "precision";
        const precisionValue = document.createElement("div");
        precisionValue.className = "npc-slider-value";
        precisionValue.textContent = `${Math.round(config.precision ?? 50)}`;
        precisionInput.addEventListener("input", () => {
          precisionValue.textContent = precisionInput.value;
          npcConfigs[index] = sanitizeNpcConfig(
            { ...getNpcConfigByIndex(index), precision: Number(precisionInput.value) },
            index,
          );
          scheduleNpcSync();
        });
        precisionField.appendChild(precisionInput);
        precisionField.appendChild(precisionValue);

        const mobilityField = document.createElement("label");
        mobilityField.className = "npc-field";
        mobilityField.textContent = "Mobility";
        const mobilityInput = document.createElement("input");
        mobilityInput.type = "range";
        mobilityInput.min = "0";
        mobilityInput.max = "100";
        mobilityInput.value = String(config.mobility ?? 50);
        mobilityInput.disabled = !isHost;
        mobilityInput.dataset.npcIndex = String(index);
        mobilityInput.dataset.npcField = "mobility";
        const mobilityValue = document.createElement("div");
        mobilityValue.className = "npc-slider-value";
        mobilityValue.textContent = `${Math.round(config.mobility ?? 50)}`;
        mobilityInput.addEventListener("input", () => {
          mobilityValue.textContent = mobilityInput.value;
          npcConfigs[index] = sanitizeNpcConfig(
            { ...getNpcConfigByIndex(index), mobility: Number(mobilityInput.value) },
            index,
          );
          scheduleNpcSync();
        });
        mobilityField.appendChild(mobilityInput);
        mobilityField.appendChild(mobilityValue);

        const powerField = document.createElement("label");
        powerField.className = "npc-field";
        powerField.textContent = "Power";
        const powerInput = document.createElement("input");
        powerInput.type = "range";
        powerInput.min = "0";
        powerInput.max = "100";
        powerInput.value = String(config.power ?? 50);
        powerInput.disabled = !isHost;
        powerInput.dataset.npcIndex = String(index);
        powerInput.dataset.npcField = "power";
        const powerValue = document.createElement("div");
        powerValue.className = "npc-slider-value";
        powerValue.textContent = `${Math.round(config.power ?? 50)}`;
        powerInput.addEventListener("input", () => {
          powerValue.textContent = powerInput.value;
          npcConfigs[index] = sanitizeNpcConfig(
            { ...getNpcConfigByIndex(index), power: Number(powerInput.value) },
            index,
          );
          scheduleNpcSync();
        });
        powerField.appendChild(powerInput);
        powerField.appendChild(powerValue);

        fields.append(
          nameField,
          archetypeField,
          difficultyField,
          aggressionField,
          precisionField,
          mobilityField,
          powerField,
        );

        const loadout = archetype?.loadout
          ? archetype.loadout
              .map(
                (spellId) => SPELLS.find((spell) => spell.id === spellId)?.name || spellId,
              )
              .join(", ")
          : "";
        const loadoutLine = document.createElement("div");
        loadoutLine.className = "npc-loadout";
        loadoutLine.textContent = `Loadout: ${loadout}`;

        card.append(header, fields, loadoutLine);
        npcConfigList.appendChild(card);
      });

      restoreNpcControlState(focusedControlState);
    } finally {
      suppressNpcNameBlurCommit = false;
    }
  }

  // Join room event
  joinBtn.addEventListener("click", () => {
    const roomIdInput = document.getElementById("roomId").value.trim();
    const nickname = document.getElementById("nickname").value.trim();

    const roomValidation = validateRoomId(roomIdInput);
    const nicknameValidation = validateNickname(nickname);

    let errorMessage = null;
    if (!roomValidation.ok) {
      errorMessage = getRoomIdErrorMessage(roomValidation);
    } else if (!nicknameValidation.ok) {
      errorMessage = getNicknameErrorMessage(nicknameValidation);
    }

    if (errorMessage) {
      showError(errorDiv, errorText, errorMessage);
      return;
    }

    hideError(errorDiv);

    // Set cookies
    setCookie("roomId", roomIdInput);
    setCookie("nickname", nickname);
    setCookie("id", socket.id);

    // Emit join-room event
    socket.emit("join-room", { roomId: roomIdInput, nickname }, (data) => {
      if (!data?.ok) {
        showError(errorDiv, errorText, data?.message || "Failed to join room");
        return;
      }

      hideError(errorDiv);
      activeRoomId = roomIdInput;
      currentRoomIdLabel.textContent = roomIdInput;

      // Transition to room view with animation
      lobby.style.animation = "cardDisappear 0.4s ease forwards";
      setTimeout(() => {
        lobby.style.display = "none";
        room.style.display = "block";
        room.style.animation = "cardAppear 0.6s ease forwards";
      }, 400);

      selfPlayerId = data.selfPlayerId;
      onRoomJoined(activeRoomId, selfPlayerId);
    });
  });

  // Player updates
  function updateLobbyState(payload) {
    const playersData = payload?.players || {};
    const host = payload?.host || null;

    players = playersData;
    hostId = host;
    selectedMapId = payload?.selectedMapId || selectedMapId;
    selectedSpellsByPlayerId = payload?.selectedSpellsByPlayerId || {};
    mode = payload?.mode === "single" || payload?.mode === "multi" ? payload.mode : mode;
    if (Array.isArray(payload?.npcConfigs)) {
      npcConfigs = payload.npcConfigs.map((config, index) =>
        sanitizeNpcConfig(config || {}, index),
      );
    }
    selfSelectedSpellIds = selectedSpellsByPlayerId[selfPlayerId] || [];
    playersList.innerHTML = "";
    const npcConfigMap = new Map();
    npcConfigs.forEach((config) => {
      if (config?.playerId) {
        npcConfigMap.set(config.playerId, config);
      }
    });

    for (const id in playersData) {
      const li = document.createElement("li");
      const isYou = id === selfPlayerId;
      const isHost = id === host;
      const isNpc = Boolean(playersData[id]?.isNpc);
      const npcConfig = npcConfigMap.get(id);

      // Add appropriate classes
      if (isYou && isHost) {
        li.classList.add("is-you", "is-host");
      } else if (isYou) {
        li.classList.add("is-you");
      } else if (isHost) {
        li.classList.add("is-host");
      }

      // Player name
      const nameSpan = document.createElement("span");
      nameSpan.className = "player-name";
      nameSpan.textContent = playersData[id].name;
      li.appendChild(nameSpan);

      // Tags
      if (isHost) {
        const hostTag = document.createElement("span");
        hostTag.className = "player-tag tag-host";
        hostTag.textContent = "Host";
        li.appendChild(hostTag);
      }

      if (isYou) {
        const youTag = document.createElement("span");
        youTag.className = "player-tag tag-you";
        youTag.textContent = "You";
        li.appendChild(youTag);
      }

      if (isNpc) {
        const npcTag = document.createElement("span");
        npcTag.className = "player-tag tag-ready";
        npcTag.textContent = "NPC";
        li.appendChild(npcTag);
        if (npcConfig) {
          const difficultyLabel =
            getNpcDifficultyById(npcConfig.difficulty)?.label || npcConfig.difficulty;
          const diffTag = document.createElement("span");
          diffTag.className = "player-tag tag-pending";
          diffTag.textContent = difficultyLabel;
          li.appendChild(diffTag);
        }
      }

      const loadoutTag = document.createElement("span");
      const selectedSpellIds = selectedSpellsByPlayerId[id] || [];
      const isLoadoutReady = hasValidLoadout(selectedSpellIds);
      loadoutTag.className = `player-tag ${isLoadoutReady ? "tag-ready" : "tag-pending"}`;
      loadoutTag.textContent = `Spells ${selectedSpellIds.length}/${REQUIRED_SPELL_LOADOUT_SIZE}`;
      li.appendChild(loadoutTag);

      playersList.appendChild(li);
    }

    renderMapSelection();
    syncSpellOptionSelection();
    renderSpellSelection();
    renderStartButtonState();
    renderModeControls();
    renderNpcConfigs();
  }

  socket.on("player-joined", (data) => {
    updateLobbyState(data);
  });

  socket.on("player-left", (data) => {
    updateLobbyState(data);
  });

  socket.on("lobby-updated", (data) => {
    updateLobbyState(data);
  });

  if (mapSelect) {
    mapSelect.addEventListener("change", () => {
      if (!activeRoomId) {
        return;
      }

      const nextMapId = mapSelect.value;
      socket.emit(
        "lobby:set-map",
        { roomId: activeRoomId, mapId: nextMapId },
        (response) => {
          if (!response?.ok) {
            showError(
              errorRoomDiv,
              errorRoomText,
              response?.message || "Failed to update map selection",
            );
            renderMapSelection();
            return;
          }

          hideError(errorRoomDiv);
        },
      );
    });
  }

  if (modeToggle) {
    modeToggle.addEventListener("click", (event) => {
      if (!activeRoomId) {
        return;
      }
      const button = event.target.closest(".mode-btn");
      if (!button) {
        return;
      }
      const nextMode = button.getAttribute("data-mode");
      if (!nextMode || nextMode === mode) {
        return;
      }

      socket.emit("lobby:set-mode", { roomId: activeRoomId, mode: nextMode }, (response) => {
        if (!response?.ok) {
          showError(
            errorRoomDiv,
            errorRoomText,
            response?.message || "Failed to update match mode",
          );
          renderModeControls();
          return;
        }
        hideError(errorRoomDiv);
      });
    });
  }

  if (npcCountSelect) {
    npcCountSelect.addEventListener("change", () => {
      if (!activeRoomId || mode !== "single") {
        return;
      }
      const nextCount = Number(npcCountSelect.value);
      if (!Number.isFinite(nextCount)) {
        return;
      }

      const safeCount = Math.max(
        NPC_COUNT_LIMITS.min,
        Math.min(NPC_COUNT_LIMITS.max, nextCount),
      );
      const nextConfigs = npcConfigs.slice(0, safeCount);
      if (nextConfigs.length < safeCount) {
        const defaults = createDefaultNpcConfigs(safeCount);
        for (let index = nextConfigs.length; index < safeCount; index += 1) {
          nextConfigs.push(defaults[index]);
        }
      }
      npcConfigs = nextConfigs.map((config, index) => sanitizeNpcConfig(config, index));
      renderNpcConfigs();
      scheduleNpcSync();
    });
  }

  if (spellOptions) {
    spellOptions.addEventListener("change", (event) => {
      if (suppressSpellOptionEvents || !activeRoomId) {
        return;
      }

      const changedElement = event.target;
      if (!(changedElement instanceof HTMLInputElement)) {
        return;
      }

      const checkedSpellIds = Array.from(
        spellOptions.querySelectorAll("input[type='checkbox']:checked"),
      ).map((checkboxElement) => checkboxElement.value);

      if (checkedSpellIds.length > REQUIRED_SPELL_LOADOUT_SIZE) {
        changedElement.checked = false;
        showError(
          errorRoomDiv,
          errorRoomText,
          `You can only select ${REQUIRED_SPELL_LOADOUT_SIZE} spells`,
        );
        return;
      }
      hideError(errorRoomDiv);

      selfSelectedSpellIds = checkedSpellIds;
      renderSpellSelection();

      if (checkedSpellIds.length !== REQUIRED_SPELL_LOADOUT_SIZE) {
        return;
      }

      socket.emit(
        "lobby:set-spells",
        { roomId: activeRoomId, spellIds: checkedSpellIds },
        (response) => {
          if (!response?.ok) {
            showError(
              errorRoomDiv,
              errorRoomText,
              response?.message || "Failed to update spell selection",
            );
            syncSpellOptionSelection();
            renderSpellSelection();
            renderStartButtonState();
            return;
          }

          hideError(errorRoomDiv);
          selectedSpellsByPlayerId = {
            ...selectedSpellsByPlayerId,
            [selfPlayerId]: [...checkedSpellIds],
          };
          renderStartButtonState();
        },
      );
    });
  }

  renderMapSelection();
  renderSpellSelection();
  renderStartButtonState();
  renderModeControls();
  renderNpcConfigs();

  // Start game
  startBtn.addEventListener("click", () => {
    socket.emit("start-game", activeRoomId, (data) => {
      if (data?.message) {
        showError(errorRoomDiv, errorRoomText, data.message);
        return;
      }
    });
  });

  socket.on("game-started", (data) => {
    hideError(errorRoomDiv);

    bgLayerContainers.forEach((container) => {
      container.remove();
    });
    runes?.remove();
    mainContainer?.remove();
    onGameStarted(data, activeRoomId);
  });

  return {
    getCurrentRoomId: () => activeRoomId,
    getPlayers: () => players,
    getHostId: () => hostId,
    getSelectedMapId: () => selectedMapId,
    getSelectedSpellsByPlayerId: () => selectedSpellsByPlayerId,
  };
}
