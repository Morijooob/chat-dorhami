const $ = (id) => document.getElementById(id);

let me = null;
let socket = null;
let currentRoom = null;
let currentUser = null;
let reconnectTimer = null;

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

/* =========================
   AUTH MODE
========================= */

document.querySelectorAll(".tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".tabs button")
      .forEach((b) => b.classList.remove("active"));

    btn.classList.add("active");

    authMode = btn.dataset.mode || "login";

    const submitButton = authForm?.querySelector("button");

    if (submitButton) {
      submitButton.textContent =
        authMode === "login"
          ? "ورود به دورهمی"
          : "ثبت‌نام";
    }

    if (authError) {
      authError.textContent = "";
    }
  });
});

/* =========================
   API
========================= */

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "خطایی رخ داد.");
  }

  return data;
}

/* =========================
   LOGIN / REGISTER
========================= */

authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (authError) {
    authError.textContent = "";
  }

  const username =
    usernameInput?.value.trim().toLowerCase() || "";

  const password =
    passwordInput?.value || "";

  if (!username) {
    authError.textContent = "نام کاربری را وارد کن.";
    return;
  }

  if (!password) {
    authError.textContent = "رمز عبور را وارد کن.";
    return;
  }

  if (
    authMode === "register" &&
    password.length < 8
  ) {
    authError.textContent =
      "رمز عبور باید حداقل ۸ کاراکتر باشد.";
    return;
  }

  const submitButton =
    authForm.querySelector("button");

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "لطفاً صبر کن...";
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

    if (!data.user) {
      throw new Error(
        "اطلاعات کاربر از سرور دریافت نشد."
      );
    }

    me = data.user;

    localStorage.setItem(
      "chat_username",
      me.username
    );

    await showChat();

  } catch (error) {
    if (authError) {
      authError.textContent =
        error.message || "خطایی رخ داد.";
    }
  } finally {
    if (submitButton) {
      submitButton.disabled = false;

      submitButton.textContent =
        authMode === "login"
          ? "ورود به دورهمی"
          : "ثبت‌نام";
    }
  }
});

/* =========================
   SHOW CHAT
========================= */

async function showChat() {
  if (!me) return;

  authBox?.classList.add("hidden");
  chatBox?.classList.remove("hidden");

  if (meLabel) {
    meLabel.textContent = "@" + me.username;
  }

  /*
    مهم:
    به محض ورود، اتاق دورهمی را فعال می‌کنیم.
  */

  currentUser = null;

  currentRoom = {
    id: "global",
    name: "دورهمی"
  };

  if (chatWith) {
    chatWith.textContent = "🌟 اتاق دورهمی";
  }

  if (statusLabel) {
    statusLabel.textContent = "در حال اتصال...";
  }

  emptyBox?.classList.add("hidden");
  conversation?.classList.remove("hidden");

  if (messagesBox) {
    messagesBox.innerHTML = "";
  }

  renderUsers();

  connectSocket();
}

/* =========================
   WEBSOCKET
========================= */

function connectSocket() {
  if (!me) return;

  if (socket) {
    try {
      socket.close();
    } catch {}

    socket = null;
  }

  const protocol =
    location.protocol === "https:"
      ? "wss:"
      : "ws:";

  const wsUrl =
    protocol +
    "//" +
    location.host +
    "/ws?username=" +
    encodeURIComponent(me.username);

  console.log("Connecting:", wsUrl);

  socket = new WebSocket(wsUrl);

  socket.addEventListener("open", () => {
    console.log("WebSocket connected");

    if (statusLabel) {
      statusLabel.textContent = "آنلاین";
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  });

  socket.addEventListener("message", (event) => {
    let data;

    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    console.log("SERVER:", data);

    /* تاریخچه */
    if (data.type === "history") {
      if (!messagesBox) return;

      messagesBox.innerHTML = "";

      const messages =
        Array.isArray(data.messages)
          ? data.messages
          : [];

      messages.forEach((message) => {
        appendMessage(message);
      });

      scrollMessages();
      return;
    }

    /* پیام جدید */
    if (data.type === "message") {
      if (!data.message) return;

      /*
        فقط وقتی در اتاق دورهمی هستیم
        پیام را نشان بده.
      */

      if (currentRoom?.id === "global") {
        appendMessage(data.message);
        scrollMessages();
      }

      return;
    }

    /* حضور کاربران */
    if (data.type === "presence") {
      console.log(
        "presence:",
        data.username,
        data.online
      );

      return;
    }

    if (data.type === "error") {
      console.error(data.message);
    }
  });

  socket.addEventListener("close", () => {
    console.log("WebSocket disconnected");

    if (statusLabel) {
      statusLabel.textContent =
        "اتصال قطع شد؛ تلاش مجدد...";
    }

    /*
      اتصال خودکار مجدد
    */

    if (me && !reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;

        if (me) {
          connectSocket();
        }
      }, 3000);
    }
  });

  socket.addEventListener("error", (error) => {
    console.error("WebSocket error:", error);
  });
}

/* =========================
   PUBLIC ROOM
========================= */

publicRoom?.addEventListener(
  "click",
  openPublicRoom
);

async function openPublicRoom() {
  if (!me) {
    return;
  }

  currentUser = null;

  currentRoom = {
    id: "global",
    name: "دورهمی"
  };

  if (chatWith) {
    chatWith.textContent = "🌟 اتاق دورهمی";
  }

  if (statusLabel) {
    statusLabel.textContent =
      socket?.readyState === WebSocket.OPEN
        ? "آنلاین"
        : "در حال اتصال...";
  }

  emptyBox?.classList.add("hidden");
  conversation?.classList.remove("hidden");

  /*
    اگر WebSocket وصل نیست، دوباره وصل شو.
  */

  if (
    !socket ||
    socket.readyState !== WebSocket.OPEN
  ) {
    connectSocket();
    return;
  }

  /*
    تاریخچه از WebSocket هنگام اتصال
    دریافت می‌شود.
  */

  messageInput?.focus();
}

/* =========================
   PRIVATE CHAT
========================= */

async function openPrivateChat(user) {
  currentUser = user;
  currentRoom = null;

  if (chatWith) {
    chatWith.textContent =
      "@" + user.username;
  }

  if (statusLabel) {
    statusLabel.textContent =
      user.online ? "آنلاین" : "آفلاین";
  }

  emptyBox?.classList.add("hidden");
  conversation?.classList.remove("hidden");

  if (messagesBox) {
    messagesBox.innerHTML = "";

    const notice =
      document.createElement("div");

    notice.className = "muted";

    notice.textContent =
      "گفتگوی خصوصی در مرحله بعد فعال می‌شود.";

    messagesBox.appendChild(notice);
  }
}

/* =========================
   USERS
========================= */

function renderUsers() {
  if (!usersBox) return;

  usersBox.innerHTML = `
    <div class="muted">
      برای شروع، وارد اتاق 🌟 دورهمی شو.
    </div>
  `;
}

searchInput?.addEventListener(
  "input",
  () => {}
);

/* =========================
   SEND MESSAGE
========================= */

sendForm?.addEventListener(
  "submit",
  (event) => {
    event.preventDefault();

    if (!me) {
      return;
    }

    if (!currentRoom) {
      alert(
        "اول وارد اتاق دورهمی شو."
      );
      return;
    }

    const body =
      messageInput?.value.trim() || "";

    if (!body) {
      return;
    }

    if (
      socket &&
      socket.readyState === WebSocket.OPEN
    ) {
      socket.send(
        JSON.stringify({
          type: "message",
          body
        })
      );

      messageInput.value = "";
      messageInput.focus();

      return;
    }

    alert(
      "اتصال به اتاق قطع است. چند لحظه صبر کن."
    );
  }
);

/* =========================
   MESSAGE
========================= */

function appendMessage(message) {
  if (!messagesBox || !message) {
    return;
  }

  const item =
    document.createElement("div");

  const mine =
    me &&
    message.username === me.username;

  item.className =
    "message " +
    (mine ? "mine" : "other");

  const time = message.created_at
    ? new Date(
        message.created_at
      ).toLocaleTimeString(
        "fa-IR",
        {
          hour: "2-digit",
          minute: "2-digit"
        }
      )
    : "";

  item.innerHTML = `
    <div class="bubble">
      ${
        !mine
          ? `
            <strong class="message-user">
              ${escapeHtml(message.username)}
            </strong>
          `
          : ""
      }

      <div class="body">
        ${escapeHtml(message.body)}
      </div>

      <small>${time}</small>
    </div>
  `;

  messagesBox.appendChild(item);
}

/* =========================
   SCROLL
========================= */

function scrollMessages() {
  if (!messagesBox) return;

  messagesBox.scrollTop =
    messagesBox.scrollHeight;
}

/* =========================
   BACK
========================= */

backBtn?.addEventListener(
  "click",
  () => {
    currentUser = null;
    currentRoom = null;

    conversation?.classList.add("hidden");
    emptyBox?.classList.remove("hidden");

    if (messagesBox) {
      messagesBox.innerHTML = "";
    }
  }
);

/* =========================
   LOGOUT
========================= */

logoutBtn?.addEventListener(
  "click",
  logout
);

function logout() {
  me = null;
  currentUser = null;
  currentRoom = null;

  localStorage.removeItem(
    "chat_username"
  );

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (socket) {
    try {
      socket.close();
    } catch {}

    socket = null;
  }

  chatBox?.classList.add("hidden");
  authBox?.classList.remove("hidden");

  if (usernameInput) {
    usernameInput.value = "";
  }

  if (passwordInput) {
    passwordInput.value = "";
  }

  if (messagesBox) {
    messagesBox.innerHTML = "";
  }
}

/* =========================
   SECURITY
========================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================
   AUTO LOGIN
========================= */

const savedUsername =
  localStorage.getItem(
    "chat_username"
  );

if (savedUsername) {
  me = {
    id: null,
    username: savedUsername
  };

  showChat().catch((error) => {
    console.error(
      "Auto login error:",
      error
    );
  });
      }
