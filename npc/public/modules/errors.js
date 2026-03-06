// Error display utilities

export function showError(element, textElement, message) {
  textElement.textContent = message;
  element.classList.add("visible");
  // Reset animation
  element.style.animation = "none";
  element.offsetHeight; // Trigger reflow
  element.style.animation = null;
}

export function hideError(element) {
  element.classList.remove("visible");
}
