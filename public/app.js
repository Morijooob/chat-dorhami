/* چت دورهمی — Frontend JavaScript v5.1 */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let me = null;
  let socket = null;
  let currentRoom = { id: "global", name: "دورهمی" };
  let currentUser = null;
  let authMode = "login";
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let socketManualClose = false;
  let knownUsers = new Set();
  let renderedMessageIds = new Set();

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

  function setText(el, text) {
    if (el) el.textContent = text == null ? "" : String(text);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeMessage(message) {
    if (!message || typeof message !== "object") return null;

    const username = String(
      message.username ??
      message.user ??
      message.sender ??
      ""
    ).trim();

    const text = String(
      message.text ??
      message.message ??
      message.content ??
      ""
    );

    const createdAt =
      message.createdAt ??
      message.created_at ??
      message.time ??
      Date.now();

    const id = String(
      message.id ??
      `${username}-${createdAt}-${text}`
    );

    if (!text) return null;

    return {
      id,
      username,
      text,
      createdAt
    };
  }

  function formatTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleTimeString("fa-IR", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  async function api(url, options = {}) {
    const headers = {
      ...(options.body
        ? { "Content-Type": "application/json" }
        : {}),
      ...(options.headers || {})
    };

    const response = await fetch(url, {
      ...options,
      headers,
      credentials: "same-origin"
    });

    const text = await response.text();

    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(
        `پاسخ نامعتبر از سرور دریافت شد (${response.status}).`
      );
    }

    if (!response.ok || data.ok === false) {
      throw new Error(
        data.error || `خطای سرور (${response.status})`
      );
    }

    return data;
  }

  function showAuthError(message) {
    setText(authError, message);
  }

  function setAuthMode(mode) {
    authMode =
      mode === "register"
        ? "register"
        : "login";

    document
      .querySelectorAll(".tabs button")
      .forEach((button) => {
        button.classList.toggle(
          "active",
          button.dataset.mode === authMode
        );
      });

    const submit =
      authForm?.querySelector(
        "button[type='submit'], button"
      );

    if (submit) {
      submit.textContent =
        authMode === "login"
          ? "ورود به دورهمی"
          : "ثبت‌نام";
    }

    showAuthError("");
  }

  document
    .querySelectorAll(".tabs button")
    .forEach((button) => {
      button.addEventListener("click", () => {
        setAuthMode(
          button.dataset.mode || "login"
        );
      });
    });

  authForm?.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();

      showAuthError("");

      const username =
        usernameInput?.value
          .trim()
          .toLowerCase() || "";

      const password =
        passwordInput?.value || "";

      if (!username) {
        showAuthError(
          "نام کاربری را وارد کن."
        );
        return;
      }

      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        showAuthError(
          "نام کاربری باید ۳ تا ۲۴ کاراکتر انگلیسی، عدد یا _ باشد."
        );
        return;
      }

      if (!password) {
        showAuthError(
          "رمز عبور را وارد کن."
        );
        return;
      }

      if (
        authMode === "register" &&
        password.length < 8
      ) {
        showAuthError(
          "رمز عبور باید حداقل ۸ کاراکتر باشد."
        );
        return;
      }

      const submit =
        authForm.querySelector(
          "button[type='submit'], button"
        );

      const oldText =
        submit?.textContent;

      if (submit) {
        submit.disabled = true;

        submit.textContent =
          authMode === "login"
            ? "در حال ورود..."
            : "در حال ثبت‌نام...";
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

        if (
          !data.user ||
          !data.user.username
        ) {
          throw new Error(
            "اطلاعات کاربر از سرور دریافت نشد."
          );
        }

        me = data.user;

        localStorage.setItem(
          "chat_username",
          me.username
        );

        localStorage.setItem(
          "chat_dorhami_logged_in",
          "1"
        );

        if (passwordInput) {
          passwordInput.value = "";
        }

        await showChat();

      } catch (error) {
        console.error(
          "AUTH ERROR:",
          error
        );

        showAuthError(
          error?.message ||
          "ورود/ثبت‌نام انجام نشد."
        );

      } finally {
        if (submit) {
          submit.disabled = false;

          submit.textContent =
            oldText ||
            (
              authMode === "login"
                ? "ورود به دورهمی"
                : "ثبت‌نام"
            );
        }
      }
    }
  );

  async function restoreSession() {
    const savedUsername =
      localStorage.getItem(
        "chat_username"
      );

    const savedFlag =
      localStorage.getItem(
        "chat_dorhami_logged_in"
      );

    if (
      !savedUsername ||
      savedFlag !== "1"
    ) {
      return;
    }

    me = {
      username: savedUsername
    };

    await showChat();
  }

  async function showChat() {
    if (!me?.username) return;

    authBox?.classList.add("hidden");
    chatBox?.classList.remove("hidden");

    setText(
      meLabel,
      "@" + me.username
    );

    setText(
      chatWith,
      "🌟 اتاق دورهمی"
    );

    setText(
      statusLabel,
      "در حال اتصال..."
    );

    emptyBox?.classList.add("hidden");
    conversation?.classList.remove("hidden");

    connectSocket();
    openPublicRoom();
    renderUsers();
  }

  function openPublicRoom() {
    currentUser = null;

    currentRoom = {
      id: "global",
      name: "دورهمی"
    };

    setText(
      chatWith,
      "🌟 اتاق دورهمی"
    );

    setText(
      statusLabel,
      socket?.readyState === WebSocket.OPEN
        ? "آنلاین"
        : "در حال اتصال..."
    );

    emptyBox?.classList.add("hidden");
    conversation?.classList.remove("hidden");

    renderedMessageIds.clear();

    if (messagesBox) {
      messagesBox.innerHTML = "";
    }

    if (
      socket?.readyState ===
      WebSocket.OPEN
    ) {
      requestHistory();
    }
  }

  function buildWebSocketUrl() {
    const protocol =
      location.protocol === "https:"
        ? "wss:"
        : "ws:";

    return (
      `${protocol}//${location.host}` +
      `/ws?username=${encodeURIComponent(
        me.username
      )}`
    );
  }

  function connectSocket() {
    if (!me?.username) return;

    socketManualClose = false;

    if (socket) {
      try {
        socket.close();
      } catch (_) {}

      socket = null;
    }

    const wsUrl =
      buildWebSocketUrl();

    console.log(
      "Connecting WebSocket:",
      wsUrl
    );

    setText(
      statusLabel,
      "در حال اتصال..."
    );

    try {
      socket =
        new WebSocket(wsUrl);

    } catch (error) {
      console.error(
        "WebSocket creation failed:",
        error
      );

      setText(
        statusLabel,
        "اتصال ناموفق"
      );

      scheduleReconnect();
      return;
    }

    socket.addEventListener(
      "open",
      () => {
        reconnectAttempts = 0;

        console.log(
          "WebSocket connected"
        );

        setText(
          statusLabel,
          "آنلاین"
        );

        requestHistory();
        requestUsers();
      }
    );

    socket.addEventListener(
      "message",
      (event) => {
        handleSocketMessage(
          event.data
        );
      }
    );

    socket.addEventListener(
      "error",
      (event) => {
        console.error(
          "WebSocket error:",
          event
        );

        setText(
          statusLabel,
          "خطا در اتصال"
        );
      }
    );

    socket.addEventListener(
      "close",
      () => {
        console.log(
          "WebSocket closed"
        );

        if (!socketManualClose) {
          setText(
            statusLabel,
            "اتصال قطع شد؛ تلاش مجدد..."
          );

          scheduleReconnect();
        }
      }
    );
  }

  function scheduleReconnect() {
    if (
      reconnectTimer ||
      socketManualClose ||
      !me?.username
    ) {
      return;
    }

    reconnectAttempts += 1;

    const delay = Math.min(
      15000,
      1000 *
        Math.pow(
          1.5,
          reconnectAttempts - 1
        )
    );

    reconnectTimer =
      setTimeout(() => {
        reconnectTimer = null;
        connectSocket();
      }, delay);
  }

  function sendSocket(payload) {
    if (
      !socket ||
      socket.readyState !==
        WebSocket.OPEN
    ) {
      return false;
    }

    try {
      socket.send(
        JSON.stringify(payload)
      );

      return true;

    } catch (error) {
      console.error(
        "WebSocket send failed:",
        error
      );

      return false;
    }
  }

  function requestHistory() {
    sendSocket({
      type: "history",
      room:
        currentRoom?.id ||
        "global"
    });
  }

  function requestUsers() {
    sendSocket({
      type: "users",
      room:
        currentRoom?.id ||
        "global"
    });

    sendSocket({
      type: "presence",
      room:
        currentRoom?.id ||
        "global"
    });
  }

  function handleSocketMessage(raw) {
    let data;

    try {
      data =
        typeof raw === "string"
          ? JSON.parse(raw)
          : raw;

    } catch (error) {
      console.error(
        "Invalid WebSocket JSON:",
        raw
      );

      return;
    }

    if (!data) return;

    const type = String(
      data.type ||
      data.event ||
      ""
    ).toLowerCase();

    if (
      type === "history" ||
      Array.isArray(data.messages)
    ) {
      const messages =
        Array.isArray(data.messages)
          ? data.messages
          : Array.isArray(data.data)
            ? data.data
            : [];

      clearMessages();

      messages.forEach(
        renderMessage
      );

      scrollMessagesToBottom();
      return;
    }

    if (
      type === "message" ||
      type === "chat" ||
      data.message
    ) {
      const message =
        normalizeMessage(
          data.message || data
        );

      if (message) {
        renderMessage(message);
      }

      scrollMessagesToBottom();
      return;
    }

    if (
      type === "users" ||
      type === "presence" ||
      Array.isArray(data.users)
    ) {
      const users =
        Array.isArray(data.users)
          ? data.users
          : Array.isArray(data.online)
            ? data.online
            : [];

      updateUsers(users);
      return;
    }

    if (type === "error") {
      console.error(
        "Socket error:",
        data.error ||
          data.message
      );

      setText(
        statusLabel,
        data.error ||
          data.message ||
          "خطای ارتباطی"
      );

      return;
    }

    const fallback =
      normalizeMessage(data);

    if (fallback) {
      renderMessage(fallback);
      scrollMessagesToBottom();
    }
  }

  function clearMessages() {
    renderedMessageIds.clear();

    if (messagesBox) {
      messagesBox.innerHTML = "";
    }
  }

  function renderMessage(message) {
    const normalized =
      normalizeMessage(message);

    if (
      !normalized ||
      renderedMessageIds.has(
        normalized.id
      )
    ) {
      return;
    }

    renderedMessageIds.add(
      normalized.id
    );

    if (!messagesBox) return;

    const mine =
      normalized.username ===
      me?.username;

    const row =
      document.createElement(
        "div"
      );

    row.className =
      `message-row ${
        mine ? "mine" : "other"
      }`;

    row.innerHTML = `
      <div class="message-bubble">
        <div class="message-user">
          ${escapeHtml(
            normalized.username ||
            "کاربر"
          )}
        </div>

        <div class="message-text">
          ${escapeHtml(
            normalized.text
          ).replace(
            /\n/g,
            "<br>"
          )}
        </div>

        <div class="message-time">
          ${escapeHtml(
            formatTime(
              normalized.createdAt
            )
          )}
        </div>
      </div>
    `;

    messagesBox.appendChild(row);
  }

  function scrollMessagesToBottom() {
    if (!messagesBox) return;

    requestAnimationFrame(() => {
      messagesBox.scrollTop =
        messagesBox.scrollHeight;
    });
  }

  async function sendMessage() {
    if (!me?.username) return;

    const text =
      messageInput?.value.trim() ||
      "";

    if (!text) return;

    if (text.length > 4000) {
      alert(
        "پیام نمی‌تواند بیشتر از ۴۰۰۰ کاراکتر باشد."
      );

      return;
    }

    const payload = {
      type: "send",
      username: me.username,
      text,
      room:
        currentRoom?.id ||
        "global"
    };

    const sentBySocket =
      sendSocket(payload);

    if (!sentBySocket) {
      try {
        const data =
          await api(
            "/api/send",
            {
              method: "POST",
              body: JSON.stringify(
                payload
              )
            }
          );

        if (data.message) {
          renderMessage(
            data.message
          );

        } else if (data.ok) {
          renderMessage({
            id:
              data.id ||
              `${me.username}-${Date.now()}`,

            username:
              me.username,

            text,

            createdAt:
              data.createdAt ||
              Date.now()
          });
        }

        scrollMessagesToBottom();

      } catch (error) {
        console.error(
          "SEND ERROR:",
          error
        );

        alert(
          error?.message ||
          "ارسال پیام انجام نشد."
        );

        return;
      }
    }

    if (messageInput) {
      messageInput.value = "";
      messageInput.focus();
    }
  }

  sendForm?.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      sendMessage();
    }
  );

  messageInput?.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey
      ) {
        event.preventDefault();
        sendMessage();
      }
    }
  );

  function renderUsers() {
    if (!usersBox) return;

    const users =
      Array.from(
        knownUsers
      ).filter(Boolean);

    const query =
      (
        searchInput?.value ||
        ""
      )
        .trim()
        .toLowerCase();

    const filtered =
      users.filter(
        (username) =>
          username
            .toLowerCase()
            .includes(query)
      );

    usersBox.innerHTML = "";

    filtered.forEach(
      (username) => {
        const item =
          document.createElement(
            "button"
          );

        item.type = "button";

        item.className =
          "user-item";

        item.dataset.username =
          username;

        item.innerHTML = `
          <span class="user-avatar">
            ${escapeHtml(
              username
                .slice(0, 1)
                .toUpperCase()
            )}
          </span>

          <span class="user-name">
            @${escapeHtml(username)}
          </span>
        `;

        item.addEventListener(
          "click",
          () => {
            openPrivateUser(
              username
            );
          }
        );

        usersBox.appendChild(
          item
        );
      }
    );
  }

  function updateUsers(users) {
    knownUsers.clear();

    users.forEach((user) => {
      const username =
        typeof user === "string"
          ? user
          : user?.username ??
            user?.name;

      if (username) {
        knownUsers.add(
          String(username)
        );
      }
    });

    if (me?.username) {
      knownUsers.add(
        me.username
      );
    }

    renderUsers();
  }

  function openPrivateUser(username) {
    currentUser = username;

    currentRoom = {
      id: "global",
      name: username
    };

    setText(
      chatWith,
      "@" + username
    );

    setText(
      statusLabel,
      "گفتگوی خصوصی در نسخه بعدی فعال می‌شود"
    );
  }

  searchInput?.addEventListener(
    "input",
    renderUsers
  );

  publicRoom?.addEventListener(
    "click",
    () => {
      openPublicRoom();
    }
  );

  backBtn?.addEventListener(
    "click",
    () => {
      currentUser = null;
      openPublicRoom();
    }
  );

  logoutBtn?.addEventListener(
    "click",
    () => {
      localStorage.removeItem(
        "chat_username"
      );

      localStorage.removeItem(
        "chat_dorhami_logged_in"
      );

      me = null;
      socketManualClose = true;

      if (reconnectTimer) {
        clearTimeout(
          reconnectTimer
        );

        reconnectTimer = null;
      }

      if (socket) {
        try {
          socket.close();
        } catch (_) {}

        socket = null;
      }

      knownUsers.clear();
      clearMessages();

      chatBox?.classList.add(
        "hidden"
      );

      authBox?.classList.remove(
        "hidden"
      );

      setAuthMode("login");
      showAuthError("");

      if (usernameInput) {
        usernameInput.value = "";
      }

      if (passwordInput) {
        passwordInput.value = "";
      }
    }
  );

  window.addEventListener(
    "online",
    () => {
      if (
        me &&
        (
          !socket ||
          socket.readyState !==
            WebSocket.OPEN
        )
      ) {
        connectSocket();
      }
    }
  );

  window.addEventListener(
    "beforeunload",
    () => {
      socketManualClose = true;

      if (reconnectTimer) {
        clearTimeout(
          reconnectTimer
        );
      }

      try {
        socket?.close();
      } catch (_) {}
    }
  );

  function init() {
    setAuthMode("login");

    restoreSession().catch(
      (error) => {
        console.error(
          "Session restore failed:",
          error
        );

        localStorage.removeItem(
          "chat_username"
        );

        localStorage.removeItem(
          "chat_dorhami_logged_in"
        );
      }
    );
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      ini
