const $ = (id) => document.getElementById(id);

let token = localStorage.getItem("chat_token") || "";
let me = null;
let socket = null;
let currentUser = null;
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

    const submitButton = authForm.querySelector("button");

    if (submitButton) {
      submitButton.textContent =
        authMode === "login"
          ? "ورود به دورهمی"
          : "ثبت‌نام";
    }

    authError.textContent = "";
  });
});

/* =========================
   API
========================= */

async function api(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    ...options,
    headers
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

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  authError.textContent = "";

  const username = usernameInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  if (!username) {
    authError.textContent = "نام کاربری را وارد کن.";
    return;
  }

  if (!password) {
    authError.textContent = "رمز عبور را وارد کن.";
    return;
  }

  if (authMode === "register" && password.length < 8) {
    authError.textContent =
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

    /*
      Worker فعلی تو برای login/register
      توکن برنمی‌گرداند.
      بنابراین کاربر را مستقیماً از پاسخ می‌گیریم.
    */

    if (!data.user) {
      throw new Error("اطلاعات کاربر از سرور دریافت نشد.");
    }

    me = data.user;

    /*
      برای اینکه refresh باعث خروج نشود،
      نام کاربری را ذخیره می‌کنیم.
    */
    localStorage.setItem(
      "chat_username",
      me.username
    );

    await showChat();

  } catch (error) {
    authError.textContent =
      error.message || "خطایی رخ داد.";
  }
});

/* =========================
   SHOW CHAT
========================= */

async function showChat() {
  if (!me) return;

  authBox.classList.add("hidden");
  chatBox.classList.remove("hidden");

  meLabel.textContent = "@" + me.username;

  connectSocket();

  await loadUsers();
}

/* =========================
   SOCKET
========================= */

function connectSocket() {
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

  socket = new WebSocket(wsUrl);

  socket.addEventListener("open", () => {
    console.log("WebSocket connected");
    statusLabel.textContent =
      currentUser ? "آنلاین" : "گفتگوی عمومی";
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
      const message = data.message;

      if (!message) return;

      /*
        پیام عمومی
      */
      if (currentRoom) {
        appendMessage(message);
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
  /*
    Worker فعلی endpoint /api/users ندارد.
    فعلاً لیست کاربران را از سرور نمی‌گیریم
    تا ثبت‌نام و چت عمومی پایدار شود.
  */

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
   SEARCH
========================= */

searchInput?.addEventListener(
  "input",
  () => {
    /*
      جستجوی خصوصی را فعلاً غیرفعال نگه می‌داریم
      چون Worker فعلی endpoint کاربران ندارد.
    */
  }
);

/* =========================
   PUBLIC ROOM
========================= */

publicRoom?.addEventListener(
  "click",
  openPublicRoom
);

async function openPublicRoom() {
  currentUser = null;

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

  /*
    دریافت تاریخچه پیام‌ها
  */

  try {
    const data =
      await api("/api/messages");

    (data.messages || []).forEach(
      appendMessage
    );

    scrollMessages();

  } catch (error) {
    console.error(error);
  }
}

/* =========================
   PRIVATE CHAT
========================= */

async function openPrivateChat(user) {
  currentUser = user;
  currentRoom = null;

  chatWith.textContent =
    "@" + user.username;

  statusLabel.textContent =
    user.online ? "آنلاین" : "آفلاین";

  emptyBox.classList.add("hidden");
  conversation.classList.remove("hidden");

  messagesBox.innerHTML = "";

  /*
    گفتگوی خصوصی در Worker فعلی هنوز
    پیاده‌سازی نشده است.
  */

  const notice =
    document.createElement("div");

  notice.className = "muted";

  notice.textContent =
    "گفتگوی خصوصی در مرحله بعد فعال می‌شود.";

  messagesBox.appendChild(notice);
}

/* =========================
   SEND MESSAGE
========================= */

sendForm.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const body =
      messageInput.value.trim();

    if (!body) return;

    if (!me) return;

    /*
      فعلاً فقط اتاق عمومی
    */

    if (!currentRoom) {
      alert(
        "اول وارد اتاق دورهمی شو."
      );

      return;
    }

    /*
      ارسال با WebSocket
    */

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

    /*
      اگر WebSocket وصل نبود،
      از API پشتیبان استفاده می‌کنیم.
    */

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
   MESSAGE RENDER
========================= */

function appendMessage(message) {
  if (!messagesBox) return;

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

    conversation.classList.add(
      "hidden"
    );

    emptyBox.classList.remove(
      "hidden"
    );

    messagesBox.innerHTML = "";
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
