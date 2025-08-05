document.getElementById("send-btn").addEventListener("click", sendMessage);
document.getElementById("user-input").addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage();
  }
});

function appendMessage(sender, text) {
  const chatBox = document.getElementById("chat-box");
  const msg = document.createElement("div");
  msg.classList.add("message");
  msg.classList.add(sender === "あなた" ? "user" : "bot");
  msg.innerText = text;
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// Botのあいさつ（初回表示）
window.addEventListener("DOMContentLoaded", () => {
  appendMessage("Bot", "こんにちは、レントメイトです！どんなお手伝いをご希望ですか？🏡");
});

async function sendMessage() {
  const input = document.getElementById("user-input");
  const message = input.value.trim();
  if (!message) return;

  appendMessage("あなた", message);
  input.value = "";

  try {
    const res = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    const data = await res.json();
    appendMessage("Bot", data.reply);
  } catch (err) {
    console.error("送信エラー:", err);
    appendMessage("Bot", "エラーが発生しました。もう一度お試しください🙇‍♀️");
  }
}
