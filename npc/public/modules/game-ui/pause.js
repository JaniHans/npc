function createElement(tag, className, textContent) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (textContent != null) {
    element.textContent = textContent;
  }
  return element;
}

let pauseContainer = null;
let pauseTitle = null;
let resumeButton = null;
let quitButton = null;
let pauseNotice = null;
let isPaused = false;

function ensurePauseMenu() {
  if (pauseContainer) {
    return pauseContainer;
  }

  pauseContainer = createElement("div", "pause-game-container");
  pauseTitle = createElement("h1", "pause-game-title", "Game paused");
  pauseNotice = createElement("div", "pause-game-notice", "");
  resumeButton = createElement("button", "pause-game-resume", "RESUME");
  quitButton = createElement("button", "pause-game-quit", "QUIT");

  const buttonRow = createElement("div", "pause-game-actions");
  buttonRow.append(resumeButton, quitButton);
  pauseContainer.append(pauseTitle, pauseNotice, buttonRow);
  document.body.appendChild(pauseContainer);

  return pauseContainer;
}

function showPauseMenu(pausedByName) {
  ensurePauseMenu();
  pauseTitle.textContent = pausedByName ? `Game paused by ${pausedByName}` : "Game paused";
  pauseContainer.classList.add("is-visible");
}

function hidePauseMenu() {
  if (!pauseContainer) {
    return;
  }
  pauseContainer.classList.remove("is-visible");
}

function showNotice(message) {
  if (!pauseNotice) {
    return;
  }
  pauseNotice.textContent = message || "";
  pauseNotice.classList.add("is-visible");
  if (message) {
    setTimeout(() => {
      if (pauseNotice) {
        pauseNotice.classList.remove("is-visible");
      }
    }, 2000);
  }
}

function showTransientToast(message) {
  const toast = createElement("div", "pause-game-toast", message);
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add("is-visible");
  });
  setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 350);
  }, 2000);
}

export function createPauseController({
  socket,
  roomId,
  onPauseStateChange,
  onQuit,
}) {
  if (!socket || !roomId) {
    throw new Error("pause controller requires socket and roomId");
  }

  ensurePauseMenu();

  function requestPause() {
    socket.emit("game:pause", { roomId });
  }

  function requestResume() {
    socket.emit("game:resume", { roomId });
  }

  function requestQuit() {
    socket.emit("game:quit", { roomId }, () => {
      if (typeof onQuit === "function") {
        onQuit();
      }
    });
  }

  function handleEscape(event) {
    const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
    if (key !== "escape") {
      return;
    }
    event.preventDefault();
    if (isPaused) {
      requestResume();
    } else {
      requestPause();
    }
  }

  resumeButton.addEventListener("click", requestResume);
  quitButton.addEventListener("click", requestQuit);
  document.addEventListener("keydown", handleEscape);

  return {
    handlePaused({ pausedByName }) {
      isPaused = true;
      showPauseMenu(pausedByName);
      showNotice("Paused");
      if (typeof onPauseStateChange === "function") {
        onPauseStateChange(true);
      }
    },
    handleResumed({ resumedByName }) {
      isPaused = false;
      hidePauseMenu();
      if (resumedByName) {
        showTransientToast(`${resumedByName} resumed the game`);
      }
      if (typeof onPauseStateChange === "function") {
        onPauseStateChange(false);
      }
    },
    handleQuit({ quitterName }) {
      if (quitterName) {
        showTransientToast(`${quitterName} quit the game`);
      }
    },
    handlePauseRejected({ pausedByName }) {
      showTransientToast(
        pausedByName ? `Already paused by ${pausedByName}` : "Game already paused",
      );
    },
    dispose() {
      document.removeEventListener("keydown", handleEscape);
      resumeButton?.removeEventListener("click", requestResume);
      quitButton?.removeEventListener("click", requestQuit);
      hidePauseMenu();
      isPaused = false;
    },
  };
}

export function pauseGame(data) {
  return Boolean(data?.paused);
}

export function renderGameAlreadyPaused() {
  showTransientToast("Game already paused");
}
