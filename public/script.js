// --- DOM要素 ---
const sendBtn = document.getElementById("send-btn");
const userInput = document.getElementById("user-input");
const chatBox = document.getElementById("chat-box");
const exampleButtons = document.querySelectorAll(".example-btn");

// --- イベントリスナー ---
sendBtn.addEventListener("click", () => handleSend());
userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    handleSend();
  }
});

// 質問例ボタンの処理
exampleButtons.forEach(button => {
  button.addEventListener("click", () => {
    const question = button.innerText;
    appendMessage("あなた", question); // ユーザーがクリックした質問を表示
    sendMessage(question); // 質問をサーバーに送信
  });
});

// --- 関数 ---
function appendMessage(sender, text) {
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

// 送信ボタンが押されたときのハンドラ
function handleSend() {
  const message = userInput.value.trim();
  if (!message) return;
  appendMessage("あなた", message);
  userInput.value = "";
  sendMessage(message);
}

// サーバーにメッセージを送信するコア関数
async function sendMessage(message) {
  try {
    const res = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    if (!res.ok) {
      throw new Error(`Server error: ${res.status}`);
    }

    const data = await res.json();
    appendMessage("Bot", data.reply);
  } catch (err) {
    console.error("送信エラー:", err);
    appendMessage("Bot", "エラーが発生しました。もう一度お試しください🙇‍♀️");
  }
}