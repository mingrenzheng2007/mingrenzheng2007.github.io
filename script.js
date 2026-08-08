(function () {
  const silentHeroes = Array.from(document.querySelectorAll("[data-silent-hero]"));
  const cards = Array.from(document.querySelectorAll("[data-video-card]"));

  silentHeroes.forEach((video) => {
    video.muted = true;
    video.controls = false;

    if (!video.hasAttribute("data-home-hero")) {
      video.play().catch(() => {});
      return;
    }

    video.defaultMuted = true;
    video.autoplay = true;
    video.loop = true;
    video.playsInline = true;

    const resetToStart = () => {
      try {
        video.currentTime = 0;
      } catch (_) {
        // The media element may not have a seekable timeline yet.
      }
    };

    const playHero = (reset = false) => {
      if (reset) resetToStart();
      video.play().catch(() => {});
    };

    video.addEventListener("loadedmetadata", () => playHero(true), { once: true });
    video.addEventListener("loadeddata", () => playHero(false), { once: true });
    video.addEventListener("canplay", () => playHero(false), { once: true });
    window.addEventListener("pageshow", () => playHero(true));
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) playHero(false);
    });

    playHero(true);
  });

  const updateCard = (card) => {
    const video = card.querySelector("video");
    if (!video) return;
    const playIcon = card.querySelector("[data-play-icon]");
    const muteIcon = card.querySelector("[data-mute-icon]");
    card.classList.toggle("is-playing", !video.paused);
    card.classList.toggle("is-muted", video.muted);
    if (playIcon) playIcon.textContent = video.paused ? "Play" : "Pause";
    if (muteIcon) muteIcon.textContent = video.muted ? "Muted" : "Sound";
  };

  const muteOthers = (active) => {
    cards.forEach((card) => {
      const video = card.querySelector("video");
      if (!video || video === active) return;
      video.muted = true;
      updateCard(card);
    });
  };

  cards.forEach((card) => {
    const video = card.querySelector("video");
    const playButton = card.querySelector("[data-video-play]");
    const muteButton = card.querySelector("[data-video-mute]");
    if (!video) return;

    const startsAtZero = video.hasAttribute("data-start-at-zero");
    const resetToStart = () => {
      try {
        video.currentTime = 0;
      } catch (_) {
        // The media element may not have a seekable timeline yet.
      }
    };

    video.muted = true;
    video.controls = false;
    video.pause();
    if (startsAtZero) {
      const playFromStart = () => {
        resetToStart();
        video.play().catch(() => {});
      };

      video.autoplay = true;
      video.addEventListener("loadedmetadata", playFromStart, { once: true });
      window.addEventListener("pageshow", playFromStart);
      if (video.readyState >= 1) playFromStart();
    } else {
      video.addEventListener("loadedmetadata", () => {
        const requestedPreviewTime = Number(video.dataset.previewTime || card.dataset.previewTime || 0.2);
        const previewTime = Number.isFinite(requestedPreviewTime) ? requestedPreviewTime : 0.2;
        if (video.currentTime === 0 && Number.isFinite(video.duration) && video.duration > 0.2) {
          video.currentTime = Math.min(Math.max(previewTime, 0.1), video.duration - 0.1);
        }
      }, { once: true });
    }
    updateCard(card);

    const togglePlay = async () => {
      if (video.paused) {
        muteOthers(video);
        await video.play().catch(() => {});
      } else {
        video.pause();
      }
      updateCard(card);
    };

    playButton && playButton.addEventListener("click", togglePlay);
    video.addEventListener("click", togglePlay);
    muteButton && muteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      video.muted = !video.muted;
      if (!video.muted) muteOthers(video);
      updateCard(card);
    });
    video.addEventListener("play", () => updateCard(card));
    video.addEventListener("pause", () => updateCard(card));
    video.addEventListener("volumechange", () => updateCard(card));
  });
})();
