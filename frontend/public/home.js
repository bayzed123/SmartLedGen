// Homepage-only script. Fetches real, admin-approved reviews — no
// hardcoded/fake testimonials, since real ones now exist to show instead.

document.querySelectorAll(".payment-copy-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      const original = btn.textContent;
      btn.textContent = "✅ Copied";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove("copied");
      }, 1500);
    } catch {
      alert(btn.dataset.copy); // clipboard blocked (e.g. non-HTTPS/older browser) — show it instead
    }
  });
});

function escapeHtmlHome(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

(async function loadReviews() {
  const container = document.getElementById("reviewsContainer");
  if (!container) return;

  try {
    const resp = await fetch(`${API_BASE}/api/reviews`);
    const data = await resp.json();
    const reviews = data.reviews || [];

    if (reviews.length === 0) {
      container.innerHTML = `<p class="home-section-sub">No reviews yet — be the first to try it and leave one from your dashboard.</p>`;
      return;
    }

    container.innerHTML = reviews.map((r) => `
      <div class="home-review" style="margin-bottom:16px">
        <div style="color:var(--amber);margin-bottom:6px">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</div>
        <p>"${escapeHtmlHome(r.comment)}"</p>
        <div class="home-review-who">— ${escapeHtmlHome(r.email.split("@")[0])}</div>
      </div>
    `).join("");
  } catch {
    container.innerHTML = `<p class="home-section-sub">Reviews aren't loading right now — try refreshing.</p>`;
  }
})();
