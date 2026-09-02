/* چت دورهمی — app.js — نسخه اصلاح‌شده */

(() => {
  "use strict";

  function startApp() {
    const $ = (id) => document.getElementById(id);

    let me = null;
    let socket = null;
    let authMode = "login";
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    let manualClose = false;
    let onlineUsers = new Set();
    let messageIds = new Set();

    const auth = $("auth");
    const chat = $("chat");
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
    const conversation = $("conversation");
    const chatWith = $("chatWith");
    const status = $("status");
    const publicRoom = $("publicRoom");
    const logoutBtn = $("logout");
    const backBtn = $("backBtn");
    const chatArea = document.querySelector(".chat-area");

    function showError(text) {
      if (authError) {
        authError.textContent = text || "";
      }
    }

    function escapeHtml(text) {
      return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function timeText(time) {
      const d = new Date(time);

      if (Number.isNaN(d.getTime())) {
        return "";
      }

      return d.toLocaleTimeString("fa-IR", {
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    async function api(url, options = {}) {
      try {
        const response = await fetch(url, {
          ...options,
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
          }
        });

        const text = await response.text();

        let data;

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
            `خطای سرور: ${response.status}`
          );
        }

        return data;

      } catch (error) {
        if (
          error instanceof TypeError
        ) {
          throw new Error(
            "ارتباط با سرور برقرار نشد."
          );
        }

        throw error;
      }
    }

    /* =========================
       LOGIN / REGISTER
    ========================= */

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

      const submitButton =
        authForm?.querySelector(
          "button[type='submit']"
        );

      if (submitButton) {
        submitButton.textContent =
          authMode === "login"
            ? "ورود به دورهمی"
            : "ثبت‌نام";
      }

      showError("");
    }

    document
      .querySelectorAll(".tabs button")
      .forEach((button) => {
        button.addEventListener(
          "click",
          function () {
            setAuthMode(
              this.dataset.mode
            );
          }
        );
      });

    async function handleAuth(event) {
      event.preventDefault();

      showError("");

      const username =
        (usernameInput?.value || "")
          .trim()
          .toLowerCase();

      const password =
        passwordInput?.value || "";

      if (!username) {
        showError(
          "نام کاربری را وارد کن."
        );
        usernameInput?.focus();
        return;
      }

      if (
        !/^[a-z0-9_]{3,24}$/.test(
          username
        )
      ) {
        showError(
          "نام کاربری باید ۳ تا ۲۴ کاراکتر انگلیسی، عدد یا _ باشد."
        );
        usernameInput?.focus();
        return;
      }

      if (!password) {
        showError(
          "رمز عبور را وارد کن."
        );
        passwordInput?.focus();
        return;
      }

      if (
        authMode === "register" &&
        password.length < 8
      ) {
        showError(
          "رمز عبور باید حداقل ۸ کاراکتر باشد."
        );
        passwordInput?.focus();
        return;
      }

      const button =
        authForm.querySelector(
          "button[type='submit']"
        );

      const oldText =
        button?.textContent;

      if (button) {
        button.disabled = true;
        button.textContent =
          authMode === "login"
            ? "در حال ورود..."
            : "در حال ثبت‌نام...";
      }

      try {
        const endpoint =
          authMode === "register"
            ? "/api/register"
            : "/api/login";

        /*
         * Backend فعلی دقیقاً password می‌گیرد
         * و خودش SHA-256 را انجام می‌دهد.
         */
        const result = await api(
          endpoint,
          {
            method: "POST",
            body: JSON.stringify({
              username,
              password
            })
          }
        );

        if (
          !result.user ||
          !result.user.username
        ) {
          throw new Error(
            "کاربر از سرور دریافت نشد."
          );
        }

        me = {
          id: result.user.id,
          username:
            result.user.username
        };

        localStorage.setItem(
          "chat_username",
          me.username
        );

        localStorage.setItem(
          "chat_logged_in",
          "1"
        );

        if (passwordInput) {
          passwordInput.value = "";
        }

        showChat();

      } catch (error) {
        console.error(
          "AUTH ERROR:",
          error
        );

        showError(
          error?.message ||
          "ورود یا ثبت‌نام انجام نشد."
        );

      } finally {
        if (button) {
          button.disabled = false;
          button.textContent =
            oldText ||
            (
              authMode === "login"
                ? "ورود به دورهمی"
                : "ثبت‌نام"
            );
        }
      }
    }

    if (authForm) {
      authForm.addEventListener(
        "submit",
        handleAuth
      );
    }

    /* =========================
       SHOW CHAT
    ========================= */

    function showChat() {
      if (!me?.username) {
        return;
      }

      auth?.classList.add("hidden");
      chat?.classList.remove("hidden");

      if (meLabel) {
        meLabel.textContent =
          "@" + me.username;
      }

      if (chatWith) {
        chatWith.textContent =
          "🌟 اتاق دورهمی";
      }

      if (status) {
        status.textContent =
          "در حال اتصال...";
      }

      if (conversation) {
        conversation.classList.remove(
          "hidden"
        );
      }

      chatArea?.classList.add(
        "mobile-open"
      );

      connectSocket();
    }

    /* =========================
       WEBSOCKET
    ========================= */

    function connectSocket() {
      if (!me?.username) {
        return;
      }

      if (reconnectTimer) {
        clearTimeout(
          reconnectTimer
        );
        reconnectTimer = null;
      }

      manualClose = false;

      try {
        if (socket) {
          socket.close();
        }
      } catch (_) {}

      const protocol =
        location.protocol === "https:"
          ? "wss:"
          : "ws:";

      const url =
        protocol +
        "//" +
        location.host +
        "/ws?username=" +
        encodeURIComponent(
          me.username
        );

      try {
        socket =
          new WebSocket(url);
      } catch (error) {
        console.error(error);
        reconnect();
        return;
      }

      socket.addEventListener(
        "open",
        function () {
          reconnectAttempts = 0;

          if (status) {
            status.textContent =
              "آنلاین";
          }

          loadMessages();
        }
      );

      socket.addEventListener(
        "message",
        function (event) {
          handleSocketMessage(
            event.data
          );
        }
      );

      socket.addEventListener(
        "error",
        function () {
          if (status) {
            status.textContent =
              "خطا در اتصال";
          }
        }
      );

      socket.addEventListener(
        "close",
        function () {
          if (!manualClose) {
            if (status) {
              status.textContent =
                "اتصال قطع شد...";
            }

            reconnect();
          }
        }
      );
    }

    function reconnect() {
      if (
        manualClose ||
        !me?.username ||
        reconnectTimer
      ) {
        return;
      }

      reconnectAttempts++;

      const delay =
        Math.min(
          15000,
          1000 *
          Math.pow(
            1.5,
            reconnectAttempts - 1
          )
        );

      reconnectTimer =
        setTimeout(
          function () {
            reconnectTimer = null;
            connectSocket();
          },
          delay
        );
    }

    function handleSocketMessage(raw) {
      let data;

      try {
        data =
          typeof raw === "string"
            ? JSON.parse(raw)
            : raw;
      } catch {
        return;
      }

      if (!data) {
        return;
      }

      /* تاریخچه پیام‌ها */
      if (
        data.type === "history" &&
        Array.isArray(
          data.messages
        )
      ) {
        clearMessages();

        data.messages.forEach(
          renderMessage
        );

        scrollBottom();
        return;
      }

      /* پیام جدید */
      if (
        data.type === "message" &&
        data.message
      ) {
        renderMessage(
          data.message
        );

        scrollBottom();
        return;
      }

      /* ورود/خروج کاربر */
      if (
        data.type === "presence"
      ) {
        const username =
          String(
            data.username || ""
          ).trim();

        if (username) {
          if (data.online) {
            onlineUsers.add(
              username
            );
          } else {
            onlineUsers.delete(
              username
            );
          }

          renderUsers();
        }

        return;
      }

      if (
        data.type === "error"
      ) {
        console.error(
          data.message
        );
      }
    }

    /* =========================
       MESSAGES
    ========================= */

    async function loadMessages() {
      try {
        const result =
          await api(
            "/api/messages",
            {
              method: "GET"
            }
          );

        if (
          Array.isArray(
            result.messages
          )
        ) {
          clearMessages();

          result.messages.forEach(
            renderMessage
          );

          scrollBottom();
        }

      } catch (error) {
        console.error(
          "MESSAGES ERROR:",
          error
        );
      }
    }

    function clearMessages() {
      messageIds.clear();

      if (messagesBox) {
        messagesBox.innerHTML = "";
      }
    }

    function normalizeMessage(message) {
      if (!message) {
        return null;
      }

      const username =
        String(
          message.username || ""
        ).trim();

      const body =
        String(
          message.body ??
          message.text ??
          ""
        );

      if (!body) {
        return null;
      }

      const id =
        String(
          message.id ||
          (
            username +
            "-" +
            body +
            "-" +
            (
              message.created_at ||
              Date.now()
            )
          )
        );

      return {
        id,
        username,
        body,
        created_at:
          message.created_at ||
          Date.now()
      };
    }

    function renderMessage(message) {
      const item =
        normalizeMessage(
          message
        );

      if (!item) {
        return;
      }

      if (
        messageIds.has(item.id)
      ) {
        return;
      }

      messageIds.add(item.id);

      if (!messagesBox) {
        return;
      }

      const wrapper =
        document.createElement(
          "div"
        );

      wrapper.className =
        "message " +
        (
          item.username ===
          me?.username
            ? "mine"
            : "other"
        );

      wrapper.innerHTML = `
        <div class="message-bubble">
          <div class="message-user">
            ${escapeHtml(
              item.username
            )}
          </div>

          <div class="message-text">
            ${escapeHtml(
              item.body
            ).replace(
              /\n/g,
              "<br>"
            )}
          </div>

          <span class="message-time">
            ${escapeHtml(
              timeText(
                item.created_at
              )
            )}
          </span>
        </div>
      `;

      messagesBox.appendChild(
        wrapper
      );
    }

    function scrollBottom() {
      if (!messagesBox) {
        return;
      }

      requestAnimationFrame(
        function () {
          messagesBox.scrollTop =
            messagesBox.scrollHeight;
        }
      );
    }

    async function sendMessage() {
      if (!me?.username) {
        return;
      }

      const body =
        (
          messageInput?.value ||
          ""
        ).trim();

      if (!body) {
        return;
      }

      if (body.length > 2000) {
        alert(
          "پیام نباید بیشتر از ۲۰۰۰ کاراکتر باشد."
        );
        return;
      }

      /*
       * Backend فعلی:
       * WebSocket => { type:"message", body:"..." }
       */

      if (
        socket &&
        socket.readyState ===
        WebSocket.OPEN
      ) {
        try {
          socket.send(
            JSON.stringify({
              type: "message",
              body
            })
          );

          messageInput.value = "";
          messageInput.focus();

          return;

        } catch (error) {
          console.error(
            error
          );
        }
      }

      /*
       * اگر WebSocket در دسترس نبود
       * از API معمولی استفاده می‌کنیم.
       */

      try {
        const result =
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

        if (result.message) {
          renderMessage(
            result.message
          );
          scrollBottom();
        }

        messageInput.value = "";
        messageInput.focus();

      } catch (error) {
        alert(
          error?.message ||
          "ارسال پیام انجام نشد."
        );
      }
    }

    if (sendForm) {
      sendForm.addEventListener(
        "submit",
        function (event) {
          event.preventDefault();
          sendMessage();
        }
      );
    }

    /* =========================
       USERS
    ========================= */

    function renderUsers() {
      if (!usersBox) {
        return;
      }

      const query =
        (
          searchInput?.value ||
          ""
        )
          .trim()
          .toLowerCase();

      usersBox.innerHTML = "";

      const users =
        Array.from(
          onlineUsers
        )
          .filter(
            (username) =>
              username
                .toLowerCase()
                .includes(query)
          );

      users.forEach(
        function (username) {
          const button =
            document.createElement(
              "button"
            );

          button.type = "button";
          button.className =
            "user-item";

          button.innerHTML = `
            <span class="avatar">
              ${escapeHtml(
                username
                  .charAt(0)
                  .toUpperCase()
              )}
            </span>

            <span class="user-info">
              <strong>
                ${escapeHtml(
                  username
                )}
              </strong>

              <small>
                آنلاین
              </small>
            </span>

            <span class="user-status online"></span>
          `;

          usersBox.appendChild(
            button
          );
        }
      );
    }

    searchInput?.addEventListener(
      "input",
      renderUsers
    );

    /* =========================
       PUBLIC ROOM
    ========================= */

    publicRoom?.addEventListener(
      "click",
      function () {
        if (chatArea) {
          chatArea.classList.add(
            "mobile-open"
          );
        }

        if (chatWith) {
          chatWith.textContent =
            "🌟 اتاق دورهمی";
        }

        if (status) {
          status.textContent =
            socket?.readyState ===
            WebSocket.OPEN
              ? "آنلاین"
              : "در حال اتصال...";
        }

        loadMessages();
      }
    );

    backBtn?.addEventListener(
      "click",
      function () {
        chatArea?.classList.remove(
          "mobile-open"
        );
      }
    );

    /* =========================
       LOGOUT
    ========================= */

    logoutBtn?.addEventListener(
      "click",
      function () {
        manualClose = true;

        if (reconnectTimer) {
          clearTimeout(
            reconnectTimer
          );

          reconnectTimer = null;
        }

        try {
          socket?.close();
        } catch (_) {}

        socket = null;
        me = null;

        onlineUsers.clear();
        clearMessages();

        localStorage.removeItem(
          "chat_username"
        );

        localStorage.removeItem(
          "chat_logged_in"
        );

        chat?.classList.add(
          "hidden"
        );

        auth?.classList.remove(
          "hidden"
        );

        chatArea?.classList.remove(
          "mobile-open"
        );

        if (usernameInput) {
          usernameInput.value = "";
        }

        if (passwordInput) {
          passwordInput.value = "";
        }

        setAuthMode("login");
        showError("");
      }
    );

    /* =========================
       RESTORE LOGIN
    ========================= */

    const savedUsername =
      localStorage.getItem(
        "chat_username"
      );

    const savedLogin =
      localStorage.getItem(
        "chat_logged_in"
      );

    if (
      savedUsername &&
      savedLogin === "1"
    ) {
      me = {
        username:
          savedUsername
      };

      showChat();
    } else {
      setAuthMode("login");
    }

    /* =========================
       CONNECTION RECOVERY
    ========================= */

    window.addEventListener(
      "online",
      function () {
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
      function () {
        manualClose = true;

        try {
          socket?.close();
        } catch (_) {}
      }
    );
  }

  /*
   * بسیار مهم:
   * صبر می‌کنیم HTML کاملاً لود شود 
     if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );
  } else {
    init();
  }
})();
