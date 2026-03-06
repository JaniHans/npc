import { randomUUID } from "crypto";
import { startRoomLoop, stopRoomLoop } from "../game-session/loop.js";
import { onTick } from "./simulate-tick.js";
import {
  createInitialCombatState,
  getSpellById,
  REQUIRED_SPELL_LOADOUT_SIZE,
} from "../../../shared/spells.js";
import { hitbox } from "../../../shared/constants.js";
import { DEFAULT_MAP_ID, getDefaultMap, getMapById } from "../../../shared/map.js";
import {
  NPC_COUNT_LIMITS,
  createDefaultNpcConfigs,
  getNpcArchetypeById,
  sanitizeNpcConfig,
} from "../../../shared/npc.js";
import { buildNpcProfile } from "./npc.js";

const MAX_PLAYERS = 4;
const MIN_PLAYERS_TO_START = 2;
const PLAYER_INITIAL_LIVES = 3;
const GAME_DURATION_MS = 5 * 60 * 1000;
const LOG_PREFIX = "[session-manager]";

function logInfo(message) {
  console.log(`${LOG_PREFIX} ${message}`);
}

function hasValidSpellLoadout(spellIds) {
  if (!Array.isArray(spellIds) || spellIds.length !== REQUIRED_SPELL_LOADOUT_SIZE) {
    return false;
  }

  const uniqueSpellIds = new Set(spellIds);
  if (uniqueSpellIds.size !== REQUIRED_SPELL_LOADOUT_SIZE) {
    return false;
  }

  return spellIds.every((spellId) => typeof spellId === "string" && Boolean(getSpellById(spellId)));
}

function getDeterministicPlayerOrder(playerIds) {
  return [...playerIds].sort((a, b) => a.localeCompare(b));
}

function getSpawnOriginFromPoint(spawnPoint) {
  const centerOffsetX = hitbox.offsetX + hitbox.width / 2;
  const centerOffsetY = hitbox.offsetY + hitbox.height / 2;

  return {
    x: spawnPoint.x - centerOffsetX,
    y: spawnPoint.y - centerOffsetY,
  };
}

function createInitialTileEffectState() {
  return {
    activeSlowMultiplier: 1,
    lastDamageAtMsByEffectId: {},
    teleportCooldownUntilMsByEffectId: {},
    teleportGlobalCooldownUntilMs: 0,
  };
}

class Session {
  constructor(roomId) {
    this.roomId = roomId;
    this.host = null;
    this.status = "waiting";
    this.createdAt = Date.now();
    this.players = {};
    this.skinByPlayerId = new Map();
    this.tickHandle = null;
    this.playerIdBySocketId = new Map();
    this.selectedMapId = DEFAULT_MAP_ID;
    this.selectedSpellsByPlayerId = {};
    this.mode = "multi";
    this.npcConfigs = [];
    this.npcPlayerIds = new Set();
    this.gameStartTimeMs = null;
    this.gameDurationMs = GAME_DURATION_MS;

    this.gameState = {
      tickCounter: 0,
      snapshotId: null,
      players: {},
      projectiles: [],
      map: getDefaultMap(),
      mapId: DEFAULT_MAP_ID,
      matchEnded: false,
      matchResult: null,
      paused: false,
      pausedById: null,
      pausedAtMs: null,
      pauseTotalMs: 0,
    };
  }

  assignSkinForPlayer(playerId) {
    const usedSkinIndexes = new Set(this.skinByPlayerId.values());
    let nextSkinIndex = 0;
    while (usedSkinIndexes.has(nextSkinIndex) && nextSkinIndex < MAX_PLAYERS) {
      nextSkinIndex++;
    }
    this.skinByPlayerId.set(playerId, nextSkinIndex % MAX_PLAYERS);
  }

  getSkinMap() {
    return Object.fromEntries(this.skinByPlayerId.entries());
  }

  playerCount() {
    return Object.keys(this.players).length;
  }

  hasPlayer(playerId) {
    return Boolean(this.players[playerId]);
  }

  getHumanPlayerIds() {
    return Object.entries(this.players)
      .filter(([, player]) => !player?.isNpc)
      .map(([playerId]) => playerId);
  }

  humanCount() {
    return this.getHumanPlayerIds().length;
  }

  hasNickname(nickname) {
    return Object.values(this.players).some(
      (player) => player.name === nickname,
    );
  }

  hasNicknameForOtherPlayers(nickname, excludePlayerId) {
    return Object.entries(this.players).some(
      ([playerId, player]) =>
        playerId !== excludePlayerId && player?.name === nickname,
    );
  }

  isFull() {
    return this.playerCount() >= MAX_PLAYERS;
  }

  isEmpty() {
    return this.playerCount() === 0;
  }

  addPlayer(socketId, playerData) {
    if (this.hasPlayerBySocketId(socketId)) {
      throw new Error(`Player with socketId ${socketId} already exists`);
    }
    if (this.isFull()) {
      throw new Error(`Room ${this.roomId} is full`);
    }
    if (this.hasNickname(playerData.name)) {
      throw new Error(`Player name ${playerData.name} already exists`);
    }
    const playerId = randomUUID();

    this.playerIdBySocketId.set(socketId, playerId);
    this.players[playerId] = { ...playerData, isNpc: false };
    this.selectedSpellsByPlayerId[playerId] = [];
    this.ensureValidHost();

    return playerId;
  }

  getSkinByPlayerId(playerId) {
    return this.skinByPlayerId.get(playerId);
  }

  getPlayerBySocketId(socketId) {
    const playerId = this.getPlayerIdBySocketId(socketId);
    if (!playerId) {
      return null;
    }
    return this.players[playerId] || null;
  }

  getPlayerIdBySocketId(socketId) {
    return this.playerIdBySocketId.get(socketId) || null;
  }

  hasPlayerBySocketId(socketId) {
    return this.playerIdBySocketId.has(socketId);
  }

  removePlayerBySocketId(socketId) {
    const playerId = this.getPlayerIdBySocketId(socketId);
    if (!playerId) {
      return null;
    }
    this.playerIdBySocketId.delete(socketId);
    return this.removePlayer(playerId);
  }

  removePlayer(playerId) {
    if (!this.hasPlayer(playerId)) {
      return null;
    }

    const removedPlayer = this.players[playerId];
    delete this.players[playerId];
    delete this.selectedSpellsByPlayerId[playerId];
    this.npcPlayerIds.delete(playerId);
    this.skinByPlayerId.delete(playerId);
    for (const [socketId, id] of this.playerIdBySocketId.entries()) {
      if (id === playerId) {
        this.playerIdBySocketId.delete(socketId);
        break;
      }
    }
    this.ensureValidHost();
    return removedPlayer;
  }

  ensureValidHost() {
    const playerIds = Object.keys(this.players);
    if (playerIds.length === 0) {
      this.host = null;
      return;
    }
    if (!this.host || !this.players[this.host]) {
      this.host = playerIds[0];
    }
  }

  canStart() {
    const count = this.playerCount();
    if (count < MIN_PLAYERS_TO_START || count > MAX_PLAYERS) {
      return false;
    }
    if (this.humanCount() < 1) {
      return false;
    }

    return Object.keys(this.players).every((playerId) =>
      hasValidSpellLoadout(this.selectedSpellsByPlayerId[playerId]),
    );
  }

  toLobbyPayload() {
    const selectedSpellsByPlayerId = Object.fromEntries(
      Object.entries(this.selectedSpellsByPlayerId).map(([playerId, spellIds]) => [
        playerId,
        Array.isArray(spellIds) ? [...spellIds] : [],
      ]),
    );

    return {
      players: this.players,
      host: this.host,
      skinMap: this.getSkinMap(),
      selectedMapId: this.selectedMapId,
      selectedSpellsByPlayerId,
      mode: this.mode,
      npcConfigs: this.npcConfigs.map((config) => ({ ...config })),
    };
  }

  setMode(nextMode) {
    if (nextMode !== "single" && nextMode !== "multi") {
      throw new Error(`Invalid mode ${nextMode}`);
    }
    if (this.mode === nextMode) {
      return false;
    }
    this.mode = nextMode;
    if (nextMode === "multi") {
      this.clearNpcPlayers();
      this.npcConfigs = [];
    } else if (nextMode === "single" && this.npcConfigs.length === 0) {
      this.npcConfigs = createDefaultNpcConfigs(NPC_COUNT_LIMITS.min);
      this.syncNpcPlayers();
    }
    return true;
  }

  clearNpcPlayers() {
    for (const npcId of Array.from(this.npcPlayerIds)) {
      delete this.players[npcId];
      delete this.selectedSpellsByPlayerId[npcId];
      this.skinByPlayerId.delete(npcId);
      this.npcPlayerIds.delete(npcId);
    }
  }

  setNpcConfigs(configs) {
    const normalized = Array.isArray(configs) ? configs : [];
    const safeCount = Math.max(
      NPC_COUNT_LIMITS.min,
      Math.min(NPC_COUNT_LIMITS.max, normalized.length),
    );
    const nextConfigs = [];
    for (let index = 0; index < safeCount; index += 1) {
      const sanitized = sanitizeNpcConfig(normalized[index] || {}, index);
      nextConfigs.push(sanitized);
    }

    this.npcConfigs = nextConfigs;
    this.syncNpcPlayers();
  }

  syncNpcPlayers() {
    const desiredIds = new Set();
    for (let index = 0; index < this.npcConfigs.length; index += 1) {
      const config = this.npcConfigs[index];
      const existingId =
        typeof config.playerId === "string" && this.players[config.playerId]
          ? config.playerId
          : null;
      const resolvedId = existingId || randomUUID();

      const archetype = getNpcArchetypeById(config.archetypeId);
      const resolvedName = this.resolveUniqueNpcName(config.name, index, existingId);
      config.playerId = resolvedId;
      config.name = resolvedName;

      if (!existingId) {
        this.assignSkinForPlayer(resolvedId);
      }

      this.players[resolvedId] = {
        name: resolvedName,
        isNpc: true,
        npcConfig: { ...config },
      };
      const loadout = getNpcArchetypeById(config.archetypeId).loadout;
      this.selectedSpellsByPlayerId[resolvedId] = loadout.slice(0, REQUIRED_SPELL_LOADOUT_SIZE);
      this.npcPlayerIds.add(resolvedId);
      desiredIds.add(resolvedId);
    }

    for (const npcId of Array.from(this.npcPlayerIds)) {
      if (desiredIds.has(npcId)) {
        continue;
      }
      delete this.players[npcId];
      delete this.selectedSpellsByPlayerId[npcId];
      this.skinByPlayerId.delete(npcId);
      this.npcPlayerIds.delete(npcId);
    }
  }

  resolveUniqueNpcName(rawName, fallbackIndex, excludePlayerId = null) {
    const baseName = typeof rawName === "string" && rawName.trim()
      ? rawName.trim()
      : `NPC ${fallbackIndex + 1}`;
    let candidate = baseName;
    let suffix = 2;
    while (this.hasNicknameForOtherPlayers(candidate, excludePlayerId)) {
      candidate = `${baseName} ${suffix}`;
      if (candidate.length > 15) {
        candidate = candidate.slice(0, 15);
      }
      suffix += 1;
    }
    return candidate;
  }
}

class SessionManager {
  constructor() {
    this.sessionsByRoomId = new Map();
    this.roomIdBySocketId = new Map();
  }

  startGame(roomId, options = {}) {
    const emitSnapshot =
      typeof options.emitSnapshot === "function"
        ? options.emitSnapshot
        : () => {};
    const emitGameEnded =
      typeof options.emitGameEnded === "function"
        ? options.emitGameEnded
        : () => {};

    const session = this.sessionsByRoomId.get(roomId);
    if (!session) throw new Error(`Room ${roomId} does not exist`);
    if (session.status !== "running")
      throw new Error(`Room ${roomId} is not running`);

    stopRoomLoop(session);
    const selectedMap =
      getMapById(session.selectedMapId) || getMapById(DEFAULT_MAP_ID) || getDefaultMap();
    if (!selectedMap) {
      throw new Error(`No map found for room ${roomId}`);
    }
    session.selectedMapId = selectedMap.id;
    const spawnPoints = Array.isArray(selectedMap.spawnPoints)
      ? selectedMap.spawnPoints
      : [];
    const playerIds = getDeterministicPlayerOrder(Object.keys(session.players));
    if (spawnPoints.length < playerIds.length) {
      throw new Error(
        `Map ${selectedMap.id} has insufficient spawn points for ${playerIds.length} players`,
      );
    }

    const nowMs = Date.now();
    session.gameStartTimeMs = nowMs;
    session.gameDurationMs =
      Number.isFinite(session.gameDurationMs) && session.gameDurationMs > 0
        ? session.gameDurationMs
        : GAME_DURATION_MS;
    const playersState = Object.fromEntries(
      playerIds.map((playerId, index) => {
        const spawnPoint = spawnPoints[index];
        const spawnOrigin = getSpawnOriginFromPoint(spawnPoint);
        const selectedSpellIds = session.selectedSpellsByPlayerId[playerId] || [];
        const lobbyPlayer = session.players[playerId] || {};
        const npcProfile = lobbyPlayer.isNpc
          ? buildNpcProfile(lobbyPlayer.npcConfig || {})
          : null;

        return [
          playerId,
          {
            x: spawnOrigin.x,
            y: spawnOrigin.y,
            aimX: spawnOrigin.x + 1,
            aimY: spawnOrigin.y,

            // last "applied" input state, used if there are gaps
            lastKeyState: { up: false, down: false, left: false, right: false },
            health: 100,
            livesRemaining: PLAYER_INITIAL_LIVES,
            isGhost: false,
            respawnAtMs: null,
            lastInputSeqReceived: 0,
            lastProcessedInputSeq: 0,
            skin: session.getSkinByPlayerId(playerId),
            selectedSpellIds: [...selectedSpellIds],
            spawnPointId: spawnPoint?.id || null,
            spawnPointIndex: index,
            isNpc: Boolean(lobbyPlayer.isNpc),
            npcProfile,

            lastDashRequestId: 0,
            lastDashAtMs: -Infinity,
            pendingDash: false,
            combat: createInitialCombatState(nowMs),
            tileEffectState: createInitialTileEffectState(),

            // unprocessed inputs received from network
            inputQueue: [], // array of { inputSeq, keys, actions, clientTimeMs } kept sorted by inputSeq
          },
        ];
      }),
    );

    session.gameState = {
      tickCounter: 0,
      snapshotId: null,
      players: playersState,
      projectiles: [],
      map: selectedMap,
      mapId: selectedMap.id,
      matchEnded: false,
      matchResult: null,
      paused: false,
      pausedById: null,
      pausedAtMs: null,
      pauseTotalMs: 0,
    };

    const endGame = (result) => {
      if (session.status !== "running") {
        return;
      }
      this.endGame(roomId, result);
      emitGameEnded(result);
    };

    startRoomLoop(session, (currentSession) => {
      onTick(currentSession, emitSnapshot, endGame);
    });
    logInfo(
      `initialized game state roomId=${roomId} with ${session.playerCount()} players`,
    );
    return session;
  }

  updateInput(playerId, inputSeq, keys, actions, clientTimeMs) {
    if (
      playerId == null ||
      inputSeq == null ||
      keys == null ||
      clientTimeMs == null
    ) {
      return false;
    }

    const roomId = this.getRoomIdByPlayerId(playerId);
    if (!roomId) {
      return false;
    }

    const session = this.getSession(roomId);
    if (!session) {
      return false;
    }

    const playerState = session.gameState?.players?.[playerId];
    if (!playerState || !Array.isArray(playerState.inputQueue)) {
      return false;
    }

    const queue = playerState.inputQueue;
    const lastQueuedSeq =
      queue.length > 0 ? queue[queue.length - 1].inputSeq : -Infinity;

    const highestKnownSeq = Math.max(
      playerState.lastInputSeqReceived,
      lastQueuedSeq,
    );

    if (inputSeq <= highestKnownSeq) {
      return false;
    }

    playerState.inputQueue.push({
      inputSeq,
      keys,
      actions,
      clientTimeMs,
    });
    playerState.inputQueue = playerState.inputQueue.slice(-16); //keep last 16 inputs only
    return true;
  }

  updateAim(playerId, aimX, aimY) {
    if (
      playerId == null ||
      !Number.isFinite(aimX) ||
      !Number.isFinite(aimY)
    ) {
      return false;
    }

    const roomId = this.getRoomIdByPlayerId(playerId);
    if (!roomId) {
      return false;
    }

    const session = this.getSession(roomId);
    if (!session) {
      return false;
    }

    const playerState = session.gameState?.players?.[playerId];
    if (!playerState) {
      return false;
    }

    playerState.aimX = aimX;
    playerState.aimY = aimY;
    return true;
  }

  createSession(roomId) {
    if (this.sessionsByRoomId.has(roomId)) {
      throw new Error(`Room ${roomId} already has a session`);
    }

    const session = new Session(roomId);
    this.sessionsByRoomId.set(roomId, session);
    logInfo(`created roomId=${roomId}`);
    return session;
  }

  getSession(roomId) {
    return this.sessionsByRoomId.get(roomId);
  }

  getOrCreateSession(roomId) {
    return this.getSession(roomId) || this.createSession(roomId);
  }

  getRoomIdBySocket(socketId) {
    return this.roomIdBySocketId.get(socketId);
  }

  getSessionBySocket(socketId) {
    const roomId = this.getRoomIdBySocket(socketId);
    if (!roomId) {
      return null;
    }
    return this.getSession(roomId) || null;
  }

  setSelectedMapForRoom(roomId, requestedByPlayerId, mapId) {
    const session = this.getSession(roomId);
    if (!session) {
      throw new Error(`Room ${roomId} does not exist`);
    }
    if (session.host !== requestedByPlayerId) {
      throw new Error(`Player ${requestedByPlayerId} is not host of room ${roomId}`);
    }

    const selectedMap = getMapById(mapId);
    if (!selectedMap) {
      throw new Error(`Map ${mapId} does not exist`);
    }

    session.selectedMapId = selectedMap.id;
    return session.selectedMapId;
  }

  setSelectedSpellsForRoom(roomId, requestedByPlayerId, spellIds) {
    const session = this.getSession(roomId);
    if (!session) {
      throw new Error(`Room ${roomId} does not exist`);
    }
    if (session.status !== "waiting") {
      throw new Error(`Room ${roomId} is not waiting`);
    }
    if (!session.hasPlayer(requestedByPlayerId)) {
      throw new Error(`Player ${requestedByPlayerId} is not in room ${roomId}`);
    }
    if (!hasValidSpellLoadout(spellIds)) {
      throw new Error(`Invalid spell loadout for player ${requestedByPlayerId}`);
    }

    session.selectedSpellsByPlayerId[requestedByPlayerId] = [...spellIds];
    return session.selectedSpellsByPlayerId[requestedByPlayerId];
  }

  joinRoom(roomId, socketId, playerData) {
    const existingRoomId = this.getRoomIdBySocket(socketId);
    if (existingRoomId && existingRoomId !== roomId) {
      throw new Error(`Socket ${socketId} already in room ${existingRoomId}`);
    }

    const session = this.getOrCreateSession(roomId);
    const playerId = session.addPlayer(socketId, playerData);
    this.roomIdBySocketId.set(socketId, roomId);
    return playerId;
  }

  getPlayerIdBySocketId(socketId) {
    const session = this.getSessionBySocket(socketId);
    if (!session) {
      return null;
    }
    return session.getPlayerIdBySocketId(socketId);
  }

  getPlayerBySocketId(socketId) {
    const session = this.getSessionBySocket(socketId);
    if (!session) {
      return null;
    }
    return session.getPlayerBySocketId(socketId);
  }

  getRoomIdByPlayerId(playerId) {
    for (const [roomId, session] of this.sessionsByRoomId.entries()) {
      if (session.hasPlayer(playerId)) {
        return roomId;
      }
    }
    return null;
  }

  leaveRoomBySocket(socketId) {
    const roomId = this.getRoomIdBySocket(socketId);
    if (!roomId) {
      return null;
    }

    const session = this.getSession(roomId);
    this.roomIdBySocketId.delete(socketId);

    if (!session) {
      return {
        roomId,
        session: null,
        removedPlayer: null,
        removedRoom: false,
      };
    }

    const removedPlayer = session.removePlayerBySocketId(socketId);

    const removedRoom = this.removeSessionIfEmpty(roomId);
    return {
      roomId,
      session: removedRoom ? null : session,
      removedPlayer,
      removedRoom,
    };
  }

  removeSessionIfEmpty(roomId) {
    const session = this.getSession(roomId);
    if (!session) {
      return false;
    }
    if (session.humanCount() > 0) {
      return false;
    }
    stopRoomLoop(session);
    return this.removeSession(roomId);
  }

  removeSession(roomId) {
    const session = this.getSession(roomId);
    if (!session) {
      return false;
    }

    for (const socketId of session.playerIdBySocketId.keys()) {
      this.roomIdBySocketId.delete(socketId);
    }

    this.sessionsByRoomId.delete(roomId);
    stopRoomLoop(session);
    logInfo(`removed roomId=${roomId}`);
    return true;
  }

  markRoomRunning(roomId) {
    const session = this.getSession(roomId);
    if (!session) {
      throw new Error(`Room ${roomId} does not exist`);
    }
    if (session.status === "running") {
      return false;
    }
    session.status = "running";
    return true;
  }

  endGame(roomId, result = null) {
    const session = this.getSession(roomId);
    if (!session || session.status !== "running") {
      return null;
    }

    stopRoomLoop(session);
    session.status = "waiting";
    session.gameStartTimeMs = null;
    session.gameState.matchEnded = true;
    session.gameState.matchResult = result;
    session.gameState.projectiles = [];
    session.gameState.snapshotId = null;
    session.gameState.tickCounter = 0;
    session.gameState.paused = false;
    session.gameState.pausedById = null;
    session.gameState.pausedAtMs = null;
    session.gameState.pauseTotalMs = 0;
    return session;
  }

  pauseGame(roomId, requestedByPlayerId) {
    const session = this.getSession(roomId);
    if (!session || session.status !== "running") {
      return { ok: false, reason: "not-running" };
    }
    if (session.gameState.paused) {
      const pausedById = session.gameState.pausedById;
      return {
        ok: false,
        reason: "already-paused",
        pausedById,
        pausedByName: pausedById ? session.players[pausedById]?.name || null : null,
      };
    }

    session.gameState.paused = true;
    session.gameState.pausedById = requestedByPlayerId || null;
    session.gameState.pausedAtMs = Date.now();
    for (const playerState of Object.values(session.gameState.players || {})) {
      if (playerState?.inputQueue) {
        playerState.inputQueue.length = 0;
      }
      if (playerState) {
        playerState.pendingDash = false;
      }
    }
    return {
      ok: true,
      pausedById: session.gameState.pausedById,
      pausedByName: session.gameState.pausedById
        ? session.players[session.gameState.pausedById]?.name || null
        : null,
    };
  }

  resumeGame(roomId, requestedByPlayerId) {
    const session = this.getSession(roomId);
    if (!session || session.status !== "running") {
      return { ok: false, reason: "not-running" };
    }
    if (!session.gameState.paused) {
      return { ok: false, reason: "not-paused" };
    }

    const pausedAtMs = Number(session.gameState.pausedAtMs);
    if (Number.isFinite(pausedAtMs)) {
      session.gameState.pauseTotalMs += Math.max(0, Date.now() - pausedAtMs);
    }
    session.gameState.paused = false;
    session.gameState.pausedById = null;
    session.gameState.pausedAtMs = null;
    return {
      ok: true,
      resumedById: requestedByPlayerId || null,
      resumedByName: requestedByPlayerId ? session.players[requestedByPlayerId]?.name || null : null,
    };
  }
}

export const sessionManager = new SessionManager();
