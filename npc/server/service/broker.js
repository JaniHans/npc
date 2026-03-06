import { validateNickname, validateRoomId } from "../../shared/validation.js";
import { sessionManager } from "./game-session/session-manager.js";
import { hitbox } from "../../shared/constants.js";
import {
  SPELL_CAST_REJECTION,
  REQUIRED_SPELL_LOADOUT_SIZE,
  applySpellCastCosts,
  createSpellProjectile,
  getPlayerCastOrigin,
  getSpellById,
  incrementActiveCastCount,
  queuePendingSpellCast,
  regeneratePlayerMana,
  validateSpellCast,
} from "../../shared/spells.js";
import { randomUUID } from "crypto";

const LOG_PREFIX = "[broker]";

const ROOM_ID_ERROR_MESSAGE_BY_REASON = {
  required: "Room and nickname are required",
  length: "Room id must be 3-20 letters or numbers",
  format: "Room id must be 3-20 letters or numbers",
};

const NICKNAME_ERROR_MESSAGE_BY_REASON = {
  required: "Room and nickname are required",
  length: "Nickname must be 2-15 characters (letters, numbers, spaces)",
  format: "Nickname must be 2-15 characters (letters, numbers, spaces)",
};

function logInfo(message) {
  console.log(`${LOG_PREFIX} ${message}`);
}

function logError(message, error) {
  if (error) {
    console.error(`${LOG_PREFIX} ${message}`, error);
    return;
  }
  console.error(`${LOG_PREFIX} ${message}`);
}

function safeCallback(callback, payload) {
  if (typeof callback === "function") {
    callback(payload);
  }
}

function rejectSpellCast(socket, callback, payload) {
  const rejectionPayload = {
    accepted: false,
    ...payload,
  };
  safeCallback(callback, rejectionPayload);
  if (typeof callback !== "function") {
    socket.emit("spell:cast:rejected", rejectionPayload);
  }
}

function createPlayerData(nickname) {
  return {
    name: nickname,
    health: 100,
    damage: 2,
    level: 0,
    inventory: [],
  };
}

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidInputKeys(keys) {
  return (
    keys &&
    typeof keys.left === "boolean" &&
    typeof keys.right === "boolean" &&
    typeof keys.up === "boolean" &&
    typeof keys.down === "boolean"
  );
}

function isValidInputActions(actions) {
  if (actions == null) {
    return true;
  }
  if (typeof actions !== "object") {
    return false;
  }
  if (actions.dashRequestId == null) {
    return true;
  }

  const dashRequestId = Number(actions.dashRequestId);
  return Number.isFinite(dashRequestId) && dashRequestId > 0;
}

function isValidAimPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  return Number.isFinite(payload.aimX) && Number.isFinite(payload.aimY);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeSpellLoadout(spellIds) {
  if (!Array.isArray(spellIds)) {
    return [];
  }

  return spellIds
    .map((spellId) => asTrimmedString(spellId))
    .filter((spellId) => spellId.length > 0);
}

function hasValidSpellLoadout(spellIds) {
  if (!Array.isArray(spellIds) || spellIds.length !== REQUIRED_SPELL_LOADOUT_SIZE) {
    return false;
  }

  const uniqueSpellIds = new Set(spellIds);
  if (uniqueSpellIds.size !== REQUIRED_SPELL_LOADOUT_SIZE) {
    return false;
  }

  return spellIds.every((spellId) => Boolean(getSpellById(spellId)));
}

export default function broker(io) {
  io.on("connection", (socket) => {
    logInfo(`connected socketId=${socket.id}`);

    socket.on("join-room", (data, callback) => {
      const roomId = asTrimmedString(data?.roomId);
      const nickname = asTrimmedString(data?.nickname);

      const roomValidation = validateRoomId(roomId);
      if (!roomValidation.ok) {
        safeCallback(callback, {
          invalidRoomId: true,
          message: ROOM_ID_ERROR_MESSAGE_BY_REASON[roomValidation.reason],
        });
        return;
      }

      const nicknameValidation = validateNickname(nickname);
      if (!nicknameValidation.ok) {
        safeCallback(callback, {
          invalidNickname: true,
          message: NICKNAME_ERROR_MESSAGE_BY_REASON[nicknameValidation.reason],
        });
        return;
      }

      try {
        const session = sessionManager.getOrCreateSession(roomId);
        if (session.mode === "single" && session.humanCount() >= 1) {
          safeCallback(callback, {
            singlePlayerLocked: true,
            message: "Room is locked in single-player mode",
          });
          return;
        }
        if (session.status === "running") {
          safeCallback(callback, {
            gameAlreadyRunning: true,
            message: "Cannot join: game is already running in this room",
          });
          return;
        }
        if (session.isFull()) {
          safeCallback(callback, {
            fullRoom: true,
            message: "Room already has maximum players. Choose another room",
          });
          return;
        }
        if (session.hasNickname(nickname)) {
          safeCallback(callback, {
            nameExists: true,
            message: `${nickname} already exists. Choose another one`,
          });
          return;
        }

        const selfPlayerId = sessionManager.joinRoom(
          roomId,
          socket.id,
          createPlayerData(nickname),
        );
        session.assignSkinForPlayer(selfPlayerId);
        const skinIndex = session.getSkinByPlayerId(selfPlayerId);
        socket.join(roomId);

        safeCallback(callback, { ok: true, selfPlayerId, skinIndex });
        io.to(roomId).emit("player-joined", session.toLobbyPayload());

        logInfo(
          `joined roomId=${roomId} playerId=${selfPlayerId} socketId=${socket.id} nickname="${nickname}" skin=${skinIndex}`,
        );
      } catch (error) {
        logError(
          `join-room failed socketId=${socket.id} roomId=${roomId}`,
          error,
        );
        safeCallback(callback, {
          joinFailed: true,
          message: "Failed to join room",
        });
      }
    });

    socket.on("chat-message", (data) => {
      const roomId = asTrimmedString(data?.roomId);
      const message = asTrimmedString(data?.message);
      const session = sessionManager.getSession(roomId);
      const playerId = sessionManager.getPlayerIdBySocketId(socket.id);
      if (!session || !playerId || !session.hasPlayer(playerId) || !message) {
        return;
      }

      const sender = session.players[playerId];
      io.to(roomId).emit("chat-message", {
        roomId,
        message,
        senderName: sender.name,
      });
    });

    socket.on("start-game", (roomId, callback) => {
      const safeRoomId = asTrimmedString(roomId);
      const session = sessionManager.getSession(safeRoomId);
      const playerId = sessionManager.getPlayerIdBySocketId(socket.id);
      if (!session) {
        safeCallback(callback, {
          roomDoesNotExist: true,
          message: "Room does not exist",
        });
        return;
      }
      if (session.host !== playerId) {
        safeCallback(callback, {
          notHost: true,
          message: "Only room host can start the game",
        });
        return;
      }
      if (!session.canStart()) {
        const playerCount = session.playerCount();
        const hasRequiredPlayerCount = playerCount >= 2;
        safeCallback(callback, {
          notEnoughPlayers: !hasRequiredPlayerCount,
          invalidLoadouts: hasRequiredPlayerCount,
          message: hasRequiredPlayerCount
            ? "All players must select exactly 3 unique spells before starting"
            : "You can only start the game with 2 or more players",
        });
        return;
      }
      if (session.status === "running") {
        safeCallback(callback, {
          gameAlreadyRunning: true,
          message: "Game is already running in this room",
        });
        return;
      }

      sessionManager.markRoomRunning(safeRoomId);

      sessionManager.startGame(safeRoomId, {
        emitSnapshot: (snapshot) => {
          io.to(safeRoomId).emit("snapshot", snapshot);
        },
        emitGameEnded: (result) => {
          io.to(safeRoomId).emit("game-ended", result);
          io.to(safeRoomId).emit("lobby-updated", session.toLobbyPayload());
        },
      });

      io.to(safeRoomId).emit("game-started", {
        players: session.players,
        phase: session.status,
        mapId: session.gameState?.mapId || session.selectedMapId,
        selectedSpellsByPlayerId: session.toLobbyPayload().selectedSpellsByPlayerId,
      });
      logInfo(`started roomId=${safeRoomId}`);
    });

    socket.on("lobby:set-map", (data, callback) => {
      const roomId = asTrimmedString(data?.roomId);
      const mapId = asTrimmedString(data?.mapId);
      const session = sessionManager.getSession(roomId);
      const playerId = sessionManager.getPlayerIdBySocketId(socket.id);

      if (!isNonEmptyString(roomId) || !session) {
        safeCallback(callback, {
          roomDoesNotExist: true,
          message: "Room does not exist",
        });
        return;
      }
      if (!playerId || !session.hasPlayer(playerId)) {
        safeCallback(callback, {
          notInRoom: true,
          message: "Player is not part of this room",
        });
        return;
      }
      if (session.status !== "waiting") {
        safeCallback(callback, {
          invalidState: true,
          message: "Map can only be changed before the game starts",
        });
        return;
      }
      if (!isNonEmptyString(mapId)) {
        safeCallback(callback, {
          invalidMapId: true,
          message: "Map id is required",
        });
        return;
      }

      try {
        sessionManager.setSelectedMapForRoom(roomId, playerId, mapId);
        io.to(roomId).emit("lobby-updated", session.toLobbyPayload());
        safeCallback(callback, { ok: true, selectedMapId: session.selectedMapId });
      } catch (error) {
        safeCallback(callback, {
          mapSelectionRejected: true,
          message: "Only the host can select a valid map",
        });
      }
    });

    socket.on("lobby:set-mode", (data, callback) => {
      const roomId = asTrimmedString(data?.roomId);
      const mode = asTrimmedString(data?.mode);
      const session = sessionManager.getSession(roomId);
      const playerId = sessionManager.getPlayerIdBySocketId(socket.id);

      if (!isNonEmptyString(roomId) || !session) {
        safeCallback(callback, {
          roomDoesNotExist: true,
          message: "Room does not exist",
        });
        return;
      }
      if (!playerId || !session.hasPlayer(playerId)) {
        safeCallback(callback, {
          notInRoom: true,
          message: "Player is not part of this room",
        });
        return;
      }
      if (session.host !== playerId) {
        safeCallback(callback, {
          notHost: true,
          message: "Only the host can change the match mode",
        });
        return;
      }
      if (session.status !== "waiting") {
        safeCallback(callback, {
          invalidState: true,
          message: "Mode can only be changed before the game starts",
        });
        return;
      }
      if (mode !== "single" && mode !== "multi") {
        safeCallback(callback, {
          invalidMode: true,
          message: "Mode must be single or multi",
        });
        return;
      }
      if (mode === "single" && session.humanCount() > 1) {
        safeCallback(callback, {
          tooManyHumans: true,
          message: "Remove other players before switching to single-player",
        });
        return;
      }

      try {
        session.setMode(mode);
        io.to(roomId).emit("lobby-updated", session.toLobbyPayload());
        safeCallback(callback, { ok: true, mode: session.mode });
      } catch (error) {
        safeCallback(callback, {
          modeRejected: true,
          message: "Failed to update match mode",
        });
      }
    });

    socket.on("lobby:set-npcs", (data, callback) => {
      const roomId = asTrimmedString(data?.roomId);
      const npcConfigs = data?.npcConfigs;
      const session = sessionManager.getSession(roomId);
      const playerId = sessionManager.getPlayerIdBySocketId(socket.id);

      if (!isNonEmptyString(roomId) || !session) {
        safeCallback(callback, {
          roomDoesNotExist: true,
          message: "Room does not exist",
        });
        return;
      }
      if (!playerId || !session.hasPlayer(playerId)) {
        safeCallback(callback, {
          notInRoom: true,
          message: "Player is not part of this room",
        });
        return;
      }
      if (session.host !== playerId) {
        safeCallback(callback, {
          notHost: true,
          message: "Only the host can edit NPC settings",
        });
        return;
      }
      if (session.status !== "waiting") {
        safeCallback(callback, {
          invalidState: true,
          message: "NPCs can only be edited before the game starts",
        });
        return;
      }
      if (session.mode !== "single") {
        safeCallback(callback, {
          invalidMode: true,
          message: "NPCs are only available in single-player mode",
        });
        return;
      }

      try {
        session.setNpcConfigs(npcConfigs);
        io.to(roomId).emit("lobby-updated", session.toLobbyPayload());
        safeCallback(callback, { ok: true });
      } catch (error) {
        safeCallback(callback, {
          npcUpdateRejected: true,
          message: "Failed to update NPC settings",
        });
      }
    });

    socket.on("lobby:set-spells", (data, callback) => {
      const roomId = asTrimmedString(data?.roomId);
      const rawSpellIds = data?.spellIds;
      const spellIds = normalizeSpellLoadout(rawSpellIds);
      const session = sessionManager.getSession(roomId);
      const playerId = sessionManager.getPlayerIdBySocketId(socket.id);

      if (!isNonEmptyString(roomId) || !session) {
        safeCallback(callback, {
          roomDoesNotExist: true,
          message: "Room does not exist",
        });
        return;
      }
      if (!playerId || !session.hasPlayer(playerId)) {
        safeCallback(callback, {
          notInRoom: true,
          message: "Player is not part of this room",
        });
        return;
      }
      if (session.status !== "waiting") {
        safeCallback(callback, {
          invalidState: true,
          message: "Spells can only be changed before the game starts",
        });
        return;
      }
      if (!hasValidSpellLoadout(spellIds)) {
        safeCallback(callback, {
          invalidSpellSelection: true,
          message: "Select exactly 3 unique valid spells",
        });
        return;
      }

      try {
        sessionManager.setSelectedSpellsForRoom(roomId, playerId, spellIds);
        io.to(roomId).emit("lobby-updated", session.toLobbyPayload());
        safeCallback(callback, { ok: true, spellIds });
      } catch (error) {
        safeCallback(callback, {
          spellSelectionRejected: true,
          message: "Failed to update spell selection",
        });
      }
    });

    socket.on("input:update", (input) => {
      const session = sessionManager.getSessionBySocket(socket.id);
      if (!session || session.status !== "running" || session.gameState?.paused) {
        return;
      }
      if (
        !input ||
        input.roomId !== session.roomId ||
        !isValidInputKeys(input.keys) ||
        !isValidInputActions(input.actions)
      ) {
        return;
      }

      const playerId = sessionManager.getPlayerIdBySocketId(socket.id);
      if (!playerId || !session.hasPlayer(playerId)) {
        return;
      }

      const inputSeq = input?.inputSeq;
      const keys = input?.keys;
      const actions = input?.actions ?? null;
      const clientTimeMs = input?.clientTimeMs;
      if (
        typeof inputSeq !== "number" ||
        inputSeq < 0 ||
        keys == null ||
        clientTimeMs == null
      ) {
        return;
      }

      sessionManager.updateInput(playerId, inputSeq, keys, actions, clientTimeMs);
    });

    socket.on("aim:update", (payload) => {
      const session = sessionManager.getSessionBySocket(socket.id);
      if (!session || session.status !== "running" || session.gameState?.paused) {
        return;
      }
      if (!payload || payload.roomId !== session.roomId || !isValidAimPayload(payload)) {
        return;
      }

      const playerId = sessionManager.getPlayerIdBySocketId(socket.id);
      if (!playerId || !session.hasPlayer(playerId)) {
        return;
      }

      sessionManager.updateAim(playerId, payload.aimX, payload.aimY);
    });

    socket.on("spell:cast", (data, callback) => {
      const session = sessionManager.getSessionBySocket(socket.id);
      if (!session || session.status !== "running" || session.gameState?.paused) {
        rejectSpellCast(socket, callback, {
          reason: SPELL_CAST_REJECTION.INVALID_STATE,
          details: { message: "session-not-running" },
        });
        return;
      }

      const playerId = sessionManager.getPlayerIdBySocketId(socket.id);
      if (!playerId || !session.hasPlayer(playerId)) {
        rejectSpellCast(socket, callback, {
          reason: SPELL_CAST_REJECTION.PLAYER_NOT_FOUND,
          details: {},
        });
        return;
      }

      const { spellId, targetX, targetY } = data || {};
      if (
        !spellId ||
        !Number.isFinite(targetX) ||
        !Number.isFinite(targetY)
      ) {
        rejectSpellCast(socket, callback, {
          reason: SPELL_CAST_REJECTION.INVALID_PAYLOAD,
          details: {},
        });
        return;
      }

      const spell = getSpellById(spellId);
      if (!spell) {
        rejectSpellCast(socket, callback, {
          reason: SPELL_CAST_REJECTION.UNKNOWN_SPELL,
          details: {},
        });
        return;
      }

      const playerState = session.gameState?.players?.[playerId];
      if (!playerState) {
        rejectSpellCast(socket, callback, {
          reason: SPELL_CAST_REJECTION.PLAYER_NOT_FOUND,
          details: {},
        });
        return;
      }
      if (playerState.isGhost) {
        rejectSpellCast(socket, callback, {
          reason: SPELL_CAST_REJECTION.PLAYER_DEAD,
          details: {
            isGhost: true,
          },
        });
        return;
      }

      sessionManager.updateAim(playerId, targetX, targetY);

      const selectedSpellIds = Array.isArray(playerState.selectedSpellIds)
        ? playerState.selectedSpellIds
        : [];
      if (!selectedSpellIds.includes(spell.id)) {
        rejectSpellCast(socket, callback, {
          reason: SPELL_CAST_REJECTION.SPELL_NOT_EQUIPPED,
          details: { spellId: spell.id },
        });
        return;
      }

      const nowMs = Date.now();
      regeneratePlayerMana(playerState, nowMs);

      const castValidation = validateSpellCast(playerState, spell, nowMs);
      if (!castValidation.ok) {
        rejectSpellCast(socket, callback, {
          reason: castValidation.reason,
          details: castValidation.details,
        });
        return;
      }

      const castOrigin = getPlayerCastOrigin(playerState, hitbox);
      if (!castOrigin) {
        rejectSpellCast(socket, callback, {
          reason: SPELL_CAST_REJECTION.PLAYER_NOT_FOUND,
          details: {},
        });
        return;
      }

      const castTimeMs = Number.isFinite(spell.castTimeMs)
        ? Math.max(0, spell.castTimeMs)
        : 0;
      if (castTimeMs > 0) {
        const previewProjectile = createSpellProjectile({
          spell,
          ownerId: playerId,
          originX: castOrigin.x,
          originY: castOrigin.y,
          targetX,
          targetY,
          nowMs,
        });
        if (!previewProjectile) {
          rejectSpellCast(socket, callback, {
            reason: SPELL_CAST_REJECTION.INVALID_TARGET,
            details: {},
          });
          return;
        }

        const queuedCast = queuePendingSpellCast(
          playerState,
          spell,
          targetX,
          targetY,
          nowMs,
        );
        if (!queuedCast) {
          rejectSpellCast(socket, callback, {
            reason: SPELL_CAST_REJECTION.INVALID_STATE,
            details: {},
          });
          return;
        }

        safeCallback(callback, {
          accepted: true,
          queued: true,
          spellId: spell.id,
          castTimeMs,
        });
        return;
      }

      const projectile = createSpellProjectile({
        spell,
        projectileId: randomUUID(),
        ownerId: playerId,
        originX: castOrigin.x,
        originY: castOrigin.y,
        targetX,
        targetY,
        nowMs,
      });

      if (!projectile) {
        rejectSpellCast(socket, callback, {
          reason: SPELL_CAST_REJECTION.INVALID_TARGET,
          details: {},
        });
        return;
      }

      applySpellCastCosts(playerState, spell, nowMs);
      incrementActiveCastCount(playerState, spell.id);

      session.gameState.projectiles.push(projectile);
      safeCallback(callback, {
        accepted: true,
        spellId: spell.id,
        projectileId: projectile.id,
      });
    });

    socket.on("disconnect", () => {
      logInfo(`disconnected socketId=${socket.id}`);
      const leaveResult = sessionManager.leaveRoomBySocket(socket.id);
      if (!leaveResult) {
        return;
      }

      const { roomId, session, removedRoom } = leaveResult;
      if (removedRoom) {
        logInfo(`room emptied roomId=${roomId}`);
        return;
      }
      if (!session) {
        return;
      }

      io.to(roomId).emit("player-left", session.toLobbyPayload());
    });

    socket.on("game:pause", (data, callback) => {
      const session = sessionManager.getSessionBySocket(socket.id);
      if (!session || session.status !== "running") {
        safeCallback(callback, { ok: false, reason: "not-running" });
        return;
      }

      const playerId = sessionManager.getPlayerIdBySocketId(socket.id);
      if (!playerId || !session.hasPlayer(playerId)) {
        safeCallback(callback, { ok: false, reason: "not-in-room" });
        return;
      }

      const pauseResult = sessionManager.pauseGame(session.roomId, playerId);
      if (!pauseResult.ok) {
        safeCallback(callback, pauseResult);
        if (pauseResult.reason === "already-paused") {
          socket.emit("game-pause-rejected", pauseResult);
        }
        return;
      }

      const payload = {
        roomId: session.roomId,
        pausedById: pauseResult.pausedById,
        pausedByName: pauseResult.pausedByName,
      };
      io.to(session.roomId).emit("game-paused", payload);
      safeCallback(callback, { ok: true });
    });

    socket.on("game:resume", (data, callback) => {
      const session = sessionManager.getSessionBySocket(socket.id);
      if (!session || session.status !== "running") {
        safeCallback(callback, { ok: false, reason: "not-running" });
        return;
      }

      const playerId = sessionManager.getPlayerIdBySocketId(socket.id);
      if (!playerId || !session.hasPlayer(playerId)) {
        safeCallback(callback, { ok: false, reason: "not-in-room" });
        return;
      }

      const resumeResult = sessionManager.resumeGame(session.roomId, playerId);
      if (!resumeResult.ok) {
        safeCallback(callback, resumeResult);
        return;
      }

      const payload = {
        roomId: session.roomId,
        resumedById: resumeResult.resumedById,
        resumedByName: resumeResult.resumedByName,
      };
      io.to(session.roomId).emit("game-resumed", payload);
      safeCallback(callback, { ok: true });
    });

    socket.on("game:quit", (data, callback) => {
      const session = sessionManager.getSessionBySocket(socket.id);
      if (!session) {
        safeCallback(callback, { ok: false, reason: "not-in-room" });
        return;
      }

      const playerId = sessionManager.getPlayerIdBySocketId(socket.id);
      const quitterName = playerId ? session.players[playerId]?.name || null : null;
      io.to(session.roomId).emit("game-quit", {
        roomId: session.roomId,
        quitterId: playerId,
        quitterName,
      });

      socket.leave(session.roomId);
      const leaveResult = sessionManager.leaveRoomBySocket(socket.id);
      if (leaveResult?.session) {
        io.to(session.roomId).emit("player-left", leaveResult.session.toLobbyPayload());
      }
      safeCallback(callback, { ok: true });
    });
  });
}
