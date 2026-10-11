/* Blog: the station poster turns into the embedded studio on click. */
(() => {
  document.querySelectorAll("[data-station-embed]").forEach((box) => {
    const button = box.querySelector(".embed-play");
    const poster = box.querySelector(".embed-frame img");
    if (!button || !poster) return;
    button.addEventListener("click", () => {
      const frame = document.createElement("iframe");
      frame.src = box.dataset.stationEmbed;
      frame.title = "Interactive IO-Link station";
      frame.setAttribute("allow", "fullscreen");
      poster.replaceWith(frame);
      button.remove();
      box.classList.add("is-live");
      frame.focus();
    });
  });
})();
