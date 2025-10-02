// viewport-fix.js
(() => {
  const root = document.documentElement;

  // Compute the *visible* viewport height (visual viewport if available).
  function updateVisibleHeight() {
    const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    root.style.setProperty('--vvh', `${Math.round(h)}px`);

    // If you have a scrollable chat list, keep it pinned after height changes.
    const chatBody = document.getElementById('chatBody');
    if (chatBody) chatBody.scrollTop = chatBody.scrollHeight;
  }

  const rafUpdate = () => requestAnimationFrame(updateVisibleHeight);

  // Initial read
  updateVisibleHeight();

  // VisualViewport is the authoritative signal for keyboard show/hide.
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', rafUpdate, { passive: true });
    visualViewport.addEventListener('scroll', rafUpdate, { passive: true }); // handles URL bar shifts too
  }

  // Fallbacks + rotations
  window.addEventListener('resize', rafUpdate, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(updateVisibleHeight, 250), { passive: true });

  // iOS quirk: when inputs blur and the keyboard is dismissing, recalc once more.
  window.addEventListener('focusout', () => setTimeout(updateVisibleHeight, 60), { passive: true });
})();
