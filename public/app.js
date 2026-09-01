const $ = (id) => document.getElementById(id);

let me = null;
let socket = null;
let currentRoom = null;
let currentUser = null;
let authMode = "login";
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

  const text = await response.text();

  let data = {};

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("پاسخ نامعتبر از سرور دریافت شد.");
  }

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "خطایی رخ داد.");
  }

  return data;
}


/* =========================
   AUTH TABS
========================= */

document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", () => {

    document
      .querySelectorAll(".tabs button")
      .forEach((b) => b.classList.remove("active"));

    button.classList.add("active");

    authMode = button.dataset.mode || "login";

    const submit = authForm?.querySelector("button");

    if (submit) {
      submit.textContent =
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

  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    if (authError) authError.textContent =
      "نام کاربری باید ۳ تا ۲۴ کاراکتر انگلیسی، عدد یا _ باشد.";
    return;
  }

  if (!password) {
    if (authError) authError.textContent =
      "رمز عبور را وارد کن.";
    return;
  }

  if (
    authMode === "register" &&
    password.length < 8
  ) {
    if (authError) authError.textContent =
      "رمز عبور باید حداقل ۸ کاراکتر باشد.";
    return;
  }

  try {

    const endpoint =
      authMode === "register"
        ? "/api/register"
        : "/api/login";

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

    console.error(error);
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
    meLabel.textContent =
      "@" + me.username;
  }

  /*
    اول اتصال WebSocket
  */
  connectSocket();

  /*
    اتاق دورهمی را خودکار باز می‌کنیم
  */
  openPublicRoom();

  /*
    فعلاً کاربران خصوصی نداریم
  */
  renderUsers();
}


/* =========================
   PUBLIC ROOM
========================= */

function openPublicRoom() {

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

  /*
    پیام‌های قبلی را پاک می‌کنیم
    چون WebSocket تاریخچه را خودش می‌فرستد.
  */
  if (messagesBox) {
    messagesBox.innerHTML = "";
  }

  /*
    اگر WebSocket هنوز وصل نشده،
    وقتی وصل شد تاریخچه می‌آید.
  */
  if (
    socket &&
    socket.readyState === WebSocket.OPEN
  ) {
    requestHistory();
  }
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

  console.log(
    "Connecting WebSocket:",
    wsUrl
  );

  socket = new WebSocket(wsUrl);

  socket.addEventListener("open", () => {

    console.log(
      "WebSocket connected"
    );

    if (statusLabel) {
      statusLabel.textContent =
        "آنلاین";
    }

    /*
      اگر کاربر داخل اتاق دورهمی است،
      تاریخچه را می‌گیریم.
    */
    if (currentRoom) {
      requestHistory();
    }
  });


 
