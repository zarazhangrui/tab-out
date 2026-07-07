'use strict';

(function initDashboardUiEffects() {
  function createDashboardUiEffects({
    onCardRemoved,
  } = {}) {
    function playCloseSound() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;

        const duration = 0.25;
        const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < data.length; i++) {
          const pos = i / data.length;
          const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
          data[i] = (Math.random() * 2 - 1) * env;
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = 2.0;
        filter.frequency.setValueAtTime(4000, t);
        filter.frequency.exponentialRampToValueAtTime(400, t + duration);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

        source.connect(filter).connect(gain).connect(ctx.destination);
        source.start(t);

        setTimeout(() => ctx.close(), 500);
      } catch {
        // Audio not supported.
      }
    }

    function shootConfetti(x, y) {
      const colors = [
        '#c8713a',
        '#e8a070',
        '#5a7a62',
        '#8aaa92',
        '#5a6b7a',
        '#8a9baa',
        '#d4b896',
        '#b35a5a',
      ];

      const particleCount = 17;

      for (let i = 0; i < particleCount; i++) {
        const el = document.createElement('div');

        const isCircle = Math.random() > 0.5;
        const size = 5 + Math.random() * 6;
        const color = colors[Math.floor(Math.random() * colors.length)];

        el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
        document.body.appendChild(el);

        const angle = Math.random() * Math.PI * 2;
        const speed = 60 + Math.random() * 120;
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed - 80;
        const gravity = 200;

        const startTime = performance.now();
        const duration = 700 + Math.random() * 200;

        function frame(now) {
          const elapsed = (now - startTime) / 1000;
          const progress = elapsed / (duration / 1000);

          if (progress >= 1) {
            el.remove();
            return;
          }

          const px = vx * elapsed;
          const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
          const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
          const rotate = elapsed * 200 * (isCircle ? 0 : 1);

          el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
          el.style.opacity = opacity;

          requestAnimationFrame(frame);
        }

        requestAnimationFrame(frame);
      }
    }

    function animateCardOut(card) {
      if (!card) return;

      const rect = card.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

      card.classList.add('closing');
      setTimeout(() => {
        card.remove();
        if (typeof onCardRemoved === 'function') {
          onCardRemoved();
        }
      }, 300);
    }

    function showToast(message) {
      const toast = document.getElementById('toast');
      const toastText = document.getElementById('toastText');
      if (!toast || !toastText) return;

      toastText.textContent = message;
      toast.classList.add('visible');
      setTimeout(() => toast.classList.remove('visible'), 2500);
    }

    function downloadJsonFile(filename, payload) {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    return {
      animateCardOut,
      downloadJsonFile,
      playCloseSound,
      shootConfetti,
      showToast,
    };
  }

  const dashboardUiEffects = {
    createDashboardUiEffects,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = dashboardUiEffects;
  }

  if (typeof window !== 'undefined') {
    window.TabOutDashboardUiEffects = dashboardUiEffects;
  }
})();
