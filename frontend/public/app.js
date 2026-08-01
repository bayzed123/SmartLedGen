// Shared across login.html and dashboard.html.
//
// IMPORTANT: update API_BASE after your first `wrangler deploy` of the
// worker/ project — it prints the *.workers.dev URL (or your custom
// domain once you attach one). See worker/README.md.
const API_BASE = "https://smartleadgen-api.YOUR-SUBDOMAIN.workers.dev";

// Token storage: localStorage on a real deployed origin (this site's own
// Cloudflare domain) persists a login across page reloads, which is what
// you want. The try/catch fallback to an in-memory variable exists only
// so this never throws in an environment that blocks storage access —
// it just won't survive a refresh there.
let _memoryToken = null;
const TokenStore = {
  get() {
    try { return localStorage.getItem("slg_token") ?? _memoryToken; }
    catch { return _memoryToken; }
  },
  set(token) {
    _memoryToken = token;
    try { localStorage.setItem("slg_token", token); } catch { /* fall back to memory only */ }
  },
  clear() {
    _memoryToken = null;
    try { localStorage.removeItem("slg_token"); } catch { /* no-op */ }
  },
};

async function apiFetch(path, options = {}) {
  const token = TokenStore.get();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const resp = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const isJson = (resp.headers.get("Content-Type") || "").includes("application/json");
  const body = isJson ? await resp.json().catch(() => ({})) : await resp.text();

  if (!resp.ok) {
    const message = (isJson && body.error) ? body.error : `Request failed (${resp.status})`;
    const err = new Error(message);
    err.status = resp.status;
    err.body = body;
    throw err;
  }
  return body;
}

function requireLoginOrRedirect() {
  if (!TokenStore.get()) window.location.href = "/login.html";
}

function logout() {
  TokenStore.clear();
  window.location.href = "/login.html";
}
