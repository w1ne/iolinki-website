/* Progressive enhancement: all navigation links remain visible without JavaScript. */
(() => {
  const button = document.querySelector(".menu-button");
  const nav = document.querySelector("#primary-navigation");
  if (!button || !nav) return;
  const mobile = matchMedia("(max-width: 760px)");
  document.documentElement.classList.add("js-nav");
  const close = (restoreFocus = false) => {
    button.setAttribute("aria-expanded", "false");
    nav.classList.remove("is-open");
    if (restoreFocus) button.focus();
  };
  const sync = () => {
    button.hidden = !mobile.matches;
    close();
  };
  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      button.getAttribute("aria-expanded") === "true"
    )
      close(true);
  });
  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) close();
  });
  mobile.addEventListener("change", sync);
  document.querySelectorAll("nav a").forEach((link) => {
    const target = new URL(link.href);
    if (target.pathname === location.pathname && !target.hash)
      link.setAttribute("aria-current", "page");
  });
  sync();
})();
