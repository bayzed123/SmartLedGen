requireLoginOrRedirect();

document.getElementById("logoutBtn").addEventListener("click", logout);

let selectedProvider = null;
let currentJobId = null;
let pollHandle = null;
let jobStartedAt = null;
let elapsedHandle = null;

function banner(elId, text, kind) {
  const el = document.getElementById(elId);
  el.innerHTML = text ? `<div class="slg-banner slg-banner-${kind}">${text}</div>` : "";
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

document.getElementById("savePlacesKey").addEventListener("click", async () => {
  const key = document.getElementById("placesKey").value.trim();
  if (!key) return banner("keysBanner", "Paste a Places API key first.", "warn");
  try {
    await apiFetch("/api/keys", { method: "POST", body: JSON.stringify({ provider: "google_places", key }) });
    document.getElementById("placesKey").value = "";
    banner("keysBanner", "Google Places API key saved.", "ok");
  } catch (err) {
    banner("keysBanner", err.message, "error");
  }
});

document.querySelectorAll(".slg-provider-opt").forEach((opt) => {
  opt.addEventListener("click", () => {
    document.querySelectorAll(".slg-provider-opt").forEach((o) => o.classList.remove("selected"));
    opt.classList.add("selected");
    selectedProvider = opt.dataset.provider;
  });
});

document.getElementById("saveLlmKey").addEventListener("click", async () => {
  const key = document.getElementById("llmKey").value.trim();
  if (!selectedProvider) return banner("keysBanner", "Pick a provider above first (click one of the three cards).", "warn");
  if (!key) return banner("keysBanner", "Paste an API key first.", "warn");
  try {
    await apiFetch("/api/keys", { method: "POST", body: JSON.stringify({ provider: selectedProvider, key }) });
    document.getElementById("llmKey").value = "";
    banner("keysBanner", `${selectedProvider} key saved.`, "ok");
  } catch (err) {
    banner("keysBanner", err.message, "error");
  }
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

document.getElementById("startBtn").addEventListener("click", async () => {
  const keyword = document.getElementById("keyword").value.trim();
  const location = document.getElementById("location").value.trim();
  const maxResults = Number(document.getElementById("maxResults").value) || 20;
  const runEnrichment = document.getElementById("runEnrichment").checked;
  const freeformGoal = document.getElementById("freeformGoal").value.trim();

  if (!keyword && !freeformGoal) return banner("searchBanner", "Enter a keyword, or describe a goal below it.", "warn");

  const payload = { maxResults, runEnrichment };
  if (freeformGoal) {
    if (!selectedProvider) return banner("searchBanner", "Describing a goal needs an AI provider picked above first.", "warn");
    payload.freeformGoal = freeformGoal;
    payload.llmProvider = selectedProvider;
  } else {
    payload.keyword = keyword;
    payload.location = location;
  }

  const startBtn = document.getElementById("startBtn");
  startBtn.disabled = true;
  startBtn.textContent = "Starting…";
  banner("searchBanner", "", "");

  try {
    const data = await apiFetch("/api/jobs", { method: "POST", body: JSON.stringify(payload) });
    currentJobId = data.jobId;
    jobStartedAt = Date.now();
    document.getElementById("progressCard").style.display = "block";
    startPolling();
    startElapsedClock();
  } catch (err) {
    if (err.status === 402) {
      banner("searchBanner", "Free trial already used — upgrade to run another search.", "warn");
    } else {
      banner("searchBanner", err.message, "error");
    }
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "▶ Start search";
  }
});

function startElapsedClock() {
  clearInterval(elapsedHandle);
  elapsedHandle = setInterval(() => {
    const seconds = Math.floor((Date.now() - jobStartedAt) / 1000);
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    document.getElementById("elapsedText").textContent = `${mm}:${ss}`;
  }, 1000);
}

function startPolling() {
  clearInterval(pollHandle);
  pollHandle = setInterval(async () => {
    try {
      const data = await apiFetch(`/api/jobs/${currentJobId}`);
      renderJob(data.job, data.leads);
      if (data.job.status === "done" || data.job.status === "error") {
        clearInterval(pollHandle);
        clearInterval(elapsedHandle);
      }
    } catch (err) {
      clearInterval(pollHandle);
      clearInterval(elapsedHandle);
      banner("searchBanner", err.message, "error");
    }
  }, 1500);
}

function renderJob(job, leads) {
  const pct = job.progress_total ? Math.min(100, Math.round((job.progress_current / job.progress_total) * 100)) : 0;
  document.getElementById("progressFill").style.width = `${pct}%`;
  document.getElementById("progressText").textContent = `${job.progress_current} / ${job.progress_total}`;

  if (job.status === "error") {
    // Distinguish "you hit a provider's rate limit" from a generic failure —
    // the "warning when API limited" requirement.
    const isRateLimit = /rate.?limit|429|quota/i.test(job.error_message || "");
    banner("searchBanner", job.error_message || "The job failed.", isRateLimit ? "warn" : "error");
  } else if (job.status === "done") {
    banner("searchBanner", `Done — ${leads.length} lead(s) collected.`, "ok");
  }

  renderLeads(leads);
}

function renderLeads(leads) {
  const tbody = document.getElementById("leadsBody");
  tbody.innerHTML = leads.map((l) => `
    <tr>
      <td>${escapeHtml(l.business_name)}</td>
      <td>${escapeHtml(l.sector)}</td>
      <td>${escapeHtml(l.phone)}</td>
      <td>${l.website ? `<a href="${escapeAttr(l.website)}" target="_blank" rel="noopener">${escapeHtml(l.website)}</a>` : ""}</td>
      <td>${escapeHtml(l.email)}</td>
      <td>${l.rating ?? ""}${l.review_count ? ` (${l.review_count})` : ""}</td>
      <td>${scoreBadge(l.lead_score)}</td>
      <td>${l.maps_link ? `<a href="${escapeAttr(l.maps_link)}" target="_blank" rel="noopener">Map</a>` : ""}</td>
    </tr>
  `).join("");

  document.getElementById("mTotal").textContent = leads.length;
  document.getElementById("mHigh").textContent = leads.filter((l) => l.lead_score === "High").length;
  document.getElementById("mEmail").textContent = leads.filter((l) => l.email).length;
  document.getElementById("mPhone").textContent = leads.filter((l) => l.phone).length;

  if (currentJobId && leads.length > 0) {
    const dl = document.getElementById("downloadCsv");
    dl.style.display = "inline-block";
    dl.href = `${API_BASE}/api/jobs/${currentJobId}/export.csv`;
    // Auth needed — a plain link can't send the Bearer header, so intercept the click.
    dl.onclick = async (e) => {
      e.preventDefault();
      const token = TokenStore.get();
      const resp = await fetch(dl.href, { headers: { Authorization: `Bearer ${token}` } });
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `smartleadgen_${currentJobId}.csv`; a.click();
      URL.revokeObjectURL(url);
    };
  }
}

function scoreBadge(score) {
  const emoji = { High: "🔥", Medium: "🟡", Low: "⚪" }[score] || "";
  const cls = { High: "high", Medium: "medium", Low: "low" }[score] || "low";
  return `<span class="slg-badge-${cls}">${emoji} ${score || ""}</span>`;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

// ---------------------------------------------------------------------------
// Google Sheets push
// ---------------------------------------------------------------------------

document.getElementById("pushSheet").addEventListener("click", async () => {
  const sheetUrl = document.getElementById("sheetUrl").value.trim();
  if (!sheetUrl) return banner("exportBanner", "Paste your Google Sheet URL first.", "warn");
  if (!currentJobId) return banner("exportBanner", "Run a search first.", "warn");

  try {
    await apiFetch("/api/sheet-connection", { method: "POST", body: JSON.stringify({ sheetUrl }) });
    const result = await apiFetch(`/api/jobs/${currentJobId}/push-to-sheet`, { method: "POST" });
    banner("exportBanner", `Pushed ${result.pushed} row(s) to your Sheet.`, "ok");
  } catch (err) {
    banner("exportBanner", err.message, "error");
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

(async function init() {
  try {
    const me = await apiFetch("/api/me");
    document.getElementById("userEmail").textContent = me.email;
  } catch { /* not fatal — just leaves the header blank */ }

  try {
    const data = await apiFetch("/api/keys");
    if (data.configured.includes("google_places")) {
      document.getElementById("placesKey").placeholder = "Configured ✅ — paste a new key to replace it";
    }
  } catch { /* not fatal — key section still works, just without the "configured" hint */ }
})();
