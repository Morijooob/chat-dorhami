"use strict";

/* =========================================
   Chat Dorhami - FINAL APP.JS
   ========================================= */

const $ = (id) => document.getElementById(id);

/* ---------- Elements ---------- */

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

/* ---------- State ---------- */

let authMode = "login";

let me = null;

let socket = null;

let currentRoom = null;

let currentUser = null;

let socketReady = false;

let reconnectTimer = null;

/* =========================================
   AUTH MODE
   ========================================= */

document.querySelectorAll(".tabs button").forEach((button) => {

  button.addEventListener("click", () => {

    document
      .querySelectorAll(".tabs button")
      .forEach((b) => b.classList.remove("active"));

    button.classList.add("active");

    authMode =
      button.dataset.mode === "register"
        ? "register"
        : "login";

    const submit =
      authForm?.querySelector("button[type='submit']") ||
      authForm?.querySelector("button");

    if (submit) {
      submit.textContent =
        authMode === "register"
          ? "ثبت‌نام"
          : "ورود به دورهمی";
    }

    if (authError) {
      authError.textContent = "";
    }

  });

});

/* =========================================
   API
   ========================================= */

async function api(url, options = {}) {

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    ...options,
    headers,
    cache: "no-store"
  });

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      "پاسخ نامعتبر از سرور دریافت شد."
    );
  }

  if (!response.ok || data.ok === false) {
    throw new Error(
      data.error ||
      `خطای سرور (${response.status})`
    );
  }

  return data;
}

/* =========================================
   LOGIN / REGISTER
   ========================================= */

authForm?.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    if (authError) {
      authError.textContent = "";
    }

    const username =
      String(usernameInput?.value || "")
        .trim()
        .toLowerCase();

    const password =
      String(passwordInput?.value || "");

    if (!/^[a-z0-9_]{3,24}$/.test(username)) {

      if (authError) {
        authError.textContent =
          "نام کاربری باید ۳ تا ۲۴ کاراکتر انگلیسی، عدد یا _ باشد.";
      }

      return;
    }

    if (!password) {

      if (authError) {
        authError.textContent =
          "رمز عبور را وارد کن.";
      }

      return;
    }

    if (
      authMode === "register" &&
      password.length < 8
    ) {

      if (authError) {
        authError.textContent =
          "رمز عبور باید حداقل ۸ کاراکتر باشد.";
      }

      return;
    }

    const submit =
      authForm.querySelector("button[type='submit']") ||
      authForm.querySelector("button");

    if (submit) {
      submit.disabled = true;
      submit.textContent =
        authMode === "register"
          ? "در حال ثبت‌نام..."
          : "در حال ورود...";
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

      /*
        مهم:
        بعد از ورود مستقیماً اتاق دورهمی باز می‌شود.
      */

      await showChat(true);

    } catch (error) {

      console.error(error);

      if (authError) {
        authError.textContent =
          error.message ||
          "خطایی رخ داد.";
      }

    } finally {

      if (submit) {
        submit.disabled = false;

        submit.textContent =
          authMode === "register"
            ? "ثبت‌نام"
            : "ورود به دورهمی";
      }

    }

  }
);

/* =========================================
   SHOW CHAT
   ========================================= */

async function showChat(openRoom = false) {

  if (!me) {
    return;
  }

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
    لیست کاربران فعلاً خالی است.
  */

  renderUsers();

  /*
    مستقیم وارد اتاق عمومی شو.
  */

  if (openRoom) {

    setTimeout(() => {

      openPublicRoom();

    }, 100);

  }

}

/* =========================================
   CONNECT WEBSOCKET
   ========================================= */

function connectSocket() {

  if (!me) {
    return;
  }

  if (
    socket &&
    (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  try {

    if (socket) {
      socket.close();
    }

  } catch {}

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

  socketReady = false;

  socket.addEventListener(
    "open",
    () => {

      console.log(
        "✅ WebSocket connected"
      );

      socketReady = true;

      if (statusLabel) {
        statusLabel.textContent =
          currentRoom
            ? "آنلاین"
            : "گفتگوی عمومی";
      }

      /*
        اگر اتاق انتخاب شده ولی اتصال دیرتر برقرار شده،
        دوباره اتاق را فعال می‌کنیم.
      */

      if (!currentRoom) {
        openPublicRoom();
      }

    }
  );

  socket.addEventListener(
    "message",
    (event) => {

      let data;

      try {
        data =
          JSON.parse(event.data);
      } catch (error) {

        console.error(
          "Invalid WebSocket message",
          error
        );

        return;
      }

      /* ---------- History ---------- */

      if (data.type === "history") {

        if (!messagesBox) {
          return;
        }

        messagesBox.innerHTML = "";

        const messages =
          Array.isArray(data.messages)
            ? data.messages
            : [];

        messages.forEach(
          appendMessage
        );

        scrollMessages();

        return;
      }

      /* ---------- New Message ---------- */

      if (data.type === "message") {

        if (!data.message) {
          return;
        }

        /*
          فقط وقتی اتاق دورهمی باز است
          پیام را نشان بده.
        */

        if (currentRoom) {

          appendMessage(
            data.message
          );

          scrollMessages();

        }

        return;
      }

      /* ---------- Presence ---------- */

      if (data.type === "presence") {

        console.log(
          "Presence:",
          data.username,
          data.online
        );

        return;
      }

      /* ---------- Error ---------- */

      if (data.type === "error") {

        console.error(
          "Server:",
          data.message
        );

      }

    }
  );

  socket.addEventListener(
    "close",
    () => {

      console.log(
        "WebSocket disconnected"
      );

      socketReady = false;

      if (statusLabel) {
        statusLabel.textContent =
          "در حال اتصال...";
      }

      /*
        تلاش مجدد خودکار
      */

      clearTimeout(
        reconnectTimer
      );

      reconnectTimer =
        setTimeout(() => {

          if (me) {
            connectSocket();
          }

        }, 2000);

    }
  );

  socket.addEventListener(
    "error",
    (error) => {

      console.error(
        "WebSocket error:",
        error
      );

      socketReady = false;

    }
  );

}

/* =========================================
   OPEN PUBLIC ROOM
   ========================================= */

function openPublicRoom() {

  /*
    این قسمت عمداً مستقل از WebSocket است.
    بنابراین کلیک روی اتاق همیشه باید کار کند.
  */

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
      socketReady
        ? "آنلاین"
        : "در حال اتصال...";
  }

  emptyBox?.classList.add(
    "hidden"
  );

  conversation?.classList.remove(
    "hidden"
  );

  /*
    تاریخچه را از API فقط در صورتی می‌گیریم
    که WebSocket هنوز وصل نشده باشد.
  */

  if (
    !socket ||
    socket.readyState !== WebSocket.OPEN
  ) {

    loadMessagesFallback();

  }

  /*
    اگر WebSocket وصل است،
    history را خودش فرستاده است.
  */

}

/* =========================================
   FALLBACK MESSAGE LOAD
   ========================================= */

async function loadMessagesFallback() {

  if (!currentRoom) {
    return;
  }

  try {

    const data =
      await api("/api/messages");

    if (!currentRoom) {
      return;
    }

    if (!messagesBox) {
      return;
    }

    messagesBox.innerHTML = "";

    const messages =
      Array.isArray(data.messages)
        ? data.messages
        : [];

    messages.forEach(
      appendMessage
    );

    scrollMessages();

  } catch (error) {

    console.error(
      "Message loading error:",
      error
    );

  }

}

/* =========================================
   PUBLIC ROOM BUTTON
   ========================================= */

publicRoom?.addEventListener(
  "click",
  (event) => {

    event.preventDefault();
    event.stopPropagation();

    console.log(
      "🌟 Public room clicked"
    );

    openPublicRoom();

  }
);

/*
  بعضی قالب‌ها ممکن است روی خود id کلیک را
  دریافت نکنند. این event delegation هم
  برای اطمینان اضافه شده.
*/

document.addEventListener(
  "click",
  (event) => {

    const target =
      event.target?.closest?.(
        "#publicRoom"
      );

    if (!target) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    openPublicRoom();

  }
);

/* =========================================
   USERS
   ========================================= */

function renderUsers() {

  if (!usersBox) {
    return;
  }

  usersBox.innerHTML = `
    <div class="muted">
      فعلاً گفتگوی خصوصی فعال نشده است.
    </div>
  `;

}

/* =========================================
   SEARCH
   ========================================= */

searchInput?.addEventListener(
  "input",
  () => {
    /*
      بعداً جستجوی کاربران را اضافه می‌کنیم.
    */
  }
);

/* =========================================
   PRIVATE CHAT
   ========================================= */

function openPrivateChat(user) {

  if (!user) {
    return;
  }

  currentUser = user;
  currentRoom = null;

  if (chatWith) {
    chatWith.textContent =
      "@" + user.username;
  }

  if (statusLabel) {
    statusLabel.textContent =
      user.online
        ? "آنلاین"
        : "آفلاین";
  }

  emptyBox?.classList.add(
    "hidden"
  );

  conversation?.classList.remove(
    "hidden"
  );

  if (messagesBox) {
    messagesBox.innerHTML = "";

    const notice =
      document.createElement(
        "div"
      );

    notice.className =
      "muted";

    notice.textContent =
      "گفتگوی خصوصی در مرحله بعد فعال می‌شود.";

    messagesBox.appendChild(
      notice
    );
  }

}

/* =========================================
   SEND MESSAGE
   ========================================= */

sendForm?.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    const body =
      String(
        messageInput?.value || ""
      ).trim();

    if (!body) {
      return;
    }

    if (!me) {
      return;
    }

    if (!currentRoom) {

      openPublicRoom();

      return;

    }

    /*
      اول WebSocket
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

      if (messageInput) {
        messageInput.value = "";
        messageInput.focus();
      }

      return;

    }

    /*
      اگر WebSocket وصل نبود،
      API پشتیبان.
    */

    try {

      const data =
        await api(
          "/api/send",
          {
            method: "POST",

            body: JSON.stringify({
              username:
                me.username,

              body
            })
          }
        );

      /*
        سرور خودش broadcast می‌کند.
        پس اینجا پیام را دوباره اضافه نمی‌کنیم.
      */

      if (messageInput) {
        messageInput.value = "";
        messageInput.focus();
      }

      /*
        اگر WebSocket قطع بود،
        پاسخ API را برای خودمان نمایش می‌دهیم.
      */

      if (
        data.message &&
        currentRoom
      ) {

        appendMessage(
          data.message
        );

        scrollMessages();

      }

    } catch (error) {

      console.error(error);

      alert(
        error.message ||
        "ارسال پیام ناموفق بود."
      );

    }

  }
);

/* =========================================
   MESSAGE RENDER
   ========================================= */

function appendMessage(message) {

  if (!messagesBox || !message) {
    return;
  }

  /*
    جلوگیری از نمایش دوباره پیام
  */

  if (
    message.id &&
    messagesBox.querySelector(
      `[data-message-id="${CSS.escape(
        String(message.id)
      )}"]`
    )
  ) {
    return;
  }

  const item =
    document.createElement(
      "div"
    );

  const mine =
    me &&
    message.username === me.username;

  item.className =
    "message " +
    (mine
      ? "mine"
      : "other");

  if (message.id) {
    item.dataset.messageId =
      String(message.id);
  }

  const time =
    message.created_at
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
              ${escapeHtml(
                message.username
              )}
            </strong>
          `
          : ""
      }

      <div class="body">
        ${escapeHtml(
          message.body
        )}
      </div>

      <small>
        ${escapeHtml(time)}
      </small>

    </div>
  `;

  messagesBox.appendChild(
    item
  );

}

/* =========================================
   SCROLL
   ========================================= */

function scrollMessages() {

  if (!messagesBox) {
    return;
  }

  requestAnimationFrame(() => {

    messagesBox.scrollTop =
      messagesBox.scrollHeight;

  });

}

/* =========================================
   BACK BUTTON
   ========================================= */

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

/* =========================================
   LOGOUT
   ========================================= */

logoutBtn?.addEventListener(
  "click",
  () => {

    logout();

  }
);

function logout() {

  me = null;
  currentUser = null;
  currentRoom = null;

  localStorage.removeItem(
    "chat_username"
  );

  clearTimeout(
    reconnectTimer
  );

  if (socket) {

    try {
      socket.close();
    } catch {}

  }

  socket = null;
  socketReady = false;

  chatBox?.classList.add(
    "hidden"
  );

  authBox?.classList.remove(
    "hidden"
  );

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

/* =========================================
   SECURITY
   ========================================= */

function escapeHtml(value) {

  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll(
      "'",
      "&#039;"
    );

}

/* =========================================
   AUTO LOGIN
   ========================================= */

const savedUsername =
  localStorage.getItem(
    "chat_username"
  );

if (savedUsername) {

  me = {
    id: null,
    username:
      savedUsername
  };

  /*
    بعد از Refresh هم مستقیماً
    اتاق دورهمی باز می‌شود.
  */

  showChat(true)
    .catch((error) => {

      console.error(
        "Auto login error:",
        error
      );

    });

  }
