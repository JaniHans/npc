// Chat functionality module

export function initChat(
  socket,
  chatMessages,
  chatInput,
  chatSend,
  chatPlaceholder,
  roomId,
) {
  const activeRoomId = roomId;

  function sendChatMessage() {
    const message = chatInput.value.trim();
    if (!message) return;

    socket.emit("chat-message", {
      roomId: activeRoomId,
      message: message,
    });
    chatInput.value = "";
  }

  chatSend.addEventListener("click", sendChatMessage);
  function handleKeypress(e) {
    if (e.key === "Enter") {
      sendChatMessage();
    }
  }
  chatInput.addEventListener("keypress", handleKeypress);

  socket.on("chat-message", handleChatMessage);

  function handleChatMessage({ roomId, message, senderName }) {
    // Remove placeholder if present
    if (chatPlaceholder) {
      chatPlaceholder.remove();
    }

    const chatMessage = document.createElement("div");
    chatMessage.className = "message";

    const sender = document.createElement("span");
    sender.className = "sender";
    sender.textContent = senderName;

    const text = document.createElement("span");
    text.className = "text";
    text.textContent = message;

    chatMessage.appendChild(sender);
    chatMessage.appendChild(text);
    chatMessages.appendChild(chatMessage);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  return {
    dispose() {
      chatSend.removeEventListener("click", sendChatMessage);
      chatInput.removeEventListener("keypress", handleKeypress);
      socket.off("chat-message", handleChatMessage);
    },
  };
}
