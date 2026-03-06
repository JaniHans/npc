let stylesInjected = false;

export function ensureGameTransitionStyles() {
  if (stylesInjected) {
    return;
  }

  const style = document.createElement("style");
  style.textContent = `
    @keyframes cardDisappear {
      0% {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      100% {
        opacity: 0;
        transform: translateY(-30px) scale(0.95);
      }
    }

    .game-starting {
      animation: gameFlash 0.5s ease;
    }

    @keyframes gameFlash {
      0%, 100% { filter: brightness(1); }
      50% { filter: brightness(1.5) saturate(1.2); }
    }
  `;
  document.head.appendChild(style);
  stylesInjected = true;
}

export function startGameTransition(roomElement) {
  ensureGameTransitionStyles();
  document.body.classList.add("game-starting");
  if (roomElement) {
    roomElement.style.display = "none";
  }
}

ensureGameTransitionStyles();
