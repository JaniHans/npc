export function hasPlayerName(playersBySocketId = {}, nickname = "") {
  return Object.values(playersBySocketId).some(
    (player) => player?.name === nickname,
  );
}

export function isRoomFull(playersBySocketId = {}, maxPlayers = 4) {
  return Object.keys(playersBySocketId).length >= maxPlayers;
}

// Backward-compat helper name kept for migration safety.
export const checkPlayerExists = hasPlayerName;
