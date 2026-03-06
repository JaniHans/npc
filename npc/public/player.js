const SPRITE_CLASSES = ["blue", "green", "red", "purple"];

const player = {
  x: 0,
  y: 0,
};

const keys = {
  up: false,
  down: false,
  left: false,
  right: false,
  pause: false,
};

function cloneKeys() {
  return {
    up: keys.up,
    down: keys.down,
    left: keys.left,
    right: keys.right,
  };
}

function setMovementKey(eventKey, isPressed) {
  const normalizedKey = typeof eventKey === "string" ? eventKey.toLowerCase() : "";
  switch (normalizedKey) {
    case "arrowup":
    case "w":
      if (keys.up === isPressed) return false;
      keys.up = isPressed;
      return true;
    case "arrowdown":
    case "s":
      if (keys.down === isPressed) return false;
      keys.down = isPressed;
      return true;
    case "arrowleft":
    case "a":
      if (keys.left === isPressed) return false;
      keys.left = isPressed;
      return true;
    case "arrowright":
    case "d":
      if (keys.right === isPressed) return false;
      keys.right = isPressed;
      return true;
    default:
      return false;
  }
}

function sanitizePendingInput(input) {
  if (!input || typeof input.inputSeq !== "number" || !input.keys) {
    return null;
  }
  const dashRequestId = Number(input.actions?.dashRequestId);
  const hasDashAction = Number.isFinite(dashRequestId) && dashRequestId > 0;
  return {
    inputSeq: input.inputSeq,
    keys: {
      up: Boolean(input.keys.up),
      down: Boolean(input.keys.down),
      left: Boolean(input.keys.left),
      right: Boolean(input.keys.right),
    },
    actions: hasDashAction
      ? {
          dashRequestId,
        }
      : null,
    clientTimeMs: Number(input.clientTimeMs) || Date.now(),
  };
}

function initInput(socket, roomId) {
  let nextInputSeq = 1;
  let nextDashRequestId = 1;
  let pendingInputs = [];
  let inputPaused = false;

  function sendInput(actions = null) {
    const inputSeq = nextInputSeq++;
    const clientTimeMs = Date.now();
    const keyState = cloneKeys();
    const payloadActions =
      actions && Number.isFinite(actions.dashRequestId)
        ? { dashRequestId: actions.dashRequestId }
        : undefined;

    socket.emit("input:update", {
      roomId,
      inputSeq,
      keys: keyState,
      actions: payloadActions,
      clientTimeMs,
    });

    const pendingInput = sanitizePendingInput({
      inputSeq,
      keys: keyState,
      actions: payloadActions,
      clientTimeMs,
    });
    if (!pendingInput) {
      return;
    }
    pendingInputs.push(pendingInput);
  }

  function releaseMovementKeys({ emit = false } = {}) {
    const hadMovementInput = keys.up || keys.down || keys.left || keys.right;
    keys.up = false;
    keys.down = false;
    keys.left = false;
    keys.right = false;
    if (emit && hadMovementInput) {
      sendInput();
    }
  }

  function handleKeyDown(event) {
    if (inputPaused) {
      return;
    }
    const normalizedKey =
      typeof event.key === "string" ? event.key.toLowerCase() : "";
    if (normalizedKey === "shift") {
      if (event.repeat) return;
      sendInput({
        dashRequestId: nextDashRequestId++,
      });
      return;
    }

    const wasUpdated = setMovementKey(event.key, true);
    if (wasUpdated) {
      sendInput();
    }
  }

  function handleKeyUp(event) {
    if (inputPaused) {
      return;
    }
    const wasUpdated = setMovementKey(event.key, false);
    if (wasUpdated) {
      sendInput();
    }
  }

  function handleWindowBlur() {
    if (inputPaused) {
      return;
    }
    releaseMovementKeys({ emit: true });
  }

  function handleVisibilityChange() {
    if (inputPaused || document.visibilityState === "visible") {
      return;
    }
    releaseMovementKeys({ emit: true });
  }

  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", handleWindowBlur);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return {
    getPendingInputs() {
      return pendingInputs.slice();
    },
    replacePendingInputs(nextPendingInputs) {
      if (!Array.isArray(nextPendingInputs)) {
        pendingInputs = [];
        return;
      }
      pendingInputs = nextPendingInputs
        .map((input) => sanitizePendingInput(input))
        .filter(Boolean);
    },
    setPaused(isPaused) {
      inputPaused = Boolean(isPaused);
      if (inputPaused) {
        releaseMovementKeys({ emit: true });
        pendingInputs = [];
      }
    },
    forceReleaseKeys() {
      releaseMovementKeys({ emit: true });
    },
    dispose() {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      releaseMovementKeys();
      pendingInputs = [];
    },
  };
}

function createPlayerElement() {
  const playerElement = document.createElement("div");
  playerElement.classList.add("player");
  return playerElement;
}

function loadSprite(skinIndex) {
  const fallbackIndex = 0;
  const normalizedIndex = Number.isInteger(skinIndex) ? skinIndex : fallbackIndex;
  return SPRITE_CLASSES[normalizedIndex] || SPRITE_CLASSES[fallbackIndex];
}

export { player, keys, initInput, createPlayerElement, loadSprite };
