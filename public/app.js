const $ = (id) => document.getElementById(id);
let mode = "login";
let user = null;

async function hashPassword(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, "0")).join("");
}

function setMode(next) {
  mode = next;
  $("loginTab").classList.toggle("active", mode === "login");
  $("registerTab").classList.toggle("active", mode === "register");
  $("submit").textContent = mode === "login" ? "ورود" : "ثبت نام";
  $("authError").textContent = "";
}

async function auth() {
  $("authError").textContent = "";
  const username = $("username").value.trim();
  const password = $("password").value;
  if (!username || !password) return $("authError").textContent = "نام کاربری و رمز عبور را وارد کن";
  try {
    const passwordHash = await hashPassword(password);
    const response = await fetch(mode === "login" ? "/login" : "/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, passwordHash })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "خطا در عملیات");
    user = data.user;
    localStorage.setItem("dorhami_user", JSON.stringify(user));
    showChat();
  } catch (e) {
    $("authError").textContent = e.message || "ارتباط با سرور برقرار نشد";
  }
}

function showChat() {
  $("auth").classList.add("hidden");
  $("chat").classList.remove("hidden");
  loadMessages();
}

async function loadMessages() {
  const response = await fetch("/messages");
  const data = await response.json();
  if (!data.ok) return;
  $("messages").innerHTML = data.messages.map(m => `<div class="msg"><b>${escapeHtml(m.username)}</b><span>${escapeHtml(m.text)}</span></div>`).join("");
  $("messages").scrollTop = $("messages").scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c]));
}

$("loginTab").onclick = () => setMode("login");
$("registerTab").onclick = () => setMode("register");
$("submit").onclick = auth;
$("password").onkeydown = e => { if (e.key === "Enter") auth(); };
$("logout").onclick = () => { localStorage.removeItem("dorhami_user"); location.reload(); };
$("sendForm").onsubmit = async (e) => {
  e.preventDefault();
  const text = $("message").value.trim();
  if (!text || !user) return;
  const response = await fetch("/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: user.username, text }) });
  if (response.ok) { $("message").value = ""; await loadMessages(); }
};

try {
  const saved = JSON.parse(localStorage.getItem("dorhami_user"));
  if (saved?.username) { user = saved; showChat(); }
} catch {}
