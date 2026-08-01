// Included on every public-facing page (not the dashboard, which has its
// own header). Injects the shared header/footer so nav/footer links only
// need updating in one place, and highlights the current page's nav link.

async function loadPartial(selector, url) {
  const el = document.querySelector(selector);
  if (!el) return;
  try {
    const resp = await fetch(url);
    el.innerHTML = await resp.text();
  } catch {
    /* page still works without chrome if this fails */
  }
}

(async function initPartials() {
  await Promise.all([
    loadPartial("#site-header", "/partials/header.html"),
    loadPartial("#site-footer", "/partials/footer.html"),
  ]);

  const yearEl = document.getElementById("footerYear");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  const toggle = document.getElementById("siteNavToggle");
  const nav = document.getElementById("siteNav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const isOpen = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(isOpen));
    });
  }

  const here = window.location.pathname === "/" ? "/" : window.location.pathname;
  document.querySelectorAll(".site-nav-links a, .site-header-actions a").forEach((a) => {
    if (a.getAttribute("href") === here) a.classList.add("active");
  });

  document.dispatchEvent(new Event("slg:partials-loaded"));
})();
