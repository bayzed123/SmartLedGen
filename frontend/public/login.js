let mode = "login"; // or "signup"

const els = {
  title: document.getElementById("formTitle"),
  hint: document.getElementById("formHint"),
  banner: document.getElementById("banner"),
  email: document.getElementById("email"),
  password: document.getElementById("password"),
  submitBtn: document.getElementById("submitBtn"),
  toggleHint: document.getElementById("toggleHint"),
  toggleLink: document.getElementById("toggleLink"),
};

function setBanner(text, kind) {
  els.banner.innerHTML = text ? `<div class="slg-banner slg-banner-${kind}">${text}</div>` : "";
}

function applyMode() {
  if (mode === "login") {
    els.title.textContent = "Sign in";
    els.hint.textContent = "One free run included — no card needed to try it.";
    els.submitBtn.textContent = "Sign in";
    els.toggleHint.textContent = "New here?";
    els.toggleLink.textContent = "Create an account";
  } else {
    els.title.textContent = "Create your account";
    els.hint.textContent = "Your first search is free — add a Google Places API key after signing up.";
    els.submitBtn.textContent = "Create account";
    els.toggleHint.textContent = "Already have an account?";
    els.toggleLink.textContent = "Sign in instead";
  }
  setBanner("", "");
}

els.toggleLink.addEventListener("click", () => {
  mode = mode === "login" ? "signup" : "login";
  applyMode();
});

els.submitBtn.addEventListener("click", async () => {
  const email = els.email.value.trim();
  const password = els.password.value;
  if (!email || !password) return setBanner("Enter both email and password.", "warn");

  els.submitBtn.disabled = true;
  els.submitBtn.textContent = mode === "login" ? "Signing in…" : "Creating account…";

  try {
    const path = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
    const data = await apiFetch(path, { method: "POST", body: JSON.stringify({ email, password }) });
    TokenStore.set(data.token);
    window.location.href = "/dashboard.html";
  } catch (err) {
    setBanner(err.message, "error");
    els.submitBtn.disabled = false;
    applyMode(); // restores button label
  }
});

applyMode();
// Already signed in? Skip straight to the dashboard.
if (TokenStore.get()) window.location.href = "/dashboard.html";
