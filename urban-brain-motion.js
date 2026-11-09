(function () {
  const video = document.querySelector("[data-cover-video]");
  const toggle = document.querySelector("[data-cover-toggle]");
  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let inView = !("IntersectionObserver" in window);
  let pausedByUser = false;

  function updatePlayback() {
    if (motionPreference.matches || document.hidden || !inView || pausedByUser) {
      video.pause();
      return;
    }

    if (!video.hasAttribute("src")) video.src = video.dataset.coverVideo;
    video.play().catch(() => {});
  }

  video.addEventListener("playing", () => {
    video.classList.add("has-frame");
    toggle.hidden = false;
  });

  video.addEventListener("error", () => {
    video.classList.remove("has-frame");
    toggle.hidden = true;
  });

  toggle.addEventListener("click", () => {
    pausedByUser = !pausedByUser;
    toggle.textContent = pausedByUser ? "Play motion" : "Pause motion";
    updatePlayback();
  });

  document.addEventListener("visibilitychange", updatePlayback);
  motionPreference.addEventListener("change", updatePlayback);

  if (inView) {
    updatePlayback();
  } else {
    new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      updatePlayback();
    }).observe(video);
  }
})();
