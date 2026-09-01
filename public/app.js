const $ = (id) => document.getElementById(id);

let me = null;
let socket = null;
let currentUser = null;
let currentRoom = null;
let users = [];

/* =========================
   ELEMENTS
========================= */

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
const logoutBtn = $("logout");
const backBtn = $("backBtn");

let authMode = "login";

/* =========================
   AUTH TABS
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
    if (authError) authError.textContent =
      "نام کاربری را وارد کن.";
    return;
  }

  if (!password) {
    if (authError) authError.textContent =
      "رمز عبور را وارد کن.";
    return;
  }

  if (authMode === "register" && password.length < 8) {
    if (authError) authError.textContent =
      "رمز عبور باید حداقل ۸ کاراکتر باشد.";
    return;
  }

  try {
    const data = await api(
      authMode === "login"
        ? "/api/login"
        : "/api/register",
      {
        method: "POST",
        body: JSON.stringify({
          username,
          password
        })
      }
    );

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

  connectSocket();
  await loadUsers();
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
      statusLabel.textContent =
        currentUser ? "آنلاین" : "گفتگوی عمومی";
    }
  });

  socket.addEventListener("message", (event) => {
    let data;

    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.type === "history") {
      if (!messagesBox) return;

      messagesBox.innerHTML = "";

      (data.messages || []).forEach((message) => {
        appendMessage(message);
      });

      scrollMessages();
    }

    if (data.type === "message") {
      if (!data.message) return;

      if (currentRoom) {
        appendMessage(data.message);
        scrollMessages();
      }
    }

    if (data.type === "presence") {
      console.log(
        "presence:",
        data.username,
        data.online
      );
    }

    if (data.type === "error") {
      console.error(data.message);
    }
  });

  socket.addEventListener("close", () => {
    console.log("WebSocket disconnected");
  });

  socket.addEventListener("error", (error) => {
    console.error("WebSocket error:", error);
  });
}

/* =========================
   USERS
========================= */

async function loadUsers() {
  users = [];
  renderUsers();
}

function renderUsers() {
  if (!usersBox) return;

  usersBox.innerHTML = "";

  if (!users.length) {
    usersBox.innerHTML =
      '<div class="muted">فعلاً گفتگوی خصوصی فعال نشده است.</div>';
    return;
  }

  users.forEach((user) => {
    const item = document.createElement("button");

    item.className = "userItem";

    item.innerHTML = `
      <span class="avatar">
        ${escapeHtml(
          user.username.charAt(0).toUpperCase()
        )}
      </span>

      <span class="userInfo">
        <b>${escapeHtml(user.username)}</b>
        <small>
          ${user.online ? "آنلاین" : "آفلاین"}
        </small>
      </span>

      <span class="dot ${
        user.online ? "online" : ""
      }"></span>
    `;

    item.addEventListener("click", () => {
      openPrivateChat(user);
    });

    usersBox.appendChild(item);
  });
}

/* =========================
   🔥 PUBLIC ROOM
========================= */

async function openPublicRoom() {
  console.log("PUBLIC ROOM CLICKED");

  currentUser = null;

  currentRoom = {
    id: "global",
    name: "دورهمی"
  };

  if (chatWith) {
    chatWith.textContent =
      "🌟 اتاق دورهمی";
  }

  if (statusLabel) {
    statusLabel.textContent =
      "گفتگوی عمومی";
  }

  emptyBox?.classList.add("hidden");
  conversation?.classList.remove("hidden");

  if (messagesBox) {
    messagesBox.innerHTML = "";
  }

  try {
    const data =
      await api("/api/messages");

    if (messagesBox) {
      messagesBox.innerHTML = "";

      (data.messages || []).forEach(
        appendMessage
      );

      scrollMessages();
    }

  } catch (error) {
    console.error(
      "Loading messages failed:",
      error
    );

    if (messagesBox) {
      messagesBox.innerHTML =
        `<div class="muted">
          اتصال به اتاق برقرار نشد.
          <br>
          ${escapeHtml(error.message)}
        </div>`;
    }
  }

  if (
    socket &&
    socket.readyState === WebSocket.OPEN
  ) {
    console.log("Room is ready.");
  }
}

/* =========================
   🔥 ROOM CLICK FIX
========================= */

document.addEventListener("click", (event) => {
  const target =
    event.target.closest(
      "#publicRoom, [data-room='global'], .publicRoom"
    );

  if (target) {
    event.preventDefault();
    event.stopPropagation();

    openPublicRoom();
    return;
  }

  /*
    اگر HTML فعلی ID متفاوت داشته باشد،
    متن کارت را هم تشخیص می‌دهیم.
  */

  const element =
    event.target.closest(
      "button, a, div"
    );

  if (!element) return;

  const text =
    (element.innerText || "")
      .replace(/\s+/g, " ")
      .trim();

  if (
    text.includes("اتاق دورهمی") &&
    (
      text.includes("گفتگوی عمومی") ||
      text.includes("ورود به اتاق")
    )
  ) {
    event.preventDefault();
    event.stopPropagation();

    openPublicRoom();
  }
});

/* =========================
   PRIVATE CHAT
========================= */

function openPrivateChat(user) {
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
    messagesBox.innerHTML =
      `<div class="muted">
        گفتگوی خصوصی در مرحله بعد فعال می‌شود.
      </div>`;
  }
}

/* =========================
   SEND MESSAGE
========================= */

sendForm?.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const body =
      messageInput?.value.trim() || "";

    if (!body || !me) return;

    if (!currentRoom) {
      alert(
        "اول وارد اتاق دورهمی شو."
      );
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

    try {
      await api("/api/send", {
        method: "POST",
        body: JSON.stringify({
          username: me.username,
          body
        })
      });

      messageInput.value = "";
      messageInput.focus();

    } catch (error) {
      alert(error.message);
    }
  }
);

/* =========================
   MESSAGE
========================= */

function appendMessage(message) {
  if (!messagesBox || !message) return;

  const item =
    document.createElement("div");

  const mine =
    me &&
    message.username === me.username;

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
          ? `<strong class="message-user">
              ${escapeHtml(message.username)}
             </strong>`
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

    conversation?.classList.add(
      "hidden"
    );

    emptyBox?.classList.remove(
      "hidden"
    );

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
  () => {
    me = null;
    currentUser = null;
    currentRoom = null;

    localStorage.removeItem(
      "chat_username"
    );

    if (socket) {
      try {
        socket.close();
      } catch {}

      socket = null;
    }

    chatBox?.classList.add("hidden");
    authBox?.classList.remove("hidden");

    if (usernameInput)
      usernameInput.value = "";

    if (passwordInput)
      passwordInput.value = "";

    if (messagesBox)
      messagesBox.innerHTML = "";
  }
);

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
    console.error(error);
  });
  }
