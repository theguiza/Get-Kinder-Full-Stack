// /public/js/viewport-fix.js
(() => {
  const root = document.documentElement;

  function update() {
    const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    root.style.setProperty('--app-height', `${Math.round(h)}px`);
    const cb = document.getElementById('chatBody');
    if (cb) cb.scrollTop = cb.scrollHeight; // keep scrolled after height changes
  }

  const raf = () => requestAnimationFrame(update);

  update(); // initial
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', raf, { passive: true });
    visualViewport.addEventListener('scroll',  raf, { passive: true }); // URL bar & keyboard shifts
  }
  window.addEventListener('resize', raf, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(update, 250), { passive: true });
  window.addEventListener('focusout', () => setTimeout(update, 60), { passive: true }); // iOS keyboard dismiss quirk
})();