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
    const [{ users }, { jobs }, { reviews }, { codes }] = await Promise.all([
      apiFetch("/api/admin/users"),
      apiFetch("/api/admin/jobs"),
      apiFetch("/api/admin/reviews"),
      apiFetch("/api/admin/access-codes"),
    ]);
    renderUsers(users);
    renderJobs(jobs);
    renderReviews(reviews);
    renderCodes(codes);
  } catch (err) {
    document.getElementById("adminContent").innerHTML = `<div class="slg-card"><div class="slg-banner slg-banner-error">${escapeHtml(err.message)}</div></div>`;
  }
})();

document.getElementById("genCodesBtn").addEventListener("click", async () => {
  const count = Number(document.getElementById("genCodeCount").value) || 1;
  try {
    const { codes } = await apiFetch("/api/admin/access-codes/generate", { method: "POST", body: JSON.stringify({ count }) });
    document.getElementById("genCodesResult").innerHTML =
      `<div class="slg-banner slg-banner-ok">${codes.map(escapeHtml).join("<br>")}</div>`;
    const { codes: all } = await apiFetch("/api/admin/access-codes");
    renderCodes(all);
  } catch (err) {
    document.getElementById("genCodesResult").innerHTML = `<div class="slg-banner slg-banner-error">${escapeHtml(err.message)}</div>`;
  }
});

function renderCodes(codes) {
  document.getElementById("codesBody").innerHTML = codes.map((code) => `
    <tr>
      <td style="font-family:monospace">${escapeHtml(code.code)}</td>
      <td>${code.status === "redeemed" ? "✅ Redeemed" : "⏳ Unused"}</td>
      <td>${escapeHtml(code.redeemed_by_email || "—")}</td>
      <td>${escapeHtml(code.created_at)}</td>
    </tr>
  `).join("");
}

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

function renderReviews(reviews) {
  document.getElementById("reviewsBody").innerHTML = reviews.map((r) => `
    <tr>
      <td>${escapeHtml(r.email)}</td>
      <td>${"★".repeat(r.rating)}</td>
      <td>${escapeHtml(r.comment)}</td>
      <td>${r.approved ? "✅ Public" : "⏳ Pending"}</td>
      <td><button class="slg-btn-ghost slg-btn" data-review-id="${r.id}" data-approved="${r.approved}">${r.approved ? "Unapprove" : "Approve"}</button></td>
      <td>${escapeHtml(r.created_at)}</td>
    </tr>
  `).join("");

  document.querySelectorAll("#reviewsBody button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.reviewId;
      const nowApproved = btn.dataset.approved !== "1" && btn.dataset.approved !== "true";
      await apiFetch(`/api/admin/reviews/${id}/approve`, { method: "POST", body: JSON.stringify({ approved: nowApproved }) });
      const { reviews } = await apiFetch("/api/admin/reviews");
      renderReviews(reviews);
    });
  });
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
