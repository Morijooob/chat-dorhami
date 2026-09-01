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

document.querySelectorAll(".tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".tabs button")
      .forEach((b) => b.classList.remove("active"));

    btn.classList.add("active");
    authMode = btn.dataset.mode;

    authForm.querySelector("button").textContent =
      authMode === "login" ? "ورود به دورهمی" : "ثبت‌نام";

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
    throw new Error(data.error || "خطایی رخ داد.");
  }

  return data;
}

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  authError.textContent = "";

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    authError.textContent = "نام کاربری و رمز عبور را وارد کن.";
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

    token = data.token;

    localStorage.setItem("chat_token", token);

    await startChat();

  } catch (error) {
    authError.textContent = error.message;
  }
});

async function startChat() {
  try {
    const data = await api("/api/me");

    me = data.user;

    authBox.classList.add("hidden");
    chatBox.classList.remove("hidden");

    meLabel.textContent = "@" + me.username;

    connectSocket();
    await loadUsers();

  } catch (error) {
    logout();
  }
}

function connectSocket() {
  if (socket) {
    socket.close();
  }

  /*
    Cloudflare Worker WebSocket
  */

  const protocol =
    location.protocol === "https:" ? "wss:" : "ws:";

  socket = new WebSocket(
    `${protocol}//${location.host}/ws?username=${encodeURIComponent(
      me.username
    )}`
  );

  socket.addEventListener("open", () => {
    console.log("WebSocket connected");
  });

  socket.addEventListener("close", () => {
    console.log("WebSocket disconnected");
  });

  socket.addEventListener("error", () => {
    console.log("WebSocket error");
  });

  socket.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data);

      handleSocketMessage(data);

    } catch (error) {
      console.log("Invalid socket message");
    }
  });
}

function handleSocketMessage(data) {

  if (data.type === "history") {

    messagesBox.innerHTML = "";

    (data.messages || []).forEach((message) => {
      appendMessage({
        sender_id: message.username === me.username
          ? me.id
          : null,
        username: message.username,
        body: message.body,
        created_at: message.created_at
      });
    });

    scrollMessages();
    return;
  }

  if (data.type === "message") {

    const message = data.message;

    if (currentRoom) {

      appendMessage({
        sender_id:
          message.username === me.username
            ? me.id
            : null,

        username: message.username,

        body: message.body,

        created_at: message.created_at
      });

      scrollMessages();
    }

    return;
  }

  if (data.type === "presence") {

    const user = users.find(
      (u) => u.username === data.username
    );

    if (user) {
      user.online = data.online;
      renderUsers();
    }

    if (
      currentUser &&
      currentUser.username === data.username
    ) {
      statusLabel.textContent =
        data.online ? "آنلاین" : "آفلاین";
    }

    return;
  }

  if (data.type === "error") {
    console.log(data.message);
  }
}

async function loadUsers() {
  try {

    const data = await api("/api/users");

    users = data.users || [];

    users.forEach((user) => {
      user.online = false;
    });

    renderUsers();

  } catch (error) {
    console.log(error);
  }
}

function renderUsers() {

  usersBox.innerHTML = "";

  if (!users.length) {

    usersBox.innerHTML =
      '<div class="muted">هنوز کاربر دیگری ثبت‌نام نکرده است.</div>';

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

searchInput?.addEventListener("input", async () => {

  const q = searchInput.value.trim();

  try {

    const data = await api(
      "/api/users?q=" +
      encodeURIComponent(q)
    );

    users = data.users || [];

    renderUsers();

  } catch (error) {
    console.log(error);
  }
});

publicRoom?.addEventListener(
  "click",
  openPublicRoom
);

async function openPublicRoom() {

  try {

    const data = await api("/api/rooms");

    const room = (data.rooms || []).find(
      (r) => r.name === "دورهمی"
    );

    if (!room) {
      alert("اتاق دورهمی پیدا نشد.");
      return;
    }

    await api(
      `/api/rooms/${room.id}/join`,
      {
        method: "POST"
      }
    );

    currentRoom = room;
    currentUser = null;

    chatWith.textContent =
      "🌟 اتاق دورهمی";

    statusLabel.textContent =
      "گفتگوی عمومی";

    emptyBox.classList.add("hidden");
    conversation.classList.remove("hidden");

    messagesBox.innerHTML = "";

    const messages = await api(
      `/api/rooms/${room.id}/messages`
    );

    messages.messages.forEach((message) => {

      appendMessage({
        sender_id:
          message.sender_id,

        username:
          message.sender_id === me.id
            ? me.username
            : "کاربر",

        body:
          message.body,

        created_at:
          message.created_at
      });

    });

    if (socket && socket.readyState === WebSocket.OPEN) {

      socket.send(
        JSON.stringify({
          type: "join",
          roomId: room.id
        })
      );
    }

    scrollMessages();

  } catch (error) {

    alert(error.message);
  }
}

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

  try {

    const data = await api(
      `/api/messages/${user.id}`
    );

    data.messages.forEach((message) => {

      appendMessage({
        sender_id: message.sender_id,
        username:
          message.sender_id === me.id
            ? me.username
            : user.username,
        body: message.body,
        created_at: message.created_at
      });

    });

    scrollMessages();

  } catch (error) {

    alert(error.message);
  }
}

sendForm.addEventListener("submit", (e) => {

  e.preventDefault();

  const body =
    messageInput.value.trim();

  if (!body) return;

  if (
    !socket ||
    socket.readyState !== WebSocket.OPEN
  ) {
    alert("ارتباط با سرور برقرار نیست.");
    return;
  }

  if (currentUser) {

    /*
      نسخه فعلی Worker پیام خصوصی را
      هنوز به صورت جداگانه پشتیبانی نمی‌کند.
    */

    alert(
      "گفتگوی خصوصی در حال آماده‌سازی است."
    );

    return;
  }

  if (currentRoom) {

    socket.send(
      JSON.stringify({
        type: "message",
        body
      })
    );

    messageInput.value = "";
    messageInput.focus();
  }
});

function appendMessage(message) {

  const mine =
    message.sender_id === me.id ||
    message.username === me.username;

  const item =
    document.createElement("div");

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
        !mine && currentRoom
          ? `<small class="sender">
               ${escapeHtml(
                 message
