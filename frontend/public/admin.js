requireLoginOrRedirect();

document.getElementById("logoutBtn").addEventListener("click", logout);

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

(async function init() {
  let me;
  try {
    me = await apiFetch("/api/me");
    document.getElementById("userEmail").textContent = me.email;
  } catch {
    return requireLoginOrRedirect();
  }

  if (!me.is_admin) {
    document.getElementById("accessDenied").style.display = "block";
    return;
  }
  document.getElementById("adminContent").style.display = "block";

  try {
    const [{ users }, { jobs }] = await Promise.all([
      apiFetch("/api/admin/users"),
      apiFetch("/api/admin/jobs"),
    ]);
    renderUsers(users);
    renderJobs(jobs);
  } catch (err) {
    document.getElementById("adminContent").innerHTML = `<div class="slg-card"><div class="slg-banner slg-banner-error">${escapeHtml(err.message)}</div></div>`;
  }
})();

function renderUsers(users) {
  document.getElementById("mUsers").textContent = users.length;
  document.getElementById("usersBody").innerHTML = users.map((u) => `
    <tr>
      <td>${escapeHtml(u.email)}</td>
      <td>${escapeHtml(u.plan)}</td>
      <td>${u.free_trial_used ? "Yes" : "No"}</td>
      <td>${u.is_admin ? "✅" : ""}</td>
      <td>${escapeHtml(u.created_at)}</td>
    </tr>
  `).join("");
}

function renderJobs(jobs) {
  document.getElementById("mJobs").textContent = jobs.length;
  document.getElementById("mRunning").textContent = jobs.filter((j) => j.status === "running").length;
  document.getElementById("mErrors").textContent = jobs.filter((j) => j.status === "error").length;

  document.getElementById("jobsBody").innerHTML = jobs.map((j) => `
    <tr>
      <td>${escapeHtml(j.email)}</td>
      <td>${escapeHtml(j.keyword)}</td>
      <td>${escapeHtml(j.location)}</td>
      <td>${escapeHtml(j.status)}${j.status === "error" ? ` — ${escapeHtml(j.error_message || "")}` : ""}</td>
      <td>${j.progress_current}/${j.progress_total}</td>
      <td>${escapeHtml(j.llm_provider || "—")}</td>
      <td>${escapeHtml(j.created_at)}</td>
    </tr>
  `).join("");
}
