export const ROOM_ID_RULES = Object.freeze({
  minLength: 3,
  maxLength: 20,
  pattern: /^[a-zA-Z0-9]+$/,
});

export const NICKNAME_RULES = Object.freeze({
  minLength: 2,
  maxLength: 15,
  pattern: /^[a-zA-Z0-9 ]+$/,
});

function validateInput(value, rules) {
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, reason: "required" };
  }

  if (value.length < rules.minLength || value.length > rules.maxLength) {
    return { ok: false, reason: "length" };
  }

  if (!rules.pattern.test(value)) {
    return { ok: false, reason: "format" };
  }

  return { ok: true };
}

export function validateRoomId(roomId) {
  return validateInput(roomId, ROOM_ID_RULES);
}

export function validateNickname(nickname) {
  return validateInput(nickname, NICKNAME_RULES);
}
