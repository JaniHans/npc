import { initChat } from "./modules/chat.js";
import { initLobby } from "./modules/lobby.js";
import { initGame } from "./modules/game.js";

// Socket
const socket = io();

// DOM Elements - Lobby
const lobby = document.getElementById("lobby");
const room = document.getElementById("room");
const joinBtn = document.getElementById("joinBtn");
const startBtn = document.getElementById("startBtn");
const playersList = document.getElementById("playersList");
const currentRoomId = document.getElementById("currentRoomId");
const errorDiv = document.getElementById("error");
const errorText = errorDiv.querySelector(".error-text");
const errorRoomDiv = document.getElementById("error-room");
const errorRoomText = errorRoomDiv.querySelector(".error-text");
const matchResultModal = document.getElementById("match-result-modal");
const matchResultWinner = document.getElementById("match-result-winner");
const matchResultReason = document.getElementById("match-result-reason");

// DOM Elements - Chat
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");
const chatPlaceholder = document.querySelector(".chat-placeholder");

let chatHandle = null;
let gameHandle = null;

let selfPlayerId = null;
let matchResultTimeoutId = null;

function showMatchResult(payload) {
  if (!matchResultModal || !matchResultWinner) {
    window.location.reload();
    return;
  }

  const isDraw = Boolean(payload?.isDraw);
  const winnerName = payload?.winnerName || "Unknown";
  matchResultWinner.textContent = isDraw ? "Draw" : `Winner: ${winnerName}`;

  if (matchResultReason) {
    const reason = payload?.reason === "time" ? "Time expired" : "All opponents defeated";
    matchResultReason.textContent = reason;
  }

  matchResultModal.classList.add("is-visible");

  if (matchResultTimeoutId) {
    clearTimeout(matchResultTimeoutId);
  }
  matchResultTimeoutId = setTimeout(() => {
    window.location.reload();
  }, 4000);
}

// Initialize lobby
const lobbyState = initLobby(
  socket,
  lobby,
  room,
  joinBtn,
  startBtn,
  playersList,
  currentRoomId,
  errorDiv,
  errorText,
  errorRoomDiv,
  errorRoomText,
  (roomId, joinedPlayerId) => {
    // On room joined, initialize chat
    if (chatHandle) chatHandle.dispose();
    chatHandle = initChat(
      socket,
      chatMessages,
      chatInput,
      chatSend,
      chatPlaceholder,
      roomId,
    );
    selfPlayerId = joinedPlayerId;
  },
  (data, roomId) => {
    // On game started
    if (gameHandle) gameHandle.dispose();
    gameHandle = initGame(data, selfPlayerId, socket, roomId);
  },
);

socket.on("game-ended", (payload) => {
  if (gameHandle) {
    gameHandle.dispose();
    gameHandle = null;
  }
  showMatchResult(payload);
});
