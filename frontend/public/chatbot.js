// Floating widget — answers only SmartLeadGen product questions (how it
// works, pricing, setup, troubleshooting). The scoping to product-only
// topics is enforced server-side (see worker/src/index.ts, /api/support-chat),
// not just by prompting here.

(function () {
  const history = [];

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const bubble = el("button", "slg-chat-bubble", "💬");
  bubble.setAttribute("aria-label", "Open help chat");

  const panel = el("div", "slg-chat-panel");
  panel.innerHTML = `
    <div class="slg-chat-head">
      <strong>SmartLeadGen help</strong>
      <span>Ask about setup, pricing, or how it works</span>
      <a href="https://wa.me/message/TDYG575YENF6F1" target="_blank" rel="noopener" class="slg-chat-whatsapp" title="Chat with a human on WhatsApp">💬 WhatsApp</a>
      <button class="slg-chat-close" aria-label="Close chat">✕</button>
    </div>
    <div class="slg-chat-messages" id="slgChatMessages">
      <div class="slg-chat-msg slg-chat-msg-bot">Hi! Ask me anything about SmartLeadGen — getting started, API keys, pricing, or troubleshooting a search. Prefer a person? Tap <strong>💬 WhatsApp</strong> above, any time.</div>
    </div>
    <form class="slg-chat-form" id="slgChatForm">
      <input type="text" id="slgChatInput" placeholder="Type a question…" autocomplete="off" />
      <button type="submit">Send</button>
    </form>
  `;
  panel.style.display = "none";

  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  bubble.addEventListener("click", () => {
    panel.style.display = panel.style.display === "none" ? "flex" : "none";
  });
  panel.querySelector(".slg-chat-close").addEventListener("click", () => {
    panel.style.display = "none";
  });

  const messagesEl = panel.querySelector("#slgChatMessages");
  const formEl = panel.querySelector("#slgChatForm");
  const inputEl = panel.querySelector("#slgChatInput");

  function addMessage(text, who) {
    const msg = el("div", `slg-chat-msg slg-chat-msg-${who}`, text);
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return msg;
  }

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = "";
    addMessage(text, "user");
    history.push({ role: "user", content: text });

    const thinking = addMessage("…", "bot");

    try {
      // API_BASE comes from app.js, already loaded on every page that includes this widget.
      const resp = await fetch(`${API_BASE}/api/support-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: history.slice(-6) }),
      });
      const data = await resp.json().catch(() => ({}));
      thinking.textContent = resp.ok
        ? (data.reply || "Sorry, I didn't get a reply — try again in a moment.")
        : (data.error || "Something went wrong — try again in a moment.");
      if (resp.ok) history.push({ role: "assistant", content: data.reply });
    } catch {
      thinking.textContent = "Couldn't reach the server — check your connection and try again.";
    }
  });
})();
