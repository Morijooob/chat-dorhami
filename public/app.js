const $ = (id) => document.getElementById(id);

let token = localStorage.getItem("chat_token") || "";
let me = null;
let socket = null;
let currentRoom = null;
let users = [];

const authBox = $("auth");
const chatBox = $("chat");
const authForm = $("authForm");
const authError = $("authError");
const usernameInput = $("username");
const passwordInput = $("password");
const meLabel = $("me");
const usersBox = $("users");
const searchInput = $("search");
const messagesBox = $("messages");
const messageInput = $("message");
const sendForm = $("sendForm");
const emptyBox = $("empty");
const conversation = $("conversation");
const chatWith = $("chatWith");
const statusLabel = $("status");
const publicRoom = $("publicRoom");
const logoutBtn = $("logout");
const backBtn = $("backBtn");

let authMode = "login";

document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    document
      .querySelectorAll(".tabs button")
      .forEach((b) => b.classList.remove("active"));

    button.classList.add("active");

    authMode = button.dataset.mode;

    const submitButton = authForm.querySelector("button");

    submitButton.textContent =
      authMode === "login"
        ? "ورود به دورهمی"
        : "ثبت‌نام";

    authError.textContent = "";
  });
});

async function api(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error || "خطایی در ارتباط با سرور رخ داد."
    );
  }

  return data;
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  authError.textContent = "";

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    authError.textContent =
      "نام کاربری و رمز عبور را وارد کن.";
    return;
  }

  try {
    const endpoint =
      authMode === "login"
        ? "/api/login"
        : "/api/register";

    const data = await api(endpoint, {
      method: "POST",
      body: JSON.stringify({
        username,
        password
      })
    });

    if (!data.token) {
      throw new Error(
        "سرور توکن ورود را ارسال نکرد."
      );
    }

    token = data.token;

    localStorage.setItem(
      "chat_token",
      token
    );

    await startChat();

  } catch (error) {
    authError.textContent =
      error.message ||
      "خطایی رخ داد.";
  }
});

async function startChat() {
  try {
    const data = await api("/api/me");

    me = data.user;

    authBox.classList.add("hidden");
    chatBox.classList.remove("hidden");

    meLabel.textContent =
      "@" + me.username;

    connectWebSocket();

    await loadUsers();

  } catch (error) {
    console.error(error);
    logout();
  }
}

function connectWebSocket() {
  if (socket) {
    try {
      socket.close();
    } catch {}
  }

  const protocol =
    location.protocol === "https:"
      ? "wss:"
      : "ws:";

  const wsUrl =
    `${protocol}//${location.host}/ws?username=` +
    encodeURIComponent(me.username);

  socket = new WebSocket(wsUrl);

  socket.addEventListener("open", () => {
    console.log(
      "Chat Dorhami WebSocket connected"
    );
  });

  socket.addEventListener("message", (event) => {
    let data;

    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.type === "history") {
      messagesBox.innerHTML = "";

      const messages =
        data.messages || [];

      messages.forEach(
        appendCloudflareMessage
      );

      scrollMessages();
      return;
    }

    if (data.type === "message") {
      if (currentRoom && data.message) {
        appendCloudflareMessage(
          data.message
        );

        scrollMessages();
      }

      return;
    }

    if (data.type === "presence") {
      updatePresence(data);
      return;
    }

    if (data.type === "error") {
      console.error(
        data.message
      );
    }
  });

  socket.addEventListener("close", () => {
    console.log(
      "Chat Dorhami WebSocket disconnected"
    );
  });

  socket.addEventListener("error", (error) => {
    console.error(
      "WebSocket error:",
      error
    );
  });
}

function updatePresence(data) {
  if (!data.username) return;

  const user = users.find(
    (item) =>
      item.username === data.username
  );

  if (user) {
    user.online = data.online;
    renderUsers();
  }
}

async function loadUsers() {
  /*
    نسخه فعلی Worker هنوز /api/users ندارد.
    بنابراین فعلاً لیست کاربران را خالی نگه می‌داریم.
  */

  users = [];
  renderUsers();
}

function renderUsers() {
  usersBox.innerHTML = "";

  usersBox.innerHTML =
    '<div class="muted">' +
    "فعلاً وارد اتاق عمومی شو و چت کن." +
    "</div>";
}

searchInput?.addEventListener(
  "input",
  () => {
    renderUsers();
  }
);

publicRoom?.addEventListener(
  "click",
  openPublicRoom
);

async function openPublicRoom() {
  try {
    currentRoom = {
      id: "global",
      name: "دورهمی"
    };

    chatWith.textContent =
      "🌟 اتاق دورهمی";

    statusLabel.textContent =
      "گفتگوی عمومی";

    emptyBox.classList.add("hidden");
    conversation.classList.remove("hidden");

    messagesBox.innerHTML = "";

    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN
    ) {
      connectWebSocket();

      await waitForSocket();
    }

    scrollMessages();

  } catch (error) {
    alert(
      error.message ||
      "اتصال به اتاق برقرار نشد."
    );
  }
}

function waitForSocket() {
  return new Promise((resolve, reject) => {
    if (
      socket &&
      socket.readyState === WebSocket.OPEN
    ) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      reject(
        new Error(
          "اتصال WebSocket برقرار نشد."
        )
      );
    }, 8000);

    const check = () => {
      if (
        socket &&
        socket.readyState ===
          WebSocket.OPEN
      ) {
        clearTimeout(timeout);
        resolve();
      } else if (
        socket &&
        socket.readyState ===
          WebSocket.CLOSED
      ) {
        clearTimeout(timeout);
        reject(
          new Error(
            "اتصال به سرور قطع شد."
          )
        );
      } else {
        setTimeout(check, 100);
      }
    };

    check();
  });
}

sendForm.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const body =
      messageInput.value.trim();

    if (!body) return;

    if (!socket) {
      alert(
        "اتصال چت برقرار نیست."
      );
      return;
    }

    if (
      socket.readyState !==
      WebSocket.OPEN
    ) {
      alert(
        "در حال اتصال به سرور هستیم؛ چند لحظه صبر کن."
      );
      return;
    }

    if (!currentRoom) {
      alert(
        "ابتدا وارد اتاق دورهمی شو."
      );
      return;
    }

    socket.send(
      JSON.stringify({
        type: "message",
        body
      })
    );

    messageInput.value = "";
    messageInput.focus();
  }
);

function appendCloudflareMessage(message) {
  if (!message) return;

  const item =
    document.createElement("div");

  const mine =
    message.username ===
    me?.username;

  item.className =
    "message " +
    (mine ? "mine" : "other");

  const time =
    new Date(
      message.created_at
    ).toLocaleTimeString(
      "fa-IR",
      {
        hour: "2-digit",
        minute: "2-digit"
      }
    );

  item.innerHTML = `
    <div class="bubble">

      ${
        !mine
          ? `
            <small class="sender">
              ${escapeHtml(
                message.username ||
                "کاربر"
              )}
            </small>
          `
          : ""
      }

      <div class="body">
        ${escapeHtml(
          message.body || ""
        )}
      </div>

      <small>
        ${time}
      </small>

    </div>
  `;

  messagesBox.appendChild(item);
}

function scrollMessages() {
  messagesBox.scrollTop =
    messagesBox.scrollHeight;
}

backBtn?.addEventListener(
  "click",
  () => {
    currentRoom = null;

    conversation.classList.add(
      "hidden"
    );

    emptyBox.classList.remove(
      "hidden"
    );

    messagesBox.innerHTML = "";
  }
);

logoutBtn?.addEventListener(
  "click",
  logout
);

function logout() {
  token = "";
  me = null;
  currentRoom = null;

  localStorage.removeItem(
    "chat_token"
  );

  if (socket) {
    try {
      socket.close();
    } catch {}

    socket = null;
  }

  chatBox.classList.add("hidden");
  authBox.classList.remove("hidden");

  usernameInput.value = "";
  passwordInput.value = "";

  messagesBox.innerHTML = "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll(
      "'",
      "&#039;"
    );
}

if (token) {
  startChat();
    }
